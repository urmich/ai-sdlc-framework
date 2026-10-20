# Source repository instructions

These instructions apply only to contributions to this repository. They are
not installed framework instructions or a policy for framework consumers.

- Read [CONTRIBUTING.md](CONTRIBUTING.md), the applicable canonical records under
  `docs/sdlc/`, and [.github/testing-policy.md](.github/testing-policy.md) before
  changing source or tests. Honor explicit user lifecycle overrides without
  inventing approvals, passing evidence or external permissions.
- Preserve existing changes and immutable execution/release history. Use owned
  repository-local fixtures; never test against a live Copilot home, shared
  package-manager prefix, provider setting or published release.
- Classify every new/changed test under the testing policy. New tests are
  PR-only by default. Unit, local and pre-review labels do not make them critical.
- Default local gate: `npm run test:critical`, then `npm run check`.
  The finite profile permits at most 27 root checks and 27 total assertions,
  including descendants; growth beyond either cap requires an explicit reviewed
  budget change, not silent expansion or discarded assertions.
  Targeted/affected debugging and full/coverage runs are optional locally.
  Do not duplicate the canonical unit stage before the critical command.
- Parallelize only proven independent process-isolated groups; declare
  dependencies, shared resources and aggregate capacity. Never enable blanket
  callback concurrency across mutable environment/module state.
- Report exact commands and missing prerequisites truthfully. A narrow local
  pass does not satisfy the full PR matrix, native or release acceptance.
  Freeze the candidate before final validation and built-in Copilot `/review`.
- On protected hosts where npm is blocked, follow the
  [Node-only local gate](docs/contributing/README.md#protected-hosts-without-npm).
  Keep npm-dependent integration work on capable GitHub PR runners; never
  substitute another npm entry point or bypass machine protections.

This file and `.github/testing-policy.md` must remain outside npm exports,
package contents, installer selections and generic `assets/` guidance.
