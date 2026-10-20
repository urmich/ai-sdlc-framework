# Releases and recovery

## Current versus candidate

The package remains **0.4.0**, Node >=22, offline and runtime-dependency-free.
Published 0.4.0 assets/tags are immutable. Historical release/repair acceptance
does not establish current-candidate readiness.

The future distribution has one **shared macOS archive** containing one portable
JavaScript payload and shell launcher. It is **not Universal 2**, bundles
**no Node runtime**, and requires native arm64 and x64 execution.
Windows retains a separate x64 PE archive; npm remains primary and Linux
standalone remains excluded.

## Separate gates

1. Finite local critical sanity and static checks, unit-first, then candidate `/review`.
   Targeted/affected debugging is optional; it does not redefine the default gate.
2. Complete applicable hosted PR matrix, plus independent declared coverage.
3. Separately authorized **R-PRE**: exact release preflight and fresh complete
   native cases against one frozen candidate.
4. Authorized publication of identical source-bound bytes to approved channels.
5. **R-POST**: anonymous downloads and clean native consumers verify those same
   published bytes and required provenance. Only then can release completion
   be reported.

No application DEV/STAGING deployment is introduced by this readiness increment.
Release permission, merge, protected environments, registry trust and public
acceptance are distinct. PR execution never receives publication credentials.
Required unavailable capabilities, unexpected skips, missing/stale reports and
partial completion remain non-passing.

## Maintainer prerequisites and recovery

Resolve exact source/version/destination, `RELEASE_REPOSITORY`, toolchain/image
identities, frozen manifest/checksums, native producer identities and the
declared npm OIDC caller/environment before publication. Verify actual provider
permissions/settings separately; do not infer enforcement from source YAML.
Do not use token fallback, registry redirection or OS-policy workarounds.

Reconcile a timed-out/partial publish read-only before retrying. Retain every
channel/attempt's original outcome. Identical saved artifacts may resume only
under the plan's exact reuse/currentness conditions; never overwrite an
immutable version/tag/asset or invent rollback.

[Release CI details](release-ci.md) describe the source-configured future
maintainer-dispatch flow, exact repository prerequisites, four native R-PRE
lanes, automatic same-byte publication/three-host R-POST and the two immutable
saved-artifact recovery modes. This is not an executed/live-readiness claim.
Original 0.4.0 release procedures and outcomes remain historical, not proof for
the new candidate. The
[living Test Plan](../sdlc/public-readiness/test-plan.md#11-authorized-end-to-end-release-procedure)
defines current required R-PRE/R-POST evidence. Neither document authorizes a run.
See [root maintainer policy](../../RELEASING.md).
