# Coding instructions

Use these instructions for implementation, bug fixes, refactoring, and
configuration changes after Coding is authorized.

## 1. Ground truth and scope

- Read the applicable requirements, Test Plan, Technical Design, repository
  instructions, and the focused knowledge-retrieval guide first.
- Implement the requested outcome, not a plausible substitute.
- Make every change necessary and no unrelated change. Report unrelated defects
  separately unless the user explicitly includes them.
- Preserve existing user changes and public behavior unless the approved
  requirement intentionally changes them.
- Do not commit or push without applicable user authority.

## 2. Small, coherent changes

- Work in focused increments with one concern and one reason to change.
- Keep orchestration and low-level mechanics at different abstraction levels.
- Prefer cohesive modules and small interfaces over broad managers or helpers.
- Use SOLID principles as design diagnostics, not reasons to add abstractions
  that the current requirement does not need.
- Reuse existing project patterns and helpers before adding parallel mechanisms.
- Do not combine behavior changes with unrelated refactoring.

## 3. Readable code

- Choose names that describe domain intent and outcomes, not data types or
  implementation mechanics.
- Name booleans as clear questions such as `isValid`, `hasAccess`, or
  `requiresRefresh`.
- Keep functions focused and easy to scan. Extract a block when it has an
  independent purpose, mixes abstraction levels, or repeats.
- Prefer guard clauses when they make validation and failure paths clearer.
- Comments explain non-obvious reasons, invariants, compatibility constraints,
  or tradeoffs. Do not narrate obvious statements.
- Document public APIs according to repository conventions, including inputs,
  outputs, errors, compatibility, and behavior that callers must preserve.

## 4. Types, inputs, and state

- Preserve static type safety. Avoid broad casts and unchecked dynamic values.
- Validate inputs at public, serialization, filesystem, process, network, and
  provider boundaries.
- Represent optionality explicitly; do not use empty strings, zero, or success
  objects to hide absence or uncertainty.
- Prefer immutable values and readonly state where practical.
- Avoid hidden mutable global state and order-dependent initialization.
- Keep domain state transitions explicit and reject impossible combinations.

## 5. Error handling

- Never swallow failures or convert them into success-shaped fallbacks.
- Catch only errors that can be handled meaningfully at that layer.
- Preserve the original cause and add sanitized context needed for diagnosis.
- Use domain-specific errors or result types consistent with the repository.
- Distinguish invalid input, unavailable dependency, permission failure,
  conflict, cancellation, timeout, uncertainty, and proven operation failure.
- A timeout after dispatch is uncertain, not evidence that nothing happened.

## 6. Async, resources, and concurrency

- Await asynchronous work and cleanup; avoid unobserved or fire-and-forget tasks.
- Do not block asynchronous code with synchronous waits.
- Make ownership of files, locks, processes, network handles, and temporary
  resources explicit.
- Release only resources created or claimed by the current operation.
- Protect shared state with repository-standard concurrency mechanisms and
  preserve idempotency across retry/recovery boundaries.
- Use bounded retries only for classified transient failures.

## 7. Security and information handling

- Apply least privilege and validate every trust boundary.
- Never hardcode or log secrets, tokens, credentials, or sensitive payloads.
- Use parameterized queries and structured process arguments.
- Normalize and validate filesystem paths before mutation.
- Treat deserialized, retrieved, and user-controlled content as untrusted data.
- Do not weaken authorization, validation, policy, or audit behavior to make a
  test pass.

## 8. Performance and compatibility

- Optimize only relevant paths, with evidence when performance matters.
- Avoid unnecessary allocations or repeated expensive work in hot paths.
- Preserve supported API, schema, data, and deployment compatibility unless an
  approved breaking change says otherwise.
- Verify runtime, SDK, architecture, and platform constraints before using an
  API or build output.

## 9. Refactoring

- Add or identify behavior-preserving tests before risky refactoring.
- Refactor in small steps and keep the suite green.
- Preserve public contracts unless the requirement explicitly changes them.
- Stop when the requested outcome is clear and maintainable; do not pursue
  speculative perfection.

## 10. LLM self-review

Before validation, challenge the generated change:

- Is it necessary and in the correct layer?
- Does it follow repository conventions?
- Are all referenced APIs and files real?
- Are failures explicit and state transitions truthful?
- Can it overwrite, disclose, duplicate, or silently retry anything?
- Are edge cases, compatibility, cleanup, and concurrency covered?
- Did AI authorship introduce unnecessary abstraction or false confidence?

The quality bar is identical for AI-generated and human-authored code.
