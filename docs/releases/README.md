# Releases and recovery

## Current versus candidate

Published version: **0.5.0**, Node >=22, offline and runtime-dependency-free.
On 2026-11-13, anonymous npm metadata identified 0.5.0 as `latest`, and GitHub
listed v0.5.0 as its latest non-prerelease, published on 2026-11-11.
See [Releases](https://github.com/urmich/ai-sdlc-framework/releases) for current assets.
This checkout includes changes after that tag. Publication does not establish
current-source readiness or completion of the acceptance gates below.
Published assets/tags and historical release/repair evidence remain immutable.

The 0.5.0 distribution has one **shared macOS archive** containing one portable
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

## Deferred launch limitations

The selected correction scope is F01/F02/F03/F05/F06/F13 from the launch
handoff. The following known issues are deferred, not resolved by local checks:

| Issue | Limitation and safe boundary |
| --- | --- |
| F04 | Independent merge gates were not provider-enforced at the reviewed state. FR-205/214 remain incomplete; use explicit maintainer review and actual current check inspection, not a claim of enforced gates. The intended publisher preflight still requires effective protected-main policy, so publication needs separately authorized policy reconciliation. |
| F07 | An explicitly selected zero-root test file can be omitted alongside a passing sibling. Do not claim exhaustive targeted execution; inspect the actual selected inventory/results. |
| F08 | Doctor does not validate every hook-bound Node executable after runtime removal. Retain that exact runtime and verify hooks independently after an ownership-safe update. |
| F09 | Windows PowerShell 5.1 wrapper argument forwarding loses some empty/quoted/trailing-backslash forms. Do not claim seamless wrapper fidelity; use the documented direct Node entry route for ordinary arguments. |
| F10 | Abrupt installation termination can make ordinary retry conflict. Preserve runtime/user files and restore exact owned files and manifest from a verified backup; purge is not automatic recovery. |
| F11 | Markdown/YAML delimiters can make approved dummy credential URLs fail exact-source admission. This fails closed; do not relax value checks or claim those forms are admitted. |
| F12 | WinGet smoke can report an executed launcher failure as NotRun/Blocked. Its nonzero outcome is not release success; retain and inspect the actual operation and exit. |

0.5.0 release acceptance must use independently verified published 0.4.0
descriptor/checksum pins for the actual previous-version upgrade on every
required native consumer host. Representative 0.3.1 fixtures do not replace it.
An announcement's readiness claims require the release's actual R-PRE and
R-POST integrity/provenance and clean-consumer evidence, plus verification of
the public default branch and release page. Publication metadata alone does
not establish those outcomes or validate post-tag source changes.
