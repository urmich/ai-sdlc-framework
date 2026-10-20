# Test Plan: Repository, Pull Request, and Execution Evidence

## Purpose and status

These planned tests check that the framework uses evidence from the **right
local checkout, hosted repository, PR, revision, check, and execution attempt**.
They also check that an unclear external result stays uncertain. Test IDs are
stable references; their descriptions say what must be observed.

Tests use disposable Git repositories, fake hosting-service responses, fake
clocks, and disposable Copilot homes. They must not use ambient credentials,
contact a live provider, push, publish, create a PR, dispatch a remote workflow,
change the real checkout's Git remotes, or change a hosted repository's settings.
Tests may add, rename, or change remotes only inside their own disposable
repositories. The 29 tests include 27 local pre-review checks and two review
checks. The Status column reflects the active validation cycle; a planned
test or a passing fixture does not count as live-provider proof.

## Planned tests

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Expected Outcome | Implementation | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| T-101 | local | unit | pre-review | Automated | agent | local | FR-055; AC-055.1, AC-055.2, AC-055.3, AC-055.4, AC-055.5, AC-055.6 | Read back service, connection, revisions, evidence and time with the actual local path/hosted URL. Two hosted URLs for one checkout and two checkouts for one URL stay distinct. Relocating a checkout or changing a fetch URL requires renewed verification; renaming its Git remote alone does not. Check multiple fetch/push URLs, absent selection, credential-bearing URL rejection, and hosting-service-proven HTTPS/SSH equivalence. Verify a different push URL B independently; observing fetch URL A cannot authorize B, and a publication grant for A never expands when B is later verified. Separately verified B and exact B consent can qualify without publishing anything. An early document-only push requires a fresh provider-verified `{branchRef,revision}` pair for B; a stale, legacy, wrong-branch, or cached A tracking ref cannot qualify, while a fully reviewed push with exact B proof remains available. | test/provider-observations.unit.test.mjs; test/provider-observations.test.mjs; test/push-base-verification.test.mjs; test/pr.test.mjs | Passed |
| T-102 | local | integration | pre-review | Automated | agent | local | FR-056; AC-056.1, AC-056.2, AC-056.3, AC-056.4 | A configured full branch ref, a specifically selected Git remote with an arbitrary name, and a current observation of its hosted URL each resolve the right default branch. Try zero, one, and several remotes, including missing selected names and conflicting branches; no implicit `origin`/`upstream` or branch guess. After changing a remote's URL **or name** but retaining an older cached symbolic HEAD, that HEAD alone cannot prove the selected URL's default branch. Renaming alone does not change repository identity. Existing `origin` behavior survives with current evidence. | test/provider-observations.test.mjs; test/storage.test.mjs | Passed |
| T-103 | local | integration | pre-review | Automated | agent | local | FR-057; AC-057.1, AC-057.2, AC-057.3, AC-057.4, AC-057.5 | Read back service, connection, hosted PR and optional fork-source URLs, full branch refs/revisions, state, time and evidence. Revision advancement invalidates old checks/readiness; retargeting without proof of the same PR fails. A state-only refresh keeps PR identity while updating time/evidence. Equal branch names in separate repositories stay distinct; observation grants no permission. A first PR from a separately observed fork source needs exact source/target consent but no pre-existing PR; a separately verified push URL remains the same PR destination through preparation, dispatch and result. An equal-ref fork result completes only with its exact prepared intent, proven operation, and trusted source/hosted identities; same-repository or bare legacy equality rejects. | test/provider-observations.test.mjs; test/pr.test.mjs | Passed |
| T-104 | local | integration | pre-review | Automated | agent | local | FR-058; AC-058.1, AC-058.2, AC-058.3, AC-058.4 | A required check passes only with its exact hosted URL, current PR, unique check-result/producer ID, tested revision, source/target revisions, and run attempt. Check proven generated-merge revisions and reject unproven ones; two same-name checks or shared-run checks cannot borrow evidence. Late linking works only on exact matches. Cleanup preserves the association when each dependent readiness, notice, audit, uncertain action, or recovery record is its only consumer. | test/pr.test.mjs; test/monitors.test.mjs | Passed |
| T-105 | local | unit | pre-review | Automated | agent | local | FR-059; AC-059.1, AC-059.2, AC-059.4, AC-059.5, AC-059.6 | Vary hosting service, connection, execution scope, definition, run, and attempt independently and reject collisions. A proven execution kind with no attempts uses `not-applicable`; an unknown attempt gives no passing credit. No fake attempt `1` is added; current Azure DevOps builds work and historical run IDs remain readable only as history. | test/execution-artifact-identity.test.mjs | Passed |
| T-106 | local | unit | pre-review | Automated | agent | local | FR-059; AC-059.3, AC-059.4, AC-059.5, AC-059.7 | A first artifact can be admitted before deployment when its producing run, local checkout, hosted URL, logical name, content, exact commit and configuration are proven. Changing any identity remains distinct. An artifact from another candidate revision/configuration or an incomplete old artifact cannot satisfy readiness, including an empty commit with identical files. Test cycle reuse, selection, policy and recovery separately. | test/execution-artifact-identity.test.mjs; test/deployment.test.mjs | Passed |
| T-107 | local | integration | pre-review | Automated | agent | local | FR-060; AC-060.1, AC-060.2, AC-060.3, AC-060.4, AC-060.5, AC-060.6, AC-060.7, AC-060.8, AC-060.9 | For every external action in the proof matrix below, verify exact target, result and either a supported host-call result link or provider-backed request link, not a success label or earlier identical result. When neither causal link exists, report observed state separately and keep the action uncertain. Terminal replay is exact; concurrent duplicates and a sequential retry cannot gain credit without a current scoped exception. | test/effect-reconciliation.test.mjs; test/host-call-operation-api.test.mjs; test/workflow.test.mjs | Passed |
| T-108 | local | integration | pre-review | Automated | agent | local | FR-061; AC-061.1, AC-061.2, AC-061.3, AC-061.4, AC-061.5, AC-061.6 | Vary session, tool, arguments, directory, shell, and host-proven call ID independently. A trusted host can prepare a call and prove its result or affirmative non-dispatch with that exact ID. Wrong, missing, or unsupported host IDs cannot make non-dispatch terminal. Duplicate proven callbacks are harmless; delayed callbacks cannot complete a newer identical call. A framework-only ID or host without a reliable ID remains uncertain; matching an earlier identical provider result cannot complete the new invocation. The advisory hook does not prevent tool execution or store secrets. | test/host-invocation.test.mjs; test/host-call-operation-api.test.mjs; test/recovery-gate.test.mjs | Passed |
| T-109 | local | unit | pre-review | Automated | agent | local | FR-062; AC-062.1, AC-062.2, AC-062.3, AC-062.4, AC-062.5, AC-062.6 | Mutate every accepted effect-bearing argument and verify the classified target and call identity change. Missing required, extra, wrong-type or ambiguous arguments stay unmanaged without blocking the tool; omitted permitted optional arguments pass. Two disagreeing adapters in either order remain a visible conflict. Recognized Git/other actions cannot be disguised; equivalent shell and structured inputs classify equally. | test/tool-adapters.test.mjs | Passed |
| T-110 | local | integration | pre-review | Automated | agent | local | FR-063; AC-063.1, AC-063.2, AC-063.3, AC-063.4, AC-063.5, AC-063.6 | Test summary-only, reference-only, and combined inputs. Read back 4095/4096-byte records (including file formatting) and 511/512-character fields; reject 4097 bytes, 513 characters, credentials, headers, executable content, or nested payloads without unsafe persistence. Content at 4 MiB passes; 4 MiB + 1, missing/changed/wrongly hashed content stays unverified. Provider-proven immutable versions require retrieval context; a mutable locator without content identity stays diagnostic. Independently test each terminal-action, association, audit, notice, and recovery reason for retaining evidence under pruning races. | test/monitors.test.mjs; test/storage.test.mjs; test/effect-reconciliation.test.mjs | Passed |
| T-111 | local | integration | pre-review | Automated | agent | local | FR-064; AC-064.1, AC-064.2, AC-064.3, AC-064.4 | Old decisions, actions, runs, artifacts, PRs, audits and test evidence load without changed bytes or new credit. Local tests pass without an artifact/deployment; first artifact admission succeeds before deployment. A legacy deployment with `succeeded` status but missing proof cannot admit a new STAGING-result decision or handoff. Compare mixed old/new audit ordering and credited outcomes before/after interruption; never redispatch. | test/storage.test.mjs; test/decisions.test.mjs; test/recovery-gate.test.mjs; test/deployment.test.mjs | Passed |
| T-112 | local | contract | pre-review | Automated | agent | local | FR-065; AC-065.1, AC-065.2, AC-065.3, AC-065.4, AC-065.5 | Status, resume, action/monitor detail, checks and audit show the selected local path/hosted URL, exact gaps and a safe read-only step or a clear impossibility. Test results stay Passed/Failed/NotRun while blockers and uncertain actions are separate. Safe oversized summaries stay under 256 KiB with a detail command; fixtures containing full prompts, secrets, and raw provider responses never appear. New/changed docs, code and CLI contracts use descriptive names, explain needed technical terms and state that observation grants no permission. | test/summary-bounds.test.mjs; test/multiline-summary.test.mjs; test/recovery-gate.test.mjs; test/instructions.test.mjs; scripts/check.mjs | Passed |
| T-113 | local | integration | pre-review | Automated | agent | local | FR-055 to FR-065 | A complete disposable example selects a non-`origin` remote, records the local path and hosted URL, advances a PR, links two checks to the right attempts/artifacts, reconciles exact tool results, survives interruption and restart, and rejects evidence from another hosted URL or revision. Generic records contain no service-specific response payloads. | test/provider-neutral-workflow.test.mjs | Passed |
| T-114 | local | regression | pre-review | Automated | agent | local | FR-055 to FR-065 | Full repository tests and deterministic checks pass without regressing existing v0.3.1 behavior. Platform-skipped cases remain reported as skipped, not as live-provider or native-package passes. | npm test; npm run check | Passed |
| T-115 | local | integration | pre-review | Automated | agent | Windows-x64 | FR-055 to FR-065 | Native Windows x64 tests use the actual Node.js 22+ executable and, for applicable launcher tests, Go 1.27.1. Path/worktree and PowerShell/cmd argument tests, an isolated candidate installation, and all eight candidate hooks return correct advisory output. Unsupported native/network capabilities remain `NotRun` with a separate blocker reason. | test/windows-hook-smoke.test.mjs; test/platform.test.mjs; test/winget-launcher-native.test.mjs; Windows commands below | Passed |
| T-116 | local | review | review | Automated | agent | local | FR-055 to FR-065 | Independent GPT-6 Astra xhigh reviews of Requirements, Test Plan, Technical Design, and the tested code have no blocking findings; corrections repeat the affected review and validation. This is separate from built-in candidate review. | Independent review reports | NotRun |
| T-117 | local | review | review | Automated | agent | local | FR-055 to FR-065 | Built-in GitHub Copilot CLI `/review` examines the exact candidate that passed all required local tests. Blocking findings are fixed, local tests restart unit-first, and `/review` repeats until no blocking findings remain. | GitHub Copilot CLI `/review` | NotRun |
| T-118 | local | integration | pre-review | Automated | agent | local | FR-055; FR-057; FR-058; FR-059; FR-060; FR-065 | A trusted host in a fresh local Node process imports only the public CLI and Store interfaces and supplies verified repository, PR, check, execution, and artifact facts without network access. Exact identities persist; wrong facts, a different Copilot home, and the ordinary binary without a verifier cannot gain passing credit. An initialized Store works with a real home alias where the host supports one. | test/cli-provider-verifiers.test.mjs | Passed |
| T-119 | local | integration | pre-review | Automated | agent | local | FR-059; FR-060; FR-064 | New hosted execution and environment-test results without complete verified provider, connection, scope, execution and attempt identities remain unverified. Correct identities pass; conflicting identities reject. Reading legacy records never invents missing identity or grants new credit; local-only tests preserve their behavior. | test/required-execution-identity.test.mjs | Passed |
| T-120 | local | integration | pre-review | Automated | agent | local | FR-060; FR-062 | Hosted configuration changes require the exact intended target/version, verified resulting state, and causal dispatch-to-result proof. A success label or evidence string cannot complete them. Missing proof, wrong target/version and replay conflicts reject; local configuration remains local. | test/hosted-configuration-proof.test.mjs | Passed |
| T-121 | local | integration | pre-review | Automated | agent | local | FR-055; FR-059; FR-064 | Changing the selected hosted URL while HEAD and files remain unchanged prevents old artifacts/deployments from supporting new environment evidence or recovered current credit. Missing or ambiguous selections stay unverified. Old records remain history, and unrelated local tests are unaffected. | test/stale-repository-credit.test.mjs | Passed |
| T-122 | local | integration | pre-review | Automated | agent | local | FR-058; FR-059; FR-063 | Proven equivalent legacy/current monitor identities for a non-Azure provider share one lease and polling worker in both attachment orders and concurrent attachment. Different connections, scopes, definitions, executions or attempts never share ownership; historical identity alone cannot gain passing credit. | test/monitor-alias-regression.test.mjs | Passed |
| T-123 | local | integration | pre-review | Automated | agent | local | FR-063; FR-064 | Repeated repository/PR refreshes and pruning archive superseded observations/facts before exhausting the unchanged 256 KiB active budget. Current identities and sole-consumer action, association, notice, audit and recovery dependencies survive. Archived bytes remain readable; interruption or concurrent refresh cannot lose proof. Interrupt near-budget replacement after its new record is durable but before its archived predecessor is removed; loading and pruning must recover without raising the limit or discarding unarchived dependencies. | test/observation-retention-regression.test.mjs | Passed |
| T-124 | local | integration | pre-review | Automated | agent | local | FR-060; AC-060.7, AC-060.8 | An uncertain operation prevents another managed attempt with the same normalized intended outcome, including omitted versus explicit defaults and different tool argument representations. Older unresolved records without a normalized outcome use only provable stored identity; unknown historical fields cannot be invented from current HEAD and ambiguous equivalent attempts require reconciliation or an exact exception. A prefix-compatible SHA-256 abbreviation cannot prove a different commit, and an explicitly local configuration operation cannot block an unrelated hosted change. Exact replay remains idempotent, different actual outcomes stay distinct, concurrent preparations serialize, and only a current applicable retry exception permits a replacement without declaring the previous operation successful. | test/normalized-operation-retry.test.mjs | Passed |
| T-125 | local | integration | pre-review | Automated | agent | local | FR-063; AC-063.1, AC-063.4, AC-063.5 | Every accepted terminal monitor record can acknowledge delivery and then archive within the unchanged 4096-byte record limit. Near-limit existing records, multibyte text and bounded evidence references retain verified evidence; replay and concurrent acknowledgment cannot lose proof or duplicate delivery. | test/monitor-lifecycle-boundaries.test.mjs | Passed |
| T-126 | local | integration | pre-review | Automated | agent | local | FR-063; FR-064 | A standalone or unreferenced terminal monitor can archive despite an unrelated completed checkout being removed or changing branch. Dependency inspection uses durable references without granting stale checkout authority; genuine current, uncertain, audit or recovery consumers retain their monitors, and missing or corrupt dependency evidence cannot be treated as absent. A present recovery marker prevents archival even when its JSON content is null, false or zero; parsed truthiness cannot substitute for existence. | test/monitor-lifecycle-boundaries.test.mjs | Passed |
| T-127 | local | integration | pre-review | Automated | agent | local | FR-055; FR-060; AC-060.8 | Omitting or explicitly supplying the provider already proven by the exact current hosted repository observation produces the same intended operation identity. An uncertain predecessor still blocks the equivalent retry without an applicable exception, including older stored outcomes that omitted provider. Historical bytes remain unchanged; missing information cannot prove a different effect. Conflicting provider input rejects and no untrusted field can establish its own verification. | test/verified-provider-retry.test.mjs | Passed |
| T-128 | local | integration | pre-review | Automated | agent | local | FR-063; FR-064 | Interrupt mutable PR-fact archival before the replacement PR observation commits, update the still-current facts through the public API, then refresh successfully. Original and changed historical facts retain distinct immutable content identities and exact bytes; retry and crash recovery cannot overwrite archives, lose consumers, or weaken the 256 KiB active budget. | test/pr-facts-archive-recovery.test.mjs | Passed |
| T-129 | local | integration | pre-review | Automated | agent | local | FR-059; FR-060; FR-062 | Artifact-production and notification families work through public preparation, dispatch, recording and reconciliation, not only pure result validation. Equivalent artifact action names share unresolved-effect protection without expanding scoped authority. Available artifact identity includes its proven producer and immutable content, persists after reload, and prevents active or archived result borrowing regardless of which output fields were requested in advance. Classified producer and attempt mismatches cannot bind a managed call. A notification requires exact recipient/content and delivery receipt. Unsupported or incomplete proof remains uncertain; neither action grants unrelated environment or publication permission. | test/public-operation-families.test.mjs | Passed |

T-118 was added later to cover the trusted host command path. Its
`pre-review` checkpoint runs before T-116 and T-117; test IDs stay stable.
T-119 through T-123 cover the five confirmed review findings. For each,
first execute the new regression against the unfixed code and retain the
failing behavioral assertion, then apply the fix and retain the passing
result. These red/green records supplement the combined local checkpoint;
they do not replace candidate Review.
T-124 through T-126 apply the same red/green sequence to normalized retry
protection, terminal notice acknowledgment, and archival with retired checkouts.
T-127 through T-129 extend that sequence to verified provider defaults,
interrupted mutable-fact archival, and public operation-family integration.

### Exact proof for an external action (T-107)

Each row is a separate fixture. The test checks the prepared destination and
verifies **either** a supported host-propagated tool-call ID tied to the actual
provider-call result **or** a hosting-service request/dispatch ID (or
provider-supported idempotency token) connecting *this* dispatch to its
resulting identity. A matching word such as `succeeded`, or an earlier
identical action's result, must stay `uncertain` without either causal link.
If neither host nor provider can establish one, report observed state
separately while this invocation remains uncertain.

| Prepared action | Required result for success | Examples that must not count |
|---|---|---|
| Start and finish an execution for a selected workflow/build and candidate | Exact execution and attempt; evidence of its terminal result, not just queue acceptance | Submission only, missing attempt when required, another run or candidate |
| Produce an artifact for a candidate | Exact artifact, producing execution, source/configuration and immutable content identity | Artifact from another build, changed bytes or missing digest |
| Deploy an artifact to a target environment | Exact deployment ID, environment, target, candidate artifact and proven deployment outcome | Another target, queued deployment or different artifact |
| Create or update a PR in a hosted repository | Exact hosted URL, PR ID, source/target repositories and branches/revisions, and resulting requested state | Another PR, branch, revision, draft state or mere API acceptance |
| Publish or delete a Git ref | Exact hosted destination URL and ref; published revision, or proven deletion of that ref | Another destination, wrong revision, or empty lookup after a possible dispatch |
| Change a policy or configuration | Exact target and verified resulting policy/configuration version | Accepted request with unchanged or wrong configuration |
| Deliver a notification | Exact recipient/destination and delivery receipt for the intended content | Queued but undelivered message or wrong recipient |

`not-started` requires affirmative host evidence of no dispatch. Test a
sequential retry after an earlier identical action becomes uncertain, including
a newer tool-call ID: new managed credit remains blocked. An applicable,
unexpired, destination-specific explicit exception may allow a new attempt but
cannot declare the previous one successful or prove the retry's result. Expired
and wrong-target exceptions must be rejected.

## How the tests obtain safe evidence

1. Create two disposable local Git checkouts that each point to the same
   fake hosted URL, then give one checkout several remotes with arbitrary
   names and distinct URLs. Try zero, one, and several remotes, missing names,
   renaming without URL changes, checkout relocation, changed fetch URLs,
   different fetch/push URLs, and several configured destinations. Assert
   cross-checkout evidence never counts and selection ambiguity stays
   unresolved. Verify any claimed HTTPS/SSH equivalence through fake hosting
   service evidence, not similar-looking text.
2. Use fake hosting-service responses for default branches, PRs, checks, runs,
   and artifacts. Advance branch revisions and run attempts independently.
   Test forks with the same source and target branch names in different
   repositories. Give two checks the same display name but different result
   and producer IDs. Verify the revision actually tested, including a valid
   generated merge revision and an unrelated one.
3. Exercise not-started, submitted, running, succeeded, failed, cancelled,
   partial, missing-handle, and timed-out results for every supported external
   action. Use deterministic barriers to race duplicate preparations, callbacks,
   evidence recording, and cleanup; inject failure after a durable write but
   before the next projection. Reopen the stored data and verify no duplicate
   success, lost dependency, or automatic redispatch.
4. Check exact record sizes at 4095/4096/4097 bytes and text limits at
   511/512/513 characters. Provide referenced bytes through an isolated,
   read-only file; verify matching content, 4 MiB/+1 boundaries, changed
   content, and missing files. Never print unsafe fixture values in test output.
5. Load copies of old framework records, compare their stored content before
   and after loading, and verify that only freshly proven facts gain new credit.
   Replay mixed old/new history after each injected interruption and compare
   its ordered events and credited outcomes to an uninterrupted run.
6. Create a separate cleanup fixture for each reason to retain a PR/check
   association or polling record: current readiness, terminal notice,
   uncertain action, audit reference, and incomplete recovery. Remove all
   other consumers, run cleanup, and assert the sole dependency survives.

All hosting-service access is intercepted by fixture adapters that fail on
unexpected calls; fake hosted URLs use reserved `.invalid` domains. Child
processes are restricted to expected commands and run with temporary
`HOME`/`USERPROFILE`, `XDG_CONFIG_HOME`, npm config/cache and empty Git config;
`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` set to the fixture's empty file,
and inherited Git URL rewrites, credential helpers, tokens, proxies,
Git-askpass, and provider variables are removed. PowerShell runs with
`-NoProfile -NonInteractive` and cmd with `/d`; an unexpected external/network
command fails the fixture. Each test awaits and verifies cleanup of its owned
files, workers, processes, locks, clocks, and adapter registrations even after
an injected failure; tests pass independently and in any order.

## Execution order after implementation

1. **Unit tests first:**

   ```powershell
   node --test test\provider-observations.unit.test.mjs test\execution-artifact-identity.test.mjs test\tool-adapters.test.mjs
   ```

2. **Focused integration tests:**

   ```powershell
   node --test test\provider-observations.test.mjs test\effect-reconciliation.test.mjs test\host-invocation.test.mjs test\provider-neutral-workflow.test.mjs
   ```

3. **Affected existing tests:**

   ```powershell
   node --test test\provider-adapters.test.mjs test\monitors.test.mjs test\pr.test.mjs test\workflow.test.mjs test\recovery-gate.test.mjs test\storage.test.mjs test\decisions.test.mjs test\deployment.test.mjs test\advisory-gate.test.mjs test\instructions.test.mjs
   ```

4. **Full local checks:** `npm test` and `npm run check`.

5. **Native Windows checks:** Record the selected native x64 Node executable
   (22+), Go 1.27.1 where launcher coverage needs it, Git, PowerShell 5.1+,
   and cmd.exe; then run:

   ```powershell
   node --test test\platform.test.mjs test\storage.test.mjs test\recovery-gate.test.mjs test\winget-launcher-native.test.mjs
   ```

   Install the candidate into a disposable Copilot home, invoke all eight
   installed hook entries with safe fake payloads, verify valid output and
   advisory behavior, and remove only that disposable installation. A
   distribution scenario requiring unavailable network isolation or a missing
   candidate launcher is `NotRun`, with a separate blocker explanation.

6. **Independent reviews:** Review Requirements, Test Plan, Technical Design,
   and the exact tested code with GPT-6 Astra xhigh. Fix blocking findings and
   repeat the affected checks and review.

7. **Built-in candidate review:** After all required local pre-review tests
   pass, run GitHub Copilot CLI `/review`. Any candidate change restarts the
   unit-first sequence and candidate review.

## Current result

Read the Status column and current `sdlc status` for the active cycle.
Results from superseded candidates remain history. This plan and its local
fixture results do not authorize remote work.
