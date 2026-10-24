# Generic evidence and PR-description coverage

**Candidate-source integration guide.** These interfaces describe the current
unvalidated source, not new functionality claimed in immutable published 0.4.0.
Candidate integration tests use an isolated installation, never the live home.

This is a reusable framework capability, not a GitHub-only test ledger.
Use the public `ai-sdlc-framework/evidence` facade; retain the consumer's own
runner, canonical Requirements/Test Plan, provider and CI/CD choices.
No additional coverage/index/binding/policy source file is required or generated.
This repository's mandatory `framework/coverage` policy is not imposed on consumers.
Its current adopting policy selects only the registered public-readiness set
(`repositoryId: primary`, `artifactId: public-readiness`), not every historical
SDLC archive in this repository. Other projects explicitly choose their own
complete adopted artifact set and CI policy; compilation does not invent one.

## 1. Author canonical definitions and compile coverage in memory

Use stable `FR-...` headings, explicit `AC-....n` DoD bullets and named Test Plan
Requirements/Conditions cells. Test IDs map to executable selectors/procedures,
profiles, prerequisites, owner and actual location. Prose/examples do not define
coverage. Keep current results NotRun until actual evidence is admitted.

```js
import { prepareCoverage, renderCoverageSection, inspectCoverage,
  replaceCoverageSection } from 'ai-sdlc-framework/evidence';

// The caller reads its existing canonical files; it does not write a sidecar.
const definitions = {
  repositoryId: 'consumer',
  sourceRevision, // independently selected exact Git revision
  requirements: [{ artifactId: 'orders',
    path: 'docs/sdlc/orders/requirements.md', contents: requirementText }],
  testPlans: [{ artifactId: 'orders',
    path: 'docs/sdlc/orders/test-plan.md', contents: planText }],
};
const metadata = prepareCoverage(definitions);
const section = renderCoverageSection(metadata);
const inspection = inspectCoverage({ ...definitions, body: section });
const nextBody = replaceCoverageSection(currentPrBody, metadata);
```

Variables in this integration sketch are caller-supplied actual inputs, not
trusted placeholders or a self-contained passing example.
The output is one visible Requirements Coverage section containing exactly one
`sdlc-coverage:v1` JSON block. It declares mappings/gaps, not semantic adequacy,
execution results, lifecycle approval or provider enforcement.

The headless CLI equivalents are `sdlc coverage prepare` and `sdlc coverage
inspect`, with JSON on standard input (or the CLI's supported structured-input
option). Explicit input includes `repositoryId`, `requirements`, `testPlans`
references and optional `body`; `inspect` needs the actual body. Alternatively
select registered work-item documents, not both modes. The command reads the
selected Git HEAD and diagnoses working definitions that differ from it.
Preparation may return useful incomplete output; inspect exits nonzero when
incomplete. Missing/malformed/duplicate sections, unknown versions, orphan IDs,
uncovered conditions and stale source references remain diagnostics.

Templates/schema and native phase guidance are shipped in
`sdlc/templates/pr-coverage.md` and `pr-coverage.schema.json`.
Before separately authorized PR creation/update, read the actual current
description, preserve text outside the owned section and pass the prepared body
in memory/standard input. Reconcile concurrent edits or uncertain writes.
These helpers never perform provider writes or install CI.

## 2. Declare the complete required profile

The specification is data with `schemaVersion: 1`, `profile` and `cases`.
Each case declares `id`, `conditions`, `expectedDigest`, `executionId`, `mode`,
`owner`, `location`, `checkpoint` and `assertions`; each assertion has its stable
`id` and exact `selector`. `validationInventoryDigest(specification)` binds the
complete inventory. Compile from canonical definitions plus real test
declarations; a producer cannot shrink the expected set to what happened to run.

The trusted execution context independently binds candidate/test-spec/config/
inventory digests, complete source revision/content identities, profile,
environment, mode, owner, actual location, native kind/platform/architecture/
image/toolchain, exact producer execution/attempt, job reference and artifacts.
Release consumers additionally bind the approved logical intent and frozen
asset identities. A branch name or a caller's `Passed` field is insufficient.

## 3. Normalize actual producer output

Run the consumer's real Node/Python/Go/other tool with a retained original byte
report and exact command/selector/exit. Preserve failure, skip, cancellation,
partial execution and diagnostics; parent-suite success cannot replace absent
leaf assertions.

```js
import { normalizeExecutionReport, evaluateReadiness,
  createEvidenceBundle, readEvidenceBundle,
  renderReadinessReport } from 'ai-sdlc-framework/evidence';

const normalized = normalizeExecutionReport(originalBytes, executionContext, {
  id: 'consumer-runner-v1',
  normalize: decodeActualProducerOutput,
  verify: independentlyVerifyProducer,
});
const evaluation = evaluateReadiness(specification, [normalized], selection);
const readable = renderReadinessReport(evaluation);
const bundle = createEvidenceBundle(evaluation);
// The consumer's chosen retention/transport stores these immutable bytes.
const replay = readEvidenceBundle(JSON.parse(JSON.stringify(bundle)), {
  specification, context: independentlySelectedContext,
}, { 'consumer-runner-v1': trustedAdapter });
```

The adapter's `normalize` returns the generic v1 `test-execution` report:
context, started/finished/observed times, source sequence, completeness, exit and
per-assertion results. Each row binds test/assertion IDs, selector, expected
definition digest, checkpoint, source time/sequence, status and expected outcome.
Its `verify` is real trusted in-process code returning independently acquired
facts for the exact original report digest/context/source time and sequence;
it must not echo producer JSON flags as verification.

`selection` chooses the profile and expected execution IDs/contexts, current
time, explicit freshness/revision policy, trusted verifier IDs and invalidation
barriers. Full source/artifact/host identities must match. Required unavailable,
missing, unverified, skipped, failed or stale assertions cannot produce readiness.
Readable/machine reports are projections of the same evaluation, not another
authoritative status file. Retain complete per-test reports when summaries are
bounded; do not hide unexecuted required cases.

## 4. Retain, replay and distinguish managed credit

The caller owns sanitized immutable retention/transport and safe retrieval.
Use `retainTestEvidence` / `readTestEvidence` for existing framework retention
where appropriate, and `createEvidenceBundle` / `readEvidenceBundle` for
transport. Retain original-byte digests, report objects and source identities;
a clean consumer must independently reacquire verification. Serialized bundles
do not carry trusted functions. Replaying JSON alone stays unverified.

`sdlc readiness evaluate` / `readiness report` accept JSON with `specification`,
expected `context`, and either `reports` or one `bundle`. Report entries may be
`{ "file": "<repository-relative-report>" }`. The offline CLI has no
provider acquisition/verifier and therefore does **not** authenticate arbitrary
producer files merely because their status says Passed. Use a trusted host
adapter for authenticated readiness; input/verification gaps remain explicit.

Detached CI requires no invented Copilot receipt, work-item approval, ACK or
validation cycle. A detached evaluation is not managed lifecycle credit.
Managed `recordTests` / `recordReadiness` additionally require legitimate
registered artifacts/current cycle and the host's supported verifiers.
Managed reload verifies the complete retained dependency graph: admission,
import, object-map/assertion pages and original payload objects. A missing or
corrupt dependency removes current credit without deleting or recreating the
original history. Serialized status or origin flags do not repair lost proof.
Readiness never authorizes push, merge, provider changes, release or deployment.

## 5. Adopt only the policy you choose

Consumers decide local/hosted/release memberships, freshness, retention and
provider enforcement using existing configuration. A valid metadata section
cannot prove GitHub branch rules; a valid local fixture cannot prove native or
public-client acceptance. Observe actual provider policy/run/attempt pages
through authorized tools. Missing capabilities remain prerequisites, not
automatic permission to change accounts or weaken security.

The installed offline-core regression uses real Python output while denying
selected host networking/process APIs in a controlled process. This is an
in-process no-network-call boundary, **not OS network isolation** or a native
Windows/macOS sandbox pass. Required native isolation has its own actual-host
procedures and explicit unavailable-capability dispositions.

The independent consumer fixtures in `test/public-readiness-consumer.test.mjs`
exercise actual non-Node output and fresh replay without consumer CI changes;
they are test implementation, not evidence the latest repository candidate passed.

## 6. Authorized PR description handoff

The candidate source extends the existing `ai-sdlc-framework/pr` export.
`preparePrDescription(store, input)` and offline `sdlc pr description-prepare`
are pure preparation: select registered committed canonical documents and
exact source, supply `class: pr-create` or `pr-update` and current body prose;
updates also supply the actual provider `descriptionVersion`. Preparation
returns generated `body`, a small `binding`, coverage diagnostics/uncovered
identities and an explicit non-authority statement. It performs no host call,
provider write, sidecar creation or CI-policy adoption.

The binding contains `descriptionDigest`, `coverageDigest` and, for updates,
`previousDescriptionDigest` / `descriptionVersion`. Full body data stays
transient; managed intents/operations keep only the bounded hashes/version,
not a 64-KiB description in a 4-KiB record.
Existing `preparePr` accepts optional `class`, update-only `prId` and
`description: { body, descriptionVersion }`, returning the generated handoff.
Omitting these new fields preserves the existing API/identity behavior.

Before publication, capture the separate exact `pr-publication` permission
for its `publicationAction`, source revision, optional PR ID and binding;
`scope.actions` must contain exactly that create or update action.
Prepare the corresponding existing operation with the same fields.
`publishPrDescription(store, { workItemId, intentId, operationId, body }, host)`
rechecks actual authority and canonical definitions before dispatch.
The trusted host supplies its invocation/adapter contract/host call identity
and these narrow callbacks:

- `read({ intent })` returns complete acquired `matches` with exact PR identity,
  body and description version. Creation requires no matching existing PR.
  Update requires the selected PR's actual current version and old-body digest.
- `write({ operation, body, prId, expectedVersion, expectedBodyDigest })` must
  enforce a **real atomic compare-and-set** for updates and return the acquired
  operation result for the installed Store's existing verifier. Merely reading
  before writing or returning a JSON `verified` flag is not conditional support.

Only the owned coverage section may change on update; preserve unrelated text.
Source/body/version drift or an adapter lacking conditional support is a
non-passing/unavailable boundary, not permission to overwrite concurrent edits.
A callback failure after claim leaves an uncertain operation. Never retry a
write because its reply was lost or re-prepare a different body to evade that
uncertainty. `reconcilePrDescription` consumes actual provider-acquired result
proof through the existing Store verifier/`recordOperation`; it writes no PR.
Only after reconciliation can a separately authorized refreshed operation run.
These source-authored interfaces remain unverified and grant no provider,
settings, merge, release or deployment authority.
