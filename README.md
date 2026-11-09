# AI SDLC Framework

AI SDLC Framework brings a user-governed engineering workflow to GitHub Copilot
CLI, with integration support for **GitHub** and **Azure DevOps**.

It connects requirements, test planning, implementation, review and delivery
with recoverable project context and traceable execution evidence, including
workflows using **GitHub Actions** and **Azure Pipelines**. Developers retain
control over consequential decisions while using their own repositories,
test runners and CI/CD.

Installable instructions, skills and hooks work with an offline CLI.
Authorized host tools perform external operations; the framework is not a
separate coding model or a replacement for provider access controls.

This is [urmich](https://github.com/urmich)'s personal, community-maintained third-party OSS
project, licensed under [MIT](LICENSE). It is not a Microsoft product,
sponsorship, approval or corporate support commitment.

## Why use it?

- **Reduce avoidable rework.** Clarify what success looks like and how to verify
  it before committing effort to implementation.
- **Make delivery decisions with confidence grounded in evidence.** Base readiness
  on actual test outcomes and review of the candidate, not an agent's "done" claim.
- **Avoid rebuilding project context.** Pick up from authoritative documents,
  retained decisions and evidence rather than reconstructing the project from memory.
- **Keep the important decisions yours.** Authorize publication, merge and
  environment delivery separately, and choose when to follow, skip or reorder stages.

![AI SDLC Framework lifecycle](docs/images/ai-sdlc-framework-overview.svg)

## Capabilities

The table describes framework-provided guidance, records and adapters in this
source tree. Check [Releases](https://github.com/urmich/ai-sdlc-framework/releases)
and the [release log](CHANGELOG.md) for availability in a selected release.

| Capability | What it helps you do | Learn more |
| --- | --- | --- |
| Requirements, test planning and design | Clarify intent and acceptance conditions; maintain one living Test Plan and a Technical Design before implementation. | [Workflow](docs/usage/README.md) |
| Validation cycle tracking | Track candidate-changing fixes, unit-first project checks and individual outcomes against the current Test Plan. Host tools run the checks. | [Validation](docs/reference/cli.md#local-validation-and-environment-records) |
| Candidate review tracking | Record the candidate-bound result of Copilot's built-in `/review`; changed inputs invalidate prior review credit. Copilot provides the reviewer. | [Candidate review](docs/reference/cli.md#candidate-review-through-copilot-cli-review) |
| Work-item, evidence and orientation recovery | Locate canonical documents, retained decisions/results and pending operation handles; track orientation to the current framework context. This does not restore host sessions or chat. | [Resume and recovery](docs/usage/README.md#resume-from-authoritative-records) |
| Explicit user decisions | Record approvals, scoped overrides and receipt-backed decisions without treating tool success or document labels as consent. | [Decisions and receipts](docs/reference/cli.md#decisions-and-receipts) |
| Multi-repository and multi-document work | Bind each repository/branch and track separate requirements, plans and designs under one coordinator. Local-only work needs no remote. | [Identity and artifacts](docs/reference/cli.md#identity-artifacts-and-recovery) |
| Execution evidence and readiness | Normalize real results through trusted producer adapters, retain individual outcomes and evaluate source/specification/configuration-bound readiness. Missing, unverified or stale evidence is not a pass. | [Evidence integration](docs/usage/evidence.md) |
| Requirements-to-tests traceability | Connect acceptance conditions to declared tests, expose coverage gaps and generate a PR-description coverage section. A mapping is not proof of execution. | [Coverage guide](docs/usage/evidence.md#1-author-canonical-definitions-and-compile-coverage-in-memory) |
| GitHub adapters | Provide connection, transport and trusted-host/Store interfaces for repository, PR, run, check and artifact observations. The authorized host supplies credentials and access. | [GitHub integration](docs/integrations/github-adapters.md) |
| Azure DevOps adapter | Normalize build identity and summary links for provider-neutral monitoring, PR/check records and evidence consumers; this is not a full Azure DevOps client. | [Azure DevOps adapter](docs/integrations/provider-adapters.md#azure-devops-reference-adapter) |
| Pipeline monitoring records | Track run identity, polling due times, verified links, interruptions and terminal notices for GitHub Actions, Azure Pipelines and supported adapters. The host supplies scheduling and reads. | [Monitoring prerequisites](docs/getting-started/README.md#monitoring-is-a-host-capability) |
| PR and external-operation tracking | Bind authorized push, PR, pipeline and other supported provider outcomes to exact source, destination and request identities; retain uncertain effects for reconciliation. Host tools perform the operations. | [Operations](docs/reference/cli.md#exact-external-operations) and [PR records](docs/reference/cli.md#pr-records) |
| Environment and artifact handoffs | Track artifact/version and deployment-bound tests, separate DEV/STAGING decisions and execution owner/location contracts. Host tools build and deploy; PROD is never automatic. | [Environment records](docs/reference/cli.md#local-validation-and-environment-records) and [integration contracts](docs/integrations/provider-adapters.md) |
| Configuration and conflict resolution | Map project commands, tools and pipeline environments; record opposing rules and resolve them through explicit scoped decisions or verified corrections. | [Configuration and conflicts](docs/reference/cli.md#configuration-and-conflicts) |
| Audit and conformance checks | Inspect recorded authority, replay supported Git audit trailers and diagnose state/history/evidence gaps without turning unknown results into passes. | [Audit and conformance](docs/reference/cli.md#audit-and-conformance) |
| Offline core and local-only work | Use local Git projects without a remote; keep runtime records in the selected Copilot home and thin work-item locators in the repository, without a built-in cloud-provider client. | [Architecture](docs/architecture/README.md) |
| Installation, updates and diagnostics | Choose a Copilot home, run doctor, update or uninstall owned assets, and preserve runtime state and unrelated files during ordinary maintenance. | [Installation](docs/installation/README.md) |

Provider integrations have different adapter scopes, described in
[integration support](docs/integrations/README.md). Monitoring needs a running
host, a recurring scheduler and authorized provider-read tools. New monitors
default to five-minute polling; existing monitors retain their recorded
intervals. The offline CLI does not start a timer or contact providers.
Host-agent session/chat recovery belongs to Copilot, not this framework.
Framework orientation records do not prove that the model read or understood
the documents, and instructions/hooks do not guarantee model compliance.
The framework does not replace Copilot permissions, OS/sandbox controls,
provider access controls or repository rules. Installing it does not impose
this repository's CI policy on yours.

## Start here

- [Documentation](docs/README.md): installation, usage, architecture and reference.
- [Contributing](CONTRIBUTING.md): local checks, complete hosted validation and PRs.
- [Support](SUPPORT.md), [security reporting](SECURITY.md) and
  [conduct](CODE_OF_CONDUCT.md).
- [Ownership and review](OWNERSHIP.md), [releases](RELEASING.md) and
  [change history](CHANGELOG.md).

## Runtime and installation

Node.js **22 or later**, Git, npm and
GitHub Copilot CLI's documented instruction/skill/hook extension points are
required. The offline CLI has no runtime package dependencies or built-in
cloud-provider network client; authorized host tools own external operations.

The primary npm channel supports Windows, macOS and Linux with a supported Node
runtime. Consult [Releases](https://github.com/urmich/ai-sdlc-framework/releases)
and the [release log](CHANGELOG.md) before selecting a version. To install the
published npm `latest` into the Copilot home selected by `COPILOT_HOME` (or the
default home when unset):

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@latest sdlc install
```

`latest` selects a published npm release, not this source tree or a promise
that every capability above is included. See [channels and homes](docs/installation/README.md#choose-a-channel-and-home)
for release-specific commands, explicit home selection and isolated
source-candidate installation. Use only organization-approved registry/network
routes; installation does not grant a policy exception.

Next, run doctor through the **installed entry**, restart Copilot, and try a
local-only request in a disposable repository:
[safe first use and activation checks](docs/getting-started/README.md#safe-first-use).
An active process retains its loaded hooks and instructions. Doctor checks
installation integrity; it does not certify live Copilot or platform compatibility.
Ordinary updates preserve runtime state.
Destructive purge is not the default; see [installation](docs/installation/README.md).
Never use your live Copilot home for contributor validation.

Standalone packaging in this source tree targets Windows x64 and macOS.
The shared macOS payload uses portable JavaScript and a shell launcher with
external native Node; it is **not Universal 2** and includes **no bundled Node
runtime**. Node remains an external prerequisite for every channel, and there
is no Linux standalone distribution. Archive layouts and channel availability
are release-specific: use only assets listed in the selected release.
Source packaging is not proof of native or public-consumer acceptance.

## Workflow and trust

1. Requirements and observable requirement-specific definitions of done.
2. One living Test Plan before Technical Design.
3. User-authorized Coding with unit-first local corrections.
4. Built-in Copilot CLI `/review` of the validated candidate.
5. Separately authorized PR publication, DEV and STAGING; no automatic PROD.

Stages are advisory: users may explicitly skip or reorder them. Overrides never
create host/provider permission, test evidence or approval. STAGING uses an
explicit execution contract selecting owner and location, followed by the
user's completion confirmation. Effective enforcement belongs to real host and
provider controls, not a framework hook.

Candidate-bound observations, immutable evidence and approvals remain distinct.
The [generic evidence guide](docs/usage/evidence.md) describes reusable producer
normalization, readiness and PR-description coverage interfaces. Release notes,
not source presence, establish their availability in a published version.
Installing the framework never imposes this repository's CI policy on consumers.

## Contributor validation

Node >=22 is sufficient for source-only JavaScript checks; no dependency restore
is needed. The default local gate is a **small, explicit critical sanity set**,
unit tests first, followed by cheap static/document checks:

```sh
npm run test:critical
npm run check
```

Targeted or affected checks are an **optional debugging/iteration choice**, not
extra default-gate membership. For example:
`npm run test:targeted -- test/public-readiness-docs.test.mjs`.
`test:critical` already runs the exact three-file/16-case canonical unit stage
first, once. Use standalone `npm run test:unit` for a unit-only iteration, not
as an extra command immediately before that default sequence.
New tests are PR-only by default; a unit filename or pre-review label does not
make a test critical. In a source checkout, read `AGENTS.md` and
`.github/testing-policy.md` before changing classification. These repository-only
instructions are neither shipped nor installed as consumer framework policy.
`npm test` / `npm run test:full` and `npm run test:coverage` remain **opt-in locally**.
Every PR requires the complete applicable hosted native matrix: Linux shared
behavior, Windows x64, Apple Silicon macOS and Intel macOS. Release prepublication
and published-consumer cases are separate gates, not local contributor prerequisites.
See [testing and CI reproduction](docs/contributing/README.md).

## Released versus unreleased

Use [Releases](https://github.com/urmich/ai-sdlc-framework/releases) for published
versions/assets and the [release log](CHANGELOG.md) for change history.
This README describes the source tree; source presence is not publication,
native acceptance or proof of effective repository enforcement.
The [release guide](docs/releases/README.md#deferred-launch-limitations)
documents deferred limitations and publication gates. Local validation and
candidate review alone do not establish release readiness.

Reader guides live under `docs/`; canonical internal specifications live only
under `docs/sdlc/<feature>/`. Start with the [documentation map](docs/README.md)
and [release/change history](CHANGELOG.md).
