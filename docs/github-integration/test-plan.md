# Test Plan: Grounded GitHub SDLC delivery

## Living plan and current denominator

This is the existing `github-integration` Test Plan for `wi-github-integration`.
The [current Requirements](requirements.md) define FR-140 through FR-151 and
50 acceptance conditions. Historical approved snapshots/evidence remain in
their actual ledger references; this maintenance neither rewrites approval
history nor asserts new approval, execution or Review.

The current release denominator is **133 individually identified cases**:
22 core claims with four independently executed P/N/G/D variants (88 cases),
36 local boundary/gate cases, one candidate Review, four conditional CI cases
and four separately authorized read-only acceptance cases. Endpoint, factory,
module and former native-catalog counts are not acceptance denominators.
Current case statuses and execution references appear in the canonical table.
Each new candidate starts **NotRun**; implementation mapping/readiness,
availability, blockers and evidence are separate from actual execution status.

The canonical definitions at the end are the only executable-definition and
status table. Earlier C/B/R/CI/L rows describe their assertions, not additional
tests. The installed parser consumes that existing table format; it does not
recognize a fenced `sdlc-tests` manifest. Its currently installed cycle validator
is limited to 100 definitions and cannot start this complete 133-case plan.
The worktree's referenced-catalog validator supports the complete plan; schema
compatibility is not permission to update the active installation or cycle.

The [acceptance bindings](acceptance-bindings.json) identify the exact executable
assertions for every retained local case and the separate command, Review, CI
and live procedures. They also retain all 24 Azure baseline joins and nine
result families. Bindings are not passing evidence. Native Node event reports,
unchanged source, the exact candidate/specification/configuration and successful
required assertions establish execution; a missing, skipped or foreign assertion
cannot inherit a suite total. Historical approval and prior results remain
separate from this maintenance.

No required case is passed by a document label, a manifest entry, an old pass,
another variant or a result from a different candidate/spec/configuration.
Only actual matching execution updates a case to `Passed` or `Failed`.
Skipped, blocked, unselected and unauthorized cases remain `NotRun` with a
separate reason. Applicable mandatory cases cannot silently disappear from
the denominator. Report local, Review, CI and live totals separately; no
blanket live/full-product pass from a selected local subset.

## Fixture and execution contract

The core and B cases are automated local unit/contract/integration assertions,
owned by the coding agent and executed at `pre-review` on the development host.
Use actual public provider, Store/CLI/monitor/operation consumers with injected
authorized-tool/transport doubles. Never mock the consumer being established,
use ambient credentials, contact a real provider or mutate live resources.

Every core claim has four distinct IDs, `T-GHCnn-P`, `T-GHCnn-N`,
`T-GHCnn-G` and `T-GHCnn-D`:

- **P**: admit exactly the stated proven outcome through its real consumer,
  with independently supplied source/context and scoped fixture authority.
- **N**: change the stated identity/contract condition; assert a specific safe
  rejection or refused stronger claim and unchanged prior current evidence.
- **G**: omit the stated necessary proof; retain an explicit gap/limited/
  uncertain outcome, never a successful stronger claim or inferred absence.
- **D**: inject the supported provider/tool/host permission denial or unavailable
  contract for that exact scope. Assert the distinct sanitized diagnostic and
  no completion/absence/permission fallback. Do not invent a denial endpoint.

Pin the actual connection/profile and request/response semantics. Assert target,
method/arguments, request association, result state and exact consumer effect,
not truthiness, wrapper counts or name presence. For writes, match a separate
fixture grant and atomic claim; the expected effect must not manufacture its
own proof. Independently mutate identity and missing-proof axes.

Use immutable fixtures, explicit clocks/IDs, unique isolated repositories/homes
and native process isolation. Await exact owned cleanup on success and failure.
Record only safe source/spec/config/candidate identities, selected case IDs,
actual command/exit/counts and sanitized evidence references. No raw response,
logs, causes, private handle values or user-path copies belong in this plan.

## Core assertion selection

The surface column identifies existing consumer ownership and intended test
selection, not a passing implementation claim. The actual facade retains 28
exports from seven nested modules: connection, execution-adapter, host,
repository, schemas, store-bridge and transport. PR/check/result/artifact
acquisition uses the manually supplied six existing verifier callbacks, not
removed native operation factories. Direct test/fixture and isolated package
adaptation remains separate from this plan's unchanged `NotRun` statuses.

| Claim | Exact AC mapping | P: proven outcome | N: rejected boundary | G: missing proof | D: denied/unavailable boundary | Consumer surface |
|---|---|---|---|---|---|---|
| C01 | AC-140.1, AC-140.3 | Stable repository/workflow/run and distinct attempt normalize and admit | Another/latest attempt cannot satisfy selected attempt | Missing attempt/capability prevents exact-attempt proof | Exact run/attempt read denied | Provider adapter / monitor |
| C02 | AC-140.2 | Actual accessible human page identifies exact run/attempt | Login/API/credential URL or changed redirect cannot establish access | Metadata without page-access observation remains unverified | Page-access host permission denied | Adapter / monitor link verification |
| C03 | AC-141.1, AC-141.2, AC-141.4 | Canonical checkout and independently selected fetch/push identities admit | Similar URL or wrong effective push destination rejects | Missing independent destination proof cannot authorize publication | Exact selected repository read denied | Repository observation |
| C04 | AC-141.3 | Authenticated selected/default full ref maps to exact full revision | Prefix-match/unrelated revision/stale default rejects | Branch name without branch-to-commit fact stays unverified | Exact ref read denied | Repository / branch consumer |
| C05 | AC-142.1, AC-149.1 | Exact PR and independent base/head/fork facts admit | Base proof cannot establish another fork/head or unrelated PR | Missing source-repository/ref join prevents readiness | PR or independent source read denied | PR observation / publication context |
| C06 | AC-142.2, AC-142.3, AC-142.4 | Run/attempt/job/check/producer/PR and tested checkout join admits | Same name/SHA, test-merge or wrong App cannot establish selected check | Missing producer/checkout/test selection remains explicit gap | Exact check/job evidence read denied | Check / validation consumer |
| C07 | AC-142.5 | Increasing observation sequence and current source/context admit | Delayed/stale/archived/revoked evidence cannot replace current facts | Missing current producer/context prevents current admission | Current-context verifier denies admission | Current evidence / retention |
| C08 | AC-143.1, AC-143.2, AC-143.3, AC-143.4, AC-143.6 | Exact causal hosted execution terminal result admits under pinned contract | Similar-run search, wrong run or local build relabel rejects | Empty acknowledgement without supported association remains accepted/uncertain, not completed | Execution tool denies exact requested effect | `execution` result |
| C09 | AC-143.1, AC-143.3, AC-150.1 | Exact selected test/candidate/config/job outcome admits | Green aggregate/unselected report cannot satisfy test | Missing producer/selection or required deployment context remains gap | Required test/result source unavailable | `test` result |
| C10 | AC-143.1, AC-144.1, AC-144.2, AC-144.4, AC-144.5 | Exact immutable artifact/producer/attempt/source/config/bytes admits | Wrong producer, mutable retrieval alias or history inferred from empty list rejects | Nullable digest/attempt without independent proof remains unverified | Exact artifact or producer retrieval denied | `artifact` result / verifier |
| C11 | AC-143.1, AC-150.2, AC-150.3, AC-150.4 | Exact selected artifact/environment/target/config/deployment and required target tests admit | Another candidate/target or approval-only status cannot complete deployment | Missing artifact/deployment/test join remains limited | Authorized destination's deployment/result tool denies | `deployment` result |
| C12 | AC-143.1, AC-143.3, AC-149.3 | Exact requested PR destination/head/base/state and causal result admit | Similar discovered PR or wrong destination cannot complete action | Lost request-result association remains uncertain | Exact PR write denied despite valid read | `pull-request` result |
| C13 | AC-143.1, AC-143.3, AC-149.3 | Exact destination/full ref/revision and requested publication/deletion prove result | Local commit/other remote/ref or ordinary grant for deletion rejects | Push acceptance without supported resulting-ref proof remains uncertain | Selected push/ref effect denied | `git-ref` result |
| C14 | AC-143.1, AC-143.3, AC-149.2, AC-149.3 | Exact authorized PR/head/base/method and terminal merged revision admit | Test-merge SHA/auto-merge configuration or wrong method cannot prove merge | Accepted/pending request without terminal causal merge remains pending | Exact merge denied by host/provider policy | `merge` result |
| C15 | AC-143.1, AC-143.5, AC-149.2, AC-149.3 | Exact separately authorized target/version/requested policy effect admits | Ordinary merge grant cannot authorize privileged auto-merge/configuration/bypass | Configuration existence without requested-effect association remains limited | Exact policy change denied | `policy` result, not administration SDK |
| C16 | AC-143.1, AC-143.5, AC-151.1 | Exact causal publication to selected GitHub target admits | Publication/thread facts cannot establish personal delivery/read | Missing target/result association prevents publication credit | Exact notification publication denied | `notification` result |
| C17 | AC-145.1, AC-145.2, AC-145.3, AC-145.4 | Six manually supplied existing verifiers wire real Store/CLI/monitor on selected home with explicit host inputs | Wrong home, self-attested JSON/code loading or disconnected parser rejects | Missing trusted verifier/acquisition cannot admit provider facts | Explicit connection/tool scope denied | Seven-module facade / Store / `runCli` |
| C18 | AC-147.1, AC-147.2, AC-147.3, AC-147.4, AC-147.5, AC-148.1 | Exact sources ground DoD; every Azure obligation and retained core claim maps to real assertion | Catalog count, fixture-only feature or selected subset cannot establish parity | Missing relevant source/proof join stays an explicit implementation/evidence gap | Required source/tool read unavailable | Grounding / baseline mapping |
| C19 | AC-148.2, AC-148.3, AC-146.4 | Current canonical artifacts/source/context transfer without replacing approved history | Labels/source text/review report cannot manufacture consent | Missing captured decision/context prevents managed stage credit, not host execution | Actual host denial stays distinct from advisory stage finding | Core stage handoff / decision consumer |
| C20 | AC-149.1, AC-149.2, AC-149.3, AC-146.2 | Exact current Review/provider review/check/policy facts independently establish stated readiness | Green CI or stale Review cannot authorize push/merge/bypass | Missing required review/check/producer fact stays incomplete | Actual publication/IAM policy denial is explicit | PR readiness / Review boundary |
| C21 | AC-150.1, AC-150.2, AC-150.3, AC-150.4 | Exact release/version/asset bytes and deployment context follow selected candidate without implicit promotion | Mutable tag/release label or unrelated bytes cannot establish delivered candidate | Missing production/destination join prevents completed release/deployment claim | Selected publication/environment tool denied | Artifact / operation / environment handoff |
| C22 | AC-151.2, AC-151.3, AC-151.4, AC-146.3 | One atomic exact claim and read-only reconciliation retain attempt/source; real polling/link proofs remain separate | Duplicate/stale operation or link metadata cannot establish current result/access | Lost response/scheduler/read/causal proof remains uncertainty or monitoring gap | Reconciliation read denied; no automatic mutation retry | Operations / recovery / monitor |

Each C claim expands to its four full P/N/G/D IDs in the canonical table.
Every variant has its own status; no status is inherited from a claim or rollup.

## Local authority, recovery, handoff and validation cases

These 36 distinct cases are additional assertions, not extra native features.
All are local automated `pre-review` cases; use targeted real consumer tests
for B01-B29 and the existing runner/package boundaries for B30-B36.

| Case | AC mapping | Exact required assertion / selection |
|---|---|---|
| B01 | AC-141.4, AC-143.4, AC-151.1 | Exact separate grant permits only the fixture action and selected target; no live network |
| B02 | AC-141.4, AC-151.1 | Missing grant rejects dispatch despite verified facts and provider write capability |
| B03 | AC-142.5, AC-151.1 | Revoked grant cannot dispatch or confer current result credit |
| B04 | AC-151.2 | Consumed one-shot authority cannot dispatch again |
| B05 | AC-141.4, AC-151.1 | Grant for another repository/item/destination cannot authorize selected effect |
| B06 | AC-141.2, AC-149.3 | Wrong full ref/revision grant cannot authorize selected push/delete |
| B07 | AC-149.2, AC-151.1 | Different action grant cannot authorize selected effect |
| B08 | AC-143.5, AC-149.2 | Ordinary publication/merge authority cannot enable auto-merge, force-push, delete or bypass |
| B09 | AC-149.2, AC-150.3 | Provider approval/local success do not complete Review/DEV/STAGING or authorize promotion; PROD stays recommendation-only |
| B10 | AC-143.4, AC-150.3 | Scope/read permission does not authorize live dispatch/push/PR/release/publication/deployment |
| B11 | AC-151.2 | Concurrent exact claims yield one durable dispatch and one causal operation |
| B12 | AC-151.2 | Missing IAM callback/non-true authorization, pre-aborted signal or cancellation during resolving/rejecting awaited IAM rejects before atomic claim; preparation stays unclaimed and no effect occurs |
| B13 | AC-145.4, AC-151.3 | Interruption after persisted claim/restart reconciles exact handle read-only; lost response never triggers blind redispatch |
| B14 | AC-142.5, AC-151.3 | Delayed sequence, changed source/spec/config/candidate/destination cannot replace current evidence; history remains |
| B15 | AC-142.5, AC-144.3 | Archived/unavailable producer cannot establish a current artifact/result |
| B16 | AC-143.6 | Local build/test outcome remains local with correct core handling |
| B17 | AC-144.3 | Changed retrieval bytes/digest contradiction explicitly fail integrity; warning is not pass |
| B18 | AC-144.2 | Missing provider digest/attempt can admit only with supported independent exact producer/byte proof |
| B19 | AC-144.3, AC-144.4 | Expired/deleted/inaccessible artifact stays unavailable, not historical absence or unrelated producer reuse |
| B20 | AC-145.2 | Ordinary CLI rejects unverified facts and executable repository JSON with zero network calls |
| B21 | AC-145.1, AC-145.3 | Import/construction performs no acquisition, registration, credential lookup or effect |
| B22 | AC-145.3, AC-151.1 | Responses, private handles/paths, signed URLs, causes/getters and fake secrets cannot leak via output or durable evidence; safe explicit diagnostic remains |
| B23 | AC-145.4 | Success/failure cleanup awaits exact owned paths/process IDs/registrations and surfaces cleanup failure without broad deletion |
| B24 | AC-146.1, AC-147.2, AC-147.3, AC-147.4 | Every current AC, 24 Azure IDs and nine families maps to executed assertions; duplicate/orphan/unselected/stub/old-pass evidence rejects |
| B25 | AC-148.2 | Canonical maintenance updates current digest without replacing historical approval or gaining consent from labels |
| B26 | AC-148.3 | Explicit user stage override proceeds through host permissions; bad bookkeeping stays truthful/uncredited and hook remains advisory |
| B27 | AC-148.2, AC-151.2 | Current context acknowledgement binds actual source/spec/config/member; another branch cannot inherit Coding authority |
| B28 | AC-148.2, AC-148.3 | Decisions require captured matching user input; replay/foreign receipt, source text and review labels cannot create authority |
| B29 | AC-146.2 | Candidate-changing fix resets current evidence and repeats full unit-first local checkpoint; prior cycles remain historical |
| B30 | AC-145.4, AC-146.1 | `npm run test:unit` preserves exact fast 16-case selection/accounting, not 16 files or full acceptance |
| B31 | AC-146.1, AC-146.2 | `test:targeted` selects every retained provider/consumer variant and boundary ID; missing/skipped cases cannot pass |
| B32 | AC-145.4, AC-146.2, AC-147.2 | `npm test` preserves original Azure/offline/storage/recovery regressions and exact full discovery/pass/fail/skip accounting |
| B33 | AC-145.4, AC-146.2 | `npm run check` validates actual retained source without weakened diagnostics |
| B34 | AC-144.1, AC-145.4, AC-146.2 | `npm run package:artifact` produces reproducible exact package bytes/identity and no private/session content |
| B35 | AC-145.1, AC-145.4, AC-146.2 | `npm run verify:package` proves facade plus exact seven nested modules/28 public exports, selected-home Store and missing-required-module preflight without deleted native backends/source-checkout/default-home fallback |
| B36 | AC-145.4, AC-146.2 | Actual available native Node >=22/platform/path/process contract checks pass dependency-free; simulated or unavailable native platform is not credited |

## Separate Review, CI and read-only acceptance cases

Review is not a prerequisite for its own pre-review checkpoint. CI and live
cases need actual provider access and independently authorized actions/reads.
No execution, live access, publication or environment authority is granted by
this plan or its maintenance. A conditioned case stays `NotRun` until its
prerequisite and actual evidence exist.

| Case | AC mapping | Checkpoint / mode / owner / location | Exact required assertion |
|---|---|---|---|
| R01 | AC-146.2, AC-146.4, AC-149.2 | review / automated built-in review / user / development-machine | Normal `/review` using current GPT-6.1 Sol/max assesses exact locally validated candidate/spec/config; blocking findings return to Coding; no manufactured approval |
| CI01 | AC-145.4, AC-146.2, AC-150.4 | post-review / automated / provider / GitHub-Actions | After authorized publication/trigger, actual exact source/run/attempt unit checks and required matrix pass |
| CI02 | AC-146.1, AC-146.2, AC-150.4 | post-review / automated / provider / GitHub-Actions | Actual targeted retained case IDs/counts/outcomes match selected candidate |
| CI03 | AC-145.4, AC-146.2, AC-147.2 | post-review / automated / provider / GitHub-Actions | Actual full regression discovery/outcomes and required platform/version matrix pass, without hidden skips |
| CI04 | AC-145.4, AC-146.2, AC-150.4 | post-review / automated / provider / GitHub-Actions | Actual static/package/export checks and resulting artifact identity match source/run/attempt |
| L01 | AC-141.1, AC-141.2, AC-141.3, AC-146.3 | pre-review / semi-automated read / agent / development-machine | Exact authenticated repository/selected fetch and push URLs/default and selected full refs/revisions admit through current consumers, without write authority |
| L02 | AC-142.1, AC-142.2, AC-142.3, AC-142.4, AC-146.3 | pre-review / semi-automated read / agent / development-machine | Exact actual PR/base/head and available producer/check associations admit; absent fork/checkout/test-selection facts remain unverified |
| L03 | AC-140.1, AC-140.2, AC-140.3, AC-146.3, AC-151.4 | pre-review / semi-automated read / agent / development-machine | Actual exact run/attempt/jobs and independently accessible human page admit; unsupported rerun/history/polling capability stays explicit gap |
| L04 | AC-144.1, AC-144.2, AC-144.3, AC-144.5, AC-150.2, AC-150.4 | pre-review / semi-automated read / agent / development-machine | Available selected delivery artifact/release/deployment facts bind exact bytes/producer/attempt/source/destination; missing associations stay unverified, never manufactured by writes |

## Azure and result-family traceability

| Retained baseline / family | Required selection |
|---|---|
| ADO-01..03, ADO-14 | C01 |
| ADO-04, ADO-05, ADO-15 | C02, C06 |
| ADO-06, ADO-24 | C17, B35 |
| ADO-07..09 | C03 |
| ADO-10 | C04 |
| ADO-11..13 | C05, C07 |
| ADO-16, ADO-17, ADO-18, ADO-19 | C08, C09, C10, C11 respectively |
| ADO-20, ADO-21, ADO-22 | C12, C13, C14 and C15 |
| ADO-23 | C08..C16, C22 |
| Nine required result families | C08..C16 each owns its P/N/G/D quartet |

## Required validation sequence

After any candidate-changing implementation/test/configuration fix, start fresh
current evidence, run `npm run test:unit` first, then the complete retained
unit/provider/consumer selection with the existing portable `test:targeted`
runner. The retained direct selector surfaces are
`test/github-identity-foundation.unit.test.mjs`,
`test/github-transport.unit.test.mjs`,
`test/github-operation-results.unit.test.mjs`,
`test/github-existing-consumer-boundaries.unit.test.mjs` and
`test/github-packaging.test.mjs`. These are previously identified surfaces,
not a reconciled test-owner selector handoff. The test owner adapts their direct fixtures,
nine-family/bridge assertions and isolated package expectations; the parent
records the actual final selector/evidence mapping. Remove excluded native
administration tests rather than skipping them or restoring deleted code for
green results. These filenames are not a claim that adaptation or execution
has passed, and no removed native surface is a compulsory selector.

Run remaining local boundary/handoff tests, `npm test`, `npm run check`,
`npm run package:artifact` and `npm run verify:package`. Apply existing relevant
platform/distribution checks at their declared checkpoint; never install into
the active user home. Reconcile actual case selection, counts, exits and current
source/spec/configuration evidence. These 124 local cases and the separately
authorized pre-review live claims have distinct results; unavailable live proof
remains a corresponding acceptance gap, not fake local failure or success.

Only after required current pre-review evidence is satisfied does the normal
built-in final `/review` boundary apply. A fix repeats unit-first validation and
Review. Record Review completion only with its actual result and matching user
decision; it grants no push/PR/merge/DEV authority.

### Instruction correction and evidence supersession

The authorized instruction maintenance retains the 133-case denominator.
`test/instructions.test.mjs` adds a T-37 regression for bounded discovery,
original-versus-current evidence comparison, explicit invalidation/reset,
dependency/checkpoint propagation, whole-candidate/full-cycle precedence and
exactly two good/two bad examples. It also distinguishes orientation
acknowledgement from comprehension, test success and authority.
`test/cli-install.test.mjs` verifies that the installed entry retains the recovery
rule and every focused guide matches the canonical current source bytes.
These assertions are included in the existing full-regression gate T-GHB32;
T-GHB34/35 establish current package/install integrity, and T-GHR01 reviews
instruction meaning and consistency. Text assertions do not prove LLM adherence.

The Linux T-51 regression retains OS-enforced HTTP(S) and direct-npm rejection.
Its command-lookup control first proves that the isolated shell resolves the
allowed Node path, then checks npm absence without assuming that every POSIX
shell reports a missing command with the same exit code. Shell/boundary errors
and unexpectedly discoverable npm must still fail.

The previous frozen evidence remains historical under
`.test-data/github-retained-final`: Linux full regression failed one test;
Windows completed unit/targeted results remain intact and its unfinished full
run was interrupted before input changes, with source verification and reason
in `final-windows-supersession.json`. No old whole-candidate pass transfers to
this correction. Current canonical cases remain `NotRun` until matching
execution; the complete required local checkpoint is unchanged.

### Historical rejected-IAM cancellation repair checkpoint

The previous full Windows checkpoint passed with exit 0: 1,174 passed,
zero failed and 27 skipped among 1,201 tests, with no cancellations or todos
(`reduced-confirmation-contract-full.log`). All 226 source-manifest entries,
branch/HEAD and package digest were reverified unchanged after completion.
Its built-in Sol/max re-review returned **ChangesRequired**, with one Medium
finding: an IAM callback rejecting after signal cancellation could propagate
the private rejection reason instead of the fixed `AbortError`.
The active-ID protection and bounded-reader/test-contract repairs had no
remaining blocking finding. This assessment is recorded in
`reduced-final-sol-review-rejected-iam-findings.json`; it is not a receipt-bound
Review completion, approval or publication authority.

The public real-Store cancellation regression now includes IAM resolving after
cancellation, IAM rejecting through `signal.throwIfAborted()` with default,
private-error and private-object reasons, and an ordinary non-cancellation
authorization error. The before-fix selection failed: ten passed, five failed
among 15 counted tests, including failed parents, with zero skips and exit 1
(`reduced-rejected-iam-before.log`). Only the three rejecting-cancellation
variants failed their fixed error assertions; the original cancellation paths
and ordinary-error control passed.

The host now checks cancellation when awaited authorization rejects, without
examining the rejected value's reason, cause or getters. An aborted signal
produces the existing fixed `AbortError`; an ordinary authorization rejection
remains the original explicit error. The exact in-flight claim is released
through the existing `finally`. Regressions retain unchanged durable
record/checkpoint bytes, prepared/unclaimed status, zero effects, no private
getter reads and identity-preserving ordinary-error assertions.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Before-fix real-Store rejected-IAM selection | Failed; ten passed, five failed among 15 counted tests including failed parents; zero skips; exit 1 | `reduced-rejected-iam-before.log` |
| Fresh Windows unit-first profile | Passed; 16/16; zero skips; exit 0 | `reduced-rejected-iam-unit16.log` |
| Complete Windows retained boundary, all nine host result families and catalog/evidence unit selection | Passed; 453/453 across ten files; zero skips; exit 0 | `reduced-rejected-iam-targeted.log` |
| Windows IAM/claim, reader/lock, active-ID and artifact-race regressions | Passed; 33/33; zero skips; exit 0 | `reduced-rejected-iam-regressions.log` |
| Native Linux Node v22.23.3 x64 unit-first profile | Passed; 16/16; zero skips; exit 0 | `reduced-rejected-iam-linux-unit16.log` |
| Native Linux resolving/rejecting IAM, ordinary rejection, concurrent claim and denial guards | Passed; 19/19; zero skips; exit 0 | `reduced-rejected-iam-linux-regressions.log` |
| Static and isolated package gates | Passed; 135 JavaScript modules; 72 packaged files; seven GitHub modules, 28 exports and six constructors; exit 0 | `reduced-rejected-iam-static.log`; `reduced-rejected-iam-verify-package.log` |
| Repeated package build | Passed; byte-identical SHA-256 `a4d9b13da0c485fbf30047c27b8d6d17b8a0ba9ba923efc1f5ffceb1430ad1b7` | `reduced-rejected-iam-package.json` |
| Full native-launcher Windows regression | Passed; 1,180 passed, zero failed and 27 skipped among 1,207 tests; no cancellations or todos; exit 0 | `reduced-rejected-iam-full.log` |
| Post-full source/package reverification | Passed; all 226 frozen source entries, selected paths, branch/HEAD and package digest unchanged | `reduced-rejected-iam-post-full-pin.json` |
| Built-in candidate re-review assessment | NoBlockingFindings; GPT-6.1 Sol/max; all prior blocking findings closed; assessment only | `reduced-final-sol-review-closure-assessment.json` |

The full run and closure review assessed the frozen source manifest
`957c4095216486d0ab6e1a74b9b66a68530a5431fbe582860308384be0198db8`,
not a manufactured framework candidate or approval. The review closed rejected
IAM cancellation, ordinary-error/in-flight cleanup, active-ID protection and
bounded-reader/test-contract findings. This outcome-only maintenance changes
no canonical definition or case status and no runtime/test/configuration.

Canonical cases remain `NotRun` without complete assertion/selector
correspondence and matching candidate/cycle-bound evidence. A clean assessment
does not create receipt-bound Review completion, user approval or publication/
environment authority. Platform, isolation, installed-cycle compatibility,
CI/live and native WinGet acceptance gaps remain explicit.

### Historical bounded-confirmation contract checkpoint

The launcher-enabled full Windows checkpoint returned exit 1: 1,173 passed,
one failed and 27 skipped among 1,201 tests, with no cancellations or todos
(`reduced-file-confirmation-fix-full.log`). The only failure was an exact
read-count assertion in the immutable validation-object regression: mutation
was correctly rejected with `STALE`, but the test still expected the former
single-confirmation limit. All 226 pinned source files and the package digest
were reverified unchanged after the run. The original artifact-race test did
not fail in this checkpoint.

The unchanged selector reproduced the count failure before correction.
The test now requires exactly one handle, three data passes, six read calls,
four handle stats and one close when content changes during the first
confirmation. It still requires `STALE`, exact changed on-disk bytes and
subsequent `DIGEST` rejection through the immutable-object consumer. This is
test-contract maintenance for the bounded two-confirmation reader, not a
runtime change, added retry or weakened integrity assertion.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Post-full source/package reverification | Passed; 226 files unchanged; package SHA-256 unchanged | `reduced-confirmation-contract-post-full-pin.json` |
| Unchanged before-correction mutation selector | Failed; zero passed, one failed; exit 1; three data passes versus old two-pass assertion | `reduced-confirmation-contract-before.log` |
| Fresh Windows unit-first profile | Passed; 16/16; zero skips; exit 0 | `reduced-confirmation-contract-unit16.log` |
| Windows retained GitHub boundary and complete catalog/evidence unit selection | Passed; 422/422 across nine files; zero skips; exit 0 | `reduced-confirmation-contract-targeted.log` |
| Windows reader, lock, review-fix and artifact-race regressions | Passed; 23/23; zero skips; exit 0 | `reduced-confirmation-contract-regressions.log` |
| Fresh native Linux Node v22.23.3 x64 unit-first profile | Passed; 16/16; zero skips; exit 0 | `reduced-confirmation-contract-linux-unit16.log` |
| Native Linux catalog, immutable mutation, reader and lock guards | Passed; 15/15; zero skips; exit 0 | `reduced-confirmation-contract-linux-regressions.log` |
| Fresh static and isolated package gates | Passed; 135 JavaScript modules; 72 packaged files; seven GitHub modules, 28 exports and six constructors; exit 0 | `reduced-confirmation-contract-static.log`; `reduced-confirmation-contract-verify-package.log` |
| Repeated package build | Passed; byte-identical SHA-256 `63bbe3b8afff0ec8b344d2b73d6182feb5049cb069c7b752fea3bf3560078b68` | `reduced-confirmation-contract-package.json` |

Its subsequent full Windows checkpoint passed 1,174 tests with zero failures
and 27 skips among 1,201 tests (exit 0); the actual currentness check and
following built-in review are recorded in the current repair checkpoint above.
That review required another runtime repair, so this evidence is historical,
not validation of the changed host. All canonical case and Review statuses
stay `NotRun` without complete assertion/selector correspondence, matching
candidate/cycle-bound evidence and the required captured decision. Platform,
isolation, installed-cycle compatibility, CI/live and native WinGet acceptance
gaps remain explicit.

### Historical bounded-reader reliability checkpoint

The post-review full Windows run returned exit 1: 1,167 passed, one failed and
27 skipped among 1,195 tests, with no cancellations or todos
(`reduced-review-fix-final-full.log`). The failure was in fixture Coding setup,
before artifact verification: a portable-manifest read failed the reader's
single bounded confirmation check. The unchanged artifact test passed alone;
that result did not replace or relabel the failed full checkpoint.

A deterministic reader regression reproduced rejection of unchanged bytes
while metadata was still settling. The reader now permits at most two
additional bounded confirmation passes. Every pass must preserve the original
bytes, device/inode and size; completion requires one stable metadata pass.
Changed content, identity or size is never retried, and continued metadata churn
still rejects `STALE`. No capacity limit, artifact/currentness assertion or
authority check was weakened.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Before-fix deterministic coherence selection | Failed; two passed, two failed; exit 1; unchanged settling metadata rejected | `reduced-file-confirmation-before.log` |
| Fresh Windows unit-first profile | Passed; 16/16; exit 0 | `reduced-file-confirmation-fix-unit16.log` |
| Reader mutation/coherence, lock guards, review fixes and actual artifact races | Passed; 23/23; zero skips; exit 0 | `reduced-file-confirmation-fix-regressions.log` |
| Native Linux Node v22.23.3 x64 unit-first profile | Passed; 16/16; exit 0 | `reduced-file-confirmation-fix-linux-unit16.log` |
| Native Linux same bounded-reader and lock-guard selection | Passed; 8/8; zero skips; exit 0 | `reduced-file-confirmation-fix-linux-regressions.log` |
| Current static and isolated package gates | Passed; 135 JavaScript modules; 72 packaged files; seven GitHub modules and 28 exports; exit 0 | `reduced-file-confirmation-fix-static.log`; `reduced-file-confirmation-fix-verify-package.log` |
| Repeated package build | Passed; byte-identical SHA-256 `63bbe3b8afff0ec8b344d2b73d6182feb5049cb069c7b752fea3bf3560078b68` | `reduced-file-confirmation-fix-package-reproducibility.json` |

A fresh launcher-enabled full Windows checkpoint and built-in Sol/max re-review
remain required. Current canonical execution and Review credit remain `NotRun`;
the existing platform, isolation, installed-cycle compatibility, CI/live and
native WinGet acceptance gaps have not been waived.

### Historical candidate review repair checkpoint

The built-in code-review agent, using GPT-6.1 Sol with max reasoning, assessed
the locally validated reduced candidate and returned **ChangesRequired**.
It found an active non-operation ID collision in preparation (High) and private
abort reason/cause exposure through the public host (Medium). The actual
assessment is `reduced-final-review-findings.json`, not a passing framework
Review record, user approval or publication authority.

Preparation now rejects an ID belonging to another active record before
operation-history lookup. Real-Store regressions use independent fixtures for
an open conflict without Coding authority, a current cycle and a captured
approval event. Each requires `ID_CONFLICT` and unchanged exact record/checkpoint
bytes. Cancellation now returns a fixed `AbortError` without reading or
retaining the signal's private reason, cause or getters. Default, private-error
and private-object reasons are exercised before dispatch and after awaited IAM,
with unchanged preparation bytes and zero effects.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Before-fix real-boundary regression selection | Failed; zero passed, 13 failed; exit 1; conflict/cycle overwrites and original abort values reproduced | `reduced-review-findings-before.log` |
| Fresh final Windows unit-first profile | Passed; 16/16; exit 0 | `reduced-review-fix-final-unit16.log` |
| Protected record IDs and public cancellation selection | Passed; 13/13; zero skips; exit 0 | `reduced-review-fix-final-regressions.log` |
| Native Linux Node v22.23.3 x64 unit-first profile | Passed; 16/16; exit 0 | `reduced-review-fix-linux-unit16.log` |
| Native Linux same real-boundary regression selection | Passed; 13/13; zero skips; exit 0 | `reduced-review-fix-linux-regressions.log` |
| Final static and isolated package gates, including API documentation | Passed; 135 JavaScript modules; 72 packaged files; seven GitHub modules and 28 exports; exit 0 | `reduced-review-fix-final-static.log`; `reduced-review-fix-final-verify-package.log` |
| Final repeated package build | Passed; byte-identical SHA-256 `a6a19ad7e99a63e61a991b7d92df76c0f3e94ed19c84639963f25ab0df0461a4` | `reduced-review-fix-final-package-reproducibility.json` |

These source/test fixes make the earlier full checkpoint and review historical.
A fresh launcher-enabled full Windows checkpoint and built-in candidate
re-review are required. Current canonical case and Review statuses remain
`NotRun` without matching candidate/cycle-bound evidence and the required
captured decision. Existing platform, isolation, installed-cycle compatibility,
CI/live and native WinGet acceptance gaps remain explicit.

### Historical retained-core repair checkpoint

The earlier full Windows run failed with 1,132 passes, 11 failures and 37 skips
among 1,180 tests (exit 1; `reduced-final-windows-full.log`). It predates the
host fix and is historical, not current acceptance. Selected current-source
reproductions established retained-core failures rather than treating the old
run as current evidence.

The repair preserves the 262,144-byte limit: only durably archived observations
obsolete in both original and pending dependency snapshots can be reclaimed
before replacement writes. Store reserves the actual remaining durable
pre-removal peak under the same lock. Historical-proof revalidation remains
available for custom Stores without re-reading already bound real-Store
history. A changing recovery-guard owner stays contention, not permission to
steal the guard. The deterministic new owner-replacement regression failed
before the fix and passed afterward.

The deployment fixtures now reject stale local evidence after an empty commit
and mutate/restore the exact owned terminal operation to exercise the actual
DEV target-denial diagnostic without introducing malformed archived identities.
They do not weaken runtime admission or fabricate new production evidence.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Fresh Windows unit-first profile after the final fixture correction | Passed; 16/16; exit 0 | `reduced-core-fix-final-unit16.log` |
| Initial thirteen-selector repair check | Failed; 12 passed, one deployment fixture failed; exit 1; the other original failures and new guard selector passed | `reduced-core-fix-regressions.log` |
| Corrected deployment chain and exact target-denial selector | Passed; 1/1; exit 0 | `reduced-core-fix-deployment.log` |
| Current static checks | Passed; 135 JavaScript modules; exit 0 | `reduced-core-fix-static.log` |
| Current package and isolated verification | Passed; 72 packaged files; seven GitHub modules, 28 exports and six constructors; exit 0 | `reduced-core-fix-package.log`; `reduced-core-fix-verify-package.log` |
| Current repeated package build | Passed; byte-identical SHA-256 `4e0bc054214c5c75ba7f93953eb0a2d7df86776df0d7f178d7a1454964a78908` | `reduced-core-fix-package-reproducibility.json` |
| Fresh native Linux Node v22.23.3 x64 unit-first profile | Passed; 16/16; exit 0 | `reduced-core-fix-linux-unit16.log` |
| Native Linux execution-proof and guard/serialization selectors | Passed; 5/5; exit 0; zero failures, cancellations, skips or todos | `reduced-core-fix-linux-contracts.log` |

These are selected local regressions, not a single passing thirteen-case run
or complete product acceptance. A fresh full Windows checkpoint is still
required. All canonical case statuses remain `NotRun` without matching
candidate/cycle-bound evidence; Review, CI and live acceptance remain separate.
No active Copilot-home installation or external effect was performed.

### Historical native Windows channel checkpoint

The repaired-source full Windows run completed with **1,148 passed, zero
failed, 37 skipped and no cancellations or todos** across 1,185 tests (exit 0;
`reduced-core-fix-final-full.log`). Its complete source manifest and package
bytes were unchanged at completion. The 37 skips included eleven cases gated
on a native Windows launcher, one POSIX-only case, 24 macOS cases and one
unavailable authentic historical-installation fixture. They were not passes.

An independently rebuilt Windows x64 PE launcher was then supplied to the
native channel suite. This exposed a fixture-baseline error: PowerShell startup
creates `AppData` in a fresh profile even without running package code. A
Node-only versus PowerShell-only control established that behavior. The fixture
now initializes its isolated native profile before the no-write snapshot;
all layout/overlap assertions and exact target rejection remain intact.
This is a test-only correction; framework runtime and package bytes did not
change. The previous full run remains historical for the exact updated candidate.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Native Windows launcher build | Passed; independent builds byte-identical; Go v1.27.1; x64 PE SHA-256 `b9ab1b78a09535cbfaea75fe98ff692db60b096939e92418b0cac09443c4886b` | `reduced-core-windows-launcher-build.log` |
| Initial launcher-enabled channel check | Failed; 19 passed, one fixture failed, two skipped; exit 1 | `reduced-core-windows-channel.log` |
| Profile-startup control | Passed; Node creates no profile entries; PowerShell creates `AppData` before package code | `windows-profile-layout-probe/result.json` |
| Fresh unit-first profile after fixture correction | Passed; 16/16; exit 0 | `reduced-windows-channel-fix-unit16.log` |
| Corrected native Windows channel suite | Passed; 20 passed, zero failed, two skipped; exit 0 | `reduced-windows-channel-fix-targeted.log` |
| Fresh static and isolated package gates | Passed; 135 JavaScript modules; 72 packaged files; seven GitHub modules and 28 exports; exit 0 | `reduced-windows-channel-fix-static.log`; `reduced-windows-channel-fix-verify-package.log` |
| Package identity after test-only correction | Passed; same byte SHA-256 `4e0bc054214c5c75ba7f93953eb0a2d7df86776df0d7f178d7a1454964a78908` | `reduced-windows-channel-fix-package-reproducibility.json` |
| Fresh launcher-enabled full Windows checkpoint after fixture correction | Passed; 1,158 passed, zero failed, 27 skipped; 1,185 total; no cancellations or todos; exit 0 | `reduced-windows-channel-fix-full.log` |

The two remaining native-channel skips are a POSIX-only shell case and the
Windows network-and-npm-denied lifecycle case. The latter remains `NotRun`
with a capability blocker: no validated Windows per-process isolation adapter
exists. No global firewall change, proxy/shim substitute or passing isolation
claim is permitted. Native WinGet community discovery/install acceptance was
not performed and is not established by building or testing the launcher.

The fresh full Windows checkpoint with the native launcher supplied completed
after this fixture correction. Its complete source manifest and package
bytes stayed unchanged through execution. The 27 skips comprise the Windows
isolation blocker, one POSIX-only case, 24 macOS cases and one unavailable
authentic historical-installation fixture; none receives passing credit.
The built-in candidate Review is next. Canonical case statuses, CI and
separately authorized live acceptance remain `NotRun` without their own matching
evidence and authority.

### Historical host-fix local regression evidence

Before the retained-core repair, the Windows selection completed after the simultaneous-claim fix:
**531/531 passed**, with zero failures, cancellations, skips or todos. Its nine
files include acquisition-binding, identity-foundation, transport, host,
operation-results, existing-consumer-boundaries, host-authority,
provider-consumers and packaging. The actual native runtime was Node v25.6.1,
Windows x64, with four workers. The unit-first checkpoint passed 16/16.

| Local check | Actual result | Sanitized evidence reference |
|---|---|---|
| Unit-first 16-case profile | Passed; exit 0 | `reduced-race-fix-unit16.log` |
| Complete retained nine-suite selection | Passed; 531/531; exit 0 | `reduced-race-fix-retained.log` |
| B11 winner preservation and exact one publication selectors | Passed within the retained selection | `reduced-race-fix-retained.log` |
| B12 missing/non-true IAM and cancellation selectors | Passed within the retained selection | `reduced-race-fix-retained.log` |
| Static source/package metadata checks | Passed; 135 JavaScript modules; exit 0 | `reduced-race-fix-static.log` |
| Package and isolated installed-package verification | Passed; exact seven modules, 28 exports and six constructors; exit 0 | `reduced-race-fix-package.log`; `reduced-race-fix-verify-package.log` |
| Repeated package build | Passed; byte-identical SHA-256 `b9d5964f54b071f527be1f92af70998b2cef2b0d9286bb25b6042b9cb9549671` | `reduced-race-fix-package-reproducibility.json` |
| Native Linux Node v22.23.3 x64 unit-first profile | Passed; 16/16; exit 0 | `reduced-race-fix-linux-unit16.log` |
| Native Linux Node v22.23.3 x64 host-authority and packaging selection | Passed; 24/24; exit 0; two workers; includes B11/B12, cancellation and all nine host result families | `reduced-race-fix-linux-host.log` |
| Current canonical plan/catalog structural integration | Passed; 1/1; exit 0; retains all 133 definitions without execution credit | `reduced-race-fix-canonical-plan.log` |

Evidence references identify session-owned files, not published raw logs or
credentials. These are actual local regression results, not completion of all
124 planned local cases or the 133-case product denominator. Canonical statuses
remain `NotRun` without reconciled candidate/cycle-bound case evidence. The
earlier full Windows run predates the fix and cannot provide current-candidate
full-regression credit. The Linux selection also has zero failures,
cancellations, skips or todos; it is not full native Linux regression.
Current full regression, Review, CI and live acceptance are not asserted by
this table.

Observe actual CI after independently authorized publication/trigger. Maintain
this same plan for any later authorized environment execution with its exact
owner/location/artifact/deployment contract. Current DEV completion, STAGING
promotion and STAGING completion are independent decisions; local or provider
green status never authorizes automatic PROD.

## Canonical sdlc-tests definitions

This existing-format table supplies exactly 133 definitions to `parseTestPlan`.
All 124 local fixture/gate cases use `location: local`; the separate Review,
conditional CI and read-only live groups have their own mode/owner/location.
The four live reads remain `pre-review` evidence obligations, not DEV/STAGING
execution. CI is `post-review` and Review is `review`, never a prerequisite
for itself. The assertion descriptions above supply prerequisites, steps,
rejection/no-admission checks, cleanup and safe evidence requirements.

`Implementation` references name actual bound assertions or exact separate
procedures. The supporting binding file is the machine-readable correspondence.
An executable mapping alone does not establish execution. Status and Evidence
are mutable execution metadata; assertions and required outcomes remain the
specification.

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Expected Outcome | Implementation | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T-GHC01-P | local | unit | pre-review | automated | agent | local | FR-140; AC-140.1; AC-140.3 | Admit exact stable repository/workflow/run and distinct selected attempt | docs/github-integration/acceptance-bindings.json#T-GHC01-P | Passed |  |
| T-GHC01-N | local | unit | pre-review | automated | agent | local | FR-140; AC-140.1; AC-140.3 | Reject another/latest attempt as proof of the selected attempt | docs/github-integration/acceptance-bindings.json#T-GHC01-N | Passed |  |
| T-GHC01-G | local | unit | pre-review | automated | agent | local | FR-140; AC-140.1; AC-140.3 | Missing attempt/capability cannot establish exact-attempt proof | docs/github-integration/acceptance-bindings.json#T-GHC01-G | Passed |  |
| T-GHC01-D | local | unit | pre-review | automated | agent | local | FR-140; AC-140.1; AC-140.3 | Exact run/attempt read denial remains explicit without successful admission | docs/github-integration/acceptance-bindings.json#T-GHC01-D | Passed |  |
| T-GHC02-P | local | unit | pre-review | automated | agent | local | FR-140; AC-140.2 | Admit actual accessible human page for exact run/attempt | docs/github-integration/acceptance-bindings.json#T-GHC02-P | Passed |  |
| T-GHC02-N | local | unit | pre-review | automated | agent | local | FR-140; AC-140.2 | Login/API/credential URL or identity-changing redirect cannot prove access | docs/github-integration/acceptance-bindings.json#T-GHC02-N | Passed |  |
| T-GHC02-G | local | unit | pre-review | automated | agent | local | FR-140; AC-140.2 | Metadata without page-access observation remains unverified | docs/github-integration/acceptance-bindings.json#T-GHC02-G | Passed |  |
| T-GHC02-D | local | unit | pre-review | automated | agent | local | FR-140; AC-140.2 | Page-access host denial remains explicit without successful access proof | docs/github-integration/acceptance-bindings.json#T-GHC02-D | Passed |  |
| T-GHC03-P | local | unit | pre-review | automated | agent | local | FR-141; AC-141.1; AC-141.2; AC-141.4 | Admit canonical checkout and independently verified fetch/push identities without authority | docs/github-integration/acceptance-bindings.json#T-GHC03-P | Passed |  |
| T-GHC03-N | local | unit | pre-review | automated | agent | local | FR-141; AC-141.1; AC-141.2; AC-141.4 | Reject similar URL or wrong effective push destination | docs/github-integration/acceptance-bindings.json#T-GHC03-N | Passed |  |
| T-GHC03-G | local | unit | pre-review | automated | agent | local | FR-141; AC-141.1; AC-141.2; AC-141.4 | Missing independent destination proof cannot authorize publication | docs/github-integration/acceptance-bindings.json#T-GHC03-G | Passed |  |
| T-GHC03-D | local | unit | pre-review | automated | agent | local | FR-141; AC-141.1; AC-141.2; AC-141.4 | Exact selected repository read denial cannot become verified absence | docs/github-integration/acceptance-bindings.json#T-GHC03-D | Passed |  |
| T-GHC04-P | local | unit | pre-review | automated | agent | local | FR-141; AC-141.3 | Admit authenticated exact selected/default ref-to-full-revision fact | docs/github-integration/acceptance-bindings.json#T-GHC04-P | Passed |  |
| T-GHC04-N | local | unit | pre-review | automated | agent | local | FR-141; AC-141.3 | Reject prefix match, unrelated revision and stale default | docs/github-integration/acceptance-bindings.json#T-GHC04-N | Passed |  |
| T-GHC04-G | local | unit | pre-review | automated | agent | local | FR-141; AC-141.3 | Branch name without branch-to-commit fact remains unverified | docs/github-integration/acceptance-bindings.json#T-GHC04-G | Passed |  |
| T-GHC04-D | local | unit | pre-review | automated | agent | local | FR-141; AC-141.3 | Exact ref read denial remains explicit without branch proof | docs/github-integration/acceptance-bindings.json#T-GHC04-D | Passed |  |
| T-GHC05-P | local | unit | pre-review | automated | agent | local | FR-142; FR-149; AC-142.1; AC-149.1 | Admit exact PR and independently verified base/head/fork facts | docs/github-integration/acceptance-bindings.json#T-GHC05-P | Passed |  |
| T-GHC05-N | local | unit | pre-review | automated | agent | local | FR-142; FR-149; AC-142.1; AC-149.1 | Base proof cannot establish another fork/head or unrelated PR | docs/github-integration/acceptance-bindings.json#T-GHC05-N | Passed |  |
| T-GHC05-G | local | unit | pre-review | automated | agent | local | FR-142; FR-149; AC-142.1; AC-149.1 | Missing independent source-repository/ref join prevents readiness | docs/github-integration/acceptance-bindings.json#T-GHC05-G | Passed |  |
| T-GHC05-D | local | unit | pre-review | automated | agent | local | FR-142; FR-149; AC-142.1; AC-149.1 | PR or independent source read denial cannot borrow another repository's proof | docs/github-integration/acceptance-bindings.json#T-GHC05-D | Passed |  |
| T-GHC06-P | local | unit | pre-review | automated | agent | local | FR-142; AC-142.2; AC-142.3; AC-142.4 | Admit exact run/attempt/job/check/producer/PR and tested-checkout join | docs/github-integration/acceptance-bindings.json#T-GHC06-P | Passed |  |
| T-GHC06-N | local | unit | pre-review | automated | agent | local | FR-142; AC-142.2; AC-142.3; AC-142.4 | Same name/SHA, test-merge or wrong App cannot prove selected check | docs/github-integration/acceptance-bindings.json#T-GHC06-N | Passed |  |
| T-GHC06-G | local | unit | pre-review | automated | agent | local | FR-142; AC-142.2; AC-142.3; AC-142.4 | Missing producer/checkout/test-selection proof remains gap | docs/github-integration/acceptance-bindings.json#T-GHC06-G | Passed |  |
| T-GHC06-D | local | unit | pre-review | automated | agent | local | FR-142; AC-142.2; AC-142.3; AC-142.4 | Exact check/job evidence denial cannot establish passing check | docs/github-integration/acceptance-bindings.json#T-GHC06-D | Passed |  |
| T-GHC07-P | local | unit | pre-review | automated | agent | local | FR-142; AC-142.5 | Admit increasing observation sequence under current source/context | docs/github-integration/acceptance-bindings.json#T-GHC07-P | Passed |  |
| T-GHC07-N | local | unit | pre-review | automated | agent | local | FR-142; AC-142.5 | Delayed/stale/archived/revoked evidence cannot replace current facts | docs/github-integration/acceptance-bindings.json#T-GHC07-N | Passed |  |
| T-GHC07-G | local | unit | pre-review | automated | agent | local | FR-142; AC-142.5 | Missing current producer/context prevents current admission | docs/github-integration/acceptance-bindings.json#T-GHC07-G | Passed |  |
| T-GHC07-D | local | unit | pre-review | automated | agent | local | FR-142; AC-142.5 | Current-context verifier denial leaves prior evidence intact | docs/github-integration/acceptance-bindings.json#T-GHC07-D | Passed |  |
| T-GHC08-P | local | unit | pre-review | automated | agent | local | FR-143; AC-143.1; AC-143.2; AC-143.3; AC-143.4; AC-143.6 | Admit exact causal hosted execution terminal result under pinned contract | docs/github-integration/acceptance-bindings.json#T-GHC08-P | Passed |  |
| T-GHC08-N | local | unit | pre-review | automated | agent | local | FR-143; AC-143.1; AC-143.2; AC-143.3; AC-143.4; AC-143.6 | Similar-run search, wrong run or relabeled local build cannot prove hosted result | docs/github-integration/acceptance-bindings.json#T-GHC08-N | Passed |  |
| T-GHC08-G | local | unit | pre-review | automated | agent | local | FR-143; AC-143.1; AC-143.2; AC-143.3; AC-143.4; AC-143.6 | Empty acknowledgement without association remains accepted/uncertain, not completed | docs/github-integration/acceptance-bindings.json#T-GHC08-G | Passed |  |
| T-GHC08-D | local | unit | pre-review | automated | agent | local | FR-143; AC-143.1; AC-143.2; AC-143.3; AC-143.4; AC-143.6 | Execution tool denial cannot become completed requested effect | docs/github-integration/acceptance-bindings.json#T-GHC08-D | Passed |  |
| T-GHC09-P | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-143.3; AC-150.1 | Admit exact selected test/candidate/configuration/job outcome | docs/github-integration/acceptance-bindings.json#T-GHC09-P | Passed |  |
| T-GHC09-N | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-143.3; AC-150.1 | Green aggregate or unselected report cannot satisfy selected test | docs/github-integration/acceptance-bindings.json#T-GHC09-N | Passed |  |
| T-GHC09-G | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-143.3; AC-150.1 | Missing producer/selection or required deployment context remains gap | docs/github-integration/acceptance-bindings.json#T-GHC09-G | Passed |  |
| T-GHC09-D | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-143.3; AC-150.1 | Unavailable required result source cannot establish test pass | docs/github-integration/acceptance-bindings.json#T-GHC09-D | Passed |  |
| T-GHC10-P | local | unit | pre-review | automated | agent | local | FR-143; FR-144; AC-143.1; AC-144.1; AC-144.2; AC-144.4; AC-144.5 | Admit exact immutable artifact/producer/attempt/source/configuration/bytes | docs/github-integration/acceptance-bindings.json#T-GHC10-P | Passed |  |
| T-GHC10-N | local | unit | pre-review | automated | agent | local | FR-143; FR-144; AC-143.1; AC-144.1; AC-144.2; AC-144.4; AC-144.5 | Wrong producer, mutable alias or empty inventory cannot establish stronger provenance/history | docs/github-integration/acceptance-bindings.json#T-GHC10-N | Passed |  |
| T-GHC10-G | local | unit | pre-review | automated | agent | local | FR-143; FR-144; AC-143.1; AC-144.1; AC-144.2; AC-144.4; AC-144.5 | Nullable digest/attempt without independent proof remains unverified | docs/github-integration/acceptance-bindings.json#T-GHC10-G | Passed |  |
| T-GHC10-D | local | unit | pre-review | automated | agent | local | FR-143; FR-144; AC-143.1; AC-144.1; AC-144.2; AC-144.4; AC-144.5 | Artifact/producer retrieval denial cannot establish artifact acceptance | docs/github-integration/acceptance-bindings.json#T-GHC10-D | Passed |  |
| T-GHC11-P | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-150.2; AC-150.3; AC-150.4 | Admit exact artifact/environment/target/configuration/deployment and required tests | docs/github-integration/acceptance-bindings.json#T-GHC11-P | Passed |  |
| T-GHC11-N | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-150.2; AC-150.3; AC-150.4 | Another candidate/target or approval-only status cannot complete deployment | docs/github-integration/acceptance-bindings.json#T-GHC11-N | Passed |  |
| T-GHC11-G | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-150.2; AC-150.3; AC-150.4 | Missing artifact/deployment/test join remains limited | docs/github-integration/acceptance-bindings.json#T-GHC11-G | Passed |  |
| T-GHC11-D | local | unit | pre-review | automated | agent | local | FR-143; FR-150; AC-143.1; AC-150.2; AC-150.3; AC-150.4 | Exact destination deployment/result denial cannot establish delivery success | docs/github-integration/acceptance-bindings.json#T-GHC11-D | Passed |  |
| T-GHC12-P | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Admit exact requested PR destination/head/base/state and causal result | docs/github-integration/acceptance-bindings.json#T-GHC12-P | Passed |  |
| T-GHC12-N | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Similar discovered PR or wrong destination cannot complete action | docs/github-integration/acceptance-bindings.json#T-GHC12-N | Passed |  |
| T-GHC12-G | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Lost request-result association remains uncertain | docs/github-integration/acceptance-bindings.json#T-GHC12-G | Passed |  |
| T-GHC12-D | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Exact PR write denial stays denied despite valid read facts | docs/github-integration/acceptance-bindings.json#T-GHC12-D | Passed |  |
| T-GHC13-P | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Admit proven exact destination/ref/revision publication or deletion | docs/github-integration/acceptance-bindings.json#T-GHC13-P | Passed |  |
| T-GHC13-N | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Local commit, wrong remote/ref or ordinary deletion grant cannot establish effect | docs/github-integration/acceptance-bindings.json#T-GHC13-N | Passed |  |
| T-GHC13-G | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Push acceptance without resulting-ref proof remains uncertain | docs/github-integration/acceptance-bindings.json#T-GHC13-G | Passed |  |
| T-GHC13-D | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.3 | Exact push/ref denial cannot establish remote publication/deletion | docs/github-integration/acceptance-bindings.json#T-GHC13-D | Passed |  |
| T-GHC14-P | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.2; AC-149.3 | Admit exact authorized PR/head/base/method and terminal merged revision | docs/github-integration/acceptance-bindings.json#T-GHC14-P | Passed |  |
| T-GHC14-N | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.2; AC-149.3 | Test-merge, auto-merge setting or wrong method cannot prove merge | docs/github-integration/acceptance-bindings.json#T-GHC14-N | Passed |  |
| T-GHC14-G | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.2; AC-149.3 | Accepted/pending request without causal terminal merge remains pending | docs/github-integration/acceptance-bindings.json#T-GHC14-G | Passed |  |
| T-GHC14-D | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.3; AC-149.2; AC-149.3 | Exact host/provider merge denial cannot establish completed merge | docs/github-integration/acceptance-bindings.json#T-GHC14-D | Passed |  |
| T-GHC15-P | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.5; AC-149.2; AC-149.3 | Admit exact separately authorized target/version/requested policy effect | docs/github-integration/acceptance-bindings.json#T-GHC15-P | Passed |  |
| T-GHC15-N | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.5; AC-149.2; AC-149.3 | Ordinary merge grant cannot authorize privileged configuration/bypass | docs/github-integration/acceptance-bindings.json#T-GHC15-N | Passed |  |
| T-GHC15-G | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.5; AC-149.2; AC-149.3 | Configuration existence without requested-effect association remains limited | docs/github-integration/acceptance-bindings.json#T-GHC15-G | Passed |  |
| T-GHC15-D | local | unit | pre-review | automated | agent | local | FR-143; FR-149; AC-143.1; AC-143.5; AC-149.2; AC-149.3 | Exact policy-change denial cannot establish applied effect | docs/github-integration/acceptance-bindings.json#T-GHC15-D | Passed |  |
| T-GHC16-P | local | unit | pre-review | automated | agent | local | FR-143; FR-151; AC-143.1; AC-143.5; AC-151.1 | Admit exact causal publication to selected GitHub target | docs/github-integration/acceptance-bindings.json#T-GHC16-P | Passed |  |
| T-GHC16-N | local | unit | pre-review | automated | agent | local | FR-143; FR-151; AC-143.1; AC-143.5; AC-151.1 | Publication/thread facts cannot establish personal delivery/read | docs/github-integration/acceptance-bindings.json#T-GHC16-N | Passed |  |
| T-GHC16-G | local | unit | pre-review | automated | agent | local | FR-143; FR-151; AC-143.1; AC-143.5; AC-151.1 | Missing target/result association prevents publication credit | docs/github-integration/acceptance-bindings.json#T-GHC16-G | Passed |  |
| T-GHC16-D | local | unit | pre-review | automated | agent | local | FR-143; FR-151; AC-143.1; AC-143.5; AC-151.1 | Exact publication denial cannot establish notification effect | docs/github-integration/acceptance-bindings.json#T-GHC16-D | Passed |  |
| T-GHC17-P | local | integration | pre-review | automated | agent | local | FR-145; AC-145.1; AC-145.2; AC-145.3; AC-145.4 | Admit six manual verifier bindings through real selected-home Store/CLI/monitor | docs/github-integration/acceptance-bindings.json#T-GHC17-P | Passed |  |
| T-GHC17-N | local | integration | pre-review | automated | agent | local | FR-145; AC-145.1; AC-145.2; AC-145.3; AC-145.4 | Wrong home, self-attested JSON/code or disconnected parser cannot establish admission | docs/github-integration/acceptance-bindings.json#T-GHC17-N | Passed |  |
| T-GHC17-G | local | integration | pre-review | automated | agent | local | FR-145; AC-145.1; AC-145.2; AC-145.3; AC-145.4 | Missing trusted callback/acquisition rejects provider facts | docs/github-integration/acceptance-bindings.json#T-GHC17-G | Passed |  |
| T-GHC17-D | local | integration | pre-review | automated | agent | local | FR-145; AC-145.1; AC-145.2; AC-145.3; AC-145.4 | Explicit connection/tool scope denial cannot become successful provider admission | docs/github-integration/acceptance-bindings.json#T-GHC17-D | Passed |  |
| T-GHC18-P | local | integration | pre-review | automated | agent | local | FR-147; FR-148; AC-147.1; AC-147.2; AC-147.3; AC-147.4; AC-147.5; AC-148.1 | Exact sources ground DoD and map every Azure/core obligation to real assertion | docs/github-integration/acceptance-bindings.json#T-GHC18-P | Passed |  |
| T-GHC18-N | local | integration | pre-review | automated | agent | local | FR-147; FR-148; AC-147.1; AC-147.2; AC-147.3; AC-147.4; AC-147.5; AC-148.1 | Catalog counts, fixture-only features or selected subset cannot prove full parity | docs/github-integration/acceptance-bindings.json#T-GHC18-N | Passed |  |
| T-GHC18-G | local | integration | pre-review | automated | agent | local | FR-147; FR-148; AC-147.1; AC-147.2; AC-147.3; AC-147.4; AC-147.5; AC-148.1 | Missing necessary source/proof join remains explicit implementation/evidence gap | docs/github-integration/acceptance-bindings.json#T-GHC18-G | Passed |  |
| T-GHC18-D | local | integration | pre-review | automated | agent | local | FR-147; FR-148; AC-147.1; AC-147.2; AC-147.3; AC-147.4; AC-147.5; AC-148.1 | Required source/tool unavailability cannot become grounded completion | docs/github-integration/acceptance-bindings.json#T-GHC18-D | Passed |  |
| T-GHC19-P | local | integration | pre-review | automated | agent | local | FR-146; FR-148; AC-146.4; AC-148.2; AC-148.3 | Transfer current canonical source/context without replacing approved history | docs/github-integration/acceptance-bindings.json#T-GHC19-P | Passed |  |
| T-GHC19-N | local | integration | pre-review | automated | agent | local | FR-146; FR-148; AC-146.4; AC-148.2; AC-148.3 | Labels/source/review report cannot manufacture consent | docs/github-integration/acceptance-bindings.json#T-GHC19-N | Passed |  |
| T-GHC19-G | local | integration | pre-review | automated | agent | local | FR-146; FR-148; AC-146.4; AC-148.2; AC-148.3 | Missing captured decision/context prevents managed credit, not host execution | docs/github-integration/acceptance-bindings.json#T-GHC19-G | Passed |  |
| T-GHC19-D | local | integration | pre-review | automated | agent | local | FR-146; FR-148; AC-146.4; AC-148.2; AC-148.3 | Actual host denial remains distinct from advisory lifecycle finding | docs/github-integration/acceptance-bindings.json#T-GHC19-D | Passed |  |
| T-GHC20-P | local | integration | pre-review | automated | agent | local | FR-146; FR-149; AC-146.2; AC-149.1; AC-149.2; AC-149.3 | Exact current independent Review/check/policy facts establish only stated readiness | docs/github-integration/acceptance-bindings.json#T-GHC20-P | Passed |  |
| T-GHC20-N | local | integration | pre-review | automated | agent | local | FR-146; FR-149; AC-146.2; AC-149.1; AC-149.2; AC-149.3 | Green CI or stale Review cannot authorize publication/merge/bypass | docs/github-integration/acceptance-bindings.json#T-GHC20-N | Passed |  |
| T-GHC20-G | local | integration | pre-review | automated | agent | local | FR-146; FR-149; AC-146.2; AC-149.1; AC-149.2; AC-149.3 | Missing required Review/check/producer fact keeps readiness incomplete | docs/github-integration/acceptance-bindings.json#T-GHC20-G | Passed |  |
| T-GHC20-D | local | integration | pre-review | automated | agent | local | FR-146; FR-149; AC-146.2; AC-149.1; AC-149.2; AC-149.3 | Actual publication/IAM denial remains explicit | docs/github-integration/acceptance-bindings.json#T-GHC20-D | Passed |  |
| T-GHC21-P | local | integration | pre-review | automated | agent | local | FR-150; AC-150.1; AC-150.2; AC-150.3; AC-150.4 | Bind exact release/version/asset bytes/deployment to selected candidate without promotion | docs/github-integration/acceptance-bindings.json#T-GHC21-P | Passed |  |
| T-GHC21-N | local | integration | pre-review | automated | agent | local | FR-150; AC-150.1; AC-150.2; AC-150.3; AC-150.4 | Mutable tag/label or unrelated bytes cannot prove delivered candidate | docs/github-integration/acceptance-bindings.json#T-GHC21-N | Passed |  |
| T-GHC21-G | local | integration | pre-review | automated | agent | local | FR-150; AC-150.1; AC-150.2; AC-150.3; AC-150.4 | Missing production/destination join prevents completed delivery | docs/github-integration/acceptance-bindings.json#T-GHC21-G | Passed |  |
| T-GHC21-D | local | integration | pre-review | automated | agent | local | FR-150; AC-150.1; AC-150.2; AC-150.3; AC-150.4 | Selected publication/environment denial cannot establish delivery success | docs/github-integration/acceptance-bindings.json#T-GHC21-D | Passed |  |
| T-GHC22-P | local | integration | pre-review | automated | agent | local | FR-146; FR-151; AC-146.3; AC-151.2; AC-151.3; AC-151.4 | Exact atomic claim/read-only recovery preserves attempt/source and separate polling/link proof | docs/github-integration/acceptance-bindings.json#T-GHC22-P | Passed |  |
| T-GHC22-N | local | integration | pre-review | automated | agent | local | FR-146; FR-151; AC-146.3; AC-151.2; AC-151.3; AC-151.4 | Duplicate/stale operation or link metadata cannot prove current result/access | docs/github-integration/acceptance-bindings.json#T-GHC22-N | Passed |  |
| T-GHC22-G | local | integration | pre-review | automated | agent | local | FR-146; FR-151; AC-146.3; AC-151.2; AC-151.3; AC-151.4 | Lost response/scheduler/read/causal proof remains uncertainty or monitoring gap | docs/github-integration/acceptance-bindings.json#T-GHC22-G | Passed |  |
| T-GHC22-D | local | integration | pre-review | automated | agent | local | FR-146; FR-151; AC-146.3; AC-151.2; AC-151.3; AC-151.4 | Reconciliation denial cannot trigger automatic mutation retry | docs/github-integration/acceptance-bindings.json#T-GHC22-D | Passed |  |
| T-GHB01 | local | integration | pre-review | automated | agent | local | FR-141; FR-143; FR-151; AC-141.4; AC-143.4; AC-151.1 | Exact separate grant permits only scoped fixture action; no live network | docs/github-integration/acceptance-bindings.json#T-GHB01 | Passed |  |
| T-GHB02 | local | integration | pre-review | automated | agent | local | FR-141; FR-151; AC-141.4; AC-151.1 | Missing grant rejects despite provider facts/write capability | docs/github-integration/acceptance-bindings.json#T-GHB02 | Passed |  |
| T-GHB03 | local | integration | pre-review | automated | agent | local | FR-142; FR-151; AC-142.5; AC-151.1 | Revoked grant cannot dispatch or confer current credit | docs/github-integration/acceptance-bindings.json#T-GHB03 | Passed |  |
| T-GHB04 | local | integration | pre-review | automated | agent | local | FR-151; AC-151.2 | Consumed one-shot authority cannot dispatch again | docs/github-integration/acceptance-bindings.json#T-GHB04 | Passed |  |
| T-GHB05 | local | integration | pre-review | automated | agent | local | FR-141; FR-151; AC-141.4; AC-151.1 | Foreign repository/item/destination grant cannot authorize selected effect | docs/github-integration/acceptance-bindings.json#T-GHB05 | Passed |  |
| T-GHB06 | local | integration | pre-review | automated | agent | local | FR-141; FR-149; AC-141.2; AC-149.3 | Wrong ref/revision grant cannot authorize selected push/delete | docs/github-integration/acceptance-bindings.json#T-GHB06 | Passed |  |
| T-GHB07 | local | integration | pre-review | automated | agent | local | FR-149; FR-151; AC-149.2; AC-151.1 | Different action grant cannot authorize selected effect | docs/github-integration/acceptance-bindings.json#T-GHB07 | Passed |  |
| T-GHB08 | local | integration | pre-review | automated | agent | local | FR-143; FR-149; AC-143.5; AC-149.2 | Ordinary authority cannot enable auto-merge/force-push/deletion/bypass | docs/github-integration/acceptance-bindings.json#T-GHB08 | Passed |  |
| T-GHB09 | local | integration | pre-review | automated | agent | local | FR-149; FR-150; AC-149.2; AC-150.3 | Provider/local success cannot complete Review/environments or authorize promotion/PROD | docs/github-integration/acceptance-bindings.json#T-GHB09 | Passed |  |
| T-GHB10 | local | integration | pre-review | automated | agent | local | FR-143; FR-150; AC-143.4; AC-150.3 | Scope/read permission grants no live mutation | docs/github-integration/acceptance-bindings.json#T-GHB10 | Passed |  |
| T-GHB11 | local | integration | pre-review | automated | agent | local | FR-151; AC-151.2 | Concurrent exact claims produce one durable dispatch/causal operation | docs/github-integration/acceptance-bindings.json#T-GHB11 | Passed |  |
| T-GHB12 | local | integration | pre-review | automated | agent | local | FR-151; AC-151.2 | Missing/non-true IAM and cancellation before/after awaited IAM reject before claim/effect | docs/github-integration/acceptance-bindings.json#T-GHB12 | Passed |  |
| T-GHB13 | local | integration | pre-review | automated | agent | local | FR-145; FR-151; AC-145.4; AC-151.3 | Postclaim interruption/restart reconciles exact handle read-only without redispatch | docs/github-integration/acceptance-bindings.json#T-GHB13 | Passed |  |
| T-GHB14 | local | integration | pre-review | automated | agent | local | FR-142; FR-151; AC-142.5; AC-151.3 | Delayed/changed context cannot replace current evidence; preserve history | docs/github-integration/acceptance-bindings.json#T-GHB14 | Passed |  |
| T-GHB15 | local | integration | pre-review | automated | agent | local | FR-142; FR-144; AC-142.5; AC-144.3 | Archived/unavailable producer cannot prove current result | docs/github-integration/acceptance-bindings.json#T-GHB15 | Passed |  |
| T-GHB16 | local | integration | pre-review | automated | agent | local | FR-143; AC-143.6 | Local build/test remains local under correct core handling | docs/github-integration/acceptance-bindings.json#T-GHB16 | Passed |  |
| T-GHB17 | local | integration | pre-review | automated | agent | local | FR-144; AC-144.3 | Changed bytes/digest contradiction fail integrity, never warning-only pass | docs/github-integration/acceptance-bindings.json#T-GHB17 | Passed |  |
| T-GHB18 | local | integration | pre-review | automated | agent | local | FR-144; AC-144.2 | Null digest/attempt admits only with supported independent exact producer/byte proof | docs/github-integration/acceptance-bindings.json#T-GHB18 | Passed |  |
| T-GHB19 | local | integration | pre-review | automated | agent | local | FR-144; AC-144.3; AC-144.4 | Expired/deleted/inaccessible artifact is unavailable, not historical absence or reuse | docs/github-integration/acceptance-bindings.json#T-GHB19 | Passed |  |
| T-GHB20 | local | integration | pre-review | automated | agent | local | FR-145; AC-145.2 | Offline CLI rejects unverified facts/executable JSON with zero network | docs/github-integration/acceptance-bindings.json#T-GHB20 | Passed |  |
| T-GHB21 | local | integration | pre-review | automated | agent | local | FR-145; AC-145.1; AC-145.3 | Import/construction performs no acquisition/registration/credential lookup/effect | docs/github-integration/acceptance-bindings.json#T-GHB21 | Passed |  |
| T-GHB22 | local | integration | pre-review | automated | agent | local | FR-145; FR-151; AC-145.3; AC-151.1 | Private payloads/causes/handles/paths/secrets cannot leak; safe explicit diagnostics remain | docs/github-integration/acceptance-bindings.json#T-GHB22 | Passed |  |
| T-GHB23 | local | integration | pre-review | automated | agent | local | FR-145; AC-145.4 | Await exact owned cleanup on success/failure; surface cleanup error without broad deletion | docs/github-integration/acceptance-bindings.json#T-GHB23 | Passed |  |
| T-GHB24 | local | contract | pre-review | automated | agent | local | FR-146; FR-147; AC-146.1; AC-147.2; AC-147.3; AC-147.4 | All current AC/Azure/family mappings require actual assertions; reject duplicate/orphan/stub/old-pass credit | docs/github-integration/acceptance-bindings.json#T-GHB24 | Passed |  |
| T-GHB25 | local | integration | pre-review | automated | agent | local | FR-148; AC-148.2 | Maintenance changes current digest without replacing historical approval or creating consent | docs/github-integration/acceptance-bindings.json#T-GHB25 | Passed |  |
| T-GHB26 | local | integration | pre-review | automated | agent | local | FR-148; AC-148.3 | Explicit stage override follows host permissions; invalid bookkeeping stays uncredited/advisory | docs/github-integration/acceptance-bindings.json#T-GHB26 | Passed |  |
| T-GHB27 | local | integration | pre-review | automated | agent | local | FR-148; FR-151; AC-148.2; AC-151.2 | Current context binds actual member/source/spec/config; no cross-branch Coding authority | docs/github-integration/acceptance-bindings.json#T-GHB27 | Passed |  |
| T-GHB28 | local | integration | pre-review | automated | agent | local | FR-148; AC-148.2; AC-148.3 | Require matching captured input; replay/foreign/source/review labels create no authority | docs/github-integration/acceptance-bindings.json#T-GHB28 | Passed |  |
| T-GHB29 | local | integration | pre-review | automated | agent | local | FR-146; AC-146.2 | Fix resets current evidence and repeats full unit-first validation; preserve prior cycles | docs/github-integration/acceptance-bindings.json#T-GHB29 | Passed |  |
| T-GHB30 | local | unit | pre-review | automated | agent | local | FR-145; FR-146; AC-145.4; AC-146.1 | Preserve exact fast 16-case selection/accounting, not full acceptance | docs/github-integration/acceptance-bindings.json#T-GHB30 | Passed |  |
| T-GHB31 | local | contract | pre-review | automated | agent | local | FR-146; AC-146.1; AC-146.2 | Final targeted selection accounts for every retained variant/boundary; no hidden skip credit | docs/github-integration/acceptance-bindings.json#T-GHB31 | Passed |  |
| T-GHB32 | local | regression | pre-review | automated | agent | local | FR-145; FR-146; FR-147; AC-145.4; AC-146.2; AC-147.2 | Preserve Azure/offline/storage/recovery and exact full discovery/pass/fail/skip counts | docs/github-integration/acceptance-bindings.json#T-GHB32 | Passed |  |
| T-GHB33 | local | contract | pre-review | automated | agent | local | FR-145; FR-146; AC-145.4; AC-146.2 | Actual retained source passes unchanged static diagnostics | docs/github-integration/acceptance-bindings.json#T-GHB33 | Passed |  |
| T-GHB34 | local | contract | pre-review | automated | agent | local | FR-144; FR-145; FR-146; AC-144.1; AC-145.4; AC-146.2 | Reproducible package bytes/identity exclude private/session content | docs/github-integration/acceptance-bindings.json#T-GHB34 | Passed |  |
| T-GHB35 | local | contract | pre-review | automated | agent | local | FR-145; FR-146; AC-145.1; AC-145.4; AC-146.2 | Verify exact facade/seven modules/28 exports and selected-home installed preflight without native backends/default fallback | docs/github-integration/acceptance-bindings.json#T-GHB35 | Passed |  |
| T-GHB36 | local | contract | pre-review | automated | agent | local | FR-145; FR-146; AC-145.4; AC-146.2 | Actual supported native Node/platform/path/process checks remain dependency-free; unavailable/simulated platform uncredited | docs/github-integration/acceptance-bindings.json#T-GHB36 | Passed |  |
| T-GHR01 | local | review | review | automated | user | development-machine | FR-146; FR-149; AC-146.2; AC-146.4; AC-149.2 | Built-in Sol/max Review assesses exact validated candidate; findings require Coding; no fabricated approval | docs/github-integration/acceptance-bindings.json#T-GHR01 | NotRun |  |
| T-GHCI01 | local | workflow | post-review | automated | provider | GitHub-Actions | FR-145; FR-146; FR-150; AC-145.4; AC-146.2; AC-150.4 | Only after authorized publication/trigger, observe exact source/run/attempt unit matrix results | docs/github-integration/acceptance-bindings.json#T-GHCI01 | NotRun |  |
| T-GHCI02 | local | workflow | post-review | automated | provider | GitHub-Actions | FR-146; FR-150; AC-146.1; AC-146.2; AC-150.4 | Observe actual selected targeted IDs/counts/outcomes for exact candidate | docs/github-integration/acceptance-bindings.json#T-GHCI02 | NotRun |  |
| T-GHCI03 | local | workflow | post-review | automated | provider | GitHub-Actions | FR-145; FR-146; FR-147; AC-145.4; AC-146.2; AC-147.2 | Observe full actual regression and required platform/version matrix without hidden skips | docs/github-integration/acceptance-bindings.json#T-GHCI03 | NotRun |  |
| T-GHCI04 | local | workflow | post-review | automated | provider | GitHub-Actions | FR-145; FR-146; FR-150; AC-145.4; AC-146.2; AC-150.4 | Observe exact static/package/export outcomes and source/run/attempt/artifact identity | docs/github-integration/acceptance-bindings.json#T-GHCI04 | NotRun |  |
| T-GHL01 | local | contract | pre-review | semi-automated | agent | development-machine | FR-141; FR-146; AC-141.1; AC-141.2; AC-141.3; AC-146.3 | Authorized reads prove exact repository/fetch/push/default/selected ref facts without write authority | docs/github-integration/acceptance-bindings.json#T-GHL01 | NotRun |  |
| T-GHL02 | local | contract | pre-review | semi-automated | agent | development-machine | FR-142; FR-146; AC-142.1; AC-142.2; AC-142.3; AC-142.4; AC-146.3 | Authorized actual PR/base/head/check reads retain missing fork/checkout/test-selection gaps | docs/github-integration/acceptance-bindings.json#T-GHL02 | NotRun |  |
| T-GHL03 | local | contract | pre-review | semi-automated | agent | development-machine | FR-140; FR-146; FR-151; AC-140.1; AC-140.2; AC-140.3; AC-146.3; AC-151.4 | Authorized exact run/attempt/jobs/human-page observations retain rerun/history/polling gaps | docs/github-integration/acceptance-bindings.json#T-GHL03 | NotRun |  |
| T-GHL04 | local | contract | pre-review | semi-automated | agent | development-machine | FR-144; FR-150; AC-144.1; AC-144.2; AC-144.3; AC-144.5; AC-150.2; AC-150.4 | Available exact bytes/producer/attempt/source/release/deployment reads retain missing joins; no writes manufacture evidence | docs/github-integration/acceptance-bindings.json#T-GHL04 | NotRun |  |
