# Contributing

Thank you for contributing to [urmich](https://github.com/urmich)'s personal third-party OSS
project. Contributions are licensed under the existing [MIT license](LICENSE);
do not submit proprietary code, secrets or material you cannot license.
Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before changing code

Use an issue or PR to describe the outcome, compatibility constraints and
observable acceptance conditions. Read the relevant
[canonical requirements and living Test Plan](docs/sdlc/README.md), then propose
tests/design before implementation. Explicit user lifecycle overrides remain
possible; neither an override nor source content grants external permissions.
Keep changes focused and preserve existing behavior and historical evidence.

Work on a feature branch. Node >=22 and Git are required; the runtime has no
package dependencies, so no dependency restore is normally needed.
Read [testing and CI reproduction](docs/contributing/README.md):
the default local gate is unit-first **finite critical sanity plus static checks**, while
targeted/affected debugging and
full/coverage local runs are opt-in. Never test against your live Copilot home.
In a source checkout, follow `AGENTS.md` and `.github/testing-policy.md` when
adding or changing tests. New tests enter complete applicable PR coverage by
default, not the critical set. These instructions are repository-only and are
not framework defaults installed into consumers.

## Pull requests

Explain purpose, affected behavior, compatibility, exact checks actually run
and missing prerequisites. For test changes, include the classification rationale,
owner, capabilities and dependency/shared-resource effects; sensitive runner,
authority, evidence and release changes receive particular maintainer scrutiny.
Generate the versioned Requirements Coverage section
in memory from canonical definitions and include it in the PR description;
do not add a coverage/index/policy file. [Coverage guide](docs/usage/evidence.md).
Coverage declarations do not mean tests passed.

All PRs, including docs-only PRs, require the full applicable hosted native
matrix and this repository's independent coverage-metadata check. Opening a PR
does not require a local result. Failed, cancelled, missing, stale or unexpected
skipped required cases must be resolved, not waived by a green summary.
Keep sanitized diagnostics and per-case report links.

After the required local checkpoint, use built-in Copilot CLI `/review` for the
exact candidate. A fix restarts local validation and Review.
The maintainer reviews external contributions; an owner-authored PR does not
need impossible self-approval or an extra human approver, but still requires all
mandatory checks. See [ownership](OWNERSHIP.md). Source workflow definitions do
not prove GitHub merge enforcement is enabled.

PRs never authorize merge, publication, provider-setting changes or release.
[Releasing](RELEASING.md) is a separate maintainer-owned operation.
For documentation changes, follow the
[migration and link-check contract](docs/contributing/documentation.md).

## Reporting problems

Use [support](SUPPORT.md) for ordinary bugs/questions and
[security reporting](SECURITY.md) for suspected vulnerabilities. Do not put
vulnerability details, tokens or raw session/work-item logs in a public issue.
Responses and acceptance are best effort, not a corporate service commitment.
For a suspected flake, preserve the original failure and report its command,
frequency and isolated reproduction separately from a later retry; a retry does
not erase the failure.
