# Test Plan: Faster test feedback

Use disposable fixtures and the current supported Node runtime. Keep production
durability, all existing assertions, process isolation and platform conditions
unchanged. Compare the same original test cases before and after optimization;
new runner-contract cases are reported separately.

| ID | Environment | Level | Checkpoint | Mode | Owner | Location | Requirements | Expected Outcome | Implementation | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| T-130 | local | unit | pre-review | automated | agent | local | FR-130; FR-131; FR-132 | Runner options and selections are explicit, portable and bounded. Missing or unknown profiles/files, invalid worker values and escaping paths fail. Full discovery includes every test file; selected files cannot silently vanish. Public runner execution of a disposable failing case alongside a passing sibling preserves failure diagnostics and a nonzero process exit. | test/test-runner.test.mjs | Passed |
| T-131 | local | unit | pre-review | automated | agent | local | FR-130 | The exact canonical selection is provider-observations.unit.test.mjs, execution-artifact-identity.test.mjs and tool-adapters.test.mjs, including their existing mixed unit/fixture cases. Its original 16-case name multiset and outcomes match the baseline, and it passes in less than 30 seconds on the recorded reference environment. Print profile, file selection, concurrency, runtime, elapsed time and actual exit status. This selection is not the full suite. | npm run test:unit; canonical case manifest | Passed |
| T-132 | local | integration | pre-review | automated | agent | local | FR-131; FR-132 | Repeated before/after execution of the same isolated deployment/PR cases has identical names, assertions, outcomes and worker limit. Splitting files never shares mutable fixture state or changes test identity. Record runtime, selected files and elapsed time; both focused comparisons show faster optimized execution. | npm run test:targeted; retained baseline comparison | Passed |
| T-133 | local | regression | pre-review | automated | agent | local | FR-131; FR-132 | Complete execution passes every original test case with the same platform skips and is at least 10% faster than the identified same-environment baseline. The original 602-case inventory is accounted for exactly; any additional runner cases are identified separately. Failures keep nonzero exit status. Runtime behavior, storage isolation, durable writes and recovery are unchanged; no runtime feature or GitHub adapter is added. | npm test; original inventory and source comparison | Passed |
| T-134 | local | contract | pre-review | automated | agent | local | FR-130; FR-131; FR-132 | Package scripts and documentation agree with actual runner behavior; static checks and package-content validation pass without adding runtime dependencies or production durability changes. | npm run check; npm run package:artifact; npm run verify:package | Passed |
| T-135 | local | review | review | automated | agent | local | FR-130; FR-131; FR-132 | Built-in candidate review examines the measured, locally validated change with no blocking findings. Real performance improvement is documented before PR publication. | GitHub Copilot CLI /review | NotRun |
| T-136 | local | integration | pre-review | automated | agent | local | FR-131 | A synchronization-based public runner probe starts more disposable test files than worker slots. With worker limits 1 and 2, observed active workers never exceed the configured limit, every selected file executes exactly once, and all workers, barriers and fixture paths are cleaned up. | test/test-runner.test.mjs; disposable worker barriers | Passed |
| T-137 | local | contract | post-review | automated | provider | GitHub-Actions | FR-130; FR-132 | Public npm commands work on the supported CI smoke matrix: Ubuntu, Windows and macOS with Node 22. The fast selection matches the exact manifest; targeted explicit filenames work with spaces and no shell glob expansion. Unexecuted environments remain NotRun and the 30-second performance threshold applies only to the recorded reference machine. | .github/workflows/ci.yml test-command smoke matrix | NotRun |

## Execution and evidence

1. Capture the merged baseline's case names, outcomes, runtime, concurrency and
   elapsed time. For the focused benchmark, run the original deployment and PR
   files without modifying them.
2. Run runner unit/contract tests and the canonical fast selection first.
   Capture the exact 16 original names from the merged baseline's three files
   and retain them as the canonical manifest; matching a count alone is not
   enough. Existing fixture-backed cases cannot be replaced by cheaper cases.
   Create owned passing/failing runner fixtures and verify real subprocess
   failure propagation. Use observable filesystem barriers, not arbitrary
   sleeps, to verify actual worker limits 1 and 2 and complete cleanup.
3. Run the equivalent split deployment/PR selection and compare original case
   names and counts, repeat the focused comparison, and preserve the same
   configured worker limit. All fixtures await cleanup and preserve unique roots.
4. Run the full suite, static and package checks on the final candidate.
   Require at least 10% measured full-run improvement. Skipped platform/capability
   cases remain skipped, never passing evidence. Compare production-source and
   original test-body identities to confirm the optimization changed orchestration,
   not runtime behavior or assertions.
5. Run the built-in review using the exact successful execution logs rather than
   repeating the full suite during review.
6. After conditional PR publication, observe the public-command CI smoke matrix
   on Ubuntu, Windows and macOS with Node 22. This matrix checks portability,
   not a new full-suite timing baseline. Record source-bound provider results;
   do not mark unavailable native platforms Passed from parser-only tests.

Command output, metadata and timing logs are sanitized session evidence. Document
actual measurements, not hypothetical improvements. A failed or unrun result
stays Failed or NotRun; historical baseline results are not new passing credit.
