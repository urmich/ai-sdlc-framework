# Standalone distribution interface

This directory is part of the npm payload. Platform packaging copies these
installers and the POSIX launcher **from the exact npm archive**, not from a
second source build. The Windows native launcher is supplied by the WinGet
build interface. Node.js 22+ for the native host architecture is required;
there are no runtime npm dependencies or installer network requests.

## Building and verifying

```sh
npm run package:artifact
npm run package:platforms -- --artifact dist/ai-sdlc-framework-0.3.0.tgz \
  --windows-launcher /absolute/path/to/sdlc.exe
npm run verify:platforms -- --windows-launcher /absolute/path/to/sdlc.exe
npm run test:distribution
```

Use the version from `package.json`, not a separately chosen channel version.
The generic default build supports all four targets. Its `complete` flag means
all library targets, not release eligibility. The current
[release orchestration policy](../../docs/release-ci.md) explicitly selects
`macos-arm64,macos-x64,windows-x64` and excludes Linux publication. Intel standalone
archives and stable Homebrew metadata are published after mandatory deterministic
archive/formula URL/checksum/architecture validation and host Homebrew audit/style
with the correct Node runtime dependency, without claiming native
Intel lifecycle acceptance. CI verifies
that exact allowlist and separate required evidence instead of using `complete`.
Other ad hoc target subsets do not establish release eligibility.
The output directory must contain only the exact owned candidate filenames.
Packaging never recursively clears an output directory.

Exports for release orchestration:

- `buildPlatforms({artifact, outputDir, windowsLauncher, sourceCommit,
  metadataFiles, environment, targets})`: deterministic archives and metadata.
- `writeReleaseMetadata({outputDir, artifact, sourceCommit, metadataFiles,
  targets})`: finalize metadata **after** Homebrew/WinGet generators consume
  archive digests. Each metadata item is `{file, kind, filename?}`; generator
  output may use `artifact` instead of `file` and supply `sha256`/`size`, which
  are verified before inclusion. Kind is `homebrew`, `winget`, or `metadata`.
  Output filenames are flat and unique.
  The CLI `--metadata path.json` accepts this array.
- `verifyRelease({outputDir, windowsLauncher, environment, targets})`:
  full inventory verification and fresh npm/platform rebuild. The descriptor
  must identify the checked-out revision (or an explicitly supplied
  `sourceCommit`).
- `verifyPlatformPackage({artifact, descriptor?, checksums?,
  expectedPlatform?, expectedArch?, expectedDescriptorSha256?,
  expectedChecksumsSha256?})`: independently verify a single downloaded
  platform archive. This works with only that archive, descriptor and
  checksum file; other release archives need not be downloaded.

Every archive contains `package/`, the exact `.tgz`, `LICENSE`,
`payload-manifest.json`, `platform.json`, and only its allowed launchers.
The external descriptor and `SHA256SUMS` are never embedded in an archive.
Canonical JSON recursively sorts keys and uses UTF-8/LF without timestamps.
The inventory records regular files, sizes, hashes and permission modes.
Paths, duplicates, links, device entries, unexpected wrappers and changed
payloads fail verification. Windows wrapper PowerShell uses CRLF; POSIX
launchers use LF and mode `0755`. ZIP timestamps are fixed at 1980-01-01;
tar/gzip timestamps are zero. Host tools and npm are build-time tools only.

## Verified installation and lifecycle

Before extracting or running downloaded code, obtain the exact release
descriptor, `SHA256SUMS`, and desired archive from the approved public release.
Use the host's `Get-FileHash`, `shasum -a 256`, or `sha256sum` to compare the
archive against **both** the descriptor and checksum record. Confirm version,
platform and architecture. A verifier embedded in downloaded code is not a
substitute for this first external check. Postpublication consumers additionally
compare descriptor and checksum digests with saved prepublication evidence.

After that external verification and extraction:

```sh
sh ./install.sh install
sh ./install.sh update
sh ./install.sh doctor
sh ./install.sh uninstall
sh ./install.sh install --purge-existing
sh ./install.sh uninstall --purge
```

On Windows the equivalent commands are `.\install.ps1 install`,
`.\install.ps1 update`, `.\install.ps1 doctor`, `.\install.ps1 uninstall`,
`.\install.ps1 install --purge-existing`, and
`.\install.ps1 uninstall --purge`. Do not alter OS execution policy to make an
installer run; report the precise policy block and use approved guidance.

`--home` (or `COPILOT_HOME`) selects the framework home. `--channel-root`
selects a separate standalone payload directory; it defaults to
`~/.local/share/ai-sdlc-framework` or
`%LOCALAPPDATA%\ai-sdlc-framework`. `--channel-only` on install/update activates
only the payload and prints its absolute launcher path without touching
Copilot. `SDLC_NODE`, if provided, must name an absolute executable. Otherwise
the first selected Node command on PATH must itself meet the requirements;
an incompatible or shadowing command is not skipped in favor of another.
The effective Copilot home follows the framework's `--home`, `COPILOT_HOME`,
then user-home default precedence. Before any channel write or destructive
operation, existing ancestors and symlink targets are resolved; equal roots
and containment in either direction are rejected, including dangling home
links into a not-yet-created channel. Framework execution receives the
validated canonical home explicitly rather than resolving an alias again.
Uncreated path suffixes are conservatively compared without case distinctions
on Windows and macOS, even on case-sensitive volumes; Linux retains
case-sensitive comparisons. Different spelling cannot defer an overlap until
after directory creation on the commonly case-insensitive platforms.

Each channel version is immutable; same-version/same-digest installation is
idempotent, and a conflicting digest fails. A unique stage is verified before
version rename and current-launcher promotion. On POSIX `current/bin/sdlc` is
the stable launcher through an atomically replaced relative link. On Windows
`current.ps1` is an atomically replaced dispatcher to the immutable native
launcher; administrator symlink privileges are not required. The channel lock
is always released before framework maintenance takes its separate lock.
A busy channel fails after five seconds without stealing its lock. Following
an abrupt process termination, inspect `.channel-lock/owner.json` and confirm
that no installer is running before manually removing that stale lock.
Subsequent activation removes at most 32 reserved abandoned stage/promotion
paths; it never removes installed versions.

Install/update invokes the new launcher by absolute path, never a shadowing
`sdlc` on PATH. Framework hooks reference the installed Copilot-home copy and
the validated absolute Node executable, not the downloaded archive or old
channel. Remove an old package only after the replacement launcher's
install/update and doctor have succeeded **and** its hook-bound Node runtime
is independently retained. These standalone commands never remove a previous
package, its Node runtime, or package-manager dependencies.

For Homebrew switching, capture the old link target, keg, version, Node
dependencies and recoverable rollback state **before any `brew install` or
`brew upgrade`**. `--skip-link` does not guarantee that Homebrew will retain an
old link or keg: installation can unlink or clean it before later verification.
Keep rollback artifacts available until the complete switch is verified.

Before Homebrew-to-npm or Homebrew-to-extracted/standalone removal, retain or
install an independently owned native Node 22+ runtime, including its runtime
dependencies. Merely selecting another symlink to the same autoremove-eligible
Homebrew Node keg is not independent retention. Execute the replacement's
absolute entry with that retained Node, and verify that every installed hook
binds to its surviving real executable path. Run the installed hooks and
`doctor` before removal, then run **both again after** formula removal and
dependency autoremove. A pre-removal doctor alone cannot establish success.
On failure, restore the captured package/link/runtime state where possible and
report the migration incomplete; never report a successful switch or pretend
an explicitly requested purge was rolled back.

Ordinary uninstall preserves framework runtime state and unrelated Copilot content. `--purge-existing` and
`uninstall --purge` are explicit, destructive framework operations; a reported
partial purge is not silently rolled back. These commands do not remove
standalone channel versions. Removing a channel payload separately never
uninstalls the already copied Copilot-home integration.

Restart Copilot CLI after install/update; launchers do not claim hot reload.
Registry policy, CFS quarantine, package exceptions, GitHub download policy,
WinGet policy and OS execution controls remain separate external controls.
This channel neither changes those controls nor promises a bypass.

## Native CI integration

Set `SDLC_DISTRIBUTION_TARGET` to the actual native target when requiring native
evidence. The current release's only mandatory native target is `macos-arm64`, covering
both standalone and Homebrew lifecycle;
Windows is cross-validated; Intel archive/formula evidence is mandatory and
non-execution-only for the target payload. Intel and ARM64 both require actual
Homebrew audit/style, and ARM64 must complete those checks before lifecycle
execution. Native Intel lifecycle remains explicitly `NotRun`.
The test asserts actual
`process.platform`, `process.arch`, native machine architecture and absence of
Rosetta. Set `SDLC_WINDOWS_LAUNCHER` to the independently rebuilt Windows
executable to include Windows ZIP/native lifecycle tests. Windows native CI
fails rather than skips if the expected target is Windows and this input is
missing. Without that input, local non-Windows tests verify the three POSIX
archives and ZIP codec fixtures, not a native Windows release.
`SDLC_DISTRIBUTION_TARGETS` selects the exact archive set.
`SDLC_RELEASE_DIR` selects an already frozen/downloaded release: independent
fixture builds must match its payload and platform archive digests, and native
lifecycle extraction then uses the downloaded candidate bytes, not the fixtures.

The npm-denied lifecycle runs inside an OS-enforced boundary, not a proxy or
command-shim approximation. macOS uses Seatbelt to deny all network operations
and reads of the discovered npm installation directories. Linux uses private
user, mount and network namespaces with read-only empty mounts over npm.
Restricted command resolution contains only the validated Node and required
shell utilities; inherited npm executable references, Node preload/module
paths, proxies and package credentials are absent. Before the positive
lifecycle, live local HTTP and HTTPS endpoints and an actual absolute npm
CLI are proven usable outside the boundary and denied inside it.

Namespace/sandbox availability is probed without changing host policies.
An unavailable adapter is reported as T-51 `NotRun` with a blocked diagnostic;
when `SDLC_DISTRIBUTION_TARGET` selects a mandatory native job, that condition
fails the job rather than allowing publication. Windows currently has no
validated per-process network-and-npm-filesystem isolation adapter and remains
`NotRun` for this specific gate. Proxy settings, global firewall edits, or a
foreign-OS container cannot substitute for the missing native evidence.

Retain the required arm64/native, Windows/cross-validation and Intel/deterministic
archive/formula results, with explicit Intel native `NotRun`, and descriptor/checksum
digests in one immutable release bundle.
Native Homebrew/WinGet validation and anonymous live acceptance are distinct
evidence; local package tests do not establish public availability or
package-manager acceptance. Missing native Homebrew integration is a release
blocker, not an optional passing standalone result.
Prereleases never include stable package-manager metadata or claim
published-Homebrew acceptance. A future local-formula gate must retain its own
prerelease evidence outside the release asset directory.
