# Requirements: Verify Repository, Pull Request, and Execution Evidence

## What problem are we solving?

A local Git repository can refer to several hosted repositories. The framework
must not assume that a remote named `origin` is the right one, or count a check,
build, artifact, or tool result from the wrong repository, pull request, revision,
or execution attempt as a pass. When an external action might have happened but
the result is unclear, the framework must say so rather than retry or claim
success.

For this work, **`localRepositoryPath`** means the actual local Git checkout
directory, and **`remoteRepositoryURL`** means the verified URL of the hosted
repository being checked. Together they say which local checkout and which
hosted repository an observation concerns. `origin` and `upstream` are only Git
names used to find URLs; they are not fixed roles or repository identities.
A path or URL may change, so the relationship must be checked again when used.
We do not need another label for this relationship. Existing framework
`repositoryId` values remain readable for older work items, but they do not
replace verification of the actual path and URL.

Here, a **hosting service** is GitHub, Azure DevOps, or another provider; a
**connection** identifies the configured access context on that service
without recording credentials. An execution **scope** is the organization,
project, or equivalent boundary reported for that run. **Managed credit**
means accepting evidence as proof that a particular test, check, or external
action succeeded. These technical fields must be explained where they first
appear in user-facing material, not hidden behind a new nickname.

This work defines the same safety rules regardless of whether the hosting
service is GitHub or Azure DevOps. Service-specific API translation belongs in
the service adapter, not in the general workflow. The later GitHub integration
may start only after this work passes its local tests and candidate review.

All development and validation here and in the later GitHub integration are
**local-only**. The agent may read `urmich/ai-sdlc-framework` but must not push,
create or edit a PR, tag, publish, run a remote workflow, change a hosted
repository's settings or the real checkout's Git remotes, or make any other
remote change. Tests may configure remotes only inside disposable repositories
they created. Existing version 0.3.1 records remain readable; reading them
does not grant new approvals or passing evidence.

## What must work?

### FR-055 - Identify the local and hosted repositories behind evidence

When the framework examines an external observation, it must know the real
local checkout path and the real URL of the hosted repository. One local
checkout may have more than one hosted repository.

**Definition of Done**

- AC-055.1: A repository observation records a validated
  `{localRepositoryPath, remoteRepositoryURL}` pair, the hosting service and
  connection, observed revision, evidence reference, and observation time.
- AC-055.2: Observations for two different remote URLs from the same local
  checkout, or two local checkouts with the same remote URL, remain distinct.
  Reusing one pair with conflicting hosted-repository evidence fails visibly
  rather than overwriting it.
- AC-055.3: The selected Git remote's **fetch URL** is checked for read-only
  observations; any future publication must separately check the actual push
  URL. Multiple applicable URLs or an absent selected remote stay unresolved
  until one destination is explicitly verified. Remote names alone never prove
  repository identity, and credential-bearing URLs are not saved.
- AC-055.4: Status, recovery, checks, and audit output identify the actual
  local checkout and hosted repository for any managed conclusion.
- AC-055.5: A moved local checkout or changed hosted URL requires renewed
  verification. Different HTTPS/SSH forms are treated as the same repository
  only when the hosting service proves it; history is preserved, but neither
  approvals nor passing evidence transfer merely because a URL changed.
- AC-055.6: Permission to publish to one hosted repository does not authorize
  publication to another URL from the same checkout. A later observation of
  the second URL cannot retroactively expand an earlier approval.

### FR-056 - Find the right default branch without assuming `origin`

The default branch must come from an explicitly configured full branch name, a
selected Git remote, or a current verified observation of the hosted repository.

**Definition of Done**

- AC-056.1: A configured full `refs/heads/...` branch and a selected Git remote
  work even when the remote is not named `origin`.
- AC-056.2: A current observation can supply the default branch only when it
  matches the selected `{localRepositoryPath, remoteRepositoryURL}` pair.
  A locally cached Git remote HEAD alone is not proof of the current URL's
  default branch after the URL or remote name changes.
- AC-056.3: A missing, stale, malformed, ambiguous, or conflicting branch
  remains unresolved. The framework never guesses `main`, `master`, or
  `origin/HEAD`.
- AC-056.4: Existing repositories that use `origin` continue to work.

### FR-057 - Track what a pull request actually refers to

A pull request (PR) observation must identify its hosted repository, source and
target branches, exact revisions, current state, and supporting evidence.

**Definition of Done**

- AC-057.1: A PR observation includes the verified local-path/remote-URL pair,
  hosting service and connection, PR identifier, full source/target branch
  names and revisions, state, evidence reference, and observation time. The
  remote URL identifies the repository **hosting the PR**; when the PR comes
  from a fork, its source repository URL is also verified. Branch names may
  be identical in different repositories.
- AC-057.2: When either branch revision advances, the new observation becomes
  current, the old one remains in history, and checks/readiness for the old
  revisions stop counting.
- AC-057.3: Retargeting to another branch requires proof that it is the same
  hosted PR. Contradictory evidence for the same observation is rejected.
- AC-057.4: A state-only change (for example, active to closed) refreshes the
  observation time and evidence without changing which PR it is.
- AC-057.5: Merely observing a PR never grants permission to publish, merge,
  deploy, or mark a lifecycle phase complete.

### FR-058 - Match each required check to its exact PR and run

A passing check counts only if it belongs to the current PR observation and
the execution attempt that produced that particular check.

**Definition of Done**

- AC-058.1: The association identifies the local checkout, hosted repository,
  current PR observation, an unambiguous **check result** and its required-check
  definition/producer, the revision actually tested, source/target revisions,
  complete execution attempt, and supporting evidence. When a check tested a
  generated merge revision, provider evidence must prove its relationship to
  those source/target revisions.
- AC-058.2: A previously standalone run may be linked to a PR later only when
  all those identities match.
- AC-058.3: Missing, duplicate, stale, wrong-repository, wrong-PR,
  wrong-revision, wrong-check, or wrong-attempt evidence does not count as a
  passing required check. Two checks with the same display name or sharing one
  run cannot borrow each other's evidence; an unproven merge-revision
  relationship is not enough.
- AC-058.4: Cleanup retains every association still needed for current
  readiness, terminal notices, audits, unresolved actions, or recovery.

### FR-059 - Tell executions and artifacts apart

A rerun, an execution attempt, and an artifact built by it must not be
interchangeable with another run, attempt, repository, or artifact version.

**Definition of Done**

- AC-059.1: An execution identifies its hosting service, connection, scope,
  optional workflow/build definition, run, and attempt when that service has
  distinct attempts.
- AC-059.2: When the **kind of execution** is proven to have no distinct
  attempts, the attempt is `not-applicable`. When that execution kind supports
  attempts but the actual one is unknown, attempt-sensitive checks cannot
  pass. The framework never invents attempt `1`.
- AC-059.3: An artifact identifies its producing execution, verified
  local-path/remote-URL pair, hosted artifact reference, logical artifact name,
  immutable content digest or proven version, and evidence.
- AC-059.4: Different attempts, artifact content, local paths, hosted URLs, or
  provider connections produce distinct identities.
- AC-059.5: Older records missing these facts stay available for history but
  cannot prove a new managed result on their own.
- AC-059.6: Current Azure DevOps builds without distinct attempts remain
  supported, and existing run records still resolve as history.
- AC-059.7: An artifact from a different candidate source revision or build
  configuration remains identifiable history but cannot satisfy current
  artifact readiness, even when two commits contain identical files.

### FR-060 - Reconcile uncertain external actions using exact results

Preparing or calling a tool does not prove that its external action completed.
The required proof depends on what the action was meant to do.

**Definition of Done**

- AC-060.1: Preparation records which kind of action is expected: start an
  execution, produce an artifact, deploy, create/update a PR, publish/delete a
  Git ref, change policy/configuration, or deliver a notification.
- AC-060.2: Reconciliation ties the observed result to the exact prepared
  action, target, tool invocation when provable, hosting-service observation,
  status, and evidence. A result must also be provably caused by this
  dispatch, not an earlier identical action.
- AC-060.3: Submitting a run does not prove it passed; creating a PR needs the
  exact resulting PR; publishing a ref needs the exact destination and revision;
  building an artifact needs that artifact's exact identity.
- AC-060.4: `not-started` needs affirmative proof that dispatch was not
  attempted. An empty search for the result is not enough.
- AC-060.5: Timeout, missing handle, malformed result, provider disagreement,
  or partial completion remains `uncertain`, not success or non-dispatch.
- AC-060.6: Evidence for one kind of action cannot complete another.
- AC-060.7: A terminal result can be replayed only with the same complete
  evidence; conflicting changes fail.
- AC-060.8: A matching action cannot receive new managed credit while the
  earlier action remains unresolved, unless a current explicit exception
  applies.
- AC-060.9: If neither the host nor the provider can link the result to this
  dispatch with a supported call/request identifier, the provider's observed
  state may be reported separately, but the invocation remains `uncertain`.

### FR-061 - Match a tool result to the correct tool call

A tool callback must not complete a different invocation just because the
tool name and arguments happen to look the same.

**Definition of Done**

- AC-061.1: Matching checks the session, tool, arguments, working directory,
  shell where relevant, and a host-provided call ID only if the host reliably
  supplies it from dispatch through result.
- AC-061.2: An ID generated only by the framework does not prove which host
  call returned. Identical retries and delayed callbacks remain uncertain when
  the host does not supply a trustworthy call ID.
- AC-061.3: A callback from another session, tool, arguments, directory, or
  proven call cannot complete the prepared action.
- AC-061.4: Duplicate callbacks for one proven call are harmless; a delayed
  result never completes a newer identical call.
- AC-061.5: Unsupported host payloads remain advisory and do not create
  managed success. Affected actions stay uncertain until independently
  reconciled.
- AC-061.6: No credentials, raw tokens, or unbounded provider output are
  recorded with tool-call evidence.

### FR-062 - Verify all arguments before trusting a tool adapter

A configured tool adapter cannot decide what happened from the tool name or a
few matching arguments while ignoring the rest.

**Definition of Done**

- AC-062.1: The adapter declares every permitted argument, required or
  optional, with its value/type rules. Undeclared arguments are not accepted
  for managed classification.
- AC-062.2: Missing **required** arguments, undeclared extra arguments,
  wrong types, ambiguously normalized values, or conflicting arguments remain
  unmanaged; omitting a declared optional argument is permitted. The advisory
  hook does not block the underlying tool.
- AC-062.3: Every accepted argument that can change the destination or action
  also changes the classified action and its tool-call identity.
- AC-062.4: If multiple adapters match but disagree, the conflict is visible;
  the first one is not selected silently.
- AC-062.5: Adapters cannot relabel an independently recognized Git action,
  framework command, destructive action, or external action as something safer.
- AC-062.6: Shell and structured-tool calls receive the same classification
  only when their verified arguments mean the same thing.

### FR-063 - Limit and verify polling evidence

Monitoring may record a short safe summary, a reference to separately stored
evidence, or both; it must not persist an unlimited provider response.

**Definition of Done**

- AC-063.1: A poll accepts a bounded, sanitized inline summary and/or a
  referenced evidence locator.
- AC-063.2: The complete stored record, including its on-disk formatting and
  reference metadata, is at most 4 KiB; each text field is at most 512
  characters. Nested raw payloads, credentials, headers, and executable content
  are rejected before persistence.
- AC-063.3: Evidence supporting managed credit has an SHA-256 digest or a
  hosting-service-proven immutable version and retrieval context. A mutable
  URL without content identity is diagnostic only.
- AC-063.4: Retrieved evidence is limited to 4 MiB and must match its
  recorded immutable identity. Inaccessible, changed, or mismatched content
  remains unverified.
- AC-063.5: Cleanup retains evidence needed by terminal executions,
  reconciled actions, PR/check associations, audits, notices, and recovery.
- AC-063.6: Tests cover limits at their exact boundaries, unsafe content,
  changed/inaccessible references, and cleanup with dependencies.

### FR-064 - Keep old history without turning it into new proof

New checks must not rewrite or silently upgrade previous work-item history.

**Definition of Done**

- AC-064.1: Older decisions, actions, runs, artifacts, PRs, audits, and test
  evidence remain readable without destructive migration.
- AC-064.2: Missing path, URL, call ID, action result, attempt, artifact, or
  PR/check identity is displayed as a specific evidence gap.
- AC-064.3: Incomplete old records may explain history but cannot, by
  themselves, establish current passing tests, PR readiness, review,
  deployment, or completion. New STAGING result decisions and test handoffs
  also recheck the current deployment's proof. Only fresh matching evidence
  can establish a new conclusion.
- AC-064.4: Mixed old and new audit history replays in the same deterministic
  order without duplicate credit.

### FR-065 - Show what is known and what still needs proof

The CLI must explain which repository, PR, execution, tool call, or artifact
was checked, and what read-only step can resolve an uncertainty.

**Definition of Done**

- AC-065.1: Status, resume, action detail, monitor detail, deterministic
  checks, and audit output show the verified local path/hosted URL and exact
  evidence gaps when relevant. Each gap suggests a safe read-only verification
  action or states that available observations cannot resolve it.
- AC-065.2: Test results remain exactly `Passed`, `Failed`, or `NotRun`.
  `Blocked` is a separate diagnostic, not a passing result or a fourth test
  status. Uncertain or unresolved external actions stay separate from tests.
- AC-065.3: A CLI status, resume, or check summary fits the existing 256 KiB
  working-set budget; excess detail is summarized with a detail command rather
  than silently dropped. No output exposes credentials, raw provider payloads,
  or full user prompts.
- AC-065.4: Documentation explains which facts come from hosting-service
  adapters and why observation never grants permission.
- AC-065.5: New or changed Requirements, Test Plan, Technical Design, code
  identifiers, CLI guidance, and service-adapter contracts use descriptive
  names for the local checkout, hosted repository, Git remote, PR, check, and
  run. They do not introduce numbered-phase labels or a substitute nickname
  for `{localRepositoryPath, remoteRepositoryURL}`; unavoidable technical
  terms are explained on first use.

## Validation and completion

- Design focused unit and integration tests for the normal, missing, wrong,
  stale, duplicate, concurrent, interrupted, and historical cases above.
- After each fix, run local unit tests first, followed by integration, full
  regression, and applicable Windows-native checks. Keep unrun tests `NotRun`.
- Obtain independent GPT-6 Astra xhigh reviews of Requirements, Test Design,
  Technical Design, and the tested code; fix blocking findings and repeat the
  affected review.
- After local tests pass, run the built-in GitHub Copilot CLI `/review` for
  the exact candidate. A change after review requires tests and review again.
- Commit the finished candidate locally with the required trailers; do not
  push. Passing local work or review grants no remote permission.

The later GitHub-specific adapters begin only after this provider-independent
work passes its tests and built-in review. They remain local-only and may use
read-only GitHub observations; neither phase performs a remote mutation.
