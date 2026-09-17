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
node --test test/homebrew.test.mjs
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
The test disables automatic cleanup so prior payloads remain available during
switching, then uses `brew uninstall --force` on its own formula to remove all
retained test kegs, not just the latest version.

## End-user lifecycle after authorized stable tap publication

The intended tap is `urmich/ai-sdlc-framework`; do not claim it is available
until anonymous installation is verified. Once published:

```sh
brew tap urmich/ai-sdlc-framework
brew install --skip-link urmich/ai-sdlc-framework/ai-sdlc-framework
# Close Copilot before explicitly changing its home:
"$(brew --prefix ai-sdlc-framework)/bin/sdlc" install
"$(brew --prefix ai-sdlc-framework)/bin/sdlc" doctor
brew link ai-sdlc-framework   # only if the sdlc destination is absent
# Restart Copilot.

brew upgrade ai-sdlc-framework
# Close Copilot:
"$(brew --prefix ai-sdlc-framework)/bin/sdlc" update
"$(brew --prefix ai-sdlc-framework)/bin/sdlc" doctor
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
`sdlc` link**. Install Homebrew with `--skip-link`, invoke its Cellar launcher
by absolute path, and check install/doctor before promoting its link. The
repository helper implements this order and never removes the old package:

```sh
node scripts/homebrew-switch.mjs \
  --formula urmich/ai-sdlc-framework/ai-sdlc-framework
# Add --home PATH or --purge-existing only when explicitly intended.
```

An absent destination is promoted normally. For a known link owned by a
different installed Homebrew keg, supply `--previous-formula TAP/OLD_FORMULA`.
The helper verifies the old Cellar location and captures the link, unlinks the
old keg without deleting it, links the new one, and restores the captured owned
link on failure. Both payloads remain available until the user elects to remove
the old one. An unidentified file/link, including a legacy global npm link,
fails without replacement: inspect ownership and resolve it manually. Never
use `brew link --overwrite`, `rm` of an unidentified link, or uninstall the old
package before new install/doctor and link verification succeed.

For the reverse direction, use non-global npm:

```sh
# Close Copilot:
npx --package ai-sdlc-framework@<VERSION> sdlc install
npx --package ai-sdlc-framework@<VERSION> sdlc doctor
# Only after success:
brew unlink ai-sdlc-framework
brew uninstall ai-sdlc-framework
# Restart Copilot.
```

An extracted new package's absolute `bin/sdlc.mjs` entry with Node 22+ is also
supported. Verify hooks reference the copied Copilot-home CLI rather than the
old Cellar payload before removing that payload. No global npm link is created.

Microsoft CFS quarantine, approved waiting/package-exception procedures,
registry denial, GitHub download restrictions, Homebrew availability and OS
execution controls are separate diagnoses. A generic network failure is not
proof of CFS; use only organization-approved remediation. Another channel is
never guaranteed to evade those controls.

## Publication acceptance still required

T-52 remains **NotRun** until separately authorized publication and clean,
anonymous clients verify exact descriptor/checksum/asset bytes and real
published tap install/upgrade/uninstall with empty caches. The local candidate
gate neither publishes nor claims public tap availability. Stable publication
requires both native macOS gates and postpublication Homebrew acceptance;
prerelease published-Homebrew acceptance is not applicable, not a substitute for
the mandatory native candidate tests.
