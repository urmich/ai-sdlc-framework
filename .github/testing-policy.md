# Repository test classification

This source-only guide governs **this repository**, not framework consumers.
It is not shipped in npm, exported, installed or copied into `assets/`.
Read [contributing](../CONTRIBUTING.md) and
[test commands](../docs/contributing/README.md).

## Placement and finite sanity budget

New tests enter **complete applicable PR coverage by default**. They do not
enter the local critical gate merely because they are unit, automated, local,
pre-review or associated with public-readiness work.

The default is `npm run test:critical`, then `npm run check`.
`scripts/test-profiles.mjs` exports the authoritative `canonicalUnitFiles`,
`criticalSelectors` and `criticalProfileBudget`; do not maintain another selector
list here. The bounded selection has:

- 16 canonical assertions in `provider-observations.unit.test.mjs`,
  `execution-artifact-identity.test.mjs` and `tool-adapters.test.mjs`.
- 11 exact existing risk roots covering atomic persistence/live locks, linked
  worktree authority, path safety, hook fall-through/stale-evidence invalidation,
  installation preservation/rollback, exact publication consent and runner
  failure/result accounting.
- Both `maximumRootChecks` and `maximumAssertions` are 27. Total assertions
  include every declared descendant: adding a 28th assertion fails the budget
  even if the root count stays 27. Nested assertions remain required; never
  discard them to meet either cap.

Promoting a test requires a specific essential-startup/CLI/persistence/
installation/authority/evidence risk that the current representatives miss.
State why the test is cheap, deterministic and credential/network-free, name
the owner and review its measured effect on the whole command. A budget change
requires an explicit, reviewed rationale and matching executable budget guard;
do not silently grow the set, delete necessary assertions or relabel exhaustive
feature/failure/stress/native coverage as sanity.

Targeted `npm run test:targeted -- --name "^T-PRD088 " test/public-readiness-docs.test.mjs` and
repeatable explicit `--affected FILE` / `--affected-name REGEX` on critical are
optional debugging choices, not the default gate. Use actual existing selectors.
Full/coverage execution is opt-in locally; every applicable PR assertion,
including critical, remains mandatory.

## Classifying a new or changed test

Include the following in the change/PR rationale, using the existing test's
literal `validationDeclarations` where supported rather than adding a policy
sidecar or a second test inventory:

| Decision | Required information |
| --- | --- |
| Behavior and ownership | Observable contract, requirement/planned case where applicable, owner, risk and why the assertion is needed. |
| Placement | PR-only default, optional targeted use, or justified critical promotion with its count/timing budget impact. |
| Exact identity | Real file, exact root/full test name, variant, selector/tool command, source/fixture identity and evidence/report location. |
| Capability | Applicable OS/architecture, Node/toolchain, native launcher, shell, real cryptographic fixture/trust inputs or other prerequisites; name the required PR lane that provides each. |
| Logical group | Independent root and its complete nested assertion closure, causal setup/action/assert/cleanup steps and why process isolation is sufficient. |
| Ordering and resources | `dependsOn` roots, `minimumSlots`, `exclusiveResources`, mutable environment/module patches, ports, owned homes/prefixes/caches and cleanup owner. |
| Verification | Inventory/discovery and exact-selection checks, disjoint complete assignment, missing/duplicate/unknown/cyclic rejection, capability handling, original result reconciliation and measured ordering/overlap/resource evidence. |

Declarations are strict JSON, not executable registration code. The existing
`surfaces`, `variants`, `applicability`, `plannedCases`, `projects` and resource
declarations retain their current contracts. Optional `groups` entries name an
exact `root` and use `dependsOn`, `minimumSlots` and `exclusiveResources`.
Dependency names refer to roots in the same file; an explicit targeted
selection must include those prerequisite roots too. Keep a cross-file causal
scenario together rather than inventing an unsupported dependency selector.
Use the parser's supported fields; do not invent flags or silently accept an
unknown declaration.

## Safe execution groups

An independent root group executes in its own process, even when another root
comes from the same file. Keep genuinely causal steps inside one root, in order.
Roots sharing process environment or module instrumentation are not safe merely
because callback concurrency is available; separate processes and explicitly
owned external resources must establish independence. Shared package-manager
prefixes, output paths or caches need exclusion/ordering, not hopeful parallelism.

The ready-work pool starts a group only after prerequisites and required slots/
exclusive resources are available. Completed groups release capacity for queued
runnable work. Nested producers share the aggregate budget rather than creating
independent worker allowances. Declare minimum slots before timed work begins;
unavailable capacity is not successful overlap.

`validationExecutionGroups` in `scripts/test-scheduling.mjs` derives exact
root closures. Original reports/journals retain assertions and group process/
timing outcomes. Verify independent overlap, dependency order, shared-resource
exclusion, capacity reuse and cancellation using actual observations; a worker
limit, valid declaration or YAML file alone proves none of these.

## Complete PR coverage and review

Every applicable framework assertion executes on its declared capable PR lane:
Linux shared behavior, native Windows x64 and both native Mac architectures,
plus specialized authentic-crypto/tool capability jobs. The independent
calculator project executes its own actual suite with separate totals.
Missing pinned inputs, jobs, results or required capabilities and unexpected
skips prevent completeness. Untrusted PR code receives no publication or
provider-administration privileges. Fixture success is not public-release
acceptance.

Before review, inspect the classification/inventory diff, run the bounded
relevant regression and the required local gate, then freeze the candidate for
final validation. Keep failures and previous runs immutable; current evidence
must match the actual source, selected assertions, configuration and platform.
Maintainer review applies to external contributions; owner-authored PRs need
real CI, not impossible self-approval. Consumers choose their own CI policy.
