# Test Design / Test Plan - Browser Calculator Framework Test

Status: User-approved baseline

This is the living test document. Execution status and implementation readiness
remain separate.

| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | FR-001, FR-002 | AC-001.1, AC-002.1, AC-002.4 | local | unit | pre-review | Automated | agent | local | Initial display is 0; digit and decimal input forms valid normalized operands and ordinary decimal results avoid display noise | test/calculator/test/calculator.test.js | Passed |
| T-02 | FR-002 | AC-002.2, AC-002.3, AC-002.5 | local | unit | pre-review | Automated | agent | local | Addition, subtraction, multiplication, division, chained operations, precision-sensitive reversal, and repeated equals produce expected results | test/calculator/test/calculator.test.js | Passed |
| T-03 | FR-003 | AC-003.1, AC-003.2, AC-003.3, AC-003.4 | local | unit | pre-review | Automated | agent | local | Clear, backspace, sign, and context-sensitive percent modify calculator state exactly as specified | test/calculator/test/calculator.test.js | Passed |
| T-04 | FR-004 | AC-004.1, AC-004.2, AC-004.3 | local | unit | pre-review | Automated | agent | local | Division by zero displays Error; numeric recovery works; repeated decimal input remains valid | test/calculator/test/calculator.test.js | Passed |
| T-05 | FR-003, FR-004, FR-005 | AC-003.5, AC-004.1, AC-005.3, AC-005.4 | local | integration | pre-review | Automated | agent | local | Browser wiring maps all visible controls and required keys; direct focused-button Enter remains native while Enter after keyboard input calculates; display and badge expose result and error status | test/calculator/test/calculator.test.js; test/calculator/test/static-contract.test.js | Passed |
| T-06 | FR-001, FR-005 | AC-001.2, AC-005.1, AC-005.2, AC-005.5 | local | integration | pre-review | Automated | agent | local | Required theme script runs first, all colors use cp variables, responsive CSS prevents page overflow, and rendering reveals latest display digits | test/calculator/test/calculator.test.js; test/calculator/test/static-contract.test.js | Passed |
| T-07 | FR-001, FR-004, FR-006 | AC-001.3, AC-001.4, AC-004.4, AC-006.1, AC-006.2, AC-006.3 | local | integration | pre-review | Automated | agent | local | All calculator artifacts and local assets resolve in scope; the app has no external runtime dependency, dynamic evaluation, or missing required test scenario | test/calculator/test/static-contract.test.js; test/calculator/test/calculator.test.js | Passed |
| T-08 | FR-007 | AC-007.1, AC-007.2, AC-007.3 | local | workflow | post-review | Semi-automated | agent | development-machine | Framework receipts, locators, phase gates, tests, Review handoff, and current-session limitations are reported from actual evidence | test/calculator/docs/framework-assessment.md | Passed |
| T-09 | FR-007 | AC-007.2 | local | review | review | Automated | user | development-machine | Built-in Copilot CLI review reports no blocking defect for the current locally validated candidate | GitHub Copilot CLI /review | Passed |
| T-10 | FR-001, FR-002, FR-003, FR-004, FR-005 | AC-001.1, AC-001.2, AC-001.4, AC-002.2, AC-002.5, AC-003.4, AC-003.5, AC-004.1, AC-005.5 | local | acceptance | post-review | Manual | user | browser | The live page passes precision chaining, contextual percent, repeated equals, focused-button Enter, latest-digit visibility, error status, and favicon loading checks | http://127.0.0.1:8765/ | Passed |

## Test procedures and sequence

After every implementation or test fix:

1. Run `node --test test/calculator/test/calculator.test.js`.
2. Run `node --test test/calculator/test/*.test.js`.
3. If every pre-Review row passes, invoke the built-in Copilot CLI `/review`.
4. Run the user browser acceptance scenarios in T-10.
5. Record the framework assessment only after Review and browser acceptance.

### T-01 - Operand entry and normalized display

Create a calculator engine, verify its initial display, enter integer and decimal
digits, and assert the resulting display. Evaluate `0.1 + 0.2` and assert `0.3`.

### T-02 - Arithmetic and chaining

Exercise each operator with positive operands, then calculate `2 + 3`, multiply
the displayed result by `4`, and assert `20`. Verify precision-sensitive chained
division/multiplication and repeated equals.

### T-03 - Editing controls

Build a multi-digit operand and test backspace. Toggle sign twice, apply percent,
verify contextual `200 + 10% = 220`, then clear and assert a complete reset.

### T-04 - Invalid arithmetic and recovery

Divide by zero and assert `Error`. Enter a digit and assert a fresh calculation.
Attempt multiple decimal points and assert only one is retained. Verify the
15-digit operand boundary, exact adjacent large-integer subtraction, and `Error`
for an unsafe integer result.

### T-05 to T-07 - Static browser contract

Read `test/calculator/index.html`, `styles.css`, and `calculator.js`. Assert local
script and style references, control and key mappings, accessible names and live
output, theme ordering, required variables, responsive rules, in-scope paths,
and absence of external URLs or dynamic evaluation. These checks do not claim
visual browser rendering.

### T-08 - Framework dry run

Use installed CLI records and actual command outcomes. Report successful
controls, blocked actions, stale-decision protection, adapter workarounds caused
by the pre-install session, and behavior still requiring a restarted Copilot
CLI. Do not mark unobserved automatic hook activation as passing.

### T-09 - Candidate Review

After T-01 through T-07 pass, use the built-in `/review` capability. Any blocking
finding returns the project to Coding and restarts the unit-first sequence.

### T-10 - User browser acceptance

Open `http://127.0.0.1:8765/` and verify:

1. `100000000000000 / 3 * 3 =` displays `100000000000000`.
2. `200 + 10 % =` displays `220`.
3. A 15-significant-digit value reveals the newest rightmost digits and remains
   horizontally scrollable.
4. `2 + 3 = = =` displays `11`.
5. Enter on a focused calculator button activates that button rather than the
   global equals shortcut.
6. Division by zero changes both display and status badge to `Error`.
7. Reloading the page produces no missing-favicon request.

## Cleanup and evidence

Tests create only in-memory calculator instances and read repository files.
They create no network, cloud, browser-profile, or persistent application data.
The local test output, current Git diff, framework CLI status, and Review result
are the evidence sources.
