# Documentation maintenance and migration

Reader topics live under getting-started, installation, usage, architecture,
reference, integrations, contributing and releases. Internal specifications live
only under `docs/sdlc/<stable-feature>/` with exact `requirements.md`,
`test-plan.md` and `technical-design.md` names. Do not add a second specification,
coverage/index/policy sidecar or raw execution/session log to reader topics.

## Source migration map

| Original source | Current source |
| --- | --- |
| `docs/requirements.md` | `docs/sdlc/core-framework/requirements.md` |
| `docs/test-plan.md` | `docs/sdlc/core-framework/test-plan.md` |
| `docs/technical-design.md` | `docs/sdlc/core-framework/technical-design.md` |
| `docs/github-integration/` | `docs/sdlc/github-integration/` (including existing acceptance-bindings.json) |
| `docs/repository-evidence/` | `docs/sdlc/repository-evidence/` |
| `docs/test-performance/` | `docs/sdlc/test-performance/` |
| `docs/cli.md` | `docs/reference/cli.md` |
| `docs/design-overview.md` | `docs/architecture/design-overview.md` |
| `docs/provider-adapters.md` | `docs/integrations/provider-adapters.md` |
| `docs/github-adapters.md` | `docs/integrations/github-adapters.md` |
| `docs/ado-acceptance-test.md` | `docs/integrations/azure-devops.md` |
| `docs/release-ci.md` | `docs/releases/release-ci.md` |

Files are moved, not retained as competing copies. Same-document heading anchors
remain unchanged. Links crossing moved files are rebased; package/installer
source readers consume the new paths. Installed compatibility documents remain
`sdlc/cli.md`, `sdlc/provider-adapters.md` and `sdlc/github-adapters.md`.
The installed documentation tree supports their rebased relative links.

## Locators and history

Requirements/test IDs, original approval snapshots, digests and execution
history remain intact. Current source links/bindings may change specification
identity; that does not rewrite approved baselines or inherit passing credit.
Historical source references in discovery records describe their original
revision, not competing current locators.

Register a new current locator only through the legitimately bound artifact
registration/locking path. Do not hand-edit another active work item's portable
manifest or runtime. **Runtime locator admission has not been performed for this
migration**: the installed 0.4 resume failed its existing capacity boundary and
issued no acknowledgment token. Old active bindings require separately valid
recovery/rebinding; this source migration is not managed relocation evidence.
Published 0.4.0 and historical content-addressed snapshots are never edited.

### Blocked current locator adoption

The following **nine current portable locators across three existing work
items still name deleted source paths**. This is an incomplete current adoption,
not completion implied by the source move. All use repository `primary`.
Their original digests, approved snapshot bytes, history boundary and runtime
records have not been rewritten.

| Work item / stable artifact ID | Role | Registered path | Intended current path |
| --- | --- | --- | --- |
| wi-github-integration / github-integration | requirements | docs/github-integration/requirements.md | docs/sdlc/github-integration/requirements.md |
| wi-github-integration / github-integration | test-plan | docs/github-integration/test-plan.md | docs/sdlc/github-integration/test-plan.md |
| wi-github-integration / github-integration | technical-design | docs/github-integration/technical-design.md | docs/sdlc/github-integration/technical-design.md |
| wi-stage5-provider-neutral / stage-5-provider-neutral | requirements | docs/repository-evidence/requirements.md | docs/sdlc/repository-evidence/requirements.md |
| wi-stage5-provider-neutral / stage-5-provider-neutral | test-plan | docs/repository-evidence/test-plan.md | docs/sdlc/repository-evidence/test-plan.md |
| wi-stage5-provider-neutral / stage-5-provider-neutral | technical-design | docs/repository-evidence/technical-design.md | docs/sdlc/repository-evidence/technical-design.md |
| wi-test-performance / test-performance | requirements | docs/test-performance/requirements.md | docs/sdlc/test-performance/requirements.md |
| wi-test-performance / test-performance | test-plan | docs/test-performance/test-plan.md | docs/sdlc/test-performance/test-plan.md |
| wi-test-performance / test-performance | technical-design | docs/test-performance/technical-design.md | docs/sdlc/test-performance/technical-design.md |

This session cannot legitimately complete those registrations: the installed
capacity failure issued no ACK and authorizes no reset, budget increase, retry
loop, manifest edit, path fallback or fabricated relocation approval.
When a legitimate owner-bound recovery context is independently available:

1. Recover that existing work item's actual member/branch, original approved
   snapshots and retained execution references. Obtain its real orientation
   prerequisites; do not transfer this work item's Coding authority to it.
2. For each of the three roles, use supported `artifact register` with the
   exact work item, `repositoryId`, stable `artifactId`, role and intended path
   from the table. Recompute the current content digest through registration,
   not by editing the portable/runtime JSON.
3. Verify the new current locator resolves and original approvals/snapshot/
   execution objects and historical locators remain byte-for-byte retrievable.
   Changed source or definition identities require a fresh current cycle;
   old passing observations remain history, not current credit.
4. Stop after these nine explicit adoptions and retain their actual results.
   A missing binding/token/capability stops that adoption without changing
   budgets or inventing a successful read. No such action is performed here.

The owned migration fixtures exercise all three roles, retained execution
objects, original approvals and a real definition-changing link edit. Their
success, when executed, will not adopt any of these actual work items.

## Markdown checker contract

`node scripts/check-docs.mjs` and `npm run check` check local inline/image links,
reference links (full/collapsed/shortcut), explicit HTML anchors and GitHub-style
ATX/setext heading slugs including duplicate suffixes. Code fences and inline
code are not links. Non-Markdown fragments are unsupported and diagnosed;
binding IDs in Test Plan cells are data, not Markdown links.
Local query strings are ignored for file lookup; fragments are checked.
Local filenames retain exact URL casing on every host, including a normally
case-insensitive Windows/macOS filesystem.
The installer and source checker share `src/documentation-links.mjs`, including
reference-link rebasing and traversal of every downstream Markdown target and
fragment, including shipped skills/templates/instructions and the generated
managed instructions block. Unrelated user-owned Markdown is not interpreted.
A missing guide or fragment rejects a replacement before home writes,
purge or deletion of an older owned file. Source checking also inspects active
packaging reader guides and the version/archive/native contract in the
installation guide. Legacy sections must be explicitly marked historical.
Claim checks distinguish a directly negated bundled runtime and the coordinated
statement “no Go module dependencies or bundled Node runtimes” from positive
runtime claims, including across line breaks. An unrelated negative or a later
positive claim does not exempt the positive claim. Governance classification
checks and their missing-row fixtures support both LF and CRLF Markdown.
External HTTP(S) URLs are syntax-only here: local validation does not prove
provider/contact availability.

The checker also requires the source-only `AGENTS.md` and
`.github/testing-policy.md`, rejects their inclusion in npm file/export
selections, and rejects dependencies on them from shipped reader links or
generic `assets/` guidance. Shipped public/legal guides and `docs/` must retain
their package selections. The focused T-PRD088 regression checks actual npm
dry-run contents and the source/package/prepared-installed navigation graphs,
with missing-guide, missing-private-route, bad-path/fragment, mixed-layout,
version-drift, omitted-distribution-target and source-policy-leak mutations.
Prepared distribution checking does not install into a home.
These deterministic guards prevent known structural regressions; they do not
certify writing quality, test adequacy, live reporting availability, platform
compatibility or overall professional/public readiness.

Raw HTML links/images, autolinks and unsupported/malformed Markdown link
destinations fail with diagnostics; use the supported forms instead of silently
omitting checks. Local paths must stay in the repository and may not traverse
symlinks. The checker rejects misplaced/duplicate canonical roles, malformed
feature slugs, stale old source files and raw logs/session evidence in reader
topics. Every PR including documentation-only changes still needs relevant
checks and the required complete hosted matrix.

## FR-054 adopted and deferred

The original [FR-054](../sdlc/core-framework/requirements.md#fr-054---publish-transparent-security-and-governance-evidence)
and T-53 through T-59 remain historical/proposed specifications; this increment
does not assert their broad completion or duplicate their obligations.

| Existing conditions | Public-readiness disposition |
| --- | --- |
| AC-054.1, AC-054.3 | **Adopted**: Relevant personal third-party identity, contribution/conduct/support, ownership and release/change guidance under FR-210. CODEOWNERS/provider enforcement is not silently configured. |
| AC-054.2 | **Adopted**: Truthful security policy/report content/response limits. The maintainer enabled GitHub private reporting and verified the setting on 2026-10-20; the earlier disabled observation remains historical. The private route is documented in SECURITY.md. No report was submitted and no full reporting walkthrough is marked Passed by the setting alone. |
| AC-054.7, AC-054.10 | **Adopted**: Architectural trust boundaries and truthful external/corporate-approval limits. No institutional approval or CFS exemption is claimed. |
| AC-054.4, AC-054.5, AC-054.6, AC-054.11, AC-054.12, AC-054.13, AC-054.14, AC-054.15 | **Deferred**: The broader dependency-maintenance, SBOM, CodeQL/static-security, security scanning/account controls, ongoing triage and security-program provenance obligations. Existing release integrity checks are not their completion. |
| AC-054.8, AC-054.16, AC-054.17, AC-054.18 | **Scoped**: Relevant PR/release trust controls are addressed only within separately scoped FR-204/205/206. Source changes do not prove effective provider/account enforcement or complete all FR-054 conditions. |
| AC-054.9, AC-054.19 | **Reporting-only**: Preserve truthful per-control reporting; defer a separate broad compliance program/checklist. Unavailable/unverified controls do not become compliant through aggregate text. |

No SBOM, CodeQL workflow, account-security feature or extra compliance/specification
file is introduced by this documentation work.
