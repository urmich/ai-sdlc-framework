# Requirements: Public repository readiness

Status: 2026-10-20 testing-policy revision; Test Plan and implementation maintenance
under explicit user direction. No current-candidate or public-readiness pass is
claimed.

Earlier baseline: Requirements were approved for Test Design, followed by
user-directed PR-metadata/repository-only guardrail revisions.

**Current maintenance context:** The earlier-baseline paragraph records the earlier
Requirements snapshot, not a denial of subsequent Coding authority. Coding was
approved by receipt `38b280bf83f9997766de82107edc296611d7ac57`,
decision `event-decision-e89f9f4423a12a693c156ce74a71f7bdc3a98fd8` (sequence 3).
The approved baseline SHA-256 remains
`8311068e1a75ba4e08fda5331f24baf99f47db06cd86743666aa0f49d985cdea`;
current document/link maintenance does not rewrite that historical snapshot.
The installed 0.4.0 resume capacity failure issued no ACK token; permitted source
Coding is uncredited by that failed managed recovery, not fabricated as resumed.
Current execution projections belong to the living Test Plan and retained
evidence, not this header. Source implementation or document maintenance alone
does not grant passing execution credit.

**2026-10-20 revision:** The user rejected the broad, 18-minute local
"critical" loop. The required replacement is a small explicit local sanity gate,
repository-only instructions for classifying future tests, complete applicable
PR coverage on appropriately provisioned runners, and dependency-aware parallel
execution in both locations. The old Coding receipt and recorded C07 results
remain historical evidence for their original scope, not approval or passing
evidence for this revised policy. Public repository professionalism must be
assessed separately from an unpublished working tree; no unverified launch-ready
claim is permitted. The subsequent clarification explicitly requires at least
five established public GitHub reference projects, adoption of their strongest
applicable practices, and preservation of this repository's distinct identity.
The user subsequently directed implementation without waiting for the remaining
planning approvals, then explicitly requested continuation of the Test Plan.
Those directions do not rewrite historical approval snapshots or grant hosted
execution, publication or unrelated provider-setting authority. The later
specific approval to enable this repository's private vulnerability reporting
was applied and verified separately.

The later explicit direction to resolve Mac bottle provisioning and select the
newest suitable stable Node authorizes the current toolchain-baseline revision,
not a local runtime installation or release. Select the complete compatible
native dependency snapshot, preserve Node >=22 product support and all required
native assertions, and resolve the owned-prefix incompatibility rather than
silently forcing bottles or substituting system runtimes. Current versions and
execution projections belong to the living Test Plan; prior approvals and
failed executions remain unchanged.

## Outcome

Make this repository professional and safe for public contributors: fast,
trustworthy feedback; complete pull-request validation across supported native
platforms; an explicit, dependable automated release; and navigable documentation.
Provide execution evidence and readiness as a reusable framework capability,
with this repository's own development as a reference consumer of that same
capability, not a separate repository-specific evidence implementation.

This is a new readiness increment, not a claim that the completed
test-performance or GitHub-integration increments were never tested. Existing
requirements and their evidence remain historical inputs. No test, supported
behavior, security control, or release check may be removed merely to improve
timing or obtain a green result.

## Observed starting point

Discovery uses source commit `749636e76ff4b5712857b82b7a85406d42eaee5c`.

| Area | Verified observation | Reference |
| --- | --- | --- |
| Visibility | The repository is already public. This request concerns launch readiness, not a visibility change. | GitHub repository metadata, 2026-10-15 |
| Test discovery | The full Node runner discovers 74 top-level test files. It defaults to up to 16 independent file processes, with a configurable limit of 1-32. Top-level cases inside a file are not thereby parallelized. | `scripts/test-runner.mjs`; `scripts/test-worker.mjs` |
| Slow tail | Retained comparable-case reports identify `observation-retention-regression.test.mjs` as the dominant summed top-level-case time. The file includes genuine retention/exhaustion loops and process-global fixture instrumentation; increasing workers alone does not split it safely. | Retained 0.4.0 Linux/Windows full reports; `test/observation-retention-regression.test.mjs` |
| Timing | Historical 0.4.0 local full runs took about 44.5 minutes on Linux and 113.6 minutes on Windows, under different recorded worker/runtime environments. The latest hosted main validation job took about 19.3 minutes. These are baselines, not interchangeable benchmarks. | Retained 0.4.0 reports; GitHub run `38721943164`, job `116378381166` |
| PR coverage | Full tests and package verification run only on Ubuntu. Windows and macOS run the fast profile and runner-command smoke checks. | `.github/workflows/ci.yml` |
| Coverage gaps | Platform/capability conditions skip Homebrew, Windows hooks, native launcher, standalone lifecycle and other cases. Node discovery alone does not prove that Go, Python, Ruby, shell, package-manager or native behavior executed. | `test/*.test.mjs`; `cmd/sdlc-launcher`; `packaging`; `scripts` |
| Merge enforcement | `main` has no branch protection; the repository ruleset list is empty. Workflow jobs being present is not enforced merge protection. | GitHub branch protection/ruleset APIs, 2026-10-15 |
| Workflow controls | Default workflow token permission is read-only. Actions are unrestricted. Existing release environments have no protection rules or branch policies. Several repository security features are disabled. | GitHub Actions, environment and repository metadata, 2026-10-15 |
| Release sequencing | Tag validation, opt-in publication, public GitHub assets and postpublication acceptance are not one end-to-end automated operation. A tag validation failed because its explicit destination variable was absent. | `.github/workflows/release.yml`; `.github/workflows/release-acceptance.yml`; run `38700825126` |
| Execution evidence | The framework records candidate-bound per-test outcomes and checks that every required checkpoint case has current passing evidence. This repository's runner has opt-in per-case JSON reporting, and release sealing enforces source-bound platform gate results; the workflows do not yet require a complete retained per-case evidence inventory covering every required test/platform before publication. | `src/validation.mjs`; `src/authority.mjs`; `scripts/test-worker.mjs`; `scripts/release-bundle.mjs`; `.github/workflows/release.yml` |
| Actual 0.4.0 outcome | npm publication, package hashes and provenance metadata were verified. After the Homebrew prefix repair, public asset, native Apple Silicon, isolated npm and Homebrew consumer acceptance passed. The merged repair CI also passed. | Runs `38589183080`, `38722057530`, `38721943164`; merged PR #18 |
| Documentation | Root-level SDLC documents are mixed with reader guides and feature folders. Standard contributor/governance documents are not tracked at the repository root. | Tracked `docs/` inventory; tracked root Markdown inventory |

No new benchmark, live publication, ruleset mutation, credential change or
installer operation is part of this discovery.

## Requirements and requirement-specific definitions of done

### FR-200: Define complete, executable validation coverage

Maintain one authoritative inventory connecting shipped behavior and existing
automated assertions to their actual execution locations.

**Definition of Done**

- AC-200.1: Account for every existing Node test and every shipped CLI,
  installer, launcher, hook, packaging/release utility and supporting
  Go/Python/Ruby/shell validation surface. Identify direct tests, actual process
  tests, fixture-only tests and untested behavior separately.
- AC-200.2: Each required case has an executable selector or exact automated
  procedure, platform/architecture, prerequisites and checkpoint. Every current
  skip condition has an owner and an explicit coverage disposition.
- AC-200.3: Newly added tests/utilities cannot silently disappear from the
  required inventory. Missing, duplicate, stale or unmapped required coverage
  fails validation.
- AC-200.4: An assertion passing through a mock, cross-build or metadata check
  cannot satisfy a requirement for native execution or public-client acceptance.

### FR-201: Make the local development loop fast and useful

Use local execution for early defect detection without requiring every
contributor to reproduce all hosted environments before opening a PR.

**Definition of Done**

- AC-201.1: Document fast, impacted/targeted and full commands, including when
  each is appropriate. The default local gate runs only the explicit critical
  sanity selection, unit tests first, with relevant cheap static checks.
  Targeted/affected checks are an explicit development/debugging choice, not a
  way to add every feature regression to the default local gate. Full local
  execution remains opt-in; complete applicable PR validation remains mandatory.
- AC-201.2: The critical set is limited to representative checks that the system
  starts and its essential CLI, persistence, installation, authority and evidence
  contracts work. Its finite membership, count budget and addition rationale are
  explicit and reviewable. A test does not become critical merely because it is
  automated, local, pre-review, in a unit file or associated with this increment.
  Exhaustive feature, stress, platform, packaging and failure-matrix coverage
  stays required in PR rather than being relabeled critical. A narrow sanity
  result never claims complete feature or release acceptance.
- AC-201.3: Failure, cancellation and partial completion produce explicit
  non-success outcomes and retained diagnostics.
- AC-201.4: Measure timing against advisory goals on a recorded reference
  environment with case inventory, toolchain, resources and worker limits.
  Measure the actual default command, not only selected callback durations.
  Criticality and correctness take priority over speed; use representative
  sanity checks rather than silently deleting important assertions to meet a
  target. Moving exhaustive coverage to PR is a declared placement change,
  not a same-inventory speedup. Unexpected local-suite growth must be detected.
- AC-201.5: Provide repository-local contributor and agent instructions defining
  exactly how new and changed tests are classified: criteria for critical
  membership, PR-only default, explicit targeted use, required capabilities,
  independent logical group, dependency/shared-resource declarations, owner,
  and the checks used to validate that classification. Adding a test must not
  silently expand the critical gate or disappear from complete PR coverage.
  These policy choices and instructions belong only to this repository; they
  are not installed, exported or imposed as framework defaults on other projects.

### FR-202: Remove avoidable serial test execution

Exploit safe case, file and job independence instead of only increasing worker
counts.

**Definition of Done**

- AC-202.1: Measure the actual critical path before selecting optimizations.
  Partition independent work with bounded, resource-aware concurrency while
  retaining every required assertion and test identity.
- AC-202.2: Shared environment variables, module patches, registries, filesystem
  fixtures and package-manager prefixes cannot race between concurrent cases.
  Stateful scenarios preserve their necessary internal ordering.
- AC-202.3: Compare baseline and candidate under the same selected assertions,
  runtime, platform, resources and concurrency conditions. Report elapsed time
  and pass/fail/skip counts; do not infer speedup from unlike environments.
- AC-202.4: Preserve real storage, durability, retention-limit, concurrency,
  recovery and cleanup tests. Do not replace necessary integration behavior with
  cheaper mocks, reduce exhaustion boundaries, or hide flaky failures.
- AC-202.5: Partition tests into explicit logical execution groups with declared
  independence, dependencies and shared-resource constraints. Independent groups
  can execute in isolated processes even when their tests originate in the same
  file. Genuine dependent scenarios and their necessary ordered steps remain
  sequential. Every required assertion belongs to the complete execution plan
  exactly once; missing, overlapping or cyclic assignments are diagnosed.
- AC-202.6: Local and PR execution use a bounded, resource-aware ready-work pool.
  Capacity released by a completed independent group is available to remaining
  runnable groups; a fixed split must not leave workers idle while independent
  work is queued. Nested producers share the same aggregate resource budget,
  and declared minimum/exclusive resources are acquired before timed work starts.
- AC-202.7: Demonstrate actual overlap of independent groups and correct ordering
  of dependent groups through original process/timing evidence, locally and in
  the applicable PR environment. Report worker utilization, critical-path and
  remaining serial-tail measurements. Configured concurrency or valid YAML is
  not execution proof and is not advertised as full optimization. Each complete
  logical native PR lane must meet its release-candidate limit: Linux at most
  7 minutes 40 seconds, Windows at most 11 minutes 5 seconds, Apple Silicon at
  most 10 minutes 27 seconds, and Intel macOS strictly under 20 minutes.
  Include toolchain setup, required tests/procedures, evidence retention and
  owned-resource cleanup. Intel's former 15-minute target remains a stretch
  goal, not the current release-candidate limit.
  If a lane has parallel required parts, measure from the earliest part's worker
  start to the latest part's completion; timing one part alone does not satisfy
  this target. Report provider queueing separately without hiding a queued part
  inside an otherwise running lane.

### FR-203: Require complete PR validation without trusting local claims

Every contribution must receive the required evidence from GitHub runners before
merge, even when its author ran nothing locally.

**Definition of Done**

- AC-203.1: Pushes to a branch with an open PR, new PRs and relevant updates
  automatically run the complete required PR validation for the current
  candidate. A first PR cannot depend on a contributor's local result.
- AC-203.2: Linux, native Windows and native macOS jobs execute their applicable
  substantive tests and utilities, not just command-smoke tests. Windows x64,
  Apple Silicon macOS and Intel macOS native coverage is required. The Test Plan
  defines exact supported runner/toolchain versions and case assignments.
  Linux validation covers shared framework/CLI, filesystem, Git, tooling and
  applicable shell behavior on the hosted development environment; it does not
  add a supported Linux standalone distribution.
- AC-203.3: Required native Windows jobs provision the real launcher and required
  toolchains; required macOS jobs exercise actual Homebrew and shell behavior in
  isolated owned prefixes. The applicable Go tests and schema tooling execute.
- AC-203.4: One stable required result aggregates the complete expected job/case
  inventory for the exact PR candidate. Failure, cancellation, missing jobs,
  unexpected skips and unavailable required capabilities cannot produce success.
  Parallel producer parts are independently required, source/artifact-bound
  executions; a passing framework part cannot substitute for a missing native
  package-manager procedure or its cleanup evidence.
- AC-203.5: Sharding and change-aware selection never omit required coverage.
  Heavy stress/security/install cases are assigned explicit required jobs rather
  than silently moved to non-blocking schedules.
- AC-203.6: Uploaded sanitized reports expose exact commands/selectors, toolchains,
  case results, skips and source identities, including partial/failing runs.
  PR authors and approvers can inspect test successes, failures and unexecuted
  required cases through the normal pipeline UI, with per-platform totals,
  failure diagnostics and links to complete per-test reports/logs. Do not
  require a custom dashboard or silently hide outcomes because a summary is
  size-limited.
- AC-203.7: Every automatable code test that requires capabilities unavailable on
  the normal contributor machine has an explicit required PR runner/group and
  reproducible pinned setup. This includes authentic signature-verification
  fixtures, native platforms and specialized tools. CI provisions the approved
  inputs or fails that required gate with an actionable diagnostic; missing
  local inputs do not block the small local sanity gate and missing PR inputs
  cannot silently pass through a skip. PR validation includes the critical tests
  as well as the rest of the applicable suite. Tests of publishing and provider
  administration use safe isolated fixtures or separately authorized trusted
  probes; ordinary untrusted PR code never publishes a release, changes live
  repository policy or receives those privileges. Actual public-release
  acceptance remains after an authorized publication, not fabricated from
  unpublished candidate bytes.
- AC-203.8: Independently packaged test/example projects in this repository have
  explicit required PR commands and actual reported outcomes when they contain
  real project tests. Keep their assertion namespaces and totals distinct from
  framework tests. Merely inventorying an independent fixture project is not
  execution or a pass; intentionally failing inputs remain exercised by their
  owning regression scenarios rather than being mistaken for standalone suites.

### FR-204: Keep untrusted PR execution unprivileged

Strong validation must not expose publication or repository-administration
authority to contributor code.

**Definition of Done**

- AC-204.1: Fork PRs run the safe required test matrix without publishing
  credentials, OIDC publication permissions, production deployments or access to
  a maintainer's installation.
- AC-204.2: No privileged workflow checks out or executes untrusted PR code.
  Artifacts, caches and workflow handoffs cannot transfer unverified executable
  data from a PR into a privileged publishing job.
- AC-204.3: External-action dependencies and workflow permissions have an explicit
  trust policy. Static checks enforce the adopted policy, not merely the
  presence of workflow files.
- AC-204.4: Fixtures install/uninstall only in owned isolated homes/prefixes and
  clean their exact resources. No test modifies OS, corporate IT, account or
  shared package-manager policy to obtain a pass.

### FR-205: Enforce merge guardrails in GitHub

Required tests must be real merge prerequisites, not advisory green decorations.

**Definition of Done**

- AC-205.1: Define and verify the effective `main` branch rules: PR requirement,
  current required checks, required review policy, stale-approval handling and
  conversation resolution. The confirmed solo-maintainer policy requires
  maintainer review of external contributions; an owner's own PR does not require
  impossible self-approval or an additional human approver. All mandatory CI
  checks still apply to owner PRs. Specify how provider controls and documented
  maintainer responsibility implement that distinction without claiming that a
  global review toggle enforces an author-specific rule it cannot express.
  Include this repository's required coverage-metadata check from FR-214;
  installing the framework elsewhere must not impose that repository policy.
- AC-205.2: Direct pushes, force pushes, deletion and administrative bypasses
  follow the explicitly approved policy. Do not silently exempt maintainers.
- AC-205.3: Verify that a failing, missing, stale or skipped required result
  prevents merge. Source configuration alone does not prove provider enforcement.
- AC-205.4: Document unavailable account-tier controls and owner actions
  truthfully. Repository settings, trust relationships and access changes require
  explicit scoped approval before applying them.

### FR-206: Provide one automated, authorized release flow

After the chosen maintainer release trigger, the pipeline owns the complete
approved release sequence without manual glue or repeated per-job intervention.

**Definition of Done**

- AC-206.1: Validate the source/version/tag, destination, toolchains, required
  settings, authority and channel prerequisites before irreversible publication.
  Missing `RELEASE_REPOSITORY` or equivalent configuration fails early and clearly.
- AC-206.2: Complete required candidate checks, deterministic packaging and native
  gates before publication. Publish one immutable, source-bound package/bundle
  to the approved npm and GitHub destinations without rebuilding between channels.
  The macOS distribution uses the single shared artifact required by FR-212.
- AC-206.3: Automatically invoke required postpublication acceptance with the
  exact saved artifact IDs/digests and source. No separate manual workflow
  dispatch or unpublished-GitHub-assets surprise remains.
- AC-206.4: A PR never publishes. Preserve token-free npm trusted publishing and
  exact caller/environment checks; missing permissions/trust are explicit
  preflight findings, not token fallback or policy-bypass instructions.
- AC-206.5: The trigger/approval policy is confirmed before implementation.
  One explicit maintainer release start is the confirmed entry point; the
  remaining approved sequence is automated without separate manual acceptance
  dispatches. Automation does not imply automatic merge, automatic version
  selection, unrestricted future publication authority or automatic PROD
  deployment.

### FR-207: Make release retries and outcomes reliable

Handle eventual consistency and partial cross-channel publication without
misreporting success or duplicating irreversible effects.

**Definition of Done**

- AC-207.1: Publication/readback retries are bounded, observable and appropriate
  to registry propagation. A failed verification window distinguishes an actual
  failed publish from a publish whose outcome needs reconciliation.
- AC-207.2: Reconcile existing version/tag/release/assets/run attempts before
  retrying. Identical immutable content can resume safely; conflicts fail without
  overwriting assets, moving tags or changing an existing version.
- AC-207.3: Retain exact per-channel and per-job results when npm and GitHub do
  not complete together. Recovery never claims transactional rollback.
- AC-207.4: Overall release success requires all required publication and
  acceptance results, including exact byte identity and required provenance.
  Failed, missing, skipped, unavailable or unverified required checks block it.
  Apply the execution-evidence and readiness contract in FR-213 rather than
  treating a green workflow summary as proof of complete coverage.
- AC-207.5: Preserve and explain historical failures. Provide actionable final
  diagnostics and execution links without credentials, raw tokens or signed URLs.

### FR-208: Verify published installation on supported platforms

Detect installation and upgrade failures automatically on clean native consumers
instead of relying on the developer's Windows machine.

**Definition of Done**

- AC-208.1: Required native consumers anonymously fetch the exact release with
  empty caches, verify external descriptor/checksums and package inventory before
  execution, and retain candidate-bound results.
- AC-208.2: Cover the applicable install, doctor, idempotent update, upgrade from
  compatible earlier installations, hooks, ordinary uninstall and explicit clean
  migration/purge scenarios while preserving unrelated content. Ordinary update
  recognizes supported ownership data, not a previous-version whitelist or
  semver-order gate; unknown owner/schema or malformed/unprovable ownership
  fails without destructive fallback. Use an authentic prior public CLI to
  establish representative old-install proof, then the verified new package's
  updater and updated installed CLI/doctor. Controlled ownership-format fixtures
  with representative version labels are not historical binaries; old updaters
  need not understand future package layouts. Explicit purge is a separate destructive
  reinstall, never an automatic upgrade remedy. This clarifies preserved core
  AC-045.8/10 and T-42; it adds no new readiness case or historical-binary
  acquisition requirement.
- AC-208.3: Exercise real supported standalone shells, npm lifecycle and native
  Homebrew install/upgrade/test/uninstall. Do not call an install/test/uninstall
  sequence evidence of upgrade if upgrade was not executed.
- AC-208.4: Assign unavailable native architectures, WinGet community/client
  acceptance and corporate-managed-device checks explicit dispositions. A
  platform skip is not silently accepted as complete support. Native Intel
  lifecycle is now a required PR/release result, not the previous metadata-only
  non-blocking limitation.
- AC-208.5: Verify required provenance against the exact source, workflow and
  artifact digest. Distinguish semantic metadata checks from cryptographic
  signature/certificate/transparency verification.

### FR-209: Organize documentation by audience and topic

Separate product documentation from internal development records.

**Definition of Done**

- AC-209.1: Provide a concise documentation landing page and navigable topics for
  getting started, installation/update/troubleshooting, usage, architecture,
  integrations, contributing/testing, and release/maintenance.
- AC-209.2: Canonical internal development artifacts follow exactly
  `docs/sdlc/<feature-name>/requirements.md`, `test-plan.md` and
  `technical-design.md`, using stable, descriptive feature slugs.
- AC-209.3: Migrate the root framework documents and existing feature documents
  without losing their IDs, content, approval history or evidence. Define the
  existing core framework location as `docs/sdlc/core-framework/`; retain the
  existing descriptive feature names under `docs/sdlc/`.
- AC-209.4: Update all inbound/outbound links, anchors, packaged documentation,
  generator references, checks and registered artifact locators. No stale path
  becomes silently authoritative or forces a historical evidence rewrite.
- AC-209.5: Keep generated evidence and large operational logs out of reader-facing
  documentation. Explain historical implementation records as such.
- AC-209.6: Automated checks reject broken local links/anchors and invalid
  canonical layout. Documentation-only PRs still execute relevant checks.

### FR-210: Present a professional contributor and maintainer experience

The public entry points must accurately explain how to use, contribute to and
maintain the project.

**Definition of Done**

- AC-210.1: README, documentation navigation and metadata agree on current
  supported versions, platforms, commands and release status; remove stale
  examples and unqualified readiness claims. Verify navigation separately in
  source, packaged and installed layouts; essential offline guidance must have
  a shipped target or an explicitly identified online reference.
- AC-210.2: Provide discoverable contribution, support, security-reporting,
  ownership/review and change/release guidance appropriate to this personal
  third-party OSS project.
- AC-210.3: Explain local/PR/release gates, expected failure diagnostics,
  supported environment requirements and how contributors reproduce CI.
  Provide a safe installation, installed-entry doctor, restart and disposable
  repository first-use journey. Distinguish installation integrity from actually
  observed Copilot/hook compatibility; identify tested versions and unverified
  combinations. Monitoring claims state the real scheduler, provider-read and
  running-host prerequisites rather than imply the offline CLI starts a timer.
- AC-210.4: Classify any security/governance work already covered by proposed
  FR-054 requirements before implementation; adopt the relevant work explicitly
  rather than duplicate specifications or silently expand this increment.
- AC-210.5: Public reader entry points distinguish published supported behavior
  from unreleased source and provide clear installation, usage and contribution
  paths. Keep transient test counters, internal work-item bookkeeping and
  implementation-recovery problems out of the public landing-page experience;
  retain their truthful evidence in the internal readiness records instead.
- AC-210.6: A professional/share-ready assessment identifies the exact published
  branch/revision and verifies its documentation links, current required CI,
  effective merge controls, usable private security route and released-channel
  claims. Unpublished source improvements or local tests alone are not an
  endorsement of what colleagues will see at the public repository URL. State
  missing evidence and deferred controls rather than promise universal or
  "strictest practices" certification.

### FR-211: Prove readiness through actual failure and success paths

Do not equate a prettier repository or valid YAML with working guardrails.

**Definition of Done**

- AC-211.1: Demonstrate failure propagation through the public runner, a missing
  required matrix/shard result, an unexpected skip, a platform prerequisite gap
  and a blocked merge using safe controlled tests or an authorized provider test.
- AC-211.2: Demonstrate release preflight failure before publication, recovery
  after an uncertain/partial publish and acceptance failure without false overall
  success. Controlled fixtures do not impersonate a live publication.
- AC-211.3: Obtain an actual successful candidate-bound PR matrix and an expressly
  authorized end-to-end release rehearsal before declaring the new flow ready.
  Do not republish or replace immutable 0.4.0 content for this purpose.
- AC-211.4: Produce a concise readiness report with timing measurements,
  coverage reconciliation, effective protection evidence, release outcomes and
  explicit remaining limitations. No claim of bug-free software or impossible
  guarantee against future third-party outages is made.

### FR-212: Ship one macOS artifact for Apple Silicon and Intel

Replace the two architecture-specific macOS archives in a future release with
one architecture-neutral archive containing the shared JavaScript payload and
shell launcher.

**Definition of Done**

- AC-212.1: Each future release publishes exactly one macOS standalone archive,
  clearly named for macOS rather than a single processor architecture, for
  example `ai-sdlc-framework-<version>-macos.tar.gz`. Users and automation do not
  need to choose between separate arm64 and x86_64 downloads.
- AC-212.2: The archive contains one copy of the shared payload and launcher,
  not nested copies of the old archives. It is not described as a Universal 2
  Mach-O binary. Node.js is not bundled; native Node.js 22+ remains required.
- AC-212.3: The shared installer/launcher supports native Apple Silicon and
  Intel Macs, validates the actual host and selected Node runtime, and rejects
  unsupported or incompatible execution before installation changes. Combining
  the download does not relax native-runtime or integrity checks.
- AC-212.4: Mandatory PR and release validation exercises the same exact macOS
  artifact bytes and digest natively on both arm64 and x86_64. Passing one
  architecture, cross-validation or Rosetta execution cannot substitute for
  required native coverage on the other.
- AC-212.5: Homebrew uses the same verified macOS archive URL and checksum on
  both architectures while selecting the appropriate native Node dependency.
  Both native consumer paths retain the lifecycle checks required by FR-208.
- AC-212.6: Deterministic packaging, manifests, checksum verification, release
  gates, consumer checks and documentation consistently represent the shared
  artifact and both supported architectures. No component still requires a
  missing architecture-specific archive.
- AC-212.7: Windows retains its separate distribution and native `.exe` launcher;
  the cross-platform npm package remains available. This change applies only to
  a future release: existing published 0.4.0 assets, checksums and tags remain
  immutable.

### FR-213: Provide framework-native execution evidence and readiness

Any SDLC using the framework must be able to produce durable, independently
checkable evidence of what actually ran and use it as an input to configured
validation checkpoints, PR readiness and release decisions. Requirements, Test
Plans and Technical Designs describe the agreed work; their existence, approval
or manually edited status is not evidence of successful test execution.

**Definition of Done**

- AC-213.1: Reuse and integrate the existing test-result, evidence and release
  bundle mechanisms rather than introducing a second competing ledger.
  Expose the capability through the supported framework interfaces for consumer
  projects. Automated execution adapters retain individual case outcomes from
  local checks, CI, release gates and postpublication consumers. Declared
  manual/semi-automated cases retain their actual procedure, owner, observed
  outcomes and evidence without pretending an automated runner executed them.
- AC-213.2: Each case result identifies its test/acceptance criteria, executable
  selector or procedure, actual outcome, expected-result evaluation, command
  exit, execution time, native platform/architecture/toolchain, checkpoint and
  source run/job/attempt where applicable. Record `Passed`, `Failed` or `NotRun`;
  retain skip, pending, running, cancelled and blocked diagnostics separately
  without treating them as passes.
- AC-213.3: Reconcile results against the complete expected inventory from the
  current Test Plan, including required platform/architecture variants. Every
  required case must have matching valid `Passed` evidence. Missing cases,
  missing shards/jobs, an empty denominator, conflicting results, unexpected
  skips and unavailable required capabilities prevent a passing readiness
  verdict. Zero reported failures or a successful job exit alone is insufficient.
- AC-213.4: Bind evidence to independently established tested source/content,
  test specification, configuration, execution environment and artifact digests,
  including required freshness. Preserve original outcomes and attempts
  immutably. Changed inputs invalidate affected current credit to `NotRun`;
  historical passes cannot hide a current failure or substitute for unexecuted
  tests. Missing evidence is unverified, not an invented failed execution.
- AC-213.5: Before irreversible publication, automatically verify and retain a
  prepublication readiness report proving that all required checks for the
  exact candidate/artifact have valid passing evidence. A consumer can wire
  the framework's readiness verdict into its publisher entrypoint to reject
  incomplete, stale, mismatched or failed required evidence. Do not trust
  contributor-authored status JSON as independent execution proof.
- AC-213.6: Keep prepublication readiness separate from release completion.
  Public-download, published-package integrity/provenance and clean-consumer
  checks can run only after the relevant publication and must all pass before
  declaring the release complete. A failed postpublication check records the
  actual partial publication state; it does not fabricate a rollback or erase
  the failure.
- AC-213.7: Retain sanitized machine-readable results and a generated readable
  summary in the consumer's declared evidence location, with explicit retention,
  digest bindings and references to the actual executions and artifacts.
  A maintainer on a clean machine must be able to retrieve and verify readiness
  from the retained evidence and authoritative project specifications, without
  the originating Copilot session, ephemeral test folders or remembered claims.
  Show required/passed/failed/not-run totals, capability/applicability dispositions
  and blockers separately for each checkpoint. Never label an exemption as a pass.
- AC-213.8: Prove that a missing case, required skip, stale source/specification,
  wrong artifact/platform, incomplete run and later failure cannot obtain a
  passing gate. Also prove that a complete matching passing inventory permits
  the authorized next step. Failure evidence and interrupted output remain
  available; resuming/retrying never rewrites the original record.
- AC-213.9: The framework contract is independent of this repository's test
  names, language, workflow layout and GitHub account. Use the consumer's Test
  Plan, requiredness, applicability and environment configuration; support
  normalized results from its selected runners/providers through trusted
  adapters. Preserve the offline, dependency-free core and existing provider
  boundaries rather than adding an implicit network client.
- AC-213.10: Keep evidence, readiness and action authority distinct. Framework
  findings remain advisory/uncredited under explicit lifecycle overrides and
  never become a tool veto. An override cannot manufacture `Passed` evidence or
  release authority. Real CI/repository/publisher controls may enforce a
  consumer's configured gate, and their actual enforcement is reported
  separately from the framework's readiness assessment.

- AC-213.11: As acceptance of this general capability, wire this repository's
  local critical checks, full native PR matrix,
  release gates and postpublication acceptance to the supported framework
  evidence interfaces and readiness rules. Retain provider execution evidence
  as required by AC-213.7; a session-local handcrafted aggregate is insufficient.
  Produce its generated readiness report from its actual Test Plan
  and retained execution records. Its PR and publisher controls enforce the
  configured required results without repository-specific shortcuts that other
  consumers cannot use.
- AC-213.12: Demonstrate the same public contract in an independent consumer
  project fixture with different test IDs, selectors, configuration and
  execution/result inputs. Show success, failure, missing/stale evidence and
  invalidation without changing framework code for that project's identity.
  Provider-neutral behavior must be exercised beyond this repository's Node/
  GitHub-specific report shape; fixtures do not claim live provider acceptance.
- AC-213.13: Preserve existing consumer records, workflow recovery, specification
  references and historical outcomes during adoption. Any evidence/schema
  transition has explicit compatibility and migration behavior; old unsupported
  evidence remains unverified rather than being silently credited or deleted.
- AC-213.14: Document how another project configures its Test Plan, integrates a
  test producer, retains evidence and consumes readiness in CI/release.
  Clearly distinguish reusable framework behavior, this repository's own
  policy, provider-enforced controls and separately authorized external actions.
- AC-213.15: Define a small, versioned, machine-readable coverage section in
  the PR description, connecting requirement/AC IDs, planned tests and their
  canonical specification/source identities. Generate and inspect it from the
  user-authored Requirements/Test Plan and existing test declarations without
  creating additional coverage, index, binding or policy files in the consuming
  repository. Identify uncovered ACs explicitly. Report declared traceability
  separately from semantic test adequacy and actual execution; neither a mapping
  nor an author's status field proves tests passed. This reusable format/helper
  does not impose CI/CD enforcement on consumer repositories.
- AC-213.16: Deliver the format's schema/example, authoring templates,
  native phase-skill/focused instructions and supported creation/inspection
  helpers as framework functionality. Help users find coverage gaps and prepare
  the PR-description section in memory; include or refresh it during separately
  authorized PR creation/update while preserving unrelated description text.
  A clean independent consumer must use the shipped guidance/interfaces without
  inventing a format, hand-copying a matrix or adding coverage files. Consumers
  choose their own CI/CD adoption; no helper or installation silently installs
  a required check, changes branch rules or grants PR publication authority.

### FR-214: Require PR coverage metadata in this repository's CI

Make declared requirements-to-tests coverage a mandatory PR guardrail for
`urmich/ai-sdlc-framework`. This is this repository's CI/CD policy, not a rule
the installed framework imposes on all consumer repositories.

**Definition of Done**

- AC-214.1: Implement a repository CI tool/check that reads the coverage
  section from the actual PR description and validates it against the current
  canonical Requirements/Test Plan. Missing, empty, malformed, inconsistent
  or stale metadata and missing required AC mappings cannot produce a passing
  check even if all executed tests pass. No generated coverage file is required
  or accepted as a substitute for the PR metadata.
- AC-214.2: Re-evaluate on PR creation/reopening, source updates and description
  edits, including deleting coverage without changing the commit. Bind the
  result to the actual PR source/specification and description version; an old
  event or earlier passing result cannot silently validate changed metadata.
  Where GitHub shares a repository/SHA/context status across PRs, reconcile all
  affected PRs rather than let one overwrite another's verdict. Preserve a
  non-passing outcome before status-write capacity is exhausted; capacity
  recovery requires a separately authorized fresh source identity, not leaving
  old success in place or bypassing the guardrail.
  Required-check behavior and current merge eligibility are verified in GitHub
  after separately authorized configuration, not inferred from workflow YAML.
- AC-214.3: Show the coverage verdict and actionable missing/invalid/uncovered
  requirement, AC and test identities in the native PR/Actions UI. Demonstrate
  missing-coverage failure and complete-matching-coverage success, separately
  from actual test outcomes. Checks are deterministic, require no pipeline LLM,
  and do not execute PR description text or untrusted candidate code with write
  privileges.
  Explain shared-key blocking PRs and capacity blockers separately from the
  current PR's test failures.
- AC-214.4: Scope automatic enforcement to this repository. Deliver the reusable
  authoring/inspection capability under FR-213, but leave other projects' CI/CD
  policies unchanged unless their owners explicitly adopt an integration.
  Installation or ordinary use creates no coverage sidecar files and performs
  no automatic provider-setting or access changes.

### FR-215: Benchmark and implement a professional public repository experience

Use established public projects as primary-source precedents, select their
strongest relevant practices, and implement a coherent experience suitable for
this project's actual size and purpose rather than copying a generic facade.

**Definition of Done**

- AC-215.1: Examine at least five well-established professional GitHub projects.
  Record each actual default branch, inspected commit, primary source URLs and
  evidence for relevant onboarding, contribution, testing/CI, security,
  ownership/review, issue intake and release/maintenance practices. Trace claimed
  execution behavior to scripts/configuration; stars, badges and reputation alone
  are not proof that a practice is implemented or effective.
- AC-215.2: Maintain an evidence-based adoption matrix: reference practice,
  applicability here, chosen adaptation, implementation location, verification
  criterion and actual outcome. Select the strongest applicable practices from
  the references, resolve conflicts into one usable contributor experience, and
  explain any deferral or non-applicability. A researched recommendation is not
  counted as an implemented improvement.
- AC-215.3: Preserve this project's user-governed lifecycle, explicit delivery
  authority, offline/dependency-free runtime, reusable evidence capability,
  consumer choice of CI policy and personal third-party MIT identity. Write
  original project-specific guidance; do not transplant other projects'
  copyrighted templates, branding, committees, CLA/license changes, support SLAs
  or automatic merge/deployment authority. Repository test policy stays out of
  installed framework defaults.
- AC-215.4: Assess the implemented selected criteria against the actual
  colleague-facing published revision, not only a polished working tree. Provide
  source-linked evidence and honest remaining limitations before claiming
  professional/share readiness. Matching or improving selected relevant
  practices does not imply universal certification, flawless software or
  equivalence to every process of a much larger organization.

## Primary-source comparison and proposed adoption

The five reference projects were examined in parallel on 2026-10-20. Their
actual default branches and immutable research revisions are recorded below.
These are recognized examples, not an objective ranking or proof that this
project already matches them. Linked source establishes inspected practices,
not the references' live CI outcomes or effective branch settings.

| Reference | Resolved default branch | Inspected revision | Strongest relevant precedent |
| --- | --- | --- | --- |
| Node.js | `main` | [`531d28fc360bd40b427561b1f85fd18743138626`](https://github.com/nodejs/node/commit/531d28fc360bd40b427561b1f85fd18743138626) | Explicit parallel/sequential/capability suites; inspectable worker execution and build prerequisites. |
| GitHub CLI | `trunk` | [`ed40e856ffecd31286733876c613a2d3745e12bd`](https://github.com/cli/cli/commit/ed40e856ffecd31286733876c613a2d3745e12bd) | Hermetic ordinary tests, cross-platform contributor commands and separately authorized live acceptance. |
| VS Code | `main` | [`dd545faabb05739fd2f331619f467a1fbb81f727`](https://github.com/microsoft/vscode/commit/dd545faabb05739fd2f331619f467a1fbb81f727) | Capability-specific native runners and deterministic smoke partitioning that includes registered suites with unknown durations. |
| Rust | `main` | [`8144389c895da997dbdecaa635e41d6a50be6ffd`](https://github.com/rust-lang/rust/commit/8144389c895da997dbdecaa635e41d6a50be6ffd) | Test-placement guidance, automatic discovery and validated typed CI job classification. |
| Kubernetes | `master` | [`c3b1e97124b974a50411c6527d1c03199287b511`](https://github.com/kubernetes/kubernetes/commit/c3b1e97124b974a50411c6527d1c03199287b511) | Explicit quick-verification membership, separate required specialized jobs and resource-bounded execution. |

The following matrix records proposed delivery choices, not implementation
approval. Every row's current acceptance outcome is **NotRun** for this revised
scope. Existing candidate code or historical component passes are not evidence
that these revised outcomes have been delivered. Update this same matrix with
actual implementation and retrievable proof during the authorized later stages.

| Practice and source | Decision and project-specific adaptation | Intended implementation location | Verification criterion |
| --- | --- | --- | --- |
| [Kubernetes explicit quick selection](https://github.com/kubernetes/kubernetes/blob/c3b1e97124b974a50411c6527d1c03199287b511/hack/make-rules/verify.sh#L79-L103); [CLI local versus CI checks](https://github.com/cli/cli/blob/ed40e856ffecd31286733876c613a2d3745e12bd/docs/testing.md#L8-L32) | Adopt a finite small local critical sanity selection; keep targeted/full local runs explicit and the complete applicable PR suite mandatory. | Existing test runner, repository contributor/agent guidance; FR-201. | Membership/count budget cannot grow silently; actual default-command timing and complete PR reconciliation remain distinct. |
| [Rust job validation](https://github.com/rust-lang/rust/blob/8144389c895da997dbdecaa635e41d6a50be6ffd/src/ci/citool/src/jobs.rs#L98-L164); [VS Code smoke assignment](https://github.com/microsoft/vscode/blob/dd545faabb05739fd2f331619f467a1fbb81f727/test/smoke/src/shard.ts#L38-L92) | Adopt inventory-driven classification and complete disjoint assignment; unknown durations affect balancing, never inclusion. | Existing runner/inventory helpers and repository-only classification guidance; FR-200/202. | New tests enter required PR coverage; missing, duplicate, unknown and cyclic assignments fail admission. |
| [Node worker queues](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/tools/test.py#L151-L199); [VS Code resource ordering](https://github.com/microsoft/vscode/blob/dd545faabb05739fd2f331619f467a1fbb81f727/.github/workflows/pr.yml#L121-L128) | Adapt explicit parallel eligibility into a bounded ready-work pool with dependencies and shared-resource exclusion; do not copy a queue as if it were a dependency barrier. | Existing runner/worker and native producer contracts; FR-202/213. | Original timelines prove independent overlap, prerequisite ordering, resource ceilings, released-capacity reuse and cancellation; full assertion identity is preserved. |
| [VS Code platform/capability jobs](https://github.com/microsoft/vscode/blob/dd545faabb05739fd2f331619f467a1fbb81f727/.github/workflows/pr.yml#L180-L251); [Node suite distinctions](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/test/README.md#L14-L47) | Adopt required capable PR runners for native and specialized tests unavailable locally, including reproducible authentic verification fixtures and the independent calculator suite. | Existing native CI/collector/toolchain setup; FR-203/208. | Each applicable assertion has an actual result; unavailable required inputs, unexpected skips and missing producers prevent completeness. |
| [CLI isolated tests](https://github.com/cli/cli/blob/ed40e856ffecd31286733876c613a2d3745e12bd/docs/testing.md#L60-L94); [CLI live acceptance boundary](https://github.com/cli/cli/blob/ed40e856ffecd31286733876c613a2d3745e12bd/acceptance/README.md#L7-L29) | Adopt isolated homes/configuration and safe fixtures; keep actual publication, provider administration and postpublication consumers separately authorized. | Existing test fixtures, unprivileged PR jobs and protected release flow; FR-204/206/208. | Ordinary PR execution has no publication/admin credentials or live-home mutations; fixture success cannot impersonate real public acceptance. |
| [Node public navigation](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/README.md#L37-L111); [CLI contributor navigation](https://github.com/cli/cli/blob/ed40e856ffecd31286733876c613a2d3745e12bd/docs/README.md#L11-L27) | Adopt progressive disclosure, release-coherent examples and usable source/package/installed links; keep internal recovery and proposal status off the newcomer path. | README, reader docs, packaging/install documentation selection; FR-209/210. | Exact-revision links and distribution-layout navigation pass; a safe first-use walkthrough states observed compatibility and actual monitoring prerequisites. |
| [Kubernetes reproducible bug intake](https://github.com/kubernetes/kubernetes/blob/c3b1e97124b974a50411c6527d1c03199287b511/.github/ISSUE_TEMPLATE/bug-report.yaml#L5-L27); [Node private security route](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/SECURITY.md#L3-L23) | Adopt concise bug/support/security routes with sanitized reproductions and an actually usable private destination, without corporate response promises. | Existing contribution/support/security documents and issue entry points; FR-210/215. | A newcomer can choose the right route; the private route is verified, not merely described by a file or badge. |
| [Node ownership distinction](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/.github/CODEOWNERS#L1-L9); [Node independent review guidance](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/doc/contributing/collaborator-guide.md#L155-L170) | Adapt ownership/review expectations to a solo maintainer; require CI for every author and report actual provider enforcement separately. | Existing ownership/contribution docs and separately authorized GitHub controls; FR-205/210. | External-contribution and owner-PR rules are explicit; authorized negative probes demonstrate effective required checks rather than infer them from CODEOWNERS. |
| [Node release artifact checks](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/doc/contributing/releases.md#L420-L439); [CLI archive contents](https://github.com/cli/cli/blob/ed40e856ffecd31286733876c613a2d3745e12bd/.goreleaser.yml#L18-L86) | Adopt exact source/version/artifact identity, user/legal documentation and pre/postpublication separation; reuse this framework's evidence mechanism. | Existing packaging, release, consumer and evidence interfaces; FR-206/207/208/213. | Frozen bytes and actual authorized channel/consumer outcomes reconcile; unchanged published 0.4.0 content remains immutable. |
| Larger-project infrastructure and selective coverage | Do not adopt Rust's reduced ordinary-PR suite, VS Code's change-based omissions, Kubernetes' privileged containers/Prow, foundation committees, borrowed security addresses, CLA changes or new signing services. These conflict with full applicable PR coverage or are unnecessary for this project's size and trust model. | No new infrastructure or framework-consumer policy; FR-203/204/215. | Review verifies the selected practices preserve offline user authority, personal MIT identity, minimal runtime and consumer policy choice. |

The separate published-baseline walkthrough inspected
[`749636e76ff4b5712857b82b7a85406d42eaee5c`](https://github.com/urmich/ai-sdlc-framework/commit/749636e76ff4b5712857b82b7a85406d42eaee5c),
not the unpublished candidate. It found stale version examples, one broken
design fragment, a stale source stamp, distribution-navigation gaps, internal
status clutter and missing public contribution/support entry points. Read-only
provider observations also found branch protection off and private vulnerability
reporting disabled. These are starting discrepancies, not completed fixes;
source changes alone cannot establish published readiness. In particular,
runner capability cannot invent a confidential reporting destination or grant
permission to enable one.
After this observation, the owner specifically approved enabling private
vulnerability reporting. The setting was enabled on 2026-10-20 and an API
readback confirmed `enabled: true`. No vulnerability report was submitted and
no other repository setting changed; the complete public-route walkthrough
remains separate acceptance evidence.

## Constraints and approval boundaries

- Preserve the installed 0.4.0 framework and existing published releases.
- No local npm registry request or alternate-host/proxy/policy workaround for the
  corporate registry block. Authorized GitHub-hosted jobs execute in their own
  environments; tests never weaken controls.
- Requirements discovery authorizes neither implementation nor remote settings,
  push/PR/merge, release publication, npm trust changes or deployment.
- The requested comparative research permits read-only public GitHub source
  inspection of the reference projects and this repository's published baseline.
  It does not grant provider-setting, status, queue, publication or live-runtime
  mutation authority.
- Retain the existing dependency-free shipped runtime unless separately approved.
  Test/build-only tooling requires its own justification and locked dependencies.
- Repository test classification, critical membership, execution groups and
  contributor/agent policy are development configuration for this repository,
  not a new generic framework policy or an implicitly installed consumer rule.
  Keep the reusable evidence API and consumers' choice of validation policy intact.
- New Linux installer support, unrelated product features and WinGet community
  submission are not implied by complete Linux developer testing. The reusable
  framework evidence/readiness capability and its adoption/acceptance in this
  repository are explicitly in scope under FR-213.
- This document is the canonical requirement artifact for `wi-public-readiness`.
  Existing registered specifications must be migrated with explicit path mapping,
  not deleted or reinterpreted as newly approved work.
- The no-extra-files rule concerns coverage generation in consuming projects:
  no generated coverage/index/binding/policy sidecars are added to their source
  trees. Framework implementation code, user-authored specifications/tests and
  ordinary retained test-execution reports remain distinct from the coverage
  declaration stored in PR metadata.

## Confirmed policy choices

- **Local versus hosted validation:** a small explicit critical sanity gate is
  the default local run; targeted/affected execution is an explicit additional
  development choice, and full local execution is optional. PR runs the complete
  applicable suite, including critical tests, on required appropriate runners.
  Classification and instructions are repository-only, not framework defaults.
- **Priority and timing:** criticality first, timing second. The 30-second local
  fast loop, 2-minute typical affected loop and 15-minute hosted PR critical path
  are general optimization guidance, not hard correctness gates. Retain critical
  cases even when they exceed those goals; record actual comparable measurements.
- **Release entry:** one explicit maintainer-authorized start, followed by the
  complete automated approved sequence.
- **Review policy:** solo maintainer, with maintainer review for external
  contributions and no additional human approval for owner PRs. CI remains
  mandatory for everyone. Actual repository-setting changes require separate
  scoped authority.
- **Native coverage:** retain the published Intel Mac distribution and require
  actual native Intel PR/release testing, alongside native Windows x64 and Apple
  Silicon macOS. Linux remains a required shared-code/tooling validation host,
  not a new standalone distribution.
- **macOS packaging:** future releases use one architecture-neutral macOS archive
  for Apple Silicon and Intel, not a Universal 2 binary or bundled Node runtime.
  The same artifact is tested natively on both architectures; Windows remains
  separate and published 0.4.0 assets remain unchanged.
- **Execution evidence:** a specification or green job is not sufficient proof.
  Prepublication readiness requires current passing evidence for every required
  case/platform; release completion additionally requires real passing
  postpublication acceptance, with durable retrievable evidence. This is a
  general framework capability for consumer SDLCs; this repository uses that same
  capability for its own development rather than maintaining a special-case
  implementation.
- **Coverage location and scope:** retain the user-authored Markdown
  specifications/tests and put the generated coverage section in the PR
  description, not an additional repository file. Ship native framework
  instructions/helpers to create it and identify uncovered areas. The required
  `framework/coverage` guardrail belongs to this repository's CI/CD only;
  consumers choose any enforcement themselves. Ordinary Actions reports still
  show actual test outcomes. No pipeline LLM, new signing system or special
  sandbox is implied.

The policy choices above are confirmed requirement inputs, not permission to
apply provider settings, publish a release or advance the lifecycle without the
corresponding user decision.

## Sources

- User revision of 2026-10-20: explain outstanding testing issues one at a time;
  route non-local code tests to required dedicated PR runners; keep the local
  critical set limited to sanity/system-working checks; provide repository-only
  future test-classification instructions; maximize safe parallel execution
  through independent groups/pools while preserving sequential dependencies;
  assess professional public-repository readiness honestly.
- User clarification of 2026-10-20: put tests that cannot run locally on required
  appropriate PR runners; examine at least five renowned professional GitHub
  repositories and implement their strongest applicable practices while keeping
  this repository unique. Parallelize independent work rather than serializing
  the investigation or implementation unnecessarily.
- Primary-source professional comparison, inspected 2026-10-20 (five established
  examples, not an objective ranking or a claim that every practice is suitable):
  [Node.js test classifications and worker execution](https://github.com/nodejs/node/blob/531d28fc360bd40b427561b1f85fd18743138626/test/README.md),
  [GitHub CLI ordinary versus live acceptance testing](https://github.com/cli/cli/blob/ed40e856ffecd31286733876c613a2d3745e12bd/docs/testing.md),
  [VS Code coverage-preserving smoke partitioning](https://github.com/microsoft/vscode/blob/dd545faabb05739fd2f331619f467a1fbb81f727/test/smoke/src/shard.ts),
  [Rust typed CI job classification and validation](https://github.com/rust-lang/rust/blob/8144389c895da997dbdecaa635e41d6a50be6ffd/src/ci/citool/src/jobs.rs),
  and [Kubernetes explicit quick-verification selection](https://github.com/kubernetes/kubernetes/blob/c3b1e97124b974a50411c6527d1c03199287b511/hack/make-rules/verify.sh).
  Detailed evidence and applicability decisions are inputs to the revised Test
  Plan and implementation under the user's subsequent explicit direction;
  research alone is not passing execution or public-readiness evidence.
- User request of 2026-10-15: test speed/parallelism, local-versus-GitHub split,
  exhaustive PR guardrails, non-Windows utilities, automated reliable release,
  and professional topic-based documentation with per-feature SDLC artifacts.
- User clarification: timing numbers are general guidance; local sanity and
  critical tests take priority over speed. Confirmed fast-local/complete-PR,
  one maintainer release start, solo-maintainer review, and retained Intel
  support with mandatory native tests.
- User revision of 2026-10-15: add one shared macOS artifact for Apple Silicon
  and Intel to the requirements, retaining native tests on both architectures
  and leaving the Windows distribution and existing 0.4.0 release unchanged.
- User addition of 2026-10-15: explicitly establish test-execution evidence and
  determine whether recorded passing results actually gate release readiness;
  distinguish specifications from proof of execution.
- User clarification of 2026-10-15: execution evidence must be part of the
  framework for other SDLCs generally, with framework development itself as one
  consuming case. Self-use, independent-consumer proof and compatibility belong
  to acceptance of the general evidence capability, not a separate feature.
- User clarification of 2026-10-15: use the simplest well-defined coverage
  format and make its creation part of the framework's shipped
  skills/instructions/programs. CI has no LLM; ordinary test reporting and
  machine-checkable coverage are distinct from reviewing test adequacy.
- User revision of 2026-10-18 supersedes the proposed tracked coverage index:
  do not create additional coverage files; keep coverage in PR metadata and
  provide framework-native authoring/gap-detection/publication guidance.
  The PR description was selected as the location. The mandatory failure
  guardrail is explicitly this repository's CI/CD policy only, not enforcement
  imposed on all framework consumers.
- Existing `docs/test-performance/` requirements/design and current
  `docs/requirements.md`, `docs/test-plan.md`, `docs/technical-design.md`.
- Source/workflow files and provider observations named in the starting-point
  table; retained 0.4.0 case reports and actual release/acceptance executions.
- [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners):
  native Intel and Apple Silicon macOS labels and standard public-runner terms.
