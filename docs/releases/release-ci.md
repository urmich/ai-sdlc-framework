# Release CI, immutable publication and acceptance

**Source-configured future flow; not executed or live-ready.** This guide
describes the current workflow/helper source, not verified repository settings,
native execution, npm trust, public-client availability or a completed release.
All public-readiness case results remain NotRun. The package version remains
0.4.0; published 0.4.0 bytes, assets, tags and historical evidence are immutable.
This document never authorizes dispatch, settings changes or publication.

## One explicit maintainer start

`.github/workflows/release.yml` is the sole release entry point, through
`workflow_dispatch`. It has no PR, push or tag trigger. The maintainer selects
`main` and supplies the exact complete inputs:

| Required input | Contract |
| --- | --- |
| `source_commit` | Full accepted source SHA; must equal the dispatch SHA and the current protected `main` commit. |
| `version` | Exact existing `package.json` version; the workflow never selects or bumps a version. |
| `release_repository` | Explicit public `owner/repository` GitHub asset destination. |
| `release_intent_id` | Stable logical release-intent identity, preserved across a permitted retry. |

The approved source repository/actual caller is
`urmich/ai-sdlc-framework/.github/workflows/release.yml@refs/heads/main`.
An invalid source/ref dispatch fails before checkout; it cannot appear green
merely because every later job was skipped.
Preflight verifies the actual actor's maintainer permission, public source and
destination, effective protected-main policy and current source checks.
The source policy requires strict `framework/validation`, `framework/approval`
and `framework/coverage` results, review/conversation handling, enforced
administrative policy and no force-push/deletion allowance. Source declarations
alone do not prove any of these controls are enabled or correctly enforced.
Solo-maintainer/provider policy must be reconciled explicitly, not bypassed
by claiming the owner's own PR has an impossible self-approval.

One authorized start owns the remaining approved sequence. There are no
`publish_draft` / `publish_npm` opt-in flags and no separate manual acceptance
dispatch. The reusable npm and acceptance workflows use `workflow_call`.
If the npm environment requires an additional reviewer/wait intervention
incompatible with that contract, preflight reports the conflict. It does not
auto-approve, remove protection or silently change policy.

## External prerequisites

These exact repository variables are source-configured prerequisites, **not
claims that the owner configured or verified them**:

| Repository variable | Required meaning/value |
| --- | --- |
| `NPM_TRUSTED_PUBLISHER_REPOSITORY` | `urmich/ai-sdlc-framework` |
| `NPM_TRUSTED_PUBLISHER_CALLER` | `release.yml`, the actual caller, not the reusable callee's filename |
| `NPM_TRUSTED_PUBLISHER_ENVIRONMENT` | `npm`, on the actual publishing job |
| `SUPPORTED_PREVIOUS_VERSION` | Authentic supported previous public release version, different from the candidate |
| `SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256` | Independently established SHA-256 of that public legacy release's descriptor |
| `SUPPORTED_PREVIOUS_CHECKSUMS_SHA256` | Independently established SHA-256 of that public legacy release's checksum manifest |

Do not copy synthetic test hashes, invent a previous version's metadata or
substitute collaborator-authenticated private downloads for public legacy pins.
Unavailable authentic prior-release inputs block the real upgrade prerequisite;
they are not permission to replace an upgrade with reinstall or repack history.

The dispatch destination becomes `RELEASE_REPOSITORY`; the exact source and
logical intent become `EXPECTED_SOURCE_COMMIT` and `RELEASE_INTENT_ID`.
Native consumers also receive independently pinned descriptor/checksum identities.
Hosted runner/toolchain availability, immutable-action policy, effective branch
controls, artifact access/attestations, exact npm OIDC trust and provider write
permissions remain separately verified capabilities. No token, registry,
network or OS-policy fallback is offered.

Before candidate construction, tag creation or asset publication, the read-only
publishing-tool preflight provisions actual Node **24.22.0** and
integrity-pinned npm **11.16.0** tooling in owned project-local scratch, then
checks script-disabled, token-free effective configuration.
`scripts/npm-handoff.mjs preflight` performs this tool validation without OIDC
publication permission. It is not a claim that the trusted publishing
relationship works; that external prerequisite and the later callee checks
remain separate. This tooling runtime does not change the shipped Node >=22
consumer contract or modify an installed Copilot home.

## Frozen candidate and four R-PRE lanes

The source-configured graph is:

```text
maintainer dispatch -> preflight -> prepare one frozen candidate
  -> four native R-PRE lanes -> re-evaluate complete original evidence -> seal
  -> draft exact GitHub assets + prepublication evidence
  -> data-only token-free npm publication -> exact public GitHub promotion
  -> three native public R-POST consumers
  -> separately named attested completion evidence -> overall completion result
```

`scripts/release-bundle.mjs prepare` freezes the npm archive, one shared Mac
archive, the separate Windows PE archive, manager metadata, descriptor,
checksums and source/intent identity once. No Linux standalone artifact is
introduced. The Mac archive contains one portable shell launcher and JavaScript
payload, with no native executable slices or nested npm tgz: it is not Universal
2 and does not bundle Node.
Windows remains a distinct x64 PE; npm remains the primary channel.

| Native host | Required R-PRE case | Actual obligation |
| --- | --- | --- |
| `ubuntu-24.04`, Linux x64 | T-PRD079-LX | Complete applicable shared regression/static/schema/Go work and deterministic frozen-candidate validation; not Linux standalone support. |
| `windows-2022`, Windows x64 | T-PRD079-WX | Complete native regression, real PE, PowerShell/cmd, installed hooks and lifecycle preservation. |
| `macos-15`, Apple Silicon | T-PRD079-MA | Complete native regression and standalone/Homebrew/shell lifecycle on the frozen shared archive. |
| `macos-15-intel`, Intel Mac | T-PRD079-MI | Corresponding complete native x64 execution on the exact same shared Mac bytes. |

The native validation baseline is Node 22.23.3, Go 1.27.1 and CPython 3.12.10,
plus the integrity-pinned schema/Homebrew/Ruby inputs and actual image/tool
identities in the [living Test Plan](../sdlc/public-readiness/test-plan.md#22-hosts-and-prerequisites).
These are selected execution inputs, not proof of available or completed jobs.
Translated/cross-build/metadata fixtures cannot satisfy native cases.

Each lane consumes the frozen candidate and retains the generic per-assertion
execution report, original diagnostics/journals and exact source/producer/
attempt/artifact identities. Sealing independently re-evaluates all required
underlying native assertions and gate inputs; a producer's JSON `Passed`,
parent-suite summary, missing job or unexpected skip cannot establish readiness.
Ordinary earlier PR validation never substitutes for fresh R-PRE.
Report transport preserves the original root and `tools-*` `.ndjson` bytes
alongside the declared data reports, not copies of caches, launcher executables
or arbitrary producer scratch.

The sealed bundle and its prepublication evidence archive are retained by exact
provider artifact IDs and digests. The prepublication archive name starts with
`release-prepublication-`, includes logical/physical identities and a content
hash, and receives build-provenance attestation separately from the payload.
It describes completed R-PRE, not its own future publication or R-POST success:
there is no evidence self-dependency or hash cycle.

## Exact-byte publication

1. **Draft/assets:** `scripts/publish-release.mjs` reconciles the exact tag,
   release and existing assets before adding missing identical content. Conflicting
   tags/assets fail. It uploads the sealed distribution assets and attested
   prepublication evidence without moving a tag or clobbering an asset.
2. **npm readiness:** `scripts/npm-handoff.mjs` validates the original frozen
   bundle/evidence and prepares identity-only handoff data without OIDC authority.
3. **Protected npm callee:** `.github/workflows/npm-publish.yml` runs on hosted
   Node **24.22.0** and integrity-pinned npm **11.16.0**, with environment `npm`
   on the actual publishing job and `id-token: write` on the necessary caller/
   callee boundary. It checks the exact `release.yml` caller, source and saved
   artifact identities. It performs no checkout, candidate script execution,
   application dependency installation or package lifecycle hooks in that
   privileged publishing job. Effective npm authentication must be token-free;
   missing OIDC/trust is a prerequisite failure, never a long-lived-token fallback.
4. **Promotion:** after exact npm publication/readback, promotion verifies the
   matching GitHub draft/assets and makes that same release public. No channel
   rebuild occurs. npm publication alone, a public draft, or matching provenance
   metadata alone is not overall release completion.

Public npm provenance metadata is independently compared with expected source,
workflow/builder and artifact identity. Required cryptographic verification is a
separate acceptance obligation; metadata inspection cannot claim signature or
transparency verification.

## Automatic public R-POST consumers and completion

After promotion, `release.yml` calls `release-acceptance.yml` with the exact
saved source run, bundle artifact ID/hash, source/intent, authentic public
legacy version/metadata pins and prepublication evidence filename/hash.
There is no standalone acceptance dispatch or manually selected unqualified
latest bundle.

Three clean native consumers execute: Windows x64, Apple Silicon macOS and
Intel macOS. They anonymously retrieve exact public release/npm content,
compare bytes and manifests before execution, and exercise the applicable npm,
standalone and actual isolated Homebrew lifecycle. They perform a real
supported-prior-version upgrade, not a same-version reinstall masquerading as
upgrade, and preserve unrelated home/runtime sentinels. Private CI credentials
may retrieve saved evidence; they do not establish anonymous asset availability.
Required provenance/attestation cryptography remains distinct from metadata checks.

The consumer retains `TARGET.json`, its `.execution.json`,
`.readiness-bundle.json`, `.readiness.md`, `.commands.jsonl` and
`.toolchain.json` originals before eligibility evaluation, with bounded
sanitization, original/retained digests and safe origin links. The expected
source/spec/configuration/artifact/native context comes from frozen inputs and
independently acquired provider run/job/step/log facts, not uploaded context.
The unique `sdlc-consumer-evidence` log marker binds original bytes and actual
native/bootstrap scope. A matching actual failure remains Failed; foreign or
missing origin is NotRun, never a successful consumer or fabricated failure.

Completion evaluates all seven required cases: T-PRD038-WX/MA/MI,
T-PRD039-WX/MA/MI and T-PRD042, with exact publication effects and original
consumer producer/job/step evidence. Missing, stale, unverified, failed or
partial consumers prevent release completion.

`scripts/accept-release.mjs complete` retains sanitized `completion.json`,
`completion.md` and original consumer/channel evidence. A separately named
`release-completion-...-<sha256>.tar.gz` is attested and appended as evidence;
it never rewrites frozen payload assets or the earlier prepublication archive.
The job finally requires actual completion status Passed. A workflow definition,
successful local fixture or uploaded archive is not proof that this happened.
`consumerAttempts` retains each original outcome/current disposition, provider
run/job links and digests. A later passing physical attempt never overwrites
the earlier failure. Missing signed/trust input or a timestamp-only mechanism
without required verified transparency proof remains NotRun, not crypto success.

For release-lifetime inspection after CI expiry, `release-retention.mjs`
reconstructs the full frozen assets/non-assets graph from retained archives and
signed/trust material. Its historical/as-of result cannot renew the current
24-hour publication window; CURRENT is NotRun and publication readiness false.
The separate `release-report.mjs` joins canonical closed-set evidence,
verified comparable timings, effective protections and immutable release
attempts into readiness.json/md. Missing trusted expectations/verifiers stay
unverified; the offline CLI does not authenticate saved Passed flags.
Completion recovery explicitly uses `release-retention.mjs completion` with
both independently pinned prepublication/completion archives and attestation
bundles, retaining the same source, plan/tree, provider facts and three admitted
consumer provenance hashes. It does not infer completion from R-PRE alone.
See the [exact clean-receiver and report procedures](../sdlc/public-readiness/test-plan.md#12-general-evidence-and-self-use-procedure).

## Retry and uncertain-effect recovery

Retain original physical provider run/job/attempts and each channel's outcome.
Read-only reconciliation comes before another write. No npm/GitHub transactional
rollback is invented; npm-only or GitHub-only success remains partial.
Readback uses at most ten minutes, with delays of 1, 2, 4, 8 and 16 seconds,
then at most 30 seconds per subsequent wait (bounded by remaining time).
Exhaustion is an explicitly uncertain publication outcome, not safe permission
to publish the version again.

Choose exactly one saved mode in addition to the unchanged four required inputs:

| Recovery mode | Exact additional inputs | Permitted behavior |
| --- | --- | --- |
| Sealed bundle / partial-publication recovery | `saved_run_id`, `saved_bundle_artifact_id`, `saved_bundle_sha256`, `saved_evidence_artifact_id` | Reacquire the exact original bundle and prepublication evidence; verify their provenance, source/spec/configuration/artifacts and native producer identities. Reuse original R-PRE only within its 24-hour freshness contract for the same logical intent. Keep its physical attempt identity; do not pretend the tests reran in this attempt. |
| Saved frozen candidate requiring fresh R-PRE | `saved_run_id`, `saved_candidate_artifact_id`, `saved_candidate_identity` | The identity JSON has exactly `descriptorSha256` and `checksumsSha256` with authentic lowercase SHA-256 values. Reacquire the same original frozen bytes, verify source/intent/metadata, and run all four R-PRE lanes freshly before sealing. This supports failure before seal or expired original proof, including an already partial publication. Existing channel effects still require exact reconciliation; no replacement candidate build is permitted. |

Do not mix the two modes or provide a partial identity set. A new physical retry
without its saved candidate or sealed bundle is rejected, rather than silently
rebuilding. Changed source/spec/configuration/assets/producers or expired R-PRE
cannot inherit old proof. If a required current source/policy condition no
longer matches, report that conflict; do not bypass controls to resume.
There is no repack, tag movement, asset clobber, unpublish, automatic version
bump or destructive cleanup of a published release.

## T-60 Windows tester handoff

The existing deterministic `packaging/windows-tester/generate.mjs` boundary
remains part of sealing. It binds the final source/version/npm inventory,
descriptor/checksums, Windows archive and launcher digests, public URLs and
source template identity. Generation occurs only after the required native
gates; content/binding validation is mandatory for a publication-ready bundle.

Its `generationValidation` / `completionValidation` refer to complete prompt
content and identity, not native execution. The prompt's own `nativeExecution`
remains NotRun. It does not replace T-PRD079-WX or the Windows R-POST consumers
and grants no publication or tester authority.
The handoff stays under `handoff/` in the immutable CI bundle, outside the
distribution descriptor/checksum assets, avoiding a final-digest cycle.

## Local work and historical boundaries

Contributors use [finite unit-first critical sanity checks](../contributing/README.md);
targeted/affected debugging is optional, not extra default-gate membership.
Full native R-PRE, public R-POST, effective rules, registry trust and release
mutation belong to separately authorized provider execution, not a mandatory
local contributor reproduction or an instruction to touch the live Copilot home.
This repository's release policy is not installed into framework consumers.

Older published release sequencing remains historical in its original source/
release evidence. It does not override this candidate's configured four-lane
policy or validate the current source. WinGet community acceptance, institutional
approval/CFS access and unavailable private security reporting are still separate
external prerequisites, not benefits conferred by another channel's success.
See [maintainer authority and change policy](../../RELEASING.md).
