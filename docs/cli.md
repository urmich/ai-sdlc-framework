# Installation and CLI reference

## Install once for Copilot CLI

Requirements: Node.js 22 or later, Git, and a Copilot CLI supporting the documented
command hook `exec`/`args` format. The framework has no third-party runtime
dependencies.

Install from the public npm registry without a global package installation:

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@latest sdlc install
```

The same command syntax works in macOS/Linux shells, Windows PowerShell, and
Windows Command Prompt. A versioned GitHub Release `.tgz` remains available as
an offline fallback.

From a source checkout:

```sh
node bin/sdlc.mjs doctor
node bin/sdlc.mjs install --home "/path/to/isolated copilot home"
```

Omit `--home` to use `COPILOT_HOME`, or `~/.copilot` if that variable is unset.
For a real installation, choose the home used by your Copilot process. Restart
Copilot after install/update so its instructions, skills and hooks are reloaded.
The active process does not hot-reload replaced hook code. Version 1.2.2 makes
the gate advisory and recognizes direct literal maintenance commands outside
Git. If an already-running v1.2.0/v1.2.1 hook blocks its upgrade, run the same
maintenance command in a normal host terminal outside that Copilot session,
then restart Copilot.
Use `node "<copilot-home>/sdlc/bin/sdlc.mjs" doctor` to inspect the installation.
You may put its `bin` directory on PATH and invoke `sdlc.mjs` on POSIX systems;
`node` plus the quoted absolute entry path works across platforms. The npm
package bin name is `sdlc`; no global package installation is needed.

Focused engineering guidance is installed under
`<COPILOT_HOME>/sdlc/instructions/` as separate
`knowledge-retrieval.md`, `coding.md`, `testing.md`, `building.md`, and
`reviewing.md` files. Global instructions and phase skills load the guides
relevant to the active task; compatible repository-specific instructions take
precedence.

`update` is an alias for `install`, run from the new source checkout. The installed
CLI can also update with `--source-root /path/to/new/checkout`.
To let a different source/package entry invoke maintenance from inside Copilot,
first bind that exact root to the current captured user request:

```json
{
  "sessionId": "current-session",
  "receiptId": "receipt-from-the-user-request",
  "input": "The complete matching user request",
  "sourceRoot": "/literal/path/to/ai-sdlc-framework"
}
```

Pass this object to
`node "<installed-entry>" maintenance select`. The selection validates package
identity and exact receipt content and records only the canonical root. An
unrelated receipt or self-declared package is not trusted maintenance.
`uninstall` removes unchanged owned files and the exact instructions block only.
Modified/unowned files are preserved and reported. Runtime state is **always
retained** during uninstall; back it up if recovery-critical work is active.
Install/update preflight every destination, use hashes and an ownership manifest,
and roll back exact unchanged writes on failure. They never delete a directory.
Paths with spaces are passed through argument arrays, not shell interpolation.

`install --purge-existing` is the user-facing irreversible clean-migration
mode. Invoke it from the new npm or extracted package while Copilot is closed.
It verifies that the package source is outside `COPILOT_HOME`, removes modified
framework-owned content and all runtime state through the explicit purge
primitive, then installs the new distribution in one operation. Unrelated
Copilot files are preserved. `uninstall --purge` remains available as the
lower-level explicit purge operation, and repeated purge is safe.

## Build and verify the installable package

The repository CI/CD process is separate from the package name. From the source
checkout, build and verify the standard project/version distribution with:

```sh
npm run package:artifact
npm run verify:package
```

The build creates only `dist/ai-sdlc-framework-<version>.tgz`. Packaging is
repeated and must produce the same SHA-256 digest. Version-tag CI prepares a
validated candidate but never publishes automatically. The separately approved
release handoffs retain those exact bytes. npm publication uses the protected,
data-only reusable workflow on GitHub-hosted Node 24/npm >=11.15, without an npm
token; public trusted publishing provides automatic provenance. Configure npm
trust for actual caller `release.yml`, repository `urmich/ai-sdlc-framework`, and
environment `npm`, not for the reusable `npm-publish.yml` filename. See the
[release handoff guide](release-ci.md). Verification rebuilds the expected package from the same source, compares
digest, identity, sizes, and complete file inventory, then installs the
local archive into an isolated npm prefix, then
exercises install, doctor, idempotent update, and uninstall against an isolated
Copilot home whose path contains spaces. It preserves pre-existing instructions
and seeded runtime state. A custom `--output-dir` must be empty or contain only
the exact owned archive; packaging never recursively clears
an arbitrary directory. It never targets the user's real Copilot home.

`doctor` is read-only and reports platform/architecture, detected shell
availability, path/filesystem contracts, adapter contracts, installation hashes,
and capability gaps. It does not claim to have verified the running Copilot
version, native Windows behavior from a macOS or simulated test, MCP access, or
a host scheduler.
Hook fields follow the [GitHub hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference).
Copilot command `preToolUse` hooks normally fail closed on crashes or nonzero
exits, so the framework launcher dynamically loads its runtime inside a
fail-open boundary. Gate/bootstrap/input/state errors return an empty final
decision and exit zero without repeated user-facing warnings. Timeouts also
fall through to normal permissions.
Hooks and writable local files are not a security boundary.

## Command conventions

The package bin is `sdlc`; examples may use `node /absolute/path/bin/sdlc.mjs`.
Output is JSON by default. `--human` emits a concise readable view; `--json`
explicitly requests JSON. Mutations of framework state take one JSON object on stdin or through
`--input-file FILE`; use the latter when a shell pipe would be an unsupported
managed form. Invalid state input can be rejected to preserve ledger truth, but
that does not authorize the pre-tool hook to block an underlying user-requested
external action. Inputs are bounded at 1 MiB, and records reject obvious
credential patterns. Never submit raw provider logs or secrets as evidence.

Common options:

| Option | Meaning |
| --- | --- |
| `--home PATH` | Override `COPILOT_HOME` for this command |
| `--cwd PATH` | Repository/worktree context, default current directory |
| `--work-item ID` | Explicit logical work item |
| `--session ID` | Runtime session ID, or `SDLC_SESSION_ID` |
| `--repository ID` | Logical member repository |
| `--input-file PATH` | Structured input instead of stdin |
| `--token TOKEN` | Current token for `context ack` |
| `--operation ID` | Prepared operation for `op mark-dispatching` |
| `--commit FULL_SHA` | Reachable commit for `audit record` |

In JSON commands, the equivalent context fields are `workItemId`, `sessionId`,
`repositoryId` and (where relevant) `cwd`. Do not reuse a session identifier
between independent sessions.

### Identity, artifacts and recovery

Create/select the Git repository and a feature branch/worktree using authorized
Git tools **before** `init`. The CLI uses read-only Git queries and will not
create a repository, commit, publish, reset, or overwrite existing work.

```json
{"workItemId":"wi-example","repositoryId":"primary","sessionId":"session-1","cwd":"/project"}
```

- `init` / `create`: write the portable coordinator manifest and runtime binding.
  Always starts at Requirements.
- `adopt` / `init --adopt`: register known work and the current commit as
  `historyStartsAt` (or supply a full commit ID). This does **not** import approval
  from document labels or authorize Coding. Supply original captured evidence
  or obtain explicit current confirmation.
- `member bind`: same identity fields. Adds a secondary member or a new session.
  `replace:true` explicitly relocates a logical member only when the branch is
  unchanged and outstanding operations are settled. Different branches require
  distinct work items; multiple plausible bindings block rather than select one.

  A Copilot session may start in a non-Git parent workspace. Safe shell and
  PowerShell and Command Prompt reads/navigation remain available, and after the
  development request receipt is captured the gate permits supported
  `git clone`, `git init`,
  `git switch`, and `git worktree` bootstrap commands. Run `sdlc init --cwd` with
  the actual repository path. Later commands may resolve that explicit
  session-bound child repository even if the outer session root remains non-Git;
  another Git repository never inherits the binding.
  Fallback occurs only for Git's confirmed `not a git repository` result.
  Ownership, corruption, bare-repository, and metadata-directory failures remain
  errors, including a present but invalid `.git` file/directory in the cwd or an
  ancestor. Internal Git diagnostics use the stable `C` locale. PowerShell `--%`
  stop-parsing, `%NAME%` expansion, and typographic quotes/Unicode whitespace
  require an explicit adapter and are not treated as literal read-only commands.
  Embedded double quotes remaining in parsed arguments are also rejected because
  Legacy native argument passing can remove them. Post-quote argument adjacency
  and parsed/assembled `--%` or `%...%` tokens are ambiguous and rejected. No configured shell action, including read or
  bookkeeping, can use child-repository configuration while still executing in
  the outer workspace; use the bound repository as the per-command cwd or an
  explicit validated Git `-C` path.
  Before binding, clone/init deliberately reject `git -C`, unsupported options,
  option-looking destinations, tilde/glob expansion anywhere in Bash input, and
  any canonical destination outside the non-Git workspace. Use a simple HTTPS
  clone with an explicit child folder, or init the current/one child folder, then
  bind it.
  Before binding, switch permits only a literal branch or `-c`/`--create`;
  worktree permits only non-destructive `worktree add` forms. Force/discard,
  remove/move/repair/prune and other destructive operations require normal bound
  classification. Branch operands cannot look like options. The `-C` repository
  must be inside the outer workspace, and relative worktree targets resolve from
  that repository before containment checks. Verified framework commands such as
  `artifact`, `op`, `cycle`,
  `evidence`, and `handoff` remain callable from the outer workspace because they
  validate their explicit work-item and `--cwd` inputs internally.
  Raw `git -C` path validation also applies after binding. Managed Git commands
  reject inherited `GIT_DIR`/`GIT_WORK_TREE` redirection, and bootstrap checks the
  effective worktree reported by Git before branch/worktree setup.
  Command Prompt uses a separate literal tokenizer. `%...%`, delayed `!...!`,
  caret escaping, chaining, redirection, grouping, embedded quote forms, and
  nested `cmd /c` are untrusted for managed classification unless the exact
  form is owned by a compatible adapter. cmd-on-UNC is currently unavailable
  because a safe mapping/cleanup
  contract has not been verified; use PowerShell or a direct argument-array
  tool instead. The hook falls through without managed credit rather than
  claiming cmd retained the requested cwd.
- `artifact register`: `{workItemId,role,repositoryId,artifactId?,path}`. Roles:
  `requirements`, `test-plan`, `technical-design`. Register exact files, not
  directories. `artifactId` is a stable logical document ID; omitting it targets
  the backward-compatible `default` document. Each repository may register
  multiple named documents of every role. Re-registering the same
  role/repository/artifact ID replaces only that document.
  For a new repository document, first call with `planned:true`;
  this records only that exact phase-appropriate path with digest `pending`.
  Create the file, then call again without `planned` to finalize its digest.
  Protected `.git`/`.sdlc` paths are rejected, duplicate paths across artifact
  IDs/roles in one repository are rejected, and a pending Test Plan remains
  orientable without reading missing content. Approval snapshots reject pending
  locators. For an authorized external file, use `externalPath` and
  `authorizationId` referencing a captured `permission` event with grant
  `artifact-location` and the exact target path. Absolute local paths remain in
  runtime records, not the portable manifest. External artifacts also use
  `repositoryId` plus optional `artifactId`.
- `resume`: reconstruct local effective events and reachable Git audits, detect
  changed candidate content/specification, expose uncertain operations, and
  return artifact locators and an orientation token.
- `context ack`: `{token}` plus session/work-item context. Accepted only after
  `resume` in this session and only while all relevant generations still match.
- `status`: current phase/cycle/tests, current candidate Review, grants,
  conflicts, PRs, operations and the exact next decision/action. This is not a
  completion approval.
- `prune`: archive supported terminal operation evidence, superseded
  current-cycle evidence, audited inactive authority and resolved blockers;
  retain uncertain/in-progress operations and active dependencies.

Default branch identity comes from the symbolic remote HEAD or explicit
repository policy `defaultBranch`; the framework does not guess `main`.
A local-only repository remains usable with an explicit base-branch policy
or scoped user workflow override.

### Decisions and receipts

The installed `userPromptSubmitted` and supported `ask_user` post-tool adapter
capture metadata and hashes of actual input. They do not store the conversation.
Use `receipt latest` to retrieve this session's latest captured receipt ID.
`receipt capture` is the source-adapter interface:
`{sessionId,source,input,timestamp?}` with source `userPromptSubmitted` or
`ask_user`. It is **not** permission for an agent to manufacture a user message.
The managed evaluator denies credit to agent-authored receipt-capture shell
commands, while the public advisory hook falls through without vetoing the
tool; input hooks call the capture adapter directly. Initialization requires a captured
request in the current session (latest by default, or explicit `receiptId`).
Free-form `evidence:"approved"`, document approval labels, arbitrary transcript
imports and mismatched input are rejected.

`decision prepare` takes `{workItemId,sessionId,kind,effect,id?}` and returns a
stable ID. Approvals retain immutable snapshots of all artifacts due at the
transition. Prepare before asking the user. `decision apply` takes:

```json
{
  "workItemId":"wi-example",
  "sessionId":"session-1",
  "decisionId":"decision-ID-returned-by-prepare",
  "receiptId":"receipt-ID-captured-by-hook",
  "input":"The complete actual user response, matching its captured hash"
}
```

An unsolicited explicit non-phase decision may instead supply `kind` and
`effect`; its ID is deterministically derived from the receipt/work/scope.
Reapplying an identical event is a no-op; conflicting ID reuse is rejected.
An event is durable **before** its checkpoint projection permits dependent work.
One reply can combine stage completion and next environment authority.

| Kind | Required effect |
| --- | --- |
| `approval` | `transition:{from,to}` for the next adjacent phase |
| `override` | `rules:[rule-ID]`, `reason`; optional explicit `transition` |
| `stage-completion` | Cycle binding below and `completedStage`: `local`, `review`, `DEV`, or `STAGING`; environment completion also identifies the current deploymentId |
| `out-of-scope-execution` | `itemId` |
| `out-of-scope-documentation` | `itemId` independently of execution |
| `scope-inclusion` | `itemId`; only this changes the scope classification |
| `permission` | `grant`: push, merge, auto-merge, policy-bypass, prod-execution, artifact-location; push additionally binds target, remoteUrlDigest, sourceRef, targetRef, optional sourceRevision, and explicit force/delete booleans |
| `pr-publication` | repositoryId, sourceRef, targetRef, draft boolean |
| `review-result` | Cycle binding, status (`Passed`, `ChangesRequired`, or `Blocked`), `/review` evidence reference, summary, blocking findings; `Passed` also records `completedStage:review` |
| `dev-authorization` | Cycle binding, target; Review must be current and completed; the same captured response may apply both `review-result` and DEV authorization |
| `staging-promotion` | Cycle binding, target; optional completedStage `DEV` with the current DEV deploymentId |
| `staging-result` | Cycle binding, target, deploymentId, artifactId, `testIds`, outcome (NotRun/Passed/Failed), actual owner, host/location, and evidenceRef; this records test evidence, not STAGING completion |
| `revocation` | `revokes:[event-ID]` |
| `work-completion` | lifecycleStatus: active, paused or completed |

Cycle binding means `cycleId`, `candidateDigest`, `testSpecDigest`, `configDigest`.
Use the values in the current cycle; source/config/spec changes invalidate old
candidate-specific consent. Every effect may include `scope` with repositoryIds,
paths, actions, itemId, operationId, environment, target, owner, or host. Scope values must
match exactly. Default lifetime is the identified work item; explicit
`lifetime:{kind:"cycle",cycleId}`, `{kind:"until",expiresAt}` or `{kind:"once"}`
narrows it. Once-only grants reserve a single operation ID under the work lock.
Revocation stops new grants, not an already dispatched remote effect.
Legacy schema-version-1 push permissions remain readable during load and audit
replay, but are insufficient for new publication until a destination-bound
permission is captured.

### Local validation and environment records

`cycle start` takes `{workItemId,configDigest,cause}` and derives every in-scope
test from the canonical Test Plan. An optional `tests` array is accepted only
when it exactly matches the complete canonical definitions; callers cannot omit
or redefine required tests. Each required test has this execution shape:

```json
{"id":"T-01","environment":"local","level":"unit","checkpoint":"pre-review","mode":"automated",
 "owner":"agent","location":"local","implementation":"test/unit.mjs",
 "expected":"All required assertions pass"}
```

Use environment `local`, `DEV` or `STAGING`; mode `automated`, `semi-automated` or
`manual`; checkpoint is `pre-review`, `review`, `post-review`, `DEV`, or `STAGING`.
Only the complete `pre-review` set gates `/review`. STAGING owner/location must
match the configured execution contract or an exact current-cycle
`staging-execution-contract` fallback. Test IDs must
exist in the canonical Test Plan. The candidate uses actual member revisions and effective Git file identities:
index blob IDs overlaid by dirty/untracked blob IDs and modes, excluding
registered documents and workflow metadata. Staging unchanged content does not
change the candidate. The test-spec digest preserves canonical definitions and specification-bearing
Markdown procedures/assertions while excluding only named mutable
status/activity/evidence metadata. The same candidate/spec/config does not reset a cycle.
Changed source/test/config creates a new unit-first cycle; no network work occurs.
It also invalidates prior candidate Review.

`evidence test` takes `{workItemId,cycleId,testId,status}` plus conclusive-result
fields `evidenceRef,expectedMet,owner,host`; optional
`artifactId,deploymentId,runId,activity`. DEV evidence requires the current
successful deployment ID/artifact and DEV authority.
STAGING evidence from an agent/provider/external prepared operation supplies
its terminal `operationId`. Receipt-reported evidence supplies `eventId` of the
matching `staging-result`; both paths require exact deployment, artifact,
owner, and host identity.
Evidence persists first, then visible plan statuses synchronize. A synchronization
failure keeps pending state for recovery instead of erasing the result.
A latest deployment-bound STAGING failure is displayed as `Failed` immediately and
supersedes an earlier pass; evidence for a superseded deployment is not current.

### Candidate Review through Copilot CLI `/review`

Candidate Review execution is not an `sdlc` subcommand or an installed framework
review skill. After required local tests pass, the framework presents GitHub
Copilot CLI's built-in interactive `/review` command as the next action. The user
invokes `/review`; the framework consumes the built-in code review agent's result.
Deterministic `sdlc check` findings remain complementary structural evidence.

The normalized result is applied as a receipt-bound `review-result` decision:

```json
{
  "workItemId":"wi-example",
  "sessionId":"session-1",
  "receiptId":"receipt-user-confirmation",
  "input":"The complete captured user confirmation of the review result",
  "kind":"review-result",
  "effect":{
    "cycleId":"cycle-current",
    "candidateDigest":"candidate-sha256",
    "testSpecDigest":"test-spec-sha256",
    "configDigest":"configuration-revision",
    "status":"Passed",
    "evidenceRef":"copilot-cli:/review/session-reference",
    "summary":"No blocking findings",
    "blockingFindings":[],
    "completedStage":"review"
  }
}
```

The effect is submitted through `decision apply` with the captured complete user
input and receipt. Status is `Passed`, `ChangesRequired`, or `Blocked`. Evidence
is accepted only for the current candidate, test specification, and
configuration after local tests pass. A blocking result returns work to Coding
and cannot become `Passed` on the unchanged cycle without an explicit scoped
override. Any subsequent
implementation/test/configuration change starts a new cycle and invalidates the
Review. An unchanged candidate reuses its current Review.

The passing receipt-bound result is the explicit Review-completion confirmation.
The same user response may authorize the implementation push, PR
publication/update, or DEV action. An explicitly authorized `earlyDraft` action
can precede candidate Review only when its actual source-vs-target Git diff
contains registered documents/framework manifest files and no implementation
content.
The Review event projects the canonical built-in `/review` checkpoint; other
Review/post-Review tests keep independent evidence and block completion when
pending or failed.

`evidence artifact` takes `{workItemId,cycleId,artifactId,environment,sourceDigest,
configDigest,buildRunId,name,artifactType,evidenceRef,status:"succeeded"}`.
Provider metadata must establish that the artifact is actually available and
matches the selected candidate. Artifact discovery is observation, not consent.
`handoff staging` returns actual deployment/candidate/test details plus the
effective STAGING owner/location and owner-specific execution guidance.

### Exact external operations

The agent, not the local CLI, invokes authorized providers:

1. `op prepare`: `{workItemId,sessionId,operationId?,action,request,
   correlationKey,intent}`. Request is exact `{toolName,toolArgs,cwd}`.
2. `op mark-dispatching --operation ID` **before** the provider call.
3. The evaluator binds one matching managed call. A second call cannot consume
   it. A user-directed call can still execute without this binding, but remains
   unmanaged and cannot reuse the prepared operation as evidence.
4. `op record`: `{workItemId,operationId,status,handle?,evidenceRef?,target?,
   requestFingerprint?,expectedMet?,providerStatus?}`.
5. `op reconcile` uses the same result shape after a **read-only** provider query.

`op show --operation ID` retrieves the exact recovery metadata without dispatch.
An `uncertain-retry` override may authorize a distinct replacement operation ID
while the earlier operation remains visibly uncertain. It never erases that risk.

States: prepared → dispatching → submitted/running → succeeded/failed/cancelled.
Missing handles, post-dispatch failures and lost responses are uncertain, never
safe automatic retries. `not-started` needs a prepared operation, evidence and
`dispatchAttempted:false`. Terminal outcomes need exact target/fingerprint and
supporting evidence. Provider failure needs `providerStatus`; a failed tool call
alone does not prove failure of the remote effect.

Copilot hook payloads currently lack an attempt identifier for distinguishing
delayed callbacks from identical retries. The post-tool hook therefore does not
auto-attach returned run IDs to managed operations; it marks the dispatch
uncertain and requires explicit provider-read reconciliation through
`op reconcile`/`op record`.

Action fields include class, repositoryId, environment, target, configDigest,
stages, monitorCapability, artifactId, testId, owner/host, sourceRef/targetRef/draft,
PR source/target revisions, policyVersion, prRecordId, outOfScope/itemId,
implicitEnvironments, externalPermission, preservesChanges, remoteUrlDigest,
force and delete. Supported classes
are listed in `src/policy.mjs`. The strict evaluator marks unknown executable
forms as unsupported.
The public hook marks them unmanaged internally and leaves execution to normal
Copilot and host permissions without a framework veto.
Normal implementation publication and remote environment operations in any
phase additionally require current passing pre-Review evidence and an active,
unrevoked/unexpired Review result. The narrow early-draft exception is explicit.
For `git push`, action identity includes the actual remote, push-URL digest,
bound source branch/revision, destination branch, and force/delete flags.
Force/delete require separate scoped overrides.
The supported managed push has exactly one configured remote, one resolved push
URL and one explicit full branch refspec
`refs/heads/source:refs/heads/destination`; implicit Git destination mapping,
multiple destinations or tag/other namespaces are unsupported for managed use.
Those forms are unsupported for managed publication credit; explicit user
execution still falls through and must be reported as unmanaged.
An `earlyDraft:true` push/PR action also requires `draft:true`, full immutable
source/target commit IDs, and the exact document-only paths; preparation and the
gate re-derive the Git diff from those commits rather than substituting a
same-named local branch.

### PR records

- `pr prepare`: provider, connection, repositoryId, sourceRef, targetRef,
  sourceRevision, targetRevision, remoteSourceRevision, draft, and `matches`
  containing actual provider search facts (empty if no appropriate PR exists).
  Reuses one appropriate match, blocks ambiguity, and returns publication intent.
  Publication decisions retain their normal scope/lifetime semantics; once-only
  authority cannot be reused by a second PR operation.
- `pr create-result`: `{workItemId,pr,intentId,operationId}` after a recorded create.
- `pr adopt`: `{workItemId,pr}` observes an existing PR without fabricating authority.
- PR object: provider, connection, repositoryId, sourceRef, targetRef,
  sourceRevision, targetRevision, draft, prId, url, state, evidenceRef; optional
  autoMerge, scope, mergeRevision. State is active/merged/closed.
- `pr update`: `{workItemId,prRecordId,policyVersion,sourceRevision,targetRevision,
  requiredChecks,checks,providerEvidenceRef,reviewsSatisfied?,merged?,
  mergeContext?,runMonitorRefs?}`. Each pipeline-backed check identifies id, status
  (succeeded/failed/pending/cancelled/missing), sourceRevision/targetRevision or
  mergeRevision, evidenceRef, the complete normalized execution `identity`, and
  its derived runKey. Supplied monitor references are accepted only when they
  resolve to that exact verified monitor; stored references are derived from the
  exact immutable association for that check, not merely another check sharing
  the same run. A mergeContext
  supplies sourceRevision, targetRevision, mergeRevision and provider evidenceRef.
- `pr evaluate`: `{workItemId,environment,prRecordId?,sourceRevision?,
  targetRevision?,policyVersion?,policy?,requireArtifact?,artifactId?}`.
  Policy contains required/validation/reviews/merge booleans. PROD always requires
  current successful PR validation; DEV/STAGING apply configured prerequisites.
  Provider `reviews` are separate from framework candidate Review via `/review`.
  Facts older than one minute require a fresh provider read before dependent work.

Readiness is not authority to publish, merge or deploy, and CI success is not an
artifact. PR validation itself has no circular prior-validation prerequisite.

### Pipeline monitoring (offline scheduler ledger)

`monitor attach` takes the normalized execution `identity`, origin
(`framework`/`user-reported`), schedulerAvailable/readAvailable booleans, optional
workItemId/cycleId/candidateDigest/environment, and reportingReceiptId for reports.
Identity contains provider, connection, scopeRef, optional definitionRef,
executionRef, and optional attemptRef.
For a PR check, also provide prRecordId, checkId, sourceRevision, and targetRevision;
these bind readiness to the actual PR/candidate rather than an unrelated run.
`associationEvidenceRef` identifies the provider evidence for that relationship.
No queue operation is performed.
Capability values must be literal JSON booleans; truthy strings are rejected.

- `associate`: `{runKey,workItemId,prRecordId,checkId,sourceRevision,
  targetRevision,evidenceRef}`. Creates an immutable, conflict-checked PR/check
  association for a run that was attached earlier without that context. It never
  rewrites the monitor's original trigger origin.
- `refresh-capabilities`: `{runKey,schedulerAvailable,readAvailable,evidenceRef}`.
  Explicitly refreshes verified scheduler/read availability, invalidates stale
  worker ownership, and returns a nonterminal run to pending or blocked state.
  Reattaching a run does not silently upgrade capabilities.
- `claim`: `{runKey,workerId,replaceInterrupted?}` → claimGeneration.
- `begin-poll`: `{runKey,workerId,claimGeneration}`. Immediate first poll, at most
  one in flight. A real non-null claimed worker and available scheduler/read
  capabilities are required. Subsequent due times are anchored 60 seconds apart.
- `observe`: claim fields plus the complete execution identity and
  status/evidenceRef or error.
  Status: queued/running/waiting-approval/succeeded/failed/cancelled.
- `link`: `{runKey,adapterId,observation,evidenceRef}`. The registered provider
  adapter derives identity and the canonical URL from provider-native
  observation data. Every normalized identity field must match the monitor.
  Accessibility alone never verifies a link.
- `notice`: `{runKey,deliveredRef?,noticeGeneration?}`. Render the
  origin-aware notice. Delivery acknowledgement must include the generation
  that was actually shown, so an older running notice cannot acknowledge an
  unseen terminal notice.
- `interrupt`: `{runKey,reason}`. Disclose stopped host/access; replace claims
  explicitly rather than letting old callbacks mutate the new worker's state.
- `due`: read-only due-run list, with detectable gaps.
- `prune`: `{runKey}` archives a terminal monitor only after its completion notice
  was delivered; active or uncertain monitoring is retained.

See [Provider adapter extension guide](provider-adapters.md) for the normalized
identity contract, the built-in Azure DevOps observation shape, and requirements
for adding another provider.

Use a recurring task in the actual agent host and its configured authorized
provider tools. This CLI neither starts a timer nor inherits MCP access. A
missing scheduler/read capability is blocked, never labeled active. Link errors
do not stop available API status polling. Terminal notification remains durable.

### Configuration and conflicts

Optional `.sdlc/config.json`:

```json
{
  "schemaVersion":1,
  "defaultBranch":"refs/heads/resolved-default",
  "commands":[
    {"command":"npm test","action":{"class":"test","environment":"local",
      "testId":"T-01","owner":"agent","host":"local"}}
  ],
  "environments":{
    "DEV":{"target":"resolved-dev-target","configDigest":"resolved-config-revision",
      "allowedStages":["pre-production"],"pr":{"required":false,"validation":false}},
    "STAGING":{"target":"resolved-staging-target",
      "configDigest":"resolved-config-revision",
      "allowedStages":["staging-deploy"],
      "execution":{"owner":"user","locations":["secured-runner"]}}
  },
  "environmentMappings":[
    {"provider":"ci-provider","pipeline":"application-delivery",
      "label":"pre-production","environment":"DEV",
      "target":"resolved-dev-target",
      "configDigest":"resolved-config-revision"}
  ],
  "toolAdapters":[
    {"toolName":"provider_exact_read_tool","match":{"action":"get"},
      "action":{"class":"read"}}
  ]
}
```

Commands match the **entire** command string, not a prefix. Tool adapters match
the exact tool and declared selector fields. Configure them from verified provider
schemas, not guessed tool names. Never label a DEV contact as local/read or omit
implicit deployment stages. Deployment-capable actions must identify exactly one
canonical DEV/STAGING/PROD environment. Provider-specific labels require an
exact repository/provider/pipeline/target/configuration mapping; unresolved or
conflicting labels remain unmanaged. Pipeline stages are separately checked
against the resolved environment's `allowedStages`. Compatible local
instructions take precedence; the agent surfaces semantic conflicts.
STAGING execution owner is `user`, `agent`, `provider`, or `external-system`;
locations are nonempty provider-defined identifiers. Missing policy is
unresolved. A different owner/location requires an updated contract or an exact
cycle-scoped `staging-execution-contract` override.

`conflict add`: `{workItemId,id?,reason,scope?,references}` referencing both
opposing rules. `conflict resolve`: `{workItemId,conflictId,eventId}` for the exact
scoped override, or `correctionRef` for a verifiable actual configuration correction.
Correction references use `repository:path@sha256:<current-content-digest>`.
Unrelated operations may proceed; an override of one rule does not waive others.

### Audit and conformance

`audit format` with optional eventIds emits complete SDLC-Work-Item, SDLC-Event
(base64url canonical sanitized event) and SDLC-Applied trailers. Commit through
the agent's authorized Git tool with a meaningful subject/body.
`audit record` verifies a full reachable commit ID and exact trailers.
`audit replay` deduplicates member copies, detects digest/sequence conflicts and
restores only recorded authority. Same-commit events are valid. Git cannot prove
when code was written or recover unaudited local records that were lost.

`check artifacts|state|history|evidence|all` emits all findings:

| Verdict | Exit contribution |
| --- | --- |
| satisfied / not-applicable / authorized-deviation | 0 |
| violation | 2 |
| unverified | 3 |
| error | 4 |

Aggregate precedence: error, violation, unverified, authorized-deviation,
satisfied/not-applicable. Unknown required evidence never returns success.
Plain external references remain declarations until actual provider evidence is
supplied/rechecked; fixture tests do not certify live access. Markdown artifact
checks use stable FR/AC headings and the documented test table (JSON test
documents are also accepted). Semantic DoD quality and completeness of broad
coverage claims require human/agent review.

## Storage, limits and recovery boundaries

Portable manifest: coordinator `.sdlc/work-items/<id>.json`.
Machine-local data: `<COPILOT_HOME>/sdlc/runtime/{registry.json,sessions,
work-items,pipeline-monitors}`. Per-work-item records are separate from the
16-KiB checkpoint; snapshot-bearing decisions/events have 64-KiB limits while
operations and ordinary records have 4-KiB
limits. Validation-cycle records use the 256-KiB active-record budget rather
than the 16-KiB checkpoint limit.
There are at most 20 unresolved operations and 20 open blockers. Orientation
summary is limited to 1.5 KiB. Immutable document snapshots and archived execution
evidence are outside active context. Limits fail explicitly, never truncate.

Locks use exclusive creation, host/PID/token ownership and bounded waits. Age
alone never makes a lock reclaimable. Unverifiable ownership requires explicit
recovery. Lock order is registry → work item → session. Writes use unique
same-directory temporary files, file flush, atomic replacement and directory
flush where supported. Unusual/network filesystem and power-loss guarantees
are not inferred from ordinary process-crash tests.

The supported managed path is deterministic, not tamper-proof. Unregistered tool
forms, real provider policies, host scheduling, external artifact retrieval and
cross-platform integration must be verified where used. The framework will not
invent that evidence or silently change targets to obtain a pass.
