# AI SDLC Framework - Human Design Overview

**Review target:** 5-10 minutes. **Status:** Implementation candidate;
publication and DEV remain separately authorized.

This is the short review view of the [detailed Technical Design](technical-design.md),
not a second specification. It summarizes the same workflow and decisions.

## 1. What the framework delivers

A development request activates the lifecycle; an information-only question does
not. The agent works from requirements, one evolving Test Design/Test Plan, and
Technical Design. The goal is productive, controlled development, with you
retaining final authority.

## 2. The workflow you are reviewing

Normal flow, unless you explicitly override a framework guardrail:

<!-- shared-review:workflow:start -->
```text
Development request
  -> Requirements -- user approval --> Test Design / Test Plan
  -> user approval --> Technical Design
  -> user approval --> Coding <-> local unit-first testing
  -> GitHub Copilot CLI /review
  -> user confirms Review completion and authorizes publication/DEV
  -> check PR prerequisites when required
  -> DEV artifact build/reuse -> DEV deployment -> DEV tests
  -> user confirms DEV -> recommend STAGING -> user authorizes STAGING
  -> check PR prerequisites when required
  -> STAGING build/deploy -> policy-selected owner tests at an authorized location
  -> user confirms STAGING -> check required PROD PR validation
  -> recommend PROD or missing prerequisites (no automatic run)

Any fix: repeat unit-first local testing and /review; no automatic remote redeployment.
```
<!-- shared-review:workflow:end -->

One explicit response may confirm completion and authorize the next step
together. Within an authorized DEV attempt, individual build/deploy/test jobs
do not require repeated prompts. STAGING testing follows the selected
owner/location policy and still requires explicit completion confirmation.
You can request an early document/draft PR, but it is visibly unreviewed and
does not satisfy the candidate Review stage. PR handling is not a separate phase.
See the [detailed deployment flow](technical-design.md#72-dev-to-staging-to-prod-recommendation).

## 3. How the pieces fit

<!-- shared-review:architecture:start -->
```text
User
  |
Copilot CLI: instructions + phase skills
  |                                      |
Local sdlc CLI <--- runtime hooks ---> Agent's authorized tools
  |                                      |
Thin state + evidence references       Git / CI/CD / cloud provider
```
<!-- shared-review:architecture:end -->

Hooks are event handlers, not AI agents. They check actions and capture results;
the agent's tools perform network operations. There is no separate state service.

## 4. The main engineering decisions

<!-- shared-review:decisions:start -->
1. **Install once into Copilot CLI.** Instructions and skills apply across
   repositories; compatible repository configuration supplies local conventions
   and commands without duplicating the framework.
2. **Separate reasoning from bookkeeping.** The agent understands requests and
   uses its authorized tools. An offline, dependency-free Node CLI manages
   structured decisions, state, and deterministic checks.
3. **Keep state thin and history in Git.** Active state holds references, not
   copies of documents. Git records changes and audited decisions; local records
   preserve pending decisions and operations until they can be safely retired.
4. **Authorize before acting; audit afterward.** Decisions are bound to captured
   user input, the identified work, and relevant revisions. Retries reuse the
   same decision rather than asking again or applying it twice.
5. **Keep the fast loop local and review before publication.** Every fix reruns
   the required pre-Review local checkpoint from unit tests and then Copilot CLI `/review`.
   DEV work waits for Review completion and user authorization, STAGING testing
   follows its configured owner/location, and PROD is recommendation-only.
6. **Use advisory, overridable lifecycle stages.** Requirements, Test Design,
   Technical Design, Coding, Review, orientation, and stage progression may be
   explicitly skipped after at most one warning. Other findings mark work
   unmanaged/uncredited but do not become framework tool vetoes.
7. **Use small tests, not an AI evaluation campaign.** Observe ordinary work and
   exercise deterministic component contracts with isolated fixtures. Untested
   integrations remain explicitly unverified.
8. **Keep PR controls separate.** Create or reuse PRs only with user authority.
   Built-in `/review`, provider reviewer approval, PR validation, merging, and
   producing a deployable artifact are separate facts.
9. **Package reproducibly before installation.** CI runs the existing checks and
   tests, creates one `ai-sdlc-framework-<version>.tgz`, compares its digest and
   inventory with a fresh build, and verifies install/update/doctor/uninstall in
   an isolated Copilot home. It does not install into your real environment.
10. **Use focused engineering guidance.** Separate knowledge, coding, testing,
    building, and reviewing files carry strong reusable practices; compatible
    repository-specific rules remain higher priority.
11. **Adapt hosts and shells explicitly.** macOS, Windows PowerShell, and
    Windows Command Prompt use deliberate shell, path, filesystem, process, Git,
    and command-adapter contracts. Simulated Windows checks never become native
    Windows evidence, and unsupported combinations such as cmd-on-UNC remain
    visible.
12. **Keep enforcement outside the framework.** Framework state records managed
    lifecycle assurance; actual execution controls remain with Copilot, the OS,
    sandbox, filesystem, network, identity and access management, repositories, providers, and
    environments.
13. **Keep every member document.** Multi-repository work items can register
    multiple named Requirements, Test Plan, and Technical Design documents per
    repository. Composite artifact identity prevents one member or document
    from replacing another, while checks, approvals, and recovery use the
    complete set.
<!-- shared-review:decisions:end -->

Details: [installation](technical-design.md#3-installation-and-capability-contract),
[state](technical-design.md#5-thin-state-concurrency-and-retention),
[authorization](technical-design.md#6-user-decisions-overrides-and-audit-events),
[gate rules](technical-design.md#8-gate-evaluation-and-session-recovery), and
[PR handling](technical-design.md#75-pr-creation-validation-and-environment-readiness).

## 5. Your control and visibility

In-scope documents are maintained automatically with change notifications.
Unrelated execution and documentation each need your authorization. Repository
conflicts are presented for your resolution.

Every framework-triggered or user-reported pipeline is monitored every minute,
with a verified link and completion notice. Observing it grants no deployment
or stage-advancement permission.

Each test shows `NotRun`, `Passed`, or `Failed` for the current cycle. Readiness,
blockers, and uncertain evidence are separate. Declining a suggestion or remaining
silent never becomes permission to advance.

## 6. Failure behavior and limits

1. **A fix restarts local verification and Review.** Old test and `/review`
   results become historical. The framework does not push the changed candidate
   or spend another DEV build/deployment cycle without current Review and
   applicable authorization.
2. **A session interruption triggers recovery.** The framework checks work-item,
   repository, branch, decisions, and outstanding operations before resuming.
   Missing evidence becomes a stated blocker, not invented approval.
3. **An uncertain remote action is reconciled before retrying.** A lost response
   does not mean a deployment never started. The framework follows the existing
   run rather than blindly queueing another.
4. **The limits stay visible.** Hooks can be bypassed or time out; they are not a
   security boundary. A stopped host cannot keep polling. Git cannot recover
   unaudited local facts that were lost. Checks inspect recorded evidence, not
   prove every AI judgment correct.
5. **Platform evidence stays host-specific.** The deterministic Windows
   contracts and PowerShell Core checks on macOS do not prove Windows
   PowerShell 5.1, cmd.exe, NTFS, junction, lock, rename, or actual Windows
   Copilot-hook behavior. Those remain `NotRun` until exercised on Windows.
6. **Stage findings become one-time advisories.** Missing phase approval,
   orientation, local validation, Review, or stage completion may be explicitly
   overridden without repeated warnings. Other findings receive no repeated
   framework warning and no managed credit, but still reach normal permissions.

Review the workflow, boundaries, and choices here; schemas and detailed contracts
remain in the authoritative design. The [Test Plan](test-plan.md) covers small,
focused validation.

**Source revision:** `technical-design.md` Git blob
`c5f5261594325d18d8bfc62c13a430a59192abd0`.
Refresh this overview when that source changes; Git carries the history.
