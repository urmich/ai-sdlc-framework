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

- During Test Design, bind each planned case to its required executable
  assertions or exact procedure, checkpoint, platform and prerequisites.
  Confirm selectors and evidence collection before the first substantial run;
  do not defer case-level correspondence until final acceptance.
- Capture commands, selectors, exits, sanitized results and independently
  established source/test/configuration/environment identities from the first
  run. Use existing reporting and storage; do not add a second evidence system
  merely to reformat results.

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

- Persist execution output as it is produced and record completed case results
  promptly through the supported evidence/Test Plan mechanism. Mark a case
  `Passed` only when all its required assertions and result prerequisites are
  satisfied; a partial or interrupted suite does not complete its checkpoint.
  If the runner finalizes a report only at exit, retain the ongoing capture and
  reconcile that report rather than rerunning solely for evidence formatting.
- To reuse completed evidence, compare the original execution's recorded inputs
  against independently established inputs required for the current validation
  target: exact selected cases/assertions, tested source/artifact identity, test
  specification, configuration, toolchain/platform/environment and checkpoint
  prerequisites, including required freshness. Compare content identities and
  required conditions, not branch names, version labels or remembered claims.
  Admit reuse only when all dimensions required by the declared validation
  contract match. Unknown applicability is unverified, not `Passed` or `Failed`.
- Recover a known running execution's handle, inputs and output before deciding
  whether another run is needed. Running, partial and interrupted executions
  are not completed passing evidence, even when some case results are available.
- Keep original execution records immutable; maintain current status/reference
  projections separately and preserve original failures and superseded passes.
  Persistence protects the historical record, not its applicability to later
  inputs. Never rewrite an original candidate identity to manufacture current
  evidence or use broad suite totals to pass an unexecuted case.
- Formatting a report or maintaining status/reference fields does not itself
  invalidate tests only where the declared validation contract excludes those
  changes from tested/specification identity. Do not invent such exclusions.
- A change from candidate A to B includes additions, modifications and deletions,
  not just new features. Before claiming readiness for B, compare the actual
  delta against the inputs and conditions recorded with each required result.

Mandatory evidence invalidation and reset:

- **When:** invalidate current credit if a change affects a case's tested
  behavior or dependencies, shared fixtures, selected cases/assertions, test
  specification, artifact, configuration, toolchain/platform/environment,
  required prerequisites or freshness. Invalidated required case evidence also
  invalidates any aggregate checkpoint pass that depends on it. Formatting-only
  changes qualify for reuse only under an explicit existing contract exclusion.
- **Extent:** use the declared validation contract and case/dependency bindings
  to determine which current results lose credit. If exact whole-candidate
  identity is required, any change to that identity invalidates all results
  bound to it, even for an addition or a seemingly unrelated change. If impact
  or applicability is unknown, remove current credit for potentially affected
  results and report the uncertainty; do not assume a change is isolated.
- **How:** preserve the original execution and its outcome unchanged. Record
  its reference, the old and new input identities, invalidation reason, affected
  case IDs and dependent checkpoints in the existing status/evidence mechanism.
  Reset affected current `Passed` or `Failed` projections to `NotRun`, clear
  their current passing/readiness credit and keep the old evidence as history.
  Invalidation is not a new failing execution; mark `Failed` only from an
  applicable completed execution that actually failed.
- **Replacement:** run the affected required validation and store new results
  under their actual execution/input identities. Restore current credit only
  from complete applicable evidence. Reuse proven unaffected results only when
  the contract explicitly permits it and all required applicability comparisons
  succeed; never rewrite old evidence to make it current.
- **Required cycles:** if the repository requires a fresh cycle or full local
  checkpoint after a candidate-changing fix, reset that entire required current
  projection and run its prescribed unit-first sequence. Selective invalidation
  does not waive that requirement. Deletion does not remove a required case or
  acceptance obligation without an authorized scope change.

Examples (two good and two bad patterns):

| Pattern | Action |
| --- | --- |
| Do | After compaction, recover the original completed report and verify its recorded inputs against the current required inputs. Reconcile admissible outcomes without rerunning for lost conversational memory. |
| Do | Modifying or deleting a shared tested dependency changes candidate A to B. Preserve A's reports, reset affected current cases and dependent checkpoint credit to `NotRun`, record why, and capture B's required validation. If the contract binds the whole candidate, reset all bound results and run the full required checkpoint. |
| Do not | Rerun an unchanged, valid execution merely to obtain a different report format, or overwrite its original evidence while updating the Test Plan. |
| Do not | Treat successful context acknowledgement as proof that guides were understood, tests passed, a stage completed or an external action was authorized. |

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
