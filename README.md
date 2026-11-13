# AI SDLC Framework

**Give your AI coding workflow a plan, a memory, and a definition of done.**

Turn a development request into clear requirements, a test plan, working code,
and reviewable evidence - with you in control of delivery decisions.
AI SDLC Framework adds a structured engineering workflow to **GitHub Copilot CLI**,
with integration support for **GitHub** and **Azure DevOps**.

[Get started](#runtime-and-installation) · [Explore the docs](docs/README.md) ·
[View releases](https://github.com/urmich/ai-sdlc-framework/releases) ·
[Star on GitHub](https://github.com/urmich/ai-sdlc-framework)

## Why use it?

- **Shorten your time to market.** Move from idea to delivery with a connected
  workflow for planning, coding, validation, and review.
- **Pick up work with context.** Recover requirements, decisions, and recorded
  results instead of reconstructing the project from a conversation.
- **Make “done” something you can inspect.** Connect requirements to tests and
  use actual execution results to assess readiness.
- **Keep delivery decisions yours.** Choose when to move forward, skip a stage,
  publish a PR, or authorize an environment handoff.

![AI SDLC Framework lifecycle](docs/images/ai-sdlc-framework-overview.svg)

## What you gain

From the first request to the next handoff, give every change a clearer path forward.

| Your advantage | What it looks like in practice |
| --- | --- |
| **Build the right thing sooner.** | Turn a broad request into agreed behavior, edge cases, and a plan to test it before implementation starts. [Plan your work](docs/usage/README.md). |
| **Keep your project's memory.** | Return to saved requirements, decisions, and results when you resume work. Spend less effort piecing together the backstory. [Pick up where you left off](docs/usage/README.md#resume-from-authoritative-records). |
| **Put evidence behind “ready to ship.”** | See which requirements have tests, what actually ran, and what still needs attention - so your next step has a basis you can inspect. [Follow the evidence](docs/usage/evidence.md). |
| **Keep review in step with your code.** | Track Copilot's review against the code you validated. When that code changes, the workflow calls for a fresh review. [See the review workflow](docs/reference/cli.md#candidate-review-through-copilot-cli-review). |
| **Bring the tools you already use.** | Keep your test runners and CI/CD, with integration support for GitHub and Azure DevOps workflows. [Explore integrations](docs/integrations/README.md). |
| **Connect work across repositories.** | Keep related repositories, requirements, and plans together in one coordinated workflow - even when a change spans projects. [See how it fits together](docs/architecture/README.md). |
| **Move forward on your terms.** | Choose when to skip a stage, publish a PR, or authorize an environment handoff. You keep control of consequential decisions. [Explore the workflow](docs/usage/README.md). |

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

## Workflow and trust

You control delivery decisions. The framework provides instructions, skills,
hooks, and an offline CLI; Copilot and your authorized tools perform the work.
Recovery restores project records. Permissions remain with your host and
providers, and production deployment is never automatic. See the
[trust boundaries](docs/architecture/README.md) and
[integration prerequisites](docs/integrations/README.md) for details.

## Runtime and installation

You need **GitHub Copilot CLI** with instruction, skill, and hook support,
Node.js **22 or later**, Git, and npm. npm/source usage supports Windows,
macOS, and Linux.

Install the published npm `latest` into the Copilot home selected by
`COPILOT_HOME`, or the default home when unset:

```sh
npx --yes --registry=https://registry.npmjs.org --package=ai-sdlc-framework@latest sdlc install
```

Check the installation using its installed entry.

macOS / Linux:

```sh
node "${COPILOT_HOME:-$HOME/.copilot}/sdlc/bin/sdlc.mjs" doctor --home "${COPILOT_HOME:-$HOME/.copilot}"
```

Windows PowerShell:

```powershell
$CopilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME ".copilot" }
node (Join-Path $CopilotHome "sdlc\bin\sdlc.mjs") doctor --home $CopilotHome
```

Restart Copilot so it loads the installed instructions, skills, and hooks.
Open a disposable local Git repository with no remote and try:

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

## Explore the source

Explore the source and bundled example:

```sh
git clone https://github.com/urmich/ai-sdlc-framework.git
cd ai-sdlc-framework
```

The [calculator example on GitHub](https://github.com/urmich/ai-sdlc-framework/tree/main/test/calculator) shows
a small project's requirements, design, test plan, and framework assessment.
For source-candidate installation, follow the
[isolated-home instructions](docs/installation/README.md#choose-a-channel-and-home).

## Contributing

- **Star the repository** if this is a workflow you want to follow and help
  others discover.
- **Try one small task** and [share what worked or got in your way](https://github.com/urmich/ai-sdlc-framework/issues).
- **Contribute a focused improvement** to the docs, examples, or implementation.
  Start with [Contributing](CONTRIBUTING.md) and the
  [testing guide](docs/contributing/README.md) for local checks and PR requirements.

## Documentation and support

[Documentation](docs/README.md) · [Support](SUPPORT.md) ·
[Security reporting](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
[Ownership and review](OWNERSHIP.md) · [Releasing](RELEASING.md)

An independently maintained, third-party open-source project under the
[MIT license](LICENSE). Support is best effort. See
[release limitations](docs/releases/README.md#deferred-launch-limitations)
for publication gates and deferred work.
