# Releasing and change management

Releases are maintainer-owned, separately authorized operations. A PR, local test
pass, green hosted check or documentation update does not authorize a version
bump, tag, publication, provider/trust change or PROD execution.

Follow the [release guide](docs/releases/README.md) and preserve the exact
source/version/destination, frozen artifact IDs/digests, native gate reports and
per-channel outcomes. Published **0.4.0 is immutable**.

One explicit maintainer release start owns the approved sequence: preflight,
complete fresh release-prepublication checks, deterministic packaging/native
validation, immutable publication, then public-consumer acceptance.
Prerequisites such as `RELEASE_REPOSITORY`, runner/toolchains, protected
environments, exact OIDC caller/trusted publisher and provider access must be
verified before dispatch. Source implementation is not evidence those settings
are effective or the new sequence passed.

For retries, reconcile existing tags/version/releases/assets/provider attempts
first. Identical saved bytes can resume only within the declared evidence
currentness contract; conflicts fail without overwriting. Partial npm/GitHub
publication is retained explicitly, never claimed transactionally rolled back.
Do not rebuild between channels or repack an existing version.

Record user-facing changes in [CHANGELOG.md](CHANGELOG.md), preserving
historical outcomes and distinguishing unvalidated/unreleased candidate work.
Keep detailed operational journals in declared evidence retention rather than
reader docs. Public announcements require complete applicable proof and
separate publication authority.
