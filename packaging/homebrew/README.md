# Homebrew distribution (FR-053, T-51/T-52)

npm (`npx --package ai-sdlc-framework sdlc …`) remains the simplest general
installation path. Homebrew provides an npm-registry-independent package, not
a Node-free, necessarily offline, or policy-bypassing installation.

## Release integration

`generate-formula.mjs` consumes the Technical Design 3.1 descriptor schema and
the already verified archive directory. The input may be the archive-stage
descriptor subset: `schemaVersion`, `name`, `version`, `sourceCommit`, `payload`,
and `files`. This avoids a metadata digest cycle. Do not rebuild the payload for
Homebrew. Generate the formula after independent platform verification; then add
its returned `filename`, `kind`, `sha256`, and `size` to the final descriptor,
and only then render `SHA256SUMS`.

```js
import { generateHomebrewFormula } from './packaging/homebrew/generate-formula.mjs';
const formula = await generateHomebrewFormula({ descriptor, artifactDirectory });
// Write formula.contents to the bundle's ai-sdlc-framework.rb.
// Include formula metadata in the final release descriptor (exclude contents/mode).
```

The generator rehashes both macOS archives and checks their exact filenames,
sizes and architecture-specific digests. The shared platform verifier remains
responsible for the archive inventory, embedded payload, version and platform
identity. Both are required release gates.

Stable output references exactly:

```text
https://github.com/urmich/ai-sdlc-framework/releases/download/v<VERSION>/ai-sdlc-framework-<VERSION>-macos-x64.tar.gz
https://github.com/urmich/ai-sdlc-framework/releases/download/v<VERSION>/ai-sdlc-framework-<VERSION>-macos-arm64.tar.gz
```

Only stable SemVer versions produce public formula metadata; prereleases and
build-metadata versions cannot silently become stable releases. Release
publication must verify this repository and these exact bytes are anonymously
reachable. No URL or checksum placeholder is committed as a usable formula.
The generated formula declares `node@22` (supported Node 22+ LTS), copies the
entire verified archive to `libexec`, and wraps `libexec/bin/sdlc` with the
Homebrew dependency first in `PATH` and its absolute executable in `SDLC_NODE`,
overriding inherited standalone-runtime selections. The standalone launcher
owns runtime and embedded payload preflight. No formula install/upgrade/uninstall
hook invokes the framework or mutates `COPILOT_HOME`. `skip_clean "libexec"` prevents
Homebrew's automatic Node shebang rewriting from changing checksum-bound bytes;
a separate prefix license copy prevents its metafile handling from moving the
archive's license. Both are required for manifest verification after installation.

## Candidate validation, including prereleases

```sh
node --test test/homebrew.test.mjs test/homebrew-switch.test.mjs
node packaging/homebrew/generate-formula.mjs \
  dist/release-descriptor.json dist \
  .test-data/homebrew-tap/Formula/ai-sdlc-framework.rb \
  http://127.0.0.1:8123/
```

The optional final argument explicitly selects **test-only candidate** mode.
It accepts only a loopback HTTP fixture with an explicit port, never a public
prerelease tap. Serve the exact candidate archive directory locally. Local
candidate formulas must not be included in the stable release descriptor or
published tap. Public formulas are generated separately, without that argument.

Run `scripts/homebrew-lifecycle.mjs` on each native macOS architecture, using an
isolated Homebrew prefix and independently verified candidate bundles. The
script exercises real brew style/audit, install with `--skip-link`, formula
test, explicit framework lifecycle, upgrade and uninstall. It snapshots an
isolated Copilot home around package-manager operations. The runner requires
actual `darwin`/`x64` or `darwin`/`arm64`, `uname -m`, and no Rosetta translation.
Local evidence does not satisfy T-52 or the other architecture's native gate.

```sh
node scripts/homebrew-lifecycle.mjs \
  --brew "$PWD/.test-data/homebrew/bin/brew" \
  --candidate-dir "$PWD/dist" \
  --root "$PWD/.test-data/homebrew-lifecycle"
```

The runner refuses to modify a system Homebrew prefix. A local clone of an
existing Homebrew checkout under `.test-data` can provide the isolated prefix;
install its actual `node@22` dependency first. Keep `HOME`, `HOMEBREW_CACHE`,
`HOMEBREW_LOGS`, `HOMEBREW_TEMP` and `TMPDIR` inside that local test tree during
bootstrap. A nondefault prefix may require building a dependency from source.
The runner records JSON evidence and the exact generated formulas under its
new `--root`. With one bundle it exercises a real formula-revision upgrade
using the same verified payload; add `--upgrade-dir NEXT_BUNDLE` to exercise a
version-changing upgrade. CI should use successive candidate versions too.
The test disables automatic install cleanup but does not rely on that flag for
rollback: the switch helper captures the old state first and backs up the old
kegs and dependency closure. Regression fixtures make `brew install` unlink and
delete old kegs before failing. The native reverse test deliberately marks Node
as dependency-only, requires the helper to retain it independently, removes all
old formula versions, runs real `brew autoremove`, then executes the copied
hooks and doctor again.

## End-user lifecycle after authorized stable tap publication

The intended tap is `urmich/ai-sdlc-framework`; do not claim it is available
until anonymous installation is verified. Once published:

```sh
brew tap urmich/ai-sdlc-framework
# From this repository checkout, close Copilot:
node scripts/homebrew-switch.mjs \
  --formula urmich/ai-sdlc-framework/ai-sdlc-framework
# Restart Copilot.

# For an upgrade, refresh tap metadata, close Copilot, and repeat:
node scripts/homebrew-switch.mjs \
  --formula urmich/ai-sdlc-framework/ai-sdlc-framework
# Restart Copilot.

# Optional explicit framework removal BEFORE removing its package:
"$(brew --prefix ai-sdlc-framework)/bin/sdlc" uninstall
# Or use uninstall --purge to explicitly remove framework runtime state.
brew uninstall ai-sdlc-framework
```

Without the explicit `sdlc uninstall`, removing Homebrew's package retains the
installed instructions, skills, hooks, runtime state and copied CLI in
`COPILOT_HOME`. Keep a working Node 22+ runtime for that copied installation;
if a Node upgrade changes its executable path, run the new launcher's explicit
framework update/doctor before restarting Copilot. Do not remove Node while the
retained installation still uses it. Ordinary framework uninstall preserves
modified/unrelated content and runtime state. Clean migration is explicit
`sdlc install --purge-existing`; it is irreversible and is not undone by a
later failed package link operation.

### Safe switching

The normal supported npm (`npx`/extracted payload) installation owns **no global
`sdlc` link**. Before **any** `brew install` or implicit/explicit upgrade, capture
the old link, exact keg versions, dependency receipts, and rollback state.
`--skip-link` does not make this ordering optional: Homebrew may still unlink
or clean an old keg while installing an upgrade. Only after the snapshot is
complete may the helper install with `--skip-link`, invoke the new Cellar
launcher by absolute path, check install/doctor, and promote its link:

```sh
node scripts/homebrew-switch.mjs \
  --formula urmich/ai-sdlc-framework/ai-sdlc-framework
# Add --home PATH or --purge-existing only when explicitly intended.
```

An absent destination is promoted normally. For a known link owned by a
different installed Homebrew keg, supply `--previous-formula TAP/OLD_FORMULA`.
The helper verifies the old Cellar location and captures the link, unlinks the
old keg only after the snapshot, and links the new one after framework checks.
The snapshot includes all installed versions of the affected formulas,
dependency keg contents, receipt identities, and Homebrew's opt/linked-keg
symlinks. If install cleans an old keg, its captured bytes are restored before
framework maintenance; failures restore the exact old version/link rather than
asking `brew link` to select whatever version is now newest. Both payloads
remain available until the user elects to remove the old one.

Snapshots and phase records live outside `COPILOT_HOME`, under
`$(brew --prefix)/var/ai-sdlc-framework-switch/`. A switch lock serializes these
helpers. Successful completion removes backup bytes and retains the result
record. A failed recovery retains its backup and reports `HOMEBREW_SWITCH_INCOMPLETE`
with the recovery record path; unidentified or modified entries are not
overwritten. An interrupted process leaves an `active.lock` identifying the
recovery directory: inspect that state and establish the process is no longer
running before any manual recovery or lock removal. Framework changes,
especially explicit purge, are never claimed to have been rolled back.
Independently requested runtime-retention flags may remain set after failure;
recovery does not make a still-needed runtime eligible for deletion.

An unidentified file/link, including a legacy global npm link, fails **before
brew installation**. Inspect ownership and resolve it manually. Never use
`brew link --overwrite`, remove an unidentified link, or uninstall the old
package before new install/doctor and link verification succeed.

For the reverse direction, supply an independently verified extracted package
or a non-global npm package directory outside the Cellar and `COPILOT_HOME`:

```sh
# Optional npm staging instead of a verified archive (replace VERSION/path):
npm install --prefix /absolute/new-npm-channel --bin-links=false \
  --ignore-scripts 'ai-sdlc-framework@VERSION'
# Close Copilot, then from the repository checkout:
node scripts/homebrew-switch.mjs \
  --formula urmich/ai-sdlc-framework/ai-sdlc-framework \
  --to-extracted /absolute/new-npm-channel/node_modules/ai-sdlc-framework
# Restart Copilot.
```

The reverse helper captures rollback state first, probes the exact native
Node 22+ executable, and uses
`brew tab --installed-on-request --formula node@22` to retain that runtime
independently of the framework formula. It verifies the installed-on-request
receipt before invoking the replacement CLI. Merely finding Node in `PATH`, or
running `doctor` before uninstall, does not prove it will survive autoremove.
The helper verifies the copied hooks bind that retained Node, executes the hooks
and doctor, removes the old formula, and executes hooks and doctor again. A
failure restores the captured channel where possible or explicitly reports
incomplete recovery. No global npm link is created. The helper does not run a
global autoremove on the user's behalf; the isolated native test runs it to
prove dependency-only removal cannot take the retained hook runtime with it.

Microsoft CFS quarantine, approved waiting/package-exception procedures,
registry denial, GitHub download restrictions, Homebrew availability and OS
execution controls are separate diagnoses. A generic network failure is not
proof of CFS; use only organization-approved remediation. Another channel is
never guaranteed to evade those controls.

## Publication acceptance still required

Stable T-52 acceptance remains **NotRun** until separately authorized publication and clean,
anonymous clients verify exact descriptor/checksum/asset bytes and real
published tap install/upgrade/uninstall with empty caches. The local candidate
gate neither publishes nor claims public tap availability. Stable publication
requires both native macOS gates and postpublication Homebrew acceptance;
prerelease published-Homebrew acceptance is **not applicable**. Prereleases must
still pass the local-formula T-51 native tests; they never require or update a
published stable Homebrew formula.
