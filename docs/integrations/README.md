# Integrations

Integration support connects the framework's development and delivery workflow
with **GitHub** and **Azure DevOps**, including **GitHub Actions** and
**Azure Pipelines**. The implemented provider scopes differ:

| Integration | Implemented scope | Guide |
| --- | --- | --- |
| GitHub | Dedicated connection/transport, repository and execution adapters, trusted-host/Store wiring, and verification of PR/check/artifact results. | [GitHub trusted-host integration](github-adapters.md) |
| Azure DevOps | Built-in build identity and summary-link adapter, with provider-neutral monitoring, PR/check records and evidence consumers. | [Azure DevOps reference adapter](provider-adapters.md#azure-devops-reference-adapter) |

Provider tools acquire facts and execute separately authorized operations.
The offline framework checks identities and retains evidence; it is not a
network SDK or a replacement for provider access controls.

## Pipeline integration

The operation, monitoring and evidence contracts support **GitHub Actions**
and **Azure Pipelines**:

- Prepare and record separately authorized pipeline operations; reconcile
  uncertain dispatches through provider reads rather than blind retries.
- Bind results to the actual workflow/build definition, execution, source and
  configuration. GitHub run attempts remain distinct; Azure build observations
  use the built-in adapter's declared attempt capability.
- Associate PR checks with the observed execution and retain matching
  execution/artifact evidence rather than trusting a green job label.
- Observe existing or newly reported runs immediately, then poll at their
  recorded intervals (300 seconds for new monitors), when a running host
  supplies an actual scheduler and authorized provider-read tools.

This is implemented integration behavior, not an automatic network client:
the caller's authorized host tools queue/read pipelines and acquire results.
Installing the framework does not create workflows, configure pipeline
credentials or grant dispatch/deployment authority. Check
[Releases](https://github.com/urmich/ai-sdlc-framework/releases) for interface
availability in your selected version. Implemented support does not establish
current live-provider acceptance.

## Guides

- [GitHub trusted-host integration](github-adapters.md): retained facade,
  trusted Store wiring, exact run/attempt and artifact identities.
- [Provider adapter extension guide](provider-adapters.md): generic contract
  and the Azure DevOps baseline.
- [Azure DevOps acceptance procedure](azure-devops.md): a historical
  release-pinned procedure, not current public-readiness proof.
- [Generic headless evidence](../usage/evidence.md): reusable producer,
  retention/readiness and PR-description coverage integration.

This repository's `framework/coverage` check is an explicitly adopted repository
policy; installing the framework in another project does not install a workflow,
policy/index sidecar, branch rule or publication authority.
