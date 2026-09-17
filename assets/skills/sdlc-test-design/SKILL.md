---
name: sdlc-test-design
description: Design traceable tests before solution design and maintain one living Test Design/Test Plan with truthful execution status.
---

Read `{{LIFECYCLE_INTENT_INSTRUCTIONS}}` before interpreting a request for
design or implementation. Follow its normal-activation and unmistakable-override
rules without manufacturing Test Design completion.

Resume and acknowledge orientation. Read the agreed requirements and their DoDs.
Read `{{KNOWLEDGE_INSTRUCTIONS}}` and `{{TESTING_INSTRUCTIONS}}` before
designing the test strategy.
Use one logical Test Plan, which may span multiple registered member documents
with stable `artifactId` values. Honor the user's authorized locations rather
than creating accidental duplicates. Map globally unique T IDs to FR IDs and
independently testable AC outcomes; a broad scenario does not cover assertions
it never makes.

Specify prerequisites, steps, expected outcomes, cleanup and evidence. Distinguish
automated runner tests, agent-driven semi-automated flows and user-executed manual
procedures. Manual mode requires explaining why neither automation route works.
Keep execution owner and authorized host separate from mode. STAGING owner and
location come from the environment contract; automated tests remain automated
regardless of whether the owner is the user, agent, provider, or external system.

Give every test an explicit checkpoint: `pre-review`, `review`, `post-review`,
`DEV`, or `STAGING`. Identify the full pre-Review local unit-first sequence after
every fix, other required local/integration/emulator checks, and separately
authorized DEV and STAGING checkpoints. Review and later workflow observations do
not become prerequisites for invoking `/review`.
Every test visibly has exactly NotRun, Passed or Failed. Keep implementation
references, activity, blockers, result provenance and readiness separate.
Add necessary new scenarios whenever discovered, without writing their code yet.

Plan/register each exact Test Plan locator before creating a new file, finalize
registration after content exists, check the aggregate plan, review coverage and request completion/advancement
approval naturally: explain once that Technical Design will agree on the
solution architecture against this quality gate before coding. Managed lifecycle state
does not enter Technical Design before that authorization. Apply the shared
lifecycle-intent guide to any request for later-phase work. Continue refining
this same document in later phases.
