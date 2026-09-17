# Test Design / Test Plan — <work-item>

This is one living document. Execution status is not implementation readiness.

| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | FR-001 | AC-001.1 | local | unit | pre-review | Automated | agent | local | Define the observable expected result | Add during Coding | NotRun |

## Test procedures and sequence

For each test, define prerequisites, level/environment/checkpoint, actionable steps,
expected outcomes, evidence and exact resource cleanup.
Use `pre-review` for tests required before `/review`, `review` for the Review
checkpoint itself, `post-review` for later local workflow observations, and
`DEV`/`STAGING` for environment-bound tests. After every fix: full required
pre-Review local unit suite, then all other required pre-Review local tests.
DEV work waits for separate current-candidate user authorization.
STAGING owner and authorized location come from the environment contract,
independent of test mode.

## Execution details

Reference candidate/configuration, validation cycle, test-definition digest,
environment and evidence. Keep activity and blockers separate from the only
per-test status values: NotRun, Passed, Failed. Reset current statuses after a fix;
preserve historical evidence outside this table.
