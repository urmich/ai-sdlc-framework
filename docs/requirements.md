# AI SDLC Framework - Requirements

| Field | Value |
| --- | --- |
| Revision history | Git commits and commit messages |
| Status | Approved baseline; user-directed additions maintained during Technical Design |
| Created | 2026-09-07 |
| Current phase | Technical Design |
| Target agent environment | GitHub Copilot CLI |
| Requirements approval | Granted by the user on 2026-09-07 |
| Advancement to Test Design | Authorized by the user on 2026-09-07 |

## 1. Purpose and reading guide

The framework will guide an AI agent through a mandatory, user-governed software
development lifecycle. Its purpose is to reduce deviations from the user's
request by connecting each requirement and its Definition of Done (DoD) to Test
Design, Technical Design, implementation, testing, and candidate review.

The framework is a helper mechanism, intended to make the user's work more
effective and productive. It is not the ultimate authority on how an SDLC must be
managed: the user can explicitly override any of its guardrails under FR-006,
and framework hooks remain advisory under FR-045.

This document specifies the required behavior of the framework. It does not
select its implementation technology or authorize implementation.

Section 6 contains the framework's mandatory requirements, including all accepted
recommendations. They are integrated by concern, not maintained as a separate
supporting list. Implementation choices belong in Technical Design, not in a
list of requirements-approval blockers.

Acceptance of individual requirements does not by itself approve the complete
requirements baseline or authorize advancement to the next phase.

Each requirement has its own DoD: the explicit, unambiguous desired outcome that
defines its fulfillment. The acceptance criteria listed under that requirement
make this outcome observable and testable; they are not a project-wide completion
checklist or an executable Test Plan. The framework's own Test Design must wait
for the user's approval to leave this requirements phase.

## 2. Goals

The framework must enable the agent to:

1. Understand the request and each requirement's desired outcome before progressing.
2. Design tests that cover all requirements before designing the solution.
3. Design a solution that satisfies the requirements before coding.
4. Implement and test iteratively until working artifacts fulfill each requirement's DoD.
5. Review each locally validated delivery candidate before remote publication or DEV execution.
6. Keep requirements, tests, and design aligned as knowledge develops.
7. Obtain user approval for every forward phase transition and confirmation at user-controlled stage boundaries.
8. Preserve the work, including its documents, on a feature branch or in a worktree.

These goals describe development work managed by the framework.

## 3. Scope

### 3.1 Confirmed scope

- A framework used by GitHub Copilot CLI for software development requests.
- Activation whenever the user asks for something to be developed.
- Installation into GitHub Copilot CLI, so the framework applies across
  repositories instead of being copied into each one.
- Agent-facing instructions and skills for carrying out the lifecycle.
- Four artifact-producing phases: Requirements, Test Design, Technical Design,
  and Coding, followed within each delivery cycle by a mandatory, repeatable
  candidate Review stage.
- Requirements input from any person, system, or artifact, including but not
  limited to product specifications, user descriptions, and monitor- or
  customer-originated incident records.
- Analysis of multiple user stories, problems, and/or requirements within the same
  requirements context.
- Clarification of each requirement and its explicit desired outcome (DoD);
  vague requirements are not accepted.
- Reporting discovered out-of-scope problems to the user, and keeping
  out-of-scope work out of the requirements, Test Plan, and Technical Design.
- Requirements and Technical Design documents, plus one living test document
  that evolves from Test Design into the Test Plan.
- Requirement coverage by planned tests and planned-test coverage by implemented
  automated tests, agent-driven semi-automated flows, or manual procedures.
- Iterative coding, testing, fixing, and document maintenance.
- Unit, integration, emulator-backed, and cloud-hosted development-environment
  testing, including build and development deployment pipelines when needed.
- Automatic local revalidation after each fix, followed by a separate,
  candidate Review stage and then a user-authorized DEV
  artifact/build/deploy/test step before Staging.
- Candidate-bound review after successful local validation and before the
  candidate is pushed, published through a PR, or sent to DEV. A changed
  candidate invalidates the prior review and repeats local validation and Review.
- Verified CI/CD provider build/deployment run links, explicit user notifications, and
  completion monitoring every 60 seconds.
- Explicit user completion confirmation or override before stage advancement
  or recommending the next stage; jobs inside an authorized DEV attempt run
  without separate per-job confirmation.
- User-confirmed DEV completion after local validation before recommending
  Staging, with separate confirmation before its build/deployment workflow.
- Policy-assigned Staging testing from authorized locations and explicit
  completion confirmation
  of its outcome before the normal PROD pipeline recommendation.
- Monitoring of every framework-triggered or user-reported pipeline run,
  including runs outside the current DEV/STAGING workflow.
- A local verification restart from unit tests after every implementation, test,
  or configuration fix, regardless of where the preceding test failed. Remote
  DEV/STAGING validation does not restart automatically.
- Semi-automated, instruction-driven tests executed by the agent outside routine
  build/PR runs, including live remote DEV flows from the user's development machine.
- Manual test execution by the user only when neither automated nor
  semi-automated execution is possible.
- Mandatory development inside a Git repository, on a feature branch or in a
  worktree, with documents, code, and tests committed. A local-only repository
  is acceptable; pushing to a remote is the user's decision.
- User-authorized PR creation/reuse, including when a deployment prerequisite
  requires a PR, without turning PR handling into a lifecycle phase. Normal
  implementation publication follows current candidate Review; explicitly
  authorized early document/draft PRs remain possible but do not count as review.
- Current-revision PR validation before restricted-environment readiness:
  mandatory for PROD and policy-dependent for DEV/STAGING.
- User-only authorization to advance between phases.
- Explicit user override of any framework guardrail.
- Soft framework guardrails that advise and preserve truthful lifecycle state
  without blocking an explicit user-requested tool action.
- Persistent, thin lifecycle state, with documented artifacts and decisions
  retained outside that state and retrieved only when needed.
- Active recovery and resumption of existing work using the checkpoint and
  relevant documents, Git history, and execution evidence.
- Git-based change history with meaningful commit messages that preserve change
  rationale, instead of separate logs that duplicate document or code history.
- Stable traceability, meaningful acceptance coverage, explicit test status, and
  repeatable testing with accurate execution evidence.
- Supported installation, hooks, shell classification, paths, filesystem
  operations, Git workflows, and repository command adapters on macOS and
  Windows through both PowerShell and Command Prompt.
- Repository-specific configuration within the framework's mandatory workflow,
  operational permissions, and information-protection requirements.
- Compact, understandable progress reporting and explicit blockers.

### 3.2 Outside the currently agreed lifecycle

The following have not been established as additional mandatory phases or
authorized actions:

- Automatic PR merging and production release.
- Production deployment or autonomous production incident mitigation.
- Post-production operations and monitoring as a separate lifecycle phase.
- A separate independent QA phase after coding.

An incident record is a requirements input; its presence does not authorize changes
to production infrastructure. Recommending the PROD pipeline under FR-038 is
in scope; automatically executing it is not. DEV and Staging deployment
activities do not add another mandatory lifecycle phase.
PR creation/reuse is in scope under FR-039. PR creation, validation success,
required reviews, merging, artifact production, and deployment authorization
remain separate facts and permissions.

### 3.3 Implementation choices deferred to Technical Design

Hooks, a workflow engine, custom agent roles, an MCP service, plugins, artifact
schemas, storage technology, and exact skill names remain design choices.
Technical Design determines how the mandatory lifecycle and approval rules are
implemented; those rules are not optional.

Repository boundaries and any necessary cross-repository coordination are also
addressed in Technical Design, after requirements are locked and Test Design is
complete. Repository count is not a condition for analyzing or locking
requirements.

The previously discussed reference documents demonstrate useful documentation
and testing practices. Their service-specific code, technologies, paths, and
operational policies are not automatically requirements of this framework.

## 4. Terminology

| Term | Meaning in this document |
| --- | --- |
| User | The person providing the development request, granting phase-transition approvals, and performing required manual tests. |
| Request / ASK | The problem to solve or outcome to deliver, as understood after requirements analysis. |
| Development request | A user request to create, change, fix, extend, or otherwise produce software or software artifacts. It triggers the framework. |
| Out-of-scope work | Work that is not part of the agreed requirements for the current request. |
| Guardrail | A rule the framework imposes on its own behavior, such as a mandatory phase, an approval gate, a documentation rule, a testing rule, or a workflow rule. |
| Override | An explicit user instruction to set a guardrail aside for identified work. |
| Requirements source | Any person, system, or artifact providing input to requirements analysis. It may supply problem reports, user stories, stated requirements, or supporting context; it need not provide a complete specification. |
| Requirements context | Information considered together when defining a development request, which may contain multiple user stories, problems, and/or requirements. |
| Requirement | An explicit, unambiguous statement of necessary behavior, an outcome, or a constraint, with its own DoD. |
| Acceptance criterion | An observable condition that makes an individual requirement's DoD precise and testable. |
| Definition of Done | The explicitly stated, unambiguous desired outcome of an individual requirement: what must be true for that requirement to be fulfilled. It is not a generic project-completion checklist. |
| Test Design / Test Plan | One living test document at different stages of maturity. It starts as Test Design in phase 2, defining scenarios and expected outcomes, and evolves into the Test Plan as Technical Design, Coding, and test execution add detail. These are not separate documents. |
| Technical Design | The documented solution approach and its relevant components, contracts, behavior, and operational considerations. |
| Approved baseline (informally "locked") | The document revisions the user approved for a phase transition. "Locked" identifies that approval point; it does not mean frozen content, because documents remain maintainable under FR-004. |
| Phase transition | Advancing execution from Requirements to Test Design, Test Design to Technical Design, or Technical Design to Coding. Review is a repeatable candidate stage, not a one-way document phase. |
| Document maintenance | Updating a document, including one from an earlier phase, without necessarily changing the current execution phase. |
| Lifecycle state | A compact, persistent operational checkpoint containing current workflow metadata and necessary references, not copies of documented artifacts, decisions, or history. |
| Recovery | Active reconstruction and reconciliation of workflow state so the agent can resume the next authorized action or identify a blocker. Merely retaining or reopening documentation is not recovery. |
| Agent context | Information currently loaded for the AI agent to perform its task. It is distinct from the full requirements context and durable project records. |
| Working artifact | A deliverable produced by implementation, such as a package, executable, image, deployment artifact, or related set of artifacts. |
| Worktree | A separate local checkout of a Git repository. Changes made there are committed and pushed through a branch; the worktree itself is not a remote push destination. |
| Planned test | A documented validation scenario. Its presence alone does not mean it has been implemented or executed. |
| Test status | The current-cycle execution result shown for each test in the Test Plan: `NotRun`, `Passed`, or `Failed`. Implementation readiness and execution blockers are recorded separately. |
| Automated test | A test whose execution and outcome evaluation are implemented in a test runner or script. It can run locally or in a pipeline, including when launched by an agent; it need not run on every build. |
| Semi-automated test | An instruction-driven flow that the agent starts, orchestrates, and evaluates outside routine build/PR execution. It requires no user launch or manual scenario steps and may need the user's development machine and live remote DEV access unavailable in a PR pipeline. |
| Manual test | A documented test that the user must execute because neither runner-driven automation nor an agent-driven semi-automated flow is possible. |
| Test execution owner | The agent, user, or external system responsible for running a test from an authorized location. This is separate from execution mode: a user may run an automated suite, and an agent may run tests when environment policy and available tools permit it. |
| Validation cycle | Verification of a delivery candidate: automatic unit-first local testing, candidate Review, and separately authorized DEV and Staging steps when required. A fix restarts local testing and invalidates the prior Review; prior remote results remain historical, not current proof. |
| Candidate Review | A mandatory, repeatable review of the current locally validated candidate using GitHub Copilot CLI's built-in `/review` command. Its result is bound to the candidate and is not the same as provider-hosted PR approval. |
| Stage completion confirmation | An explicit user confirmation that a lifecycle phase or environment-validation stage is complete for the current work/cycle. A pipeline's terminal result is not this confirmation. |
| DEV | The configured remote development environment whose artifact/build/deploy/test workflow is a user-authorized step after local testing and before Staging. |
| STAGING / Staging | A pre-production environment whose access, execution location, test owner, and automation policy are defined by the selected environment contract. Its build/deployment workflow requires user confirmation. |
| PROD recommendation | Advice to run the configured production deployment pipeline after user-confirmed Staging test success, not authorization to trigger it automatically. |
| Verified pipeline run link | A provider-supplied web link checked against the actual run identity and accessible run page through an authorized access path, not an invented URL or a login-page response. |
| Pull request (PR) | A provider-hosted request to integrate an identified source branch into a target branch. Creating it is not permission to merge or deploy it. |
| PR validation | Required checks/builds associated with the current PR revision and applicable target context. A passing unrelated branch build does not satisfy this requirement. |

## 5. Stakeholder input references

The following references summarize stakeholder statements from the design
conversation. They identify the origin of confirmed requirements without
reproducing internal reference documents.
Later clarifications may refine earlier statements; section 6 defines the
current required behavior.

**Framework requirements are mandatory behavior, not preferences.** They are
formalized in section 6. All sources below concern framework behavior.

| Source | Date | Stakeholder direction |
| --- | --- | --- |
| S-01 | 2026-09-06 | Define an AI-oriented SDLC framework, including skills and instructions, for GitHub Copilot CLI to use for development requests. |
| S-02 | 2026-09-06 | Requirements gathering and analysis are mandatory; nothing progresses without understanding the ASK and DoD. |
| S-03 | 2026-09-06 | Inputs include product specifications, detailed user descriptions, and monitor- or customer-originated incident records; one incident may contain multiple problems. Analyze and clarify until requirements can be locked. |
| S-04 | 2026-09-06 | Test Design is mandatory; cover every requirement with at least one test, document it in a potentially user-selected location, evolve it into a Test Plan, and eventually implement every planned test. Extend coverage whenever new test needs arise. |
| S-05 | 2026-09-06 | Technical Design follows locked requirements and completed Test Design. Design the solution without coding, comply with requirements, and enhance Test Design as needed. |
| S-06 | 2026-09-06 | Coding follows locked Technical Design. Requirements, Test Plan, and Technical Design are ground truth. Automate tests unless impossible; manual tests are executed by the user. Iterate through local and cloud-hosted development testing, builds, deployments, and fixes to working artifacts. |
| S-07 | 2026-09-06 | Documents should also be pushed to the feature branch. Only the user approves each forward phase transition. Earlier documents can be updated automatically unless the framework decides to request permission. |
| S-11 | 2026-09-07 | The framework must preserve development work, including its documents, on a feature branch or in a worktree. |
| S-12 | 2026-09-07 | The framework must analyze multiple user stories, problems, and/or requirements within the same requirements context, regardless of requirements source. |
| S-13 | 2026-09-07 | Test Design and Test Plan are the same document; the Test Plan evolves from the initial Test Design. |
| S-14 | 2026-09-07 | PMs, users, incident-management tickets, and other people, systems, or artifacts are requirements sources. Any source may report problems or supply other requirements context; the examples are not an exhaustive list. |
| S-15 | 2026-09-07 | Support semi-automated tests in Test Design/Test Plan: instruction-driven flows that the agent executes without user test steps, outside routine build/PR runs, including live remote DEV scenarios from the user's development machine that cannot run in a PR pipeline. |
| S-16 | 2026-09-07 | Persist lifecycle state independently of conversation memory, but keep it thin: remove already locked or documented artifact and decision content from that state so it does not inflate the agent's context. |
| S-17 | 2026-09-07 | Rely on Git history and commit messages for change history instead of maintaining an additional log that can outgrow the content it describes. |
| S-18 | 2026-09-07 | The framework must create meaningful commit messages with sufficient context for understanding changes through Git history. |
| S-19 | 2026-09-07 | The framework must actively recover and resume work, not merely retain documentation. Recovery may read the documents, Git history, and other relevant records to restore the working context. |
| S-20 | 2026-09-07 | Accept all remaining supporting recommendations and integrate them into the main framework requirements rather than maintaining a separate list. |
| S-21 | 2026-09-07 | Define DoD for each individual requirement as its explicit desired outcome. Do not accept vague requirements or substitute a project-wide completion checklist for requirement-specific outcomes. |
| S-22 | 2026-09-07 | Any document from a preceding phase, including multiple documents, may be updated in a later phase. Documents may be committed and pushed in their originating or later phases. Apply repository-specific configuration preferentially unless it contradicts the framework; explicitly ask the user to resolve conflicts. |
| S-23 | 2026-09-07 | A user request to develop something must trigger the framework. |
| S-24 | 2026-09-07 | The framework is installed into GitHub Copilot CLI rather than into a single repository, because a development task may span several repositories. |
| S-25 | 2026-09-07 | Developing anything requires a repository. A local repository is acceptable; the user decides whether and when to push to a remote. |
| S-26 | 2026-09-07 | Report discovered unrelated bugs to the user. Perform no out-of-scope work without a direct user request, and challenge such requests as out of scope. The user may override, but overridden work stays out of scope and is not documented in the requirements, Test Plan, or Technical Design unless the user explicitly declares it in scope. |
| S-27 | 2026-09-07 | Use Git commit messages for history as much as possible and read them for prior context. Other records may be kept locally but must be cleared when they become irrelevant or outdated. |
| S-28 | 2026-09-07 | The framework decides whether a previously created document should be updated. The user is not expected to instruct or approve it, though the agent may tell the user that an update will be made when there is reason to. |
| S-29 | 2026-09-07 | The user can always explicitly override any framework guardrail. The framework is a helper mechanism intended to make the user's work more effective and productive, not the ultimate truth about how an SDLC should be managed. |
| S-30 | 2026-09-08 | During Coding, automatically build a required artifact when no suitable PR/other build provides it, deploy to the configured DEV environment, and run the designed DEV tests. Notify the user of each build/deployment with a verified working CI/CD run link, state that it is being monitored, and check completion every minute. |
| S-31 | 2026-09-08 | After successful local and DEV testing, advise deployment/testing in Staging. If the user confirms, trigger the appropriate build and then deployment, notifying and monitoring as for DEV. After deployment, request user confirmation that STAGING tests ended successfully. |
| S-32 | 2026-09-08 | After user-confirmed successful Staging testing, suggest running the PROD deployment pipeline. |
| S-33 | 2026-09-08 | Staging is usually accessible only from dedicated machines, not the development machine. The user is responsible for running tests there. |
| S-34 | 2026-09-08 | Monitor every pipeline the framework triggers and every user-triggered pipeline the user reports. Identify user-triggered runs correctly and notify the user when each run completes. |
| S-35 | 2026-09-08 | The user may disregard or override any framework action or suggestion. Explicit user completion confirmation or override is needed before automatically advancing or suggesting the next stage. |
| S-36 | 2026-09-08 | Any fix after testing in any environment restarts the coding/deployment/testing loop from the beginning, with unit tests as the first testing step; do not assume what the fix can or cannot break. |
| S-37 | 2026-09-08 | Automatically maintain in-scope documents and notify the user of changes. Out-of-scope execution and/or documentation require explicit user instructions, which the framework must honor rather than initiating that work itself. |
| S-38 | 2026-09-08 | Under FR-015, each test in the Test Plan must visibly record its status as NotRun, Passed, or Failed; align the requirements, Test Plan, and Technical Design. |
| S-39 | 2026-09-08 | Revalidate every fix locally instead of automatically rebuilding and redeploying to DEV after every fix. DEV deployment/testing is a separate user-authorized step after local testing and before Staging, because its build and deployment pipelines take time. |
| S-40 | 2026-09-08 | Add user-authorized PR creation/reuse and PR prerequisites for restricted-environment readiness. PROD requires successful PR validation; other environments follow repository policy. Monitor required validation, keep merge/artifact/deployment permissions distinct, and reflect the behavior in all design views and tests. |
| S-41 | 2026-09-08 | Add a Review stage using GitHub Copilot CLI's built-in `/review` command. Review the locally validated candidate before its first remote publication or DEV execution; after a PR exists, any candidate-changing fix repeats unit-first local testing and `/review` before the next push. Do not repeat Review for an unchanged candidate, and keep framework Review distinct from provider PR reviews. |
| S-42 | 2026-09-08 | After the framework candidate passes Review, add CI/CD that checks and tests the source, creates a standard project/version-named installable package with integrity metadata, verifies isolated install/update/doctor/uninstall behavior, and retains the artifact without installing into the user's real Copilot home. |
| S-43 | 2026-09-09 | Replace the combined engineering guidance with dedicated, focused coding, testing, building, knowledge-retrieval, and review instructions. Incorporate proven technology-neutral concepts without copying technology-specific runtime, library, emulator, or infrastructure rules. |
| S-44 | 2026-09-09 | A Copilot session may start in a non-Git parent workspace and must be able to read documentation, clone or initialize the requested repository, bind it, and continue work without forcing the user to restart Copilot inside the child repository. |
| S-45 | 2026-09-09 | Make the framework work across macOS and Windows, including Windows PowerShell and Command Prompt. Cover installation, hooks, shell/token parsing, paths and filesystem semantics, process/Git behavior, build/test command adapters, diagnostics, and truthful host-specific validation. |
| S-46 | 2026-09-10 | The framework must never prevent the user from operating Copilot as requested. Framework stages—Requirements, Test Design, Technical Design, Coding, Review, and related lifecycle progression—may be emphasized at most once, then the user's override is honored. Other actions proceed as unmanaged through Copilot and the real local-machine, network, identity and access management, repository, and provider controls. Framework state remains truthful, and self-maintenance works outside Git. |
| S-47 | 2026-09-10 | An ordinary end-to-end development request, PR objective, urgency statement, or words such as “go” must start the normal framework flow, not be inferred as a request to skip it. The framework should try to guide the user through its stages once; only an unmistakable instruction to skip, bypass, reorder, or reject identified stages is an override. |
| S-48 | 2026-09-14 | A multi-repository work item must retain lifecycle artifacts independently per repository. Registering a Requirements, Test Plan, or Technical Design artifact in one member must not replace the same role in another member; all applicable artifacts must participate in status, checks, recovery, snapshots, and lifecycle assurance. |
| S-49 | 2026-09-16 | The OSS migration may intentionally discard the private framework's runtime compatibility. Provide an explicit purge command, executed from the new package before installation, that removes all old framework-owned files and runtime state while preserving unrelated Copilot content. |
| S-50 | 2026-09-16 | Every deployment-capable operation must resolve to exactly one canonical DEV, STAGING, or PROD environment before receiving managed lifecycle credit. Provider-specific labels require explicit scoped mappings; missing, unknown, conflicting, or ambiguous values remain visible and unmanaged rather than being ignored. |
| S-51 | 2026-09-16 | Pipeline monitoring and links must use a provider-neutral execution identity plus concrete provider adapters. Ship an Azure DevOps reference adapter, make additional adapters independently extensible, and document the exact adapter contract so agents never invent provider translations or verify a URL by accessibility alone. |
| S-52 | 2026-09-16 | Every focused lifecycle skill must use the same unmistakable-intent rule as the global framework instructions. Requests to implement, fix, test, publish, or act immediately activate the normal flow and do not by themselves skip Requirements, Test Design, or Technical Design. |
| S-53 | 2026-09-16 | Staging access is environment-specific. Dedicated secured machines and user-owned testing are supported policy choices, not universal framework assumptions. The selected environment contract determines location, owner, automation, and available agent execution. This supersedes S-33's universal wording. |

## 6. Framework requirements

The requirements below use **must** for confirmed stakeholder intent, including
accepted recommendations. Each requirement states the required behavior and has
its own **Definition of Done** listing the desired outcomes. Existing `AC-*`
identifiers identify the observable conditions that define that DoD and remain
stable for traceability. Later Test Design will map tests to these
requirement-specific outcomes.

Requirements are grouped by concern. Approved identifiers remain stable so Test
Design and later work can rely on them; new requirements receive new identifiers.

### 6.1 Activation, lifecycle, and user control

#### FR-001 - Activation on a development request

A user request to develop something must trigger the framework. The framework
must apply its lifecycle to that request without the user invoking it explicitly.

**Definition of Done**

- AC-001.1: A user request to create, change, fix, extend, or otherwise produce
  software or software artifacts starts the framework at the Requirements phase.
- AC-001.2: Activation does not depend on the user naming the framework, a phase,
  or a command, and does not require the user to restate the lifecycle rules.
- AC-001.3: A request that asks only for information, such as an explanation,
  analysis, search, or review with nothing to produce, does not start the
  lifecycle. If it later becomes a request to develop, the framework starts then.
- AC-001.4: When it is unclear whether a request is a development request, the
  framework asks the user instead of silently choosing.
- AC-001.5: Once triggered, development work proceeds through the framework
  rather than outside it.

**Source:** S-23.

#### FR-002 - Mandatory development lifecycle

The framework must direct development work through Requirements, Test Design,
Technical Design, and Coding, in that order, and then through a mandatory,
repeatable candidate Review stage before normal remote publication or DEV execution.

**Definition of Done**

- AC-002.1: A new development request begins with Requirements rather than
  implementation.
- AC-002.2: The workflow does not skip a mandatory phase.
- AC-002.3: Small requests may use concise documents and appropriately scoped
  execution, but retain all four artifact-producing phases, their user approval
  gates, and candidate Review.
- AC-002.4: Review is not a one-time terminal phase. A fix returns the candidate
  to Coding/local validation and requires Review again before further remote
  publication or DEV execution.

**Source:** S-01, S-02, S-04, S-05, S-06, S-20, S-41.

#### FR-003 - User-only phase advancement

Only the user may approve advancement from one phase to the next.

**Definition of Done**

- AC-003.1: Requirements -> Test Design requires user approval.
- AC-003.2: Test Design -> Technical Design requires user approval.
- AC-003.3: Technical Design -> Coding requires user approval.
- AC-003.4: Agent-assessed readiness, a document commit or push, and successful
  tool execution do not substitute for user approval.
- AC-003.5: Without approval, work remains in the current phase.
- AC-003.6: Approval records identify the user's decision, the authorized
  transition, and the document revisions to which it applies. They are kept
  outside the approved documents, under FR-029, so an approved document needs no
  in-document history table.
- AC-003.7: Subsequent agent-maintained document updates remain distinguishable
  from the user-approved baseline; they do not become user-approved merely
  because the agent edited the documents.
- AC-003.8: The agent cannot grant itself approval by editing an ordinary
  document's status.
- AC-003.9: Before advancing or recommending advancement across a lifecycle-phase
  or environment-validation boundary, the framework obtains explicit user
  completion confirmation or an applicable override. Silence, a dismissed
  suggestion, or pipeline completion is not consent.
- AC-003.10: One explicit user response may confirm completion and authorize
  advancement together. The DEV step requires authorization under FR-034;
  its individual build/deploy/test jobs do not require repeated confirmation.
- AC-003.11: After candidate Review, the user explicitly confirms Review
  completion or supplies an applicable override before the framework advances
  to remote publication or DEV execution. The same response may also authorize
  the push, PR publication, or DEV attempt.

**Source:** S-07, S-20, S-35, S-39, S-41.

#### FR-004 - Living documents across phases

For in-scope work, the framework must decide whether preceding-phase documents
need updating and make those updates without waiting for user instruction or
approval. It must notify the user what changed. Out-of-scope execution and
documentation instead follow FR-005.

**Definition of Done**

- AC-004.1: Any document created in a preceding phase can be updated for in-scope
  work during a later phase without user approval. This includes requirements
  updates during Test Design and Technical Design updates during Coding.
- AC-004.2: Document maintenance alone does not constitute a phase transition or
  restart the approval sequence.
- AC-004.3: The framework itself determines that an update is needed. It does not
  wait for the user to request or approve routine maintenance.
- AC-004.4: After each logical batch of document maintenance, the framework
  briefly identifies the updated documents, what changed, and why. This is a
  notification, not an approval request.
- AC-004.5: Automatic document maintenance does not authorize the agent to advance
  to a new phase.
- AC-004.6: A single later-phase change can update multiple preceding-phase
  documents together to keep their contents consistent.
- AC-004.7: Automatic maintenance does not add unrelated or out-of-scope work
  to the documents or authorize its execution; FR-005 takes precedence for that
  work.

**Source:** S-07, S-22, S-28, S-37.

#### FR-005 - Out-of-scope discoveries and scope discipline

The framework must report out-of-scope problems and must not execute or add them
to the requirements, Test Plan, or Technical Design automatically. The user may
explicitly request execution, documentation, or both, and the framework must
comply. These permissions and the item's scope classification are distinct.

**Definition of Done**

- AC-005.1: A discovered problem outside the agreed requirements is reported to
  the user with enough detail to decide on it, and is not fixed silently.
- AC-005.2: The framework performs no out-of-scope work without a direct user
  request for it.
- AC-005.3: When the user requests out-of-scope work, the framework states that
  it is outside the current scope, and identifies its expected impact, before
  proceeding. The user may override, and the override is recorded in the commit
  message for the resulting change.
- AC-005.4: Permission to execute out-of-scope work alone does not authorize
  adding it to the requirements, Test Plan, or Technical Design or changing
  in-scope DoDs. Such documentation requires an explicit user instruction.
- AC-005.5: Out-of-scope work becomes in scope only when the user explicitly says
  so. It then follows the normal lifecycle, including requirements, DoD, and test
  coverage.
- AC-005.6: The absence of out-of-scope work from the documents is not a coverage
  gap. Unrequested out-of-scope items do not block completion of in-scope work.
- AC-005.7: A documentation-only request is honored without executing the item.
  An execution-only request does not silently add documentation. If the user
  requests both, both are performed within the granted authority.
- AC-005.8: Explicitly documented out-of-scope items retain that classification
  unless the user includes them in the current scope. In-scope document
  maintenance under FR-004 cannot make that decision on the user's behalf.
- AC-005.9: An authorized out-of-scope fix that changes the current delivery
  candidate still restarts its verification under FR-024; its out-of-scope
  classification is not a testing exemption.

**Source:** S-26, S-37, S-36.

#### FR-006 - Explicit user override of framework guardrails

The framework is a helper that exists to make the user's work more effective and
productive. It is not the final authority on how the lifecycle must be run. The
user must be able to explicitly override any framework guardrail, and the
framework must comply.

**Definition of Done**

- AC-006.1: An explicit user instruction can override any framework guardrail,
  including a mandatory phase, an approval gate, a documentation rule, a testing
  rule, or a workflow rule.
- AC-006.2: The framework complies and continues the work. It does not re-argue
  the point, repeat the request for confirmation, or quietly reinstate the
  guardrail later.
- AC-006.10: The user's explicit instruction is itself sufficient to direct the
  agent past a framework stage recommendation. The framework does not require a
  special override phrase, a completed decision transaction, or a successful
  state mutation before allowing that stage override.
- AC-006.11: Override/deviation recording is best-effort bookkeeping performed
  before or after the action when possible. Failure to record it may reduce
  lifecycle assurance, but does not convert the framework into an execution
  blocker.
- AC-006.3: Before proceeding, the framework briefly states what is being set
  aside and the expected consequence. It states this once and does not require
  further approval.
- AC-006.4: An override must be explicit. The framework never infers one from
  silence, ambiguity, or its own convenience, and never proposes one to avoid its
  own obligations.
- AC-006.5: An override applies to the work the user identified. It does not
  silently disable the guardrail for later work unless the user says it applies
  more broadly.
- AC-006.6: Overrides are recorded in the commit message for the affected change,
  so Git shows what was set aside and why.
- AC-006.7: An override changes what the framework does, not what it reports as
  true. Skipped or unexecuted tests are still reported as skipped or unexecuted,
  and work that was not done is not described as complete.
- AC-006.8: An override cannot grant authority the user does not hold. External
  permissions, credentials, and repository or organizational controls remain in
  force, and the framework reports when one of them blocks the requested action.
- AC-006.9: When a scoped testing-order override permits execution, the same
  deviation is honored while recording the truthful result. The framework does
  not reimpose the waived prerequisite at the evidence boundary or fabricate the
  skipped prerequisite as passed.

**Source:** S-29.

### 6.2 Requirements gathering and analysis

#### FR-007 - Requirements sources

The framework must accept and analyze requirements context from any person,
system, or artifact. Sources include, but are not limited to, product specifications,
user descriptions, and incident records originating from an automated monitor or
a customer. Any source may report problems or supply user stories, requirements,
or supporting context.

**Definition of Done**

- AC-007.1: Product specifications, user descriptions, and incident records can initiate
  requirements analysis; they are examples rather than an exhaustive list.
- AC-007.2: Both monitor-originated and customer-originated incident records are
  supported as requirements sources.
- AC-007.3: An input source is analyzed rather than treated as an already complete
  requirements agreement.
- AC-007.4: Content from other people, systems, or artifacts can enter the same
  analysis workflow without being restricted to the listed source types.
- AC-007.5: Content can be supplied by any available means, including text the
  user provides, files, and connected tools. A dedicated native integration with
  every external system is not required; specific integrations are a Technical
  Design choice.

**Source:** S-03, S-14.

#### FR-008 - Multiple items in a requirements context

The framework must identify and analyze multiple user stories, problems, and/or
requirements within the same requirements context. This requirement applies to
all requirements sources.

**Definition of Done**

- AC-008.1: Each identified user story, problem, or requirement is represented
  distinctly enough to understand its intended outcome and relationships.
- AC-008.2: A context containing several such items, including mixtures of them,
  is not silently reduced to a single item.
- AC-008.3: Unclear relationships or scope boundaries between these items are
  clarified before the requirements are locked.
- AC-008.4: The framework applies this mandatory analysis to every requirements
  context, regardless of source.

**Source:** S-03, S-12.

#### FR-009 - Assisted clarification

The framework must analyze the requirements context and help the user express
each requirement as an explicit desired outcome, asking clarification questions
until ambiguity about that outcome is resolved.

**Definition of Done**

- AC-009.1: Vague wording, missing outcomes, and conflicting interpretations are
  surfaced to the user rather than treated as accepted requirements.
- AC-009.2: User answers are incorporated into the requirements draft.
- AC-009.3: Analysis and clarification continue until each requirement's desired
  outcome is explicit and unambiguous. Unresolved outcome questions remain
  blockers rather than being hidden by assumptions.

**Source:** S-02, S-03, S-21.

#### FR-010 - Explicit requirement-specific definitions of done

The framework must produce a requirements document that captures the understood
request and explicitly defines the desired outcome (DoD) of every requirement
before advancing.

**Definition of Done**

- AC-010.1: Every requirement states its desired outcome, with observable
  conditions that make fulfillment assessable.
- AC-010.2: A requirement with an undefined or ambiguous desired outcome is not
  accepted or locked. A generic project checklist or a test plan does not
  substitute for a missing requirement-specific DoD.
- AC-010.3: The requirements remain a draft until the user approves progression
  to Test Design.
- AC-010.4: The requirements document and its per-requirement DoDs are available
  for user review at their canonical, version-controlled location.
- AC-010.5: For a new canonical document, the framework can register an exact
  planned repository locator before the file exists, create it under Requirements
  authority, and finalize its content digest afterward. Normal document creation
  does not require Coding authority or a phase override.

**Source:** S-02, S-03, S-07, S-21.

### 6.3 Test Design and Test Plan

#### FR-011 - Test Design before Technical Design

After requirements are understood and the user authorizes advancement, the
framework must design tests that validate each requirement's DoD.

**Definition of Done**

- AC-011.1: Test Design produces documented validation scenarios and expected
  outcomes tied to the requirements' DoDs.
- AC-011.2: Initial Test Design is completed before Technical Design starts.
- AC-011.3: Completion of Test Design does not itself authorize advancement;
  FR-003 still applies.

**Source:** S-04, S-05, S-07, S-21.

#### FR-012 - Meaningful, traceable requirement-to-test coverage

Every requirement must be covered by at least one planned test that validates
its DoD. Coverage must meaningfully address each independently testable outcome,
not merely satisfy a numeric test count.

**Definition of Done**

- AC-012.1: Each requirement has an identifiable corresponding planned test
  linked to its DoD.
- AC-012.2: An uncovered requirement or independently testable acceptance
  condition is reported as a coverage gap.
- AC-012.3: Initial Test Design is not complete while any requirement or
  independently testable acceptance condition lacks planned coverage.
- AC-012.4: Requirements and planned tests have stable identifiers, and their
  coverage links are maintained as documents evolve.
- AC-012.5: Planned assertions, agent-evaluated evidence, or user observations
  establish the expected behavior. A broad test does not count as coverage for
  conditions it does not actually validate.

**Source:** S-04, S-20, S-21.

#### FR-013 - Test documentation and location

Test Design must be formulated into a document. The framework must honor a
user-requested document location.

**Definition of Done**

- AC-013.1: Test scenarios are available in a document rather than only in
  transient conversation.
- AC-013.2: When the user specifies an accessible, permitted location, the
  framework uses that location.
- AC-013.3: An unavailable or inaccessible requested location is reported rather
  than silently replaced.
- AC-013.4: Planning a new canonical Test Plan or Technical Design locator before
  file creation permits only that phase-appropriate document path; it does not
  authorize arbitrary files, implementation, `.git`, `.sdlc`, or other protected
  metadata. Pending Test Plan locators remain orientable without reading a file
  that does not yet exist.

**Source:** S-04. Document-location defaults and external-storage integration
belong to Technical Design and repository configuration under FR-031.

#### FR-014 - One document evolves from Test Design into the Test Plan

The framework must maintain Test Design and Test Plan as the same living
document. It starts as Test Design in phase 2 and evolves into the Test Plan as
the solution and its implementation and testing become more concrete.

**Definition of Done**

- AC-014.1: Initial scenarios are retained and refined in the same document when
  implementation details become available.
- AC-014.2: The same document can be elaborated during Technical Design, Coding,
  and test execution.
- AC-014.3: The plan reflects newly understood test needs throughout the work.
- AC-014.4: Evolution into the Test Plan does not create a separate document
  alongside the Test Design.
- AC-014.5: The document supports automated, semi-automated, and manual tests and
  identifies the intended execution mode for each planned test.
- AC-014.6: The document identifies the required test levels, environments, and
  execution checkpoints for the request, based on its requirements and repository
  constraints.
- AC-014.7: For deployment work, the plan identifies the local, DEV, and
  Staging test checkpoints and the expected outcomes used for promotion
  and user confirmation.
- AC-014.8: The plan records test execution owner and authorized execution
  location separately from automated/semi-automated/manual mode. It identifies
  the unit-first local sequence to rerun after every fix, the separate
  user-authorized DEV step, and subsequent Staging and completion gates.
- AC-014.9: A validation cycle derives every in-scope required test and its
  execution definition from the canonical Test Plan. A caller cannot omit tests
  or redefine their environment, level, mode, owner, location, implementation,
  or expected outcome to make a partial suite appear complete.
- AC-014.11: Test-specification identity includes specification-bearing
  procedures, prerequisites, steps and assertions, while excluding only
  explicitly identified mutable execution status/evidence metadata.
- AC-014.10: Each planned test identifies one execution checkpoint:
  `pre-review`, `review`, `post-review`, `DEV`, or `STAGING`. Only the complete
  `pre-review` local set is a prerequisite for invoking `/review`; the Review
  checkpoint and later workflow observations cannot become circular prerequisites.

**Source:** S-04, S-05, S-06, S-13, S-15, S-30, S-31, S-33, S-35, S-36, S-39.

#### FR-015 - Test implementation, status, and execution traceability

Every test in the Test Plan must eventually be covered by at least one automated
test, agent-executable semi-automated flow, or manual test procedure.
The framework must distinguish planning, implementation, execution, and outcome
and retain traceable execution records for all three modes. The Test Plan must
show each test's current execution status as `NotRun`, `Passed`, or `Failed`.

**Definition of Done**

- AC-015.1: Each planned test remains traceable from its requirement IDs through
  its automated implementation, semi-automated flow, or manual procedure to
  execution results as those become available.
- AC-015.2: A scenario description without a runnable test, actionable agent flow,
  or executable manual procedure does not count as implemented.
- AC-015.3: Outstanding planned-test implementation gaps prevent the work from
  being considered complete.
- AC-015.4: Execution-mode selection and manual coverage follow FR-022.
- AC-015.5: A semi-automated flow can be implemented as instructions defining
  prerequisites, environment, actionable steps, expected outcomes, evidence to
  collect, and applicable cleanup. A standalone CI test executable is not required.
- AC-015.6: Every test in the Test Plan has a visible status using exactly
  `NotRun`, `Passed`, or `Failed`. These are execution results, not planning or
  implementation-readiness states.
- AC-015.7: Execution results identify the relevant code revision or build
  artifact, environment, and configuration. Detailed records remain outside
  thin lifecycle state and are retrieved through references.
- AC-015.8: Results and stage-completion confirmations are bound to a validation
  cycle and Test Plan revision. A fix makes preceding-cycle results historical;
  they cannot establish success in the new cycle, whose test statuses reset to
  `NotRun`. This records pending validation; it does not automatically authorize
  running remote tests or deployments.
- AC-015.9: The framework updates each test's status from its actual current-cycle
  result, including user-supplied results for user-owned tests. `Passed` means the
  expected outcome was met; `Failed` means execution established it was not met.
- AC-015.10: `NotRun` means no conclusive current-cycle result is available.
  Missing implementation, an unstarted/running test, a blocker, or an unverified
  outcome is identified separately so `NotRun` does not conceal actual activity.
  Those details never substitute for `Passed` or `Failed`.
- AC-015.11: Current environment status is derived from the current deployment
  attempt and the latest applicable result for each test. A later confirmed
  failure supersedes an earlier pass immediately; a superseded deployment cannot
  keep or overwrite the current Test Plan projection.
- AC-015.12: Status synchronization re-evaluates event revocation and expiry
  rather than relying only on a prior dirty flag. An expired STAGING result cannot
  leave the canonical Test Plan displaying a current pass.

**Source:** S-04, S-06, S-15, S-20, S-36, S-38, S-39.

#### FR-016 - Continuous test discovery

Whenever the agent identifies another necessary test, it must document the test
in the Test Plan and ensure that it is implemented.

**Definition of Done**

- AC-016.1: Newly identified scenarios are added during design, development,
  or execution, not left only in conversation.
- AC-016.2: Tests discovered before Coding are documented for subsequent
  implementation; their discovery does not bypass the Coding approval gate.
- AC-016.3: Tests discovered during Coding enter the implementation and testing
  loop.
- AC-016.4: Work is not declared complete while newly required tests remain
  unimplemented.

**Source:** S-04, S-05, S-06, S-07.

### 6.4 Technical Design

#### FR-017 - Technical Design entry conditions

Technical Design must begin only after requirements are locked, initial Test
Design is complete, and the user has approved advancement.

**Definition of Done**

- AC-017.1: The agent has the agreed requirements and completed Test Design
  available when starting the phase.
- AC-017.2: Missing requirements agreement, incomplete Test Design, or absent
  user approval prevents advancement.

**Source:** S-05, S-07.

#### FR-018 - Design the solution without coding

During Technical Design, the framework must design and document the solution,
not implement it.

**Definition of Done**

- AC-018.1: The phase produces a Technical Design document describing the
  proposed solution.
- AC-018.2: No implementation code is written in this phase, including production
  code, test code, or runnable prototypes.
- AC-018.3: The design can be reviewed against requirements and used as ground
  truth during subsequent Coding.

**Source:** S-05, S-06.

#### FR-019 - Requirement-compliant design and test impact

The Technical Design must comply with the requirements and extend, enhance,
or elaborate the Test Design where necessary.

**Definition of Done**

- AC-019.1: The proposed solution addresses the agreed requirements rather than
  replacing them with a different requested outcome.
- AC-019.2: Additional test needs identified through design are reflected in
  the Test Plan.
- AC-019.3: Necessary updates to earlier documents follow FR-004.

**Source:** S-05, S-07.

### 6.5 Coding and continuous testing

#### FR-020 - Coding entry conditions

Coding must begin only after the Technical Design is locked and the user approves
advancement to implementation.

**Definition of Done**

- AC-020.1: A completed but not user-approved Technical Design does not authorize
  Coding.
- AC-020.2: Coding begins against the agreed Technical Design and current
  requirements and Test Plan.
- AC-020.3: These entry conditions define the recommended managed lifecycle.
  If the user unmistakably instructs the agent to skip, bypass, reject, or
  reorder the Technical Design/Coding entry boundary, the agent warns once,
  performs the requested work subject to external permissions, and records or
  reports the unmanaged deviation without claiming the phase gate was
  satisfied. Ordinary implementation or urgency language is not such an
  instruction.

**Source:** S-06, S-07.

#### FR-021 - Ground-truth-driven implementation

The coding agent must use the requirements, Test Plan, and Technical Design as
ground truth to avoid deviations from the requested work.

**Definition of Done**

- AC-021.1: The three documents are available to the coding agent and used to
  guide its work.
- AC-021.2: Implementation addresses required behavior and follows the documented
  solution approach.
- AC-021.3: Necessary document changes discovered while coding are made through
  FR-004 rather than leaving the documents inconsistent with the solution.
- AC-021.4: Authoritative documents remain available through references and
  relevant content is retrieved on demand under FR-028. Thin state does not
  authorize ignoring applicable requirements, design constraints, or tests.
- AC-021.5: Relevant design decisions and discovered defects retain links to
  the affected requirements and tests as the solution evolves.

**Source:** S-06, S-07, S-16, S-20.

#### FR-022 - Automated, semi-automated, and manual testing

The framework must support runner-driven automated tests and agent-driven
semi-automated tests. A manual test may be used only when neither execution mode
is possible, and the user must execute it.

Semi-automated means that the agent drives an instruction-defined flow, not that
the user performs part of the scenario. Execution mode and cadence are distinct:
a runner-driven test does not become semi-automated merely because it is run
on demand or omitted from a PR pipeline.

**Definition of Done**

- AC-022.1: A planned test that can run through a test runner or an agent-driven
  flow has an automated implementation or semi-automated flow, not a manual
  designation.
- AC-022.2: A manual test identifies why neither automated nor semi-automated
  execution is possible and provides a procedure and expected outcome for the user.
- AC-022.3: An unexecuted required manual test remains pending; the agent does
  not claim it passed on the user's behalf.
- AC-022.4: Ease, convenience, or preference alone is not treated as inability
  to automate.
- AC-022.5: Once prerequisites and permissions are satisfied, the agent starts,
  drives, and evaluates a semi-automated scenario without requiring the user to
  click, launch the test, or perform scenario steps.
- AC-022.6: Required semi-automated tests run at Test Plan-defined checkpoints,
  not on every build or PR run. Inability to run a scenario in a PR pipeline does
  not make it manual or exempt it from required execution.
- AC-022.7: The agent records the semi-automated flow's actual outcome against
  its expected results. A passing build/PR or the existence of instructions does
  not count as execution of the flow.

User phase approvals and tool/access permissions still apply. They are
authorization prerequisites, not manual execution of the test scenario.
Execution owner is separate from automation mode. In STAGING, FR-037 assigns
execution according to the selected environment contract. User-owned execution
does not require converting an existing automated test suite into manual steps,
and agent/provider ownership does not make a manual test automated.

**Source:** S-06, S-15, S-53.

#### FR-023 - Support the required testing environments

The framework must support unit tests, integration tests, tests using
emulators, and tests that deploy a build artifact into a cloud-hosted development
environment and interact with cloud infrastructure. Execution mode is separate
from test level and environment.

**Definition of Done**

- AC-023.1: Testing is not limited to unit tests or source-code inspection.
- AC-023.2: Emulator-backed and integration tests can be part of the execution
  workflow.
- AC-023.3: The workflow can deploy a produced artifact to a cloud-hosted development
  infrastructure and run the required interactions against that deployment.
- AC-023.4: Testing can involve build and development deployment pipelines
  where they are needed.
- AC-023.5: The agent can execute an instruction-driven semi-automated flow from
  the user's development machine against live remote DEV infrastructure, including
  a scenario that cannot run in a PR build, without the user running the
  end-to-end scenario.
- AC-023.6: Tests define and apply necessary isolation and cleanup so repeated
  execution is not contaminated by state left by previous tests.
- AC-023.7: Evidence identifies relevant emulator or simulator limitations.
  Simulated results are not represented as proof of unsupported behavior against
  real cloud infrastructure.
- AC-023.8: DEV and Staging deployment/testing follow FR-034 through FR-037;
  successful deployment alone is not successful testing.

**Source:** S-06, S-15, S-20, S-30, S-31. The Test Plan selects required levels, modes, and
execution checkpoints under FR-014. Supporting a test level does not mean every
request must use it.

#### FR-024 - Iterative implementation and testing

Coding, testing, and Review must operate iteratively: implement, test, review,
diagnose, fix, and repeat, using build or development deployment pipelines when needed.
Any implementation, test, or configuration fix after testing in any environment
restarts local verification, beginning with unit tests, and invalidates the prior
candidate Review. DEV artifact preparation, deployment, and testing are a
separate step after local success and Review and require
user authorization under FR-034; they are not repeated automatically after each
fix. Selective local retesting based on presumed impact is not the default.

**Definition of Done**

- AC-024.1: A failed required test feeds back into diagnosis and fixing rather
  than being treated as successful completion.
- AC-024.2: After every fix, run the full required local unit suite first and then
  all remaining required local tests, including local integration/emulator tests
  specified by the Test Plan. Do not automatically trigger a DEV-specific build,
  deployment, or DEV test execution as part of this per-fix loop.
- AC-024.13: After those local tests pass, repeat candidate Review before the
  changed candidate can be pushed, published through a PR, or sent to DEV.
- AC-024.3: The loop supports both local execution and remote build/development
  deployment execution.
- AC-024.4: The work produces one or more working artifacts that fulfill every
  agreed requirement's DoD.
- AC-024.5: A failed required semi-automated flow enters the same diagnose, fix,
  and retest loop; a passing routine build does not close that failure.
- AC-024.6: Missing credentials, unavailable infrastructure, and failed tooling
  are reported accurately as blockers or failures, not successful validation.
- AC-024.7: Tests are not weakened, silently skipped, or relabeled as manual
  merely to claim completion.
- AC-024.8: Work is not declared complete while a required test is unexecuted,
  failed, or blocked.
- AC-024.9: Previous test passes and environment-completion confirmations do not
  carry into the new validation cycle. In-flight runs from the prior cycle remain
  monitored, but their results cannot advance the new cycle. Old DEV/STAGING results
  and the prior Review becoming historical do not automatically schedule
  replacement remote runs.
- AC-024.10: A STAGING-discovered fix returns to Coding and unit tests, not directly
  to another STAGING-only test attempt. After local revalidation, DEV verification
  again needs applicable user authorization before later STAGING promotion. Existing
  lifecycle design approvals need not restart merely because testing resets.
- AC-024.11: Only an explicit user override may reduce or skip the restart
  of required local testing. Waiting for DEV authorization is not an override
  or a skipped local test; unfinished remote validation remains visibly pending.
- AC-024.12: A test launched from the development machine against live remote DEV
  is DEV testing, not local testing. It follows the user-authorized DEV step;
  local emulators and mocks remain part of local validation.

**Source:** S-06, S-15, S-20, S-21, S-36, S-35, S-39, S-41.

### 6.6 Repository, branch, and worktree workflows

#### FR-025 - Development in a repository, on a feature branch or in a worktree

The framework must carry out development work inside a Git repository, on a
feature branch or in a worktree, and must preserve documents, code, and tests
there by committing them. A local-only repository is acceptable; pushing to a
remote is the user's decision. Documents may be committed during their
originating phase or during any later phase.

**Definition of Done**

- AC-025.1: Development work requires a Git repository. Where none exists,
  including for a new project, one is created at a location taken from the user's
  instruction or repository configuration before development proceeds.
- AC-025.2: Work is carried out on a feature branch or in a worktree from
  Requirements through Coding and candidate Review; the agent does not treat
  this as optional.
- AC-025.3: A document can be committed during the phase in which it was created.
- AC-025.4: A document from any preceding phase can be committed during a later
  phase, including alongside the current phase's work.
- AC-025.5: Documents, code, and tests are committed as the work progresses,
  rather than left uncommitted until Coding ends.
- AC-025.6: When a remote is configured and pushing is authorized, commits are
  pushed to the remote branch. A local-only repository remains valid, and the
  user decides whether and when to push.
- AC-025.8: Push authorization is evaluated against the actual parsed remote,
  push URL identity, source branch/revision, destination branch, and destructive
  force/delete behavior. Authorization for one destination cannot publish to
  another. The managed single-destination form rejects multiple resolved push URLs
  and non-branch destination namespaces.
- AC-025.7: A commit or push does not advance the phase.
- AC-025.9: Before a repository binding exists, a captured development request
  permits supported `git clone`, `git init`, branch-switch, and worktree setup
  commands from a non-Git workspace. Safe built-in and shell read/navigation
  operations remain available without repository identity.
- AC-025.10: After `sdlc init` or member binding identifies a child repository,
  a session whose outer workspace remains outside Git can resolve that explicit
  session-bound member for managed edits and lifecycle commands. Every mutation
  must still remain inside the bound member. A configured mutating shell command
  cannot inherit child-repository authority while executing in the outer
  workspace; its actual per-command cwd or explicit Git `-C` target must be the
  bound member.
- AC-025.11: If the session root is another Git repository, its identity is
  evaluated normally and it cannot fall back to or inherit authority from a
  previously bound repository.

**Source:** S-07, S-11, S-22, S-25, S-44.

#### FR-026 - Pushes support remote execution

During Coding, pushes from the selected feature-branch or worktree workflow must
be available to support remote build and development testing workflows.

**Definition of Done**

- AC-026.1: Code and test changes from either workflow can be committed and pushed
  to run a required build pipeline.
- AC-026.2: The framework supports further fixes and pushes after a failed
  pipeline.
- AC-026.3: The need to obtain a remote build or test result does not create a
  circular requirement that the result already exist before the triggering push.
- AC-026.4: If a required remote build, pipeline, or deployment result cannot be
  obtained because no remote is configured or pushing is not authorized, the
  framework reports a blocker under FR-024 instead of treating that validation as
  satisfied.

**Source:** S-06, S-07, S-11, S-25. Operational permissions and concrete targets
follow repository configuration and authorization under FR-031 and FR-032.

### 6.7 Agent-facing framework and installation

#### FR-027 - Installable instructions and skills for Copilot CLI

The framework must be installable into GitHub Copilot CLI and must supply the
instructions and skills the CLI uses to carry out the lifecycle, rather than only
descriptive process documentation.

**Definition of Done**

- AC-027.1: The delivered framework includes agent-facing instructions and
  skills usable by GitHub Copilot CLI.
- AC-027.2: Those instructions and skills direct the agent through the required
  phase activities and user approval boundaries using the relevant documents.
- AC-027.3: The framework is installed into Copilot CLI itself, so it applies to
  development work in any repository without being copied into each repository.
- AC-027.4: A single development request can cover work in more than one
  repository, subject to FR-025 and FR-031.
- AC-027.5: Installation and usage documentation lets a user install the
  framework into Copilot CLI and configure it for a repository without reading
  its source.

**Source:** S-01, S-24. Exact names, packaging, and execution mechanisms belong
in Technical Design.

### 6.8 Lifecycle state, recovery, and change history

#### FR-028 - Persist thin lifecycle state independently of conversation memory

The framework must persist enough lifecycle state to resume work independently
of conversation memory while keeping that state as thin as possible. Once
artifacts or decisions are documented or locked, their content must be removed
from lifecycle state rather than retained as duplicate context.

Canonical documents, decision records, approvals, and execution evidence remain
durable outside lifecycle state. State keeps only current operational metadata
and the lightweight references needed to locate those records.

**Definition of Done**

- AC-028.1: After interruption, context compaction, or session replacement, the
  framework performs recovery under FR-030 to restore the current phase, active
  work, approval/blocker references, and outstanding external-run handles without
  relying on the previous conversation or assuming phase advancement.
- AC-028.2: Once an artifact or decision is documented or locked, its full text
  and redundant summaries are cleared from lifecycle state. Only necessary
  identifiers, locations, revisions, and current workflow status remain.
- AC-028.3: Before clearing content from state, the framework confirms that its
  canonical record is durably stored and retrievable. Clearing state does not
  delete the documents, decisions, approval records, or evidence themselves.
- AC-028.4: State maintenance removes completed-work detail and obsolete
  references at workflow checkpoints. State does not accumulate a growing
  history of completed tasks, settled decisions, or tool outputs; those records
  remain outside the active checkpoint. Document and code change history is
  retrieved through Git under FR-029.
- AC-028.8: Superseded current-cycle evidence and audited inactive decisions are
  retired from the active working set once no current result, unresolved
  operation, or applicable authority depends on them. Archival preserves
  recovery/history without allowing repeated results to exhaust active capacity.
- AC-028.9: Pruning preserves any event still referenced by the current Review or
  another active dependency. A monotonic event-sequence high-water mark prevents
  sequence reuse after an older or highest-sequence event is archived.
- AC-028.10: Audit replay verifies complete history but materializes only
  currently applicable authority, structural phase/lifecycle events and active
  dependencies. Retired history does not refill the active working set.
- AC-028.5: Starting or resuming work loads the thin checkpoint, not all artifacts
  or historical records. The agent retrieves only the authoritative content
  relevant to the current work when needed, including applicable cross-cutting
  constraints.
- AC-028.6: Canonical document updates refresh the affected references. Missing
  or inconsistent references trigger recovery under FR-030; unresolved gaps are
  surfaced rather than replaced with guesses. Recovery-critical run handles and
  approval references are retained so compaction does not cause duplicate
  deployments or bypass an approval gate.
- AC-028.7: Documented size budgets bound lifecycle state and its default
  contribution to agent context. If necessary active state cannot fit, the
  framework reports the limit instead of silently dropping recovery-critical
  information. Budget values and measurement methods are specified in
  Technical Design.

**Source:** S-16, S-19.

#### FR-029 - Use Git as the source of change history

The framework must rely on Git commits, diffs, and commit messages for the change
history of version-controlled work. It must not maintain parallel document
revision tables, change-log documents, or lifecycle-state histories that
duplicate that information.

The framework must generate meaningful commit messages that explain the change's
intent and preserve sufficient context for a future reader or agent to understand
its rationale without access to the original conversation. Records that Git
cannot carry, such as an approval reference, are kept minimally outside the
affected documents and cleared once outdated.

**Definition of Done**

- AC-029.1: Each commit has a descriptive subject and explains what changed and
  why, using a body when needed. Generic messages such as "update" or "fix" alone
  do not provide sufficient context.
- AC-029.2: Documents retain their current content and status without an
  accumulating revision-history table or duplicate change log.
- AC-029.3: Lifecycle state retains only necessary current revision references,
  not a copied Git log. The agent retrieves relevant history on demand rather
  than loading the complete history into its context.
- AC-029.4: Current phase status, approval references, and necessary execution
  evidence remain available. A commit or push is not proof of user approval or
  successful test execution.
- AC-029.5: Where relevant, messages reference affected requirements or work items
  and record important decisions, trade-offs, behavior changes, and limitations.
  Context is proportionate to the change; messages do not duplicate whole
  documents, conversations, or raw logs.
- AC-029.6: The agent consults Git commits, diffs, and messages when it needs
  prior rationale, instead of reconstructing it or duplicating it elsewhere.
- AC-029.7: Records that Git cannot carry, including approval references under
  FR-003, are kept as minimal local records outside the documents they describe.
  They are removed once outdated or no longer relevant, consistent with FR-028.

**Source:** S-17, S-18, S-27.

#### FR-030 - Actively recover and resume the workflow

The framework must actively recover the workflow when resuming existing work
after interruption, context loss, or a missing or stale checkpoint. Recovery
must reconstruct a usable working context and determine the next authorized
action. The existence of saved documents alone does not satisfy this requirement.

**Definition of Done**

- AC-030.1: Resumption of existing work invokes recovery before taking actions
  that depend on its prior state; the framework does not require the user to
  manually reconstruct the previous conversation.
- AC-030.2: Recovery reads the thin checkpoint and, as needed, relevant
  requirements, Test Plan, Technical Design, decision and approval records, Git
  commits/diffs/messages, and build, deployment, or test evidence. It uses
  targeted retrieval rather than loading all documents or history by default.
- AC-030.3: Recovery establishes the current phase, applicable artifact
  revisions and decisions, completed and outstanding work, unresolved blockers,
  approval status, and the next permitted action.
- AC-030.4: If the checkpoint is missing or stale, the framework attempts to
  reconstruct it from authoritative records and actual repository/runtime state
  rather than blindly restarting the lifecycle or inventing progress.
- AC-030.5: Recovery reconciles completed and in-progress external operations
  before issuing new ones, preventing unintended duplicate deployments or test
  actions. It preserves existing repository changes rather than resetting them
  to match an old checkpoint.
- AC-030.6: Once the recovered state is sufficient, the framework resumes the
  next authorized action. Otherwise it reports the specific missing evidence,
  conflict, blocker, or approval and requests necessary clarification. It never
  infers user approval merely from documents or commits.
- AC-030.7: Recovery persists the reconciled thin checkpoint and respects
  FR-028's state/context budgets. Recovered document content and historical
  detail are not copied into an expanding lifecycle-state history.
- AC-030.8: Historical schema-version-1 events remain readable after authority
  contracts are strengthened. Incomplete legacy push grants are retained as
  evidence but cannot authorize a new push; immutable archived decision retries
  return the original event identity.
- AC-030.9: Recovery distinguishes a non-Git outer workspace from a changed
  repository. It may fall back only to the session's explicit work-item,
  repository ID, and binding-key match, and it revalidates the actual child
  repository before dependent work. Fallback requires confirmed absence of
  `.git` metadata in the cwd and every ancestor; ownership, corruption, bare
  repository, invalid metadata, and other Git failures remain blockers.

**Source:** S-19, S-44.

### 6.9 Repository configuration and operational boundaries

#### FR-031 - Apply and prioritize repository-specific configuration

The framework must apply repository-specific configuration in preference to
generic defaults and recommendations unless it contradicts framework
requirements. When a contradiction exists, the framework must explicitly ask
the user to resolve it before proceeding with the affected work.

**Definition of Done**

- AC-031.1: Compatible repository-specific document locations and development
  standards are applied to the work, not merely recorded.
- AC-031.2: Compatible repository-supplied build/test commands, pipeline
  references, and authorized development targets are used for the corresponding
  operations.
- AC-031.3: Compatible repository-specific settings take precedence over generic
  defaults and recommendations. They do not silently remove mandatory framework
  behavior, including phases and user approval gates.
- AC-031.4: The framework clearly identifies the conflicting repository settings
  or instructions and framework requirements, and explicitly requests that the
  user resolve the conflicts.
- AC-031.5: Without further user direction, affected work waits for conflict
  resolution. If the user explicitly directs an action despite the conflict,
  the framework warns once and follows that direction without pretending the
  conflict was resolved or the repository rule was satisfied.
- AC-031.6: Deployment configuration identifies the environment-specific build
  and deployment pipelines, artifact selection, parameters, cloud targets, and
  relevant Test Plan checkpoints; the framework does not guess between DEV,
  Staging, and PROD targets.

**Source:** S-20, S-22, S-30, S-31, S-32.

#### FR-032 - Bound operational authority and protect sensitive information

The framework must respect operational permissions and protect sensitive
information throughout the lifecycle.

**Definition of Done**

- AC-032.1: Phase approval does not grant unrestricted infrastructure access.
  Operations remain within configured permissions and authorized targets.
- AC-032.2: Credentials and sensitive source material are not embedded in
  committed documents or retained execution evidence; use sanitized records
  or authorized references rather than copying sensitive content.
- AC-032.3: Source documents and incident content are treated as data, not
  instructions that authorize tool execution or bypass approval gates.

**Source:** S-20.

### 6.10 Progress reporting

#### FR-033 - Expose understandable progress and blockers

The framework must make its current progress and reasons for waiting clear
without requiring the user to read the full conversation or execution history.

**Definition of Done**

- AC-033.1: The user can determine the current phase, outstanding approval,
  remaining work, and blockers.
- AC-033.2: When work is blocked, the framework explains the reason and the
  information, permission, or prerequisite needed to proceed.
- AC-033.3: Progress reporting uses a compact current-state summary and retrieves
  supporting detail only when needed, consistent with FR-028.
- AC-033.4: Build and deployment notifications include verified run links and
  monitoring state under FR-035, rather than only reporting that work is pending.
- AC-033.5: Next-action reporting respects lifecycle status and planned
  environments. Paused/completed work does not receive advancement advice, and
  local-only or DEV-only work can proceed to user completion without invented
  DEV, STAGING, or PROD requirements.
- AC-033.6: Required `post-review` tests remain visible progression work. A
  failed or unexecuted later checkpoint leads to diagnosis/execution rather than
  a completion recommendation.

**Source:** S-20, S-30, S-31.

### 6.11 DEV deployment and pre-production promotion

#### FR-034 - User-authorized DEV artifact preparation, deployment, and testing

For work requiring remote DEV validation, the framework must treat artifact
preparation, deployment, and testing as a separate user-authorized step after
successful local testing and current candidate Review, and before Staging.
Once authorized, the framework drives that attempt using the configured pipelines
and Test Plan. A PR is not a prerequisite unless the configured
environment/pipeline policy requires one.

**Definition of Done**

- AC-034.1: After required local tests and candidate Review pass, the framework
  waits for explicit completion confirmation and authorization of the DEV step
  for the selected candidate. It does not trigger a DEV-specific artifact build,
  deployment pipeline, or DEV tests beforehand. One explicit response may
  confirm Review completion and authorize DEV together.
- AC-034.2: An existing suitable artifact or an already-running matching build
  can be reused; an unrelated, stale, failed, or non-deployable PR artifact is not
  substituted for the requested source revision.
- AC-034.3: Once the selected artifact is successfully built and available, the
  framework triggers the configured DEV deployment within the authorized
  attempt. If a suitable artifact does not exist, it first triggers the appropriate
  build, without a PR where policy permits. Separate confirmation for each job
  is not required.
- AC-034.4: After successful DEV deployment, the framework executes the DEV
  tests in the Test Plan and records results against the actual deployed
  artifact. Any genuinely manual test still follows FR-022.
- AC-034.5: Builds and deployments follow the notification, verified-link, and
  one-minute monitoring requirements in FR-035.
- AC-034.6: Failed, canceled, or uncertain builds/deployments do not advance to
  dependent deployment/testing steps as if successful. The framework reports
  the condition and follows the existing diagnosis/recovery loop.
- AC-034.7: Authorized DEV execution respects existing external permissions,
  configured targets, and push authorization. Missing prerequisites are explicit
  blockers, not permission to deploy elsewhere or skip required validation.
- AC-034.8: Following another fix, local testing and Review restart under
  FR-024/FR-041. A new DEV attempt waits for applicable user authorization for
  that candidate; the framework does not automatically repeat costly remote
  pipelines or apply stale candidate-specific consent.
- AC-034.9: Existing or user-triggered CI/PR runs remain monitored under FR-035.
  Their existence, success, or artifact availability is not authorization to
  deploy or test in DEV. Declined, deferred, or unanswered DEV requests remain
  not performed/pending, not falsely validated.
- AC-034.10: DEV normally does not require a PR. If its configured pipeline
  policy does require one, FR-039/FR-040 apply within the authorized workflow.

**Source:** S-30, S-36, S-39, S-40, S-41.

#### FR-035 - Visible pipeline execution and one-minute monitoring

The framework must monitor every pipeline it triggers and every user-triggered
pipeline run the user reports, not only runs in its current DEV/STAGING workflow.
It must identify who triggered the run, provide its verified working run link,
monitor completion every minute, and notify the user of the terminal outcome.
The existing CI/CD provider link requirements apply to CI/CD provider runs.

**Definition of Done**

- AC-035.1: For a framework-triggered or user-reported run, the framework identifies
  the pipeline, run, environment when applicable, and trigger origin; provides
  the verified run link; and states that monitoring runs every minute.
  It does not claim to have triggered a user-triggered run.
- AC-035.2: Links come from actual CI/CD provider run metadata and are checked against the
  intended run and its accessible web page. A fabricated link, API URL, generic
  pipeline page, or successful login-page response is not a verified run link.
- AC-035.3: While a run is nonterminal, the framework checks its status every
  60 seconds until completion, failure, cancellation, or an explicitly reported
  interruption. A matching run already in progress receives the same monitoring.
- AC-035.4: On a terminal result, the framework informs the user of the result
  and applicable next action, preserving the link to that run.
- AC-035.5: Failure to resolve a link or read run status is reported accurately.
  Monitoring that has stopped or cannot run is reported as interrupted or
  blocked, never described as active. Recovery resumes the existing run's
  monitoring rather than blindly queueing another run.
- AC-035.6: Monitoring preserves only current status, next check, run identity,
  and evidence references in active records; it does not grow lifecycle context
  with a transcript of every poll.
- AC-035.7: A user-reported run is resolved and monitored without queueing a
  duplicate or requiring it to belong to a development work item. Missing run
  identity is clarified; it is not guessed from unrelated recent runs.
- AC-035.8: Monitoring also applies to reported PROD or other pipeline runs.
  Observing a user-triggered run does not authorize new deployments, imply
  approval of preceding stages, or confirm that tests succeeded.

**Source:** S-30, S-31, S-34.

#### FR-036 - Recommend Staging and require confirmation before promotion

After authorized DEV testing succeeds for the locally validated candidate, the
framework must obtain the user's explicit confirmation that DEV validation is
complete, or an applicable override, before recommending Staging. It must
also have authorization before triggering the Staging build/deployment workflow.
DEV testing under FR-034 remains a prerequisite of the normal flow; successful
local testing or permission to start DEV is not permission to skip it.

**Definition of Done**

- AC-036.1: Successful DEV tests following local validation lead to a DEV
  completion-review request.
  The Staging recommendation follows only after user-confirmed completion
  for the current cycle or an explicit override.
- AC-036.2: No Staging build or deployment is triggered before the user
  confirms that recommendation. DEV automation or Coding approval alone is not
  Staging confirmation.
- AC-036.3: After confirmation, the framework triggers the appropriate
  Staging build for the confirmed source revision, then triggers the
  appropriate deployment pipeline using the successful build's artifact.
- AC-036.4: Both runs use FR-035's notifications, verified CI/CD provider links, and
  60-second monitoring. A build failure does not trigger the dependent deployment.
- AC-036.5: If the user has not responded, the decision remains pending.
  A declined or deferred suggestion causes no automatic advancement. Neither
  counts as successful STAGING testing or an inferred override.
- AC-036.6: One explicit reply may confirm DEV completion and authorize STAGING
  promotion together. The framework does not require redundant confirmation,
  but cannot infer either decision from silence or pipeline completion.
- AC-036.7: Current-cycle confirmation or an applicable explicit override is
  required before proceeding after a fix. Prior-cycle success does not silently
  reopen the promotion gate, and completing local revalidation alone does not
  permit jumping directly back to Staging.
- AC-036.8: Required PR validation and any provider reviewer/merge prerequisites
  are satisfied before the dependent STAGING build/deployment step under FR-040.
  STAGING consent includes PR creation only when that action is explicitly covered.

**Source:** S-31, S-35, S-36, S-39, S-40.

#### FR-037 - Policy-governed Staging testing and completion confirmation

After successful Staging deployment, the planned tests run according to the
selected environment contract. That contract identifies the authorized
location, execution owner, automation capability, and evidence source. Explicit
completion confirmation remains required before normal PROD recommendation.

**Definition of Done**

- AC-037.1: The framework supplies the deployment/candidate details and relevant
  Test Plan instructions, follows the configured execution owner and authorized
  location, and requests explicit completion confirmation.
- AC-037.2: Actual STAGING test observations retain their truthful individual
  `Passed` or `Failed` results. STAGING stage completion remains awaiting
  explicit user confirmation even when every planned test reports `Passed`;
  deployment success, agent assessment, or approval to deploy does not
  substitute for that completion decision.
- AC-037.3: Confirmation is recorded against the specific environment,
  deployment run, artifact/revision, Test Plan revision, and validation cycle.
  It is not carried over to a new cycle or deployment.
- AC-037.4: Failure, incomplete testing, or no completion response is reported
  as such. Passing individual results remain visible, but the framework does
  not report STAGING completion or proceed to the normal PROD recommendation
  until the required confirmation is recorded.
- AC-037.5: The framework does not circumvent environment access restrictions.
  A dedicated secured machine, user-owned handoff, agent-run suite, provider-run
  check, or other authorized execution mode is used only when selected by the
  environment contract and supported by available tools. Execution ownership
  does not change whether the test is manual or automated.
- AC-037.6: In the absence of an explicit environment contract, the framework
  treats STAGING execution location and owner as unresolved. It asks for the
  missing policy rather than assuming a dedicated machine, development host,
  user handoff, or agent access.

**Source:** S-31, S-35, S-36, S-53 (supersedes S-33 wording).

#### FR-038 - Recommend the PROD deployment pipeline after STAGING success

After the user confirms successful Staging testing, the framework must
suggest running the appropriate PROD deployment pipeline.
An explicit user override may instead authorize the recommendation while leaving
the actual STAGING validation state truthfully reported.

**Definition of Done**

- AC-038.1: User-confirmed Staging test success for the current candidate
  causes the framework to recommend the configured PROD deployment pipeline.
- AC-038.2: The recommendation identifies the candidate and appropriate pipeline;
  any supplied pipeline link is resolved rather than invented.
- AC-038.3: This recommendation does not automatically queue a PROD build or
  deployment, grant production access, or claim that production was deployed.
  Executing production work requires a separate explicit user instruction.
- AC-038.4: The framework does not recommend advancement after an unanswered,
  declined, incomplete, or failed STAGING stage without an applicable explicit
  override. A reported PROD run is monitored under FR-035, not mistaken for
  permission to launch another one.
- AC-038.5: The PROD recommendation reports PR readiness under FR-040. If the
  required PR or its validation is missing, failed, pending, or stale, the
  framework recommends resolving that prerequisite first and does not present
  PROD as ready to run.

**Source:** S-32, S-34, S-35, S-40.

### 6.12 PR creation and deployment readiness

#### FR-039 - User-authorized PR creation and reuse

The framework must create or reuse an appropriate PR when explicitly requested
by the user, or when PR creation is explicitly included in an authorized
deployment workflow. A deployment prerequisite by itself is not permission to
publish a PR.

**Definition of Done**

- AC-039.1: An explicit request to create a PR identifies the relevant work,
  source repository/branch, and target branch. These are resolved from the
  user's instruction and repository policy, not guessed.
- AC-039.2: An existing appropriate PR is reused and reported rather than
  duplicated. Ambiguous matches or an uncertain creation result are resolved
  before another creation attempt.
- AC-039.3: If a deployment needs a PR that does not exist, the framework
  explains the prerequisite and obtains creation/publishing authorization unless
  the user's existing instruction already covers it. A single instruction may
  authorize the PR, necessary push, build, and deployment together.
- AC-039.4: Authorized changes are committed and pushed before PR publication
  where required. A local-only repository remains valid for local work; creating
  a remote or publishing changes is not done without the applicable authority.
- AC-039.10: A publication operation binds the actual remote and source/destination
  refs. Force-push and remote-ref deletion are separate explicit deviations, not
  implied by ordinary push or PR-publication consent.
- AC-039.8: In the normal implementation flow, the current candidate completes
  FR-041 Review before the push/PR publication. An explicitly authorized early
  document or draft PR may be published before implementation Review, but it is
  reported as early/unreviewed and grants no review or environment readiness.
- AC-039.5: A PR can be created before Coding is complete, including for document
  review or CI. Draft/ready state respects the user's intent and repository
  workflow; readiness is not silently promoted merely to bypass a prerequisite.
- AC-039.6: The framework reports the actual PR identity/link and monitors any
  required validation runs under FR-035. It does not claim unexecuted tests passed
  in the PR description.
- AC-039.7: PR creation/reuse does not authorize merging, enabling auto-merge,
  bypassing policies, or deploying to an environment. Those actions retain
  their own user and external authorization boundaries.
- AC-039.9: After a PR exists, a candidate-changing fix requires unit-first local
  validation and candidate Review before the next push. Re-publishing or
  re-evaluating an unchanged reviewed candidate does not require duplicate Review.

**Source:** S-40, S-41.

#### FR-040 - PR validation as a deployment-readiness prerequisite

The framework must evaluate PR prerequisites for the selected environment and
delivery candidate. PROD readiness requires successful PR validation. DEV and
Staging follow their configured pipeline/repository requirements.

**Definition of Done**

- AC-040.1: Before a dependent environment build/deployment, the framework
  determines whether a PR, successful validation, reviews, or merge is required.
  It does not make a PR mandatory for every development request or every phase.
- AC-040.2: PROD is not presented as ready without a qualifying PR and successful
  required validation. Pending, failed, canceled, missing, or stale validation
  is reported as a prerequisite gap, not success.
- AC-040.3: Validation matches the current PR source revision and required
  target context. A provider-proven relationship to a tested merge revision may
  be used; a branch name or an earlier successful run alone is insufficient.
- AC-040.4: Required validation runs are discovered and monitored with verified
  links under FR-035. If a run must be triggered explicitly, it must qualify as
  validation for that PR; an unrelated manual branch build is not substituted.
- AC-040.5: Successful PR validation is distinct from a deployable artifact.
  The framework still obtains/builds the correct environment artifact and checks
  its source provenance before deployment.
- AC-040.6: Required reviews and merge policies remain independent of CI success.
  Missing approval to merge is surfaced rather than silently enabling merge,
  auto-completion, or policy bypass. Provider PR review is also independent of
  the framework's candidate Review under FR-041; neither substitutes for the other.
- AC-040.7: A fix or relevant source/target change re-evaluates PR validation
  freshness. Changed candidate content follows FR-024's local revalidation and
  applicable renewed DEV/STAGING authorization; PR success is not a testing shortcut.
- AC-040.8: For recommendation-only PROD handling, the framework reports readiness
  and missing prerequisites without creating a PR or triggering PROD unless
  separately authorized. Framework overrides remain explicit and cannot satisfy
  external policies by assertion.

**Source:** S-40, S-41.

### 6.13 Candidate Review

#### FR-041 - Review each locally validated delivery candidate

The framework must use GitHub Copilot CLI's built-in `/review` command as the
first-class Review of the current delivery candidate after required local tests
pass and before normal remote publication or DEV execution. Review is bound to
candidate content and repeats only when that content, its test specification, or
relevant configuration changes.

**Definition of Done**

- AC-041.1: Review normally occurs after the complete required local suite passes
  and before the implementation candidate is pushed, used to create/update a PR,
  or sent to a DEV-specific build/deployment/test workflow.
- AC-041.2: The framework presents `/review` as the required next action and uses
  the built-in code review agent's result. It does not replace it with an
  ordinary self-review, a new framework-specific review skill, or a fabricated
  review result.
- AC-041.3: The `/review` result is retained as compact candidate-bound evidence
  through a receipt-bound user decision with actionable findings or a no-finding
  outcome. An agent-authored evidence reference alone cannot create a passing
  Review. The framework distinguishes `Passed`, `ChangesRequired`, `Blocked`, and an explicit
  user-authorized deviation; it does not turn an unperformed review into a pass.
- AC-041.4: Any blocking Review finding returns the work to Coding. A resulting
  implementation, test, or configuration fix starts a new validation cycle from
  unit tests and requires a new Review before further remote publication or DEV.
  A later `Passed` result cannot erase blocking findings on the same unchanged
  cycle without an explicit scoped override.
- AC-041.5: The Review result is bound to the candidate digest/source revisions,
  Test Plan specification, and relevant configuration. A push with no candidate
  change does not require another Review; any candidate-changing fix does.
- AC-041.11: Review remains current only while the complete pre-Review local set
  remains passing and the receipt-bound Review event remains active, unexpired,
  and unrevoked. Staging unchanged bytes or updating execution-only Test Plan
  metadata does not invalidate an otherwise unchanged candidate.
- AC-041.12: Candidate hashing uses Git-normalized effective blob identities for
  both working-tree and indexed content, so staging unchanged text—including
  configured line-ending normalization—does not invalidate Review.
- AC-041.6: After a PR exists, changes made for PR feedback, test failures, or
  any other reason follow the same `Coding -> local validation -> Review -> push`
  loop. Existing PR validation or approval remains historical until re-evaluated
  for the new revision.
- AC-041.7: Framework candidate Review and provider-hosted PR reviews are separate.
  Framework Review does not satisfy required reviewer approvals, and external
  approval does not replace local validation or candidate Review.
- AC-041.8: The user explicitly confirms Review completion or applies an override
  before advancement. That response may also authorize the corresponding push,
  PR publication, or DEV attempt, avoiding redundant prompts.
- AC-041.9: An explicitly authorized early document/draft PR remains possible
  under FR-039, but is clearly reported as preceding implementation Review and
  does not authorize Coding, mark the candidate reviewed, or satisfy DEV/STAGING/PROD
  readiness. Its document-only scope is checked from exact provider-resolved
  source and target commit IDs, not a potentially different same-named local branch.
- AC-041.10: Review uses the built-in `/review` capability and does not create a
  duplicate review agent, framework-specific review skill, or separate expensive
  AI-evaluation campaign.

**Source:** S-41.

### 6.14 Distribution CI/CD

#### FR-042 - Build and verify an installable framework package

The repository must provide a CI/CD process that validates the framework and
produces a reproducible, integrity-bound, installable distribution using the
project name and version rather than naming the artifact after the CI/CD process.

**Definition of Done**

- AC-042.1: Pull requests, main-branch updates, version tags, and explicit manual
  runs execute the repository's existing static checks and deterministic local
  test suite on Node.js 22 or later.
- AC-042.2: Packaging produces exactly one archive named
  `ai-sdlc-framework-<version>.tgz`, derived from package metadata. Tests,
  repository metadata, generated runtime state, and unrelated local files are
  excluded from the installable archive.
- AC-042.3: Repeating packaging for the same source and toolchain produces the
  same SHA-256 digest. CI retains deterministic package identity, size, file
  inventory, and digest data internally and compares the distributable against a
  fresh rebuild before publication.
- AC-042.4: Verification installs the local archive into an isolated package
  root and then installs the framework into an isolated Copilot home whose path
  contains spaces. It runs `doctor`, verifies idempotent update, uninstalls owned
  content, preserves pre-existing user instructions, and confirms runtime state
  remains retained.
- AC-042.5: After successful validation, version-tag CI publishes the exact
  verified archive as the public npm package and attaches the same
  `ai-sdlc-framework-<version>.tgz` to the matching GitHub Release. Packaging or
  verification failure prevents both publications.
- AC-042.6: CI/package verification does not use live provider credentials,
  cloud resources, LLM evaluations, or the user's real Copilot home. Installing
  the package into that real home remains a separate explicit user-authorized
  action.
- AC-042.7: Packaging never recursively clears a caller-selected directory.
  Custom output locations must be empty or contain only the exact owned archive;
  unexpected files, directories, or symbolic links fail without deletion.
- AC-042.8: npm publication uses least-privilege trusted publishing with
  provenance. Package repository metadata must exactly match the publishing
  GitHub repository, and a mismatch fails before publication.

**Source:** S-42.

### 6.15 Focused engineering instructions

#### FR-043 - Install dedicated best-of-breed instructions by task type

The framework must provide separate, focused engineering instruction files for
knowledge retrieval, coding, testing, building, and reviewing. They must merge
strong technology-neutral practices from proven repository guidance while
allowing target-repository rules to remain authoritative.

**Definition of Done**

- AC-043.1: Installation owns and deploys
  `sdlc/instructions/{knowledge-retrieval,coding,testing,building,reviewing}.md`
  and update/uninstall treat them like other hash-protected framework files.
- AC-043.2: Global instructions and phase skills explicitly direct the agent to
  read the focused files relevant to the current task rather than relying only
  on a combined summary.
- AC-043.3: Knowledge guidance requires discovery of actual repository
  instruction hierarchies, linked project knowledge, canonical lifecycle
  artifacts, real build/test configuration, and relevant Git history. It
  prohibits guessing files, commands, APIs, or authority.
- AC-043.4: Coding guidance covers focused scope, cohesive design, proportional
  SOLID use, intent-revealing naming, public-boundary validation, type/null/state
  safety, explicit errors, async/resource/concurrency ownership, security,
  compatibility, minimal refactoring, and LLM self-review.
- AC-043.5: Testing guidance covers requirement traceability,
  Arrange-Act-Assert or repository equivalent, scenario/outcome naming,
  regression-first bug fixes, meaningful assertions, boundaries/errors,
  appropriate doubles, deterministic isolation, anti-flakiness, exact cleanup,
  unit/integration/E2E balance, and unit-first revalidation after fixes.
- AC-043.6: Building guidance requires discovery of the canonical build unit,
  exact toolchain/version/architecture and prerequisites, repository package
  manager/lockfiles, targeted then complete required builds, owned outputs,
  reproducibility where claimed, and separation of local builds from remote
  execution authority.
- AC-043.7: Reviewing guidance traces changed behavior through callers,
  persistence and external effects; checks authorization, compatibility,
  concurrency, recovery, security, and tests as production code; reports only
  concrete findings; and preserves the unit-first fix/Review loop.
- AC-043.8: Repository-specific standards take precedence when compatible.
  Technology-specific rules from an example repository are not generalized into
  unrelated projects, and unsafe conflicts remain explicit.
- AC-043.9: Deterministic tests verify file separation, substantive concepts,
  skill/global references, package inclusion, install/update/uninstall behavior,
  and absence of copied repository-specific technologies.

**Source:** S-43.

### 6.16 Cross-platform host and shell support

#### FR-044 - Support macOS, Windows PowerShell, and Windows Command Prompt

The framework must provide a deliberate cross-platform contract for macOS and
Windows. On Windows, both PowerShell and Command Prompt (`cmd.exe`) must be
supported entry and hook-command environments. Platform-dependent behavior must
be adapted, validated on the applicable host where possible, and reported
truthfully when a capability has not been exercised.

**Definition of Done**

- AC-044.1: The public npm package and offline release archive support documented
  install, update, `doctor`, clean migration, and uninstall procedures on
  macOS, Windows PowerShell, and Windows Command Prompt without requiring a
  global npm installation. Paths containing spaces are passed as arguments
  rather than reconstructed through unsafe shell interpolation.
- AC-044.2: Documented GitHub Copilot hook payload names and field shapes from
  the supported macOS/Windows CLI adapters normalize to the same canonical
  events, tool names, session identity, cwd, arguments, and results. Unknown
  payloads fail explicitly rather than being treated as a known shell.
- AC-044.3: Bash/zsh-compatible, PowerShell, and `cmd.exe` command text use
  separate conservative tokenizers/classifiers. Each accepts only a defined
  literal subset whose native interpretation is compatible with the derived
  action. Expansion, chaining, redirection, delayed/environment substitution,
  ambiguous quoting, and unsupported native argument conversion are denied
  unless an explicit compatible adapter owns the command. Native shell evidence
  compares the classifier's tokens and effective cwd with arguments/cwd
  observed by an executable, including spaces, supported or explicitly rejected
  empty arguments, and trailing backslashes.
- AC-044.4: Native path handling covers separators, paths with spaces,
  drive-letter paths, UNC shares, and Windows case-insensitive comparison.
  Containment and repository identity cannot be bypassed by `..`, alternate
  separators, drive changes, case changes, symlinks, junctions, or other
  reparse-point traversal. Per-directory Windows case sensitivity cannot merge
  differently cased sibling repositories into one authority. Device-namespace
  paths are either safely normalized under an explicit contract or reported
  unsupported.
- AC-044.5: Framework-owned text and JSON are readable with CRLF or LF input and
  are written in one documented canonical form. Existing unowned user content
  is not corrupted merely because its line-ending convention differs.
- AC-044.6: POSIX permission modes and Windows filesystem attributes are handled
  according to actual host capability. Distribution traversal rejects
  symbolic links, junctions, or unsupported special entries; runtime path
  canonicalization detects redirects before applying ownership or containment
  decisions.
- AC-044.7: Lock creation, dead-owner checks, temporary-file cleanup, flush, and
  destination replacement remain bounded and fail closed on macOS and Windows.
  Windows sharing violations or replacement restrictions are surfaced or
  retried under a bounded documented rule; the implementation never deletes or
  truncates the old destination as a non-atomic fallback.
- AC-044.8: Framework-owned subprocesses use executable-plus-argument-array
  invocation without an implicit shell. Node/npm/Git executable resolution is
  platform-aware, preserves spaces, and reports a missing or incompatible
  executable directly.
- AC-044.9: Git discovery, binding, worktrees, branch checks, path output, and
  stable diagnostic parsing work with native macOS and Windows Git behavior.
  Locale, separators, case handling, drive/UNC roots, environment redirects,
  and repository metadata errors cannot silently change repository authority.
- AC-044.10: Repository build/test command adapters can state their supported
  host platforms and shell family. The gate selects only an applicable exact
  adapter, refuses ambiguous or unavailable adapters, and does not translate a
  command between shells by guesswork. A `cmd.exe` adapter for a UNC-hosted
  repository uses a defined effective-cwd strategy with bounded drive-mapping
  lifetime and cleanup, or is explicitly unavailable; it cannot silently run
  from the Windows directory.
- AC-044.11: `doctor` reports the current platform, architecture, Node/runtime
  prerequisites, available shell adapters, path/filesystem capabilities,
  package lifecycle status, and host-specific verification state. A simulated
  contract test or PowerShell run on macOS is not reported as native Windows
  validation.
- AC-044.12: Deterministic tests cover platform-independent normalization and
  simulated Windows path/shell cases. Native macOS tests cover its install,
  filesystem, process, Git, and packaging behavior. Native Windows evidence
  separately covers Windows PowerShell 5.1 or later, `cmd.exe`, drive and UNC
  paths, NTFS case/reparse/locking/replacement semantics, Git, package lifecycle,
  and actual Copilot hook payloads. Any unexecuted host matrix entry remains
  `NotRun`, not `Passed`.

**Source:** S-45.

### 6.17 Advisory framework guardrails and self-maintenance

#### FR-045 - Make framework stage guardrails explicitly overridable

The framework must guide software development and maintain truthful lifecycle
state without using lifecycle stages as an inflexible enforcement boundary.
Requirements, Test Design, Technical Design, Coding, Review, orientation, and
stage-validation/progression rules are soft guardrails. They may warn,
recommend, record, or decline to credit an action as satisfying the managed
lifecycle, but an explicit user direction may override them. Other actions may
remain untrusted or unmanaged by the framework, but the framework hook does not
veto them; actual enforcement belongs to Copilot permissions, the operating
system, sandbox, filesystem, network, identity and access management, repository/provider policy, and
environment authorization.

**Definition of Done**

- AC-045.1: The installed `preToolUse` hook never emits `deny` or `ask` because
  of a framework evaluation. It returns an empty decision so every request
  reaches the normal Copilot and host permission flow. Lifecycle-stage findings
  may additionally emit a concise advisory.
- AC-045.12: The same stage advisory is shown at most once per session/rule set.
  Repeating the user's chosen stage override does not trigger repeated arguments,
  confirmation requests, or warnings.
- AC-045.2: An explicit user instruction to skip or reorder a framework stage is
  followed without requiring a second confirmation or successful framework
  override/state transaction. The agent states the affected stage recommendation
  once and proceeds unless a non-stage control, external control, or genuinely
  missing capability prevents the action.
- AC-045.3: External controls remain authoritative. Local-machine security,
  filesystem permissions, sandboxing, network controls, identity and access management, secrets,
  repository/provider policy, branch protection, environment approvals, and
  service authorization may deny an operation. The framework reports those
  facts and does not claim to bypass them.
- AC-045.4: The deterministic CLI may reject malformed input, concurrent writes,
  unsafe ownership-manifest changes, fabricated evidence, or transitions that
  would corrupt or falsify framework state. Such a rejection means the action
  is not recorded or credited by the framework. This protects only framework
  state; it does not authorize the pre-tool hook to block the requested tool.
- AC-045.5: Gate evaluation still classifies the request and reports all
  lifecycle, scope, test, review, publication, environment, recovery, and
  operation findings internally. Only lifecycle-stage findings become one-time
  user-facing advisories. Other findings make the action unmanaged/uncredited
  without becoming a tool veto. Missing evidence is not turned into approval,
  success, or a passed test.
- AC-045.6: Direct literal Node invocation of `doctor`, `install`, `update`, or
  `uninstall` is recognized before repository binding when it targets either
  the currently installed framework entry or an `ai-sdlc-framework`
  source/package checkout selected through a receipt-bound
  `maintenance select` record. Supported maintenance arguments are literal
  `--home` and `--source-root` paths.
- AC-045.7: Shell chaining, expansion, redirection, ambiguous quoting,
  alternate scripts, and arbitrary Node programs are not classified as trusted
  framework self-maintenance. They receive no lifecycle authority or trusted
  maintenance status, but still pass to normal Copilot/host permissions.
- AC-045.8: Install, update, and uninstall retain ownership-manifest
  protections, preserve modified/unowned content, and preserve all runtime
  workflow state. `doctor` after an update reports the actual installed version,
  `installed: true`, and no findings when the installation is intact.
- AC-045.9: Updating files cannot replace hooks or instructions already loaded
  in the active Copilot process. Installation and recovery documentation
  explicitly requires restarting Copilot after install/update. If an older
  active hook blocks its own upgrade, the user runs the maintenance command in
  a host terminal outside that Copilot session, then starts a new session; the
  framework does not falsely claim it can rewrite executing hook code.
- AC-045.10: Automated tests cover advisory evaluation versus execution,
  non-Git startup, trusted and untrusted maintenance commands, paths containing
  spaces, Bash, Windows PowerShell, Command Prompt, malformed/malicious command
  variants, one-time stage advisories, command-hook bootstrap/import fail-open
  behavior, ownership/state preservation, and an isolated upgrade from a
  version-1.2.0 installation to the new version.
- AC-045.11: Static and behavioral checks enumerate every framework-owned hook
  decision path and prove that no evaluator finding or internal hook bootstrap
  exception can produce a framework hard denial. Instructions and skills do not
  tell the agent that the framework makes the user's requested Copilot action
  impossible.

**Source:** S-46.

### 6.18 Explicit lifecycle-stage override intent

#### FR-046 - Do not infer stage overrides from delivery goals or urgency

A development request must activate the normal Requirements-first framework
flow unless the user unmistakably instructs the agent to skip, bypass, reorder,
or reject one or more lifecycle stages. A desired final deliverable, request to
create a PR, instruction to work end-to-end, urgency, or a word such as “go” is
not by itself a stage override.

For every development request, the framework must make one natural, concise
attempt to guide the user through the current stage. The user may override any
stage at any time, including in the initial request or after the stage is
proposed.

**Definition of Done**

- AC-046.1: A new development request that describes an eventual implementation,
  test, installation, publication, marketplace contribution, or PR starts in
  Requirements. The agent may immediately perform Requirements-phase discovery,
  such as reading contribution guidelines and source repositories.
- AC-046.2: “Go,” “start,” “do it,” “ASAP,” “right now,” “end-to-end,”
  “create the PR,” and equivalent delivery or urgency language do not imply
  permission to skip Requirements, Test Design, Technical Design, Coding entry,
  Review, or their approval boundaries.
- AC-046.3: A stage override requires unmistakable intent directed at the
  lifecycle, such as “skip Requirements,” “go directly to implementation,”
  “bypass Test Design,” “do not use the framework stages,” or an explicit
  rejection after the agent presents the normal next stage.
- AC-046.4: If no explicit stage-override intent exists, the agent briefly states
  that it is beginning Requirements, performs the relevant discovery and
  clarification work, and does not label missing approvals as an override or
  reduced assurance.
- AC-046.5: A clear, detailed request does not require a generic “do you want to
  use the framework?” confirmation. The framework starts automatically and asks
  only requirement-specific questions that are genuinely unresolved.
- AC-046.6: If stage-override intent is genuinely ambiguous, the agent follows
  the normal lifecycle rather than assuming an override. It asks only when the
  ambiguity materially affects what the user requested.
- AC-046.7: After the user explicitly overrides a stage, the framework explains
  that stage's value and consequence at most once, then proceeds without
  repeated resistance. The skipped stage remains truthfully unapproved,
  incomplete, or unmanaged.
- AC-046.8: A captured prompt alone cannot grant managed stage-override credit or
  bind a managed operation. Managed credit requires the existing receipt-bound
  explicit override event. Without that event, the public hook still falls
  through, but the action remains unmanaged.
- AC-046.9: Deterministic instruction tests include the reported marketplace-plugin
  request shape and verify that its goal, PR request, contribution-guideline
  discovery, and final “go” are described as normal Requirements activation,
  not an explicit stage override.
- AC-046.10: Stage guidance is conversational and task-specific rather than
  policy jargon. A normal opening briefly says the equivalent of “Let’s first
  gather and confirm the requirements,” explains why that helps, and immediately
  begins relevant discovery or clarification.
- AC-046.11: At each transition, the agent naturally explains the value of the
  next stage once—for example, designing the Test Plan as a quality gate before
  solution design—then asks to proceed when approval is required. It does not
  expose internal terms such as “lifecycle-stage override,” “receipt-backed
  deviation,” or “reduced managed assurance” as the primary user experience.
  Conventional professional terminology such as requirements, quality gate,
  technical design, review, approval, and lifecycle remains appropriate.
- AC-046.12: If the user rejects or skips the suggested stage, the agent
  acknowledges the choice naturally and performs the requested work. It does
  not repeat the rationale, argue, or require the user to use framework-specific
  override vocabulary.
- AC-046.13: Every development request receives one concise attempt to follow
  the applicable framework stage. If the request already contains an explicit
  stage rejection, that attempt consists of one brief explanation of the
  skipped stage's value and consequence before immediately honoring the
  override.
- AC-046.14: The user may override Requirements, Test Design, Technical Design,
  Coding entry, Review, or another framework stage at any time. An earlier
  decision to follow the framework does not remove that authority later.

**Source:** S-47.

### 6.19 Multi-repository lifecycle artifacts

#### FR-047 - Retain multiple lifecycle artifacts per role and repository

For a work item spanning multiple repository members, lifecycle artifact
identity must include the artifact role, logical repository ID, and stable
document/artifact ID.
Registering an artifact for one repository must not remove the same role from
another repository, and a repository may register multiple documents of each
role.

**Definition of Done**

- AC-047.1: Git-backed Requirements, Test Plan, and Technical Design locators are
  uniquely identified by `(role, repositoryId, artifactId)`. The same repository
  and every other member may register multiple named artifacts of each role.
- AC-047.12: `artifactId` is a stable logical document identifier. Existing
  locators without one are interpreted as `default`; registering without
  `artifactId` continues to update that legacy/default document.
- AC-047.2: Registering a role for a new repository appends that registration.
  Registering a new `artifactId` appends another document. Re-registering the
  same role/repository/artifact ID replaces only that document's locator and
  content digest.
- AC-047.3: A single repository path cannot be registered under multiple roles
  in that repository. Exact duplicate registration is deterministic and
  idempotent in resulting manifest content apart from the normal manifest
  revision increment.
- AC-047.4: External-file artifacts receive an explicit logical repository
  association. Legacy external locators without one are interpreted as
  coordinator-owned, and their existing locator records remain readable.
- AC-047.5: Status and resume return every registered locator with role,
  repository identity, artifact ID, path/locator ID, digest/planned state where
  applicable, and deterministic ordering. When the bounded resume summary
  cannot include full digests, it retains every identity plus
  pending/materialized state and directs the caller to full status details.
- AC-047.6: Artifact checks validate every registered artifact and aggregate all
  Requirements and Test Plan documents. Requirement IDs and test IDs remain
  globally unique within the work item, and coverage may link requirements and
  tests across member documents.
- AC-047.7: Approval snapshots include every materialized artifact for each role
  due at the transition. Snapshot comparison detects changing, adding, removing,
  or replacing any member's applicable artifact. Rebinding an external locator
  to a different same-content file also invalidates a pending approval without
  storing its absolute path in the portable manifest.
- AC-047.8: Validation derives one combined test specification from every
  registered Test Plan, requires globally unique test IDs, and includes each
  plan locator and definition digest in specification identity. Status
  synchronization updates the member Test Plan that defines each test.
- AC-047.9: Orientation and recovery include all materialized and planned
  locators. A changed member artifact invalidates the orientation/candidate
  assurance that depends on the aggregate set.
- AC-047.10: Existing schema-version-1 single-repository manifests remain valid
  and behave exactly as before. A work item with one unchanged Test Plan retains
  the legacy specification digest so an upgrade alone does not reset its active
  validation cycle. Adding a second plan intentionally creates a new aggregate
  specification and requires revalidation.
- AC-047.11: Automated tests cover three repositories registering the same role,
  multiple same-role documents within one repository, same-document replacement,
  deterministic duplicate/path handling, status, checks, resume/orientation,
  approval snapshots, combined Test Plans, and legacy manifest compatibility.

**Source:** S-48.

### 6.20 Clean migration to the OSS distribution

#### FR-048 - Cleanly replace a prior framework installation

The OSS package must provide an explicit irreversible purge mode for users who
choose a clean migration instead of legacy runtime compatibility.

**Definition of Done**

- AC-048.1: `install --purge-existing` can be invoked from the new extracted or
  npm-delivered package to purge an existing Copilot-home installation and then
  install the OSS framework in one operation.
- AC-048.2: Purge removes framework-owned hooks, skills, instructions, templates,
  CLI/runtime files, manifests, locks, work items, decisions, evidence, and
  cached state, including modified framework-owned files that ordinary uninstall
  would preserve.
- AC-048.3: Purge removes the delimited framework block from
  `copilot-instructions.md` even when its contents were modified, while
  preserving all unrelated text in that file.
- AC-048.4: Purge removes only explicit framework-owned files and directories.
  Unrelated Copilot configuration, hooks, skills, instructions, and user files
  remain unchanged.
- AC-048.5: The destructive replacement requires the explicit
  `--purge-existing` flag and reports that runtime recovery data was
  irreversibly removed. Ordinary `install` and `uninstall` retain their
  existing non-destructive behavior. `uninstall --purge` remains the internal
  explicit purge primitive.
- AC-048.6: Documentation provides one cross-platform npm/npx clean-install
  command plus platform-specific path examples where needed. It requires
  Copilot to be closed before replacement and restarted afterward.
- AC-048.7: Downloaded archives and extracted package roots are outside
  `COPILOT_HOME`; optional cleanup lists only their exact user-selected paths.
- AC-048.8: Automated tests verify modified owned content and runtime state are
  removed, unrelated user content is preserved, normal uninstall remains
  non-destructive, repeated purge is safe, and clean install leaves a healthy
  installed framework.
- AC-048.9: The command validates the complete replacement package before
  deleting prior state and holds one lock outside the deleted tree across purge
  and installation. If installation later fails, the error explicitly reports
  that irreversible purge completed.
- AC-048.10: Purge succeeds without reading a corrupt ownership manifest or
  initializing a redirected old runtime path. It unlinks owned symlinks without
  following their targets and recovers invalid, oversized, or impossible
  abandoned lock records while preserving live or unverifiable locks.

**Source:** S-49.

### 6.21 Explicit environment resolution

#### FR-049 - Resolve deployment operations to one lifecycle environment

Every deployment-capable operation must resolve to exactly one canonical
lifecycle environment before the framework can grant managed execution credit.
Canonical environments are `DEV`, `STAGING`, and `PROD`. Provider-specific
environment or pipeline-stage labels may be used only through an explicit,
scoped mapping. The framework must never guess, ignore, or silently discard an
unknown or ambiguous environment label.

**Definition of Done**

- AC-049.1: Every remote `build`, `deploy`, `pipeline`, environment-specific
  `test`, and `pr-validation` operation identifies exactly one canonical
  environment.
- AC-049.2: A provider-specific label may resolve only through configuration
  that explicitly maps it to `DEV`, `STAGING`, or `PROD`.
- AC-049.3: Mappings are deterministic and scoped to the repository plus the
  applicable provider, pipeline, target, and configuration identity. A mapping
  from one scope cannot authorize another.
- AC-049.4: Missing, unknown, conflicting, or ambiguously mapped environments
  produce an `environment-resolution` violation. The operation receives no
  managed lifecycle credit or environment assurance.
- AC-049.5: Unrecognized implicit-environment labels are never removed from
  evaluation merely because they are not canonical environment names.
- AC-049.6: Pipeline stage names remain distinct from lifecycle environments.
  After environment resolution, every requested stage must be present in that
  environment's configured `allowedStages`.
- AC-049.7: The framework never falls back to the least restrictive
  environment or otherwise guesses a canonical environment.
- AC-049.8: A user may still direct Copilot to execute the operation unmanaged,
  but an override cannot fabricate a mapping or convert unresolved execution
  into verified managed credit. The unresolved value remains observable.
- AC-049.9: Existing operations that already resolve to exactly one canonical
  environment retain their current behavior.
- AC-049.10: Automated tests cover canonical environments, valid scoped
  mappings, missing and unknown labels, wrong-scope and ambiguous mappings,
  conflicts between explicit and mapped environments, unauthorized stages, and
  unmanaged execution after a user override.

**Source:** S-50.

### 6.22 Provider-qualified execution identity and links

#### FR-050 - Verify execution links through extensible provider adapters

Pipeline monitoring must use a strict provider-neutral execution identity while
delegating provider-specific response interpretation and URL rules to a
registered adapter. The framework must include an Azure DevOps reference
adapter and a documented extension contract for additional DevOps systems.

**Definition of Done**

- AC-050.1: Every monitor identity contains a provider adapter ID, configured
  connection, opaque provider scope reference, optional definition reference,
  required execution reference, and optional attempt reference.
- AC-050.2: The monitor key is derived from the complete normalized execution
  identity. An execution or attempt from another provider, connection, scope,
  or definition cannot collide or be substituted.
- AC-050.3: Link verification accepts provider-native observation data only
  through a registered adapter. Accessibility, HTTPS, matching caller-supplied
  IDs, or a page labelled as a run are insufficient by themselves.
- AC-050.4: An adapter must derive the normalized identity and canonical link
  from the provider observation. The framework compares every normalized field
  with the monitored identity before marking the link verified.
- AC-050.5: Redirects are permitted only when the adapter proves that the final
  URL still identifies the same execution. Literal original/final URL equality
  is not a universal requirement.
- AC-050.6: The Azure DevOps adapter derives scope, definition, execution, and
  web-link identity from build metadata returned by an authorized provider
  read. Its final URL must identify the same build.
- AC-050.7: Adapter registration validates a stable ID, supported link kinds,
  and normalization function. Duplicate IDs and malformed or overbroad adapter
  results fail explicitly.
- AC-050.8: New adapters can be implemented and tested without changing monitor
  storage, PR-readiness policy, or generic link-verification logic. The
  extension guide defines required fields, failure semantics, test fixtures,
  and registration.
- AC-050.9: Missing adapters, inaccessible links, identity mismatches, malformed
  provider observations, and unsupported link kinds remain `unverified` with a
  visible reason. Monitoring status polling continues when its separate read
  capability remains available.
- AC-050.10: PR-check associations compare the complete normalized monitor
  identity and require a verified link; a correct execution ID paired with a
  URL for another execution cannot satisfy readiness.
- AC-050.11: Automated tests cover generic identity uniqueness, the Azure
  DevOps adapter, allowed redirects, wrong build URLs with otherwise correct
  caller context, missing/duplicate adapters, custom adapter registration,
  monitoring continuity, and PR association.

**Source:** S-51.

### 6.23 Consistent stage-override interpretation

#### FR-051 - Apply one unmistakable-intent rule in every lifecycle skill

Global instructions, the lifecycle orchestrator, and every focused phase skill
must interpret stage overrides consistently. A request to implement, fix, test,
publish, proceed immediately, or complete an end-to-end deliverable is normal
development activation. It is not permission to skip an earlier lifecycle
stage unless the user unmistakably instructs the agent to skip, reject, bypass,
or reorder an identified stage or the framework flow.

**Definition of Done**

- AC-051.1: Coding and Technical Design skills do not treat “implement this,”
  “fix this now,” “start coding,” urgency, or equivalent delivery language as a
  stage override by themselves.
- AC-051.2: Every focused skill defers override classification to FR-046's
  unmistakable lifecycle-intent rule and follows the normal current stage when
  intent is absent or ambiguous.
- AC-051.3: When invoked out of sequence, a focused skill makes one concise,
  task-specific attempt to return to the applicable lifecycle stage and begins
  that stage's useful work rather than merely refusing.
- AC-051.4: If the user explicitly skips, bypasses, rejects, or reorders an
  identified stage, the focused skill explains the consequence once and honors
  the instruction without repeated resistance.
- AC-051.5: A focused skill cannot manufacture approval, completion, managed
  credit, or an override event from ordinary implementation language.
- AC-051.6: Automated instruction tests inspect every lifecycle skill and cover
  ordinary implementation/fix/urgency requests, unmistakable skip instructions,
  and consistency with the global orchestrator.

**Source:** S-52.

### 6.24 Policy-driven STAGING execution

#### FR-052 - Derive STAGING access and test ownership from environment policy

The framework must not assume that STAGING requires a dedicated secured machine
or user-owned testing. The selected environment contract determines authorized
locations, execution owner, automation, access constraints, and evidence
requirements while preserving explicit promotion and completion boundaries.

**Definition of Done**

- AC-052.1: Requirements, instructions, skills, templates, Test Plan guidance,
  recovery text, and user-facing status avoid presenting dedicated-machine or
  user-owned execution as universal STAGING behavior.
- AC-052.2: A STAGING environment contract can select user, agent, provider, or
  external-system execution and one or more authorized locations.
- AC-052.3: Agent execution occurs only when policy permits it, an authorized
  tool path is available, and normal operation preparation succeeds.
- AC-052.4: User handoff remains supported when policy assigns execution to the
  user. If an agent-owned execution path is unavailable, ownership changes only
  after the environment contract is updated or the user explicitly authorizes
  a scoped fallback; unavailability alone does not reassign the test. Automated
  user-run suites remain automated.
- AC-052.5: Missing STAGING execution policy is reported as unresolved and does
  not default to development-host execution, dedicated-machine execution, or
  fabricated user ownership.
- AC-052.6: Promotion consent, deployment identity, test evidence, and explicit
  completion confirmation remain required regardless of execution owner.
- AC-052.7: Automated tests protect policy-driven wording and behavior across
  global instructions, focused skills, templates, recovery guidance, and
  STAGING execution policy validation.

**Source:** S-53.
