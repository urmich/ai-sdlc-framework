# Ownership and review

[urmich](https://github.com/urmich) owns/maintains this
personal third-party OSS project. See [MIT](LICENSE) and [package metadata](package.json).
No employer, Microsoft team, corporate support organization or additional
maintainer approval is implied.

## Review responsibilities

The maintainer reviews external contributions for scope, behavior, tests,
compatibility and trust boundaries. Owner-authored PRs do not require impossible
self-approval or an additional human reviewer; all mandatory checks still apply.
Built-in Copilot CLI `/review` is candidate Review, distinct from provider
approvals, branch enforcement, merge authority and release authority.

After a fix, repeat unit-first local validation and candidate Review before
publication. Never use auto-merge, stale approvals or administrative bypass
merely because CI is green. Source workflows and this policy do not prove
effective GitHub rules; verification/settings changes need separate owner
authority and provider capability.

The owner retains a deliberate administrator override for a particular PR,
without repeatedly changing global rules. Normal validations still apply to
owner and contributor PRs alike. Only a PR-only capability is intended, not
always-allow access; an agent needs explicit direction for the particular PR.
A bypass never changes failed/missing test results into passing release evidence
or grants publication authority.

## Ownership declarations and external controls

This document declares responsibility, not an automatically enforced CODEOWNERS
review rule. GitHub `CODEOWNERS`, rulesets and account controls require explicit
owner adoption/configuration; they are not silently installed by the framework.
Unavailable account features and unverified enforcement remain explicit gaps.
See [contributing](CONTRIBUTING.md), [security](SECURITY.md) and
[release responsibilities](RELEASING.md).
