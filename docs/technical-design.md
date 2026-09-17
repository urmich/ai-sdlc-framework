# AI SDLC Framework - Technical Design

| Field | Value |
| --- | --- |
| Status | Implemented candidate; maintained with the code |
| Current phase | Candidate validation; publication and DEV remain separately authorized |
| Implements | [Requirements](requirements.md), FR-001 to FR-052 |
| Validated by | [Test Design / Test Plan](test-plan.md) |
| Advancement to Coding | Authorized by the user |

For a short human review, start with the [Design Overview](design-overview.md).
It is a derived view of this document, not a second specification. This detailed
design remains authoritative.

## 1. Design intent

Design for every requirement, with the simplest mechanism that satisfies it.
The framework assists the user; an explicit user override can set aside a
framework rule, but cannot create external authority or change what is true.
No requirement is dropped to fit the schedule, and incomplete work is reported
as incomplete.

Instructions handle reasoning; a local CLI handles structured records and
deterministic rules. Hooks evaluate those rules. Lifecycle-stage findings become
one-time advisories after explicit user direction; other findings make the
request unmanaged/uncredited but do not veto the tool call.
Neither instructions nor writable local files form a security boundary against
a malicious process with the user's privileges. Guarantees below apply to the
managed execution path; unsupported or missing evidence is reported, not guessed.

All `sdlc` commands and schemas below are proposed framework interfaces, not
existing Copilot CLI commands. This document authorizes no implementation.

### 1.1 Workflow at a glance

Normal flow, unless the user explicitly overrides a framework guardrail:

<!-- shared-review:workflow:start -->
```text
Development request
  -> Requirements -- user approval --> Test Design / Test Plan
  -> user approval --> Technical Design
  -> user approval --> Coding <-> local unit-first testing
  -> GitHub Copilot CLI /review
  -> user confirms Review completion and authorizes publication/DEV
  -> check PR prerequisites when required
  -> DEV artifact build/reuse -> DEV deployment -> DEV tests
  -> user confirms DEV -> recommend STAGING -> user authorizes STAGING
  -> check PR prerequisites when required
  -> STAGING build/deploy -> policy-selected owner runs tests at an authorized location
  -> user confirms STAGING -> check required PROD PR validation
  -> recommend PROD or missing prerequisites (no automatic run)

Any fix: repeat unit-first local testing and /review; no automatic remote redeployment.
```
<!-- shared-review:workflow:end -->

One explicit reply may confirm completion and authorize advancement together.
Detailed deployment, monitoring, and recovery contracts remain in sections 7-9.

### 1.2 Key decisions for review

<!-- shared-review:decisions:start -->
1. **Install once into Copilot CLI.** Instructions and skills apply across
   repositories; compatible repository configuration supplies local conventions
   and commands without duplicating the framework.
2. **Separate reasoning from bookkeeping.** The agent understands requests and
   uses its authorized tools. An offline, dependency-free Node CLI manages
   structured decisions, state, and deterministic checks.
3. **Keep state thin and history in Git.** Active state holds references, not
   copies of documents. Git records changes and audited decisions; local records
   preserve pending decisions and operations until they can be safely retired.
4. **Authorize before acting; audit afterward.** Decisions are bound to captured
   user input, the identified work, and relevant revisions. Retries reuse the
   same decision rather than asking again or applying it twice.
5. **Keep the fast loop local and review before publication.** Every fix reruns
   the required local suite from unit tests and then Copilot CLI `/review`.
   DEV work waits for Review completion and user authorization, STAGING testing
   follows its configured or explicitly overridden owner/location, and PROD is
   recommendation-only.
6. **Use soft, overridable lifecycle stages.** Requirements, Test Design,
   Technical Design, Coding, Review, orientation, and stage progression may be
   skipped by explicit user direction after at most one advisory. Other findings
   remain visible without becoming framework tool denials, and state cannot turn
   missing tests into passes.
7. **Use small tests, not an AI evaluation campaign.** Observe ordinary work and
   exercise deterministic component contracts with isolated fixtures. Untested
   integrations remain explicitly unverified.
8. **Keep review and PR controls separate.** Candidate Review uses built-in
   `/review`; provider reviewer approval, PR validation, merging, and production
   of a deployable artifact remain independent facts.
9. **Package reproducibly before installation.** CI runs existing checks and
   tests, creates a project/version-named archive plus integrity metadata, and
   verifies the complete install/update/doctor/uninstall lifecycle in isolation.
   It never installs into the user's real Copilot home.
10. **Separate engineering guidance by task.** Dedicated knowledge, coding,
    testing, building, and reviewing files merge proven technology-neutral
    practices while repository-specific instructions remain authoritative.
11. **Adapt each host and shell explicitly.** Native path/filesystem/process
    behavior and Bash/zsh, PowerShell, and cmd command interpretation have
    separate contracts. Simulated compatibility never substitutes for host
    evidence, and `doctor` reports the difference.
12. **Keep enforcement outside the framework.** The framework classifies and
    withholds managed credit; actual enforcement belongs to Copilot permissions,
    the OS, sandbox, filesystem, network, identity and access management, repository, provider, and
    environment.
13. **Require explicit stage-override intent.** Delivery goals, PR requests,
    urgency, and “go” activate normal Requirements work. Only unmistakable
    skip/bypass/reorder/reject-stage language changes the lifecycle path.
<!-- shared-review:decisions:end -->

## 2. Components and responsibility boundaries

<!-- shared-review:architecture:start -->
```text
User
  |
Copilot CLI: instructions + phase skills
  |                                      |
Local sdlc CLI <--- runtime hooks ---> Agent's authorized tools
  |                                      |
Thin state + evidence references       Git / CI/CD / cloud provider
```
<!-- shared-review:architecture:end -->

The hooks observe/gate tool events; they do not give the local CLI network access.

| Component | Owns | Does not claim |
| --- | --- | --- |
| Instructions and skills | Activation, clarification, design, coding, semantic conflict analysis, user interaction, external tool use | Deterministic proof of model reasoning |
| Local `sdlc` CLI | Identity checks, state transitions, decision records, gate evaluation, recovery plans, conformance | Inherited access to Copilot's MCP tools |
| Runtime hook adapter | Capture actual input provenance, evaluate supported tool requests, emit one-time stage advisories, mark other actions unmanaged, observe outcomes | Authority to veto tool execution, override external systems, or completely intercept all side effects |
| Copilot CLI `/review` | Run the built-in code review agent over current changes and return findings | Requirements traceability proof, provider reviewer approval, or authority to publish |
| Pipeline monitoring task | Monitor every framework-triggered or user-reported run every 60 seconds, identify its origin, and notify terminal outcomes | Authority to launch another run, infer stage completion, or monitor while its execution host is stopped |
| Git | Document/code revisions, meaningful change history, compact audit events | Proof of when code was written or that a user really approved it |
| External systems | Actual build/deployment state and execution evidence | Exactly-once execution unless that system provides it |

The local CLI has no network integrations. It uses local filesystem operations
and read-only Git queries through `execFile`, without a shell. The agent runs
commits, pushes, builds, pipelines, and cloud operations through its existing
authorized tools. The CLI emits audit trailers and then verifies their committed
contents; it never silently commits unrelated changes.

This division reduces exposure but is not a confidentiality guarantee. Git
commands run by the agent may invoke repository hooks, and committed content
may later be pushed. Information handling is specified in section 13.

## 3. Installation and capability contract

Install once at user level, respecting `COPILOT_HOME` and otherwise using
`~/.copilot`. Use a supported Node.js LTS release, minimum Node 22, without
runtime package dependencies.

```text
<copilot-home>/
  copilot-instructions.md        # only a delimited framework-owned block
  skills/sdlc/SKILL.md
  skills/sdlc-requirements/SKILL.md
  skills/sdlc-test-design/SKILL.md
  skills/sdlc-technical-design/SKILL.md
  skills/sdlc-coding/SKILL.md
  hooks/sdlc.json                # framework-owned hook file
  sdlc/bin/sdlc.mjs
  sdlc/instructions/
    knowledge-retrieval.md
    coding.md
    testing.md
    building.md
    reviewing.md
  sdlc/templates/
  sdlc/install-manifest.json
  sdlc/runtime/                  # local; not copied into Git
```

Installation is idempotent. The manifest records new files, hashes of installed
content, and the exact instructions block inserted. Existing unrelated files
are not overwritten. Updates and uninstall remove only unchanged framework-owned
content or the owned block, not the entire pre-existing instructions file.
Modified or conflicting content is preserved and reported. Partial installation
is rolled back only where doing so cannot overwrite later user edits.

Ordinary install/uninstall remains recovery-safe and preserves modified owned
files plus runtime state. The user-facing irreversible migration path is
`install --purge-existing`, invoked through the new extracted or npm-delivered
package. It verifies that both the executing package and selected source are
outside `COPILOT_HOME`, reads and validates the complete replacement
distribution before deletion, then holds one maintenance lock outside the
owned `sdlc/` deletion tree across purge and reinstall. Purge does not require
the old runtime tree or ownership manifest to be valid. It removes the owned
instruction block regardless of content changes and deletes only known
framework-owned hook, skill, and `sdlc/` paths without following symlinks into
unrelated content. Invalid, oversized, or impossible abandoned lock records are
recoverable; live or unverifiable lock owners remain protected.

Lock records are fully written to a same-directory candidate and atomically
published with a hard link, so current writers never expose an empty lock.
Candidate cleanup and protected execution share one ownership-release boundary.
Malformed legacy locks are removed only after they are stale and stable under
the recovery sidecar.

If replacement fails after purge, the error explicitly reports that irreversible
purge completed and includes the purge result. Install rollback still removes
only writes made by the failed replacement; it cannot reconstruct intentionally
purged private runtime state.

Copilot must be closed during replacement and restarted after installation.
Downloaded archives, npm caches, and package extraction directories remain
outside `COPILOT_HOME` and are cleaned separately only by exact user-selected
path.

Hook entries use direct `node` execution with argument arrays where supported;
the installer resolves paths containing spaces without shell interpolation.

### 3.1 Multi-channel distribution

The release pipeline builds the npm `.tgz` first and treats its SHA-256 digest
and inventory as the common framework payload identity. Platform distributions
contain an extracted copy proven from that exact `.tgz`; they never rebuild
framework source independently.

Packaging uses an acyclic metadata sequence:

```text
exact npm payload
  -> embedded payload-manifest.json
  -> platform archives
  -> Homebrew/WinGet metadata
  -> external release-descriptor.json
  -> SHA256SUMS rendered from the descriptor
```

Archives embed only `payload-manifest.json`, never the outer release descriptor
or `SHA256SUMS`. The canonical external `release-descriptor.json` schema is:

```json
{
  "schemaVersion": 1,
  "name": "ai-sdlc-framework",
  "version": "<semver>",
  "sourceCommit": "<full-commit>",
  "payload": {
    "filename": "ai-sdlc-framework-<version>.tgz",
    "sha256": "<digest>",
    "inventoryDigest": "<digest>"
  },
  "files": [
    {
      "filename": "<exact-name>",
      "kind": "archive|homebrew|winget|metadata",
      "sha256": "<digest>",
      "size": 123
    }
  ]
}
```

Canonical JSON uses recursively sorted keys, UTF-8 LF, no timestamps, decimal
byte sizes, and no duplicate filenames. The complete descriptor includes every
archive and Homebrew/WinGet metadata file. `SHA256SUMS` is a deterministic text
rendering of the descriptor file list plus the descriptor's own digest; it
does not include itself. CI retains the descriptor and `SHA256SUMS` digests as
workflow evidence so postpublication clients compare the exact published bytes
with the prepublication result.

Artifact names are
`ai-sdlc-framework-<version>-windows-x64.zip`,
`...-macos-x64.tar.gz`, `...-macos-arm64.tar.gz`, and
`...-linux-x64.tar.gz`.

`scripts/package-platforms.mjs` creates fixed-time, sorted, deterministic
staging trees. Each tree contains `package/` extracted from the exact npm
payload, the payload archive itself, the embedded payload manifest, license,
platform metadata, and
platform launchers. Verification independently rebuilds all files, compares
outer archive digests, verifies the embedded payload and extracted inventory,
rejects malformed/duplicate/extra entries, and enforces the documented
launcher/metadata/mode/line-ending allowlist.

The embedded payload inventory is an array sorted by POSIX path:

```json
{"path":"src/core.mjs","type":"file","size":123,"sha256":"...","mode":"0644"}
```

Directories, links, device entries, absolute/parent paths, duplicates, and
unlisted files are rejected. Every `package/**` entry must match across all
channels. The only allowed wrapper entries are
`install.sh`, `install.ps1`, `bin/sdlc`, `bin/sdlc.exe`,
`platform.json`, `payload-manifest.json`, the embedded `.tgz`, and license.
Text launchers use LF on POSIX and CRLF only for PowerShell; executable modes
are `0755` for POSIX launchers and `0644` otherwise.

Downloaded code does not verify itself before execution. Direct-install
documentation first downloads the release descriptor, `SHA256SUMS`, and target
archive, then uses host-native `Get-FileHash` or `shasum`/`sha256sum` to compare
the outer archive with the published checksum and descriptor. Only after that
external check may the archive be extracted or its installer executed.
Archive-contained launchers recheck the embedded payload before channel
activation as defense in depth.

Channel installation uses a separate user-owned root and lock:
`~/.local/share/ai-sdlc-framework` on POSIX or
`%LOCALAPPDATA%\ai-sdlc-framework` on Windows. It extracts into a unique staging
directory, validates Node/runtime and payload inventory, then atomically renames
the staging directory to the immutable version directory. A same-version,
same-digest install is idempotent; a conflicting digest fails. The `current`
launcher/link is replaced atomically only after version activation. Channel
locks are released before invoking framework maintenance, establishing lock
order `channel → release`, then separately `framework`; interrupted activation
leaves the prior current version usable and bounded staging cleanup is safe.

Standalone `install.sh` and `install.ps1` may invoke framework
`install`/`--purge-existing` after channel activation. They locate the exact
Node executable, require version 22+, and fail before channel or Copilot-home
mutation when the runtime is absent, non-executable, wrong-architecture, or
shadowed by an incompatible command.

Homebrew owns its Cellar payload and linked launcher only. Candidate testing
uses a generated local formula whose URL points to the candidate archive in a
local HTTP fixture/cache; it runs real `brew install`, upgrade, unlink/link, and
uninstall without public release dependency. Stable published formula metadata
uses final public release URLs and exact x64/arm64 checksums. Prerelease CI uses
a test-only local formula but does not update stable tap metadata.

WinGet uses the Windows archive with a small open-source native `sdlc.exe`
launcher built for x64, because portable manifests do not support `.cmd` as the
nested target. Its source is `cmd/sdlc-launcher/main.go`; CI pins the Go
toolchain, uses `CGO_ENABLED=0`, `GOOS=windows`, `GOARCH=amd64`,
`-trimpath`, and an empty build ID, rebuilds twice, and compares bytes. The
archive already contains the extracted payload; the launcher
resolves Node 22+ and invokes `package/bin/sdlc.mjs`. WinGet declares the Node
LTS package dependency and owns only its portable archive/link. Local manifest
validation establishes submission readiness; community acceptance and client
discoverability remain postpublication evidence.

Stable WinGet manifests reference the public stable asset. Prerelease Windows
CI generates a test-only manifest pointing to the local candidate archive,
validates its schema/digest/installer behavior, and discards it; stable WinGet
metadata publication is not applicable to prereleases, while the native
Windows standalone lifecycle remains release-blocking.

Channel switching resolves and invokes the new launcher by absolute path before
removing the old package. Homebrew switching installs with `--skip-link`,
invokes the new Cellar launcher directly, verifies framework update/doctor, then
captures the existing `sdlc` link target. If that link belongs to a global npm
installation, it is treated as an unsupported external/legacy channel and is
not automatically removed. The documented npm channel uses `npx` or an
extracted versioned payload and owns no persistent global `sdlc` link.
If the existing link belongs to another Homebrew keg, `brew unlink` retains the
old keg and payload until the new `brew link` succeeds. Link promotion runs
when the destination is absent or when the existing target is proven owned by
that old keg. An absent destination is the normal supported npm-to-Homebrew
case. An unidentified existing target fails without replacement. A link/unlink
failure restores the captured owned target while the old keg still exists and
retains both payloads; it never removes an unidentified file.

The reverse Homebrew-to-npm path uses the documented non-global `npx` or
extracted-package entry by absolute path, updates/verifies `COPILOT_HOME`, and
then optionally unlinks/uninstalls Homebrew. It does not create or compete for
a global npm bin link. Global `npm install -g` is outside the supported channel
contract and receives only manual ownership diagnostics.

WinGet owns its scope-specific portable alias under
`Microsoft\WinGet\Links` and performs same-PackageIdentifier upgrade;
switches from another channel invoke the new WinGet install location directly,
verify framework update/doctor, then remove the old channel. If validation
fails, uninstall the new channel payload and retain the old payload; neither
path rolls back an explicitly requested framework purge. PATH precedence is
diagnosed but never used to choose the launcher during switching.

The release-blocking native matrix is:

| Job | Required evidence |
| --- | --- |
| Linux x64 | standalone archive, npm-denied install, lifecycle, payload/checksum verification |
| Windows x64 | PowerShell standalone, cmd launcher, WinGet manifest validation, paths with spaces, hooks |
| macOS Intel x64 | standalone and Homebrew install/update/uninstall |
| macOS Apple Silicon arm64 | standalone and Homebrew install/update/uninstall |

Each job records runner image/architecture plus `process.platform`,
`process.arch`, and host-native architecture evidence. macOS jobs require
`uname -m` and `sysctl.proc_translated`; Intel evidence fails under Rosetta and
arm64 evidence requires native arm64. The launcher uses the same validated Node
path for preflight and execution. Emulation cannot satisfy a native
requirement. Release publication depends on every mandatory job; a failed,
skipped, cancelled, or absent result blocks it.

Stable release metadata is generated only for stable versions. Prereleases may
publish npm `next` and prerelease GitHub assets but do not update WinGet or
Homebrew stable metadata. WinGet completion distinguishes locally valid,
submission-ready manifests from later community repository acceptance and
client discoverability.

The prepublication job uploads one immutable `release-bundle` artifact
containing every candidate asset, descriptor, checksum file, generated stable
metadata, and source commit. Publisher jobs download only that bundle. GitHub
Release begins as a draft, uploads assets idempotently only when existing asset
digests match, publishes after all required destinations succeed, and retains
explicit partial-publication state when npm or another destination succeeds
first. Retry never rebuilds bytes.

Postpublication acceptance runs from empty anonymous clients with fresh caches
and no repository or npm credentials. It retrieves release metadata,
`SHA256SUMS`, descriptor, and assets, verifies them against the persisted
prepublication descriptor before execution, and exercises npm, direct
standalone, and published Homebrew lifecycles. Stable releases require
Homebrew acceptance; prereleases mark published-Homebrew acceptance
not-applicable while retaining the native local-formula gate. WinGet client
installation becomes passing only after community acceptance.
Microsoft CFS quarantine, package exceptions, client network blocks, WinGet
policy, and OS execution controls remain separate Blocked diagnostics; no
installer changes or bypasses those controls.
Installation documentation covers prerequisites, install/update/uninstall,
activation, local-only Git use, repository configuration, and recovery.

`sdlc doctor` reports the host platform/architecture, Node prerequisite,
supported shell adapters, native path/filesystem capabilities, package
lifecycle state, supported CLI version, availability of the built-in `/review`
command, installed hook capabilities, and host-validation status. Its
compatibility checks cover the actual payloads used for input capture, tool
gating, session start, and compaction. Unsupported or host-unverified
capabilities are reported explicitly; installation does not silently claim
enforcement works.
Instructions/hooks take effect using the CLI's documented reload/restart rules.
Cross-platform behavior is not inferred merely from writing documentation or
executing a foreign-shell parser on another host.

### 3.2 Distribution CI/CD

The repository's GitHub Actions workflow runs on pull requests, main-branch
updates, version tags, and explicit manual dispatch using Node.js 22. It executes
the existing static/source checks and deterministic tests before packaging.
The framework runtime and npm packager use only Node.js built-ins plus npm.
Multi-channel release jobs additionally pin Go for the Windows launcher and use
host-native archive, Homebrew, and WinGet validation tools only in their
applicable matrix jobs; these are build-time tools, not framework runtime
dependencies.

`scripts/package.mjs` invokes `npm pack --ignore-scripts` twice in isolated
destinations and requires identical SHA-256 digests. The package filename is
derived from `package.json` as `ai-sdlc-framework-<version>.tgz`; CI/CD is the
process name, not the artifact name. The package allowlist includes the runtime
CLI, installable assets, README, package metadata, and CLI reference while
excluding tests, Git metadata, generated runtime state, and local build output.
The output directory is never recursively cleared: packaging removes only the
exact owned archive and rejects any unexpected file,
directory, or symbolic link. npm is invoked through its JavaScript CLI on
Windows rather than attempting to execute an `.cmd` file through `execFile`.

The packaging step writes:

```text
dist/
  ai-sdlc-framework-<version>.tgz
```

The packaging process deterministically calculates schema version, package
identity, archive digest and sizes, and the sorted packaged file list in memory.
`scripts/verify-package.mjs` creates a fresh expected package in an owned
temporary directory and requires the distributable to have the same filename
and SHA-256. It then extracts the supplied archive through npm and compares its
compressed size, embedded package identity, complete file inventory, per-file
size, and total unpacked size to that fresh build. Filesystem permission modes
are not package identity because npm extraction normalizes them by platform and
process umask.

`scripts/verify-package.mjs` installs the local archive under an isolated
temporary npm prefix, invokes that package's installer against an isolated
Copilot home containing spaces and pre-existing instructions, runs the installed
`doctor`, verifies a same-package update is idempotent, and uninstalls. It checks
that owned content is removed, user instructions are preserved, and seeded
framework runtime content remains byte-for-byte unchanged after update and
uninstall. The npm verifier feeds the multi-channel packager rather than publishing
directly. The successful workflow uploads the immutable `release-bundle`
described in section 3.1, including the `.tgz`, platform archives, descriptor,
checksums, and package-manager metadata. On stable version tags, separate
least-privilege publisher jobs download that exact bundle for npm, GitHub
Release, Homebrew tap, and WinGet submission-ready output. It never uses the real Copilot
home, provider credentials, cloud resources, network deployment, or LLM
evaluation.
The extraction step disables npm bin-link creation because verification invokes
the entry point through Node directly; this prevents npm from normalizing a
CRLF shebang and changing archived bytes before inventory comparison.
Package integration tests replace HOME/USERPROFILE, npm cache, and
user configuration with fixture-owned paths, remove inherited package tokens,
disable update notifications, and force npm offline. This prevents a nominally
local test from reading credentials, contacting the registry, or writing to the
developer's real npm state.

### 3.3 Focused engineering instruction pack

The source instruction pack lives under `assets/instructions/` and installs
under `<copilot-home>/sdlc/instructions/`. Each file owns one task concern:

| File | Scope |
| --- | --- |
| `knowledge-retrieval.md` | Instruction hierarchy, canonical project knowledge, targeted search, source verification, and no-guess behavior |
| `coding.md` | Scope, cohesive design, readability, types/state, errors, async/resources, security, compatibility, refactoring, and LLM self-review |
| `testing.md` | Traceability, scenario selection, AAA, regression-first fixes, assertions, doubles, isolation, flakiness, cleanup, and execution discipline |
| `building.md` | Canonical build unit, toolchain/version/architecture, restore, targeted/full builds, outputs, reproducibility, and remote boundaries |
| `reviewing.md` | Review prerequisites, behavior-chain tracing, authorization/security/concurrency/recovery, test quality, findings, and closure |

The global Copilot instruction block names all five files. Phase skills reference
only the guides relevant to their task: requirements starts with knowledge,
Test Design adds testing, Technical Design adds building, and Coding loads all
applicable implementation/test/build/review guides. This avoids one broad file
being treated as sufficient context for every task.
Source skills use named guide placeholders. Installation renders each placeholder
to the exact absolute file under the selected Copilot home; tests reject
unresolved placeholders or ambiguous relative guide paths.

Lifecycle override interpretation is centralized in
`lifecycle-intent.md`. Global instructions, the orchestrator, and every phase
skill reference that exact installed guide rather than maintaining independent
shortcuts. The guide defines a deterministic scenario matrix: ordinary
implementation/fix/urgency/delivery language, ambiguous intent, negated skip
language, and non-lifecycle uses of skip/bypass follow the current stage;
unmistakable instructions to skip, bypass, reject, or reorder an identified
stage receive one consequence warning and proceed unmanaged. Every normal case
must begin useful current-stage work, not merely refuse the requested outcome,
and no text classification manufactures an approval, completion, or override
event.

Repository-specific instructions take precedence when compatible. The focused files deliberately do not copy technology-specific architecture,
platform-specific SDK paths, named mocking/assertion libraries,
vendor-specific database/storage emulators, or service layouts. They
incorporate the reusable concepts behind those rules:
actual instruction discovery, exact toolchain verification, small cohesive
changes, explicit errors, regression coverage, deterministic cleanup, and
review of tests as production code.

Installer ownership treats these files like the CLI and templates: preflight
hashes prevent overwriting user edits, updates replace only unchanged owned
content, partial installation rolls back safe writes, and uninstall preserves
modified files. Static and integration tests verify substantive content,
cross-file references, package inclusion, installed locations, and removal.

### 3.4 Host, shell, path, and process adapters

The framework has one canonical internal model and explicit adapters at native
boundaries. `src/platform.mjs` owns pure platform descriptors, path comparison
keys, supported shell families, executable-resolution facts, and capability
reporting. It does not emulate a foreign filesystem. Tests may pass explicit
`win32` or `darwin` descriptors to pure helpers, while real filesystem and Git
operations always use the current host.

Hook normalization maps documented tool aliases and snake/camel/Pascal field
shapes to canonical `bash`, `powershell`, or `cmd` tool names before
classification. An unknown shell-like name remains unknown and is excluded from
managed classification, while the public hook falls through. Tool payload
normalization does not infer the shell from command contents.

Each shell family has a distinct conservative tokenizer:

| Family | Accepted managed subset | Rejected without an explicit adapter |
| --- | --- | --- |
| Bash/zsh-compatible | Literal words, whitespace separation, supported single/double quoting, and narrowly defined escapes | Expansion, substitution, chaining, pipes, redirection, here documents, newlines, glob/brace behavior where the classifier needs literal paths |
| PowerShell | Literal words beginning with an executable name and supported later single/double-quoted tokens whose native argument conversion is unambiguous | Quoted executable paths requiring call syntax, empty native arguments that Windows PowerShell 5.1 may discard, parameter-colon forms that PowerShell can split into hidden arguments, expressions, subexpressions, script blocks, stop-parsing, environment interpolation, typographic quotes, ambiguous quote adjacency, redirection/chaining, and Legacy/Standard argument differences not proven compatible |
| `cmd.exe` | ASCII literal words and whole-token double quoting, including ordinary drive and UNC path tokens | `%VAR%`, delayed `!VAR!`, caret escapes, metacharacters, grouping, chaining/redirection, embedded/adjacent quotes, newlines, and wrapper forms such as nested `cmd /c` |

The tokenizer output is used only to derive and compare a managed action. It is
not later executed by the framework. Framework-owned subprocesses use
`execFile` with an executable and argument array. Node entry paths are invoked
through `process.execPath`; Windows npm execution resolves `npm-cli.js` and
invokes it through Node rather than relying on `.cmd` shell dispatch. Git uses
the same direct process contract and a stable `C` locale. Missing executables,
spawn failures, and nonzero exits preserve their own diagnostics.
Native adapter tests execute an argument-observer program through each shell and
compare the observed argv and cwd with classifier output. They include spaces,
supported empty arguments, explicit rejection where a cross-version empty
argument contract is unavailable, supported quote forms, trailing backslashes,
and other rejection cases. PowerShell 5.1, PowerShell 7, and cmd results remain
separate because one cannot establish the native argument contract of another.

Repository `commands` may declare optional `platforms` (`darwin`, `win32`,
`linux`) and one `shell` (`bash`, `powershell`, `cmd`). Omitted values make the
exact command host-independent or eligible for its canonical tool only when the
literal text safely matches; they do not authorize translation. Multiple
applicable entries with the same exact command must derive identical actions or
fail as a configuration conflict. Build/test adapters therefore select a
declared native command; they never convert quoting, separators, or environment
syntax between shells.

`cmd.exe` cannot use a UNC path as its process cwd reliably: it may fall back to
the Windows directory. The current adapter therefore marks cmd-on-UNC
unavailable/unmanaged and does not claim command/cwd integrity. The public hook
still falls through to normal permissions. PowerShell and framework-owned
direct argument-array processes may use a canonical UNC cwd. A future cmd
mapping adapter must use a separately validated batch/helper contract, prove
success/failure exit propagation and mapping cleanup, and pass native tests
before `doctor` reports it supported. User-authored `pushd`, chaining,
environment expansion, or nested `cmd /c` is not accepted as a substitute.

All persisted runtime paths are native absolute canonical paths. Containment
uses case-preserving canonical `realpath` results and exact component ancestry;
it never lowercases an entire Windows path. This supports ordinary
case-insensitive directories after canonicalization without merging distinct
entries under a per-directory case-sensitive root.
If stable canonical case or ancestry identity cannot be established, the path
is unsupported rather than compared with unconditional case folding.
Drive-letter and UNC roots remain distinct authorities.
Both slash forms in user/configured Windows paths normalize through
`path.win32`. `..`, alternate separators, case changes, symlinks, junctions, and
other reparse-point redirects cannot escape the canonical root. Normal
drive-letter and UNC paths are supported. Windows device namespace paths
(`\\?\`, `\\.\`) are rejected until a separately tested normalization contract
exists.

Reads accept UTF-8 LF or CRLF. Canonical framework JSON and installed framework
text use LF; existing unowned instruction content is preserved byte-for-byte
outside the owned block. An update may normalize only the exact framework-owned
block it replaces. Text parsing removes a single trailing `\r` from CRLF lines
where line structure matters; digests of arbitrary artifacts remain byte exact
unless that artifact's schema explicitly defines normalization.

POSIX file modes are applied and tested on macOS. Windows may not preserve Unix
mode bits; ownership relies on hashes and path identity rather than pretending
mode enforcement. Distribution traversal rejects symlinks, junctions/reparse
points, and non-regular entries. Runtime canonicalization follows native
`realpath` and then rechecks containment before reads or writes.

Atomic writes keep the temporary file in the destination directory, create it
exclusively, flush and close it, and replace the destination without first
deleting or truncating the old file. Transient Windows sharing/access failures
may be retried for a short bounded interval only when the error code is a
documented replace contention; exhaustion surfaces the original failure and
leaves the prior destination intact. Directory flush is best-effort only for
documented unsupported host errors. Locks retain exclusive-create ownership and
same-host process checks; unverifiable Windows process ownership never permits
lock stealing.

`doctor` exposes two different facts: `supported` by the implemented adapter and
`verifiedOnHost` by current evidence. A PowerShell Core test on macOS may verify
the parser's syntax fixture but leaves native Windows filesystem, Git, package,
PowerShell 5.1, cmd, and Copilot-hook evidence unverified. Host matrix rows are
updated only from actual host execution.

## 4. Work-item identity and storage

### 4.1 Logical identity, not a path-only lookup

Each development request has a stable work-item ID. Exactly one participating
repository coordinates its versioned manifest; other repositories are members,
not independent copies of the workflow.

For each local member, resolve the working-tree root and common Git directory
using Git, then canonicalize paths. The binding contains work-item ID, logical
repository ID, working-tree root, common Git directory, and checked-out branch
ref. `HEAD` is an observed revision, not a permanent identity.

Use Git to resolve its metadata paths; never assume `.git` is a directory.
A linked worktree commonly has a `.git` file. Different worktrees and different
branches in the same checkout must not inherit each other's phase or permissions.

### 4.2 Durable project facts versus current local state

| Store | Content | Retention and recovery |
| --- | --- | --- |
| `.sdlc/work-items/<id>.json` in the coordinator repository | Portable work-item manifest: repository IDs, artifact locators, coordinator identity, adopted-history boundary | Committed with project artifacts; no credentials or machine-specific absolute paths |
| Git commit trailers | Complete, compact authorization/scope audit events and references to applicable work | Normal Git history; retrieved on demand |
| `runtime/work-items/<id>/checkpoint.json` | Current phase/status, revisions, active task, references to active decisions, operations, and blockers | Thin local projection; reconstructable from available records |
| `runtime/work-items/<id>/records/` | Pending audit events, active authorization metadata, unresolved operation records, evidence references | Local and bounded; pruned by the rules in section 5 |
| `runtime/pipeline-monitors/<run-key>.json` | Origin, provider/run identity, current monitor status, and optional work-item/cycle link | Supports user-reported runs without a development work item; retains pending completion notifications |
| `runtime/sessions/<session-id>.json` | Bound work item/member, pending decision, orientation generation, input-receipt references | Per session, never shared as a single compaction flag |
| `runtime/registry.json` | Discovery index from local repository/worktree bindings to candidate work items | Recoverable index; never authoritative permission |

The manifest is not a state-history log. It changes when durable identity or
artifact registration changes, not after every tool call. Detailed documents and
Git history are never copied into the checkpoint.

A new canonical document uses a two-step locator contract. The current phase
first records an exact repository-relative planned locator with digest `pending`;
that path is then classified as phase-appropriate document creation. After the
file exists, registration replaces `pending` with its content digest. Approval
snapshots and phase completion reject unmaterialized planned locators.
Registration rejects `.git`, `.sdlc`, and other protected metadata namespaces
before a role can affect classification. Orientation represents a pending Test
Plan by locator/digest state and does not attempt to read its missing content.

Artifact identity is composite. A Git locator is keyed by
`(role, repositoryId, artifactId)`; an external locator records the same logical
repository association and has a deterministic locator ID derived from all
three fields. `artifactId` is a stable logical document name such as `default`,
`api`, or `security`. Registering a new member/artifact ID appends it, while
re-registering the same composite identity replaces only that entry, including
an intentional path move. Manifest validation rejects duplicate composite keys
and reuse of one repository path for different artifact IDs or roles.

Legacy locators without `artifactId` are interpreted as `default`. Existing
single-repository callers that omit it therefore retain the prior replacement
behavior. A legacy external locator without `repositoryId` is coordinator-owned
and retains its existing locator ID. New external locator IDs include role,
repository, and artifact ID.
The local external mapping record also stores a binding digest derived from its
canonical path and authorization reference. Snapshots include that digest, not
the absolute path, so rebinding to a different same-content file invalidates a
pending approval while portable manifests remain machine-independent.

Snapshot and recovery APIs operate on artifact sets, not `.find(role)`.
Requesting snapshots for a role expands to every materialized locator of that
role, sorted by role, repository ID, artifact ID, and locator/path. Approval comparison
therefore detects additions, removals, replacements, and content changes in any
member.
Full status returns complete locator records and digests. If the 1.5 KiB
orientation/resume budget is exceeded, the compact result still lists every
role/repository/artifact ID with pending/materialized state and points to
`sdlc status` for full locators and digests.

Requirements and Test Plan checks aggregate all registered member documents.
FR/AC and test IDs are globally unique in the work item, while coverage links
may cross document/repository boundaries. A role is due when the lifecycle
requires it and at least one retrievable artifact must exist; not every member
is forced to create a document when the work does not need one.

All registered Test Plans form one combined validation specification. Each test
retains its defining plan locator internally for synchronization, test IDs must
be globally unique, and specification identity includes the sorted
`(locator, definition digest)` set. Result synchronization updates every plan
containing affected tests. This preserves one logical Test Plan across multiple
repository documents without silently selecting the last registered member.
For backward compatibility, exactly one Test Plan uses the existing legacy
specification-digest algorithm. Upgrading an unchanged single-plan work item
therefore preserves its active cycle and evidence. The aggregate locator-aware
digest is introduced only when two or more Test Plans exist; adding or removing
a member plan is then a real specification change and starts revalidation.

For ordinary work, the agent creates or selects a Git repository and feature
branch/worktree before producing development artifacts. Local-only Git is valid.
Remote setup and pushing require the user's authorization. An explicit override
of the repository rule is represented locally under FR-006, not falsely recorded
as a Git-backed workflow.

### 4.3 Discovery and branch changes

Resolve from a validated session binding, repository manifests, and registry
candidates. All candidates must agree with actual repository/worktree/branch
identity; there is no "first file wins" rule.

On a branch change, lost checkpoint, or missing registry entry, inspect relevant
manifests and reachable audit history before deciding work is new. Do not silently
attach an old Coding state to a new branch. Multiple plausible work items require
selection; a missing coordinator or conflicting binding is a recovery blocker,
not permission to create a second workflow.

Member sessions resolve the same coordinator and local work-item store. A
relocated clone needs an explicit mapping from logical repository IDs to new
paths. A new development request creates a new work item; follow-up work resumes
the existing one. Ambiguous new-versus-existing intent is clarified by the agent.

A Copilot session may be rooted in a non-Git parent workspace while the actual
development repository is a child or sibling path. Before binding, safe
Bash/PowerShell reads and navigation remain available, and a captured
development request permits supported Git clone/init/switch/worktree bootstrap.
After `sdlc init --cwd <repository>`, resolution may fall back to the session's
explicit work-item, repository ID, and binding key only when `git rev-parse` on
the outer workspace returns the confirmed `not a git repository` failure. The
child binding is revalidated before use. Ownership, corruption, bare-repository,
metadata-directory, and other Git failures propagate instead of triggering
fallback. The resolver also checks the cwd and its ancestors for a `.git` file,
directory, or symlink; present-but-invalid metadata prevents fallback even when
Git's diagnostic contains "not a git repository."
Internal Git probes force the stable `C` locale so non-repository diagnostics
are consistent on localized Windows/macOS/Linux installations.
If the outer workspace is itself another Git repository, normal identity
resolution applies and no fallback can transfer authority between repositories.

Multiple agents may share a work item. Independent mutating work on different
work items in the same checkout is not silently combined; use separate worktrees
or explicitly switch the active binding after outstanding operations are settled.

## 5. Thin state, concurrency, and retention

### 5.1 State model

The checkpoint is a projection, not the only surviving copy of a decision:

```json
{
  "schemaVersion": 1,
  "revision": 42,
  "workItemId": "wi-example",
  "lifecycleStatus": "active",
  "phase": "technical-design",
  "manifestRef": "repo-primary:.sdlc/work-items/wi-example.json",
  "decisionRefs": ["decision-7"],
  "operationRefs": ["operation-12"],
  "validationCycleRef": null,
  "blockerRefs": [],
  "artifactGeneration": 9,
  "policyGeneration": 4,
  "activeTask": "revise recovery design"
}
```

Artifact-producing phases are `requirements`, `test-design`,
`technical-design`, and `coding`.
`active`, `paused`, and `completed` describe workflow status separately.
Only an applied user decision advances a normal phase; a scoped override may
authorize a skipped gate. It is recorded as a deviation, not a fabricated approval.
Document maintenance updates current references without erasing the historical
approved baseline or automatically requiring reapproval.

Within Coding, a validation-cycle record identifies source/configuration
snapshots, the test-specification digest, current testing step, current-cycle
results, current candidate-Review reference/status, and completion/promotion
decision references. Review is a mandatory repeatable stage in that cycle, not a
fifth artifact phase. Routine jobs inside a stage are not phase transitions. A
user-controlled stage boundary is a lifecycle phase boundary or progression
from Review to remote publication/DEV, from DEV to STAGING, and onward. Resetting a
cycle marks Review and remote results pending; it does not schedule remote
builds, deployments, or tests.

Every planned test also has an execution checkpoint independent of environment
and level: `pre-review`, `review`, `post-review`, `DEV`, or `STAGING`. Only all
`pre-review` tests constitute the local prerequisite for `/review`. The Review
observation and later workflow checks remain canonical tests without making
Review depend on itself.

### 5.2 Serialization and crash-safe writes

All mutable stores, including the registry and session records, use the same
write protocol. Acquire an exclusive lock using atomic filesystem creation.
Record an owner token, host, process ID, and acquisition time. Never steal a lock
merely because it is old: a suspended live process still owns it.

Dead-owner recovery requires confirmed owner termination on the same host and
an unchanged ownership token, serialized by a recovery lock. Missing or
unverifiable ownership causes a reported conflict and explicit recovery rather
than an automatic deletion. Lock waits are bounded; a busy gate reports a
temporary denial instead of waiting for a hook timeout.

Under the lock, re-read the expected revision, validate the requested transition,
and apply the update. A stale revision causes recomputation or a bounded retry,
not an overwrite. Acquire multiple locks in one fixed order: registry, work item,
session. Registry locks are released before external agent work.

Write to a unique same-directory temporary file created exclusively, flush and
close it, then atomically replace the destination. Flush the directory where the
platform supports it. Replacement failures preserve the old file and are surfaced;
do not fall back to truncating the destination. Each writer cleans up only its
own temporary file. Process-crash atomicity is distinct from guarantees about
power loss or unusual/network filesystems.

Authorization events are persisted before updating the checkpoint that projects
them. Recovery replays an effective event if a process dies between those writes.
This is one local transaction protocol, not an instruction to write two unrelated
files and hope both survive.

Post-tool candidate assurance uses an independent runtime marker with one
obligation token per concurrent callback. A callback clears only its own token;
forced revalidation remains sticky until a new cycle is created. The marker is
not injected into or persisted as a cycle record, so projection recovery cannot
corrupt schemas or erase another callback's unresolved obligation.

### 5.3 Budgets and pruning

The checkpoint is limited to 16 KiB of UTF-8 JSON; normal context injection is
limited to 1.5 KiB. Snapshot-bearing pending decisions and events are limited to
64 KiB; operations and ordinary records remain limited to 4 KiB. The active
local working set is limited to 256 KiB per work item.
There may be at most 20 unresolved operations and 20 active blockers.
Input receipts contain metadata and hashes, not copies of user conversations.
Standalone monitor records have the same 4 KiB per-record limit. Session context
loads a compact summary and relevant run references, not every monitored run.

Limits are checked before an action becomes effective. No silent truncation,
implicit scope reduction, or dropping of recovery-critical records is permitted.
On overflow, prune eligible records, then report the remaining capacity problem
before starting more work. A status summary names omitted detail and a targeted
lookup rather than cutting a sentence that contains an approval condition.

| Record | Eligible for removal |
| --- | --- |
| Document/decision content temporarily held during authoring | Canonical content is durably saved and retrievable; keep a locator and revision only |
| Resolved blocker | It no longer affects work or a pending recovery decision; no Git audit field is required |
| Terminal operation | Outcome has supporting evidence and that evidence/reference is persisted; remove detailed local record and checkpoint reference |
| Pipeline monitor | The run is terminal and its completion notice is delivered or durably pending elsewhere; dependent flow references remain retrievable |
| Uncertain or in-progress operation | Never automatically pruned or treated as terminal |
| Decision pending Git audit | Keep the effective record and provenance until audited or explicitly resolved |
| Audited decision | Drop redundant input detail; retain only still-applicable authorization metadata and Git references |
| Expired/revoked override or completed scope authorization | Audit is preserved and no unresolved operation still depends on it |
| Ended session | Pending decisions and operations are resolved or handed off; drop its orientation data |

Superseded evidence within the current cycle is also eligible once no current
result or unresolved operation references it. Audited revoked/expired
non-transition authority can move to immutable evidence storage and be restored
from Git audit history when needed; phase/lifecycle projection events remain active.
Current Review references remain dependencies even after revocation. The
checkpoint retains a monotonic event-sequence high-water mark so pruning cannot
cause a later decision to reuse an archived sequence.
Revocation events affecting retained authority remain dependency tombstones even
when their own lifetime has elapsed; pruning cannot reactivate the target.
When a transaction removes related records, it orders each revoked target before
the revocation that depends on it, and all events before their audit references.
Revocation dependency depth is calculated once per event with a cycle guard, so
shared or overlapping revocation graphs remain deterministic and bounded rather
than expanding the same dependency paths repeatedly.

Operation and blocker cleanup does not depend on an `audit` field they do not
possess. A genuinely unavailable record is reported as unavailable; local Git
alone, or a backup containing only Git, cannot recover unsaved operational data.

## 6. User decisions, overrides, and audit events

### 6.1 Input provenance

The agent interprets the user's intent; the CLI validates structured decisions.
A free-form `--evidence "approved"` supplied by the agent is not sufficient.

The runtime adapter creates an input receipt from `userPromptSubmitted`, or from
an observed `ask_user` result supported by the installed CLI adapter. The receipt
contains its source kind, session ID, local receipt ID, timestamp, pending
decision ID when applicable, and a digest of the actual input. Capture occurs as
a hook side effect; it does not depend on the CLI consuming hook stdout.

For prompted approvals, `sdlc decision prepare` binds the pending decision to the
transition, work item, and exact artifact snapshots before the agent asks. For
an unsolicited explicit override, the agent binds a captured user receipt to the
identified work and rule. It states the consequence once and proceeds without
an extra confirmation. Ambiguity is clarified, never inferred as permission.

An approval binds to retrievable snapshots, normally existing Git revisions or
external versions. If only uncommitted files exist, retain authorized immutable
local snapshots outside the checkpoint until their versioned records are
available. A content digest identifies a snapshot but cannot restore its bytes.
These artifact snapshots are retrieved on demand, not injected as active state.

`decision apply` receives a receipt reference and candidate decision via stdin.
The adapter resolves the corresponding user input from the supported runtime
source, or compares the complete supplied input to its captured digest. It rejects
absent, mismatched, agent-authored, or wrong-session sources. The CLI checks scope
and revision constraints; it does not claim to prove the semantics of arbitrary
natural language. The user-visible decision summary makes that interpretation
reviewable. Plain user prompts are the fallback if a structured-response adapter
is unsupported; no false "user-verified" record is fabricated.

Runtime receipts reduce accidental self-approval. A process able to modify the
runtime adapter and local stores can still tamper with them; this is explicitly
outside the claimed correctness boundary.

### 6.2 Effective decision before action; audit afterward

Under the work-item lock, applying a decision first writes its effective local
event, then updates the checkpoint and policy generation. Only then can the gate
permit dependent work. The event survives an interrupted checkpoint update.
An ordinary process crash does not erase an already persisted decision.

Each event has an immutable ID and canonical-content digest. Reapplying the same
ID and content returns the original result; the same ID with different content
is a conflict. A retry does not create another transition or ask the user again.
A newly requested reapproval of a later document revision is a distinct event;
routine maintenance never requires that reapproval.

`decision prepare` returns the stable decision ID required by `decision apply`.
For an unsolicited decision, derive its ID from the captured receipt, work item,
decision kind, and identified scope. Retrying after a lost response therefore
does not generate a fresh ID or apply the decision twice.

The canonical event contains: schema version, event ID, work-item ID, sequence,
kind, effect, source receipt reference/digest, applicable transition, logical
repository IDs, artifact snapshots, rule and operation scope, lifetime, and any
superseded or revoked event IDs. Fields irrelevant to an event kind are absent.
Current artifact references and approved snapshots are separate.

| Event kind | Effective meaning |
| --- | --- |
| Approval | Permit the named next transition against identified snapshots |
| Stage completion confirmation | Record explicit user completion for a phase or environment-validation stage and current validation cycle; machine success alone cannot create this event |
| Override | Set aside only the named framework rules for the user's scope |
| Out-of-scope execution authorization | Permit the identified work without implicitly adding it to the requirements, Test Plan, or Technical Design |
| Out-of-scope documentation authorization | Permit the requested documentation without implicitly authorizing execution or changing the item's scope classification |
| Scope inclusion | User explicitly makes identified work part of the requirements context |
| PR publication authorization | Permit identified PR creation/reuse, source/target and draft/ready state, and explicitly covered publishing steps; not merge or deployment authority |
| DEV execution authorization | Permit the selected candidate's DEV artifact preparation, deployment, and testing after local validation; not standing permission to redeploy after every fix |
| Staging promotion confirmation | Permit STAGING build/deployment after current-cycle local and DEV validation and user-confirmed DEV completion or an applicable override |
| Staging test-result confirmation | Record the user's result for the identified deployment and artifact; this is neither deployment consent nor PROD execution authorization |
| Revocation/completion | End a prior authorization's applicability without deleting its history |

One explicit reply may confirm completion and authorize advancement together;
record the named effects atomically rather than asking the user again. No reply,
a dismissed suggestion, or a terminal pipeline result implies neither effect.
An explicit override can authorize advancement despite incomplete validation,
but the missing tests remain reported as missing.

Out-of-scope execution and documentation are independent permissions. Apply the
user's requested combination, challenge the scope change once, and do not require
a second request when the instruction clearly covers both. A documentation-only
instruction does not start implementation. Preserve an out-of-scope label unless
the user includes the item in the current scope.

An override can cover a phase, workflow, documentation, testing, or commit rule.
It never manufactures external permissions or changes an unexecuted test into a
passed test. Default scope is the identified work, not future unrelated tasks;
broader scope is recorded only when explicitly requested. Once-only grants are
reserved to an operation ID under the lock, so concurrent callers cannot both
consume them. Reservation uses the same kind, target, scope, and action
predicates as policy: a prerequisite push cannot consume PR-publication
authority, documentation cannot consume execution authority, and once-only
documentation cannot be reused.
Revocation prevents new grants; it does not undo an already dispatched operation.
Outstanding operations remain visible and require actual cancellation or
reconciliation rather than being assumed cancelled.

### 6.3 Git audit and reconstruction

`sdlc audit format` emits compact trailers for the agent's next relevant commit:

```text
SDLC-Work-Item: wi-example
SDLC-Event: <base64url canonical sanitized event JSON>
SDLC-Applied: <event ID and digest>
```

An `SDLC-Event` contains all reconstruction fields listed above, including scope
and lifetime, not merely a rule number and a sentence. The human-readable commit
body explains what changed and why. Audit payloads are size-checked, never
silently shortened. Source text is not copied into Git.

After a successful commit, `sdlc audit record` reads it and verifies the exact
event IDs, digests, work-item identity, and applied references before recording
the commit location. The post-tool adapter may invoke the same idempotent check.
Git commit execution itself remains the agent's responsibility.

Authorization can be effective before a commit that both audits it and contains
the authorized changes. History checks therefore accept applicable events in
that same commit or its ancestors; they do not require a separate earlier
approval commit or infer execution order from commit timestamps. For secondary
repositories, include the applicable sanitized event in the affected commit too;
copies have the same ID/digest and are deduplicated during replay.

Replay is scoped to the work-item ID and member repositories, validates event
digests and per-work-item sequence, and applies revocations and lifetimes.
Conflicting records remain unresolved; the newest timestamp is not authority.
Git records show recorded authorization, not independent proof of a user's intent
or of when an edit was executed.

If local records are lost before audit, first seek their original input evidence
and other authoritative records. Ask only when authorization cannot be recovered;
do not invent it. If the user explicitly overrides committing, keep minimal local
decision records and report the reduced audit durability without blocking the
override.

## 7. Operations and evidence

### 7.1 Operation protocol

External operations are driven by the agent's existing tools. The CLI stores a
structured protocol around them, not a pretend provider/MCP client.

Before dispatch, `sdlc op prepare` stores an operation ID, work item, repository,
operation class, authorized target, intended effect, correlation/idempotency key,
and exact-request fingerprint. `op mark-dispatching` happens before the external
call. A supported pre-tool adapter binds the call to that prepared operation;
results are passed back through `op record`.

```text
prepared -> dispatching -> submitted/running -> succeeded/failed/cancelled
                 |
                 +-> uncertain -> reconcile -> known terminal outcome
prepared -> not-started  (only when dispatch was demonstrably not attempted)
```

`uncertain` includes missing handles, timeouts after dispatch, and lost responses.
A successful tool invocation that merely starts a build means `submitted`, not
`succeeded`. A failed tool invocation is not proof the remote action failed.
Terminal outcomes require matching external evidence; a test outcome additionally
requires its expected-result evaluation.

Current hook payloads do not provide an invocation/attempt ID that can safely
distinguish delayed or duplicated callbacks for identical requests. Therefore
`postToolUse` never auto-attaches a provider handle or credits `submitted`;
it conservatively marks a matching bound dispatch `uncertain`. The agent then
uses `op reconcile`/`op record` with provider-read evidence. Unmanaged
fingerprints, duplicates, prior ambiguous attempts, and retries prevent later
automatic binding; no callback can silently supply another attempt's result.
An unmanaged or uncertain deployment-capable action durably invalidates that
environment's selected deployment, tests, and completion. DEV invalidation also
invalidates downstream STAGING. Projection recovery honors the invalidation marker;
only successful reconciliation or a new managed deployment restores the affected
environment. Each cycle retains a deployment-sequence high-water mark and
per-environment invalidation boundary, so pruning or replaying an older success
cannot clear newer uncertainty. Deployment-capable pipelines and implicit
environment effects apply the same pre-dispatch boundary but do not restore an
environment without explicit deployment evidence.

Recovery returns explicit read-only reconciliation actions to the agent, using
the target, time, and correlation key recorded before dispatch. The agent queries
the relevant system and supplies the observed result. No automatic retry of an
uncertain mutation is allowed. Where the remote service supports idempotency,
reuse its key; otherwise surface duplicate-effect risk. A user may explicitly
override the retry restriction, but the earlier result remains uncertain until
evidence resolves it.

Local atomic replacement cannot guarantee exactly-once remote execution. If all
local operation records are lost, report that their absence is not proof of no
in-flight work. Reconcile available targets/history before automatic mutations.

Evidence is a bounded local record or an authorized external reference containing
test ID, implementation/flow reference, artifact revision, environment, run ID,
observed outcome, expected-result evaluation, and time. Raw logs and credentials
are not stored in the checkpoint. References to inaccessible evidence yield
`unverified`, not a success-shaped default.

Artifact selections and terminal deployment operations carry monotonic
per-cycle/environment sequences. Recovery reconstructs each active projection
from the newest complete durable record, even when an interrupted replacement
left an older projection in the cycle. Missing ordering becomes an explicit
ambiguity rather than silently retaining an arbitrary older artifact/deployment.
Environment-specific selection records remain distinct even when DEV and STAGING
reuse the same underlying artifact ID.

Candidate content identity is the effective repository file set: index blob IDs
overlaid by current dirty/untracked Git-normalized blob IDs and file modes. Moving unchanged
bytes from working tree to index therefore does not create a new candidate.
Source revisions remain separate provenance. Markdown Test Plan identity
preserves canonical table definitions plus specification-bearing procedures and
assertions. Only explicitly named mutable Status/Evidence/Activity/Blocker/Run
columns are normalized.

Every test has a current-cycle `status` in the Test Plan, using exactly
`NotRun`, `Passed`, or `Failed` (FR-015). `Passed` and `Failed` require a conclusive
result against the expected outcome. `NotRun` means no such current result is
available. Readiness, running activity, blockers, and missing/uncertain evidence
are shown as separate details; they are not additional values of `status`.

Persist result evidence first, then update the corresponding Test Plan entry.
If that document update fails, retain a pending synchronization reference and
repair it during recovery before relying on the displayed status for advancement.
New tests and tests reset for a new cycle start at `NotRun`; older results remain
historical. Starting a new attempt clears its current-result projection to
`NotRun` with a running detail rather than displaying a stale pass.
Pipeline state, conformance verdict, and user stage confirmation remain separate:
a pipeline success or a completed test does not by itself authorize advancement.
DEV/STAGING test evidence and environment-completion decisions also bind the exact
current deployment attempt. Dispatching a replacement makes prior environment
tests/completion historical; a failed replacement cannot reuse downstream STAGING
or PROD readiness from the earlier deployment. Late evidence for a superseded
STAGING deployment is rejected before it can replace the current test projection.

### 7.2 DEV to Staging to PROD recommendation

This is a deployment subflow within the existing lifecycle, not additional
artifact phases. Every fix restarts local verification from unit tests and
invalidates candidate Review. DEV artifact/build/deploy/testing is a separate,
user-authorized step after local success and Review. Once the user authorizes an
attempt, its jobs run without repeated confirmation. DEV remains before
Staging in the normal sequence.

```text
Coding/fix -> new validation cycle -> full required local unit suite
    -> remaining required local/integration/emulator tests
    -> local tests passed -> present Copilot CLI /review
    -> /review findings -> fix and restart, or current Review evidence
    -> user confirms Review completion and authorizes the selected next action
    -> for DEV, authorize the selected candidate's DEV attempt
    -> satisfy any required PR prerequisites with applicable PR/push authority
    -> obtain DEV artifact (reuse suitable build, or trigger build without a PR)
    -> successful artifact -> automatic DEV deployment
    -> successful deployment -> run DEV tests from the Test Plan
    -> DEV tests passed for this cycle -> request user completion review
    -> user confirms DEV completion -> recommend Staging
    -> user authorizes Staging promotion
    -> satisfy any required PR/provider-review/merge prerequisites
    -> trigger Staging build -> successful artifact -> Staging deployment
    -> execute or hand off planned STAGING tests using the effective owner/location
    -> user confirms success -> assess PROD PR validation/readiness
    -> recommend the PROD pipeline as ready, or identify missing prerequisites
    -> stop; no automatic PROD build or deployment

Any fix -> local revalidation -> /review; no automatic replacement DEV build/deployment
```

Every build and deployment uses section 7.3's links, notifications, and monitoring.
No dependent step starts merely because its prerequisite run was queued or its
monitor stopped. Failed, canceled, skipped, partially successful, and uncertain
results are not normalized to success. Existing CI/CD provider environment approval gates
are surfaced rather than bypassed.

#### 7.2.1 Candidate Review boundary

After the full required local suite passes, the framework presents GitHub
Copilot CLI's built-in `/review` command as the next required action. Slash
commands are interactive CLI commands, so the framework does not pretend that
the offline `sdlc` ledger can execute `/review` itself. It guides the user to run
the command, then consumes the resulting built-in review-agent findings.

The framework does not create an `sdlc-review` AI skill or substitute an ordinary
self-review. Existing deterministic `sdlc check` results remain complementary:
they establish structural requirement/Test Plan/Technical Design traceability,
while `/review` supplies code-change analysis. Neither source is overstated.
“Required local suite” here means the complete `pre-review` checkpoint, not the
Review test itself or later workflow observations.

Apply the normalized outcome as a receipt-bound `review-result` event containing
the validation-cycle ID, candidate/source digest, test-specification digest,
configuration digest, `/review` execution/result reference, outcome (`Passed`,
`ChangesRequired`, or `Blocked`), compact finding references, and time. The
agent cannot create a passing result through an ordinary evidence command.
Do not copy the entire review transcript into lifecycle state.
That event also supplies the current result for the canonical built-in `/review`
checkpoint. Other Review-checkpoint tests retain independent evidence and must
pass before final completion.

Blocking findings return the work to Coding and cannot be replaced by a passing
result on the same unchanged cycle. Any resulting implementation, test, or
configuration change creates a new validation cycle, resets local test status,
and invalidates the prior Review. A specifically scoped user override may set a
finding aside while preserving it as a deviation. A repeated push or readiness
check for the unchanged candidate reuses current Review evidence; Review is
candidate-bound, not command-count-bound.
Review eligibility is evaluated consistently at decision, operation preparation,
dispatch, gate, status, and conformance boundaries. It requires current passing
pre-Review evidence and an active, unexpired, unrevoked Review result.

After a clean current `/review`, the user's captured `review-result:Passed`
decision also records Review completion. The same response may authorize the
corresponding push/PR/DEV action. An explicitly authorized `earlyDraft` action
can precede implementation Review only when its re-derived source-vs-target Git
diff contains registered documents/framework manifest files and no
implementation content; it remains visibly unreviewed and grants no Coding,
Review, or environment readiness. The diff uses the exact provider-resolved
source and target commit IDs; a same-named local target branch is never
substituted.

After a PR exists, reviewer feedback, failed tests, or any other candidate-changing
fix repeats `Coding -> unit-first local validation -> /review -> push`. Provider
review approvals remain separate readiness facts: built-in `/review` cannot cast
a provider vote, and a provider approval cannot replace current local testing or
candidate Review.

DEV execution requires captured user authorization for the candidate, cycle,
target, and build/deployment configuration before starting any DEV-specific job.
Review completion and DEV authorization can be given in one explicit instruction.
The framework does not ask again for each build, deployment, or test inside that
authorized attempt. Host permissions and push authorization remain separate.
Read-only artifact discovery and monitoring existing CI runs need no DEV grant.
Before a dependent environment build/deployment, require current Review and
apply the PR-readiness check in
section 7.5. The check creates a PR only when that publication is authorized;
it does not introduce another lifecycle phase or circularly require a successful
validation run before starting the PR's own validation.

**Local restart after every fix.** Every implementation, test, or
configuration fix after testing creates a new `validationCycleId` and resets the
current local proof to unit-tests-due and Review to not-current. Run the full
required local unit suite, then all remaining required local tests, including
configured local integration and emulator checks, then `/review`. A local compile
may precede those tests. Hosted CI results
may supplement evidence but do not replace required local revalidation.
Fixes reported by the user or discovered during recovery follow the same rule;
the restart is not limited to edits made by the current agent.

Prior passes, Review evidence, and stage-completion confirmations remain historical
and cannot satisfy the new cycle, even if some tests appear unaffected. An authorized
out-of-scope fix in the same delivery candidate also triggers this reset.
Superseded in-flight runs continue to be monitored and reported, but cannot
advance the new cycle. Their existence does not queue a replacement DEV run.
A STAGING fix returns to local testing and then waits for applicable DEV authorization,
not a STAGING-only retry or an automatic full remote replay.
Current lifecycle design approvals stay intact for in-scope fixes; only the
verification cycle restarts.

Dispatching any replacement environment deployment immediately makes that
attempt the current deployment reference and invalidates completion tied to the
previous deployment. A failed, cancelled, or uncertain replacement remains
current evidence of an unresolved environment state; the framework cannot fall
back to older successful STAGING confirmation or present PROD as ready.

Store the restart cause, source/configuration snapshots, and test-specification
digest with the new cycle. The digest includes test definitions and expected
outcomes, not mutable execution-status fields. Recording results or updating a
status must not itself restart testing. A changed verification baseline cannot
reuse old evidence; explicit FR-006 overrides can reduce the sequence, but must
remain visible and do not turn old results into current passes.
Cycle tests are derived from every in-scope row in the canonical Test Plan.
Caller-supplied definitions are accepted only when they exactly match that full
set; omission or reclassification cannot make a partial suite appear complete.
DEV/STAGING test statuses are `NotRun` with an awaiting-authorization/detail marker
until those steps are performed; that status change is not a dispatch command.
Several locally revalidated fixes can therefore precede one authorized DEV attempt.

**Artifact selection.** Bind a candidate to source repository IDs and commit
revisions, pipeline/configuration revision, artifact name/type, environment, and
validation cycle.
After DEV authorization and any required PR checks, reuse a deployable matching
PR/other artifact or monitor a matching in-progress build; otherwise trigger the
configured DEV artifact build. Where no PR prerequisite applies, this works
without a PR. Do not silently use "latest", stale source, or an
artifact a PR validation build does not actually produce. A successful build
with a missing expected artifact is an artifact/configuration failure, not an
unbounded reason to rerun that same build.
CI artifact availability is neither permission to deploy nor proof that local
testing completed. A test launched from the development host against live cloud
DEV still belongs to the authorized DEV step; local mocks/emulators do not.

Pin the deployment to the selected build/run and artifact identifiers. A new
source revision creates a new candidate; late completion of an old build does
not authorize deployment or testing of a different candidate. Check all stages
and parameters the selected pipeline can execute: a DEV invocation must not
implicitly start STAGING or PROD stages.
Likewise, a framework-initiated push or CI action that would implicitly deploy
to DEV needs DEV authorization. Ordinary authorized CI may still build/test and
be monitored without granting a DEV deployment.

**Completion and authorization boundaries.** Local success makes the local stage
ready for review, not permission to start DEV. Capture local completion and
DEV authorization; one explicit response can carry both. After DEV tests pass,
obtain user-confirmed DEV completion before recommending STAGING, and STAGING consent
before queueing its build/deployment. A response can likewise confirm DEV
completion and authorize STAGING together. Silence, decline, or deferment causes no
automatic advancement or remote work.

Record those decisions through section 6, tied to the current cycle, source,
test specification, and target. Only then queue the STAGING build and deploy its
successful artifact. A repeated decision or monitor callback resumes the same
subflow, not another build. A fix requires current-cycle completion and
applicable DEV/STAGING authorization again before the corresponding remote attempt.
Consent for an older candidate is not reused for a new fix. Standing overrides
continue only within their explicitly granted scope; reset never silently
deletes or broadens them.

If a Test Plan intentionally contains STAGING checkpoints without DEV checkpoints,
progression requires active overrides for both the DEV-validation and
DEV-completion prerequisites. Recovery/status guidance evaluates every relevant
repository and target combination represented by the active STAGING-compatible
override scopes, including unrestricted repository or target scopes, and then
uses the normal policy matcher for each prerequisite. It must not depend on
event order or only the first repository in a multi-repository scope. Once an
effective STAGING deployment exists, recovery may recognize and reconcile that
already-started work without recreating its prerequisite authority, even when
the original promotion later expires or is revoked. Existing current STAGING
deployments and already-dispatched STAGING builds/pipelines are handled before
fresh DEV-completion or promotion guidance. A nonterminal replacement operation
takes precedence over handoff, failure, or completion guidance from an older
terminal deployment.
Before a concrete new STAGING operation exists, recovery does not infer execution
authority from a partial synthetic action. It directs preparation of the exact
`build`, `deploy`, or `pipeline` operation, whose normal policy evaluation binds
target, repository, paths, item, lifetime, operation ID, reservations,
promotion, and both prerequisite overrides together. A prepared operation is
revalidated immediately before dispatch; an in-progress operation is monitored
or reconciled rather than replaced. Pending pipeline discovery uses explicit,
staged, and implicit environment declarations consistently. This prevents an
earlier promotion, a consumed `once` grant, or authority for another
target/action from being described as authorization for new remote work.
An inline `completedStage: DEV` claim must identify the actual nonempty current
DEV deployment; when no DEV deployment exists, only an applicable
`dev-completion` override can waive that evidence requirement.

**STAGING result and PROD advice.** After deployment, show the deployed artifact,
deployment link, planned tests, policy-selected owner/location, execution
instructions, and expected outcomes. A user-owned contract produces a handoff;
agent/provider/external-system contracts use their authorized execution path.
The framework never assumes development-host access or a dedicated machine.

Execution mode and owner are distinct: any supported owner may execute an
automated flow, while manual tests remain user-owned. Record each observed test
result independently as NotRun, Passed, or Failed. Agent/provider-owned results
come from terminal prepared test operations. User-reported results use a
receipt-bound `staging-result` event carrying owner, host, evidence reference,
test IDs, and deployment/artifact/cycle/specification identity. A
`staging-result` is evidence, not stage completion.

After every required STAGING test is Passed, a separate receipt-bound
`stage-completion` decision for `completedStage: STAGING` confirms completion
against the current deployment. `hasStagingCompletion` requires both passing
current evidence and that completion event. Neither a replacement deployment
nor a new cycle inherits evidence or confirmation. Without confirmation,
passing tests remain visible while STAGING completion and PROD advice remain
pending.

Only confirmed STAGING success produces the normal PROD recommendation, identifying
the candidate and configured PROD pipeline. PROD also needs successful current
PR validation and any applicable provider review/merge prerequisites. If these
are unresolved, identify them and recommend completing them first; do not
present PROD as ready. This recommendation does not itself authorize creating
a missing PR or running validation. Resolve any supplied pipeline-definition
link; do not invent a run link for a run that was never started. Production
execution requires a separate explicit user instruction and existing production
permissions. FR-006 overrides remain explicit, scoped deviations with truthful
reporting, never fabricated local/DEV/STAGING success.

### 7.3 Verified pipeline links and one-minute monitoring

Monitor every run the framework triggers and every user-triggered run the user
reports, including PROD and runs outside the current development workflow.
No organization-wide scan is implied. A report lacking a resolvable run identity
is clarified rather than matched arbitrarily to the newest run.
When a framework push triggers configured CI pipelines, discover the runs for
that repository/ref/revision and attach each identified run, rather than monitoring
only pipelines queued directly through an API.

Each record has a normalized provider/connection/scope/definition/execution/
attempt identity, `origin` (`framework` or `user-reported`), reporting receipt
where applicable, and optional work-item/cycle/candidate references. IDs from
different provider surfaces are not interchangeable. A user-reported run uses
a read-only standalone monitor context when no work item exists; monitoring
alone does not require a new repository, the four artifact-producing phases,
or candidate Review.

For framework-triggered runs, check monitoring capability, configured targets,
and available read access before queueing. Persist intent, queue once, and record
the returned ID. For user-reported runs, resolve the supplied ID/link against the
provider and attach without queueing anything or fabricating a prior framework
dispatch event. A missing capability is reported in either case; it must not
prevent acknowledging a run the user has already started.

As soon as the run ID is known:

1. Start/attach its read-only monitor, take an immediate status observation, and
   independently resolve its canonical run web link. Link-page verification
   must not delay status polling.
2. Verify the link identifies that run and resolves through authorized access
   to its run page, not an API endpoint, generic page, or sign-in page. Record
   verification outcome and time.
3. Notify the user of trigger origin, pipeline/run, environment when known,
   verified link, and that monitoring is active every minute. For a user report,
   say the framework attached monitoring, not that it triggered the pipeline.
4. Poll every 60 seconds while nonterminal. Notify meaningful changes and always
   notify the terminal outcome; unchanged polls need not create user messages.

If the first status read is already terminal, report that result and the verified
link immediately; do not claim that a finished run is still being monitored.

If link verification or monitor startup is delayed, immediately report the queued
run ID and that the link/monitor is pending. Do not label the link verified or the
monitor active until those operations succeed. An access failure is reported;
HTTP 200 from a login page is not sufficient. Verification establishes access
through the configured authorized context, not a guarantee for unrelated accounts.
Failure to notify does not cause a second build/deployment to be queued.
Link verification and monitoring have separate status: unavailable web-page
access must not stop status polling through an available authorized provider API.

The agent owns a recurring task in the execution host, using its available
scheduler and authorized provider tools. The offline `sdlc` CLI only records scheduling
and observations. The monitor does read-only run queries; it does not deploy,
change permissions, or make phase/promotion decisions on its own.
It runs in an agent/runtime tool task with the configured CI/CD connector; a plain
Node timer does not inherit MCP access. Unchanged polls need not wake the main
orchestrator or load full run details into its conversation.
Scheduler capability is checked before claiming active monitoring. If no
supported timed execution path is available, report a monitoring blocker.

The operation record retains `pollIntervalSeconds: 60`, `lastPollStartedAt`,
`lastSuccessfulPollAt`, `nextPollAt`, current run state, link-verification
metadata, `monitorStatus`, and worker identity. A per-run worker claim prevents
duplicate monitors; there is never more than one poll in flight for that run.
Workers validate the current claim generation before polling and recording a
result; an obsolete callback cannot advance a replacement subflow.
Run monitoring survives validation-cycle replacement so superseded runs still
produce completion notices. The owning deployment flow separately checks cycle
identity before using a result; a monitor event never grants a stage transition.
Schedule by the next due time rather than adding 60 seconds after a lengthy
query. Report missed checks or degraded access; do not disguise runtime/network
delays as continuous monitoring.

Normal terminal states end that run's monitoring task. A waiting infrastructure
approval is nonterminal and remains monitored. Read failures leave completion
unknown and trigger another scheduled read, not a deployment retry. On session
resumption, inspect the worker and run: reattach a live worker or resume polling
the existing run immediately, preserving its ID and candidate binding. A stopped
host cannot poll; mark monitoring suspended/interrupted and disclose the gap
when it is detectable. Never claim monitoring continued while it was stopped.
If scheduler/read capability later changes, an explicit evidence-backed
capability-refresh transition updates only those capability facts, clears stale
worker ownership, and returns a nonterminal monitor to pending or blocked state.
Reattaching the run alone never silently upgrades capabilities.

Only current observations and notification references remain in active state.
Do not append every poll or require a Git commit per minute. Notification replay
may repeat a notice after a crash, but must not repeat a remote operation.
Due reads may be batched where the provider supports it, while retaining each
run's identity, one-minute schedule, and completion notice.

Monitor adoption is observation, not retrospective permission. A reported STAGING
or PROD run does not establish that prior local/DEV tests passed or that the
user confirmed stage completion. If the user explicitly asks to associate it
with a work item, validate candidate/cycle/target and outstanding completion
gates before using it to advance the flow. Otherwise notify its outcome only.

### 7.4 CI/CD adapter contract and configuration

Use the configured CI/CD provider adapter before alternate execution paths.
Discover provider scope, definition, execution, attempt, and artifact
identifiers; do not infer them from names or copy an execution ID between API
surfaces. The adapter exposes:

| Capability | Generic provider operation |
| --- | --- |
| Definition discovery | List and resolve pipeline definitions |
| Candidate builds and status | List builds and read exact build status |
| Pipeline run reads | Read a run by provider-qualified identity |
| Artifact metadata | List and resolve artifacts produced by a run |
| Queue configured build/deployment pipeline | Start the selected pipeline with explicit parameters |

Monitoring records are provider-qualified. A reported run from another provider
uses its configured read adapter; a missing adapter is an explicit monitoring
capability gap, not a reason to ignore the reported run or guess a provider URL.

The generic execution identity is:

```text
provider + connection + scopeRef + definitionRef? + executionRef + attemptRef?
```

All provider references are opaque strings to generic monitor and PR policy.
The adapter maps provider-native responses to this identity and validates
returned source revisions, selected resources, and web links. It must support
source/artifact pinning, run status, and link resolution for the configured
pipeline type. Connection scope and parameters come from the adapter contract;
never invent an unsupported organization, project, or workspace field.

Link verification loads a registered adapter by the identity's provider ID.
The adapter receives provider-native observation data and returns a normalized
identity, canonical HTTPS URL, link kind, accessibility result, and failure
reason where applicable. Generic code validates the result shape and compares
the complete identity with the monitor. URL accessibility alone, caller-stated
execution IDs, and page-type labels never establish identity.

Each link-verification attempt reserves a monotonically increasing generation
before asynchronous adapter work. An older callback cannot overwrite a newer
verified or unverified result. Starting re-verification or losing scheduler/read
capability removes the monitor's derived PR-check references; provider facts
must be refreshed from the currently verified monitor before readiness can
become satisfied again. PR refresh holds the relevant monitor locks through its
facts transaction so revocation cannot race with reference publication.

Monitor notices also carry generations. Delivery acknowledgement names the
generation actually shown to the user; acknowledging an older running notice
cannot deliver or permit pruning of a newer terminal notice.

The built-in Azure DevOps adapter consumes build metadata with project,
repository, definition, build ID, and provider web-link fields. It derives the
opaque scope, definition, and execution references and verifies that a
redirected final URL retains the same `buildId`. It does not make network calls;
the agent supplies the result of an authorized provider read and access check.

Adapters register through a small validated registry. Adding an adapter
implements one normalization function and adapter-specific tests; monitor
storage, status polling, notices, and PR-readiness logic remain unchanged.
Repository configuration cannot load arbitrary adapter code. New built-ins or
trusted host integrations register code before monitor operations. The
published extension guide defines the interface, error handling, fixtures, and
review requirements.

Classic release pipelines or tools without the necessary metadata require an
appropriate configured adapter. Report a capability gap rather than pretending
a YAML-run API can operate a classic release or automatically creating a
replacement pipeline. Additional API/tool access remains the agent's authorized
responsibility, not a network client hidden inside the local ledger.

Per-environment configuration includes build/deployment pipeline kind and identity,
allowed stages, source/resource mappings, artifact contract, template parameters,
cloud targets, PR policy references, and Test Plan checkpoint IDs. PROD
configuration here is used for recommendation only. Pipeline configuration
supplies operational detail, not STAGING consent or permission to execute production.

STAGING configuration additionally requires an execution contract:

```json
{
  "owner": "user | agent | provider | external-system",
  "locations": ["provider-defined-authorized-location"]
}
```

The owner is singular for one environment contract and locations are nonempty,
opaque authorized-location identifiers. STAGING Test Plan rows and managed test
actions must match both. `user` produces a test handoff; `agent`, `provider`,
and `external-system` remain eligible for normal prepared execution only when
the action has an authorized tool path and satisfies all other policy.
Missing/invalid contracts, empty locations, owner/location mismatches, failed
operation preparation, or unavailable external permission produce no dispatch
and no inferred user handoff.

Ownership changes through either a repository configuration update that creates
a new configuration/Test Plan cycle or an explicit
`staging-execution-contract` override scoped to the current cycle,
environment, repository, target, action, owner, and location. Asking whether a
fallback is desired, silence, a declined fallback, or a wrong-scope override
does not authorize reassignment. The actual operation and STAGING result retain
owner/location. A fallback permits those fields to differ from the planned
contract only within its exact scope; it does not waive deployment, artifact,
candidate, Test Plan, or cycle identity.

Authority scope schema therefore adds exact `owner` and `host` fields, where
`host` is the runtime representation of the configured location.
`matchesScope` compares them with action owner/host during policy evaluation,
operation preparation, evidence recording, and replay. The
`staging-execution-contract` rule combines environment-contract and Test Plan
owner/location matching so one correctly scoped override can authorize only the
declared fallback. A fallback action and its evidence still carry the actual
owner/host; the original Test Plan remains unchanged and the deviation stays
visible through the override event.

`effectiveStagingExecution` resolves the base environment contract together
with the one active applicable fallback. A fallback override must explicitly
carry `scope.environment: STAGING`, exactly one effective `scope.owner`, one
effective `scope.host`, and sufficient repository/target/action scope to avoid
cross-operation reuse. Handoff, recovery, policy evaluation, and evidence
validation all call this resolver. Thus an agent-to-user fallback produces
user-specific handoff guidance, while an absent, declined, expired, revoked, or
wrong-scope fallback leaves the original agent-owned contract effective.

Test definitions accept `agent`, `user`, `provider`, and `external-system`
owners, while manual mode remains user-only. Configuration loading validates
the STAGING execution object. `stagingHandoff` loads the deployment member's
configuration, resolves the effective execution contract including any active
fallback, validates every planned STAGING test or authorized deviation against
it, and returns owner-specific execution guidance. Recovery uses the same
resolver and reports missing policy instead of choosing a default.

Individual STAGING tests preserve their actual NotRun/Passed/Failed evidence
for any owner. Explicit user confirmation remains a separate stage-completion
decision after all required tests pass. Until then, recovery/status may report
passing tests but must describe STAGING completion and normal PROD readiness as
pending.

Before policy evaluation, every deployment-capable action is normalized to
exactly one canonical `DEV`, `STAGING`, or `PROD` environment. An explicit
canonical action environment is authoritative only when it does not conflict
with canonical stage hints or scoped label mappings. Repository configuration
may define environment mappings keyed by exact provider, pipeline, label,
target, and configuration digest; repository scope is implicit in the config
file. Missing, wrong-scope, conflicting, and multiply resolved values produce
an `environment-resolution` violation that cannot be converted into managed
credit by a framework override.

Pipeline stages remain provider operation names, not environment aliases. A
noncanonical stage may help resolve an environment only through an exact
mapping. Once resolved, all requested stages are independently checked against
that environment's `allowedStages`. The normalized canonical environment is
stored in prepared operation state so authorization reservation, dispatch-time
revalidation, environment invalidation, recovery, and monitoring use the same
identity. User-directed execution may still proceed outside managed preparation;
the hook reports the missing assurance and falls through.

### 7.5 PR creation, validation, and environment readiness

PR handling is an agent-owned provider operation around the existing lifecycle.
User requests may create a PR early, including for document review or CI;
publishing that PR does not authorize writing implementation before Coding or
complete candidate Review.

**Creation or reuse:**

1. Resolve provider, repository, source repository/ref, target ref, current
   source revision, work scope, and requested draft/ready state. Resolve a default
   target from provider/repository metadata rather than assuming `main`.
2. Search for an appropriate active PR matching that identity and scope. Reuse
   one clear match, report ambiguity, and do not create an empty or duplicate PR.
3. For a missing PR, require explicit publication authority. It may already be
   included in a user-approved PR/push/build/deployment bundle. Otherwise explain
   the prerequisite and ask once. A deployment dependency alone grants no authority.
4. For an implementation candidate, require current `/review` evidence and user
   Review completion or an applicable override before pushing/publishing. An
   explicitly authorized early document/draft PR is marked unreviewed. Commit/push
   only the selected authorized changes if needed. Check the remote
   source revision before publication. No remote is created, unrelated dirty
   work staged, or branch history rewritten merely to satisfy the prerequisite.
5. Record intent under the normal operation protocol and create the PR through
   an available provider adapter. Confirm returned identity, source/target, and
   actual web link. If creation times out, query for the resulting PR before
   retrying; uncertainty must not create duplicates.
6. Report the PR and attach monitoring to its validation runs. Until work is
   ready, use a draft when appropriate to the user's request and repository
   workflow. If draft PRs cannot trigger required checks, surface that condition;
   do not silently mark it ready or bypass checks.

Creating/reusing a PR does not enable auto-merge, vote for approval, bypass
policies, delete branches, or authorize a merge. Built-in `/review`, provider
review actions, merge actions, and policies are separate; if missing authority
blocks the workflow, report it. Existing PR
settings with side effects, such as auto-merge, are surfaced rather than silently
changed or treated as newly authorized.

**Readiness policy:**

| Environment | PR validation requirement |
| --- | --- |
| DEV | Not required by default; apply actual configured pipeline/repository prerequisites |
| Staging | Apply the configured environment's PR, check, review, and merge prerequisites |
| PROD | Successful current PR validation is required; also apply provider/environment review and merge policies |

The adapter supplies the effective policy version, qualifying PR identity/state,
source revision, required target/merge context, required check identities, their
evaluated revisions/outcomes, and provider references. A merged PR can qualify
when its provenance matches the candidate; readiness does not always require a
new active PR. A branch name, PR title, or earlier successful run alone is not
proof.

PR checks use the existing one-minute monitor and verified run-link contract.
Each successful required check carries the complete normalized execution
identity plus PR record, check ID, source revision, and target revision.
Readiness resolves that identity to an actual capable monitor with a verified
run page and matching terminal outcome. An unrelated successful monitor or an
opaque caller-supplied run key is `unverified`.
If the run was first attached without PR context, a separate immutable,
conflict-checked association record may later bind it to the proven PR/check and
revisions without changing its original trigger origin.
Verification is retained per required check association, not merely per run:
two checks sharing one pipeline run cannot reuse each other's association.
Reuse matching queued/running validations. If validation is not automatically
triggered, invoke only a supported PR-context trigger within authority; do not
substitute a manual branch build that the provider does not recognize as the
required PR check. The PR validation run itself does not depend on a previous
passing PR validation. Missing provider policy/check metadata is `unverified`,
not an assumed pass.

Re-read readiness immediately before the dependent build/deployment. Source or
relevant target changes invalidate stale check results according to the provider's
revision context. Accept a synthetic/tested merge revision only with a recorded,
provider-proven relationship to the delivery candidate. A fix or a merge that
changes delivered content returns to local revalidation, `/review`, and applicable
DEV/STAGING authorization, not direct deployment based on the old candidate's evidence.

A passing PR check may produce no deployable artifact. Keep PR validation and
environment artifact production separate, and pin the eventual artifact's
provenance under section 7.2. Build success also does not imply required reviews
or merges were granted.

**Provider and state boundary:** Source-control adapters use their configured
read and write capabilities only as authorized. Required policy/check reads must
use actual supported provider operations, not invented action names. Providers
may be accessed through available tools or an authenticated CLI/API controlled
by the agent's host environment. The local ledger remains offline.

Keep provider-qualified PR identity, source/target revisions, policy/evaluation
references, associated runs, and current readiness in bounded local records.
Record publication intent and rationale in Git where applicable; do not push
an extra commit merely to log every PR check result and thereby retrigger CI.
Readiness is re-derived from provider facts after recovery; observing an existing
PR or green check does not manufacture user publication, merge, or deployment
permission.

Explicit framework overrides remain visible. They do not cause failed or missing
PR checks to be reported as passed, or satisfy external branch/environment
controls by assertion.

## 8. Advisory evaluation and session recovery

### 8.1 Cumulative decision order

The evaluator returns structured findings for unsatisfied managed rules.
After a captured user prompt, findings limited to lifecycle-stage rules are
converted to a one-time advisory and an empty final decision so normal Copilot
permissions remain in control. The same session/rule-set advisory is persisted
and not repeated. Other findings return the same empty final decision without a
framework advisory and mark the action unmanaged. No framework result
pre-approves external access; normal Copilot and host controls still decide.

1. Classify the exact tool request and resolve its paths and target.
2. Validate repository/worktree/work-item/session binding and current generations.
3. For a state-dependent mutation or test execution, require completed recovery
   and orientation.
4. Evaluate phase permission and any relevant artifact-role constraints.
5. Independently evaluate unresolved conflicts, push authorization, operation
   preparation, target scope, test execution owner/authorized host, local unit-first
   ordering, current candidate Review and Review-completion confirmation,
   current-stage completion, DEV execution and STAGING promotion consent, PR
   publication authority and required PR readiness, and protection of existing changes.
6. Apply only explicit overrides matching each affected framework rule and scope.
   Preserve external permission checks and truthful reporting.
7. If only lifecycle-stage rules are unsatisfied and the current user prompt
   directs the action, name the consequence once. For any other finding, withhold
   managed credit without a framework veto. Bind an operation only when strict
   evaluation passed or the only deviations are lifecycle-stage rules.

When an exact request was prepared before dispatch, compare every
classifier-derived security field (including environment, target, stages,
source/target refs and revisions, draft state, artifact/test identity, and
implicit environments, scope item, and out-of-scope classification) with the
prepared action. Matching operation class alone is insufficient and never
permits caller-supplied fields to replace a different independent classification.

For `git push`, classification resolves one explicit remote and branch refspec,
the single effective push-URL-set digest, bound source branch/revision, destination ref,
and force/delete behavior. Those fields must match the prepared operation.
Ordinary push consent cannot authorize another remote/ref or a force/delete;
the latter require explicit scoped deviations. Receipt-bound push consent carries
the same destination fields; multiple push URLs and non-branch destinations are
outside the supported managed form.
The refspec explicitly names full
`refs/heads/source:refs/heads/destination`; Git-configured implicit destination
mapping is unsupported. Legacy schema-version-1 push events remain readable for
audit/recovery but cannot authorize a new push.

Thus a code edit before Coding authority may proceed unmanaged only after an
unmistakable instruction to skip or reorder that lifecycle boundary and its
one-time advisory. A push lacking publication authority, target integrity, or provider
policy also reaches normal permissions, but remains unmanaged and cannot consume
or produce framework-managed operation evidence. Local-validation, `/review`,
and Review-completion findings are reported as stage deviations.
Artifact maintenance permits only the registered document operation, not an
embedded deployment or a second shell command. Scope authorization does not
silently enroll an unrelated change in the primary requirements.
Local success is not a blanket allow for DEV work. DEV-specific artifact builds,
deployments, and tests require the selected candidate's DEV authorization.
After that grant, jobs within the attempt need no repeated confirmation.
The STAGING recommendation needs current-cycle DEV completion confirmation or
override, and its build/deployment needs STAGING consent. STAGING testing uses
the configured execution owner/location or an exact authorized fallback, with
truthful results and a separate completion decision. A PROD recommendation
grants no PROD mutation.

| Tool family | Managed handling |
| --- | --- |
| Direct edit/create/patch | Parse every affected file; canonicalize paths and symlink targets; evaluate all writes, including moves/deletes. `.sdlc/config.json` remains the supported configuration path; other protected `.sdlc`/`.git` paths cannot be relabeled as documents |
| Shell/Git | Classify recognized Git operations before repository/tool adapters. Adapters/configured commands cannot weaken managed-credit rules or discard stricter scope fields. Commit classification accepts index-only forms; `-a`, amend, include/only, signing-option smuggling, pathspec forms, multiple `-C`, mutating `symbolic-ref`, and nonliteral `git add` operands are flagged as untrusted/unmanaged rather than blocked by the framework |
| MCP/external mutations | Use installed tool adapters and prepared-operation fingerprints; no tool-name guess is treated as safe |
| PR publication and updates | Require current candidate Review for normal implementation publication plus selected source/target and publication authority; allow an authorized early document/draft PR while marking it unreviewed and granting no Coding, merge, auto-merge, or deployment authority |
| Declared test execution | Enforce execution owner, host, and target environment even for read-only tests; contacting live DEV from the development machine requires DEV authorization |
| User-reported pipeline observation | Resolve/read/monitor without a development binding when necessary; never queue a replacement or infer stage authority |
| Unknown execution form | Withhold managed credit and fall through to normal permissions; never describe it as framework-validated |
| Read-only discovery/recovery and local framework bookkeeping | Context-independent supported Bash Git/shell reads may run before a work-item binding. PowerShell is not pre-bound by the Bash tokenizer; bound recovery/bookkeeping may run while orientation is pending, within existing CLI access permissions |

No general shell parser can establish every program's side effects. The design
does not claim one: supported patterns are explicit, other executable requests
are not assumed read-only. Gates remain bypassable outside the managed path.

Initialization is a narrow managed-bookkeeping path: a captured development
request and resolved target location establish trusted classification for
creating/selecting the local repository,
branch/worktree, and work-item manifest. These steps may establish the missing
binding; they do not authorize application code, a remote push, or arbitrary
filesystem changes. Ordinary operations use the full gate order once bound.
The pre-binding fast path also permits read-only `pwd`/`ls`/`cd` and PowerShell
location, child-item, content, and path-resolution commands with literal
shell-parsed arguments. Repository-changing Git bootstrap is allowed only after
the session has an actual captured request. Pre-binding clone requires one HTTPS
source plus an explicit canonical child destination; init accepts only its
supported initial-branch flags plus an optional canonical child destination.
Clone/init reject `git -C`, option-looking trailing operands, tilde/glob
expansion anywhere in the Bash bootstrap command, and targets that canonically
escape the confirmed non-Git workspace.
Pre-binding `git switch` is limited to one literal branch or non-destructive
`-c`/`--create`; worktree bootstrap is limited to `worktree add` with literal
non-option branch/target forms. The `-C` repository itself must be canonically
inside the outer workspace; its raw operand is checked before normalization so
symlink-plus-parent traversal cannot change Git's effective repository.
Relative worktree destinations are resolved
from that repository before checking outer-workspace containment. Force,
discard, remove, move, repair, prune, and other destructive variants do not use
the bootstrap exception.
Once a child member is bound,
absolute edit paths and per-command working directories are checked against that
member even if the host session root remains outside Git.
PowerShell stop-parsing (`--%`) and `%NAME%` expansion forms never enter the
literal read fast path because PowerShell can expand arguments after the
framework parser has classified them. PowerShell literal fast paths require
ASCII command syntax, rejecting typographic quotation and Unicode whitespace
forms that PowerShell may tokenize differently. Its tokenizer implements doubled
single/double-quote literals so entry paths and bootstrap targets are compared
to the arguments PowerShell normally passes. Parsed arguments that still contain
embedded double quotes are rejected because Windows PowerShell/Legacy native
argument passing may remove them before invoking Git.
Text adjacent to a closing quoted token is rejected when PowerShell can emit a
new native argument, and parsed tokens are rechecked for quoted/assembled `--%`
or `%...%` expansion markers rather than relying only on raw-text matching.
When session resolution falls back from a non-Git outer workspace, non-read
shell commands—and configured read/bookkeeping shell adapters—cannot inherit the
child repository's configured action or authority unless the tool request itself
runs with that child as its cwd, or a Git command uses an explicit validated
`-C` path to that member. Only independently classified built-in read forms and
verified framework CLI commands bypass repository resolution. The verified
framework allowlist includes artifact registration, operations, cycles, evidence,
handoff, conflicts, PR/monitor/audit/check/status/recovery, and lifecycle
bookkeeping; those commands still enforce their own work-item and cwd contracts.
The same raw `-C` validation applies after binding and during fallback; path
normalization cannot erase parent components before comparison. Managed Git
commands reject inherited `GIT_DIR` or `GIT_WORK_TREE`, and pre-binding
switch/worktree additionally verifies that Git's reported effective worktree is
inside the outer workspace.
After binding, an absolute literal `-C` path may target the exact member root
from one of its subdirectories; bootstrap-only outer containment rules are not
incorrectly applied to that normal bound case.

#### 8.1.1 Framework self-maintenance outside a repository

Self-maintenance is evaluated before repository/work-item resolution. The
trusted form is a direct Node invocation with literal arguments:

```text
node <framework-entry>/bin/sdlc.mjs doctor|install|update|uninstall
  [--home <literal-path>] [--source-root <literal-path>]
```

The entry may be the currently installed framework, or the exact
`bin/sdlc.mjs` under an `ai-sdlc-framework` source/package root selected in the
session's captured user request. Selection is performed through the installed
entry's independent `maintenance select` command, which binds the canonical
root to a receipt ID plus the complete matching captured input. A mere latest
receipt or self-declared package name is insufficient. The evaluator verifies
that recorded selection, package identity,
canonical entry/root correspondence, command-specific option names, duplicate
options, and literal paths. It does not trust another Node script, shell
chaining, redirection, expansion, ambiguous quoting, or a mismatched source
root as framework maintenance.

An untrusted or arbitrary program receives no maintenance identity or lifecycle
authority, but the hook still falls through. Install/update/uninstall retain the
ownership manifest and runtime-state preservation rules in section 3.

Hook and instruction files are loaded at Copilot session startup. Updating them
on disk cannot replace code already executing in that process. A current
advisory hook permits its own update command, but an already-running v1.2.0
blocking hook cannot be retroactively changed. The documented recovery is to run
the literal maintenance command in a host terminal outside the blocked session,
then restart Copilot. This is an explicit compatibility limitation, not a claim
that the new package upgraded the old in-memory hook.

#### 8.1.2 Stage-override intent

The reasoning layer distinguishes the requested destination from permission to
skip the route. A request to build, port, test, publish, contribute to a
marketplace, or create a PR describes the desired outcome. “Go,” “start,”
“ASAP,” “right now,” and “end-to-end” express urgency or permission to begin;
they do not name a framework stage and therefore activate Requirements normally.

The first response briefly says that Requirements is starting and immediately
performs Requirements-phase discovery, including reading contribution rules and
the source implementation. It does not ask whether to use the installed
framework when development intent is already clear.

Every development request receives one concise attempt to follow the applicable
stage. If the user already explicitly rejected that stage, the agent gives its
one-sentence value/consequence and immediately honors the override. The user may
override at the initial request, at a transition, or during a stage; previous
participation never removes that authority.

User-facing language is conversational, not an internal state dump. Conventional
professional terms such as requirements, quality gate, technical design,
review, approval, and lifecycle are appropriate. A suitable
opening is: “Let’s first gather and confirm the requirements so the port matches
the existing framework and the marketplace contribution rules. I’ll start by
reading those sources.” The agent then performs that work. It does not lead with
“I classified this request,” “lifecycle-stage override,” “receipt-backed
deviation,” or “reduced managed assurance.”

Each transition gives one short, task-specific reason for the next step. After
Requirements, for example: “Next, let’s design the Test Plan so we have a quality
gate for functional parity and plugin installation.” Technical Design is framed
as agreeing on the port architecture before coding; Review is framed as checking
the exact candidate before publication. Approval prompts remain concise.

An override exists only when the user unmistakably names or rejects the
lifecycle path—for example, “skip Requirements,” “bypass Test Design,” “go
straight to Coding,” or “do not use these stages.” Ambiguous language defaults
to the normal flow, not to an override. Once an explicit override is understood,
the agent states the skipped stage's value/consequence once and proceeds.
If the user rejects a suggested stage in ordinary language, the agent responds
naturally—for example, “Understood; I’ll proceed directly to implementation and
keep the skipped Test Plan work visible as incomplete”—then acts. It does not
repeat the rationale or demand framework-specific override terminology.

The hook cannot prove natural-language intent. Therefore a captured prompt by
itself never binds managed operation credit for a stage deviation. A tool still
falls through under FR-045, but remains unmanaged until a receipt-bound explicit
override event exists. This prevents urgency from being converted into a
fabricated managed override.

### 8.2 Reorientation before the first mutation

Orientation is per session, not a work-item-wide Boolean. Starting/resuming a
session, compaction, changing branches/bindings, or recovering corrupt state marks
that session as requiring orientation. Authorization/configuration or relevant
artifact changes invalidate the corresponding generation token.

The evaluator reports a dependent mutation as unmanaged until the agent runs
`sdlc resume`, retrieves the necessary authoritative content, and acknowledges
the returned current generation using `sdlc context ack`. After explicit user
direction, this orientation-stage finding becomes a one-time advisory. The
acknowledgment is accepted only if identity and generations still match; the
stage override reports reduced assurance instead of claiming orientation.

`postToolUse` can remind the agent with a compact summary, but cannot by itself
clear orientation: it runs after a tool and is too late to protect that action.
One session's acknowledgement never clears another session's flag. The CLI can
enforce the acknowledgment protocol, not prove the model understood the content.

### 8.3 Hook map and failure policy

| Event | Handler responsibility |
| --- | --- |
| `sessionStart` | Resolve binding, mark session unoriented, inject a compact summary and recovery action |
| `userPromptSubmitted` | Capture input provenance as a local receipt; do not rely on its stdout being injected |
| `preToolUse` | Evaluate cumulative rules, bind only matching managed requests, convert lifecycle-stage overrides to one-time advisories, mark other findings unmanaged, and always fall through |
| `postToolUse` | Capture supported user responses, reconcile observed commits/tool results, optionally inject context; never infer remote completion |
| `postToolUseFailure` | Record the attempt and classify dispatched-but-unknown operations as uncertain |
| `preCompact` | Persist a per-session reorientation requirement; it cannot inject context |
| `agentStop` / `sessionEnd` | Prune eligible local records and retain unresolved decisions/operations; no forced endless continuation |

`sessionStart` is not a compaction event. Copilot command `preToolUse` hooks fail
closed on crashes/nonzero exits, so the framework entry is a minimal launcher
with no static runtime import. It dynamically loads the CLI inside its top-level
`try`; bootstrap/import, Node-version, input-decoding, and state-initialization
failures use a fail-open boundary because a broken framework cannot safely
classify the request. Deliberate evaluator results distinguish one-time stage
advisories from silent unmanaged fall-through. A bootstrap failure writes only
a valid empty final decision and exits zero, so non-stage failures do not create
repeated user-facing warnings.
Timeouts already fall through to normal permissions. The evaluator performs no
network calls, uses bounded local reads and lock waits, and targets completion
under one second. A timeout or exception reduces managed assurance and is
reported, but cannot become a framework execution denial.

If the input adapter or compaction hook failed or was unavailable, the next
managed check must not claim the corresponding protection was observed.
Instructions require recovery after compaction as a second layer. No supported
hook path is presented as proof that all tools or all sessions were intercepted.

## 9. Recovery algorithm

`sdlc resume` performs local reconstruction; the agent performs any requested
external reconciliation. Recovery runs before dependent actions, not merely
after a failure is noticed.

1. Resolve and validate the work item and member bindings under section 4.
2. Load valid local records and rebuild or refresh the checkpoint as a projection.
   Effective pending-audit events survive checkpoint loss and idempotent retries.
3. If local records are missing, replay reachable, applicable Git events from
   registered member repositories. Restore only fields actually present.
4. Compare current working-tree content and artifact revisions with recorded
   references. Preserve dirty changes; keep approved snapshots distinct from
   later document maintenance.
5. Return unresolved operation and evidence queries to the agent. Missing facts
   remain explicit blockers on dependent actions, not invented progress.
6. Persist the reconciled checkpoint, return the next authorized action and
   orientation token, and acknowledge orientation under section 8.2.

Git audit replay validates complete history but materializes into active records
only current authority, phase/lifecycle projection events, revocations, and
events referenced by current Review/test/reservation state. Archived inactive
history stays outside the active working-set budget.

No audit records does not immediately mean "new work." Existing manifests and
documents may indicate work predating the framework. `sdlc init --adopt` proposes
a baseline from available records and original user evidence. Where that evidence
is unavailable, the user confirms the proposed starting state. Adoption records
what is known now without manufacturing historical timestamps or approvals.

An adopted `historyStartsAt` reference lives in the work-item manifest and audit
event, not only in the disposable checkpoint. Older commits are marked
pre-framework/unverified. This project's earlier conversation approvals can be
used as sourced bootstrap evidence when accessible; no history rewriting is
required. A request to adopt is not approval to enter Coding.

Historical user evidence is imported only through a source-aware runtime adapter.
An unsupported transcript format or a document's approval label is not accepted
as proof; that case needs confirmation of the proposed starting state.

Deployment recovery also restores candidate, environment, build/artifact/deployment
bindings, current validation cycle, local restart state, DEV authorization,
monitoring due times, and completion/STAGING promotion decisions. Resume each
identified run, including standalone user-reported runs, without requeueing it.
Without current-candidate DEV authority, recovery returns an authorization wait,
not a replacement DEV build/deployment. Old-cycle results cannot advance the cycle.
PR recovery re-queries the recorded provider identity and check revisions, resolves
uncertain creation before any retry, and resumes associated monitors. Old green
checks or an existing PR never replace current deployment-readiness evaluation.

## 10. Artifacts, configuration, and phase skills

### 10.1 Artifact locators and current versus approved content

Artifact registration identifies work item, role, storage kind, owning logical
repository where applicable, exact path/URI, and a retrievable revision or digest.
Git revisions include repository ID plus commit and blob identity, not an
ambiguous `path@sha` across several repositories.

Support authorized file locations outside the primary repository, including
another participating repository. External references are retrieved by the agent
through existing permitted tools and returned as structured metadata. A permitted
external path is not automatically a framework conflict. Unavailable access or
missing revision evidence is reported specifically.

There is one logical Test Design/Test Plan per work item, not one test document
for the entire repository. Do not create duplicates to work around an external
location. Gate exceptions cover registered files, never every file in a directory.
Uncommitted document content can be identified by a content digest before a
later commit; record its Git revision when available.

### 10.2 Repository configuration

Optional `.sdlc/config.json` supplies artifact-location defaults, known build/test
commands, pipeline references, and development targets. Repository instructions
are also read by the agent. Compatible repository choices take precedence.
Deployment entries distinguish DEV, Staging, and PROD and carry the
environment-specific contracts in section 7.4 and PR prerequisites in section 7.5.
Configuration declares required validation/check IDs, applicable target context,
and whether reviews/merge are required, separately from artifact-build pipelines.
A setting that disables the framework's PROD PR-validation requirement is a
conflict or explicit override, not silently compatible configuration.

The CLI detects structural problems such as malformed values and broken locators.
The agent identifies semantic contradictions with framework requirements.
Both become explicit scoped conflicts with references to the opposing rules.
Affected work waits for user resolution; unrelated authorized work may continue.
A resolution may be a configuration correction or an explicit FR-006 override.
No resolution silently expands the user's external permissions.

Push permission is a scoped user decision, not authority granted merely by a
repository file saying `"authorized": true`. Global or persistent permission is
honored when explicitly given by the user, not inferred from a remote's presence.

### 10.3 Skills and templates

| Skill | Procedure and output |
| --- | --- |
| `sdlc` | Classify development versus information/monitoring requests; initialize/select work when needed, attach reported runs, recover, expose status |
| `sdlc-requirements` | Analyze sources and distinct items, clarify ambiguity, write requirement-specific DoDs |
| `sdlc-test-design` | Maintain IDs, coverage, modes, owners/hosts, NotRun/Passed/Failed status, and explicit pre-review/review/post-review/DEV/STAGING checkpoints |
| `sdlc-technical-design` | Design the solution, map requirements, update affected earlier artifacts and test needs |
| `sdlc-coding` | Implement/fix, rerun local tests from units, present built-in `/review`, resolve findings, wait for Review completion/DEV authorization, execute that attempt, request DEV completion/STAGING consent, and follow the configured STAGING execution owner/location |

The orchestrator handles explicit PR requests in any applicable phase and invokes
the shared readiness procedure when a deployment requires it. It does not wait
for an extra "PR phase" or create one.
Candidate Review likewise uses Copilot CLI's built-in `/review`; the framework
does not install a duplicate review skill.

Each skill reads the thin state, retrieves relevant content, updates artifacts
when needed, and stops at the user-controlled boundary unless an applicable
explicit override exists. Phase transitions follow decision events, not a skill
editing `phase` directly.
Readiness is reported for user completion review; it is not permission to
advance or automatically recommend the next stage. An explicit response may
confirm completion and authorize the transition together.

Templates provide Requirements, Test Plan, and Technical Design documents.
Canonical defaults are per-work-item paths under `docs/`; configured/user-requested
locations win. New tests are added during design when discovered, without waiting
for approval of the whole design. In-scope document changes are automatic and
followed by one concise notification per logical batch.
The Test Plan template has a visible Status field for each test. Implementation
references, blocker/activity details, and result evidence are separate metadata.

Out-of-scope items enter these documents only on an explicit documentation or
scope-inclusion instruction. Execution-only permission does not authorize
documentation; documentation-only permission does not authorize execution.
If the user requests a note about an out-of-scope item, keep that classification
and exclude it from in-scope coverage/completion calculations until scope changes.
Do not use FR-004 maintenance to silently include it. An executed fix to the
current candidate still restarts local revalidation and invalidates previous
remote proof, but does not automatically start remote pipelines, regardless of label.

## 11. Conformance and exit-code contract

`sdlc check artifacts|state|history|evidence` emits structured per-check results
and a concise human summary. Conformance verdicts are separate from test statuses
(`NotRun`, `Passed`, `Failed`), implementation readiness, and execution blockers.

| Verdict | Meaning | Exit contribution |
| --- | --- | --- |
| `satisfied` | Applicable deterministic assertions have supporting evidence | 0 |
| `not-applicable` | Check is not due for this phase/work item; reason and later checkpoint are explicit | 0 |
| `authorized-deviation` | An explicit applicable override covers the unmet rule; not reported as a passed test | 0, with deviation visible in structured and human output |
| `violation` | Available records demonstrate a broken rule | 2 |
| `unverified` | Required evidence is absent, inaccessible, or insufficient | 3 |
| `error` | The checker could not execute reliably or encountered conflicting/corrupt input | 4 |

Aggregate precedence is `error`, `violation`, `unverified`, then authorized
deviation, then satisfied/not-applicable. Output includes all findings even when
one determines the exit code. No required unknown result returns a success code.
Overrides waive only their specific rule; they do not relabel evidence as true.

| Check | Deterministic scope and limits |
| --- | --- |
| `artifacts` | Schema, IDs/links, per-requirement DoD, registered test document uniqueness, coverage, and per-test NotRun/Passed/Failed status when due |
| `state` | Schema, size budgets, identity/generation consistency, references, and allowed-field constraints; no claim to detect every semantic duplicate |
| `history` | After adoption boundary, presence and applicability of recorded decisions in the same commit or ancestors; contradictory records are errors |
| `evidence` | Match declared outcomes to available execution references and artifact/environment identity; a dispatched tool is not a passed test |

Deployment evidence also checks the build-to-artifact-to-environment chain,
validation-cycle and test-definition identities, user stage-completion/override
records, current-candidate DEV authorization, monitoring origin/cadence/link
verification, STAGING consent, and the
separate policy-owned STAGING test results plus user completion decision.
Missing evidence is unverified, and old-cycle
passes cannot establish current success. Reporting an external run is not proof
of consent to preceding or subsequent workflow stages.
Where PR validation is required, evidence includes the qualifying PR/check
revision context and policy evaluation. Missing/stale facts are readiness gaps;
a generic successful build cannot satisfy a PR-specific validation requirement.
An `unverified` checker finding does not create a fourth Test Plan status or
invent a test outcome. Without a conclusive current result, use `NotRun` with an
explicit reason. If a previously recorded result cannot now be reverified, report
that evidence problem separately rather than inventing a failure or erasing
history. Schema conformance does not make a `NotRun` test executed.

Checks are phase- and work-item-aware. During Requirements, absence of a Test Plan
is expected; after Test Design coverage is required. Missing a future artifact is
not a violation. Authorized testing-depth or documentation overrides are applied
before assessing the corresponding assertion.

A commit subject/body can be checked for presence, not automatically certified as
meaningful reasoning. A body is not mandatory where the subject explains the
change adequately. History cannot prove when code was written, whether the agent
paused before editing, or that a missing event means no authorization existed.
Missing provenance yields `unverified`; a proven logging-policy breach may be
reported separately without claiming an unproved execution violation.

The original T-15 observations are split between deterministic record checks
(T-15) and human review of rationale during real work (T-11). The inspector does
not infer evidence it lacks.

## 12. Progress, completion, and local-only workflows

`sdlc status` reports phase, current task, current candidate Review/result,
outstanding approvals, scoped overrides,
conflicts, uncertain operations, required unexecuted tests, and next actions.
The compact session summary points to detail rather than loading full history.
For active build/deployment subflows it also reports the environment, candidate,
verified run link (or link error), latest result, last/next poll, monitor state,
trigger origin, current validation cycle, and the exact user decision awaited:
local completion, DEV authorization/completion, STAGING consent, or STAGING test completion.
Standalone run
monitoring reports the run result without implying any development-stage state.
For PR-dependent work, status also identifies the PR link, current check state,
missing reviews/merge prerequisites, and any publication authorization still
needed. A PROD recommendation distinguishes ready from blocked/unverified.

Completion reflects each in-scope requirement's DoD and applicable test outcomes.
Skipped checks under an explicit override remain visibly skipped. User-authorized
out-of-scope work is tracked separately and does not silently change in-scope DoDs.
Framework-reported success is readiness for the user's completion decision, not
an automatic stage transition or recommendation.

`nextAction` first respects `paused` and `completed` lifecycle status, then
derives remote progression from planned checkpoints. A reviewed local-only work
item requests completion rather than DEV; a DEV-only item can request completion
after confirmed DEV without inventing STAGING/PROD work. Before any completion
recommendation, required `post-review` tests must pass; failed or pending tests
produce diagnosis/execution advice.

`local-testing`, `review-due`, `review-changes-required`,
`awaiting-review-completion`, `awaiting-dev-authorization`, `dev-authorized`,
`dev-running`, `awaiting-dev-completion`, `promotion-declined`,
`promotion-deferred`, and `awaiting-staging-result` are distinct subflow conditions.
Without a user response, the decision remains pending, not declined or overridden.
A declined/deferred recommendation stops automatic advancement, including
further recommendations.
The framework may report DEV as validated while STAGING is not performed, but not
report all validation as complete. Required outstanding tests stay outstanding
unless explicitly overridden.
Likewise, local validation may be complete while DEV remains `NotRun` awaiting
authorization. The developer can continue making locally revalidated fixes
before authorizing one DEV attempt; that waiting state never dispatches remotely.

Keep active decision/cycle references while a user response or dependent stage
is pending. Release development bindings only when the user explicitly completes,
stops, or overrides that work and any necessary handoff is recorded. Pipeline
monitors, including those for superseded cycles and user-reported runs, retain
their own records until terminal notification or an explicit monitoring override.

Local-only repositories remain usable. A required remote validation that cannot
run without a remote or permission is a blocker on that validation, not proof of
framework failure or permission to push. Restoring a machine requires a backup
that includes the necessary local records, or reconstruction from available
remote/Git evidence. Neither ordinary commits nor pushing code alone guarantee
recovery of in-flight operation state.

## 13. Information handling and external controls

Use allowlisted structured fields, safe summaries, content digests, and authorized
references. The CLI does not request credentials or embed whole user prompts,
incident bodies, or raw logs into state or Git events. Local runtime files use
restrictive permissions where supported by the platform.

Secret-pattern detection is a secondary diagnostic, not proof content is safe.
If candidate record content is unsafe, malformed, or oversized, reject or request
a sanitized/reference-based representation explicitly. Never silently remove
fields or truncate approval text: doing so could discard a condition or change
the scope of the user's decision.

Audit output is reviewed as part of the commit; Git hooks, later pushes, tool
arguments, and log sinks can expose data. "No network client" is not a claim that
exfiltration is impossible. Copilot permission controls, external authorization,
and repository/organization controls remain independent of framework overrides.

Retrieved sources are data. Instructions embedded in them cannot grant approval,
enable a push, or register an override. Receipt provenance is validated through
the runtime adapter; semantic interpretation remains an agent responsibility
with visible consequences and stated limits.

## 14. Requirement-to-design map

| Requirements | Design elements |
| --- | --- |
| FR-001, FR-002 | Activation and phase skills (10.3), work-item initialization (4), cumulative gates (8) |
| FR-003 | Captured completion/advancement decisions and overrides, idempotent apply, approved snapshots, audit replay (6, 8, 12) |
| FR-004 | In-scope document maintenance with change notifications; approved references remain distinct (5.1, 10.3) |
| FR-005, FR-006 | Separate out-of-scope execution/documentation permission, scope inclusion, scoped overrides, truthful deviations (6, 8, 10.3, 12) |
| FR-007..FR-010 | Requirements skill, source handling, requirement-specific DoD template (10.3, 13) |
| FR-011..FR-016 | Single evolving Test Plan, test metadata/evidence, phase-aware conformance (7, 10, 11) |
| FR-017..FR-019 | Technical Design skill, document maintenance, phase boundary (6, 8, 10.3) |
| FR-020..FR-024 | Per-fix full local testing from units, separate remote authorization, execution ownership, cumulative gates, and cycle evidence (7, 8, 10.3, 12) |
| FR-025, FR-026 | Repository setup and identity (4), agent-owned Git execution (2), push authorization and remote blockers (8, 10.2, 12) |
| FR-027 | User-level installation and lifecycle documentation (3); shared multi-repository work-item identity (4) |
| FR-028 | Thin checkpoint, bounded local stores, concurrency and pruning (5), per-session orientation (8) |
| FR-029 | Meaningful Git history, complete audit events, minimal local records (5.3, 6.3) |
| FR-030 | Reconciliation-based recovery, pending-event recovery, adoption, no automatic uncertain retries (7, 9) |
| FR-031 | Applied configuration and explicit conflict resolution (10.2) |
| FR-032 | Runtime provenance and permission boundaries, information minimization (6.1, 8, 13) |
| FR-033 | Compact progress, blockers and targeted retrieval (12) |
| FR-034 | User-authorized DEV step after local success, artifact/build/deploy/test sequencing, and no per-fix remote replay (6.2, 7.2, 8.1) |
| FR-035 | Every framework-triggered/user-reported run, standalone observation, origin-aware notifications, 60-second monitoring and recovery (4.2, 7.3, 7.4, 9, 12) |
| FR-036 | Authorized DEV validation after local success, user-confirmed DEV completion, and separate STAGING consent (6.2, 7.2, 8.1) |
| FR-037 | Policy-governed STAGING owner/location, truthful results, and separate completion confirmation bound to deployment/cycle (6.2, 7.2, 7.4) |
| FR-038 | PROD recommendation after STAGING confirmation, with PR readiness/missing prerequisites reported and no automatic PROD operation (7.2, 7.5, 8.1) |
| FR-039 | User-authorized PR creation/reuse, source/target resolution, publishing and merge boundaries, duplicate prevention (6.2, 7.5, 8.1) |
| FR-040 | Per-environment PR requirements, current check provenance, independent artifact/review/merge readiness, PROD readiness reporting (7.2, 7.5, 10.2, 11, 12) |
| FR-041 | Built-in `/review` candidate stage, candidate-bound evidence and invalidation, user completion, and publication/DEV gates (5.1, 7.2.1, 7.5, 8.1, 10.3, 12) |
| FR-042 | Reproducible single-file project/version package, internal digest/inventory comparison, isolated lifecycle verification, and retained CI artifact (3.2) |
| FR-043 | Dedicated technology-neutral knowledge, coding, testing, building, and reviewing guides with task-specific loading and repository precedence (3.3, 10.3) |
| FR-049 | Canonical environment resolution, scoped provider-label mappings, stage separation, and unmanaged unresolved execution (7.4, 8.1, 10.2) |
| FR-050 | Provider-neutral execution identities, adapter-derived verified links, Azure DevOps reference mapping, extensible registration, and complete PR association (7.4, 7.5) |
| FR-051 | Shared lifecycle-intent guidance, consistent focused-skill interpretation, useful stage work, and no fabricated override credit (3.3, 8, 10.3) |
| FR-052 | Policy-selected STAGING owner/location, authorized fallback, managed execution boundaries, and owner-independent result reporting (7.2, 7.4, 8.1, 10.2) |
| FR-053 | Shared multi-channel payload identity, standalone launchers, WinGet/Homebrew ownership, native release gates, and public-client acceptance (3.1, 3.2) |

## 15. Focused test impact

The [Test Plan](test-plan.md) remains short and uses this repository's own work
for observation. Automated cases use small isolated filesystem, event, hook-input,
and Git-metadata fixtures; they do not simulate a product or run AI evaluations.
No destructive test deletes a live checkpoint or operates on real cloud resources.

T-14/T-15 cover phase-aware conformance and audit evidence. T-16..T-20 cover
atomicity, decisions, operation retention, recovery/binding, and cumulative gates.
T-21..T-23 cover verdict/exit codes, per-session pre-mutation orientation, and
installation/artifact-location boundaries. Failure injection is deterministic
at persistence steps, not a timing-sensitive random process kill.
T-24..T-28 cover DEV artifact/build/deploy ordering, verified links and polling,
STAGING confirmation boundaries, and PROD recommendation without execution. They
use a fake clock and small CI/CD provider response fixtures, never minute-long sleeps,
real pipeline triggers, or cloud deployments.
T-29..T-31 cover per-fix local restart without remote dispatch, standalone
user-reported pipeline monitoring, and independent out-of-scope permissions.
T-32..T-34 cover PR creation/reuse, revision-bound validation, and independent
merge/artifact/deployment permissions using small provider fixtures. T-35 covers
built-in `/review` handoff, candidate-bound evidence, stale-review invalidation,
and publication/DEV gating without an AI-evaluation benchmark. T-36 covers
reproducible package identity/integrity and isolated installation lifecycle
without touching the user's real Copilot home. T-37 covers focused engineering
instruction content, task-specific references, packaging, and install ownership.
T-47 covers canonical environment resolution, scoped provider mappings,
conflict detection, normalized operation persistence, and authority reservation.
T-48 covers execution identity uniqueness, provider-adapter registration,
Azure DevOps metadata/link normalization, negative link identity cases, and
complete PR-check association.
T-49 covers the shared lifecycle-intent guide and prompt matrix across every
source and installed phase skill. T-50 covers STAGING execution-contract
validation, owner/location policy, scoped fallback, truthful result reporting,
completion boundaries, generated guidance, and source/installed wording.

Implementation runs these as targeted local tests. A supported CLI's hook payload
smoke check is distinct from a model benchmark. Real cloud/pipeline integration
that is not exercised remains unverified; fixture success does not substitute.

## 16. Limits and supporting references

The human overview and shared diagrams summarize this design. Refresh them in
the same change whenever behavior or a major decision changes, and update the
overview's source Git blob identifier. Compare the shared blocks during document
review; do not maintain a separate revision-history table or approval authority.

| Limit | Defined response |
| --- | --- |
| Missing or corrupt authority records | Attempt targeted recovery; otherwise block dependent work without inventing approval |
| Uninstrumented execution or hook timeout | State the enforcement gap; inspect available evidence without promising detection |
| Privileged local tampering | Outside the correctness boundary; writable files cannot provide an independent trust root |
| Uncertain external effects | Reconcile before automatic retry; exactly-once is not promised |
| All local records and external evidence unavailable | Report the loss; Git does not contain facts that were never audited |
| Lock ownership or atomic replacement cannot be established | Preserve existing state; report a recoverable error rather than overwrite |
| A compatibility adapter is unsupported | Report the capability gap and use a supported input/tool path; do not silently claim parity |
| Monitoring runtime stops or CI/CD provider becomes unavailable | Mark monitoring suspended/degraded, disclose the observation gap, and resume the same run rather than queueing a duplicate |
| A CI/CD provider web link cannot be verified | Report the run identity and link-verification blocker; do not label the URL working or substitute an invented link |

Technical contracts use the documented CLI extension points:
[custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions),
[skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills),
and [hooks](https://docs.github.com/en/copilot/reference/hooks-reference).
Git metadata handling follows [git rev-parse](https://git-scm.com/docs/git-rev-parse)
and [worktrees](https://git-scm.com/docs/git-worktree). Behavior involving Git
subprocesses must account for [Git hooks](https://git-scm.com/docs/githooks).
