# Test Plan: Public repository readiness

Test strategy: 2026-10-20 testing-policy and professional-structure revision.
Current projections are recorded in the case table's Status/Evidence columns;
verified execution records, not this header, establish passing credit.

**Current maintenance context:** The historical Draft label predates the
subsequent explicit Coding approval in
[Requirements](requirements.md). This remains the one living Test Plan.
Its preserved pre-maintenance baseline SHA-256 is
`47d4d60e8497a69b55881a926da3797c20fbcb3336fd87e31d9f70ea993dfa9c`.
The earlier plan contained **96** canonical cases with a broad **69-local /
27-hosted** placement. Those counts are historical, not the new local gate.
The current **99-case** revision preserves those 96 identities and adds the
independent calculator, structural regression and reference/public-experience
cases. It separates a finite local sanity profile from exhaustive required
PR automation and separately authorized acceptance procedures. Authored
assertions and earlier component results do not validate a later candidate.
Native and public-consumer proof must come from their actual declared hosts.
Do not run candidate-bound validation while concurrent owner slices mutate;
the coordinator freezes source and performs the required unit-first checkpoint.
For T-PRD050, the owner explicitly authorized enabling GitHub private
vulnerability reporting on 2026-10-20. The setting was enabled and a subsequent
API read returned `enabled: true`. The earlier disabled observation remains
historical. No report was submitted; setting readback alone does not complete
the newcomer walkthrough or change T-PRD050 from NotRun.

## 1. Scope and execution status

This is the one living Test Plan for `wi-public-readiness`, artifact
`primary:public-readiness`. It implements the quality gate for
[FR-200 through FR-215](requirements.md), not a second requirements document.
The approved Requirements baseline is SHA-256
`8311068e1a75ba4e08fda5331f24baf99f47db06cd86743666aa0f49d985cdea`.

Cases begin **NotRun**; their current projections are maintained in the table.
Procedures, proposed test selectors, old 0.4.0
reports and valid document syntax are not execution
evidence for the future implementation. Existing failures and passes remain
historical. Record subsequent actual outcomes through the framework's supported
evidence mechanism; do not replace it with this document or a session-local log.

The case table is the canonical specification/status table. Reference tables,
commands and inventories below describe prerequisites or assertions, not extra
passing cases. Each platform-suffixed case is an independent required case.

## 2. Execution model and ordering

### 2.1 Test execution stages

The framework's existing `local` environment field means project validation
rather than an application DEV/STAGING deployment. The **Location** column
identifies the actual execution host; a GitHub job is never represented as
having run on the developer's machine. Production publication remains a
separately authorized external operation, not a local test.

| Test stage | Execution contract | Admission and completion rule |
| --- | --- | --- |
| Local critical validation | Agent executes only the finite canonical sanity units first, then the explicit critical integration selection and cheap applicable static/document checks. Targeted/affected runs are optional additional development commands, not automatic gate expansion. | Matching passing evidence completes this sanity profile only. Exhaustive feature, stress, platform, PR and public-consumer results are not local prerequisites. |
| PR validation | Provider executes the full applicable Linux, Windows x64, macOS arm64 and macOS Intel matrix, then an always-evaluated stable completeness gate. | All required case/platform variants must be present and Passed for the current PR candidate. Contributors need no local evidence to open a PR. |
| Release prepublication validation | Provider performs authorized release preflight, packaging, native validation and evidence admission. | Publication requires current passing evidence for every required prepublication case and the exact frozen artifact identities. |
| Postpublication validation | Provider verifies actual publication, anonymous downloads and clean native consumers. | Overall release completion requires all required publication and consumer evidence. A partial publication is not rolled back or called complete. |
| DEV / STAGING | Not applicable to the current repository-readiness increment. | This plan authorizes no application deployment or live DEV/STAGING tests. Add an explicit environment contract and separately approved cases if that scope changes. |

#### 2.1.1 Explicit gate membership

Apply the following closed case sets; a generic checkpoint value is not a
sufficient selector for a release gate. The full underlying regression inventory in
section 3 remains required within the applicable native execution cases.

| Gate/profile | Required canonical cases | Evaluated outcome |
| --- | --- | --- |
| L - local critical validation | Exactly the three canonical unit files and eleven exact critical root selectors in section 3.1, with their declared descendants, plus cheap applicable static/document checks. | Required finite sanity evidence only. A section 5 case's level, historical local placement or pre-review checkpoint does not add it to L. Optional affected execution is reported separately. |
| PR - ordinary contribution validation | T-PRD014-LX, T-PRD014-WX, T-PRD014-MA, T-PRD014-MI, T-PRD060-MA, T-PRD060-MI and T-PRD087; T-PRD019 evaluates complete underlying framework and independently namespaced project results. All applicable executable section 5 regression assertions, including structural T-PRD088 and L's sanity assertions, execute here. | Required current PR validation independently of local results. This repository also requires its independent coverage-metadata check. No gate requires its own output, provider-administration probe or later release acceptance. |
| R-PRE - authorized release prepublication | Fresh T-PRD079-LX, T-PRD079-WX, T-PRD079-MA and T-PRD079-MI for this release attempt, plus exact release preflight. | Ready to publish the frozen artifacts only when the complete underlying prepublication inventory passes. |
| R-POST - actual release completion | T-PRD038-WX, T-PRD038-MA, T-PRD038-MI, T-PRD039-WX, T-PRD039-MA, T-PRD039-MI and T-PRD042, plus confirmed exact npm/GitHub publication effects. | Release complete after R-PRE and publication. Missing or failed public consumers/provenance leave completion non-passing and preserve partial publication state. |
| A - acceptance of this readiness implementation | T-PRD012, T-PRD025, T-PRD026, T-PRD050, T-PRD053, T-PRD055, T-PRD056, T-PRD074, T-PRD081, T-PRD086 and T-PRD089. | Required evidence for accepting the readiness implementation and reporting public readiness. These observe actual public routes, controlled policy probes, benchmarks and completed flows, not inputs requiring a production gate's own future output. |

The old broad local gate is intentionally replaced, not renamed. The critical
runner must not select every local/pre-review planned case, every unit test or
newly added regression. Its explicit membership is independent of exhaustive
logical case bindings. Section 5's historical development-machine locations
have been updated to the actual required provider/PR host and checkpoint;
their optional local reproduction does not add L obligations. The authentic
provenance fixture, native/toolchain requirements and public-route observations
have their required capable PR or acceptance location specified separately.

Critical `.sequence.json` identifies the finite `automated-local-critical`
profile and its exact assertion denominator. A passing completed profile can
complete L without pretending the exhaustive old 69 cases ran. It does not
complete PR, A, publication or release acceptance. Preserve old sequence/evidence
versions as historical; an old broad denominator is not silently reinterpreted
as passing evidence for this selection. Required procedures retain actual
mode, owner, location and NotRun status at their own checkpoint, not as a hidden
prerequisite that makes every ordinary local sanity result incomplete.
Logical alias sets must remain unit-to-unit or integration-to-integration;
cross-level aliases and integration aliases on canonical unit files are rejected.
This is the current correction policy, not retrospective credit for the earlier
candidate's permissive scheduling. Unit completion cannot satisfy unresolved
integration stage-order obligations.
Selected-name/per-file resource declarations include exact worker count,
optional names, owner and reason. Two-worker callbacks reserve both tokens
before their deadlines begin; missing aggregate allocation cannot be called
successful overlap. Resource matching is part of source/configuration evidence.

Runner-fixture assertion failures retain bounded structured diagnostics instead
of embedding raw subprocess output or inline programs in assertion messages.
Preserve expected/observed exit codes or missing-summary identity, sanitized
primary error lines and the exact original stdout/stderr hashes and byte counts.
Full streams retain only those identities. Revalidate bounded primary messages
after truncation so a cut JSON value cannot invalidate the complete diagnostic;
an unretainable message keeps its original identity and an explicit safe fallback.
Diagnostic recovery cannot change cancellation, cleanup or passing conditions.
Periodic worker reports and native command capture use the same bounded atomic
replacement recovery for classified transient Windows sharing conflicts.
The Windows-only periodic-checkpoint regression injects one conflict while the
real worker is silently blocked, then requires a durable refreshed lease,
live processes, exact journal identity and the original kill/cleanup assertions.
Permanent or unclassified replacement failures remain incomplete and non-passing.
Mutable checkpoint polling uses same-turn synchronous reads on Windows; a
retained checkpoint error fails rather than masquerading as a live observation.
The owned-process tests bind held original creation identities before releasing
ready workers and require kernel exit before each immutable producer-close
boundary. Same-identity survival, unknown or mismatched ownership, late exit and
same-millisecond ambiguity remain non-passing. The sibling-capacity root keeps
a real independent broker producer active during every owned-file exit check;
no later global close or wait-until-gone result substitutes for that boundary.
These Windows fixture corrections preserve all assertions and deadlines, introduce no
production cleanup/retry change and do not prove the original CI reused a PID.
The POSIX tool-cancellation root retains its strict original process assertion.
Before cancellation, record owned self-ready identities and a bounded exact-PID
state/start observation; only a strict failure triggers a timestamped later
diagnostic query. Retain the original error even if diagnostics fail. Later
absence or zombie state is not evidence of exit at the original return boundary,
and one-second creation matches do not exclude same-second PID reuse.
Observer artifact readers finish before their exact owned scratch directory is
removed. Use the existing bounded filesystem-cleanup retry policy for classified
transient sharing conflicts; persistent removal failure remains an error, never
successful cleanup or permission to remove another directory.
Owned process fixtures observe ready/trigger/finish markers rather than relying
on filesystem notifications that may coalesce. Launcher fixtures await both the
real child result and input-stream completion: an early rejecting child's exit
and stderr remain primary, while an input failure alone cannot pass a successful
child. Keep every existing signal, cleanup, output-identity and deadline assertion.
Readiness markers are published atomically; malformed JSON is not an initializing
state to ignore or retry. The controlled pruning race creates its association
while a real work-item lock is held, then lets the pruning promise finish,
including durable archival and lock release, before the queued real transaction
begins acquisition. Retain owner bytes at the held boundary and exact archived
observation bytes. Its stale-dependency assertion must not depend on association
setup or archival finishing within the unchanged lock-wait budget.
Both alias-attach/archive race variants hold the real monitor owner at an
observable Store boundary, require concurrent attach to reject with `LOCK_BUSY`
without changing owner or active bytes, then release and await archival before
the next attach. Preserve exactly one immutable history record and every
current-first/historical-first identity and readability assertion. This is
causal ordering, not a longer acquisition deadline or retry-until-success.
Receipt-race fixtures hold a real winning acknowledgment write, require bounded
`LOCK_BUSY` refusal without changing delivery, pending-notice or active bytes,
then release and await the owner before exact committed replay or semantic
refusal checks. Preserve the full 4096-byte proof, one delivery identity,
no additional notice, conflict/stale refusals and archive/prune assertions.
Production lock acquisition and its original budget remain unchanged.

Local test results are not inputs required from an external contributor merely
to open a PR. PR jobs never
perform A's permission-requiring disposable-PR/ref probes or publication.

The separate `framework/coverage` guardrail is this repository's PR policy only.
It validates the actual current PR-description section against canonical
definitions, independently of whether execution tests passed. T-PRD085 tests
the checker locally and T-PRD086 observes authorized live enforcement; neither
is an input requiring its own completed result before the checker can run.
Other consumer projects are not automatically assigned this guardrail.

R-PRE native cases consume the same frozen release-candidate payload and shared
Mac archive, before those bytes are public. R-POST cases subsequently download
and exercise those exact published bytes. An earlier PR success, another release,
local mock or a completed A observation cannot substitute for an R-PRE case.
No cross-profile execution reuse is planned. R-PRE executes freshly for the
current authorized logical release intent, bound to one source/version/
destination/configuration and frozen candidate. Physical provider run/job/
attempt identities remain attached to their original executions.

Retrying only failed publication/readback under that same logical intent may
consume its original R-PRE evidence when source/specification/configuration/
artifact and independently verified native-producer conditions are unchanged
and the evidence is at most 24 hours old. This does not claim the tests reran in
the retry's physical provider attempt. A new logical release, changed inputs,
expired proof or another profile requires fresh applicable validation against
the saved candidate; it never permits repacking a replacement under the same
release identity. Neither branch names nor a prior green summary proves reuse.

Audit/report construction has no self-dependency: T-PRD055 observes the completed
R-PRE/publication/R-POST sequence, and T-PRD056/T-PRD074 inspect its retained
records afterwards. Their own results are not part of that sequence's input
denominator. All A cases must nevertheless pass before this increment is accepted;
excluding them from production gate inputs does not waive their acceptance.

After a change affecting tested behavior, fixtures or configuration, restart
the finite local sequence from its canonical unit selection, then its explicit
critical integration and cheap applicable static checks. Run focused regression
commands when needed to develop a fix, without adding them permanently to L.
Complete full required PR/release tests at their own execution stages;
do not reintroduce an entire multi-platform hosted suite as a local prerequisite.
A candidate identity policy that requires broader invalidation takes precedence;
unknown impact invalidates affected current credit rather than guessing reuse.

### 2.2 Hosts and prerequisites

| Location used in cases | Actual prerequisites and required proof |
| --- | --- |
| development-machine | Native host Node >=22, Git, owned scratch outside any Git ancestor for non-Git fixtures, isolated HOME/COPILOT_HOME/cache/config. Current reference host is Windows x64. Do not touch the real installed framework or its live runtime. |
| github-linux-x64 | `ubuntu-24.04`, Ubuntu 24.04 x86_64, Node 24.20.0 x64; the selected Go/Python/schema versions below. Git and shell image identities are captured before admission. A separate mandatory Node 22.23.3 sanity/static job preserves minimum-runtime compatibility coverage. |
| github-windows-x64 | `windows-2022`, Windows Server 2022 AMD64, Node 24.20.0 x64, Windows PowerShell 5.1 and native cmd; Go/Python below, independently verified real PE launcher and required launcher environment inputs. |
| github-macos-arm64 | `macos-15`, macOS 15 arm64, Node 24.20.0 arm64, native machine/translation probes, system Bash and zsh, the exact Homebrew/Ruby/core snapshot below. Only its new, verified job-owned short prefix may be mutated; no existing global prefix is adopted or cleaned. |
| github-macos-x64 | `macos-15-intel`, macOS 15 x86_64, Node 24.20.0 x64, native machine probes, system Bash and zsh, the same pinned Homebrew/Ruby/core snapshot. No Rosetta substitution. |
| github-pr-matrix | All four native validation hosts above; each expected job/shard has independently verified source, workflow, run and attempt identity. |
| github-release | Exact approved source/version/destination, retained frozen artifacts, authorized release start, required provider permissions/trusted publisher configuration, and all three native consumer hosts. |
| provider-policy | Read-only access to effective GitHub rules/checks/reviews. Any write, disposable PR/ref or enforcement probe requires separate scope and consent before dispatch. |
| clean-consumer | An independently provisioned temporary consumer workspace/home with no origin session or cache; only declared artifact references, public interfaces and trusted evidence retrieval are available. |

The validation toolchain baseline is fixed here. Provisioning must enforce these
versions and verify their identities, not silently select a different version set.

| Tool/input | Required selected version/identity | Case assignment |
| --- | --- | --- |
| Test/consumer Node | 24.20.0, native x64 or arm64 as declared above. Current role-capability PR framework producers use the pinned Actions runtime; genuine Homebrew and full/R-PRE cases retain the pinned Homebrew runtime. This is the newest supported LTS release whose selected Homebrew snapshot has the complete ARM/Intel bottle closure, not the newest upstream patch. | T-PRD014 variants, T-PRD038/039 variants, T-PRD060 variants and T-PRD079 variants; all underlying Node assertions. |
| Minimum supported Node | 22.23.3 on the separate mandatory Linux compatibility job, executing the unchanged 27-assertion sanity selection and static checks. | Product support remains Node >=22. This compatibility result does not substitute for any full native lane or expand the local critical profile. |
| Local reference Node | Current recorded Windows x64 reference is 25.6.1. This historical developer-host installation is not the selected hosted LTS baseline and is not modified by this work. | L and comparable baseline/candidate runs. Do not compare timings across these runtime versions as a speedup. |
| Go | 1.27.1 with `GOTOOLCHAIN=local`, `CGO_ENABLED=0`, repository build flags and controlled caches; Windows target `windows/amd64`, `GOAMD64=v1`. | T-PRD015, T-PRD014/079-WX and applicable shared Go assertions on other lanes; `cmd/sdlc-launcher/go.mod` and `packaging/winget/toolchain.json` must agree. |
| Schema Python | CPython 3.12.10, with native x64/arm64 distributions as applicable. This is the cross-platform validation baseline, not a shipped framework runtime. | T-PRD015 and the applicable schema/manifest assertions within T-PRD014/079 variants. |
| Schema packages | attrs 25.4.0; jsonschema 4.26.0; jsonschema-specifications 2025.9.1; PyYAML 6.0.3; referencing 0.37.0; rpds-py 0.30.0; typing_extensions 4.15.0. | Actual Python schema validator; match `.github/release-requirements.txt`, not floating package resolution. |
| WinGet schema | Manifest 1.10.0 at upstream commit `5b62860167520b1503b3880d5a026809eb07c6f4`, with all three SHA-256 pins in `packaging/winget/schema-lock.json`. | T-PRD015, native/cross manifest assertions and Windows consumers; local schema validity is not community acceptance. |
| Homebrew/Ruby/core | Homebrew commit `99fd9a8eed4ff942c448da0c1f11156302441e4a`, its native portable Ruby 4.0.7, and core commit `0bae42d6d1e59c2c400da252bd64e585e3fe7d58`. Disable API formula installation and auto-update so all dependencies come from that immutable core snapshot. | V4 PR framework Mac bodies retain real pinned Brew/core/Ruby and their own prefix cleanup, without a redundant Node pour; units and refresh have source-bound nonallocation diagnostics. Historical v3/v2/null retain their original real prefix obligations. Genuine Homebrew, full/R-PRE, T-PRD039-MA/MI and actual audit/style/lifecycle cases require real `node@24` 24.20.0, complete native bottle plans, actual poured receipts and runtime identity. |
| Publishing runtime/tooling | Node 24.22.0 x64 and npm CLI 11.16.0, using the existing integrity-pinned CLI-tooling identity, token-free configuration and exact-caller checks. | T-PRD028/031/033 and the actual authorized publisher operation; test consumers remain on their separate Node baseline. No runtime or token fallback is admitted. |

The historical source-selected `native-bootstrap-role-capabilities-v3` refresh-only
producer retains pinned native Actions Node, Git and its real Mac
Homebrew/core/portable-Ruby prefix and cleanup, but does not provision or report
unused Go, CPython or schema packages. Its complete causal refresh root remains
unchanged. All other roles and historical v2/null declarations retain their
actual pinned tool/report requirements. Controlled command callbacks and SDK
capture/replay/admission cases must reject forged omissions and invented
absent-tool facts without fabricating passing reports. These additional
T-PRD015 assertions remain PR-only; the finite critical budget stays 27.

The distinct source-selected `native-bootstrap-role-capabilities-v4` keeps pinned
native CPython runtime on every unit role, including Intel `units-1`, but omits
unused Go, Python schema packages and Mac Brew/core/Ruby/prefix setup there.
Refresh also omits unused Brew/prefix setup. All bodies, genuine Homebrew,
whole/full and R-PRE retain their complete tool requirements. Preserve all
twenty-five origins and all selected assertions, including the real Python
consumer and unchanged refresh/exhaustion boundaries.

Require thirteen Mac cleanup diagnostic artifacts: eight independent real
allocations/removal receipts (six bodies plus two genuine Homebrew producers)
and five exact role/source/run-bound nonallocation requests without prefix facts
or allocation/removal receipts. Never mark an omitted resource Passed. Controlled
callbacks and source capture/replay/protected admission must reject missing
required Python, nonboolean or unknown capability flags, role downgrades,
invented omitted tools/schema/prefixes and borrowed ownership. Replay v3/v2/null
with their original digest shapes and real-owner counts; v4 does not retroactively
relax their requirements. No hosted timing improvement is established by local
controlled tests.

The separate source-selected `native-bootstrap-role-capabilities-v5` omits
Go/schema setup from framework bodies without the real Go/schema or native
launcher roots; all real Go tests, vet, native execution and independent
cold-cache rebuild assertions remain intact. Linux/Windows `body-3` omits
CPython; other current bodies retain runtime-only CPython except the real schema
body. All framework Mac bodies omit unused Brew/core/Ruby/prefix setup. Genuine
Homebrew omits independent Go/CPython/schema SDK setup but preserves pinned
Brew/core/Ruby, the complete native Node bottle closure, real audit/style,
previous/current lifecycle and cleanup. Whole/full and R-PRE are unchanged.
Source-selected closures, not a hardcoded platform ordering, determine body
requirements. Current unit partitions still require Python: Intel main contains
actual observer-reader consumers independently of the producer on `units-1`.
Unknown use remains required.

V5 requires two distinct genuine Mac allocations/removal receipts and eleven
exact nonallocation proofs, retaining thirteen diagnostic artifacts/steps,
twenty-five origins and all twenty-three framework origins. Extend the existing
PR-only T-PRD015/021 controlled tests for exact SDK dispatch, absent facts,
borrowed/forged prefix rejection, workflow source-derived setup, source capture,
component composition and replay. Preserve the complete original assertion
ID/applicability union, all shard v1–v4 topologies, v4's eight real owners and
v3/v2/null requirements and digest shapes. The canonical local budget remains
27. Actual CPython-reader/native execution and native speedup are NotRun until
capable PR execution; safe local controlled tests provide no native pass.
The genuine-bootstrap regression executes the actual provisioning function with
isolated command/filesystem boundaries for both Mac architectures. Require
capability/runtime facts, bottle planning before installation, retained receipts
and runtime probing, then apply the unchanged source-bound admission check.
This controlled dispatch test neither acquires Homebrew nor supplies native
acceptance evidence.
Component-selection digest reuse is confined to one synchronous call with the
same definition and lane inputs. Preserve byte-identical selection, projection
and protected replay across current and historical protocols, distinct per-case
fields and fresh digests when inputs change. Empty/invalid definitions retain
their original rejection and guard ordering. No cross-call identity, verdict or
source cache is introduced; local function timing is not native lane proof.

The Node/Python native distributions above were checked against the public
`actions/node-versions` and `actions/python-versions` manifests during Test Design;
the Ruby version is declared by the pinned Homebrew commit. Availability metadata
is not proof of execution or a substitute for download integrity validation.
If a pin is unavailable, incompatible or fails required security policy, record a
blocked prerequisite and revise the plan explicitly; do not silently take latest.

The earlier Node 22 Intel Homebrew prerequisite was **blocked**: the observed
[core snapshot](https://github.com/Homebrew/homebrew-core/blob/d02b8762f4a29859c47a635a0d2683223fea9812/Formula/n/node%4022.rb)
has no Intel macOS Node 22.23.3 bottle; the original same-version snapshot also
lacks one. The retained cancelled attempt demonstrates lengthy dependency
source builds, not native test completion. Bounded eligibility/install guards
prevent another silent hour-long bootstrap but do not supply that capability.
A proposed source-build strategy was not executed. These original failures
remain historical; the revised baseline does not relabel them as passing.

The subsequent explicit user direction selects a newer suitable Node release
and resolves the complete bottle set. The
[selected core snapshot](https://github.com/Homebrew/homebrew-core/blob/0bae42d6d1e59c2c400da252bd64e585e3fe7d58/Formula/n/node%4024.rb)
contains Node 24.20.0 and 17 required runtime dependency formulas, including
OpenSSL 3.6.3. All 35 distinct ARM/Intel bottle archives returned HTTP 200 to
read-only HEAD requests with matching registry digest headers; all 18 OCI indexes
match the frozen formula declarations. This establishes availability, not
download integrity, binary relocation, ABI compatibility or passing native tests.
The Node Intel bottle targets Sonoma; actual operation on the required macOS 15
runner remains mandatory.

Node and OpenSSL have fixed-cellar bottles. The pinned Homebrew relocation
algorithm permits a new `/opt/<fivehex>` prefix of exactly 10 bytes and its
17-byte Cellar; the original long checkout prefix is ineligible. Only a newly
allocated, literal, job-bound directory with matching ownership records may be
used. Keep those records under the checkout, verify them before lifecycle
mutation and cleanup, and use privileged removal only for that exact empty
directory after its owned contents are removed. Never adopt the global/default
prefix, force an incompatible bottle, create a synthetic keg or compile a silent
fallback. Native relocation and execution remain NotRun until the revised
candidate actually passes both Mac lanes.

GitHub's standard labels select an OS image family, not an immutable VM image
release. This plan does not pretend `macos-15` pins a selectable `ImageVersion`.
At execution, retain exact `ImageOS`/`ImageVersion`, OS build, architecture, Git,
Bash/zsh, PowerShell/cmd build, executable paths and selected tool versions.
Those exact bootstrap/image identities are required evidence inputs; differing
images/tools cannot share reusable execution credit. The declared OS family and
fixed selected-tool versions must match before admitting a lane. Documented
runner labels are capability inputs, not proof a job ran.
Missing required capabilities leave the case NotRun/Blocked and the gate
non-passing; never change OS, corporate IT, IAM or package-manager security policy.

There is currently no validated native Windows per-process network-and-npm
filesystem-denial adapter. Do not claim a Windows network-denial pass from the
ordinary installer tests. Inventory that distinct assertion and its applicability
before execution; a required assertion lacking a supported approved adapter is
blocked, not silently skipped or replaced by a proxy/firewall change.

The Mac npm-denied installer fixture retains bounded sanitized stdout, stderr,
exit/signal and phase diagnostics on failure. Diagnostic failure must not replace
the original installer or parse error; successful execution must not fabricate
failure records. This evidence does not waive network/npm denial, any lifecycle
assertion or a failed native result. Controlled local helper tests do not
establish actual Mac sandbox or installer acceptance.

### 2.3 Test modes and shared procedure contracts

All executable code cases are automated, including provider-owned jobs.
T-PRD050 and T-PRD089 are semi-automated agent walkthroughs of actual public
routes and primary-reference/adoption evidence against explicit checklists.
Their automation supports, but cannot replace, inspecting real destinations and
evaluating the applicability of a practice. The agent records observed results,
not a subjective "looks professional" pass. No manual-only test is planned: no current case
requires a person to execute commands the authorized agent/provider can run.
Consent required for live publication, provider-setting changes or destructive
fixture operations is an execution prerequisite, not a passing test outcome.

Each row inherits the applicable procedure below in addition to its explicit
steps/assertions:

- **F - isolated fixture:** create a unique repository, home and temp/cache/config
  root; seed preservation sentinels; invoke the public boundary; assert actual
  state, output and exits; await processes; remove only that exact owned root and
  verify cleanup. Inject clocks/controlled boundaries instead of arbitrary sleeps.
- **N - native lifecycle:** authenticate only to retrieve saved private CI
  evidence where necessary, then compare external pins and inventory before
  extracting/executing the candidate. Use an isolated native home/prefix. Install,
  doctor, idempotent update, prior-version upgrade, hooks, ordinary uninstall and
  explicit fixture-only migration/purge must each assert version and preserved
  unrelated files. Ordinary update/uninstall preserve runtime; explicit purge
  intentionally removes it. The verified new package's updater upgrades a
  genuinely established old installation; do not require an arbitrary old
  updater to parse a future package layout. Retain independent per-step results.
- **P - provider observation:** prepare the exact approved operation if any,
  record dispatching before one call, retain the actual handle and reconcile
  uncertainty before retry. Observe steps/results from the provider. Verify the
  exact accessible human run/attempt page independently of status polling.
  Live runs get 60-second monitoring; report any host interruption/gap.
- **E - evidence admission:** generate real normalized execution evidence through
  the selected producer/public framework interface; independently establish
  candidate/spec/configuration/host/artifact identities; assert current credit
  and immutable history. A deliberately rejected invalid fixture is a passing
  negative test, not passing evidence for the rejected synthetic execution.
- **D - document/protocol check:** check authoritative files, links, anchors,
  schema, commands or rendered output; include an isolated corrupt/missing input
  proving the check fails. Do not mutate the real approved specifications or
  immutable release to create a negative case.

## 3. Local critical selection and complete hosted regression

### 3.1 Closed local sanity membership

The existing canonical fast selection remains these three complete files:

```text
npm run test:unit
test/provider-observations.unit.test.mjs
test/execution-artifact-identity.test.mjs
test/tool-adapters.test.mjs
```

Run the following **additional critical selectors** locally, after unit cases,
through `node scripts/test-runner.mjs targeted --name "<exact name>" <file>`.
These are existing actual test names, not labels invented for this plan:

| File | Exact critical case name |
| --- | --- |
| test/storage.test.mjs | T-16 canonical data, atomic replacement, and deterministic write-boundary failures preserve old/new state |
| test/storage.test.mjs | T-16 old live locks are never stolen; concurrent revision updates serialize |
| test/storage.test.mjs | T-19 bindings resolve linked worktrees and refuse stale branch authority |
| test/storage.test.mjs | T-23 symlink escapes and unsafe identifiers are rejected |
| test/advisory-gate.test.mjs | T-41 command-hook launcher fails open for malformed input and import failure |
| test/advisory-gate.test.mjs | T-41 unmanaged tool execution invalidates stale candidate evidence when files changed |
| test/cli-install.test.mjs | T-23 install/update/uninstall preserve user files, paths with spaces, modified assets and runtime |
| test/cli-install.test.mjs | T-23 partial installation rolls back only its own unchanged writes |
| test/current-evidence.test.mjs | publication consent for hosted URL A cannot authorize URL B from the same checkout |
| test/test-runner.test.mjs | T-130 public runner preserves a real failing child and still executes the passing sibling |
| test/test-runner.test.mjs | T-GHB24 native execution evidence distinguishes passing, failing and skipped assertions without overwriting reports |

The CLI name filter is a regular expression: escape names and combine related
selectors in one invocation rather than rerunning common fixtures for each row.
The three canonical files contain the existing sixteen sanity assertions; the
table adds eleven root selectors. The fixed budget is sixteen canonical
assertions plus eleven critical roots: **27 root checks and at most 27 total
assertions**, including all declared descendants. Report both counts; adding
even a descendant beyond this limit requires an explicit reviewed budget and
rationale change, not automatic relearning from changed source. The existing
installation selector exercises actual CLI
installation in owned homes; storage/authority/evidence/runner selections provide
representative system-working coverage rather than an exhaustive failure matrix.

New section 5 tests are PR-required by default, not automatically critical.
Adding a unit file, a pre-review logical binding or an affected regression must
not change this selection. Optional targeted/affected execution is appropriate
while implementing or diagnosing a change and retains its own result identity;
it is not the default post-fix gate. `npm run check` and cheap applicable
document checks accompany L. Packaging, stress and exhaustive failure-matrix
execution belong to required capable PR groups; local full/coverage runs stay
explicit opt-in. No dependency restore is needed without changed metadata or
an observed missing-tool failure.

The source-bound finite producer specification uses the explicit
`T-LOCAL-REGRESSIONS` SDK profile case to require all selected sanity assertions.
This is a separate execution layer, not another canonical readiness-acceptance
case or a pass for the exhaustive component tests below. Optional extra work is
retained as `T-LOCAL-AFFECTED` and cannot alter that base denominator. Joined
reports distinguish the 27 underlying L assertions from the 99 canonical cases:
76 required PR cases, 4 R-PRE, 7 R-POST, 11 A and observer T-PRD019. Component
cases need their actual complete source-bound PR observations, not credit
borrowed from an outer native-lane green result.

This critical set is deliberately not constrained by the advisory 30-second
fast-loop or 2-minute affected-loop targets. Observe runtime; retain critical
assertions even when slower. Preserve optional `npm test`/`test:full` and
`test:coverage`; they do not become a contributor prerequisite for opening a PR.

#### 3.1.1 Explicit original T-PRD013 preservation bindings

In addition to fingerprint/stress-membership checks, the source declaration
binds these original behavioral integration selectors across files:

| File | Exact original selector |
| --- | --- |
| test/storage.test.mjs | T-16 canonical data, atomic replacement, and deterministic write-boundary failures preserve old/new state |
| test/storage.test.mjs | T-16 old live locks are never stolen; concurrent revision updates serialize |
| test/observation-retention-regression.test.mjs | FR-063/064 pruneWork alone archives released historical observations and facts without another refresh |
| test/observation-retention-regression.test.mjs | FR-063 deterministic prune/refresh race rechecks dependencies under the work-item lock |
| test/observation-retention-regression.test.mjs | FR-063/064 a replacement-write interruption at 262044 bytes remains loadable and prunable |

Each declared selector includes its actual file and exact parent chain. Full
catalog compilation resolves these bindings or rejects stale/duplicate/
ambiguous references before dispatch; a source fragment alone reports that
catalog resolution is required, not phantom coverage. Existing T-16 critical
selection overlaps execute once. The three specific retention roots are real
required behavior, not a replacement mock/fingerprint. The causally ordered
550-refresh stress scenario remains unchanged in full native/directly affected
coverage and is not silently pulled into every routine local critical run.
The PR-only retention-fixture regression observes actual child-process dispatch:
unchanged fixture reads reuse the existing cache, while a real commit, remote
change and same-commit branch switch invalidate it. All ordered refreshes,
storage operations and assertions remain real; production Git reads stay fresh.
The PR-only repeated-summary-text regression preserves exact sanitized results
while observing one pure text transformation per traversal and a fresh scan on
the next call. High-cardinality and oversized text still receives full
sanitization when the temporary reuse budget is exhausted.
The literal-text regression checks scanner bypass only for ASCII letters,
digits and spaces; sensitive-key redaction, rich-text fallback and the original
payload byte limit remain enforced.
The JWT-header regression observes avoided JSON parses for decoded non-object
candidates while retaining real object headers with JSON whitespace, exact
redaction digests, malformed-object handling and conservative overlong headers.
Manifest-binding PR regressions cover an unborn repository becoming committed,
a same-commit branch switch and a controlled switch after all canonical-path
checks. The binding-only guard still reads fresh paths and the current branch;
the separate full-identity regressions keep their revision and fallback checks.
Remote-selection PR regressions retain current fetch/push URLs, unborn-to-commit
transitions, same-commit branch rejection, a branch switch during canonical-path
checks and linked/detached-worktree guards without querying an unused revision.
Frozen-launcher setup regressions require matching source and byte identities,
owned regular paths and a separate writable copy, rejecting changed inputs
without a compiler fallback. Exercise the real public runner and isolated
worker boundary: fixture provenance survives while all reporter control
variables remain isolated, and reporter context alone cannot supply it.
The actual pinned Go tests/vet, native launcher
execution and two independent cold-cache rebuilds stay required on capable PR
runners; only setup-only consumers reuse the verified frozen candidate.
The existing PR-only purge/live-lock regression populates the real owner file
deterministically during its bounded read rather than relying on a short sleep.
Concurrent changes must remain `LOCK_BUSY`, with owner bytes, live exclusion
and runtime content preserved.
Pure-text reuse regressions retain fresh origin-verifier calls, expiry and
mutation checks, secret-key behavior and all byte/node limits; reuse ends at
the sanitization call boundary. Shared-order regressions verify the measured
observer tail is scheduled early for implicit hosted selection and actual
dispatch without changing explicit targeted order or the selected assertion union.
Role-bootstrap regressions require the captured
`native-bootstrap-role-capabilities-v2` contract, reject profile/role downgrades
and forged or borrowed runtime/prefix facts, and retain complete genuine
Homebrew/full/R-PRE and historical replay requirements. Historical v3/v2/null
retain all thirteen real Mac prefix owners for the current topology. V4 retains
thirteen diagnostic artifacts with eight real owners and five nonallocation proofs.
V5 retains the same diagnostics with two real genuine Homebrew owners and eleven
source-bound nonallocation proofs.

### 3.2 Existing full selection

The baseline is all **74** top-level `test/*.test.mjs` files at source `749636e`.
Admission must derive the current expanded inventory, including additions,
deletions, dynamically registered subcases and platform variants; 74 files or
the historical 1,299-case reports are not the new candidate's passing denominator.

Every existing file is assigned to required hosted validation by default.
The full inventory includes the GitHub boundary/identity/transport/retention
families, storage/recovery/concurrency/authority suites, deployment/PR/provider
families, package/install/distribution suites, runner/static/instruction checks,
Homebrew and native Windows/WinGet suites. The inventory assertion in T-PRD001
must reconcile actual discovered cases against the current approved selection,
not this prose list.

The preserved core T-42 upgrade obligation now uses the genuine public v0.3.1
CLI, pinned to `8b2e4e8719b407454e28f84d716907b0ff834d3c`, to create the old
installation, then the verified current package's updater, updated installed
doctor and idempotent installed update. Its source archive/provenance are
`test/fixtures/upgrade-v0.3.1-source.tar.gz` and
`test/fixtures/upgrade-v0.3.1-source.json`.
Separate controlled recognized-owner/schema-1 manifests prove version-label
independence, modified-owned conflict preservation and rejection of unknown
owner/schema or malformed/unprovable ownership without destructive fallback.
They are not fabricated historical releases. The old v1.2.0-specific `Passed`
projection remains historical; amended T-42 is `NotRun` until executed.
This is existing upgrade regression coverage in the complete capable PR lanes,
not a new canonical case, a private-tag prerequisite or growth of L's exact
16 canonical assertions plus 11 risk roots/27 total assertions.

Ordinary PR native channel validation freezes that same genuine public v0.3.1
release as its representative previous binary, using reviewed repository,
version, descriptor and checksum pins in `.github/workflows/ci.yml`. No
repository-variable setup is required. The external descriptor binds the
original platform archives; hosted jobs alone download and execute them.
These regression inputs neither restrict installer compatibility nor replace
the separately selected inputs required for an authorized release.

Node-only discovery is insufficient. Assign the other executable surfaces:

| Surface | Required selected validation, with no native claim from simulation |
| --- | --- |
| bin/ and src/ shipped framework | Existing full Node assertions, critical local selection, installed-package public-interface and hook tests; identify unmapped behavior rather than infer coverage from imports. |
| scripts/test-runner.mjs, test-worker.mjs | Actual child failure/exit, discovery, selection, scheduling, cancellation, reporting and cleanup probes on all four hosts. |
| scripts/check.mjs | Syntax/instruction/package-contract checks plus negative fixtures proving missing/invalid inputs fail. |
| scripts/package.mjs, verify-package.mjs | Repeated deterministic payload and isolated install/update/doctor/uninstall, modification and interrupted-copy negatives. |
| scripts/package-platforms.mjs, verify-platform-package.mjs | Deterministic shared Mac/Windows inventories, hostile archive inputs, external pins before execution and wrong-platform rejection. |
| packaging/standalone/install.sh and sdlc | Native shell lifecycle on both Mac architectures; applicable POSIX library behavior on Linux without publishing a Linux installer. |
| packaging/standalone/install.ps1, runtime.mjs and protocol.mjs | Native Windows PowerShell/cmd invocation, actual PE launcher, channel/home safety, Node selection, activation, rollback/concurrency and preservation. |
| packaging/standalone/archive.mjs | ZIP/tar canonical metadata, traversal/duplicates/links/truncation/corruption, deterministic byte comparison and shared payload identity. |
| cmd/sdlc-launcher/main_test.go and integrity_test.go | All applicable Go assertions on native Windows, shared contracts on other supported build hosts, reproducible Windows build and Go static analysis. |
| packaging/winget/build-launcher.mjs, generate.mjs, validate.mjs, smoke.mjs | Build/PE/inventory integrity, manifest/schema/runtime requirements and controlled native-client procedures; community submission is separate. |
| scripts/validate-winget-schema.py and pinned schemas | Actual Python schema validator with valid/invalid/swapped manifests and the declared schema versions. |
| packaging/homebrew and scripts/homebrew-quality.mjs, homebrew-lifecycle.mjs, homebrew-switch.mjs | Real audit/style and native install/upgrade/test/uninstall/switch/retained-Node behavior in owned prefixes on both Macs. |
| scripts/release-bundle.mjs, release-gate.mjs | Complete exact candidate evidence, missing/stale/failed/extra gate rejection, deterministic sealing and shared-Mac native variants. |
| scripts/npm-handoff.mjs, publish-release.mjs and npm-publish.yml | Exact immutable handoff, approved repository/caller/environment, token-free trust, no untrusted code execution, idempotent/partial/propagation outcomes. |
| scripts/accept-release.mjs | Anonymous exact published bytes, native consumers, all required per-case outcomes and failure evidence on each supported native target. |
| scripts/verify-github-acceptance.mjs | Complete expected selectors/requirements, mixed/missing/stale/foreign execution evidence and truthful aggregate outcomes. |
| packaging/windows-tester/generate.mjs and templates | Exact source/archive/checksum binding, completed prompt content and honest native/community capability dispositions. |
| Documentation, registered artifact locators and all four current workflow files | Topic migration, executable examples, link/anchor checks, fork trust, matrix completeness, permissions and actual provider policy probes. |
| test/calculator/package.json and its two real test files | Required independent PR command using the project's own `node --test` script; execute all eleven assertions, retain separate namespace/results and reject missing/partial output. Deliberately failing framework fixtures are not extra standalone projects. |

Existing platform-only skips are allowed only when that assertion is assigned
to a required matching native job elsewhere. A required job cannot skip its
own applicable case because its launcher/toolchain was not provisioned.
Unsupported privileged OS/IT/community operations remain visible separate
capability limitations; they cannot disappear from the report or be called Passed.

### 3.3 Required execution groups and placement

These groups describe execution responsibilities, not another generated coverage
manifest. Derive exact assertion/root identities from source declarations and
the current inventory. Unknown new assertions enter complete PR coverage;
unknown capabilities, missing assignments, duplicate ownership and cycles prevent
completeness rather than silently excluding work.

| Group | Default execution location | Required ordering and isolation |
| --- | --- | --- |
| Canonical sanity units and explicit critical roots | L and every applicable native PR lane | Canonical units first, then explicit integration roots; fixed membership/count budget. Separate fixture processes and exact root descendants. |
| Remaining unit roots and feature regression roots | Required applicable native PR lanes; optional targeted local debugging | Unit stage precedes integration. Independent roots, including roots from one source file, can overlap in owned processes; file membership alone is not a dependency. |
| Durability, locking, retention, recovery and exhaustion scenarios | Required applicable native PR groups | Preserve each causal scenario, exact bytes, real I/O, cleanup and 550-step boundaries. Independent fixture Stores may overlap; steps sharing one Store/lock remain ordered. |
| Native launcher, hooks, schema and package-manager lifecycles | Required matching Windows/Mac/shared-toolchain PR groups | Provision exact native/tool versions and pinned inputs before execution; owned homes/prefixes. Mac ARM and Intel consume the same frozen archive. Process-global setup is isolated, not made concurrently mutable. |
| Authentic signature/certificate/transparency verification | Required capable PR verification group; library negatives on applicable native lanes | Provision independently pinned authentic fixture bytes, identity and offline trust/tool inputs. Missing or invalid inputs fail the required group; semantic metadata or a generated fake signature is not a cryptographic pass. |
| Independent calculator project | Required PR project group, T-PRD087 | Run its own command without folding its eleven assertions into the framework denominator; retain command, source, exit and individual outcomes. |
| Documentation, repository classification and professional structure | Required PR checks including docs-only changes; cheap applicable static checks also accompany L | Public checker and mutation regressions verify links/layout/distribution navigation and policy isolation. No subjective quality certification or provider-setting write is inferred. |
| Actual public routes, effective provider policy and published consumers | Declared A / R-POST procedure and authorized host | These are not fork PR publication/admin actions or default local prerequisites. Require actual accessible destinations/effects; fixture success is separate. |

Within a ready-work pool, acquire declared minimum/exclusive resources before
starting a group's timed callback. Free capacity is available to the next ready
group, rather than reserved indefinitely for a completed sibling branch.
Nested producers share the same aggregate allocation. Dependencies require
successful prerequisite completion; failure/cancellation blocks dependents
explicitly while preserving diagnostics for independently executable work.
Reject unknown dependency/resource references and dependency cycles before
dispatch. Cleanup releases only the owning group's resources and awaits its
children.

T-PRD010/011/017 use observable process barriers and original event timelines,
not sleeps or configured worker counts, to establish disjoint coverage,
same-file independent overlap, dependency/resource exclusion, minimum allocation,
released-capacity reuse and interrupt cleanup. Test budgets include nested
workers and controller/resident limits. T-PRD012 adds actual comparable hosted
performance/utilization evidence; a scheduler unit fixture is not that benchmark.
Record group IDs, exact root/descendant assertions, commands, processes, source/
configuration/resource identities, starts/completions and original raw reports.
Any executor/protocol change has explicit version/compatibility handling;
historical originals remain immutable and cannot be relabelled current.

## 4. Evidence and test-location conventions

Every actual execution retains test and AC IDs, assertion selector/procedure,
expected-result evaluation, exit, timestamps, source/spec/configuration digests,
actual runtime/host, run/job/attempt and artifact digest where applicable.
Keep case-level evidence separate from suite summaries and operation activity.
All cases start NotRun; a blocked/unsupported/pending/cancelled case remains
NotRun with its diagnostic. Failed means an applicable actual execution failed.
Raw producer skips/todos are retained and never normalized into a pass.
Definition digests use the shared escape-aware row tokenizer. Status/evidence
changes alone remain excluded after correct column recognition; real escaped
definition cells now use unambiguous canonical encoding. A genuinely corrected
definition digest invalidates affected current credit without rewriting any
approved historical snapshot or execution. This is not a blanket formatting
reuse exemption.

Use framework evidence/retention interfaces, with sanitized GitHub artifacts for
this repository and explicit retrieval/retention policy for consumers. Retain
partial output while running and reconcile final reports without rerunning only
for formatting. Reports must be retrievable from a clean machine; a reference to
this session's `.test-data` alone is insufficient. Technical Design must specify
retention duration and recovery after provider artifact expiry before live use.

Implementation cells identify source bindings or declared procedures, not
passing results. A `#T-PRD...` reference is a logical binding: original test
names may be preserved through `validationDeclarations.plannedCases` aliases.
Resolve its actual file, full name and parent closure from the source inventory
before targeted execution; do not treat an alias as a literal name filter.
For a directly named test, the public selector is:

```text
npm run test:targeted -- --name "^T-PRD001 " test/public-readiness-inventory.test.mjs
```

Group compatible selectors per invocation. If implementation locations change,
update this same plan and preserve IDs/assertions before execution.
No name-only test that merely asserts constants or that a document exists can
satisfy a behavioral case. For provider/live cases, the implementation cell names
an exact procedure below; it does not impersonate a Node test selector.

Original case IDs, levels and assertions remain, while owner/location/checkpoint
now identify their actual required PR execution rather than a former broad local
gate. Exhaustive automatable assertions execute in the complete applicable PR
profile whether or not they were optionally reproduced locally. Environment-bound
cases below name their capable host. These fields do not add our code-review
activities to the test inventory; tests of framework review/approval behavior
remain ordinary product tests.

Coverage is generated in memory from the user-authored Requirements/Test Plan
and existing test declarations, then placed in one versioned section of the
PR description. No extra coverage/index/binding/policy file is generated in
the consuming repository. Shipped templates, native phase instructions and
helpers define and inspect this format and identify uncovered ACs.

Only this repository's CI/CD mandates `framework/coverage`: it reads actual
current PR metadata, checks structure, source/specification identities and
declared mappings without an LLM, and reports precise gaps. Missing or invalid
metadata cannot be replaced by a passing test run or a repository sidecar.
Consumers of the framework retain their own integration/enforcement policy.
This repository currently adopts only the registered public-readiness
Requirements/Test Plan set (`repositoryId: primary`,
`artifactId: public-readiness`) for this metadata check; it does not aggregate
every historical canonical SDLC archive. This explicit provider-specific choice
does not change the required execution profile or impose consumer CI policy.
Declared coverage does not prove runnable selectors or passing tests; selected
execution profiles still reconcile actual outcomes. Semantic adequacy remains
a Test Design/review responsibility.

## 5. Canonical cases

### 5.1 Inventory, local feedback and concurrency

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD001 | local | integration | post-review | automated | provider | github-pr-matrix | FR-200; AC-200.1 | F/D: enumerate every current Node case/file and shipped executable surface; reconcile direct, process, fixture-only and untested mappings; an unmapped added utility prevents completeness. | test/public-readiness-inventory.test.mjs#T-PRD001 | NotRun | |
| T-PRD002 | local | unit | post-review | automated | provider | github-pr-matrix | FR-200; AC-200.2 | F: resolve each selector, platform, checkpoint and prerequisite; reject missing selector, unowned skip or absent required platform assignment without executing a large suite. | test/public-readiness-inventory.test.mjs#T-PRD002 | NotRun | |
| T-PRD003 | local | unit | post-review | automated | provider | github-pr-matrix | FR-200; AC-200.3 | F: add, delete, rename and duplicate required fixture cases/utilities; reject stale or reduced denominator until the corresponding scope/inventory is legitimately updated. | test/public-readiness-inventory.test.mjs#T-PRD003 | NotRun | |
| T-PRD004 | local | unit | post-review | automated | provider | github-pr-matrix | FR-200; AC-200.4 | E: submit mock, cross-build and metadata-only results for a native/client requirement; refuse credit; matching actual native evidence is admitted. | test/public-readiness-native.test.mjs#T-PRD004 | NotRun | |
| T-PRD005 | local | integration | post-review | automated | provider | github-pr-matrix | FR-201; AC-201.1 | F: invoke documented critical, optional targeted/affected and opt-in full command paths; default membership is only the canonical sanity units and exact critical roots. Adding unrelated pre-review, unit or regression bindings does not expand L; passing L claims neither exhaustive logical cases nor PR completion. | test/public-readiness-runner.test.mjs#T-PRD005; finite profile and optional affected outputs have distinct selection/evidence identity | NotRun | |
| T-PRD006 | local | integration | post-review | automated | provider | github-pr-matrix | FR-201; AC-201.2 | F: inject safe corruption, stale authority and installer-preservation regressions into disposable fixtures; the explicit sanity selection catches essential failures. Reject missing risks or unexplained membership/count growth; feature/stress/failure matrices remain PR-required rather than becoming critical. | test/public-readiness-runner.test.mjs#T-PRD006 | NotRun | |
| T-PRD007 | local | integration | post-review | automated | provider | github-pr-matrix | FR-201; AC-201.3 | F: run failing child plus passing sibling, cancel active workers and interrupt reporting; preserve nonzero/incomplete outcomes, partial diagnostics and absence of surviving fixture processes. | test/test-runner.test.mjs#T-PRD007 via validationDeclarations.plannedCases; all three original failure/SIGINT/SIGTERM selectors required | NotRun | |
| T-PRD008 | local | unit | post-review | automated | provider | github-pr-matrix | FR-201; AC-201.4 | F: capture actual default-command elapsed time, exact root/assertion inventory, toolchain and worker/resources. Slow passing sanity remains selected, fast failed work cannot pass, and growth/placement changes are explicit; selected callback durations alone cannot establish command timing or a same-inventory speedup. | test/public-readiness-runner.test.mjs#T-PRD008; source-bound profile timing and membership diagnostics | NotRun | |
| T-PRD009 | local | integration | post-review | automated | provider | github-pr-matrix | FR-201; AC-201.5 | D/F: repository-only guidance explains new-test risk/category, PR-only default, critical budget/rationale, selector, capability, logical group, dependency/resource and owner checks. Independent installed consumers retain their own policy; source AGENTS/.github instructions neither ship nor leak repository defaults through generic assets. | test/instructions.test.mjs#T-PRD009; test/public-readiness-adoption.test.mjs#T-PRD009; T-PRD088 policy-boundary negatives | NotRun | |
| T-PRD010 | local | integration | post-review | automated | provider | github-pr-matrix | FR-202; AC-202.1; AC-202.5; AC-202.6; AC-202.7 | F: original process/barrier events prove independent roots from one or multiple files overlap, released sibling capacity is reused, dependencies wait for success, minimum/exclusive and nested/controller budgets hold, and failed prerequisites/cancellation cannot start dependents or leave child processes. Reject duplicate/missing/cyclic assignments before dispatch. | test/public-readiness-runner.test.mjs#T-PRD010; source-bound group/pool and process-timeline regressions | NotRun | |
| T-PRD011 | local | integration | post-review | automated | provider | github-pr-matrix | FR-202; AC-202.2; AC-202.5 | F: independent owned roots overlap while module-global environment/setup and patches stay process-isolated; shared Store/lock/prefix and causal steps remain ordered. Assert no cross-case reads, state leaks or cleanup of another group. | test/public-readiness-runner.test.mjs#T-PRD011 via declared independent-worker isolation and group/resource selectors | NotRun | |
| T-PRD012 | local | integration | post-review | automated | provider | github-pr-matrix | FR-202; AC-202.3; AC-202.7 | P: perform section 6's comparable benchmark on matched inventories/toolchains/resources; retain actual local and hosted group timelines, utilization, critical path, serial tail and repeated elapsed outcomes. Different selections/environments or configured concurrency cannot yield a speedup/full-optimization claim. | procedure: section-6-benchmark | NotRun | |
| T-PRD013 | local | integration | post-review | automated | provider | github-pr-matrix | FR-202; AC-202.4 | F: compare pre/post assertion and stress-limit inventories; actual lock/durability/retention/cleanup behavior remains real; missing cases, cheaper substituted mocks or reduced exhaustion boundaries fail the contract. | test/public-readiness-inventory.test.mjs#T-PRD013 fingerprint/stress assertions plus explicit cross-file original storage and retention selectors in section 3.1.1 | NotRun | |

### 5.2 Complete PR coverage, trust and provider enforcement

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD014-LX | local | integration | post-review | automated | provider | github-linux-x64 | FR-203; AC-203.1; AC-203.2 | P: open/update the approved fixture PR with no local-result artifact; full current applicable cases execute on Ubuntu, including shared filesystem/Git/tooling; retain exact candidate and case inventory. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD014-WX | local | integration | post-review | automated | provider | github-windows-x64 | FR-203; AC-203.1; AC-203.2; AC-203.3 | P/N: same PR candidate runs complete applicable Windows assertions, actual hooks, PowerShell/cmd and provisioned native PE launcher; missing launcher is a non-passing prerequisite, not a skip. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD014-MA | local | integration | post-review | automated | provider | github-macos-arm64 | FR-203; AC-203.1; AC-203.2; AC-203.3 | P/N: same PR candidate runs complete applicable Apple Silicon framework, tooling, runtime and shell assertions; verify native Node and reject translated evidence. This framework result alone is not whole-platform proof: independently require T-PRD060-MA for the same frozen artifact before platform completeness. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD014-MI | local | integration | post-review | automated | provider | github-macos-x64 | FR-203; AC-203.1; AC-203.2; AC-203.3 | P/N: same PR candidate runs complete applicable framework, tooling, runtime and shell assertions on actual x86_64; ARM metadata simulation cannot satisfy this case. This framework result alone is not whole-platform proof: independently require T-PRD060-MI for the same frozen artifact before platform completeness. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD015 | local | integration | post-review | automated | provider | github-pr-matrix | FR-203; AC-203.3; AC-203.7 | F/P: required capable PR groups provision and execute actual pinned Go/Python/schema/launcher and specialized verification inputs against positive/negative fixtures. Missing required capability fails with its actionable setup diagnostic, never an optional skip or an added local sanity prerequisite. | test/public-readiness-ci.test.mjs#T-PRD015; actual tool execution in section-7-pr-matrix | NotRun | |
| T-PRD016 | local | unit | post-review | automated | provider | github-pr-matrix | FR-203; AC-203.4 | E: aggregate the exact declared profile's complete matching jobs to Passed; missing, failed, cancelled, skipped, duplicate, cross-profile, foreign-attempt or stale-source results cannot pass; the stable check cannot require its own output or later release consumers. | test/public-readiness-inventory.test.mjs#T-PRD016; test/public-readiness-native.test.mjs#T-PRD016; test/public-readiness-observer.test.mjs#T-PRD016 API-only four-lane positive and missing/swapped-original negatives | NotRun | |
| T-PRD017 | local | unit | post-review | automated | provider | github-pr-matrix | FR-202; FR-203; AC-202.5; AC-203.5 | F: partition complete root/descendant inventory over uneven groups and deletion/rename/addition changes; union equals all applicable assertions exactly once, including stress/install and unknown-duration roots. Reject missing/duplicate/unknown/cyclic declarations; stale timing hints never alter coverage and path filters cannot remove a required gate. | test/public-readiness-inventory.test.mjs#T-PRD017; group-partition admission regressions | NotRun | |
| T-PRD018 | local | integration | post-review | automated | provider | github-pr-matrix | FR-203; AC-203.6 | F/E: pass, fail and terminate real fixture producers; retain source/commands/runtime/case/skip identities and sanitized partial output; absence of final summary remains incomplete, not Passed. Persist and replay large paged native failure bundles under the existing per-object and aggregate budgets without treating their container as one retained object or losing original bytes/outcomes. Recover classified transient Windows checkpoint replacement conflicts within the existing atomic-write retry budget; permanent or unclassified write failures remain non-passing and preserve the last durable original. Native Homebrew entry failures retain bounded structured diagnostics and original message identities without unsafe inspection stacks or spurious cleanup requests. Inline command programs execute unchanged but retain only source identities in command evidence. Unsafe or over-budget rich Homebrew reports retain a bounded non-passing record with the primary diagnostic, procedure stage, original report identity and separate retention error; unretainable successful evidence fails explicitly and cannot overwrite an original. Render success/failure/NotRun counts and per-case outcomes from those same records; assert failure diagnostics, safe annotation escaping and explicit overflow links to complete reports before exceeding the GitHub summary bound. Presentation must not alter actual outcomes or rely on a summary-upload error to fail the job automatically. | test/test-runner.test.mjs#T-PRD018 with original-report/cancellation aliases; test/public-readiness-native.test.mjs#T-PRD018 Go reconciliation, partial/missing-stage originals, paged bundle persistence/replay, Homebrew entry/inline-source/primary-error retention and annotation escaping; test/public-readiness-ci.test.mjs#T-PRD018 cleanup and checkpoint replacement conflicts | NotRun | |
| T-PRD019 | local | integration | post-review | automated | provider | github-pr-matrix | FR-203; AC-203.4; AC-203.6 | P: actual required validation status consumes all four current native reports and exposes failed/missing results; verify expected provider/source association, adopted workflow/runner/reporter definition, current head/test-merge identity, uploaded reports and actual required step exits. From PR check details, inspect native Actions job summaries/logs for successes, failures, NotRun/skip diagnostics and working complete-report links, including a failing run. The observer's workflow_run job conclusion alone cannot satisfy PR protection. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD020 | local | integration | post-review | automated | provider | github-pr-matrix | FR-204; AC-204.1 | F/D: fork-event fixtures cannot obtain write/OIDC/publishing secrets or target a real installation; safe complete job selection remains reachable without secrets. | test/public-readiness-ci.test.mjs#T-PRD020 | NotRun | |
| T-PRD021 | local | integration | post-review | automated | provider | github-pr-matrix | FR-204; AC-204.2 | F/D: trace privileged workflow/callee inputs; untrusted PR checkout, executable artifact handoff or poisoned cache is refused before execution; approved immutable data handoff remains usable. A matching-run fixture with an unadopted replacement workflow/reporter cannot self-authorize passing evidence; an adopted matching producer still needs complete actual outcomes and required step results. Do not claim protection against arbitrary malicious code already trusted to execute. | test/public-readiness-ci.test.mjs#T-PRD021; test/public-readiness-observer.test.mjs#T-PRD021 exact original commands/toolchains, adopted definitions and acquired artifact identity | NotRun | |
| T-PRD022 | local | unit | post-review | automated | provider | github-pr-matrix | FR-204; AC-204.3 | D: valid immutable action/callee pins and least permissions satisfy the declared policy; mutable/unapproved nested actions, excess grants and drift fail with exact diagnostic. | test/public-readiness-ci.test.mjs#T-PRD022 | NotRun | |
| T-PRD023 | local | integration | post-review | automated | provider | github-pr-matrix | FR-204; AC-204.4 | F: place unowned sentinels outside/inside fixture roots, inject interrupted cleanup, and run competing fixtures; only owned resources change, all processes finish, policy/runtime/home settings remain untouched. | test/cli-install.test.mjs#T-PRD023 competing installs and interrupted rollback preserve unowned content, runtime and the other fixture | NotRun | |
| T-PRD024 | local | unit | post-review | automated | provider | github-pr-matrix | FR-205; AC-205.1 | F: evaluate owner-authored and external PR review facts separately with the same required CI and zero-unresolved-conversation policy; external missing/stale approval or any unresolved thread blocks, owner self-approval is not required, and unverified enforcement is not called active. | test/public-readiness-ci.test.mjs#T-PRD024 | NotRun | |
| T-PRD025 | local | integration | post-review | automated | agent | provider-policy | FR-205; AC-205.2 | P: read actual effective rules; authorized disposable-ref probe verifies direct push/force/delete/admin behavior against approved policy; never infer owner exemptions or use force/admin to perform the probe. | procedure: section-8-policy | NotRun | |
| T-PRD026 | local | integration | post-review | automated | agent | provider-policy | FR-205; AC-205.3 | P: safe approved PRs with failing, absent, stale or skipped required results cannot merge; current complete checks, applicable review and resolved conversations permit normal merge eligibility without executing a merge unless specifically authorized. | procedure: section-8-policy | NotRun | |
| T-PRD027 | local | unit | post-review | automated | provider | github-pr-matrix | FR-205; AC-205.4 | F: denied/unavailable account feature or absent scoped setting authority retains a precise blocker and dispatches no mutation; source config without provider observation cannot satisfy enforcement. | test/public-readiness-ci.test.mjs#T-PRD027 | NotRun | |

### 5.3 Release orchestration and published consumers

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD028 | local | unit | post-review | automated | provider | github-pr-matrix | FR-206; AC-206.1 | F: missing/wrong destination, version/tag/source, toolchain, required setting or trust authority fails preflight with exact reason before any fake irreversible call is made. | test/release-ci.test.mjs#T-PRD028 | NotRun | |
| T-PRD029 | local | integration | post-review | automated | provider | github-pr-matrix | FR-206; AC-206.2 | F: build independent comparison artifacts, seal only after all exact native gates, and pass the same digest-bound bytes to both publisher fixtures; changed/repacked/swapped data is rejected. | test/release-ci.test.mjs#T-PRD029; four-native-profile, original NDJSON data-only transport and acyclic sealed-handoff assertions all required | NotRun | |
| T-PRD030 | local | integration | post-review | automated | provider | github-pr-matrix | FR-206; AC-206.3 | F: drive orchestration with fixture provider outcomes; successful publication schedules exact saved-ID acceptance automatically; missing public assets/acceptance handle yields incomplete release, not success or a manual-only hidden step. | test/release-ci.test.mjs#T-PRD030 | NotRun | |
| T-PRD031 | local | unit | post-review | automated | provider | github-pr-matrix | FR-206; AC-206.4 | F: reject PR events, wrong caller/environment/source, missing OIDC and token fallback; approved token-free exact caller gets only its declared publishing permissions. | test/npm-oidc.test.mjs#T-PRD031 | NotRun | |
| T-PRD032 | local | integration | post-review | automated | provider | github-pr-matrix | FR-206; AC-206.5 | F: one captured maintainer start enables only the identified release sequence; no automatic publication from arbitrary push/merge or permission reuse for another source/version/environment. | test/release-ci.test.mjs#T-PRD032 | NotRun | |
| T-PRD033 | local | unit | post-review | automated | provider | github-pr-matrix | FR-207; AC-207.1 | F: controlled clock simulates npm success followed by metadata/tarball/provenance propagation; bounded backoff distinguishes confirmed pass, publish failure and uncertain readback without blind republish. | test/npm-oidc.test.mjs#T-PRD033 | NotRun | |
| T-PRD034 | local | integration | post-review | automated | provider | github-pr-matrix | FR-207; AC-207.2 | F: resume identical package/tag/assets after lost response in the same logical release intent; reconcile handles/digests and unchanged R-PRE inputs/freshness before consuming original evidence without relabeling its physical attempt. Other intents, proof older than 24 hours, changed inputs or conflicting bytes/tag/source cannot reuse credit, overwrite assets or move tags. | test/release-ci.test.mjs#T-PRD034; test/public-readiness-release-history.test.mjs#T-PRD034 independent run chronology, physical reruns, original preflight/source/artifact identity and bounded data reader assertions | NotRun | |
| T-PRD035 | local | unit | post-review | automated | provider | github-pr-matrix | FR-207; AC-207.3 | F: exercise npm-only success, GitHub-only success, failed acceptance and absent handle; retain each channel state and recovery action, never synthesize rollback or overall success. | test/release-ci.test.mjs#T-PRD035 | NotRun | |
| T-PRD036 | local | unit | post-review | automated | provider | github-pr-matrix | FR-207; AC-207.4 | E: ready-before-publish is distinct from completed-after-publish; missing/failed/skipped/stale required evidence blocks the appropriate verdict and the configured publisher fixture. | test/public-readiness-evidence.test.mjs#T-PRD036 a configured publisher dispatches only complete current prepublication evidence and retains separate consumer completion | NotRun | |
| T-PRD037 | local | integration | post-review | automated | provider | github-pr-matrix | FR-207; AC-207.5 | F/E: later successful recovery preserves initial failure/attempt and sanitized links; planted credentials/JWT/query secrets are removed/rejected without changing asserted case results. | test/public-readiness-evidence.test.mjs#T-PRD037; test/release-ci.test.mjs#T-PRD037; test/public-readiness-release-history.test.mjs#T-PRD037; test/public-readiness-release-report.test.mjs#T-PRD037; test/public-readiness-release-consumer.test.mjs#T-PRD037 declared same-integration T-PRD054 retention alias | NotRun | |
| T-PRD038-WX | local | acceptance | post-review | automated | provider | github-windows-x64 | FR-208; AC-208.1; AC-208.2 | P/N: anonymous public Windows archive/descriptor/checksums match the frozen source before execution; full PowerShell and cmd lifecycle preserves user content/runtime, including prior-version upgrade and installed hooks. | procedure: section-9-consumers | NotRun | |
| T-PRD038-MA | local | acceptance | post-review | automated | provider | github-macos-arm64 | FR-208; AC-208.1; AC-208.2 | P/N: anonymous shared Mac archive matches frozen pins; native Apple Silicon standalone lifecycle, prior-version upgrade, hooks and preservation succeed without translation or origin cache. | procedure: section-9-consumers | NotRun | |
| T-PRD038-MI | local | acceptance | post-review | automated | provider | github-macos-x64 | FR-208; AC-208.1; AC-208.2 | P/N: anonymously fetch the identical shared Mac digest; native Intel standalone lifecycle, upgrade, hooks and preservation succeed independently of Apple Silicon results. | procedure: section-9-consumers | NotRun | |
| T-PRD039-WX | local | acceptance | post-review | automated | provider | github-windows-x64 | FR-208; AC-208.3 | P/N: exact published npm bytes pass integrity checks then isolated Windows npm lifecycle; local-manifest WinGet smoke is separately identified from community discovery and cannot substitute for unavailable client proof. | procedure: section-9-consumers | NotRun | |
| T-PRD039-MA | local | acceptance | post-review | automated | provider | github-macos-arm64 | FR-208; AC-208.3 | P/N: actual npm and Homebrew install/upgrade/test/uninstall/switch execute on Apple Silicon; capture old keg and independently retained Node before removal; post-removal hooks/doctor prove surviving runtime. | procedure: section-9-consumers | NotRun | |
| T-PRD039-MI | local | acceptance | post-review | automated | provider | github-macos-x64 | FR-208; AC-208.3 | P/N: same public formula/archive supports real Intel npm and Homebrew lifecycle including upgrade and post-removal runtime checks; install/test/uninstall alone does not pass upgrade. | procedure: section-9-consumers | NotRun | |
| T-PRD040 | local | unit | post-review | automated | provider | github-pr-matrix | FR-208; AC-208.4 | E: absent Intel native evidence, unavailable required client/runtime and corporate denial retain actual NotRun/Blocked dispositions; cross-build or community-ready metadata never changes them to Passed. | test/public-readiness-native.test.mjs#T-PRD040 | NotRun | |
| T-PRD041 | local | integration | post-review | automated | provider | github-pr-matrix | FR-203; FR-208; AC-203.7; AC-208.5 | F/P: the required capable PR verifier provisions independently pinned authentic bundle/trust/tool inputs and verifies the real signature, certificate and transparency positive. Wrong source/workflow/digest, absent attestation, bad signature and unverified transparency fail separately on those bytes. Missing PR inputs fail setup; metadata/unit doubles are not cryptographic proof. No local registry or privilege workaround is used. | test/npm-oidc.test.mjs#T-PRD041; test/public-readiness-release-consumer.test.mjs#T-PRD041 authentic actual-verifier assertion and required PR fixture setup | NotRun | |
| T-PRD042 | local | acceptance | post-review | automated | provider | github-release | FR-208; AC-208.5 | P/E: independently verify actual published provenance for the exact package/source/caller/digest, retaining signature/certificate/transparency outcomes individually; unsupported required mechanisms block instead of inheriting fixture success. | procedure: section-9-consumers | NotRun | |

### 5.4 Documentation, readiness proof and shared Mac artifact

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD043 | local | integration | post-review | automated | provider | github-pr-matrix | FR-209; AC-209.1 | D: follow reader entry/navigation paths from README/docs landing page to installation, usage, architecture, integrations, contribution/testing and releases; missing topic or dead edge fails. | test/public-readiness-docs.test.mjs#T-PRD043 | NotRun | |
| T-PRD044 | local | unit | post-review | automated | provider | github-pr-matrix | FR-209; AC-209.2 | D: canonical per-feature Requirements/Test Plan/Design paths use docs/sdlc/feature and exact role filenames; coverage generation adds no extra repository specification/index. Malformed slugs, duplicate canonical roles or internal SDLC records mixed into reader topics fail. | test/public-readiness-docs.test.mjs#T-PRD044 | NotRun | |
| T-PRD045 | local | integration | post-review | automated | provider | github-pr-matrix | FR-209; AC-209.3 | F/D: migrate fixture core/feature records and compare IDs/content/history references; preserve approval snapshots and historical evidence while core locators resolve to docs/sdlc/core-framework. | test/multi-repository-artifacts.test.mjs#T-PRD045 | NotRun | |
| T-PRD046 | local | integration | post-review | automated | provider | github-pr-matrix | FR-209; AC-209.4 | F/D: move mapped fixture docs, update links/anchors/package copies/generators/checks/artifact locators; old stale path cannot remain authoritative; approved historical snapshots are not rewritten to new evidence. | test/public-readiness-docs.test.mjs#T-PRD046; test/package.test.mjs#T-PRD046 explicit declaration aliases the original T-36 actual archive/install verification | NotRun | |
| T-PRD047 | local | unit | post-review | automated | provider | github-pr-matrix | FR-209; AC-209.5 | D: reader topics contain no generated raw logs/session-local authority or stale current-pass claims; linked historical records are clearly classified and immutable evidence stays in its declared retention location. | test/public-readiness-docs.test.mjs#T-PRD047 | NotRun | |
| T-PRD048 | local | integration | post-review | automated | provider | github-pr-matrix | FR-209; AC-209.6 | F/D: valid links/anchors/layout pass; broken relative links/fragments, stale migration targets and a documentation-only PR that omits required docs checks fail their gate. | test/public-readiness-docs.test.mjs#T-PRD048 | NotRun | |
| T-PRD049 | local | integration | post-review | automated | provider | github-pr-matrix | FR-210; AC-210.1; AC-210.5 | D: check current release/source/version/platform/lifecycle examples against actual metadata; stale pins, unsupported promises, transient WIP/counter clutter and false readiness claims are diagnosed. Verify source, package and installed navigation separately, including intentionally missing downstream targets. | test/public-readiness-docs.test.mjs#T-PRD049; T-PRD088 structure and distribution-navigation regressions | NotRun | |
| T-PRD050 | local | contract | post-review | semi-automated | agent | provider-policy | FR-210; AC-210.2; AC-210.6 | D/P: follow actual published contribution/support/private-security/ownership/release routes as a newcomer; verify each destination and personal third-party policy. Confirm enabled private reporting and usable GitHub reporting navigation without submitting a report; distinguish authorized setting readback from completion of the whole walkthrough. | procedure: section-10-documents | NotRun | |
| T-PRD051 | local | integration | post-review | automated | provider | github-pr-matrix | FR-210; AC-210.3 | F/D: execute safe documented reproduction commands on matching fixtures/hosts, including installed-entry doctor and a disposable local first-use path. Missing hooks/compatibility or host monitoring capabilities are explicitly unverified, not inferred from integrity checks; no registry/OS-policy bypass or real-home mutation occurs. | test/public-readiness-docs.test.mjs#T-PRD051; actual live Copilot compatibility is observed separately in section-10-documents | NotRun | |
| T-PRD052 | local | contract | post-review | automated | provider | github-pr-matrix | FR-210; AC-210.4 | D: explicit mapping classifies adopted contribution/security guidance versus deferred FR-054 work; missing classification, duplicate contradictory specification or unapproved security-control scope prevents completion. | test/public-readiness-docs.test.mjs#T-PRD052 | NotRun | |
| T-PRD053 | local | acceptance | post-review | automated | agent | provider-policy | FR-211; AC-211.1 | P: approved controlled PR/probe demonstrates actual runner failure, missing required job, required skip/prerequisite and denied normal merge; no failing production change is merged and all disposable resources are reconciled. | procedure: section-8-policy | NotRun | |
| T-PRD054 | local | integration | post-review | automated | provider | github-pr-matrix | FR-201; FR-211; FR-213; AC-201.1; AC-201.3; AC-211.2; AC-213.3; AC-213.11; AC-213.13 | F/E: release fixtures prove preflight no-side-effect failure, uncertain partial-publication recovery and acceptance failure without false success. Joined readiness preserves all canonical PR/acceptance obligations while L uses the independently derived finite sanity catalog; legacy broad L, missing/foreign assertions, stale/corrupt/unverified inputs cannot pass. Optional affected outcomes cannot enlarge L or hide a verified failure. | test/release-ci.test.mjs#T-PRD054 incl same-level Failed-then-Passed completion alias; test/public-readiness-release-consumer.test.mjs#T-PRD054; test/public-readiness-release-report.test.mjs#T-PRD054 complete/partial/currentness and finite-profile regressions | NotRun | |
| T-PRD055 | local | acceptance | post-review | automated | provider | github-release | FR-211; AC-211.3 | P: actual approved candidate PR matrix passes; one separately authorized unique release/rehearsal completes preflight, frozen packaging, publication and all native consumers without manual glue; never replace 0.4.0. | procedure: section-11-release | NotRun | |
| T-PRD056 | local | integration | post-review | automated | provider | clean-consumer | FR-211; AC-211.4 | E: regenerate readable readiness from retained current evidence on a clean host; counts/timings/protections/channel/native limitations match machine records and failed historical attempts remain visible. | procedure: section-12-evidence | NotRun | |
| T-PRD057 | local | integration | post-review | automated | provider | github-pr-matrix | FR-212; AC-212.1 | F: build a new-version release; exactly one Mac archive is published in the inventory, its name contains macos not one CPU, and both native consumers resolve the same asset. | test/distribution-channels.test.mjs#T-PRD057 | NotRun | |
| T-PRD058 | local | unit | post-review | automated | provider | github-pr-matrix | FR-212; AC-212.2 | F: inspect verified archive entries; exactly one shared JS/shell payload, no nested prior archives, no bundled Node and no claim of a Universal 2 executable; extra executable/runtime entries fail. | test/distribution-channels.test.mjs#T-PRD058 | NotRun | |
| T-PRD059 | local | integration | post-review | automated | provider | github-pr-matrix | FR-212; AC-212.3 | F: wrong/missing/non-native/shadowed Node and unsupported host fixtures fail before channel/home writes; compatible host/runtime passes the public preflight without weakening archive checks. | test/distribution-channels.test.mjs#T-PRD059 | NotRun | |
| T-PRD060-MA | local | integration | post-review | automated | provider | github-macos-arm64 | FR-203; AC-203.3; FR-212; AC-212.4 | P/N: verify the frozen shared archive digest and execute its candidate lifecycle through real Homebrew natively on arm64; compare sibling Intel report identity; swapped/rebuilt/different bytes cannot be admitted as the same tested artifact. Restore captured opt and linked-keg references before promotion; the injected failure must reach linking, restore the exact prior owned state and permit a genuine newer-version retry without forced overwrite. Reuse only the exact captured pending candidate with receipt/tap/payload verification; the real initial upgrade executes once, not again over its retained keg on retry. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD060-MI | local | integration | post-review | automated | provider | github-macos-x64 | FR-203; AC-203.3; FR-212; AC-212.4 | P/N: independently verify the same frozen digest and execute its native x86_64 lifecycle through real Homebrew; ARM-only/Rosetta evidence or a missing sibling result fails shared-artifact eligibility. Restore captured opt and linked-keg references before promotion; the injected failure must reach linking, restore the exact prior owned state and permit a genuine newer-version retry without forced overwrite. Reuse only the exact captured pending candidate with receipt/tap/payload verification; the real initial upgrade executes once, not again over its retained keg on retry. | procedure: section-7-pr-matrix | NotRun | |
| T-PRD061 | local | integration | post-review | automated | provider | github-pr-matrix | FR-212; AC-212.5 | F/D: generated Homebrew metadata has one verified Mac URL/hash, declared native Node dependency selection and no obsolete architecture-specific URL; assert these local metadata contracts only. Actual native lifecycle proof is assigned to T-PRD079-MA/MI before publication and T-PRD039-MA/MI afterwards, never as prerequisites for this local case. | test/homebrew.test.mjs#T-PRD061 | NotRun | |
| T-PRD062 | local | integration | post-review | automated | provider | github-pr-matrix | FR-212; AC-212.6 | F: repeat builds and traverse verifier/gate/descriptor/checksum/docs consumers with one shared Mac asset; stale requests for old CPU filenames, changed manifests or mismatched hashes fail. | test/distribution-channels.test.mjs#T-PRD062; test/release-ci.test.mjs#T-PRD062; test/public-readiness-docs.test.mjs#T-PRD062 packaging readers reject obsolete future Mac assets and nonblocking native gates | NotRun | |
| T-PRD063 | local | integration | post-review | automated | provider | github-pr-matrix | FR-212; AC-212.7 | F: new-version fixture keeps separate real Windows PE and npm payload; installed0.4 and original release metadata/assets/tag are not mutation targets; attempted existing-version replacement is rejected. | test/release-ci.test.mjs#T-PRD063 actual pinned-Go PE preservation and original immutable version/tag/asset replacement rejection; local binary preservation is not native Windows execution proof | NotRun | |

### 5.5 General framework evidence and adoption

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD064 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.1 | F/E: public framework interfaces admit actual automated producer results and declared manual/semi-automated observations with owner/procedure; reuse existing records, reject invented automated execution and competing unbound ledgers. | test/public-readiness-evidence.test.mjs#T-PRD064; test/public-readiness-adoption.test.mjs#T-PRD064 canonical external-system ownership survives plan, report and managed admission, including declared reverse-member/environment bindings | NotRun | |
| T-PRD065 | local | unit | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.2 | E: round-trip all required fields/outcomes; absent case/AC/selector/expected-result/exit/time/host/provenance data is diagnosed; skip, running, cancelled and blocked never normalize to Passed. | test/public-readiness-evidence.test.mjs#T-PRD065 | NotRun | |
| T-PRD066 | local | unit | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.3 | E: reconcile exact expected profile denominator and platform variants; all valid Passed admits that profile only. Empty/missing/extra-conflicting/duplicate/failed/skipped evidence, substituting PR passes for R-PRE, or requiring R-POST/A output before publication fails admission despite suite exit0. | test/public-readiness-evidence.test.mjs#T-PRD066 | NotRun | |
| T-PRD067 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.4 | F/E: independently change source, spec, config, host/toolchain, artifact and required freshness; preserve old bytes/results but reset affected current credit to NotRun; latest failure cannot be hidden by older pass or completion order. | test/public-readiness-evidence.test.mjs#T-PRD067; test/public-readiness-adoption.test.mjs#T-PRD067 reverse members, DEV/STAGING artifact/deployment/native bindings, operation/STAGING companion original clocks/expiry/later failure and declared legacy adoption alias | NotRun | |
| T-PRD068 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.5 | F/E: publisher fixture consumes actual trusted readiness output for exact candidate/artifact; contributor-edited Passed JSON, wrong origin, stale report or missing case dispatches no publish and records precise blocker. | test/public-readiness-evidence.test.mjs#T-PRD068; test/public-readiness-adoption.test.mjs#T-PRD068 explicit declaration binds the combined T-PRD073 publisher/override fixture, not a renamed unit publisher test | NotRun | |
| T-PRD069 | local | unit | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.6 | E: complete prepublication inventory permits only publication readiness; missing/failing later consumers leaves completion non-passing and retains real channel writes; no circular requirement to download unpublished bytes. | test/public-readiness-evidence.test.mjs#T-PRD069 | NotRun | |
| T-PRD070 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.7 | F/E: persist sanitized digested raw/normalized result references and readable report; reconstruct from declared retained artifacts in a fresh home; tamper, expiry/unavailable reference and secret contamination cannot silently pass. | test/public-readiness-evidence.test.mjs#T-PRD070; test/release-ci.test.mjs#T-PRD070 declared same-integration alias to the T-PRD037 complete release-lifetime/as-of reconstruction assertion | NotRun | |
| T-PRD071 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.8 | F/E: execute each missing/skip/stale/wrong-artifact/wrong-platform/interrupted/later-failure variant independently; each blocks current credit, original records remain immutable, and a complete replacement succeeds under its actual identity. | test/public-readiness-evidence.test.mjs#T-PRD071 | NotRun | |
| T-PRD072 | local | unit | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.9 | F/E: use different test IDs and a non-Node/non-GitHub producer shape through trusted adapters with networking denied; same generic schema/currentness rules hold without account/workflow hardcoding or core network client. | test/public-readiness-evidence.test.mjs#T-PRD072; test/public-readiness-consumer.test.mjs#T-PRD072 installed offline core decodes real Python output while host network and process APIs are denied; controlled in-process boundary, not OS isolation | NotRun | |
| T-PRD073 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.10 | F/E: absent/failed evidence blocks managed readiness; explicit user stage override still lets hooks fall through without Passed credit or publication authority; separate configured publisher/provider gate continues to enforce actual controls. | test/public-readiness-evidence.test.mjs#T-PRD073; test/public-readiness-adoption.test.mjs#T-PRD073 explicit captured stage overrides fall through without readiness or publisher credit, including declared installed-independent-consumer alias | NotRun | |
| T-PRD074 | local | integration | post-review | automated | provider | github-release | FR-213; AC-213.11 | P/E: this repository's real critical/PR/release/consumer outputs flow through standard framework interfaces; generated readiness comes from approved inventory and trusted records, not this session's handcrafted aggregate. | procedure: section-12-evidence | NotRun | |
| T-PRD075 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.12 | F/E: independent consumer project with different IDs/selectors/config/non-GitHub producer exercises success, failure, missing/stale evidence and invalidation without framework source edits; distinguish fixture proof from live provider acceptance. | test/public-readiness-consumer.test.mjs#T-PRD075 | NotRun | |
| T-PRD076 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.13 | F/E: adopt supported older records/workflow/spec references and retain exact history/recovery; explicit migration handles schema change; unsupported evidence is unverified, never deleted or silently passed. | test/public-readiness-evidence.test.mjs#T-PRD076 referenced catalog/complete graph reload; test/public-readiness-adoption.test.mjs#T-PRD076 supported legacy adoption preserves original records and grants only new current normalized credit | NotRun | |
| T-PRD077 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.14 | F/D: follow consumer guide in an independent fixture to configure plan, producer, retention and readiness using public interfaces; expose provider enforcement and separate approvals accurately, with invalid configuration failing explicitly. | test/public-readiness-consumer.test.mjs#T-PRD077 installed consumer guidance runs its public coverage, producer, retention and replay examples with real inputs | NotRun | |

### 5.6 Native release prepublication and conversation enforcement

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD079-LX | local | integration | post-review | automated | provider | github-linux-x64 | FR-203; FR-206; FR-213; AC-203.2; AC-206.2; AC-213.3; AC-213.5 | P/E: on the exact authorized release source and pinned baseline, execute unit-first complete applicable Linux regression/static/schema/shared Go checks and deterministic candidate construction; retain case inventory and freeze artifact/metadata identities before native gates. A failed/missing case prevents publication readiness. | procedure: section-11-release-prepublication | NotRun | |
| T-PRD079-WX | local | integration | post-review | automated | provider | github-windows-x64 | FR-203; FR-206; FR-208; FR-213; AC-203.3; AC-206.2; AC-208.2; AC-213.5 | P/N/E: execute complete applicable Windows regression and native PE/PowerShell/cmd/installed-hook lifecycle assertions against the frozen unpublished release bytes; verify runtime/preservation and exact source/artifact reports. No cross-build, public consumer or earlier PR result substitutes for this fresh native prepublication case. | procedure: section-11-release-prepublication | NotRun | |
| T-PRD079-MA | local | integration | post-review | automated | provider | github-macos-arm64 | FR-206; FR-208; FR-212; FR-213; AC-206.2; AC-208.3; AC-212.4; AC-212.5; AC-213.5 | P/N/E: on native arm64 run complete applicable Mac regression, standalone/hook and real isolated Homebrew audit/style/install/upgrade/test/uninstall assertions using the frozen unpublished shared archive; match its digest with Intel, record all case results and reject translation or changed bytes. | procedure: section-11-release-prepublication | NotRun | |
| T-PRD079-MI | local | integration | post-review | automated | provider | github-macos-x64 | FR-206; FR-208; FR-212; FR-213; AC-206.2; AC-208.3; AC-212.4; AC-212.5; AC-213.5 | P/N/E: independently run the corresponding complete native x86_64 regression, standalone/hook and isolated Homebrew lifecycle on the identical frozen shared archive; verify actual Intel runtime and same digest, not ARM metadata simulation or later publication acceptance. | procedure: section-11-release-prepublication | NotRun | |
| T-PRD080 | local | unit | post-review | automated | provider | github-pr-matrix | FR-205; AC-205.1; AC-205.3 | F/E: for owner and external fixture PRs, unresolved conversation count above zero prevents merge readiness despite otherwise passing checks/review; resolved fresh facts remove only that blocker, reopening restores it, and missing/stale conversation facts never imply resolved. | test/public-readiness-ci.test.mjs#T-PRD080 | NotRun | |
| T-PRD081 | local | integration | post-review | automated | agent | provider-policy | FR-205; AC-205.1; AC-205.3 | P: after exact disposable-PR/thread authority, verify effective require-all-conversations-resolved policy and actual unresolved/resolved/reopened thread behavior for owner and external PRs. Both keep mandatory CI; owner exception affects only second-human approval. Missing capability/facts is NotRun/Blocked, not a resolved conversation. | procedure: section-8-policy | NotRun | |
| T-PRD082 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; AC-213.1; AC-213.9; AC-213.10; AC-213.11 | F/E: a headless consumer normalizes verified real producer observations and evaluates its declared profile without interactive Copilot receipts or fabricated phase approvals. The verdict grants no external action authority; importing the unchanged origin into a managed workflow still requires its legitimate current cycle/admission. Unverified JSON flags cannot manufacture passing readiness or managed credit. | test/public-readiness-consumer.test.mjs#T-PRD082 | NotRun | |

### 5.7 Machine-readable coverage and framework authoring

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD083 | local | unit | post-review | automated | provider | github-pr-matrix | FR-200; FR-213; AC-200.2; AC-200.3; AC-213.15 | F/D: prepare and parse the versioned PR-description coverage section from supported canonical definitions and existing test declarations, entirely in memory. Diagnose malformed structure, duplicate sections/IDs, unknown versions, orphan references, stale inputs and uncovered ACs. Preserve many-to-many links and profile applicability; references in prose do not create links. Assert no coverage/index/binding/policy files are created and no semantic adequacy, execution credit or consumer CI policy is inferred. | test/public-readiness-inventory.test.mjs#T-PRD083 | NotRun | |
| T-PRD084 | local | integration | post-review | automated | provider | github-pr-matrix | FR-213; FR-214; AC-213.12; AC-213.13; AC-213.14; AC-213.16; AC-214.4 | F/D/E: install into an isolated home and follow shipped skills/templates/helpers for an independent consumer's different IDs/non-Node tests. Prepare coverage/gap feedback in memory; authorized provider fixtures create/update only the owned PR-description section and preserve unrelated text, while absent authority dispatches no write. Refresh after definition edits, retain legacy snapshots/records, and assert no extra coverage files or changes to the consumer's existing CI/branch policy. Actual runner evidence remains separate. | test/public-readiness-consumer.test.mjs#T-PRD084; test/public-readiness-pr-description.test.mjs#T-PRD084 actual authorized create/update, atomic version/body conditions, no-authority/no-write and uncertain-result reconciliation fixtures | NotRun | |

### 5.8 This repository's coverage-metadata guardrail

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD085 | local | integration | post-review | automated | provider | github-pr-matrix | FR-205; FR-214; AC-205.3; AC-214.1; AC-214.2; AC-214.3 | F/D/E: repository-checker fixtures reject missing/empty/malformed/duplicate coverage, missing required AC mappings, wrong source/spec and stale description versions despite otherwise passing tests. Delete/edit at the same head and deliver stale/coalesced events; refresh all current shared keys. Two PRs sharing the actual SHA/context with valid versus missing/deleted coverage cannot overwrite one another; all matching members must pass, while verified distinct keys stay separate. Exercise membership closure/head changes and incomplete pagination. Across all three fixed contexts, simulate counts 997/998/999/1000, prior success, quota rejection and lost POST replies; reserve non-passing capacity, never publish success at/above cutoff or blindly retry, freeze a confirmed capacity error and require fresh-source recovery. An exhausted pre-existing green is reported unenforceable, never claimed blocked. Preserve per-member evidence/author policy, diagnostics, no candidate execution and no sidecar writes. | test/public-readiness-ci.test.mjs#T-PRD085 | NotRun | |
| T-PRD086 | local | integration | post-review | automated | agent | provider-policy | FR-205; FR-214; AC-205.1; AC-205.3; AC-214.1; AC-214.2; AC-214.3 | P: after exact disposable-PR/status/rule authority, observe this repository's required coverage context. Missing metadata prevents normal merge eligibility despite passing tests; valid current metadata permits an otherwise eligible key; same-head deletion restores non-passing state. Observe two approved PRs sharing source SHA and the actual provider-evaluated head/merge association: a genuinely shared key cannot accept one PR's success over another's failure; distinct enforced keys remain independent. Exercise closure/source refresh and an explicitly approved low-budget disposable-context probe of terminal non-passing behavior rather than exhausting 1,000 production slots. Verify diagnostics and owner/external policy without merging a probe or changing consumer CI. | procedure: section-8-policy | NotRun | |

T-PRD085 also proves that an unchanged, freshly re-evaluated aggregate consumes
no additional status slots. Membership, source, review, description, producer
or freshness changes must prevent stale reuse even if the last status is green;
one unrelated PR event cannot drain every other key's write budget.
The additional `test/public-readiness-observer.test.mjs#T-PRD085` selector
exercises same-head metadata deletion independently of complete matching native
fixture evidence through the actual API-only observer boundary.

### 5.9 Independent projects and sustained professional structure

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Observe or assert | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-PRD087 | local | integration | post-review | automated | provider | github-linux-x64 | FR-203; AC-203.8 | F/P: run every declared calculator-project file/assertion through its actual Node command in required PR validation; the initial baseline is eight calculator and three static-contract assertions. A declared added file or assertion executes as well; stale selection, mismatched file/name, missing, failed, skipped or partial project results cannot pass independently of framework success. Keep source/command/exit and namespaced outcomes separate; deliberately failing framework fixtures are not standalone projects. | procedure: section-7-pr-matrix; test/calculator/package.json test command; source-derived scripts/pr-calculator.mjs adapter | NotRun | |
| T-PRD088 | local | integration | post-review | automated | provider | github-pr-matrix | FR-201; FR-209; FR-210; FR-215; AC-201.5; AC-209.1; AC-209.2; AC-209.4; AC-209.5; AC-209.6; AC-210.1; AC-210.3; AC-210.5; AC-215.2; AC-215.3 | F/D: an actual public checker accepts the coherent repository/layout, then owned mutations remove contribution/security navigation, break paths/fragments, mix internal records into reader topics, introduce version drift, omit packaged/installed targets and leak source-only testing policy into shipped generic instructions. Each relevant mutation fails with a specific diagnostic; valid restoration passes. Required docs-only PR coverage runs these assertions. Structure checks do not certify subjective writing or actual live provider enforcement. | test/public-readiness-docs.test.mjs#T-PRD088; existing documentation/static checker public entry points | NotRun | |
| T-PRD089 | local | acceptance | post-review | semi-automated | agent | provider-policy | FR-210; FR-215; AC-210.5; AC-210.6; AC-215.1; AC-215.2; AC-215.3; AC-215.4 | D/P: validate the five-reference primary-source/adoption procedure in section 10 against immutable inspected revisions, original project-specific choices and actual implementation/evidence. Walk the exact published colleague-facing revision and current CI/protection/security/channel routes; report incomplete controls or unexecuted checks without endorsing unpublished changes. No new publication or setting authority is inferred. | procedure: section-10-documents and primary-source comparison in requirements.md | NotRun | |

## 6. Comparable benchmark procedure

The required delivery target is **under 15 minutes for each complete logical
native PR lane**. Include job-specific toolchain provisioning, every required
test/procedure, evidence retention and owned-resource cleanup. For a lane with
parallel required parts, use the earliest part's actual worker start and the
latest part's completion; do not time only the fastest or longest isolated part,
exclude a serial auxiliary stage, or hide a queued part after the lane starts.
Report initial provider queueing and the complete workflow duration separately.
The separate advisory test-phase goal remains ten minutes, with two minutes a
stretch goal; neither is a timeout or permission to omit work. Record actual
native correctness and the lane-latency verdict separately: passing assertions
do not prove that the latency target was achieved.
Stability, complete native coverage and honest failure reporting take precedence:
do not drop assertions, weaken checks or hide retries to meet the target.
An incomplete or failed attempt is not a successful full-suite benchmark.

For the next PR measurement, explicitly request the native hosts' observed
memory-bounded shared worker allocations: Linux/Windows 15, Apple Silicon 7,
four CPU-matched slots on both Intel unit hosts and fourteen slots on Intel
regression hosts. Keep the two-unit topology, case union and all other selected
allocations unchanged for this comparison: the four-slot regression trial did
not complete before the cutoff. Do not claim a whole-lane speedup before complete
hosted results.
Verify the actual producer's requested/capacity fields and shared
nested-allocation bounds; the default local gate and 32-slot ceiling do not
change. Account for the personal-account limit of five concurrent hosted Mac
jobs across both architectures. A lane still active at 16 minutes is cancelled,
retained as non-passing and returned to measured parallelism work.

Use independent owned baseline and candidate workspaces on the **same host**
with the same Node/tool versions, worker/resource limits and environment policy.
Freeze exact original case/assertion membership before timing. Capture at least
two comparable full-selection measurements and two focused critical-path
measurements per version; account for new contract tests separately.

Retain cold/warm cache state, process/worker activity, case/file durations,
wall-clock duration, pass/fail/skip counts and source/test/config digests.
Verify safe actual overlap with filesystem barriers, not inferred CPU activity.
Do not compare the historical Windows two-worker run with Linux four-worker
execution as a speedup. Timing is advisory: report regressions and unresolved
serial/resource bottlenecks honestly rather than dropping coverage or fabricating
a performance pass. Reuse an existing completed comparable run only if its
recorded input identities and conditions match the declared comparison.
Clean the exact owned workspaces and wait for all benchmark children.

The authored opt-in procedure uses the standalone development adapter:

```sh
node scripts/validation-benchmark.mjs --baseline "$OWNED_BASELINE_ROOT" --candidate "$OWNED_CANDIDATE_ROOT" --output .test-data/benchmark-evidence --workers 4 --focused "$FOCUSED_ASSERTION_IDS_JSON"
```

The focused value is the actual JSON array of adopted assertion IDs, not invented
display names. Both owned workspaces must support the same adopted budget
protocol and matching host/tool/resource contract. The adapter performs two full
and two focused measurements per version under matched cold/warm owned
application-cache state, preserving each original report/journal/measurement.
`benchmark-comparison.json` compares exact original ID/definition/applicability
membership; added cases are separate. Unmatched, failed or unverified inputs
produce no timing ratios. Scheduling-policy identity includes priorities,
source-bound duration hints, hosted unit-root partition, targeted order and
budget version. This controlled math comparison is not actual hosted T-PRD012
completion or release authority. Controlled tiny fixture measurements validate
the adapter, not product-scale or hosted performance; full local remains opt-in,
never a post-fix default.
Focused IDs expand to their complete original root chains to retain necessary
causal ordering; added IDs stay separate. Original definition/applicability/
resource classes must match exactly. Failed planned measurements retain a
partial comparison and do not silently retry to obtain a ratio.

## 7. PR matrix procedure

1. With scoped push/PR authority, use the exact candidate selected for validation and a clean
   controlled contribution without local result files. Observe initial PR and
   new head updates; retain exact candidate/source, workflow and attempt.
2. Confirm all four logical native lanes and all twenty-five required producer parts
   start with their own prerequisites. Intel Mac has two unit producers; each
   other platform has one. Every platform also has an
   independently required producer for the unchanged, causally ordered
   550-refresh root. The remaining complete root closures are partitioned across
   four body producers on Linux/Windows and three on each Mac architecture.
   Each Mac lane also requires its genuine Homebrew producer. No part alone
   completes a platform. Native unit evidence must complete before that
   platform's regression shards execute; another platform or attempt cannot
   supply the prerequisite. Include the unit barrier, every part's provisioning,
   evidence retention and cleanup in the whole-lane elapsed time.
   For `native-framework-shards-v4-split-intel-units`, require each platform's
   actual unit jobs to finish successfully, including evidence and cleanup,
   before its own regression jobs start. Other platforms' unit jobs may finish
   later; all twenty-five successful parts still remain mandatory for completeness.
   Partition extended-unit files through the common source-bound algorithm:
   two nonempty Intel subsets and one elsewhere. Execute the canonical sixteen
   assertions once on the original unit producer. Verify exact disjoint complete
   unions including descendants, dependencies and exclusive resources. The new
   Intel producer has no unit prerequisite of its own. Every Intel regression
   must wait for both unit jobs, not a borrowed ARM/original-unit result.
   Keep `native-framework-shards-v1` global-barrier and
   `native-framework-shards-v2-platform-units` twenty-part replay distinct,
   including their eighteen framework SDK origins; also retain v3's twenty-four
   parts, twenty-two framework origins and projection-shards-v2 unchanged.
   The current topology requires twenty-three framework origins and two genuine
   Homebrew origins under `native-component-projection-shards-v3`; preserve the
   historical v1/v2 projections without relabeling their origins. Reject
   wrong-version or borrowed unit proofs. Do not start waiting regression hosts
   early to overlap bootstrap. Historical bootstrap v3/v2/null require all thirteen
   distinct Mac prefix allocations and matching guarded cleanup receipts. Bootstrap
   v4 requires eight real owners plus five source-bound nonallocation proofs while
   retaining all thirteen cleanup diagnostic artifacts; count every real wait honestly.
   Separate jobs use their own native hosts, resource budgets, scratch paths and
   owned prefixes where required rather than racing on a shared package-manager installation.
   Controlled negatives must reject six-of-seven Intel parts, either missing,
   failed, stale or wrong-attempt unit origin, a regression starting before
   either unit cleanup completes, duplicated canonical work and borrowed prefix
   receipts. Genuine hosted whole-lane timing remains required; the additional
   standard Intel VM fills the fifth initial Mac slot, not a speedup claim.
   Exercise actual Go, Python, shell and Homebrew surfaces in their assigned
   lanes. Install tests operate only in fixture homes; fork jobs have no publish
   capability. Required authentic-verifier setup supplies independently pinned
   bundle/trust/tool inputs; absence fails the group rather than skipping it.
   Sharding/grouping preserves exact original assertions and stress boundaries.
3. Reconcile every expected file/case/platform variant against completed producer
   evidence. A legitimate cross-platform skip must be satisfied by its matching
   native lane, not counted Passed where skipped. New/deleted/renamed cases and
   dynamic subtests remain visible in the denominator. Derive the complete,
   disjoint root/descendant assignment from the frozen source inventory rather
   than the parts that happen to arrive. Require each substantive Go, Python,
   schema, static and calculator stage at its assigned producer; partitioning
   cannot omit a stage or count a repeated assertion as independent coverage.
   Include the PR-only `Git identity batches fresh path queries and preserves
   unborn and linked worktrees` root in `test/storage.test.mjs`. It checks real
   process counts and fresh path, branch and HEAD behavior, not a proxy native
   latency pass. Its addition does not expand L or remove an existing check.
   Also execute the PR-only exact-current-ref binding regression in that file,
   including a same-commit different branch, fresh revision, prefix mismatch,
   unborn and linked-worktree cases. The two controlled Node-only Homebrew
   rollback-inventory roots in `test/homebrew-switch.test.mjs` must retain all
   real fixture bytes, modes and links, bound independent reads, serialize
   large payloads and drain injected failures before recovery-state cleanup.
   These component checks never replace the genuine Mac procedures or expand L.
   The two PR-only candidate Git-read roots in `test/candidate-stamp.test.mjs`
   must observe actual independent process overlap only after fresh binding,
   preserve complete staged/unstaged/untracked source identities, and hold one
   real query's completion while another owned query fails. Neither the primary
   error nor fixture cleanup may proceed before every dispatched read drains.
   Retain the existing byte, timestamp, staged-index, branch and capacity guards.
   These bounded component checks do not replace full native timing or enlarge L.
4. Mac jobs consume the same frozen architecture-neutral artifact/digest; do not
   independently rebuild and call different bytes the same artifact. Windows
   jobs use a real PE. Collect native environment/runtime probes and step exits.
   Retain exact job/component, source, attempt, toolchain and artifact identities
   for each part. Reject missing, duplicate or swapped parts and verify guarded
   cleanup for every allocated Mac prefix; one part cannot borrow another's receipt.
5. Observe the stable check, complete/failing sanitized reports and provider
   review policy. Read-only checking does not authorize merge. Preserve the PR
   and reconcile any disposable artifacts; deletion requires its own authority.
6. Execute T-PRD087 in the independent calculator project with its own
   `node --test test/*.test.js` package script. Retain each of its eleven
   namespaced assertion outcomes, exact command/runtime/source and exit.
   Deliberately failing calculator-result fixtures prove a green framework
   report cannot hide missing/failing independent-project evidence.
7. Retain actual group start/finish/process/resource timelines and original
   reports for independent and constrained scenarios. Reconcile full applicable
   framework assertion union separately from calculator and native tool results.
   A worker-count setting, aggregate exit zero or missing subordinate report
   cannot stand in for coverage or observed parallelism.

## 8. Effective policy and controlled failure procedure

The planned conversation policy is **all review conversations resolved before
normal merge eligibility**, for owner and external PRs alike. The solo-maintainer
exception removes only the requirement for another human to approve an owner's
PR; it does not exempt CI or conversation resolution. A resolved thread is not
an approval, and an approval is not evidence that all threads are resolved.
This defines test expectations, not authority to apply provider settings.

Read actual applicable branch/ruleset/review/check settings, including inherited
rules and bypass actors. Establish repository identity and exact required check
contexts. Do not apply or probe writes until the user authorizes the proposed
settings and exact disposable PR/ref consequences.

On approved non-production fixtures, independently exercise failing, missing,
cancelled, skipped and stale checks, external missing/stale review, and owner
PR with no second human approver. Verify actual provider merge eligibility or
normal denied merge responses; never merge intentionally broken product code.
For T-PRD081, independently verify effective conversation-resolution enforcement,
create the specifically approved disposable thread on each PR-author class,
and observe unresolved, resolved and reopened states. With otherwise eligible
checks/review, unresolved or reopened threads must prevent normal merge
eligibility; resolving all threads removes only that blocker. Compare fresh
provider thread facts and actual merge-policy evaluation, not a locally assumed
zero count. Do not auto-resolve real reviewer threads or merge a probe PR.
Check direct-push/force/delete restrictions without bypass flags and without
touching protected production refs. Preserve raw denial as a failed attempted
operation while the negative validation case may pass its expected rejection.
If account features/permissions cannot support the declared policy, record
NotRun/Blocked with the exact gap; do not substitute YAML presence for enforcement.
Keep observations source/run/time-bound; do not reuse old policy evidence after
settings or candidate changes. Reconcile cleanup scope before any deletion.

For T-PRD086, first adopt the trusted checker and observe its actual context
before separately authorized required-check configuration. On the expressly
approved disposable PR, keep execution tests passing and independently observe
missing coverage, valid current coverage, and removal at the same head commit.
Wait for the actual metadata-triggered check and compare normal merge
eligibility, source/body digests and visible diagnostics. A description edit is
not a code push, and an old green result is not the new observation.

With authority for a second disposable PR, verify the actual provider status
targets and expected source before claiming isolation or shared-key coverage.
For a shared evaluated key, valid versus missing/deleted metadata must remain
non-passing until all current members pass; closing or moving a member triggers
fresh reconciliation. If GitHub evaluates distinct merge keys, prove their
independent results and do not label that a live shared-key execution; the
local shared-key fixture still covers that branch.

The real 1,000-status cap and quota-rejection/lost-response variants are local
provider fixtures. A live boundary probe may use only a separately approved
disposable context with a deliberately smaller trusted write budget and actual
required-status observations. Never burn production status slots, relax the
998 normal-write ceiling, manufacture a new source commit, or change branch
rules without the corresponding scope/authority. A pre-exhausted old green is
an enforcement gap requiring a fresh authorized source identity, not a pass
because a workflow failed. Do not apply this policy to consumer repositories
or merge any probe.

### 8.1 Exact disposable automated procedure

For T-PRD053/026/086, the source-authored entry is the owner's separately
authorized `pr-policy-refresh.yml` `workflow_dispatch`, not a generic request
to mutate the real repository. The exact `disposable-request` JSON has only:
`schemaVersion`, `kind`, `id`, `repository`, `repositoryId`, `prNumber`,
`headRef`, `baseRef`, `headSha`, `baseSha`, `mergeSha`, `sourceCommit`,
`statusWriterId`, `statusAppId`, `protectionDigest`.
Version is 1, kind `disposable-readiness-probe`, id
`[a-z][a-z0-9-]{5,31}`, repository `urmich/ai-sdlc-framework`, SHAs exact
40-hex and protection digest exact 64-hex. The head must differ from the
trusted default source. Refs are exactly `readiness-probe/<id>/head` and
`readiness-probe/<id>/base`. The owner has already separately approved/precreated
that PR/ref/rule scope; source code grants no such operation.

The actual precreated base protection must require exactly the derived
`framework/disposable/<id>/coverage` and `/validation` contexts on the selected
App. The SDK re-fetches repository, default source, selected open PR/head/base/
merge, protection and complete status history, rejecting changed production
scope or previous probe history. The CLI also verifies the actual owner and
triggering owner/run/event/path/source/default/attempt. A missing in-process
scoped authorizer or serialized/foreign capability means no dispatch; JSON
approved/verified/Passed fields cannot authorize. 403/404/missing capability is
NotRun/Denied/Unavailable, not passing enforcement or permission to change settings.

The trusted default-branch probe job invokes:

```sh
node scripts/pr-readiness.mjs probe --evidence-dir ".test-data/disposable-probe-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

It has read contents/actions/PR and status-write only, no OIDC/secret inheritance,
and uses the common fixed serialized writer group. It supports no PR/ref/rule
creation, merge or deletion method and never targets main/production contexts.

| Ordered stage | Actual action / expected observation |
| --- | --- |
| Admission | Reacquire all exact provider/request/protection/writer identities; reject mismatches and prior scope history before any POST. |
| Real controlled child baseline/failure | Run actual owned Node TAP fixtures: two passing assertions, then required failure plus passing sibling. Retain exact source/digest, command, times, exit/stdout/stderr; wait for child closure and clean only owned local inputs. Generic kind=fixture is not native acceptance. |
| Normal provider baseline | Write success to both derived disposable contexts on approved head; bounded fresh PR reads must observe normal clean eligibility. Never call merge. |
| Coverage negative | Actual coverage API accepts valid same-head fixture mapping and rejects empty body. Write scoped coverage failure and require fresh blocked eligibility; restore success and clean before validation negatives. |
| Validation negatives | Independently evaluate actual generic failed-required-with-passing-sibling => Failed, missing job => NotRun, required skip => NotRun, missing prerequisite assertion => NotRun. Write failure/pending accordingly and require real blocked observations. Restore clean between variants except the final prerequisite, intentionally non-passing. |
| Disposable capacity boundary | Fixed normal 8/hard 10 budgets, never production slots. At cutoff force terminal error; requesting success reuses confirmed capacity error without a new POST. Require final actual blocked eligibility. |
| Immutable retention | Before each possible effect fsync exact dispatching source/head/request/protection/writer/App/run/attempt. Retain actual response or uncertainty, all clean/blocked observations, generic bundles, original failure and final JSON/NDJSON. Timeout/unknown effects remain NotRun, not safe retry. Leave remote PR/refs/rules/error statuses intact. |

Retain artifact `disposable-policy-<run>-<attempt>` for 90 days and verify the
actual accessible run page separately from status polling. These stage
expectations are not proof a probe occurred: all current cases remain NotRun.
Local fake-provider regression success cannot become actual provider/native
acceptance. Pre-existing resource/settings creation and eventual cleanup need
their own explicit authority. No such provider action is performed by this
source-only correction.

## 9. Clean native consumer procedure

For each required native host, retrieve the declared frozen evidence and then
anonymously download only the exact approved public release assets/package.
Independently match source/version, external descriptor/checksums, full inventory
and artifact digest before extraction or execution. Negative corruption tests
use isolated copies, never published assets.

In a fresh home/cache/prefix, execute each applicable lifecycle operation:
install, healthy doctor, idempotent update, actual upgrade from an independently
pinned compatible previous public release, all eight installed hook handlers,
ordinary uninstall and fixture-only clean migration/purge. Preserve sentinels
and seeded runtime; assert failure/rollback boundaries and retained independent Node. Windows runs
both PowerShell and cmd; macOS runs native shells and separately real Homebrew
install/upgrade/test/uninstall/switch. Capture actual operations, not inferred
upgrade credit from installing a single version. The selected channel proof
input is not an installer support whitelist or an obligation to run every
historical binary. Ordinary updates preserve runtime; only explicitly selected
fixture purge removes it.

Record npm byte SHA-256 and registry integrity plus declared provenance policy.
Record semantic attestation binding separately from signature/certificate/
transparency verification. Missing required cryptographic verification blocks
that required case; metadata success does not impersonate it. Community WinGet
discovery, corporate-device policy and unsupported capability observations remain
explicit separate limitations, not an assertion that all clients can install.
Do not use this Windows development machine to bypass its registry policy;
approved hosted consumers execute in their own target environments.

Uninstall/remove only owned test artifacts and verify both hooks and doctor after
channel removal when that scenario requires retained integration. Keep rollback
payload/runtime until success; report irreversible fixture purge truthfully.

## 10. Professional documentation procedure

Use an explicit checklist: all required audience topics reachable; correct
supported versions/platforms; executable safe examples; usable contribution,
issue/support and private-security reporting destinations; ownership/review/
release responsibilities; third-party OSS classification; and no stale
NotRun-versus-Passed or corporate approval claims. The agent follows each route
and records its destination/outcome. Automated link/anchor and contract checks
support, but do not replace, that walkthrough.

### 10.1 Automated structural regression gate

T-PRD088 makes the enforceable parts of professional structure an ongoing
required PR gate, including documentation-only changes, rather than a one-time
manual cleanup. Reuse existing public static/documentation and package-layout
checks. Run negative fixtures on uniquely owned copies, never by breaking the
real repository or changing provider configuration. Preserve unrelated sentinels,
restore/clean each owned mutation and retain the original diagnostics.

| Contract | Positive and regression proof |
| --- | --- |
| Reader entry points and required guidance | README/docs navigation reaches contribution, support, private security reporting, ownership and releases; remove a destination or navigation edge and require a precise failure. Mere empty files or unrelated links cannot satisfy the route. |
| Canonical topic/specification structure | Reader topics remain separate from `docs/sdlc/<feature>/requirements.md`, `test-plan.md` and `technical-design.md`; invalid role/slug/layout and misplaced internal runtime material are rejected without rewriting historical evidence. |
| Links, heading fragments and distribution navigation | Check source, packaged and installed target graphs; broken deep fragments, missing downstream docs/images and reference-link targets fail. An online-only reference is explicitly identified rather than masquerading as an absent local file. |
| Release/source/platform truth | Current examples match the declared supported release and Node/platform contract; stale version pins, obsolete Mac artifact selection and unsupported claims fail. Unreleased candidate work is labelled, not made public by editing documentation. |
| Repository-only contributor/agent testing policy | Source AGENTS/.github guidance describes finite local sanity, full capable PR coverage and classification/dependency/resource rules. Package/installer output excludes source-only instructions; injecting those defaults into shipped generic assets fails. Other consumers retain their own validation policy. |
| Honest operational and readiness language | Installation integrity is not live Copilot/hook compatibility; monitoring requires actual scheduler/provider-read/running-host capability; source files/CODEOWNERS are not proof of enabled merge controls. Targeted negative fixtures check these adopted claims, not arbitrary prose style. |

Required reports identify the failing path/contract and retain enough context
to repair it. A mutation must fail for its intended regression, not because an
unrelated fixture dependency was omitted. Passing structural automation does
not mean the repository is flawless, attractive to every reader or publicly
ready; the source-linked published walkthrough remains separate.

### 10.2 Primary-reference and published-experience assessment

T-PRD089 uses the five immutable reference revisions and adoption matrix in
Requirements. For each selected practice, inspect its cited primary file and
execution chain where relevant; distinguish an observed implementation from a
recommendation. Record adopt/adapt/not-applicable reasoning, this project's
actual implementation location and matching execution or walkthrough proof.
Do not import a reduced PR suite, privileged infrastructure, corporate branding,
security contact, SLA, CLA or foundation governance simply because a reference
uses it. Preserve the offline dependency-free, user-governed personal MIT
framework and consumer choice of CI policy.

Select the exact colleague-facing published branch/revision independently of
the local worktree. Follow installation/use, contribution/support and private
reporting routes; inspect actual current required CI and effective merge controls,
and verify released-channel claims against their own evidence. Use a disposable
local-only repository for first-use checks if that operation is authorized;
record actual Copilot/platform/shell versions and expected activation. Missing
live compatibility remains unverified, not inferred from a clean doctor.
Do not submit a vulnerability report, open a PR, publish a release or change
settings merely to complete this observation. A required destination/control
that is absent is an explicit incomplete outcome, not polished away.

On 2026-10-20, five-reference source research and enabling/readback of the
owner-approved GitHub private-reporting setting were completed. They are
prerequisite observations only; the whole implemented/published assessment
remains NotRun until its complete criteria have actual evidence.

### 10.3 Existing migration and reproduction procedures

Run migration on copies first, retaining exact original content/IDs, registered
locators and approval snapshots. Check packaged copies and generated references
against new topic paths; no report or runtime history is rewritten as new
execution. Explicitly classify overlap with proposed FR-054 before adopting any
additional security feature. Documentation-only changes do not bypass these checks.

T-PRD045 migrates Requirements, Test Plan and Technical Design for both a core
and descriptive feature in an owned Store, preserving all original approval
snapshot bytes and a real retained execution. A definition-changing link edit
must create a fresh current cycle with NotRun credit while the original Passed
observation and retained payload bytes remain historical. T-PRD047 separately
checks the declared retention object remains outside reader content through a
document move. No fixture result adopts the nine actual stale locators named in
[the blocked adoption procedure](../../contributing/documentation.md#blocked-current-locator-adoption).

T-PRD046 validates the complete installed target/fragment graph on a valid
package-layout copy, then rejects missing downstream guides, downstream anchors,
alias-only fragments and reference-link fragments through ordinary update and
clean-install preflight. Compare every previous owned file, manifest, runtime and
unowned sentinel after each rejection; a fresh rejected home stays absent.
Its explicit original T-36 package-test alias also exercises the real tgz copy/
install/verification path. T-PRD048 invokes the public aggregate static checker
with valid and broken docs, and uses a real docs-only source-tree delta in the
controlled SDK observer fixture to prove missing/incomplete required static
reports cannot pass native admission. Controlled fixtures are not hosted proof.

T-PRD051 executes the actual `docs-local` recipe from the reader guide in an
owned fixture: real checker and exact targeted runner arguments, a selected
assertion plus an unselected failing sibling, absent selected file, path escape,
invalid worker argument, missing worker and unsafe command negatives. It clears
ambient report/home paths and checks the local native recipe fails on missing
actual artifact pins before output creation. Never fabricate hosted identities
to turn this prerequisite negative into native execution. The actual provider
recipe is executed only in the matching separately authorized T-PRD014/T-PRD079
lane under section 7/11; this location division adds no native prerequisite to
local source work and waives none of the hosted obligations.

T-PRD049/T-PRD062 compare reader and packaging guides with package Node/version
metadata and the actual shared archive/execution-platform contract, with
independent version, Node, payload, platform, filename, lane and readiness
negatives. T-PRD052 parses the original 19 AC-054 definitions and their existing
explicit dispositions, rejecting missing, conflicting duplicate, undefined and
unauthorized-expanded classifications. No deferred security program is built.

## 11. Authorized end-to-end release procedure

### 11.1 Release-prepublication procedure

The R-PRE selector is exactly T-PRD079-LX/WX/MA/MI and their complete underlying
prepublication case/platform inventories, not every `post-review` case.
Start only with the identified source/version/destination and current release
authority. Preflight rejects missing prerequisites before irreversible calls.

1. A common exact-source/policy/tool preflight and deterministic producer freeze
   candidate asset bytes, descriptor, checksums and producer identity once.
   This does not mark any full source/native lane passed.
2. T-PRD079-LX/WX/MA/MI retrieve that saved candidate by exact producer/artifact
   ID and run in parallel with their section 2.2 native toolchains, unit-first
   within each lane. Linux still completes all applicable source/static/schema/
   Go/regression and comparison-package work; Windows and both Macs complete
   their full native regressions/lifecycles. Both Mac lanes consume one identical
   archive digest. Comparison builds cannot replace frozen candidate bytes.
3. Before publication, a candidate-only loopback fixture may serve the verified
   frozen Mac bytes to the test-only Homebrew formula. Assert that both native
   lifecycle consumers use those exact bytes and declared Node dependencies.
   The fixture formula is not published and cannot rewrite the stable formula/
   checksum inventory. These results prove unpublished candidate behavior, not
   public URL availability, which belongs exclusively to R-POST.
   Genuine upgrade proof starts from an independently authenticated compatible
   previous public release selected for that channel and upgrades to the frozen
   current candidate; this proof input is not an installer version support gate.
   Capture both descriptor/checksum/source/payload identities before execution.
   A same-version reinstall/formula revision or missing previous input blocks
   this obligation. Public mode later executes the exact saved published
   previous/current formulas and URLs, without regeneration.
4. Reconcile the R-PRE required cases, native platform subcases and tool/image
   identities into retained readiness evidence. The prerequisite graph is
   source checks -> frozen candidate -> native candidate checks -> sealed
   evidence/readiness -> publication. Neither published-consumer results nor
   T-PRD055/056/074 is an input before publication.
5. Any failed, missing, skipped, stale or incompatible required result prevents
   readiness. Do not borrow an earlier PR or release pass. Retry only after
   reconciling the current attempt and retain prior failures; do not rebuild/
   replace the immutable approved candidate as a verification shortcut.

### 11.2 End-to-end completion observation

Use an expressly authorized **new** version or controlled release destination;
never repack/overwrite 0.4.0. Confirm required provider settings/trust and exact
publication target/source/ref before the single maintainer start. Monitor actual
run/attempts and each effect from dispatch through completion.

The accepted sequence is R-PRE preflight/source checks/frozen packaging/native
candidate checks/readiness, approved publication, automatic R-POST exact-ID
public consumer acceptance, and generated final report. The post-run acceptance
observer T-PRD055 records that sequence afterwards; it is not a prerequisite
of its own release-completion verdict.
No manual acceptance dispatch, global package-manager repair or token fallback
is permitted. Stop before irreversible publication when readiness is incomplete.
If a provider response is uncertain, reconcile version/assets/run handles before
any retry; no automatic duplicate publish. Keep per-channel partial states and
historical failed attempts. Fixture simulations can validate negative paths but
cannot satisfy this actual successful rehearsal.

## 12. General evidence and self-use procedure

Use public framework interfaces from an isolated candidate package; the test may
not rely on manually edited status cells or the user's installed framework.
For T-PRD083/084, use the shipped schema/example and authoring guidance to
prepare the PR-description section in memory through the supported helper.
Check it against current canonical definitions/test declarations, not a second
handwritten matrix or a generated source-tree file. Requirements-only authoring
validates its document before a Test Plan exists; it does not invent complete
coverage. Missing executable bindings cannot pass an execution profile.
T-PRD085/086 exercise enforcement only for this repository; T-PRD084 proves
consumer CI/policy remains unchanged. Human/agent review establishes semantic
adequacy; neither metadata nor the checker invents passing test evidence.
Feed actual local/CI/release producer observations through trusted normalizers
with independently established identities. Use the current approved complete
Test Plan inventory, not hardcoded totals or a producer's claimed denominator.

Reconstruct readiness from retained evidence in a clean workspace without
the originating Copilot home/session/test-data directory. Check byte digests,
origin, access/retention and complete expected results. Tamper and missing/expired
artifacts must fail verification with an explicit gap. The same public interfaces
must work for an independent consumer with different IDs/configuration and
non-Node/non-GitHub result shape; a fixture does not claim live provider access.

For durable release-lifetime replay after CI expiry, retrieve all frozen public
assets plus the complete separately named prepublication/completion archives,
including original bundle/context, tester input/handoff, native originals,
captured provider origins and trust material. Verify the literal inventory and
each reference; omit/tamper each required input independently and reject it.
The supported historical/as-of verifier must need no live producer API and must
not renew the original <=24-hour current-readiness window, original clocks or
physical attempts. An expired historical success stays ineligible for a current
publisher. Missing durable/trust inputs remain explicit NotRun/Blocked.
Captured native source definitions use their explicit literal-source codec, not
execution-log sanitization; preserve exact source/BOM and check captured blob
identities and credential-safety separately. `replayNativeEvidence` re-derives
inventory/specification/stages from that data and checks exact original
JSON/NDJSON/Markdown plus mandatory independently authenticated archive context.
Its historical result never confers current credit or executes captured code.

Use the supported retained-archive verifier with independently acquired inputs:

```sh
node scripts/release-retention.mjs --archive "$RETAINED_ARCHIVE" --attestation-bundle "$SIGNED_ATTESTATION" --expected-archive-sha256 "$ARCHIVE_SHA256" --expected-bundle-sha256 "$BUNDLE_SHA256" --expected-source-commit "$SOURCE_COMMIT" --expected-release-intent-id "$RELEASE_INTENT_ID" --as-of "$ORIGINAL_AS_OF" --assets-directory "$VERIFIED_ASSETS" --materialize-directory "$NEW_OWNED_RECEIVER"
```

Verify the complete non-asset/context/tester/handoff/template/definition/
producer-fact graph with frozen assets. Signed raw `.jsonl` and digest-named
trust metadata are separate post-attestation retained assets. Actual
repository/workflow/signer/source/ref/hosted/transparency verification uses
the captured bundle; a custom root requires an independent expected hash.
The result is historical only: CURRENT NotRun/publicationReady false even
when the original as-of evaluation succeeds. No live CI/API/Git lookup or
freshened source time is a recovery substitute.

Completion-lifetime recovery uses the distinct completion wrapper and verifies
both signed subjects against the same source/intent/frozen bundle:

```sh
node scripts/release-retention.mjs completion --archive "$COMPLETION_ARCHIVE" --attestation-bundle "$COMPLETION_ATTESTATION" --expected-archive-sha256 "$COMPLETION_SHA256" --prepublication-archive "$PREPUBLICATION_ARCHIVE" --prepublication-attestation-bundle "$PREPUBLICATION_ATTESTATION" --expected-prepublication-archive-sha256 "$PREPUBLICATION_SHA256" --expected-bundle-sha256 "$BUNDLE_SHA256" --expected-source-commit "$SOURCE_COMMIT" --expected-release-intent-id "$RELEASE_INTENT_ID" --as-of "$ORIGINAL_AS_OF" --assets-directory "$VERIFIED_ASSETS" --materialize-directory "$NEW_OWNED_RECEIVER"
```

`verifyHistoricalCompletion` checks complete R-PRE data and exact canonical
plan/tree/repository identity against completion inputs, original-provider to
sanitized-retained digest bridges, and shared pure consumer replay of actual
bootstrap/lifecycle/provenance mechanisms. T-PRD042 replay binds exactly three
admitted child hashes. Missing closure or tamper rejects; preserve original
Failed attempt 2 and later Passed attempt 3 as separate immutable history.
CURRENT always remains NotRun/publicationReady false. The same-integration
T-PRD070 alias requires this real full-retention fixture, not generic-bundle
reconstruction alone; it is still not actual hosted/public proof.

T-PRD041's real signed fixture requires the independently hashed retained bundle,
exact certificate identity, integrity-pinned npm 11.16 tool root and complete
offline TUF cache in the required PR group's owned `.test-data`. Reproducible
PR setup must provision and verify the selected authentic inputs before
execution. Missing/unavailable/tampered inputs fail that required setup and
leave the case non-passing; a raw optional skip is not an accepted disposition.
These capabilities are not a prerequisite for the small local sanity gate.
Metadata/audit-count/unit doubles cannot substitute for actual signature,
certificate and transparency positives/negatives on the same statement bytes.

For the authorized description boundary, T-PRD084 uses pure
`preparePrDescription`/offline CLI first, then exact receipt-bound PR permission,
intent and existing operation with transient body and bounded digest/version
bindings. A trusted provider fixture must enforce atomic update conditions,
preserve unrelated body text and reject absent authority, wrong source/body/
version, ambiguous matches and callbacks without conditional support. Preserve
uncertain effects for actual verifier-backed reconciliation; no blind rewrite
or sidecar. Existing field-absent APIs and historical records remain intact.

### 12.1 Joined readiness report procedure

The actual report adapter consumes a version-1 manifest of retained result
references, not a session-authored status aggregate:

| Input field | Required meaning |
| --- | --- |
| `schemaVersion`, `kind` | `1`, `repository-readiness-inputs` |
| `candidate` | Independently selected `sourceCommit`, `testSpecDigest`, and optional common `sourceDigest` / `configurationDigest`; an optional common digest must match every referenced execution |
| `checkpoints` | L/PR/R-PRE/R-POST/A/OBSERVERS maps to `{ id, filename, sha256, size }` references |
| `benchmark`, `protections` | Optional references of the same bounded shape; missing proof is an explicit limitation |
| `releaseHistory` | References retaining each original physical channel/attempt outcome |
| `limitations` | Explicit unavailable/blocked capabilities, not exemptions relabelled Passed |

1. Read exact literal relative files and verify size/hash before parsing; reject
   escape/executable inputs. Derive L's exact finite sanity assertion selection
   from section 3.1 and each later profile's current explicit membership from
   section 2.1.1, keeping T-PRD019 in OBSERVERS. Never derive L from all
   development-machine rows or reuse the old 69-case denominator. Preserve
   independent-project and native/tool assertion namespaces.
2. A trusted host supplies per-reference expected specification/context and
   public evidence verifier. Reconstruct through `readEvidenceBundle`.
   Missing independent expectations/verifiers cannot be repaired with saved
   Passed JSON. Compare real benchmark/protection/release records using
   trusted side-verifier report/candidate digest bindings.
   Keep differing platform/profile configuration identities in those independent
   per-reference contexts; do not put one lane's digest in a field claiming a
   common candidate configuration. L additionally requires its actual finite
   profile, automated local host role and independently derived source catalog;
   a different opt-in profile cannot claim L merely by copying its case shape.
3. Effective protection outcome must itself be Passed, not merely have verified
   origin. Timing ratios need an equivalent verified passing comparison.
   Missing/incompatible/cancelled/failed evidence and all historical attempts
   remain visible with exact current counts and blockers.
4. Invoke the real composition boundary or its offline CLI:

```sh
node scripts/release-report.mjs --manifest-file "$RETAINED_REPORT_INPUTS" --plan-file docs/sdlc/public-readiness/test-plan.md --output-dir "$NEW_OWNED_REPORT_DIRECTORY"
```

The output is readiness.json/md. Offline CLI has no implicit verifier
capability and is unverified by default. Component T-PRD070 tests validate the
adapter's join/rejection behavior; they do not execute hosted T-PRD056 or the
actual T-PRD074 end-to-end self-use observation. Those cases require separately
authorized original provider/native/public evidence and clean retrieval.

Maintain immutable original execution records. A later failure, changed tested
dependency or unknown impact invalidates affected current credit; a completed
older pass does not mask it. Keep generation/activity/blocked diagnostics separate
from Passed/Failed/NotRun. An authorized lifecycle override can permit an unmanaged
tool action but cannot grant Passed evidence, publish permission or provider
policy bypass. Consumer-controlled real CI/publisher gates enforce their own
configured readiness contract.

## 13. Test completion criteria

A selected validation profile is complete only when its expected case/platform
inventory is reconciled, every required case has valid matching passing evidence,
cleanup assertions succeed and no required capability remains blocked.
Unexecuted cases remain NotRun; failed, incomplete or stale runs cannot satisfy
the profile. Each profile uses its explicit membership from section 2.1.1 rather
than treating every later-stage case as a prerequisite for earlier tests.

Report actual results and unresolved limitations separately for local, PR,
release-prepublication, postpublication and readiness-acceptance tests.
