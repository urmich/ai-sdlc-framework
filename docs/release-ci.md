# Scoped release CI and acceptance

## Release policy

| Target | Prepublication requirement | Published installer |
| --- | --- | --- |
| macOS Apple Silicon `macos-arm64` | **Mandatory native lifecycle**, native Node/machine/anti-Rosetta checks, enforced network/npm-denied lifecycle with negative controls | Yes |
| Windows `windows-x64` | **Mandatory deterministic cross-build/PE/schema/URL/metadata/pre-JS payload-integrity checks**, plus T-60 prompt binding validation | Yes; no native execution claim |
| macOS Intel `macos-x64` | Unsupported; explicit native `NotRun`, non-blocking | **No**; any separately generated preview is excluded from supported release and Homebrew metadata |
| Linux `linux-x64` | Out of scope | **No** |

The generic platform library's `complete` flag describes its four supported
targets. Initial release eligibility instead uses exactly **two platform
archives: Windows x64 and macOS arm64**, plus the same npm tgz, and the required
gates above. Linux is outside this release entirely. Generic codec fixtures do
not create supported releases. Intel preview generation is optional developer
work outside this workflow; previews must never enter the immutable supported
release or stable Homebrew metadata.
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
no Intel runner, job or artifact prerequisite. Sealing records unsupported Intel
as `NotRun` directly when no optional status record exists, without claiming
execution on any host.

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
   verification. `buildPlatforms` wraps the exact tgz for only the two
   release targets. `verifyRelease` independently rebuilds and checks inventory.
4. WinGet consumes the verified Windows ZIP record (name/size/SHA-256), not the
   final descriptor. Stable versions generate all three deterministic manifests.
   Prereleases validate conspicuous test-only loopback manifests outside assets;
   those files are never published or submitted.
5. The optional Homebrew interface consumes only the verified **macOS arm64**
   archive record and must produce an explicitly arm64-only stable formula.
   Then, and only then, `writeReleaseMetadata` writes the **final descriptor**
   covering npm, platform archives and stable manager metadata, followed by
   **SHA256SUMS** covering those files and the descriptor. There is no hash cycle.
   Nothing rewrites these bytes after native/cross-validation starts.
6. After the final descriptor and checksums exist, generate the candidate-bound
   T-60 Windows tester prompt under `handoff/`, **outside `assets/`**. Its binding
   can include both final digests without creating a descriptor/prompt hash cycle.
7. All matrix jobs download the same immutable candidate artifact by ID, bind it
   to saved descriptor/checksum/source pins, and record candidate-bound evidence.
   The native lifecycle extracts the downloaded archive; independent test
   builds must first reproduce its exact payload/platform digests.
8. Sealing requires both mandatory gates to pass, checks the explicit Intel
   `NotRun`, and emits one v4 immutable `release-bundle-<version>-<run>-<attempt>`.
   Its inventory binds `assets/`, `handoff/`, `context.json`, and `evidence/` with exact sizes
   and hashes. Unexpected files, symlinks, empty directories, stale evidence,
   Windows native claims, and Intel/Linux archives fail verification.

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
the candidate writes `homebrew-input.json` and records `NotIntegrated`; it does
not invent formula or native Homebrew evidence. The staged interface is:

```js
import { generateHomebrewFormula } from './packaging/homebrew/generate-formula.mjs';
const formula = await generateHomebrewFormula({
  descriptor, // verified archive-stage descriptor, before manager metadata
  artifactDirectory, // resolved candidate assets directory
  mode: 'stable',
});
// Existing return: {filename, kind:'homebrew', contents, sha256, size, mode}.
```

This is the committed Homebrew branch's existing API, not a new generator.
`homebrew-input.json` stores the archive-stage descriptor and relative
`artifactDirectory: "assets"`; consumers resolve that path against the candidate.
`prepareRelease({homebrewGenerator})` also accepts that function directly.
The descriptor contains **no Intel archive**. The adapter writes returned
contents only after checking the exact arm64 URL/digest, one architecture guard
(`depends_on arch: :arm64`), absence of Intel metadata, and shared size/hash
checks. The earlier dual-architecture generator will fail closed until its
arm64-only corrective cherry-pick arrives; do not supply an Intel preview to
work around that failure. Native Intel acceptance and a deliberate support-policy
change are prerequisites for later adding Intel to stable Homebrew metadata.
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
Do not advertise Homebrew availability merely because a draft or npm handoff
succeeded without that integration.

## T-60 Windows tester handoff

`packaging/windows-tester/generate.mjs` exposes:

```js
generateWindowsTesterPrompt({ outputDir, identity, releaseRepository, inventoryDigest, archive });
validateWindowsTesterPrompt({ outputDir, identity, releaseRepository, inventoryDigest, archive });
renderWindowsTesterPrompt({ identity, releaseRepository, inventoryDigest, archive });
```

`windowsTesterInput(finalRelease, repository)` supplies the exact final source
commit, version, npm SHA-256/inventory digest, descriptor/checksum SHA-256, Windows
x64 archive filename/size/SHA-256, and approved repository. The generator derives
version-specific public URLs, includes the source template's digest, and writes
LF-only deterministic `windows-tester-prompt.md` and a canonical JSON binding.
Validation recomputes both complete files and rejects stale source/version,
URL/digest drift, missing/extra files, unresolved inputs, and modified content.

The Windows job requires **generation/binding validation**, not execution of the
prompt. It reports `generationValidation: Passed` only after validation while
`nativeExecution: NotRun` and `contentStatus: PendingIntegration` remain explicit.
The editable template `packaging/windows-tester/prompt.md.template` provides
candidate identity and safety/evidence boundaries, not finalized native
acceptance scenarios. Finalize its content after all installer integration,
then regenerate and reseal a new candidate; never edit the immutable handoff
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

`acceptRelease({hooks: {homebrew}})` is a stable-only extension point receiving
`{bundle, downloaded, environment}`. A supplied hook must return real
`{status:'Passed', ...evidence}` or acceptance fails. Without a hook, Homebrew is
`NotRun`; prereleases never claim published Homebrew acceptance. Native Windows,
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
# Intel needs no job: sealing adds an explicit unsupported/NotRun record.
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
