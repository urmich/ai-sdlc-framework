# Requirements coverage in a PR description

Keep Requirements, the living Test Plan and tests as the source definitions.
Do not create a coverage/index/binding/policy file in the consuming repository,
or a temporary body file for PR publication.

## Author the source definitions

Use the shipped Requirements and Test Plan templates. FR headings and explicit
AC bullets inside that FR's Definition of Done define the obligations. Test
Plan Requirements/Conditions cells define their links. Mentions in prose and
fenced examples are not definitions or coverage. IDs are unique across the
selected documents; use distinct artifact IDs for multiple documents.

Every required case has explicit FR/AC links, checkpoint, owner/location,
expected result and selector/procedure. Use `planned:` for an unimplemented
binding. The helper reports those separately; a mapped planned case is not
passing execution evidence.

## Prepare without creating a file

Invoke the installed framework CLI using the Node/entry paths in the active
instructions. With registered canonical documents:

```text
coverage prepare --cwd <selected-repository> --work-item <work-item> --repository <member>
```

The JSON result contains `section`, `metadata`, `uncovered`, `unresolved`,
diagnostics and `sourceMatches`. Preparation does not publish anything.
Requirements-only work should first finish the Test Plan, not invent coverage.
Changes not yet present in HEAD are explicitly reported; regenerate after the
authorized commit/push for the exact PR source.

For headless use, pass explicit references on standard input instead of a work
item/session. The following is command input, not a file to add to a project:

```json
{
  "repositoryId": "primary",
  "requirements": [
    {"artifactId": "orders", "path": "docs/orders/requirements.md"}
  ],
  "testPlans": [
    {"artifactId": "orders", "path": "docs/orders/test-plan.md"}
  ]
}
```

Pipe this object to `coverage prepare --cwd <selected-repository>`. The same
references plus the actual PR description in a `body` string are inputs to
`coverage inspect`. Inspection is offline: it compares the supplied description
with the selected local source, not a secretly fetched remote PR.

## Publish only with authority

During authorized PR creation include the returned section in the description.
For an authorized update, pass the current description as `body` to preparation;
the returned `body` preserves unrelated text and replaces only the owned block.
Refetch before editing and reconcile uncertain/concurrent provider effects.
Use body data or standard input, not a generated coverage/body file.

The section has exactly one `<!-- sdlc-coverage:v1 -->` opening marker, one JSON
fence and one `<!-- /sdlc-coverage -->` closing marker. Use the generated content,
not hand-entered source digests or a copied example. The versioned contract is
in `pr-coverage.schema.json`. The section is limited to 32 KiB and the complete
description to 64 KiB; overflow fails explicitly without dropping mappings.

## Interpret results honestly

`complete` means declared traceability matches the selected source and all
required ACs have mapped cases. It does not mean tests ran, assertions adequately
test the prose, the PR is approved, or publication is authorized. Read the exact
`uncovered` AC identities, planned `unresolved` test identities and diagnostics.
Actual pass/fail/NotRun outcomes come from the test runner and its retained
reports; review establishes semantic test adequacy.

Preparation reports partial declarations without adding a merge policy.
Inspection exits nonzero for incomplete, invalid or stale coverage. Projects
choose whether and how to integrate that result into their CI.

The mandatory `framework/coverage` guardrail belongs only to development of
`urmich/ai-sdlc-framework`. Installing or using this framework does not install
workflows, required checks, branch rules or coverage sidecars in consumers.
