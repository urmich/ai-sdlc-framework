# Security policy

## Scope and supported versions

Michael Urinovsky maintains this personal third-party MIT project on a
best-effort basis. Current published version: **0.4.0**. The project does not
promise LTS, support for every older release, a response SLA, corporate approval,
first-party status, CFS exemption or guaranteed availability.
Node >=22 is external to the shipped dependency-free JavaScript runtime.
Published releases are immutable; remediation requires an authorized new release,
not overwriting 0.4.0 assets or tags.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/urmich/ai-sdlc-framework/security/advisories/new)
for `urmich/ai-sdlc-framework`. GitHub sign-in is expected. The maintainer enabled
the feature with explicit authority; API readback confirmed `enabled: true` on
2026-10-20. The earlier disabled observation is historical, not the current route.

No advisory/report was submitted as part of that setting verification. It is not
a passing end-to-end reporting walkthrough, and this policy promises no fixed
response time or confidential alternative mailbox.

Do not disclose exploit details or secrets in public Issues. A nonsensitive
request asking the owner to provide a private route may be posted via
[Issues](https://github.com/urmich/ai-sdlc-framework/issues), without the
vulnerability details. If the form is unavailable to you, retain the report
privately and ask for a usable route without disclosing the vulnerability.

Include affected version/source and channel,
impact/trust boundary, reproduction steps on an owned isolated fixture, expected
versus observed behavior and sanitized diagnostics. Do not test against other
people's repositories/installations or submit live credentials.
Coordinate disclosure with the maintainer where contact is possible; no fixed
response or embargo duration is guaranteed.

## Trust and supply-chain limits

See [architecture boundaries](docs/architecture/README.md).
Hooks are advisory, provider authority belongs to actual tools/access controls,
and serialized `Passed` or `verified` fields cannot authenticate test evidence.
No dependency-free runtime claim removes external Node, Go, npm, Actions or
package-manager supply-chain responsibilities.

The [FR-054 adoption mapping](docs/contributing/documentation.md#fr-054-adopted-and-deferred)
separates documentation adopted here from deferred SBOM, CodeQL, scanning,
account controls and institutional programs. None is claimed complete by this
policy or by a workflow file. Effective controls need separately authorized,
revision-bound external observations.
