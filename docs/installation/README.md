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

## Update and remove

Close active Copilot processes before maintenance. Running `sdlc install` from
the selected package is an idempotent update preserving workflow state and
unrelated files. `sdlc uninstall` removes managed framework files while preserving
runtime/unrelated content. Removing a package-manager channel is not the same
as uninstalling its explicit Copilot-home installation.

`sdlc install --purge-existing` is an **explicit destructive clean migration**:
it removes owned runtime, decisions and evidence as well as owned installation
files. Back up/reconcile required history first; it is never a default update
or a suggested remedy for a failed test. See [complete CLI contracts](../reference/cli.md).

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
