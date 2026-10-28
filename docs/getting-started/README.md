# Getting started

The framework combines Copilot instructions/skills/hooks with an offline,
dependency-free Node CLI. [urmich](https://github.com/urmich) maintains this personal third-party
MIT project; [support boundaries](../../SUPPORT.md) are not a corporate SLA.

## Prerequisites and platforms

- Node.js >=22, npm and Git.
- GitHub Copilot CLI with documented instructions, skills and hooks support.
- Windows, macOS or Linux for npm/source usage.
- Native Windows x64 PE for the Windows standalone channel.
- macOS Apple Silicon and Intel execute the same portable JavaScript/shell
  launcher with their own native Node runtime, not a bundled binary or Node.
  Published 0.4.0 remains
  unchanged. Linux has no standalone archive.

Use [installation](../installation/README.md) to select a release/home and run
doctor, then restart Copilot. Do not infer host capability from a platform label.

## Safe first use

1. Select a release and deliberate Copilot home using
   [installation](../installation/README.md). Use an organization-approved
   registry/network route; choosing this project does not grant an exception.
2. Run doctor from the **installed** `sdlc/bin/sdlc.mjs` entry with that same home,
   not another package fetched by `npx`. Resolve installation findings first.
3. Close and restart Copilot so it loads the installed instructions, skills and
   hooks. Record your Copilot CLI version if reporting compatibility.
4. Create a disposable local Git repository and feature branch, with no remote
   or private content. Start Copilot there and submit:

```text
Add a tiny local-only example that prints hello. First gather the requirements
and explain the observable acceptance conditions. Do not push, open a PR,
install dependencies, change provider settings, or deploy anything.
```

Observe that Copilot reads the relevant source/contribution guidance, asks or
states the small requirement-specific acceptance conditions and begins useful
Requirements discovery. It should not jump straight to code, tests or
publication. Stop there for this activation check; it does not require a
completed lifecycle or remote action.

This is a **procedure to observe**, not an assertion that this source candidate
has passed it on your Copilot version/platform. Doctor may report live Copilot,
hook or built-in review capability as unverified; a clean integrity result is
not that live observation. Actual live compatibility remains unverified until
the behavior above is observed and the version/platform is recorded.

### If activation is missing

Check the selected home, installed entry/version and doctor findings; confirm a
new Copilot process loaded the expected instruction/skill/hook locations.
Ensure the prompt is a development request rather than an information-only
question and inspect applicable repository instructions for conflicts. Do not
reset runtime state, purge evidence, weaken OS policy or repeatedly reinstall
to manufacture activation. Report the minimal sanitized prompt, versions,
expected/observed behavior and findings through [support](../../SUPPORT.md).
Do not send private conversations, work-item logs or approval receipts.

## Continue your own workflow

Use your own Git feature branch/worktree after the disposable check.
The normal sequence is Requirements -> Test Plan -> Technical Design ->
Coding -> unit-first local validation -> built-in `/review`.
Approve consequential transitions explicitly. You may skip/reorder a stage;
that does not invent passing tests or external permissions.

The framework records thin portable locators in your coordinator repository;
machine-local runtime and immutable records stay in the selected Copilot home.
See [usage and recovery](../usage/README.md), [architecture](../architecture/README.md)
and the [CLI reference](../reference/cli.md).

This repository's [local/PR/release gates](../contributing/README.md) are its own
policy, not mandatory configuration installed into your project.

## Monitoring is a host capability

Pipeline monitoring needs an actual host recurring scheduler, authorized
provider-read tools and a running host. When those are available, the agent
attaches polling every **60 seconds**, verifies the actual run page and reports
terminal results. The standalone offline CLI has no background timer or provider
client. Missing capabilities and host interruptions must be reported; observing
a run never authorizes a deployment or stage transition.
