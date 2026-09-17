# Reviewing instructions

Use these instructions for candidate Review, focused code review, and validation
of fixes before publication.

## 1. Review prerequisites

- Review the exact current candidate after required pre-Review local tests pass.
- Read its requirements, Test Plan, Technical Design, repository instructions,
  and relevant diff/history.
- Confirm generated/status-only files are distinguished from behavior changes.
- Do not treat build success, CI, provider approval, or a prior candidate Review
  as review of changed content.

## 2. Review the behavior chain

- Trace changed public entry points through validation, state mutation, external
  effects, and error handling.
- Check direct callers/callees, data/schema compatibility, and persistence or
  retry boundaries.
- Verify authorization, identity, scope, lifetime, and destination binding for
  externally visible operations.
- Check cancellation, timeout, partial failure, concurrency, idempotency,
  cleanup, and recovery.
- Look for success-shaped fallbacks, swallowed errors, stale evidence, and
  alternate completion paths.

## 3. Code quality and security

- Confirm responsibilities are cohesive and abstraction proportionate.
- Verify inputs and trust boundaries, least privilege, secret handling,
  parameterized commands/queries, and safe paths.
- Check resource lifetime, asynchronous completion, shared state, and race
  conditions.
- Preserve supported public APIs and behavior unless the requirement approves a
  break.
- Report performance problems only when the changed path makes them concrete.

## 4. Review tests as production code

- Confirm tests exercise public behavior and would fail for the reported defect.
- Look for weak assertions, disconnected fakes, string-presence checks,
  over-mocking, hidden network/user-state access, and unverified cleanup.
- Mutate or reason about alternate paths when a test could pass without the
  behavior it claims to prove.
- Ensure new bugs receive focused regression coverage and every fix restarts the
  required local validation sequence.

## 5. Findings

- Report concrete, reproducible, high-confidence defects with file/line,
  consequence, evidence, and the required behavior.
- Separate correctness/security findings from optional style suggestions.
- Do not omit a known defect to make the review appear clean.
- Do not inflate uncertain or speculative concerns into blockers; state what
  evidence is missing.

## 6. Closure

- A blocking finding returns work to Coding.
- After each fix, rerun unit-first local validation and Review the changed
  candidate again.
- A clean framework Review remains separate from provider reviewer approval,
  PR validation, merge authority, artifact production, and deployment consent.
- Record Review completion only through current candidate-bound evidence and
  explicit user confirmation.
