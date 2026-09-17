# WinGet distribution contract

Implements the WinGet portion of FR-053 / T-51 / T-52 and Technical Design
3.1–3.2. npm remains the simplest general installation channel. WinGet packages
the **same** verified `ai-sdlc-framework-<version>-windows-x64.zip` used by the
standalone installer; it does not rebuild JavaScript or run `install.ps1`.

## Reproducible launcher

Source: `cmd/sdlc-launcher/main.go`, licensed under the repository's MIT license.
Build contract: [`toolchain.json`](toolchain.json). Pin **Go 1.27.1** in CI;
`cmd/sdlc-launcher/go.mod` has the same exact version. There are no Go module
dependencies or bundled Node runtimes.

```sh
node packaging/winget/build-launcher.mjs --output-dir dist/winget-launcher
```

`SDLC_GO` optionally names an installed Go executable, **not** another permitted
version. The builder rejects other versions and disables automatic toolchain and
module downloads. It fixes `CGO_ENABLED=0`, `GOOS=windows`, `GOARCH=amd64`,
`GOAMD64=v1`, `-trimpath`, `-buildvcs=false`, and `-ldflags=-buildid=`, ignoring
ambient Go settings, including every case variant of `GOCACHEPROG` so an external
cache program cannot replace the independent local caches. Two builds in different project-local directories and
fresh caches must produce identical bytes. The builder also verifies the PE
machine type is AMD64. It does not sign or timestamp the executable.

The exported integration API is:

```js
import { buildLauncher } from './packaging/winget/build-launcher.mjs';
const launcher = await buildLauncher({ outputDir: 'dist/winget-launcher' });
// {artifact, filename:'sdlc.exe', sha256, size, toolchain:'go1.27.1'}
```

Copy the returned bytes to **`bin/sdlc.exe`** in the shared Windows staging tree,
with mode `0644`. Use an empty, dedicated builder output directory; unknown
files/directories or symlink outputs fail rather than being deleted.

The executable resolves its actual file path through WinGet's symlink before
looking up **`../package/bin/sdlc.mjs`**. It never finds the payload through PATH,
the current working directory, or a global npm installation. It selects the
explicit absolute `SDLC_NODE` executable when provided, otherwise selects Node
from PATH, resolves its executable, and probes the actual runtime for stable
Node **22+**, `win32`, and `x64`. Windows batch shims, missing/non-executable
Node, incompatible/shadowed runtimes, missing/escaping payloads, and failed
preflight stop before framework invocation. The same absolute Node executable
is used for execution. An empty, relative, missing or incompatible `SDLC_NODE`
override fails without falling back to PATH. `NODE_OPTIONS` and `NODE_PATH` are removed from both
preflight and execution to prevent preload code before validation.

Before executing any package JavaScript (including a JS verifier or purge
command), the native Go verifier in `cmd/sdlc-launcher/integrity.go` checks:

* Strict, canonical `payload-manifest.json` and `platform.json`, matching identity,
  version, native platform/architecture, metadata references and launcher SHA-256.
* The embedded npm `.tgz` SHA-256 and its bounded, regular-file-only USTAR
  inventory. The declared inventory and its canonical digest must match the
  independently derived embedded archive inventory, not merely a rewritten
  extracted-file manifest.
* Every extracted `package/**` path, type, size, SHA-256 and mode, rejecting
  missing/extra files or directories, duplicate/case-aliased/escaping paths,
  symlinks, junctions, archive links, unsupported modes and missing required
  payload files.

Windows does not retain POSIX permission bits; the verified embedded tar modes
are authoritative there. On POSIX test hosts, extracted modes are also checked.
WinGet may maintain its own portable index outside `package/`; that
non-executable manager metadata is not part of the npm payload inventory.
These embedded checks are defense in depth, not a replacement for authenticating
the outer archive before extraction. Rewriting the entire local archive and all
its hashes is not prevented by writable embedded metadata.

Arguments are passed without a shell; stdin/stdout/stderr, the working
directory, and the CLI exit code are preserved. Ordinary invocation does not
itself install or purge framework state.

The native archive launcher does not interpret channel-current pointers.
Standalone promotion atomically replaces a channel-owned `current.ps1`
dispatcher, which resolves the absolute immutable
`versions/<version>/bin/sdlc.exe` from its own `$PSScriptRoot`. It requires no
user-created symlink or administrator rights. Copying the native archive
launcher to a payload-free channel root is not supported.

## Manifest input and output

The generator consumes the Windows archive record **before** the outer release
descriptor exists, avoiding an archive/descriptor/manifest digest cycle:

```json
{
  "version": "0.3.0",
  "releaseRepository": "approved-owner/public-release-assets",
  "archive": {
    "filename": "ai-sdlc-framework-0.3.0-windows-x64.zip",
    "kind": "archive",
    "sha256": "<64 hexadecimal characters>",
    "size": 123
  },
  "archivePath": "dist/ai-sdlc-framework-0.3.0-windows-x64.zip"
}
```

`releaseRepository` must explicitly identify the approved **public** GitHub asset
repository; it is not inferred from a possibly private source repository.
Public reachability is separate postpublication evidence, not a generator claim.
`archivePath` is optional for rendering but required for actual validation.
Before either step, the shared platform verifier must establish complete ZIP
inventory, embedded payload integrity, version, and launcher identity. WinGet
validation independently binds the exact ZIP filename, size, header and SHA-256;
it does not replace that full inventory verifier.

```sh
node packaging/winget/generate.mjs --input winget-input.json --output-dir dist/winget
node packaging/winget/validate.mjs --input winget-input.json --manifest-dir dist/winget
# On native Windows x64, also require actual WinGet schema/semantic validation:
node packaging/winget/validate.mjs --input winget-input.json --manifest-dir dist/winget --native
```

`generateManifests({outputDir, ...input})` returns:

```js
{
  schemaVersion: 1, version, packageIdentifier, testOnly,
  publicationEligible: false, communityAccepted: false, clientAvailable: false,
  files: [{filename, kind: 'winget', sha256, size, artifact}]
}
```

The three deterministic UTF-8/LF output filenames are:

* `Urmich.AISDLCFramework.installer.yaml`
* `Urmich.AISDLCFramework.locale.en-US.yaml`
* `Urmich.AISDLCFramework.yaml`

Each `files` entry, excluding its local `artifact` path, is ready for the shared
release descriptor. Include all three **stable** files, then render the final
descriptor and `SHA256SUMS`. Submission layout is
`manifests/u/Urmich/AISDLCFramework/<version>/`; the files can remain flat in the
immutable release bundle.

Manifests use official WinGet schema **1.10.0**, `InstallerType: zip`,
`NestedInstallerType: portable`, `RelativeFilePath: bin\sdlc.exe`,
`PortableCommandAlias: sdlc`, user scope, and x64 only (other Windows OS
architectures are explicitly unsupported). They declare `OpenJS.NodeJS.LTS`
with minimum version `22.0.0`. Stable URLs are exactly
`https://github.com/<releaseRepository>/releases/download/v<version>/<archive>`.
The stable PackageIdentifier is constant across versions and
`UpgradeBehavior: install` enables same-package replacement.

Portable WinGet owns its package directory and
`%LOCALAPPDATA%\Microsoft\WinGet\Links\sdlc.exe`. It preserves the full extracted
archive and links to the nested executable; copying only `sdlc.exe` would break
relative payload resolution. The manifest does not claim a fixed source-specific
ProductCode or install root and does not alter PATH or register a competing shim
itself. WinGet manages PATH/alias registration and its own uninstall entry.

After community acceptance, the channel commands are:

```powershell
winget install --id Urmich.AISDLCFramework --exact --scope user
winget upgrade --id Urmich.AISDLCFramework --exact --scope user
winget uninstall --id Urmich.AISDLCFramework --exact --scope user
```

The last command is the **channel uninstall command**, not `sdlc uninstall`.
There is deliberately no unsupported `UninstallString` manifest property,
custom installer/uninstaller switch, or invocation of `sdlc uninstall --purge`.
Package-manager install/upgrade/uninstall changes only its owned payload/link.
Users explicitly run the newly installed launcher by absolute path with
`install`, `update`, `doctor`, `install --purge-existing`, or `uninstall`
when changing their Copilot-home installation. Restart/reload Copilot as
directed by the CLI; there is no hot-reload claim.

During a channel switch, invoke and verify the **new absolute launcher** before
removing the old channel. Never use PATH precedence to choose the new payload.
If validation fails, retain the old payload and remove only the new owned
package; an explicitly requested framework purge cannot be rolled back.

## Prerelease and native validation

Prereleases are rejected by default. Native candidate tests explicitly set
`testOnly: true` and
`candidateUrl: "http://127.0.0.1:<port>/<exact-archive-filename>"`.
Only a loopback HTTP URL with an explicit port, matching filename and no
credentials/query/fragment is accepted. Local stable candidates can use the
same test-only mode.

Test manifests are conspicuously marked, use the separate identifier
`Urmich.AISDLCFramework.Test` and alias `sdlc-test`, and never overwrite a stable
manifest directory. **Discard them after native tests; do not include them in
the release descriptor, public assets, stable metadata, or community submission.**
They are never publication-eligible, even after native validation.

Use a WinGet client supporting manifest schema 1.10.0. The validator compares the entire candidate-bound canonical manifest set,
rejecting missing/extra/duplicate/changed fields, stale URLs/versions/digests,
wrong architecture, missing Node dependency, unsafe uninstall/upgrade semantics,
and unowned output files. `--native` also invokes
`winget validate --manifest <directory> --disable-interactivity` and requires an
actual Windows x64 process. Without that native check, output is only
`contract-validated`, **not** `repository-ready`. Even repository-ready metadata
is not community acceptance or real-client discoverability.

Native portable lifecycle smoke, on a disposable Windows x64 runner:

```sh
node packaging/winget/smoke.mjs --input BEFORE.json --upgrade-input AFTER.json
```

The two inputs must refer to independently verified archives with distinct
versions, in increasing order. The script checks native host architecture,
refuses an existing test alias/package, starts and probes a loopback candidate
server, creates test-only manifests, runs real WinGet validation and same-ID
install/upgrade/uninstall in paths with spaces, checks the Links target, invokes
the absolute launcher's explicit framework install/update/doctor, requires empty
doctor findings after install, upgrade and removal, and snapshots
Copilot-home preservation across package operations. It proves that installed
framework code survives channel removal by executing the actual installed
`sessionStart` hook with its recorded retained Node executable, requiring valid
hook output and no process errors, then running doctor again. Cleanup retains its workspace if
WinGet ownership/cleanup cannot be established. Native policy/access failures
remain `NotRun` with a separate `Blocked` diagnostic; assertion failures are
`Failed`, not passed or silently skipped.

This script **does not enable local manifests, modify policy, skip dependency
resolution, bypass OS execution controls, or guarantee a CFS workaround**.
WinGet local-manifest support and any required Node dependency/source access
must already be approved for the test runner. Native standalone cmd/PowerShell
purge/migration/hook tests remain the shared installer smoke job's responsibility.

## Local checks and CI integration

```sh
cd cmd/sdlc-launcher && go test ./... && go vet ./...
# From the repository root; setting SDLC_GO also enables host-native launcher tests:
SDLC_GO=go node --test test/winget.test.mjs test/winget-launcher-native.test.mjs test/winget-smoke.test.mjs
node packaging/winget/build-launcher.mjs --output-dir dist/winget-launcher
```

On Windows, `winget-launcher-native.test.mjs` always requires Go; other hosts
enable it with `SDLC_GO`. Go fixtures, build caches and launcher fixtures live
under project-local `.test-data`; generated binaries/manifests live in ignored
`dist`. Configure the host Go test command's `GOTMPDIR`/`TMPDIR`/`TEMP` to an
existing project-local directory when host temporary storage is prohibited.
`SDLC_VERIFY_SHARED_ROOT` optionally points Go tests at an independently verified,
extracted shared Windows archive for canonical-schema interoperability coverage.

Integration requirements for the shared packager / CI owner:

1. Pin Go 1.27.1 (for example, `actions/setup-go` with
   `go-version-file: cmd/sdlc-launcher/go.mod` and module caching disabled).
2. Build the launcher through the API, place its exact bytes at `bin/sdlc.exe`,
   and include it in the shared Windows archive allowlist and independent
   rebuild verification. Never rebuild the framework payload for WinGet.
3. Generate stable manifests only after the ZIP digest exists; place their
   descriptor-ready records into the shared immutable release bundle.
4. Native Windows gates must run Go tests, launcher tests, `--native` manifest
   validation and the portable lifecycle smoke, including prerelease test-only
   manifests. A missing or blocked required result must block publication.
5. Retain local/native validation separately from community submission and
   later anonymous WinGet discovery/install evidence. No remote mutation is
   performed by the build, generator, validator, or local test suite.

Local development also validated all six rendered stable/test manifest files
against the official WinGet 1.10.0 JSON schemas. This is schema evidence only:
macOS cross-compilation and fixture tests cannot establish native Windows
installation, WinGet community acceptance, or client availability.
