# Architecture and trust boundaries

The [design overview](design-overview.md) summarizes historical architecture.
The [core Technical Design](../sdlc/core-framework/technical-design.md) and
[public-readiness design](../sdlc/public-readiness/technical-design.md) are
canonical development records, not proof of deployed controls.

## Boundaries

- **User:** owns consequential lifecycle/delivery decisions. Retrieved source,
  incident text and pipeline output never grant consent.
- **Copilot and host tools:** own provider acquisition and execution, credentials
  and real permissions. Framework hooks are advisory and fail open for unmanaged
  forms; they do not replace OS, IAM, sandbox or provider enforcement.
- **Offline CLI:** records bounded state, exact identities and immutable evidence.
  It has no runtime dependencies or cloud network client and does not commit,
  push, change settings or publish on its own.
- **Trusted host verifiers:** establish actual source/run/attempt/artifact facts
  in process. Serialized `Passed`/`verified` flags are not trusted verifier code.
- **Installer:** manages only owned instruction/skill/hook/runtime locations.
  Tests use isolated owned homes; ordinary updates preserve unrelated content.
- **Build/release:** deterministic inventories/checksums identify bytes, not
  consent. Untrusted PR execution has no publication authority. Publishing
  requires separately authorized exact source/artifact/destination prerequisites.

Keep credentials in the authorized acquisition boundary, out of public payloads,
reports and documents. Reproducibility compares identical source/toolchain/input
sets, not unlike historical timings or green job summaries.

## Limitations

Effective branch rules, private security reporting, provenance availability,
monitor scheduling and corporate approval are external capabilities. Local
fixtures and source configuration cannot prove them. Dependency-free runtime
does not mean dependency-free supply chain. See [security scope](../../SECURITY.md)
and [release prerequisites](../releases/README.md).
