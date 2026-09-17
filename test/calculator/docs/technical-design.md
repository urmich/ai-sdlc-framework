# Technical Design - Browser Calculator Framework Test

Status: Draft for user review

## 1. Solution and requirement mapping

All project files remain below `test/calculator/`.

| Component | Responsibility | Requirements | Tests |
| --- | --- | --- | --- |
| `index.html` | Semantic single-page structure, display, keypad, theme bootstrap, local asset loading | FR-001, FR-003, FR-005 | T-05, T-06, T-07 |
| `styles.css` | Clawpilot variables, responsive calculator layout, focus and control states | FR-001, FR-005 | T-05, T-06 |
| `calculator.js` | Pure calculation state machine plus thin browser event wiring | FR-002, FR-003, FR-004, FR-006 | T-01 to T-05, T-07 |
| `test/*.test.js` | Dependency-free engine and static-contract verification | FR-001 to FR-006 | T-01 to T-07 |
| `docs/framework-assessment.md` | Evidence-based observations from this framework exercise | FR-007 | T-08 |

## 2. Application boundary

The application is a static page with no build step and no runtime network
request. `index.html` loads only `styles.css` and `calculator.js` through relative
paths. It may be opened directly from disk or served by any ordinary static file
server.

The mandatory theme-detection script is the first script in the document. It
sets `data-theme` from `scoutTheme` or the browser color-scheme preference before
the calculator script runs.

## 3. Calculator engine

`calculator.js` exposes `CalculatorEngine` through a small universal wrapper:
`module.exports` for Node tests and `globalThis.CalculatorEngine` for the browser.
It does not use dynamic evaluation.

State:

```text
display              string shown to the user
storedValue          number or null
pendingOperator      add | subtract | multiply | divide | null
lastOperator         operator retained for repeated equals
lastOperand          right operand retained for repeated equals
divisionCarry        one-use pre-division dividend and divisor for exact inverse multiplication
waitingForOperand    whether the next digit starts a new operand
error                whether Error is currently displayed
```

Public operations:

| Method | Behavior |
| --- | --- |
| `inputDigit(digit)` | Append or replace the active operand; numeric input clears an error |
| `inputDecimal()` | Add one decimal point, starting `0.` when necessary |
| `chooseOperator(operator)` | Store/evaluate the current operand and await the next |
| `equals()` | Evaluate the pending binary operation |
| `clear()` | Restore the initial state |
| `backspace()` | Remove one active digit and preserve a valid display |
| `toggleSign()` | Negate the active nonzero operand |
| `percent()` | Apply a standalone/multiply/divide percentage, or a percentage of the stored operand for add/subtract |

Each binary operation is selected by an explicit switch. Division by zero enters
the error state. Results are normalized through a bounded significant-digit
conversion before display so ordinary values such as `0.1 + 0.2` show `0.3`.
The normalized displayed number, not the raw binary intermediate, becomes the
left operand for a chained operation. Scientific notation is expanded to a
valid decimal token before digit, decimal, or backspace editing. Non-finite
results enter the error state. Exact safe-integer results are preserved without
significant-digit rounding; bounded precision normalization applies only to
non-integer decimal results. Operand entry is capped at 15 significant digits so
every accepted integer operand remains exactly representable. Integer
addition/subtraction/multiplication that would leave the safe-integer range
enters `Error` instead of silently changing the result. Leading placeholder
zeros before the first nonzero digit do not consume the significant-digit
budget; a separate bounded display length prevents unbounded zero entry.
Repeated equals re-applies the retained operator and right operand. Decimal
formatting keeps 15 significant digits without snapping legitimate fractions.
For an immediate division-to-multiplication chain, the exact pre-division
dividend and divisor are retained. When the completed multiplication uses that
same divisor, the original dividend is restored directly so `a / b * b` can
recover `a` without multiplying a rounded quotient. A different multiplier or
replacement of the pending multiplication clears/ignores that one-use carry;
every other chained operation uses the normalized display value to avoid binary
floating-point noise.

## 4. Browser controller

Buttons carry `data-action` or `data-value` attributes. One delegated click
handler maps controls through the same deterministic dispatcher used by a
keydown handler. Browser initialization accepts a document boundary so tests
can exercise every required key and visible-control sequence through the actual
registered event handlers without a DOM dependency.
The keydown mapping covers:

- `0` to `9` and `.` to operand entry.
- `+`, `-`, `*`, and `/` to operators.
- `Enter` and `=` to equals.
- `Escape` to clear.
- `Backspace` to deletion.

The output uses `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
Every button has visible text or an explicit accessible label. Focus uses a
visible outline and follows document order. Enter is not intercepted when a
button owns focus and no calculator keyboard sequence has started, allowing the
browser's native button activation. Any calculator digit/operator key starts a
keyboard sequence, so a following Enter calculates even if mouse focus remains
on an earlier button, and repeated Enter remains in that calculation mode. Tab
navigation clears the retained mouse-focus mode so Enter activates the newly
keyboard-focused button. Rendering updates the Ready/Error badge and scrolls
the display to its latest right edge. The local SVG favicon is accompanied by a
valid ICO-format `favicon.ico` fallback for browsers that still request the
conventional path; static tests verify its binary header rather than existence
alone.

## 5. Visual contract

The stylesheet copies the required Clawpilot light/dark variables exactly and
uses only `var(--cp-*)` values for colors. Typography uses Segoe UI with the
approved fallback stack. Controls use 10-pixel radii; the calculator card uses
16 pixels and the required subtle card shadow.

The page centers a calculator capped to the viewport width. A media query below
400 pixels reduces spacing and type size without changing the four-column keypad
or introducing horizontal page overflow. The display uses contained horizontal
scrolling rather than clipping a supported long operand. The card explicitly
allows intrinsic-content shrinkage. An inner max-content value creates reachable
scroll overflow in both directions, and the containing display is
keyboard-focusable with a visible focus indicator so keyboard-only users can
scroll long positive or negative values.

## 6. Validation

The unit-first sequence is:

1. `node --test test/calculator/test/calculator.test.js`
2. `node --test test/calculator/test/*.test.js`
3. Built-in Copilot CLI `/review`
4. User browser acceptance for precision, percent, repeated equals, display
   visibility, focused Enter, error status, and favicon loading
5. Framework assessment update

Engine tests call only public methods. Static tests read the three browser files
and verify asset locality, required controls and keyboard mappings, theme
ordering/variables, responsive rules, accessible output, and absence of
`eval`, `Function`, and external URL dependencies. Shared validation helpers are
also exercised against per-theme variable loss, named component colors,
single-quoted or external assets, every unused timer/network API, direct or
indirect dynamic evaluation, all valid quoting/casing forms for asset attributes,
and mixed variable/hard-coded component colors. Component color values follow an
allowlist grammar after `var(--cp-*)` removal rather than a short named-color
blacklist, with case-insensitive property handling. Constructor-access checks
cover dotted, bracketed, whitespace-separated, and destructured forms while
allowing the engine's ordinary class constructor declaration.

No DEV, STAGING, cloud, browser-profile, or deployment validation is required for
this local static exercise.

## 7. Failure and recovery behavior

- Invalid repeated decimal input is ignored.
- Operator replacement while awaiting an operand updates the pending operator
  instead of evaluating an incomplete expression.
- Division by zero and non-finite results display `Error`.
- Numeric input after an error starts a fresh calculation.
- Missing DOM elements throw during initialization rather than silently
  presenting a partially wired calculator.
- Framework phase, receipt, artifact, and test failures remain visible in the
  assessment rather than being rewritten as success.

## 8. Decisions and limitations

- A sequential calculator state machine is preferred over an expression parser;
  it meets the requested scope without precedence or arbitrary-code concerns.
- The implementation is dependency-free and deliberately avoids a UI framework.
- Static contract tests do not prove pixel-perfect rendering in every browser.
- Automatic installed-hook activation cannot be verified in the current
  pre-install Copilot session; a restarted session is required for that check.
- The framework-generated `.sdlc/work-items` manifest is lifecycle metadata, not
  a calculator artifact; all calculator documents and code remain under the
  requested folder.
