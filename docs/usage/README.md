# Lifecycle usage and recovery

The normal flow is Requirements, one living Test Plan, Technical Design, Coding
and candidate Review. User decisions authorize transitions; a document's Draft
label, tool success or source content is not approval or approval denial.
Explicit user stage overrides are honored through normal host permissions.

## Validation and delivery

Each candidate-changing fix restarts the applicable unit-first local checkpoint.
After required local checks pass, use GitHub Copilot CLI's built-in `/review`
for that candidate. PR publication, provider review/merge, DEV and STAGING are
separate permissions. Local success never triggers a live environment.
STAGING follows its chosen execution owner/location contract and needs explicit
completion confirmation. PROD is a recommendation, never automatic execution.

This repository defaults to [finite local critical sanity checks](../contributing/README.md),
while its hosted PR matrix is complete. Other consumers retain their own local
checkpoint and CI/CD choices.

## Resume from authoritative records

Use `sdlc resume` for the bound repository/work item, retrieve its canonical
Requirements/Test Plan/Design and pending handles, then acknowledge the current
orientation token only if one was actually issued. Retrieve original execution
results before replacing a run. Missing orientation or a failed state read is
not permission to forge an ACK, erase history or claim managed credit.

Portable manifests identify documents; immutable snapshots retain original
digests/locators. Relocating source files does not automatically approve
cross-branch/runtime rebinding. See [documentation migration](../contributing/documentation.md).

For structured input/output, status, approvals, evidence and recovery commands,
use the [CLI reference](../reference/cli.md).
For reusable headless execution and PR-description metadata, use the
[generic evidence guide](evidence.md).
