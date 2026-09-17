# Testing instructions

Use these instructions when designing, implementing, running, fixing, or
reviewing tests.

## 1. Purpose and traceability

- Tests are executable evidence, regression protection, and behavior
  documentation.
- Map each test to the requirement and observable condition it establishes.
- Test through public boundaries whenever possible; avoid asserting private
  implementation details.
- Keep test implementation, execution status, readiness, and evidence separate.
  `NotRun` is never equivalent to `Passed`.

## 2. Test selection

For changed behavior, cover as applicable:

- Happy path and representative normal inputs.
- Null, absent, empty, malformed, and wrong-type inputs.
- Minimum, maximum, first, last, overflow, and precision boundaries.
- Error, cancellation, timeout, permission, conflict, and recovery paths.
- Compatibility and serialization/schema transitions.
- Concurrency, retry, idempotency, and duplicate-event behavior.
- External integration failures using controlled doubles or emulators.

Prioritize business logic, public APIs, trust boundaries, and failure behavior.
Do not chase a percentage target with weak assertions.

## 3. Structure and naming

- Use Arrange-Act-Assert or the repository's equivalent clear structure.
- Give tests scenario-and-outcome names that explain the contract being proved.
- Keep one logical behavior per test; multiple assertions are appropriate when
  they establish one outcome.
- Make setup relevant and visible. Use builders/factories for complex fixtures
  rather than obscuring intent in repeated boilerplate.

## 4. Regression-first bug fixes

- Reproduce a reported defect with a failing test before or alongside the fix
  whenever practical.
- Assert the externally visible wrong behavior, not merely that a code path ran.
- Include the boundary or alternate completion path that allowed the defect.
- Confirm the test fails for the original defect and passes for the corrected
  behavior; avoid tautological assertions.

## 5. Assertions

- Assert exact observable outcomes, state transitions, errors, side effects, and
  cleanup that matter to the requirement.
- Prefer expressive repository-standard assertion libraries.
- Do not assert only non-null, truthy, call-count, or string-presence results
  when correctness requires stronger evidence.
- Avoid snapshot/golden assertions that accept unrelated changes without review.
- Include useful failure context without leaking secrets.

## 6. Test doubles and integration boundaries

- Mock external dependencies, slow operations, clocks, randomness, process
  boundaries, and hard-to-trigger failures.
- Do not mock the class or behavior under test.
- Avoid over-mocking: use real value objects and pure components where cheap.
- Verify that the chosen mocking mechanism can intercept the target API; false
  mocks are worse than missing tests.
- Use emulators, test containers, or isolated integration resources when the
  actual boundary is part of the requirement.

## 7. Determinism and isolation

- Tests must pass independently, in any order, and under repeated execution.
- No hidden shared mutable state, ambient credentials, user configuration, or
  production service dependency.
- Inject clocks, identifiers, randomness, environment, and failure points.
- Use unique fixture/resource identifiers.
- Do not use arbitrary sleeps for synchronization. Wait for an observable
  condition with a bounded timeout and fail clearly.
- Do not let a prior test's success or cleanup become another test's setup.

## 8. Cleanup and ownership

- Clean up every file, process, database record, container, subscription, lock,
  or remote resource created by the test.
- Cleanup the exact owned resource; never delete a broad directory or guess an
  owner.
- Await cleanup and verify it succeeded or the resource was already absent.
- Run cleanup in teardown/finally so a failed assertion does not poison later
  tests.
- Shared E2E infrastructure requires defensive setup and teardown for every
  scenario; do not rely on scenario order.

## 9. Unit, integration, and E2E balance

- Unit tests should be fast and cover pure logic and local failure behavior.
- Integration tests verify real adapters, configuration, persistence, and
  protocol boundaries using isolated resources.
- E2E tests validate only end-to-end behavior that lower layers cannot prove.
- Keep expensive or environment-bound tests at their declared checkpoint; local
  success does not authorize remote DEV/STAGING execution.

## 10. Execution discipline

- After each candidate-changing fix, restart the required local validation
  sequence from unit tests, then run the remaining pre-Review local tests.
- Use the smallest command that proves the changed behavior during iteration,
  then run the complete required local checkpoint before Review/publication.
- Read failures, determine whether code or test is wrong, and fix the root cause.
- Never skip, weaken, relabel, or delete a valid test merely to get green output.
- A flaky test is a defect: isolate its uncontrolled dependency instead of
  normalizing retries as success.

## 11. Final checklist

- Requirements and acceptance conditions are covered.
- Bug regressions prove the original failure mode.
- Assertions prove behavior rather than implementation.
- Edge, error, cancellation, timeout, and recovery paths are represented.
- Tests are deterministic, isolated, repeatable, and cleanup-owned.
- Commands and prerequisites come from the repository.
- Current status and evidence are recorded truthfully.
