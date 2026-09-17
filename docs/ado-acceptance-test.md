# Azure DevOps developer acceptance test

Use this runbook before handing a new AI SDLC Framework release to a developer
who works with Azure DevOps. It assumes an older private framework generation
may already be installed.

The test must not create an Azure DevOps repository, push a branch, create a PR,
queue a pipeline, change repository settings, or mutate any remote resource.
Use an existing authorized repository for read-only discovery and a disposable
local clone or worktree for local behavior checks.

## Copilot agent prompt

The clean migration cannot execute inside the Copilot process whose old hooks
are being removed. First close **all** Copilot CLI processes and run this in a
normal external terminal:

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@0.3.0 sdlc install --purge-existing
```

Then start a fresh Copilot CLI process and copy the following prompt:

```text
Run the AI SDLC Framework Azure DevOps acceptance test exactly as documented
below. Do not create an Azure DevOps repository and do not perform any remote
mutation. Do not push, create or update a PR, queue a pipeline, change a work
item, or modify provider configuration. Use only an existing repository that I
select for read-only Azure DevOps discovery. Use a disposable local clone or
worktree for local mutation tests.

Record every Test Plan checkpoint as Passed, Failed, or NotRun with the exact
command/evidence. Record unavailable access separately as a Blocked diagnostic;
a blocked, inconclusive checkpoint remains NotRun. Do not convert unavailable
access into a pass.

1. Confirm Node.js 22 or later, npm, Git, and GitHub Copilot CLI are available.
2. Confirm that the external-terminal clean migration was completed with every
   prior Copilot process closed. Do not attempt to purge the framework from this
   active session.
3. Run the installed entry directly so this step does not depend on registry
   access:

   node "<COPILOT_HOME>/sdlc/bin/sdlc.mjs" doctor --home "<COPILOT_HOME>"

   Require installed=true and an empty findings array.
4. Verify this is the restarted Copilot CLI process and explain that hooks and
   instructions were loaded at process startup.
5. Verify the installed package reports version 0.3.0 and that the lifecycle
   intent, five lifecycle skills, focused engineering instructions, hooks,
   provider adapter guide, and ownership manifest exist without unresolved
   template placeholders.
6. In a disposable local clone/worktree of the existing repository, submit:

   "Implement a small safe change, test it, and create a PR. Go."

   Verify the framework begins useful Requirements discovery and does not treat
   implementation, urgency, or the PR goal as a stage override. Stop before any
   remote operation.
7. Submit:

   "Skip Requirements and Test Design for this local-only acceptance change;
   implement it directly and do not push."

   Verify one concise consequence warning, immediate compliance, and truthful
   unmanaged/incomplete lifecycle state without repeated resistance.
8. Exercise installed userPromptSubmitted, preToolUse, postToolUse,
   postToolUseFailure, preCompact, agentStop, and sessionEnd hooks using normal
   Copilot CLI activity. Verify framework errors and unmanaged actions fall
   through without making Copilot unusable.
9. Against the existing Azure DevOps repository, perform read-only discovery:
    resolve its remote, repository identity, default branch, configured project
    scope, available pipeline definitions, and one existing pipeline run if
    access permits. Do not infer missing provider fields.
10. For an existing run, verify the Azure DevOps adapter derives project,
    repository, definition, build ID, and provider web URL from authorized build
    metadata. A URL for another project, build, host, or non-build page must
    remain unverified. Do not queue a run.
11. Run update from the same package source selected for installation and verify
    it is idempotent and doctor remains clean. If npm is available, use the
    pinned npx command. If the corporate proxy is quarantining the package, use
    the retained extracted GitHub Release package entry outside `COPILOT_HOME`.
12. Run ordinary uninstall through the installed entry:

    node "<COPILOT_HOME>/sdlc/bin/sdlc.mjs" uninstall --home "<COPILOT_HOME>"

    Verify unrelated Copilot content and framework runtime recovery state are
    preserved.
13. Close Copilot CLI, reinstall from an external terminal with the same
    selected npm or retained extracted-package source, restart Copilot, verify doctor again, and leave the
    framework installed for subsequent testing unless I instruct otherwise.
14. Return a table containing checkpoint, platform/shell, status, evidence, and
    blocker. Clearly separate native Windows evidence from simulated or
    non-Windows results.
```

## Direct installation commands

The npm command below is identical on macOS/Linux, Windows PowerShell, and
Windows Command Prompt:

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@0.3.0 sdlc install --purge-existing
```

On a Microsoft-managed machine, direct npmjs access may be blocked. First try
the same package through the configured corporate npm proxy by omitting the
explicit `--registry` option. If the proxy has not yet mirrored the package,
record the Test Plan checkpoint as `NotRun` with a separate `Blocked`
diagnostic; do not call it an installation failure.
New public package versions may remain in Microsoft CFS quarantine for seven
days. Use the approved internal quarantine-exception process for urgent access;
do not bypass the corporate proxy on a managed device.

As a temporary authenticated fallback for repository collaborators, download
the verified release archive:

```sh
gh release download v0.3.0 --repo urmich/ai-sdlc-framework --pattern "ai-sdlc-framework-0.3.0.tgz"
```

Extract it with npm into a directory outside `COPILOT_HOME`, then run its
`bin/sdlc.mjs install --purge-existing` entry as documented in README. This
fallback validates the package but does not prove corporate npm-proxy
availability. Retain that extracted package directory for update and clean
reinstall checkpoints; doctor and ordinary uninstall use the installed entry.

Then restart Copilot CLI and run:

```sh
node "<COPILOT_HOME>/sdlc/bin/sdlc.mjs" doctor --home "<COPILOT_HOME>"
```

Expected result:

```json
{
  "installed": true,
  "frameworkVersion": "0.3.0",
  "findings": []
}
```

## Result template

| Checkpoint | Platform / shell | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- |
| Clean migration |  | NotRun |  |  |
| Doctor |  | NotRun |  |  |
| Restart and installed assets |  | NotRun |  |  |
| Normal lifecycle activation |  | NotRun |  |  |
| Explicit stage override |  | NotRun |  |  |
| Hook behavior |  | NotRun |  |  |
| Azure DevOps read discovery |  | NotRun |  |  |
| Azure DevOps run-link identity |  | NotRun |  |  |
| Idempotent update |  | NotRun |  |  |
| Ordinary uninstall |  | NotRun |  |  |
| Clean reinstall |  | NotRun |  |  |

The acceptance result is successful only when installation, doctor, restart,
guidance, hooks, update, uninstall, and clean reinstall pass. Azure DevOps
discovery may have a `Blocked` diagnostic only for a real access/capability
limitation; its Test Plan status remains `NotRun` and must never be reported as
passing without evidence.
