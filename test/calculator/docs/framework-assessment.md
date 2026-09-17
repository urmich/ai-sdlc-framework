# AI SDLC Framework Dry-Run Assessment

Scope: browser calculator under `test/calculator/`

## Outcome

The deterministic local framework controls behaved as designed during this
exercise. Automatic activation by newly installed instructions and hooks was
not testable in the already-running Copilot session and remains explicitly
unverified until a restarted session uses the framework naturally.

## Observed behavior

| Area | Evidence | Assessment |
| --- | --- | --- |
| Release installation | v1.0.0 checksum passed; installation completed; installed `doctor` returned no findings | Passed |
| Development-request provenance | `sdlc init` rejected the work before a request receipt existed | Passed |
| Hook adapter | Replaying the actual user prompt through `hook userPromptSubmitted` allowed initialization | Passed as an adapter contract; automatic hook invocation is unverified in this pre-install session |
| Repository identity | The work item bound the actual feature branch and resolved `origin/main` | Passed |
| Planned artifact locators | Requirements, Test Plan, and Technical Design paths were registered as `pending` before file creation and finalized afterward | Passed |
| Phase authority | Requirements, Test Design, and Technical Design each required snapshot-bound user approval before advancement | Passed |
| Invalid transition input | `test-plan` was rejected as a phase identifier; the valid phase is `test-design` while `test-plan` is the artifact role | Passed, with terminology friction noted |
| Test Plan conformance | A malformed table missing owner/location cells was rejected; the corrected table passed coverage/status/mode checks | Passed |
| Location change | The original separate-repository decision was not reused after the user required `test/calculator/`; a new work item and snapshot-bound approval were created | Passed |
| Audit identity | Audit recording rejected an invented full commit SHA and accepted the exact Git-resolved SHA | Passed |
| Unit-first restart | Every implementation or test fix created a new validation cycle, reset current evidence, reran unit tests first, then reran the full local suite | Passed |
| Remote boundary | Every cycle reported that no DEV action was authorized; no build, deployment, PR, or push was triggered | Passed |
| Candidate Review | Review findings repeatedly returned work to Coding and exposed arithmetic, accessibility, browser-wiring, and false-confidence test defects | Passed as an effective defect-discovery loop |
| User browser acceptance | The user rejected nominally clean Reviews with concrete precision, percent, visibility, repeated-equals, focused-key, status, and favicon defects, including two issues found on the first retest | Passed as a governance boundary; Review and automated tests were not sufficient |
| Evidence projection | Individual T-01 through T-07 results were recorded against exact cycle, candidate, specification, owner, and host identities | Passed |
| Current Review and T-08 status | Read from the framework state and living Test Plan after this document is frozen; updating only execution statuses must not change candidate identity | Deferred to final recorded evidence |

## Friction and improvement opportunities

1. A simple static application required many small JSON command payloads and
   repeated per-test evidence calls. The controls are precise but operationally
   heavy without active hooks or a higher-level orchestration command.
2. The phase name `test-design` and artifact role `test-plan` are internally
   consistent but easy to confuse. CLI error handling was clear once the invalid
   transition was attempted.
3. The mandatory cycle reset after every fix was reliable and prevented stale
   Review/test reuse, but repeated manual evidence entry dominated this small
   exercise. Batch evidence recording could preserve the same bindings with less
   ceremony.
4. The Review loop found meaningful defects that the initial tests missed,
   validating the separation between deterministic checks and semantic Review.
5. A user browser pass found additional defects after Review reported no
   significant issue. The framework correctly preserved the user's authority to
   reject the candidate, but the original Test Plan should have included browser
   acceptance earlier.
6. A restarted Copilot CLI session is still required to validate automatic
   request classification, session-start orientation, and pre/post-tool hook
   invocation without manual adapter replay.

## Conclusion

The framework's deterministic state, approval, artifact, validation, Review, and
remote-authority boundaries behaved correctly in this dry run. The primary gap
is not correctness but end-user ergonomics when hooks are unavailable in the
current session. Automatic installed-session behavior remains `NotRun`, not
implicitly passed.
