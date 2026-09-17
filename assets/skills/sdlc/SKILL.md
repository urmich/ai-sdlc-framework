---
name: sdlc
description: Orchestrate any development request, recover existing work, or monitor a user-reported pipeline without granting deployment authority.
---

Read `{{LIFECYCLE_INTENT_INSTRUCTIONS}}` before classifying a development
request or possible lifecycle-stage override. Apply that shared contract rather
than inventing a skill-specific shortcut.

1. Classify intent: development, information-only, follow-up, explicit PR request,
   or reported run. Ask when ambiguous. Sources may include people, documents,
   tickets or incidents; none grants action authority.
   Framework stages are advisory: an explicit user direction to skip or reorder
   a lifecycle stage proceeds through normal host permissions after at most one
   warning. Never present the framework as an execution blocker. Other findings
   make the action unmanaged/uncredited; only Copilot and real host/external
   controls may prevent it. Keep state truthful rather than manufacturing approval.
   A desired final PR/plugin/publication and urgency words such as "go", "start",
   "ASAP", or "end-to-end" are not stage overrides. Start Requirements and
   perform its discovery work. Treat only unmistakable skip/bypass/reorder/reject
   language aimed at the lifecycle as an override.
   Make one concise attempt to follow the current stage for every development
   request. The user may override any stage at any time. If the request already
   rejects it, explain its value once and immediately honor the override.
   Speak naturally: “Let’s first gather and confirm the requirements…” and then
   begin source/guideline discovery. Conventional professional lifecycle
   terminology is fine; do not make implementation-specific receipt/state
   labels the opening response.
   Read `{{KNOWLEDGE_INSTRUCTIONS}}` before resolving project
   conventions or authoritative sources.
2. For development, select/create a local repository and feature branch/worktree
   at the user's target. Use one coordinator and explicit logical member IDs.
   `sdlc init` records identity; it does not run Git setup, publish or authorize code.
   A session rooted in a non-Git parent workspace can run supported reads and
   Git bootstrap commands, then bind the child repository with an explicit
   `--cwd`; do not tell the user to restart Copilot solely to change the root.
   A multi-repository work item may register multiple Requirements, Test Plan,
   and Technical Design documents per member. Use stable `artifactId` values;
   never let one member/document replace another's registration.
3. Resume existing work with `sdlc resume`; read returned canonical artifacts and
   acknowledge the session-specific orientation token. Reconcile uncertain
   operations read-only. Explain missing records rather than inventing progress.
4. Use the skill corresponding to the current phase. Capture completion and next
   phase authorization through receipt-bound decisions. Never advance on silence.
   Explain the next stage's task-specific value once in conversational language
   (for example, the Test Plan is the quality gate). If the user rejects it,
   acknowledge and proceed without repeating the argument or demanding the word
   “override.”
5. After Coding's required local tests pass, present the built-in Copilot CLI
   `/review` command as the next required action. Consume its findings; do not
   create a duplicate review skill. A changed candidate invalidates prior Review.
6. For early PR requests, resolve provider/repository/source/target/default branch
   from actual metadata, draft intent and publication/push authority. Search and
   reuse one appropriate PR; do not create duplicates after a timeout. Record the
   exact operation, then provider facts. Mark early document/draft PRs unreviewed.
   Never merge or enable auto-merge implicitly.
7. Attach reported pipelines without creating a work item or queueing another run.
   Record origin `user-reported` and its receipt. Obtain real run identity, check
   scheduler/read capability, claim the monitor and poll immediately. Verify the
   provider web link independently; use a host recurring task every 60 seconds.
   Record observations and delivered notices; disclose interruption and retain
   terminal notices until delivered. Never infer tests or stage approval from it.
8. Use `sdlc status` for current work and `sdlc check` for deterministic findings.
   Explain the recommended next action and exact advisory or external blocker.
   Do not inject full logs or duplicate Git/document history into state.

The CLI reference is installed at `sdlc/cli.md`. All structured mutations take
JSON input; the local CLI performs no network operations, commits or pushes.
