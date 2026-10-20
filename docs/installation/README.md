# Installation, update and troubleshooting

## Choose a channel and home

This table describes the **unvalidated source candidate**, not the asset
inventory of immutable published 0.4.0. The future shared Mac filename must not
be presented as an already published 0.4.0 download.

| Contract | Value |
| --- | --- |
| Node minimum | >=22 |
| Standalone archives | macos, windows-x64 |
| macOS archive | ai-sdlc-framework-<version>-macos.tar.gz |
| macOS architectures | arm64, x64 |
| macOS payload | portable JavaScript and shell; no native binary, embedded tgz or bundled Node |
| Required validation hosts | linux-x64, windows-x64, macos-arm64, macos-x64 |
| Candidate readiness | Unverified |

Node >=22 remains an external prerequisite for every channel. npm is primary
and supports Windows/macOS/Linux; standalone supports Windows x64 and macOS
Apple Silicon/Intel, not Linux. See [release state](../releases/README.md)
before assuming candidate packaging has been published or accepted.

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@0.4.0 sdlc install --home "<owned-copilot-home>"
```

Replace the home placeholder with a deliberate absolute path; contributor tests
must use a newly owned isolated home, never the real installation. Omitting
`--home` selects `COPILOT_HOME`, otherwise the default `~/.copilot`.
Then invoke that home's **installed entry**, without a second registry fetch.
For PowerShell, replace both placeholders with the same absolute Windows path:

```powershell
node "<owned-copilot-home>\sdlc\bin\sdlc.mjs" doctor --home "<owned-copilot-home>"
```

On macOS/Linux use `node "<owned-copilot-home>/sdlc/bin/sdlc.mjs" doctor --home
"<owned-copilot-home>"`. Inspect `installed`, version, findings and capabilities;
missing installation files differ from unverified live host capabilities.
Restart Copilot after install/update, then perform the
[disposable first-use activation check](../getting-started/README.md#safe-first-use).
Doctor is not proof that live hooks, built-in `/review`, every platform or tests
passed. Record the actual Copilot/Node/OS versions for an observed walkthrough.

### Clean migration from the private or an earlier installation

Close every Copilot CLI process first. After backing up and reconciling any
required history, this single cross-platform command performs an **explicit,
irreversible clean migration** into your deliberately selected home:

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@0.4.0 sdlc install --purge-existing --home "<owned-copilot-home>"
```

It removes modified framework-owned files and owned runtime work items,
decisions, evidence, manifests and locks. It preserves unrelated Copilot files
and unrelated content in `copilot-instructions.md`. The new package source must
remain outside the destination home. Clean migration is never the default
update or a suggested remedy for a failed test. Run doctor through the installed
entry afterward, then restart Copilot.

For a repository on a UNC share, use PowerShell or a direct argument-array tool.
An unavailable cmd adapter does not prove execution in the requested directory.

## Update the framework

Close active Copilot processes and development work first. Ordinary update
preserves runtime workflow state and unrelated files. Restart Copilot afterward:
an active process retains the old hooks and instructions.

The following examples select the actual published **0.4.0** npm archive, not
unreleased source or a future shared Mac asset. Use version-specific download
and package directories outside the selected Copilot home. `--clobber` replaces
the named downloaded assets only; it is not permission to purge an installation.
Before proceeding from download to installation, verify the archive's SHA-256
against `SHA256SUMS` and its version/source against `release-descriptor.json`
using the [release verification guidance](../releases/README.md).
Stop on a mismatch or failed command; never substitute another registry/channel
to bypass a download or OS-policy restriction.

If an active legacy hook blocks maintenance, run the applicable commands in a
normal host terminal outside that Copilot session, then restart Copilot.
The installed entry performs maintenance using the separately selected package
source; see the [complete CLI contracts](../reference/cli.md).

### Update on macOS or Linux

```sh
VERSION="0.4.0"
DOWNLOAD_DIR="$HOME/Downloads/ai-sdlc-framework-$VERSION"
PACKAGE_ROOT="$HOME/.local/share/ai-sdlc-framework/$VERSION"
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"
PACKAGE="$DOWNLOAD_DIR/ai-sdlc-framework-$VERSION.tgz"

mkdir -p "$DOWNLOAD_DIR" "$PACKAGE_ROOT"
gh release download "v$VERSION" \
  --repo urmich/ai-sdlc-framework \
  --pattern "ai-sdlc-framework-$VERSION.tgz" \
  --pattern SHA256SUMS --pattern release-descriptor.json \
  --clobber --dir "$DOWNLOAD_DIR"
```

Verify the downloaded release before continuing in the same shell.

```sh
npm install --ignore-scripts --no-audit --no-fund --bin-links=false \
  --prefix "$PACKAGE_ROOT" "$PACKAGE"
SOURCE_ROOT="$PACKAGE_ROOT/node_modules/ai-sdlc-framework"

node "$COPILOT_HOME/sdlc/bin/sdlc.mjs" \
  update --home "$COPILOT_HOME" --source-root "$SOURCE_ROOT"
node "$COPILOT_HOME/sdlc/bin/sdlc.mjs" \
  doctor --home "$COPILOT_HOME"
```

### Update on Windows PowerShell

```powershell
$Version = "0.4.0"
$DownloadDir = Join-Path $HOME "Downloads\ai-sdlc-framework-$Version"
$PackageRoot = Join-Path $env:LOCALAPPDATA "ai-sdlc-framework\$Version"
$CopilotHome = if ($env:COPILOT_HOME) {
  $env:COPILOT_HOME
} else {
  Join-Path $HOME ".copilot"
}
$Package = Join-Path $DownloadDir "ai-sdlc-framework-$Version.tgz"
$SourceRoot = Join-Path $PackageRoot "node_modules\ai-sdlc-framework"

New-Item -ItemType Directory -Force -Path $DownloadDir, $PackageRoot | Out-Null
gh release download "v$Version" `
  --repo urmich/ai-sdlc-framework `
  --pattern "ai-sdlc-framework-$Version.tgz" `
  --pattern SHA256SUMS --pattern release-descriptor.json `
  --clobber --dir "$DownloadDir"
```

Verify the downloaded release before continuing in the same PowerShell session.

```powershell
npm install --ignore-scripts --no-audit --no-fund --bin-links=false `
  --prefix "$PackageRoot" "$Package"

node (Join-Path $CopilotHome "sdlc\bin\sdlc.mjs") `
  update --home "$CopilotHome" --source-root "$SourceRoot"
node (Join-Path $CopilotHome "sdlc\bin\sdlc.mjs") `
  doctor --home "$CopilotHome"
```

### Update on Windows Command Prompt

```bat
set "VERSION=0.4.0"
set "DOWNLOAD_DIR=%USERPROFILE%\Downloads\ai-sdlc-framework-%VERSION%"
set "PACKAGE_ROOT=%LOCALAPPDATA%\ai-sdlc-framework\%VERSION%"
if defined COPILOT_HOME (set "FRAMEWORK_HOME=%COPILOT_HOME%") else (set "FRAMEWORK_HOME=%USERPROFILE%\.copilot")
set "PACKAGE=%DOWNLOAD_DIR%\ai-sdlc-framework-%VERSION%.tgz"
set "SOURCE_ROOT=%PACKAGE_ROOT%\node_modules\ai-sdlc-framework"

if not exist "%DOWNLOAD_DIR%" mkdir "%DOWNLOAD_DIR%"
if not exist "%PACKAGE_ROOT%" mkdir "%PACKAGE_ROOT%"
gh release download "v%VERSION%" --repo urmich/ai-sdlc-framework --pattern "ai-sdlc-framework-%VERSION%.tgz" --pattern SHA256SUMS --pattern release-descriptor.json --clobber --dir "%DOWNLOAD_DIR%"
```

Verify the downloaded release before continuing in the same Command Prompt.

```bat
npm install --ignore-scripts --no-audit --no-fund --bin-links=false --prefix "%PACKAGE_ROOT%" "%PACKAGE%"
node "%FRAMEWORK_HOME%\sdlc\bin\sdlc.mjs" update --home "%FRAMEWORK_HOME%" --source-root "%SOURCE_ROOT%"
node "%FRAMEWORK_HOME%\sdlc\bin\sdlc.mjs" doctor --home "%FRAMEWORK_HOME%"
```

## Uninstall the framework

Uninstall removes unchanged framework-owned instructions, skills, hooks and CLI
files. It preserves modified/unowned content and always retains
`<COPILOT_HOME>/sdlc/runtime/` so workflow evidence remains recoverable.
Removing a package-manager channel is not the same as uninstalling its explicit
Copilot-home installation. The separately selected package directory is not
removed by these commands.

### Uninstall on macOS or Linux

```sh
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"
node "$COPILOT_HOME/sdlc/bin/sdlc.mjs" \
  uninstall --home "$COPILOT_HOME"
```

### Uninstall on Windows PowerShell

```powershell
$CopilotHome = if ($env:COPILOT_HOME) {
  $env:COPILOT_HOME
} else {
  Join-Path $HOME ".copilot"
}
node (Join-Path $CopilotHome "sdlc\bin\sdlc.mjs") `
  uninstall --home "$CopilotHome"
```

### Uninstall on Windows Command Prompt

```bat
if defined COPILOT_HOME (set "FRAMEWORK_HOME=%COPILOT_HOME%") else (set "FRAMEWORK_HOME=%USERPROFILE%\.copilot")
node "%FRAMEWORK_HOME%\sdlc\bin\sdlc.mjs" uninstall --home "%FRAMEWORK_HOME%"
```

Inspect the result. `"uninstalled": true` means unchanged owned content was
removed; a nonempty `preserved` array identifies modified files intentionally
left in place. Do not delete runtime state merely to make a check pass.

## What gets installed

The selected home contains the managed instruction block, `hooks/sdlc.json`,
the five `skills/sdlc*` phase skills, and `sdlc/` with the CLI, source, focused
engineering instructions, templates and installation manifest.
`sdlc/runtime/` holds local state and evidence references, not disposable package
files. See [installation ownership and CLI details](../reference/cli.md).

## Offline and native channels

For an offline `.tgz`, verify exact release checksum/inventory before extraction,
extract outside the destination home and run `node bin/sdlc.mjs install --home
"<owned-copilot-home>"` from that package. Use release-specific standalone or
Homebrew instructions only after verifying their asset/version/source identities.
Windows remains a separate native PE; the future single Mac archive contains
one portable JavaScript/shell payload, no embedded npm tgz, no bundled Node and
no Universal 2 binary. Both Mac architectures require their actual native Node.
The published 0.4.0 artifacts cannot be repacked or replaced.

## Troubleshooting without weakening policy

- Check the selected Node version, executable, architecture, source/version and
  home before retrying. A native capability cannot be proven by cross-build.
- Inspect doctor findings and sanitized command diagnostics; preserve original
  failures. An uncertain update/publication needs reconciliation, not blind retry.
- A blocked registry, GitHub download, OS execution policy or corporate CFS
  quarantine is an external prerequisite. Follow your organization's approved
  wait/exception process; no alternate registry, channel or policy change is a
  promised bypass. Project ownership is not institutional approval.
- On UNC paths use PowerShell or direct argument arrays. An unavailable cmd
  adapter cannot claim managed execution in the requested directory.
- Do not expose tokens, private paths or raw work-item/session logs in issues.
  Use [support](../../SUPPORT.md) or [security reporting](../../SECURITY.md).
