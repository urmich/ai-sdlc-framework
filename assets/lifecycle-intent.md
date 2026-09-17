# Lifecycle intent

Use this guide whenever deciding whether a user is activating development or
overriding a lifecycle stage. It is the single interpretation contract for the
global instructions, orchestrator, and every focused lifecycle skill.

## Normal development activation

The following language does not skip a stage by itself:

- Implement this, fix this now, start coding, test it, publish it, or create a PR.
- Go, proceed, ASAP, right now, end-to-end, or similar urgency.
- A detailed final deliverable or instruction to complete the whole task.
- Ambiguous wording that could mean either continue the lifecycle or skip it.
- Negated override language such as “do not skip Requirements.”
- Non-lifecycle uses such as “skip this generated file” or “bypass the cache.”

Follow the current lifecycle stage. If invoked out of sequence, make one concise,
task-specific attempt to return to the applicable stage and immediately begin
useful work for it, such as source discovery, requirement clarification, Test
Plan design, or Technical Design analysis. Do not merely refuse the requested
outcome.

## Unmistakable lifecycle override

Treat an instruction as a stage override only when it clearly directs the agent
to skip, bypass, reject, or reorder an identified lifecycle stage or the
framework flow. Examples include:

- Skip Requirements and implement directly.
- Bypass Test Design for this fix.
- Do not create a Technical Design.
- Go directly to Coding instead of following the framework stages.

Explain the identified stage's value and consequence once, then honor the
instruction through normal Copilot and host permissions. Keep skipped work
truthfully incomplete or unmanaged. Do not repeat the warning or require
framework-specific vocabulary.

## State boundary

Text interpretation never creates approval, completion, managed credit, or an
override event. Managed state changes still require the framework's
receipt-bound decision process. If no matching decision exists, requested work
may continue unmanaged without falsifying lifecycle state.
