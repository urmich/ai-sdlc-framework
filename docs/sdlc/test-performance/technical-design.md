# Technical Design: Faster test feedback

## Boundaries

Change developer test orchestration and isolated test-file organization only.
Do not change runtime policy, storage durability, evidence semantics, assertions,
platform skip conditions or package dependencies.

## Portable test runner

Add a dependency-free Node.js script using `node:fs`, `node:path`, `node:os`
and `node:child_process`. Resolve explicit test-file arguments relative to the
repository and invoke `process.execPath` without a shell.

- The unit profile uses the canonical three-file, 16-case fast selection. It
  includes small adapter boundary fixtures and is not described as pure-only
  unit coverage or as full validation.
- The full profile discovers every top-level `*.test.mjs` file. `npm test`
  remains the complete suite, while `test:full` names the same profile explicitly.
- Targeted execution accepts existing test files and an optional Node test-name
  pattern; it does not rely on shell wildcard expansion.
- Choose a conservative CPU-derived worker cap, with a bounded explicit
  `SDLC_TEST_WORKERS` override. Invalid options, unknown files and escaping paths
  fail before launching a child.
- Start the measured expensive full-suite files early rather than leaving long
  sequential tails at the end of an alphabetical queue. Scheduling changes
  order only, never membership; unknown new files use a deterministic fallback.
  The child uses Node's public `test.run({files, concurrency})` API with a spec
  reporter. The Node CLI sorts explicit filenames, so passing an ordered CLI
  argument list alone does not enforce this queue. A real one-worker public
  command regression verifies start order. Transfer options over stdin, avoiding
  Windows command-line length limits; keep Node's default process isolation.
  Cancellation uses a separate IPC control channel, including on Windows where
  process termination is not a catchable POSIX signal. The worker supplies an
  `AbortController` to `test.run`, awaits shutdown/reporting, closes its control
  channel, and preserves a nonzero interrupted outcome. Direct POSIX signals
  use the same cancellation path. Real active-worker probes verify both signal
  requests and absence of surviving file processes when the public call returns.
- Preserve the child exit code and diagnostics. Emit profile, selected files,
  worker limit, runtime/platform, elapsed milliseconds and exit status.

Existing coverage execution continues through the same full selection with
Node's coverage flag. No release workflow is dispatched by these commands.

## Independent file organization

The longest file tails are deployment and PR fixture tests. Move their
unchanged top-level cases into coherent smaller files, retaining exact case
names and assertions. Extract only their shared imports and setup helpers into
non-test support modules. Each test file still runs in its own Node process;
each fixture retains a unique repository/home and awaited cleanup.

Do not enable blanket same-process concurrency. Tests that mutate environment,
registries or shared fixtures remain isolated. Refactoring rejects unsupported
test-registration shapes instead of silently omitting them.

Record the original cases before editing and compare the complete original
case-name inventory afterward. New runner-contract tests are counted separately.
The full discovery mechanism includes all new test files automatically.

## Measurements and failure behavior

Run the original deployment/PR selection as the focused baseline. Run the
equivalent reorganized selection with the same runtime and explicit worker
limit, and compare exact test inventory and elapsed time. Repeat both focused
comparisons; both optimized results must show improvement under identical
runtime and worker settings. Retained full-suite logs supplement this focused
comparison but do not substitute for a new complete candidate execution.

Conditional PR publication additionally requires a complete candidate run
taking no more than 90% of the identified comparable full-suite baseline.
Account for all original 602 cases with unchanged outcomes/skip conditions;
identify new runner-contract cases separately. Faster focused execution or
exposing the existing fast command alone cannot satisfy this gate.

A speedup is accepted only with passing unchanged tests and all the measurement
gates above. Otherwise report the failed or unverified optimization and do not
publish on that basis; never weaken coverage or claim estimated gains. Child
start failures, invalid selectors and signals remain explicit nonzero outcomes.

## Runner contract and portability probes

Capture the canonical 16 original case names from the exact three-file selection
and assert that manifest, not just a count. A disposable failing child case and
passing sibling exercise real public-runner exit propagation. More disposable
files than worker slots use filesystem barriers to measure actual active work
with limits 1 and 2; all barriers and processes are awaited and cleaned up.

The existing full CI validation remains complete. Add a lightweight public-command
smoke matrix for Node 22 on Ubuntu, Windows and macOS: run the fast profile and a
targeted filename containing spaces without shell globs. This matrix validates
portability, not the local timing threshold or live-provider acceptance.

## Traceability

- FR-130 / T-130, T-131: persistent fast profile and runner contracts.
- FR-131 / T-130, T-132, T-133: bounded file parallelism and unchanged coverage.
- FR-132 / T-130, T-132, T-134: portable targeted commands and reproducible metadata.
- T-135: review the exact measured candidate before conditional PR publication.
