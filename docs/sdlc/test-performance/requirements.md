# Requirements: Faster test feedback

## FR-130: Persist a fast local feedback command

Provide a documented repository command for the canonical fast unit selection,
not only a session-local script.

**Definition of done**

- AC-130.1: `npm run test:unit` works on all supported Node.js 22+ platforms
  and uses the current canonical fast selection explicitly.
- AC-130.2: The selection completes in under 30 seconds on the recorded
  reference environment with all selected assertions passing. Record the
  executable, platform, test count, exit code and elapsed time; do not count
  skipped cases as passes or imply a guarantee for unmeasured hardware.
- AC-130.3: A fast selection is clearly distinguished from full validation.
  A failing test keeps a failing process exit code.

## FR-131: Improve full execution without reducing coverage

Use measured bottlenecks to improve complete test execution, with portable,
bounded parallelism.

**Definition of done**

- AC-131.1: `npm test` still executes every existing top-level test file and
  preserves all assertions, platform conditions and fixture cleanup.
- AC-131.2: Worker concurrency is bounded and configurable; invalid settings
  fail explicitly. Independent files or cases never share mutable test state.
- AC-131.3: Compare before/after runs on the same environment and test
  inventory. Report actual elapsed time, coverage and platform/capability
  skips, not estimated speedup. Additional runner tests may increase the
  count and must be identified. The complete optimized run must be at least
  10% faster than the identified comparable baseline; unchanged or slower
  execution fails this condition. A repeated focused comparison of the same
  original cases must show the improvement in the same direction, rather
  than relying solely on one noisy measurement.
- AC-131.4: Existing CI commands remain complete validation. No change dispatches
  a remote workflow, publishes a package, alters policy or deploys software.
- AC-131.5: Existing runtime behavior, fixture/storage isolation, durable writes
  and recovery guarantees are preserved. No new runtime feature or GitHub
  adapter is introduced by this test-performance change.

## FR-132: Keep targeted testing and measurements understandable

Document fast, targeted and full commands with enough execution information
to reproduce a performance claim.

**Definition of done**

- AC-132.1: A caller can select known test files without shell-glob differences
  between Windows and POSIX, while the default full selection stays complete.
- AC-132.2: Record before/after elapsed time, selected files, concurrency, Node
  version/platform and pass/fail/skip counts in sanitized local evidence.
- AC-132.3: No measured result claims live-provider or package-community
  acceptance, lifecycle approval, or passing tests that were not executed.

## Sources and current evidence

- User direction: fast unit feedback in seconds or a few minutes; no promised
  full-suite improvement before measurement.
- The 30-second fast-feedback criterion exposes the existing fast selection;
  it is not by itself evidence that tests became faster. The separate full
  performance criterion above is required before conditional PR publication.
- Current `package.json`: `npm test` uses `node --test test/*.test.mjs`, with no
  persistent fast-unit command.
- Retained `closure-main-final-3` logs: canonical fast selection about 11 seconds;
  complete suite about 23.6 minutes on its recorded environment with 16 file
  workers.
- PR #14 and post-merge Linux CI passed. These are historical baseline results,
  not execution evidence for a changed candidate.
