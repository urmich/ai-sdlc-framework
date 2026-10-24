# Integrations

Provider tools acquire facts and execute separately authorized operations.
The offline framework checks identities and retains evidence; it is not a
network SDK or a replacement for provider access controls.

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
