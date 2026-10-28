# Testing and CI reproduction

## Small default local gate

Node >=22 and Git are required. No runtime dependency installation is needed.
Run the finite critical sanity selection, unit stage first, then cheap static
and documentation checks:

```sh
npm run test:critical
npm run check
```

The critical set is explicit in `scripts/test-profiles.mjs`: three canonical
unit files with 16 assertions, followed by 11 selected risk roots. The root
budget is 27 before any declared nested assertion closure. Its purpose is to
detect broken essential contracts, not exhaustively test every feature.
New tests are **PR-only by default**; automated/unit/pre-review labels alone
never add them to critical. Classification instructions for a source checkout
are in `AGENTS.md` and `.github/testing-policy.md`. They are intentionally absent
from npm and installed homes and are not a consumer framework policy.

`npm test` / `npm run test:full` and `npm run test:coverage` are opt-in local
exhaustive runs, not prerequisites for opening a PR. The timing goal is advisory,
not permission to remove assertions, weaken fixtures or call unlike inventories
a speedup. Measure the actual command with its source, toolchain and resource
limits before making performance claims.
After a candidate-changing fix, repeat the complete required local unit-first
checkpoint. Freeze source before candidate-bound validation.
The critical command includes the canonical three-file/16-case unit stage once.
Standalone `npm run test:unit` remains available for unit-only work;
do not prepend it to the default critical sequence and repeat those assertions.

### Protected hosts without npm

If npm is blocked on the development machine, do not run npm/npx, download
replacement tooling or invoke npm's CLI through Node or another entry point.
Do not change TLS, registry, proxy or machine protections to work around it.
The same finite Node-only sanity and static gates are available directly:

```sh
node scripts/test-runner.mjs critical
node scripts/check.mjs
```

These project entry points are not a way to invoke blocked npm functionality.
Keep npm-dependent integration checks, package-manager operations and authentic
npm-verifier provisioning on the required capable GitHub PR runners, in their
owned isolated directories. Do not run an affected/full local selection that
includes those operations. Missing local npm capability remains **NotRun**;
it neither waives hosted coverage nor becomes a skipped or passing acceptance
result. Ordinary contributors with npm available may still use the commands
above this section.

### Optional targeted debugging

For an isolated iteration, use an existing file and, optionally, an exact name:

```sh
npm run test:targeted -- --name "^T-PRD049 " test/public-readiness-docs.test.mjs
```

Repeatable `--affected FILE` and optional `--affected-name REGEX` can explicitly
add an affected selection to `test:critical`, deduplicating required assertions.
That is a developer choice, **not the default gate** or an automatic impact guess.
Standalone targeted mode preserves caller order. All selected unit groups finish
before integration groups.

### Safe local recipe

The following source-check/affected-test recipe is executable in an owned
repository fixture. The selected filename and exact name filter are part of
the recipe, not merely an npm script-name check.

<!-- recipe:docs-local -->
```sh
node scripts/check-docs.mjs
node scripts/test-runner.mjs targeted --name "^T-PRD048 " test/public-readiness-docs.test.mjs
```

Use real existing selected files; escaping the repository, an absent test or
worker, malformed options or an unprovisioned runtime must fail with diagnostics.
This recipe performs no install, purge, registry request or provider operation.

### Isolation and honest results

A narrow sanity pass does not complete the full Test Plan, native matrix,
private-reporting walkthrough or release acceptance. Keep manual procedures and
unavailable capabilities explicitly NotRun; preserve original failures, partial
reports and cancellation. The private-reporting setting is now verified enabled,
but no submitted report or complete walkthrough is claimed by that setting alone.
A successful finite profile completes only its declared local **L** sanity gate;
it does not pretend every planned acceptance case ran locally. Exhaustive
automation remains required in applicable PR lanes and later gates.

Nested development runners inherit one job-local worker budget; their parents
yield active slots while children run instead of multiplying independent worker
counts. The ephemeral loopback coordinator is developer-test orchestration, not
a service or network client added to the shipped offline core. A real overlap
test needs its declared aggregate allocation; an unavailable allocation remains
an explicit capability/NotRun result, not a fabricated timing claim.
Independent root groups use separate processes; tests sharing mutable module
state, environment or a package-manager prefix cannot simply run concurrently.
Dependencies, minimum slots and exclusive resources constrain the ready-work
pool. Released capacity may serve another ready group; configured worker counts
alone do not prove actual overlap, ordering or resource safety.

If a retained local archive is intentionally needed, the separate local output
commands are:

```sh
npm run package:artifact
npm run verify:package
```

Packaging/verification uses owned isolated fixtures, not the installed home.
Never use `--purge-existing` on a contributor's real home for testing.

## Complete hosted PR gate

Every PR, including docs-only PRs and contributors who ran nothing locally,
requires complete applicable hosted validation: Linux shared behavior, native
Windows x64, Apple Silicon macOS and Intel macOS. A narrow local pass is not
full validation. Required unavailable tools, missing jobs, unexpected skips,
cancellation and partial reports cannot pass the completeness gate.
The independent `framework/coverage` check inspects canonical coverage declared
in the current PR description, not execution statuses.
Its currently adopted artifact set is the registered public-readiness
Requirements/Test Plan with `repositoryId: primary` and
`artifactId: public-readiness`. Historical core/framework/feature archives are
not silently added to that current metadata policy. A future adopting-policy
change must select its artifact set explicitly; this does not narrow required
execution profiles or impose this repository's policy on consumers.

The trusted observer reads candidate artifact ZIPs as bounded data through a
reviewed default-branch CPython **3.12.10** stdlib reader (`-I -S`), not by
executing or extracting candidate code in a privileged job. It needs no pip
packages. Protected repository configuration uses:

| Variable | Prerequisite |
| --- | --- |
| `READINESS_STATUS_CREATOR_ID` | Actual independently verified expected status-writer identity, not a guessed account/App ID. |
| `READINESS_PRODUCER_REVISION` | Optional explicit adopted producer SHA; otherwise the reviewed current default-branch source is selected. |
| `READINESS_ARTIFACT_ORIGINS` | Explicitly approved exact HTTPS artifact/log service origins for SDK redirects; no wildcard or guessed-origin allowance is implied. |

Missing capabilities fail explicitly. These are deployment prerequisites, not
claims that variables, required status-source associations or merge enforcement
are enabled. The observer can bootstrap observations before branch protection
is adopted; effective enforcement still needs an actual separately authorized
provider observation.

See the [living Test Plan host/toolchain contract](../sdlc/public-readiness/test-plan.md#22-hosts-and-prerequisites)
for fixed versions and required assertions. To reproduce a lane, select its exact
native OS/architecture/toolchain and owned caches, not a translated host.
The native driver is a **provider-owned recipe**, not a local command made
native by inventing `GITHUB_*` identities. Run the exact checked-in CI step
only in the separately authorized matching lane, with its acquired run/attempt,
source, bootstrap, frozen candidate and artifact pins. Local T-PRD051 checks
argument/safety/prerequisite rejection without fabricating those identities;
actual native reproduction evidence is retained by T-PRD014 and T-PRD079.
The following is the provider-owned Linux PR invocation after the workflow
acquires all exact source/artifact/tool/bootstrap prerequisites. Outside that
environment, missing pins must fail before output creation.

<!-- recipe:native-pr -->
```sh
node scripts/native-validation.mjs --target linux-x64 --profile pr --phase validation --candidate-dir .test-data/native-candidate --evidence-dir .test-data/native-evidence --build-candidate false
```
`scripts/native-validation.mjs` accepts `--target`, `--profile pr`,
`--phase candidate|validation`, `--candidate-dir`, `--evidence-dir` and
`--build-candidate true|false`; use only
owned directories and the native workflow's declared environment. Outputs
include `execution.json`, `readiness-bundle.json`, `readiness.md` and
`producer.json`, plus original unit/regression/tool reports. These files are
diagnostics/evidence inputs, not self-authenticating passing proof.
The native artifact root directly contains `execution.json` and original
reports; bootstrap diagnostics are retained as a separate CI artifact, not
silently counted as a native execution. `nativeWorkflowContract` declares the
stable job/step/report identities. `nativeConfigurationDigest({ inventory,
profile })` binds the selected toolchain, inventory digest and profile; the
observer must independently establish matching inputs rather than accept a
producer's configuration claim. A provisional failure context may have no
artifacts and remains explicitly NotRun, not public/native acceptance.

The cheap no-checkout intent job distinguishes actual source/base changes from
body-only metadata edits. A common `candidate` phase runs canonical/static
checks and freezes bytes once; all four `validation` lanes then run independently
in parallel. Complete source/native results remain mandatory for a true native
intent. A body-only metadata run cannot grant native credit through skipped jobs;
the observer still needs matching eligible original native evidence.

## Failure diagnosis and separate release cases

Keep command/selector, exit, toolchain, source/run/attempt and per-case outcomes.
Inspect original worker reports/journals for missing assertions, capability
failures and interruption; a green summary cannot replace the case denominator.
Sanitize credentials, signed URLs, private paths and logs before sharing.

Release prepublication (`r-pre`) and published-consumer cases are separately
authorized and use frozen artifact identities. Do not reproduce them by
publishing a version or changing provider settings. Required effective GitHub
rules, private reporting and public consumer observations remain owner/external
prerequisites until verified. [Release guide](../releases/README.md).

Consumer projects choose their own local checkpoints and CI; these instructions
apply to contributing to this repository only.

## Required retained cryptographic fixture

The T-PRD041 actual-signature regression requires an authentic retained signed
public npm fixture, not a unit double or metadata/count substitute:
`SDLC_NPM_SIGNED_FIXTURE_BUNDLE`, `SDLC_NPM_SIGNED_FIXTURE_SHA256`,
`SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY`, `SDLC_NPM_TOOL_ROOT` and
`SDLC_NPM_TUF_CACHE`. The tool is integrity-pinned npm 11.16.0; fixture and trust
inputs stay in owned repository-local `.test-data`, with isolated cache copies.
Required PR provisioning uses source-pinned public bundle/trust inputs and
offline verification through npm's bundled verifier, not a metadata-only double,
online trust refresh, new signing operation or publication credential. Its
fixture capability/setup remains distinct from actual cryptographic execution
and the independent calculator project's separate reports.
Complete applicable PR validation includes critical assertions as well as all
other required tests, authentic cryptographic fixtures, native capabilities and
the independently packaged calculator example's own tests. Their assertion
namespaces and reports remain distinct. The PR setup must provision its pinned
inputs or fail with an actionable diagnostic; a raw skip is not completeness.
Missing local special-capability inputs do not expand or block the finite sanity
selection. Safe fixtures do not grant publication or administration permission.
No registry request, dependency download or account/security change is
authorized merely by reading this guide.
