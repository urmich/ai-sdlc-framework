# Building instructions

Use these instructions before restoring dependencies, compiling, packaging,
publishing build outputs, or running tests that require a build.

## 1. Discover the build contract

- Read repository build instructions and files linked from `AGENTS.md`,
  `.github/copilot-instructions.md`, contributor documentation, and CI.
- Identify the canonical build unit: workspace, solution, project, package,
  module, service, or image. Do not assume the repository root is canonical.
- Verify exact SDK/runtime/tool versions, architecture, platform, environment
  variables, emulators, containers, generated sources, and local services.
- Respect cross-platform and architecture-specific tooling requirements; verify
  the actual executable and target architecture rather than trusting PATH.
- Do not invent commands from ecosystem convention when the repository defines
  its own entry point.

## 2. Dependencies and restore

- Use the repository's existing package manager and lockfiles.
- Install or restore only after dependency metadata changes or a build fails
  because required dependencies are missing.
- Do not add build tools, global dependencies, or alternate package managers
  merely for convenience.
- Keep credentials out of command lines, logs, and generated configuration.
- Treat post-install scripts and repository hooks as executable side effects.

## 3. Build selection

- During iteration, build the smallest canonical target that covers the changed
  code and its direct dependents.
- When multiple affected targets share one runner, build them together rather
  than repeating setup.
- Run the repository's required complete build before publication when targeted
  builds cannot establish overall compatibility.
- Do not confuse editor compilation, incremental success, or cached artifacts
  with a clean required build.

## 4. Command execution

- Use argument arrays or correctly quoted literal paths; support spaces.
- Disable pagers and interactive prompts in automation.
- Capture the actual exit code and relevant sanitized diagnostics.
- Do not suppress warnings that the repository treats as errors.
- A timeout or lost process response is uncertain until process/output state is
  reconciled.
- Stop on build failure and fix the root cause before dependent testing,
  packaging, or deployment.

## 5. Build outputs

- Write outputs only to repository-approved or uniquely owned directories.
- Never recursively clean a broad, caller-selected, repository-root, or shared
  directory.
- Distinguish source outputs, test outputs, packages, container images, and
  deployment artifacts.
- Derive artifact identity from version/source/configuration and verify required
  contents; never select an unqualified `latest`.
- Reproducible-build claims require repeated builds and digest comparison.

## 6. Local build versus remote execution

- Local build/test success is evidence, not authorization to push, publish,
  queue CI, deploy to DEV, or promote environments.
- A build or push that can implicitly deploy must be classified by all effective
  environments before execution.
- Remote build/deployment pipelines require their own current user authority and
  provider capability checks.
- Monitor dispatched remote work and reconcile uncertainty before retrying.

## 7. Before completion

Confirm:

- The correct toolchain, architecture, and canonical target were used.
- Required generated files and dependencies are current.
- The build exited successfully without hidden warnings/errors.
- Outputs are complete, identity-bound, and written to owned locations.
- Applicable tests ran against the built candidate.
- No remote or destructive operation was implied by a local build command.
