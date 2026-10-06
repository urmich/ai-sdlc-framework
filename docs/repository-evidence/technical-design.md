# Technical Design: Verify Repository, Pull Request, and Execution Evidence

## Purpose and boundaries

The framework must decide whether a reported check or external result belongs
to the exact local checkout, hosted repository, PR, commit, and execution
attempt under consideration. If that cannot be established, it reports the
missing proof rather than awarding a pass or retrying an uncertain action.

This design implements [the Requirements](requirements.md) against
[the Test Plan](test-plan.md). It contains no application or test implementation.
The general framework remains independent of GitHub and Azure DevOps API
shapes. A hosting-service adapter translates a provider response into a small,
checked observation; neither an adapter nor this offline CLI calls a provider
on its own. Both this work and the later GitHub integration are local-only.
The existing installed version stays untouched until a separately authorized
installation.

**Existing code to extend:** `src/git.mjs` currently checks only
`origin/HEAD`; `src/gate.mjs` prefers the cached member default branch;
`src/pr.mjs` has one mutable PR record; `src/monitors.mjs` relates checks to
monitored runs; `src/operations.mjs` fingerprints actions but cannot prove every
result type; and `src/gate.mjs` accepts a shallow subset of configured tool
arguments. `src/store.mjs` writes records separately before updating its
checkpoint. Old records must remain readable, but cannot supply missing new
proof.

## 1. Which local and hosted repository did we check?

The user-facing pair is `{localRepositoryPath, remoteRepositoryURL}`:

- `localRepositoryPath` is the canonical, currently bound Git checkout path.
  Existing `repositoryId` remains an internal work-item identifier for old and
  multi-repository manifests; it is **not** a replacement for the real path.
- `remoteRepositoryURL` is the actual, credential-free URL resolved from the
  explicitly selected Git remote. A fetch URL applies to read-only
  observations. If a future action publishes a ref, it separately verifies
  the effective push URL before that action. This design never pushes.
- A remote name such as `origin` or `upstream` is a user-configurable Git
  handle for finding URLs, not a repository identity. One checkout can have
  several. The existing `.sdlc/config.json` gains an optional `remote` field,
  containing the actual Git remote name when selection is ambiguous.

`src/git.mjs` reads the effective fetch URLs using Git's `remote get-url
--all <name>` and checks the repository's canonical path at observation time.
An absent named remote or multiple applicable URLs is unresolved until an
explicit one is selected and verified. Existing single-remote installations
remain usable without a new configuration field. Actual Git push URL
resolution continues to use the separately checked push URL from the push
classifier. Credentials in either URL or query string are rejected before
storage.

When Git's push URL differs from its fetch URL, `repository observe` can
select that push URL explicitly and verify it through the same trusted
hosting-service adapter. This observation is read-only and grants no
publication permission. Fetch remains the default for repository reads and
default-branch evidence. PR and Git-ref publication consent may name only
the exact separately verified destination; observing the fetch URL cannot
establish or authorize a different push URL.

A record named `repository-observation` holds the verified path/URL pair,
hosting service, configured connection identifier, hosted-repository reference
from its adapter, observed revision, default branch when known, observation
time, and bounded evidence reference. Two checkouts with the same URL, and one
checkout with two URLs, have different records. The record never contains the
raw provider response. A path move requires re-binding; a changed URL needs a
new observation. Similar HTTPS and SSH URLs are **not** assumed equivalent:
the hosting service must prove they refer to the same repository. Such proof
does not transfer approvals or earlier passing results. Older observations
remain in history. (FR-055; T-101)

Publication consent needs the same protection as observation. Extend
`src/decisions.mjs` decision preparation/admission,
`src/authority.mjs::permissionMatches`, and
`src/pr.mjs::publicationAuthority` so a **new** PR/push grant names the
approved canonical `localRepositoryPath`, the exact approved
`remoteRepositoryURL` (or its digest after verifying the actual URL), and
the hosted destination. The PR decision, prepared operation, and execution
must all agree on those values. A legacy grant without this destination
cannot authorize a new publication merely because a later observation
supplies a URL; observing URL B never expands consent for URL A. Different
URLs for the same provider repository still require fresh destination-bound
approval. This contract is tested only with isolated fixtures; no remote
publication is performed here. (FR-055, FR-057; T-101, T-103)

A PR hosted at a separately verified push URL must keep that exact URL
through consent, preparation, dispatch and result verification rather than
falling back to the fetch URL. The first PR from a fork can be prepared when
the hosted target and fork source URLs each have independent trusted
repository observations and the user consents to that exact pair; it cannot
require an observation of a PR that has not yet been created. Later PR
observations still verify the actual source and target identity.

A document-only early-draft push cannot use a local fetch-tracking branch
as proof of its destination's base revision, even if the current fetch and
push URLs look identical: the cached ref may predate a URL change. A trusted
hosting-service observation may instead verify the **pair** `{branchRef,
revision}` for the exact destination and checkout: the actual push URL for
a Git-ref push, or the separately approved hosting URL for a PR (not the
source fork's push URL). Preparation, the gate, and dispatch require that
current, unambiguous observation for the intended target branch and commit;
observations older than 60 seconds,
legacy observations without the pair, and newer contradictory observations
cannot establish the base. The local diff uses that verified commit. Fetch
and push URLs may differ only when the push destination itself has this
proof; otherwise use the normal reviewed-candidate path.

**Default branch:** `refs/remotes/<name>/HEAD` is a *local cached ref*.
Changing the remote's URL does not clear it, so it cannot by itself prove
the default branch of the new hosted URL. A helper in `src/git.mjs`
checks the configured full `refs/heads/...` branch or a current provider
observation proving the default branch for the selected remote's **current
fetch URL**. A selected symbolic HEAD is diagnostic unless its captured
source URL and provider evidence prove it still describes that URL; URL
or remote-name changes invalidate that provenance. The helper returns the
validated branch and source, or an explicit unresolved reason. With several
remotes it does not select `origin` or `upstream` by convention; conflicting
applicable sources remain unresolved. `src/gate.mjs`, PR preparation, status
and checks call this helper instead of using
`member.defaultBranch ?? config.defaultBranch`. Existing `origin` repositories
with current proof or explicit configured branches continue to work; stale
cached member values are diagnostic, not authority. (FR-056; T-102)

## 2. Which PR and check did we actually observe?

`src/pr.mjs::adoptPr` remains the public path for observing an existing PR.
For new observations, the adapter supplies:

- the verified local path and URL of the repository **hosting the PR**;
- the source repository URL as well, if it is a fork;
- the hosting-service PR ID and connection;
- full source/target branch refs and exact revisions, state, observation time,
  and evidence reference.

Identical branch names in different hosted repositories do not make those
branches identical. The PR ID plus its verified hosted repository determines
which PR was observed. Updating a PR creates an immutable historical
observation with a next local sequence, including a state-only refresh. The
current observation is the highest committed sequence for that exact PR.
After a causally proven PR creation, an equal-ref fork result is normalized
only against its exact prepared intent, successful operation, and current
trusted source/hosted repository observations. A bare historical PR record
without those identities cannot gain the same credit.
`adoptPr` accepts the current observation ID it read before refresh; a
delayed refresh based on an older ID fails rather than replacing newer facts.
Changed source/target revisions or a proven retargeting keep the older
observation for history but immediately make facts tied to it ineligible.

**Crash behavior:** observing one PR writes one complete observation record.
The record is the commit point; current selection is derived from its
sequence under the existing work-item lock, not from a second mutable pointer.
If writing succeeds but the checkpoint update fails, `resume` sees the record
and reconstructs the checkpoint. A caller must use the current observation
ID and sequence before adding check facts. The existing PR record ID and PR
facts remain readable as historical data, but a legacy record lacking the
verified path/URL and observation ID cannot qualify as a current PR result.
(FR-057; T-103, T-111)

`src/monitors.mjs::associateMonitor` records which exact check result from a
specific producing workflow belongs to the current PR observation. A current
association includes the verified local path and hosted URL, PR observation
ID, required-check definition and **unambiguous result ID** (not display name
alone), tested revision, PR source/target revisions, complete execution
attempt, and the evidence that ties them together. If the provider tested a
generated merge commit, its adapter must prove how that commit relates to
both current PR revisions. A run attached earlier may be associated later
only on exact matches. A new association ID includes all these facts; old
association filenames remain a history lookup, never an alias for current
eligibility.

`src/pr.mjs::updatePrFacts` validates the association against the current PR
observation. `evaluateReadiness` checks it again before declaring a required
check satisfied, including the source/target repository identities, tested
revision or proven merge context, result ID, workflow producer, and execution
attempt. Different checks sharing the same run or display name cannot reuse
one association. Archiving evidence does not by itself turn an invalidated
check into a passing one. (FR-058; T-104)

## 3. Which run and artifact produced the result?

Extend `src/provider-adapters.mjs::validateExecutionIdentity`, preserving
its current `provider`, `connection`, `scopeRef`, `definitionRef`, and
`executionRef` fields. Add an explicit attempt condition:

| What the adapter can prove about this kind of run | Recorded attempt | Can support a new passing check? |
|---|---|---|
| Separate attempts exist and this attempt is known | That attempt's reference | Yes |
| This kind of run has no separate attempts | `not-applicable` | Yes |
| Attempts exist but this one is unknown, or provider capability is unknown | `unknown` | No |

The built-in Azure DevOps **build** adapter can establish the second case;
legacy link-only adapter registrations cannot establish attempt capability.
No code supplies an invented attempt `1`. For historical monitors, a read
helper calculates both old and current keys and searches active/archived
records while holding candidate monitor locks in sorted order. A historical
key is not upgraded to a passing association or allowed to create a second
active poll worker. A new observation needs current proof. (FR-059; T-105)

`src/validation.mjs::recordArtifact` requires the producing execution and
the verified path/URL pair for a **new external artifact**. A supporting
observation names the hosting-service artifact reference, logical name,
source revision, build configuration, and immutable SHA-256 digest or a
hosting-service-verified fixed version. Authenticity (this really is artifact
A) is separate from suitability (artifact A was built from the **current
exact commit** and configuration). Compare the producing full commit ID and
configuration to the selected work-item candidate on admission, artifact
selection, deployment policy, readiness and recovery.
`src/validation.mjs::candidateContentDigest` deliberately ignores commits,
so on A → B with identical files, `startCycle` may reuse local tests but must
invalidate selected external artifacts, deployments, environment test results
and revision-bound PR/check facts tied to A. A's evidence stays in history;
it cannot qualify for B solely because the files match. Recheck the exact
source commit in `src/validation.mjs`, `src/policy.mjs` and recovery paths.
Different artifacts, attempts, paths, URLs or bytes cannot reuse proof; an
old incomplete artifact is history only. (FR-059; T-106)

## 4. What did an external action really do?

`src/operations.mjs::prepareOperation` already records the requested action
before execution. Extend it to record the **intended outcome** from fields
available *before* dispatch (destination, candidate, requested change).
The result returned later has a separate identity (provider run ID, PR ID,
artifact ID, deployment ID, resulting ref/revision, policy version, or
delivery receipt). Do not invent a result ID at preparation time.

To attribute that result to this particular dispatch, use **one of two
supported proofs**:

1. A documented host adapter propagates a unique tool-call ID from dispatch
   to its actual provider-call result. The result identifies the provider
   execution/PR/artifact/deployment and the provider adapter verifies its
   final state; an arbitrary transcript or unverified response is insufficient.
2. When the host cannot prove its call ID, the provider proves an accepted
   request ID or supported idempotency token that was associated with the
   prepared operation and returns the resulting identity.

A provider result matching only the target, commit and content could be from
an **earlier identical attempt**. Record such independently observed state
for diagnostics, but leave this invocation `uncertain` when neither supported
causal link exists.

Trusted host code passes its documented contract and unique call ID directly
to the exported operation-preparation function, outside CLI JSON and hook
payloads. The prepared record keeps only a binding digest. The later
verified result must present that same host call ID; the ordinary offline
CLI cannot create host-call proof from an ID-shaped input.

One validator shared by `op record` and `op reconcile` checks the actual
result against the prepared action. It handles execution submission/completion,
artifact production, deployment, PR create/update (including merge state),
Git ref publication/deletion, policy/configuration change, local test, and
notification delivery. The Requirements' proof table in the Test Plan is
the expected postcondition for each kind; merely submitting a run is not a
successful run, and an empty provider search does not prove no dispatch.
The public action registry, preparation, dispatch and record/reconcile paths
must expose those same artifact-production and notification families. A pure
validator case is not proof that the public workflow can admit the action.
Unproven or partial results remain `uncertain`. `not-started` requires
affirmative non-dispatch evidence bound to the same supported host call ID
recorded at preparation. A terminal result is immutable except for
the exact same normalized evidence on replay. An unresolved matching intended
outcome prevents another managed attempt unless a currently applicable,
appropriately scoped exception explicitly permits it. Neither exception nor
an independent observation retrospectively marks the first attempt successful.
(FR-060; T-107)

Duplicate protection compares the normalized intended outcome after resolving
defaults, not only the caller's original action or tool arguments. Supplying
the same source revision explicitly after previously omitting it cannot
authorize a second attempt while the first remains uncertain. Request
fingerprints still bind exact calls; they do not replace effect identity.
Provider defaults must likewise come from the exact trusted hosted repository
observation before computing operation identity. Omitting that proven provider
and supplying it explicitly are the same effect; conflicting input is not a
new identity and must be rejected.
For older unresolved records without a normalized outcome, use only the
identity facts they actually stored. Unknown historical source/configuration
fields cannot be filled from today's HEAD or remote URL to make a retry look
different. A plausibly matching incomplete predecessor requires reconciliation
or an exact retry exception; unrelated actions remain independent.

The current host hook payload does **not** prove a unique ID for each tool
call. `src/gate.mjs::normalizeHook` must not interpret an ID-shaped field as
proof without a documented host adapter establishing that the ID is unique
and propagated from pre-tool to post-tool callbacks. When supported, compare
session, tool, all normalized arguments, canonical cwd, shell, and that host
ID. Persist only the binding digest and nonsecret metadata, not raw tool
arguments. Without host proof, callbacks can flag uncertainty but cannot
complete a prepared external action. `op reconcile` can use either a proven
host-linked provider-call result or the provider's proven
**dispatch-to-result link**; a separately observed matching state without
either remains uncertain.
Delayed or repeated callbacks cannot complete a newer identical invocation.
The public hook continues to fall through to ordinary host permissions.
(FR-061; T-108)

## 5. How do configured tool adapters avoid hiding arguments?

Keep existing `src/artifacts.mjs::loadConfig` and
`src/gate.mjs::classifyTool`, but validate **the complete argument object**
for a configured direct-tool adapter. Declare required and optional fields
with exact values or explicit type/allowed-value checks; reject unlisted
fields. An effect-bearing argument such as destination either has an exact
allowed value or becomes a checked field in the classified action. Nested
objects/arrays require exact or recursive validation; no implicit coercion.
An old `match` configuration is treated as an exact entire argument object,
not a permissive subset. An omitted declared optional field remains valid.

Evaluate all matching adapters. If they disagree on argument meaning or
action, surface a conflict and leave the call unmanaged instead of choosing
the first. Existing Git, framework, read-only, and destructive classifications
remain authoritative: an adapter cannot disguise them. Shell command
adapters keep their existing exact literal-command contract; a parameterized
shell action needs an explicit parser producing the same checked arguments
and action as a direct tool. Preparation, pre-tool checks, callbacks, and
reconciliation use the same argument normalization. Only proven equivalent
inputs receive equivalent classification. (FR-062; T-109)

## 6. How is evidence stored, checked, and retained?

`src/monitors.mjs::observeMonitor` may accept a short safe inline summary, a
reference to separately stored evidence, or both. Before writing, reject
credential-like fields or URL query keys (including `token`, `sig`,
`signature`, `key`, and `password`), headers, executable content, nested
provider payloads, oversized text, and unsupported paths. Store only the
bounded summary and an evidence reference with retrieval context and
content digest or proven fixed provider version. A mutable URL without
content identity is for diagnosis only, not a passing result.

The **entire on-disk JSON file**, including the newline written by
`src/files.mjs::writeJson`, fits the existing 4 KiB monitor record budget.
Validation and read-back use the same byte count; 4096 bytes remain readable,
4097 fail. Each text field is at most 512 characters. Keep JSON input under
the existing 1 MiB CLI limit; when verifying referenced content, the CLI
accepts a separately provided **read-only evidence file**, checks its exact
path without changing it, reads at most 4 MiB and verifies its SHA-256.
A hosting-service adapter, not a raw byte hash, proves a provider-version
identity. Inaccessible, changed or oversized evidence stays unverified.
(FR-063; T-110)

Cleanup must retain evidence needed for the current PR/check, active or
uncertain external action, terminal notice, audit, or interrupted recovery.
Work-item cleanup must not acquire a monitor lock while already holding a
work-item lock. Instead, discover candidate monitor keys, take their locks
in sorted order, then take the work-item lock and **recheck** dependencies
before removing anything. An associated monitor stays active while a current
PR depends on it; old archived monitors remain readable but cannot silently
regain current eligibility. Check/review facts are invalidated on a real
capability, link, or PR-revision change, not merely because a terminal run was
archived. Simulated concurrent association and cleanup and interrupted writes
must preserve all sole-consumer dependencies. (FR-058, FR-063; T-104, T-110)

Monitoring ownership also resolves proven historical/current execution
identities for every supported provider, not only Azure DevOps. An explicit
known attempt may establish an alias for the same run and attempt; an unknown
attempt or a different connection, scope, definition, run or attempt cannot.
Equivalent keys share the same lock and lease boundary so two workers cannot
poll one execution concurrently. This does not upgrade historical evidence
into passing credit.

Repository and PR observations are immutable history, but not all history
belongs in the active 256 KiB working set. Refresh and cleanup archive
superseded observations and check facts into the existing evidence store.
They retain the current identities and dependencies of active or uncertain
actions, selected artifacts and deployments, associations, notices, audit
records and incomplete recovery. Archival preserves the original bytes and
cannot truncate records or raise the working-set limit to hide exhaustion.
Unlike immutable observations, PR facts may legitimately change under the
same current PR identifier. An archive written before a replacement
observation commits cannot freeze that current identifier permanently.
Historical fact versions therefore preserve their distinct immutable content
identities so later updates and interrupted refreshes cannot overwrite or
conflict with older bytes.

The terminal monitor's 4096-byte record budget must also permit the later
delivery acknowledgment and archival transition. An accepted terminal
record cannot become permanently unacknowledgeable solely because it filled
the earlier record shape. Delivery metadata preserves the verified result
and supports exact replay without duplicating notifications.

Monitor archival checks durable dependencies before requiring live checkout
access. An unrelated completed worktree that was retired or changed branch
cannot prevent an unreferenced monitor from archiving. Relevant active,
uncertain, audit or recovery consumers still retain their evidence; absent
or corrupt dependency records remain explicit gaps, not proof of no consumer.
A present recovery marker remains a barrier regardless of whether its
serialized value is truthy, falsy, or malformed.

## 7. Compatibility, CLI, and error reporting

Old events, operations, PRs, monitors, artifacts and audit references load
without rewriting their bytes. Add optional, validated fields and current
observation records to `src/schemas.mjs`; keep effective event and manifest
schema version 1 until an explicit migration exists. Do not infer new
path/URL, attempt, host-call, or result proof from old `repositoryId`, status
or provider handle alone.

Use the same checked evidence rules at each consumer, but require **only
the prerequisites already possible at that point**:

1. Local tests require the current candidate, Test Plan, and the actual local
   test outcome. They do not require a PR, external artifact or deployment.
2. Artifact admission requires its producing execution, exact commit and build
   configuration, immutable content and verified repository URL. It does
   **not** require a deployment.
3. Deployment **preparation** requires the selected eligible artifact,
   current authorization, candidate and matching environment/target. It
   needs no result that has not happened yet. Deployment **completion**
   additionally requires a causally verified result for this dispatch.
4. DEV/STAGING tests, STAGING handoff, new STAGING-result decisions and
   dependent environment completion/promotion require the complete current
   successful-deployment chain. PR checks apply only where the configured
   policy requires a PR.

Apply these consumer-specific rules both when records are admitted and when
existing records are read:

- `src/store.mjs::recoverResultProjections` cannot repair a legacy result
  into a current pass;
- `src/authority.mjs` test-evidence and stage-completion checks cannot treat
  an old terminal status alone as current proof;
- `src/policy.mjs` PR/artifact/deployment readiness rechecks prerequisites;
- `src/validation.mjs::recordArtifact` checks only its producer and candidate,
  while `recordTest` checks deployment prerequisites for environment tests
  but not local tests, and `stagingHandoff` checks the complete current
  deployment chain;
- `src/decisions.mjs::validateCycleDecision` rechecks the same deployment
  chain before admitting `staging-result` or a dependent environment
  completion/promotion, even if the user receipt and deployment ID match.

Thus an existing `succeeded` deployment with no verified producing
execution, dispatch-to-result link, artifact and exact revision cannot make
a new STAGING test result pass. An old passing record remains history;
fresh evidence proves only the result it actually supports. Interrupted
transactions recover from durable records before preparing another action;
uncertainty never triggers automatic redispatch. (FR-064; T-111)

New hosted execution and environment-test results require the complete
verified provider, connection, scope, execution and attempt identity.
Accepting a run/attempt string while omitting that identity is not a
compatibility path for new evidence. Hosted configuration changes use the
same intended-outcome and causal-result checks as other external mutations;
local configuration changes retain their local classification.

Environment evidence also rechecks the actual selected checkout/hosted URL
pair when admitted and when effective credit is reconstructed. Changing the
selected remote URL without changing HEAD cannot keep the old repository's
artifact, deployment or environment-test credit current. Historical bytes
remain readable, and this external-evidence check does not invalidate
unrelated content-based local test results.

Reuse `pr adopt`, `monitor attach/observe/associate`, `op record/reconcile`,
and `evidence artifact` with the additional checked fields. Add only
`repository observe` to record a hosting-service observation before there is
a PR. Keep the CLI offline, document the complete JSON input and any separate
evidence-file argument, and do not create network clients or publishing
commands. `status`, `resume`, operation and monitor detail, checks and audit
show the actual local path/hosted URL (without credentials), what evidence
is missing, and a safe read-only next step when one exists.

A trusted host can run the same exported command dispatcher in its own Node
process and supply a `Store` factory for the selected Copilot home. The factory
provides hosting-service verifier functions in that process; CLI JSON and
repository configuration cannot load adapter code. The ordinary binary has
no provider verifier and rejects unverified observations. This keeps the
framework offline while allowing a separately installed hosting-service
integration to use the existing evidence commands without adding provider
calls to the framework.

Test results remain `Passed`, `Failed`, or `NotRun`. `Blocked` is a separate
capability/evidence explanation; `uncertain` describes an action, not a test
result. Bound status/resume/check summaries by the existing 256 KiB
working-set limit and point to detail commands when too large. Never echo
raw provider responses, full prompts, or credentials. Keep new names
self-explanatory in code, CLI help, tests and documentation. (FR-065; T-112)

## 8. How we will validate the design

| Concern | Requirements | Planned tests |
|---|---|---|
| Local checkout, hosted URL and default branch | FR-055, FR-056 | T-101, T-102 |
| Current PR and exact check result | FR-057, FR-058 | T-103, T-104 |
| Execution attempts and artifact provenance | FR-059 | T-105, T-106 |
| Uncertain external actions and host callbacks | FR-060, FR-061 | T-107, T-108 |
| Complete tool arguments and safe evidence | FR-062, FR-063 | T-109, T-110 |
| Old history and clear CLI output | FR-064, FR-065 | T-111, T-112 |
| Integrated, regression and native coverage | FR-055 to FR-065 | T-113 to T-115 |
| Independent review and built-in candidate review | FR-055 to FR-065 | T-116, T-117 |

Implementation should add unit cases first, then integration and recovery
cases, and rerun the full unit-first checkpoint after every fix. Run
`npm test` and `npm run check` from the repository; the Test Plan specifies
the focused and native Windows commands. Native launcher checks need their
recorded Go 1.27.1 prerequisite; missing capability remains `NotRun` with
a separate blocker. Use fixture-owned homes and repositories only.

The Technical Design must receive an independent GPT-6 Astra xhigh review
with no blocking findings before Coding is proposed. Only a further captured
user authorization can advance managed lifecycle state to Coding. Passing
local checks or a review never grants remote permissions.
