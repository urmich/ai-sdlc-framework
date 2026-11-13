# AI SDLC Framework

**Give your AI coding workflow a plan, a memory, and a definition of done.**

Turn a development request into clear requirements, a test plan, working code,
and reviewable evidence—with you in control of delivery decisions.
AI SDLC Framework adds a structured engineering workflow to **GitHub Copilot CLI**,
with integration support for **GitHub** and **Azure DevOps**.

[Get started](#runtime-and-installation) · [Explore the docs](docs/README.md) ·
[View releases](https://github.com/urmich/ai-sdlc-framework/releases) ·
[Star on GitHub](https://github.com/urmich/ai-sdlc-framework)

## Why use it?

- **Spend less effort on rework.** Define acceptance conditions and plan how to
  test them before implementation starts.
- **Pick up work with context.** Recover requirements, decisions, and recorded
  results instead of reconstructing the project from a conversation.
- **Make “done” something you can inspect.** Connect requirements to tests and
  use actual execution results to assess readiness.
- **Keep delivery decisions yours.** Choose when to move forward, skip a stage,
  publish a PR, or authorize an environment handoff.

![AI SDLC Framework lifecycle](docs/images/ai-sdlc-framework-overview.svg)

## From request to reviewable work

AI can help write code quickly. Deciding what to build, checking that it works,
and keeping track of why it changed still take engineering discipline.
This framework gives that work a repeatable structure:

**Requirements → Test Plan → Technical Design → Coding → Validation → Review**

For example, ask Copilot to add CSV export to a reporting page. The workflow
helps you establish which fields to export and who can access them, plan tests
for quoting and empty results, agree on the design, implement it, and review
the validated candidate. The requirements, decisions, and execution evidence
provide a record to return to for the next change.

Start with a local task. Add provider integrations when your workflow needs them.
You choose your repositories, test runners, and CI/CD; stages can be explicitly
skipped or reordered. See the [workflow guide](docs/usage/README.md).

## Runtime and installation

You need **GitHub Copilot CLI** with instruction, skill, and hook support,
Node.js **22 or later**, Git, and npm. npm/source usage supports Windows,
macOS, and Linux.

Install the published npm `latest` into the Copilot home selected by
`COPILOT_HOME`, or the default home when unset:

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@latest sdlc install
```

Then:

1. Run `doctor` through the **installed** `sdlc/bin/sdlc.mjs` entry, using the
   same home. The [installation guide](docs/installation/README.md#choose-a-channel-and-home)
   has commands for your platform and explicit home selection.
2. Restart Copilot so it loads the installed instructions, skills, and hooks.
3. Open a disposable local Git repository with no remote and try:

```text
Add a tiny local-only example that prints hello. First gather the requirements
and explain the observable acceptance conditions. Do not push, open a PR,
install dependencies, change provider settings, or deploy anything.
```

Look for Requirements discovery before implementation. Follow the
[first-use walkthrough](docs/getting-started/README.md#safe-first-use) to check
activation on your Copilot version. Doctor checks installation integrity;
live Copilot compatibility needs that separate observation.

`latest` selects a published release. This README describes the source tree;
check [Releases](https://github.com/urmich/ai-sdlc-framework/releases) and the
[change history](CHANGELOG.md) for release-specific availability. For updates,
offline installation, and native channels, use the
[installation guide](docs/installation/README.md).

## Capabilities

| What you want | How the framework helps | Explore |
| --- | --- | --- |
| Clear scope before coding | Requirements, acceptance conditions, one living Test Plan, and Technical Design. | [Workflow](docs/usage/README.md) |
| Context for the next session | Recoverable work-item records, canonical documents, decisions, and pending operation handles. | [Recovery](docs/usage/README.md#resume-from-authoritative-records) |
| Evidence behind readiness | Requirements-to-tests traceability, retained execution outcomes, coverage gaps, and PR-description coverage. | [Evidence guide](docs/usage/evidence.md) |
| Review tied to the candidate | Track the result of Copilot's built-in `/review`; changed inputs invalidate prior review credit. | [Candidate review](docs/reference/cli.md#candidate-review-through-copilot-cli-review) |
| Your existing delivery tools | GitHub adapters, a scoped Azure DevOps adapter, and pipeline-monitoring records. | [Integrations](docs/integrations/README.md) |
| Deliberate delivery decisions | Scoped approvals, PR/external-operation records, and environment/artifact handoffs. | [CLI reference](docs/reference/cli.md) |
| Local work or multiple repositories | An offline core, local-only Git support, and coordinated repository/document bindings. | [Architecture](docs/architecture/README.md) |

## Workflow and trust

The framework installs instructions, skills, hooks, and an offline CLI with no
runtime package dependencies. Your authorized host tools run tests, access
providers, and perform external operations. Copilot supplies the coding agent
and built-in reviewer; the framework tracks workflow context and results.

GitHub and Azure DevOps adapters have [different scopes](docs/integrations/README.md).
Pipeline monitoring requires a running host, a recurring scheduler, and
authorized provider-read tools. The offline CLI does not start a timer or
contact providers. Recovery restores project records; host chat/session recovery
belongs to Copilot.

Instructions and hooks are advisory. Actual permissions and enforcement belong
to Copilot, the host, and your providers. Approvals and execution evidence stay
distinct; PR publication, merge, DEV, and STAGING need their own authorization.
PROD is never automatic. Your project's CI policy remains yours.
Read the [trust boundaries](docs/architecture/README.md) for details.

## Clone it, try it, help shape it

Explore the source and bundled example:

```sh
git clone https://github.com/urmich/ai-sdlc-framework.git
cd ai-sdlc-framework
```

The [calculator example on GitHub](https://github.com/urmich/ai-sdlc-framework/tree/main/test/calculator) shows
a small project's requirements, design, test plan, and framework assessment.
For source-candidate installation, follow the
[isolated-home instructions](docs/installation/README.md#choose-a-channel-and-home).

- **Star the repository** if this is a workflow you want to follow and help
  others discover.
- **Try one small task** and [share what worked or got in your way](https://github.com/urmich/ai-sdlc-framework/issues).
- **Contribute a focused improvement** to the docs, examples, or implementation.
  Start with [Contributing](CONTRIBUTING.md).

## Contributor validation

From a source checkout, the default local gate runs critical tests first,
then static and documentation checks. No dependency restore is needed:

```sh
npm run test:critical
npm run check
```

Use standalone `npm run test:unit` for a unit-only iteration. Targeted and
full/coverage runs are optional locally; every PR, including documentation-only
changes, requires the complete applicable hosted native matrix.
Read `AGENTS.md` and `.github/testing-policy.md` before changing source or tests.
Use an isolated Copilot home for contributor validation.
See [testing and CI reproduction](docs/contributing/README.md).

## Start here

[Documentation](docs/README.md) · [Support](SUPPORT.md) ·
[Security reporting](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
[Ownership and review](OWNERSHIP.md) · [Releasing](RELEASING.md)

An independently maintained, third-party open-source project under the
[MIT license](LICENSE). Support is best effort. See
[release limitations](docs/releases/README.md#deferred-launch-limitations)
for publication gates and deferred work.
