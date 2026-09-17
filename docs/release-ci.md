# Scoped release CI and acceptance

## Release policy

The approved `ec3b2e7` scope change (cherry-picked here as `4cf9570`) establishes
the native ARM64 and deferred Windows/T-60 boundaries. The subsequent user
adjustment of 2026-09-17 authorizes Intel standalone publication and x64 Homebrew
metadata, overriding that earlier commit's Intel preview/arm64-only restrictions.
Intel deterministic archive/formula checks are now mandatory; Intel native
lifecycle remains explicitly `NotRun` and non-blocking.
The later authoritative clarification also requires real Homebrew audit/style
and correct Node runtime dependency metadata in both macOS paths.

| Target | Prepublication requirement | Published installer |
| --- | --- | --- |
| macOS Apple Silicon `macos-arm64` | **Mandatory native standalone and Homebrew lifecycle**, candidate-bound audit/style and Node metadata before Homebrew lifecycle, native machine checks and network-denied standalone lifecycle | Yes |
| Windows `windows-x64` | **Mandatory deterministic cross-build/PE/schema/URL/metadata/pre-JS payload-integrity checks**, plus validation of deferred T-60 identity inputs | Yes; no native execution claim |
| macOS Intel `macos-x64` | **Mandatory deterministic archive/formula URL/checksum/architecture checks, host Homebrew audit/style and Node metadata**, with explicit native lifecycle `NotRun` and non-blocking | Yes, including architecture-specific Homebrew metadata; no native acceptance claim |
| Linux `linux-x64` | Out of scope | **No** |

The generic platform library's `complete` flag describes its four supported
targets. Release eligibility instead uses exactly **three platform
archives: Windows x64, macOS arm64 and macOS x64**, plus the same npm tgz, and the required
gates above. Linux is outside this release entirely. Generic codec fixtures do
not create supported releases. Intel artifacts and formula stanzas are included
in the same immutable release, subject to deterministic non-execution evidence.
The Windows gate never invokes a PE executable, WinGet, Wine, or a native
Windows runner. Its host Go test selector runs only pre-JS payload/inventory
integrity and shared canonical-schema tests, not launcher/lifecycle execution.
These establish schema/payload interoperability, not
Windows installation. WinGet remains `contract-validated`; community submission,
`repository-ready` validation, client discovery, and native install are separate.

`macos-15` currently selects Apple Silicon in GitHub-hosted runner documentation.
The gate also checks the actual runtime/machine: a label migration, unavailable
Seatbelt, blocked negative control, or missing required native evidence fails
closed. No proxy-only substitute or policy modification is permitted. There is
no native Intel runner or native lifecycle prerequisite. The mandatory Intel job
runs on Ubuntu, reads/rebuilds archives, and validates generated formula metadata.
It runs host Homebrew/Ruby audit tooling with macOS/Intel metadata simulation,
never the Intel launcher, package install/upgrade/test, or native lifecycle. The job's
overall result can be `Passed` only with all deterministic evidence while its
`nativeValidation` remains `NotRun`. Missing or failed deterministic Intel
evidence blocks sealing; no synthesized Intel result replaces a missing job.

## Workflows and exact-byte ordering

`ci.yml` runs ordinary source/package validation only. `release.yml` runs for
`v*` tags and manual dispatch, with read-only default permissions:

1. Check out the source revision. A tag must equal `v<package.json version>`.
   Require an explicit approved public `owner/repository` through the dispatch
   input or `RELEASE_REPOSITORY` repository variable. Never infer the possibly
   private source repository as the asset destination.
2. `buildPackage` produces the canonical npm `.tgz` and independently repeats
   packing to prove determinism. The **first exact tgz** is the source of every
   archive and the only payload eligible for npm handoff. Comparison builds
   never replace it.
3. `buildLauncher` uses exact Go **1.27.1**, isolated caches, fixed flags, no
   module/toolchain downloads, two independent Windows AMD64 builds and PE
   verification. `buildPlatforms` wraps the exact tgz for only the three
   release targets. `verifyRelease` independently rebuilds and checks inventory.
4. WinGet consumes the verified Windows ZIP record (name/size/SHA-256), not the
   final descriptor. Stable versions generate all three deterministic manifests.
   Prereleases validate conspicuous test-only loopback manifests outside assets;
   those files are never published or submitted.
5. The Homebrew integration interface consumes verified **macOS arm64 and x64**
   archive records and must produce matching architecture-specific formula
   stanzas. Intel metadata is no longer withheld pending native acceptance.
   Then, and only then, `writeReleaseMetadata` writes the **final descriptor**
   covering npm, platform archives and stable manager metadata, followed by
   **SHA256SUMS** covering those files and the descriptor. There is no hash cycle.
   Nothing rewrites these bytes after native/cross-validation starts.
6. After the final descriptor and checksums exist, write only
   `windows-tester-input.json`, including the independently verified launcher
   digest. **Do not generate the tester document yet.** Candidate verification
   rejects prematurely generated `handoff/` content.
7. All matrix jobs download the same immutable candidate artifact by ID, bind it
   to saved descriptor/checksum/source pins, and record candidate-bound evidence.
   The native lifecycle extracts the downloaded archive; independent test
   builds must first reproduce its exact payload/platform digests.
8. Sealing first requires completed native standalone **and Homebrew** evidence
   from macOS arm64, the Windows cross-only gate, and Intel deterministic
   archive/formula evidence. Only then does it generate
   the candidate-bound T-60 document under `handoff/`, **outside `assets/`**,
   avoiding a final-descriptor/prompt hash cycle. The resulting immutable review
   bundle includes explicit publication readiness.
   Its inventory binds `assets/`, deferred identity inputs, `handoff/`,
   `context.json`, and `evidence/` with exact sizes
   and hashes. Unexpected files, symlinks, empty directories, stale evidence,
   Windows/Intel native claims, mismatched architecture stanzas, and Linux
   archives fail verification.

While T-60 content completeness remains `PendingIntegration`/`NotRun`, the bundle
records `publicationReady: false`. All production draft, npm and acceptance
entrypoints reject it before making external requests. Flipping that flag in
the bundle cannot bypass verification: readiness is recomputed from the verified
handoff. An immutable review artifact is not permission to publish.

The candidate artifact is intermediate, not a publication input. Only the
sealed bundle is downloaded by publication jobs, by exact artifact ID. The
handoff summary records run ID, artifact ID, GitHub artifact ZIP digest,
bundle-manifest SHA-256 and source commit. Save these before artifact expiry
(90 days for the sealed bundle); never regenerate a bundle to resume a release.
No `overwrite` upload or `--clobber` path exists.
Partial gate retries select the latest attempt **per target** from the same
run, retain earlier successful targets that were not rerun, and recheck candidate
identity. A newer failed result can never be replaced by an older passing result.
Publication-only retries download the already sealed artifact ID without
rebuilding or resealing anything.

## Homebrew integration boundary

No Homebrew implementation is copied into release CI. Until a later cherry-pick,
candidate preparation can write `homebrew-input.json` and record `NotIntegrated`,
but **the required ARM64 native and Intel formula jobs cannot pass and the
release cannot be sealed or published**. A passing standalone/archive test is
not a substitute for Homebrew. The
staged generator interface is:

```js
import { generateHomebrewFormula } from './packaging/homebrew/generate-formula.mjs';
const formula = await generateHomebrewFormula({
  descriptor, // verified archive-stage descriptor, before manager metadata
  artifactDirectory, // resolved candidate assets directory
  mode: 'stable',
  architectures: ['arm64', 'x64'],
});
// Existing return: {filename, kind:'homebrew', contents, sha256, size, mode}.
```

This is the committed Homebrew branch's existing API, not a new generator.
`homebrew-input.json` stores the archive-stage descriptor and relative
`artifactDirectory: "assets"`; consumers resolve that path against the candidate.
`prepareRelease({homebrewGenerator})` also accepts that function directly.
The descriptor contains both macOS archives. The adapter statically checks the
generator's bounded `on_macos` / `on_arm` / `on_intel` source stanzas: each exact
versioned URL and SHA-256 must appear under its matching architecture. Missing,
duplicate, swapped or overriding sources, an arm64-only guard, Linux sources,
or a missing/incorrect Node dependency fail validation. The bounded static
contract requires one unconditional runtime `depends_on "node@22"` alongside
`depends_on :macos`; build-only, optional, conditional, duplicate or conflicting
Node dependencies fail. Static matching is **not** reported as `brew audit` or
`brew style` evidence.

The Intel gate independently packs the source npm payload and compares its bytes
to the frozen tgz, rebuilds both macOS archives twice, checks archive hashes and
sizes, and verifies the Intel platform identity as `darwin/x64`. It then calls
the existing generator twice in separate directories using the archive-stage
descriptor, compares the entire generated formula bytes via their hashes/sizes,
and requires the stable formula to equal the frozen release metadata. Actual
host Homebrew audit/style must then succeed. Its
evidence binds both architecture records, the Intel archive and final formula
back to the candidate before sealing. A missing generator is `NotRun`/`Blocked`,
not an implicit pass. Prereleases use two deterministic test-only loopback
candidate formulas outside release assets and never publish stable metadata.
The current Homebrew implementation fixes the public destination to
`urmich/ai-sdlc-framework`; another approved destination fails closed until that
workstream adds an explicit repository parameter. It also rejects build-metadata
versions; release CI does not silently change its version policy.
Stable generation is detected automatically when the module exists, with errors
blocking the candidate rather than silently omitting a broken integration.
Prereleases omit stable formula publication.

Remaining Homebrew integration work is the generator cherry-pick/adapter plus
its real native local-formula lifecycle (including prerelease test-only evidence)
and stable public acceptance. The standalone arm64 gate is not Homebrew evidence.
The existing native hook is
`verifyHomebrewLifecycle({brew, candidateDirectory, upgradeDirectory?, root})`
from `scripts/homebrew-lifecycle.mjs`; it requires a separately bootstrapped,
isolated Homebrew prefix and project-local root. No system Homebrew mutation is
implied by the generator interface.
The CI adapter invokes this hook against the frozen candidate, requires native
arm64 success including cleanup, and retains its returned command evidence.
Set `RELEASE_HOMEBREW_BREW` in the workflow (or `SDLC_HOMEBREW_BREW` locally) to
the approved isolated executable after the Homebrew workstream supplies its
bootstrap. A missing generator/hook/prefix reports `NotRun` with a `Blocked`
diagnostic and fails the mandatory job. Hook/assertion failures remain `Failed`;
owned failure workspaces are retained for diagnosis rather than deleting rollback
state. The job records Node, machine architecture, runner image, `uname -m`, and
the actual `sysctl.proc_translated` probe result.
Do not advertise Homebrew availability merely because a draft or npm handoff
succeeded without that integration.

### Required metadata audit/style in both macOS jobs

`scripts/homebrew-quality.mjs` is release orchestration, not a second formula
generator. Both macOS paths call its `verifyHomebrewQuality` against the exact
stable formula, or the deterministic test-only dual-architecture formula for a
prerelease. It verifies source metadata first, stages identical formula bytes in
a new isolated tap, and requires these real tool commands:

```sh
brew style /isolated/tap/Formula/ai-sdlc-framework.rb
brew audit --strict --formula --os=macos --arch=intel local/<owned-tap>/ai-sdlc-framework
# ARM64 uses --arch=arm, before invoking the native lifecycle hook.
```

`--os`/`--arch` select Homebrew's metadata evaluation context; they do not run
macOS or Intel binaries on Linux. No `--fix`, `--skip-style`, `--except`,
`--only`, online-audit override, package install or formula test is used in
the quality runner. Frozen formula bytes are rehashed between and after tools.
Nonzero exits, mutation, missing tools or redirected directories fail closed;
metadata/static success cannot substitute for missing audit/style evidence.

Provision a pinned, disposable Homebrew checkout/prefix under each job's
`source/.test-data/`, with its supported Ruby, audit/style gems and `node@22`
formula metadata already available. Set **`RELEASE_HOMEBREW_INTEL_BREW`** for
the Ubuntu job and `RELEASE_HOMEBREW_BREW` for native macOS. The runner refuses
system/external prefixes or repositories, sanitizes tool credentials/options,
uses owned caches/home, does not auto-update Homebrew, and deletes only its
newly created tap. Missing provisioning is a release integration blocker.

Both gates retain the candidate identity, formula SHA-256/size, explicit
unconditional runtime Node dependency, tool version, exact architecture-specific
audit/style arguments and successful command results. Sealing verifies that
record against the same final candidate and rejects missing, stale or failed
quality evidence. Native ARM64 additionally requires the lifecycle hook's real
`homebrewRuntime` to identify native `darwin/arm64` Node 22. No quality check
changes native Intel's `NotRun` status or fabricates native acceptance.

## T-60 Windows tester handoff

`packaging/windows-tester/generate.mjs` exposes:

```js
const input = windowsTesterInput(finalRelease, repository, launcherSha256);
validateWindowsTesterInput(input);
generateWindowsTesterPrompt({ outputDir, ...input, readiness });
validateWindowsTesterPrompt({ outputDir, ...input, readiness });
```

`windowsTesterInput(finalRelease, repository, launcherSha256)` supplies the exact final source
commit, version, npm SHA-256/inventory digest, descriptor/checksum SHA-256, Windows
x64 archive filename/size/SHA-256, launcher SHA-256 and approved repository.
Candidate verification independently matches the launcher digest to the verified
Windows archive's platform metadata. The input also pins the source template
SHA-256 so changing that template after candidate freeze requires a new candidate.
The generator derives
version-specific public URLs, includes the source template's digest, and writes
LF-only deterministic `windows-tester-prompt.md` and a canonical JSON binding.
Validation recomputes both complete files and rejects stale source/version,
URL/digest drift, missing/extra files, unresolved inputs, and modified content.

The Windows job validates only the deferred identity input; it does not generate
a prompt or claim T-60 completeness. After all implementation/native gates pass,
`windowsTesterReadiness` supplies candidate-bound completion prerequisites;
generation before that point is rejected. The later generation validator reports
only binding/determinism success. `completionValidation: NotRun`,
`nativeExecution: NotRun` and `contentStatus: PendingIntegration` remain explicit.
The editable template `packaging/windows-tester/prompt.md.template` provides
candidate identity and safety/evidence boundaries, not finalized native
acceptance scenarios. Finalize its content and implement the full deterministic completeness checks
listed in T-60 after all installer integration. Only real completeness
validation may produce a publication-ready bundle; do not replace the pending
status with an unconditional passing flag. Then regenerate and reseal a new
candidate; never edit the immutable handoff
in place or reinterpret generation success as T-60/native execution success.

The handoff is retained inside the immutable CI bundle, not included in the
release descriptor, SHA256SUMS, or automatic GitHub asset upload. This preserves
final-digest binding without a hash cycle. A separately authorized native tester
can consume it later; no native Windows execution is enabled by this hook.

## Explicit publication handoffs

Tag events **never publish**. Manual dispatch defaults both `publish_draft` and
`publish_npm` to false. Configure reviewer-protected `release`, `npm`, and
`release-acceptance` environments, allowed refs, and permissions before enabling
these inputs; workflow syntax cannot itself enforce reviewer configuration.
Do not run these jobs against unreviewed source.

### GitHub draft assets

`publish_draft` grants only that job contents-write and uses `RELEASE_ASSETS_TOKEN`
when the approved asset repository differs from the source repository; otherwise
the job-scoped GitHub token may suffice. Use the least-privilege approved token.
The destination must be public, and a **pre-existing tag** must resolve to the
exact validated source commit, including annotated-tag dereferencing. For a
separate asset repository, arrange that tag/commit independently through its
approved process. This workflow never pushes, creates, or moves a tag.

The job creates or resumes a matching **draft**. Before adding any missing asset,
it compares every existing asset's size and downloaded bytes against the frozen
bundle. Identical assets are a no-op. Wrong content, incomplete asset state,
duplicates, unexpected names, private destination, mismatched tag, or an already
public release fails without overwriting/deleting anything. Failed partial
uploads can be resumed only with the same bundle. The job never undrafts, changes
latest status, or labels a draft anonymously available.

An authorized reviewer publishes the draft separately after reviewing evidence,
manager-integration limitations and channel policy. Then run live acceptance.

### npm

`publish_npm` is a separate explicit handoff, not an automatic tag side effect.
Configure npm trusted publishing for **`release.yml`**, its `npm` environment,
the actual public source repository, and Node 24/current npm. An approved
`NPM_TOKEN` is an optional fallback. `package.json` repository identity must match
the publishing source repository. Public-source publication requests provenance;
private source does not claim public provenance.

The job verifies the downloaded bundle and passes only
`assets/ai-sdlc-framework-<version>.tgz` to `npm publish --ignore-scripts`.
Stable versions use `latest`; prereleases use `next` (build metadata containing
a dash does not make a version prerelease). It never repacks, bumps versions,
or changes package contents. An already published version is a no-op **only**
after anonymous SHA-256 and registry SHA-512-integrity comparison; different bytes
fail. An identical existing version does not rewind/move dist-tags.

There is no claim of transactional rollback between GitHub and npm. Record each
channel's real state; resume from the same bundle. Publishing npm does not make
a GitHub draft public.

## Postpublication acceptance hooks

Run `release-acceptance.yml` explicitly with the saved run ID, exact artifact ID,
bundle-manifest SHA-256, and source commit. Check out that source commit so
comparison builds are meaningful; modified/expired/missing inputs fail.

The artifact download authenticates only to retrieve saved evidence. Public
GitHub assets and npm metadata/tarballs are subsequently fetched **without
authentication**, outside an inherited npm cache. The verifier compares the
downloaded descriptor/checksums against the saved pins and every archive/manager
file against the immutable inventory **before extraction/execution**. A private,
unpublished, stale or unavailable asset is a failure, not a passed local test.

Native Apple Silicon runs the full standalone lifecycle on those public bytes.
Optional npm acceptance fetches the exact anonymous registry version, verifies
SHA-256 plus SHA-512 integrity, and installs its downloaded tgz in an isolated
home/cache through the existing npm lifecycle verifier. Installer lifecycle is
network-denied; successful downloading is separate from offline operation.
Runtime/user-content preservation and explicit purge remain covered by the
native distribution tests.

`acceptRelease({hooks: {homebrew}})` is a required stable-only extension point receiving
`{bundle, downloaded, environment}`. A supplied hook must return real
`{status:'Passed', ...evidence}` or acceptance fails. Without the required hook,
stable acceptance is `NotRun`/`Blocked`, not Passed. Prereleases mark published
Homebrew acceptance `NotApplicable` and retain the native local-formula gate. Native Windows,
Intel and WinGet community/client acceptance remain explicitly `NotRun`.
The acceptance result is a new artifact, never a mutation of prepublication
evidence. OS/network/package-manager policy failures must be investigated through
approved channels; no workflow disables controls or promises a CFS bypass.

## Local validation (no publication)

Use project-local scratch storage, the exact pinned Go toolchain, and the pinned
Python schema dependencies in an isolated environment:

```sh
mkdir -p .test-data/scratch
export TMPDIR="$PWD/.test-data/scratch"
node --test test/release-ci.test.mjs test/winget.test.mjs test/winget-smoke.test.mjs
npm run check
node scripts/release-bundle.mjs prepare --output-dir .test-data/candidate \
  --repository approved-owner/public-assets
node scripts/release-gate.mjs --candidate-dir .test-data/candidate \
  --evidence-dir .test-data/evidence --target windows-x64
# Only on actual native Apple Silicon; fails closed if isolation is unavailable:
node scripts/release-gate.mjs --candidate-dir .test-data/candidate \
  --evidence-dir .test-data/evidence --target macos-arm64
# Mandatory deterministic Intel archive/formula checks; no native execution:
node scripts/release-gate.mjs --candidate-dir .test-data/candidate \
  --evidence-dir .test-data/evidence --target macos-x64
node scripts/release-bundle.mjs seal --candidate-dir .test-data/candidate \
  --evidence-dir .test-data/evidence --output-dir .test-data/release-bundle
```

Use `SDLC_GO`/`SDLC_PYTHON` for explicit local tool paths. Preparation/sealing
require empty dedicated output directories and never recursively clear
unowned output. Unit-test mock gates and mock publication requests are isolated
fixtures, not release/native/external evidence. Local tests do not publish,
push, tag, mutate remotes, or establish external package-manager acceptance.
The full `npm test` suite additionally requires scratch storage with no Git
repository ancestor for its intentionally non-Git workspace fixtures. CI checks
out into `source/` and uses a workspace-owned sibling `.test-data/` scratch
directory, never system temporary storage. For a local full-suite run, provide
an explicitly owned non-Git scratch directory in your development workspace;
the targeted installer/release commands above can use checkout-local scratch.
