# Requirements - Browser Calculator Framework Test

Status: User-approved baseline
Canonical role: requirements

## Understood request

Create a small single-page calculator under `test/calculator/` that runs in a
modern browser and use it as a real-world dry run of the installed AI SDLC
framework.

Constraints:

- Every calculator artifact, including requirements, tests, design, and
  implementation, stays below `test/calculator/`.
- The application is local and static: no server, account, database, telemetry,
  cloud resource, or network dependency is required.
- The implementation remains proportionate to a focused calculator exercise.
- The browser interface follows the active Clawpilot light/dark theme contract.
- Framework observations distinguish verified behavior from behavior that
  requires a restarted Copilot session.

Out of scope:

- Scientific, graphing, financial, unit-conversion, and programming functions.
- Persistent calculation history or cross-device synchronization.
- Deployment to a hosted environment.

### FR-001 - Provide a browser-based single-page calculator

The project must provide one calculator page that can be opened and used in a
modern desktop or mobile browser.

**Definition of Done**

- AC-001.1: Opening `test/calculator/index.html` presents one calculator
  interface without a server-side application.
- AC-001.2: The layout remains usable at 320 CSS pixels wide and at desktop
  widths without horizontal page scrolling.
- AC-001.3: The page contains no external runtime dependency or network request.
- AC-001.4: Local page assets, including the favicon, resolve without a missing
  resource request.

### FR-002 - Perform basic arithmetic

The calculator must support addition, subtraction, multiplication, and division
over integer and decimal operands.

**Definition of Done**

- AC-002.1: Number and decimal controls build the displayed operand.
- AC-002.2: Each supported binary operator produces the mathematically correct
  result when the equals control is activated.
- AC-002.3: Chained operations use the displayed result as the next left operand.
- AC-002.4: Results avoid avoidable binary floating-point display noise for
  ordinary calculator inputs.
- AC-002.5: Repeated equals re-applies the last operation and operand.

### FR-003 - Support clear, sign, percent, deletion, and keyboard input

The calculator must provide the expected basic editing and convenience controls.

**Definition of Done**

- AC-003.1: Clear resets the calculation to `0`.
- AC-003.2: Backspace removes the final digit of the active operand without
  producing an empty or invalid display.
- AC-003.3: Sign toggles the active operand between positive and negative.
- AC-003.4: Percent divides the active operand by 100 for multiplication or
  division, and uses the entered value as a percentage of the stored operand for
  addition or subtraction.
- AC-003.5: Digit, decimal, operator, Enter/equal, Escape, and Backspace keyboard
  input invokes the same behavior as the visible controls. Enter on a focused
  button activates that button when used directly; after calculator keyboard
  input begins, Enter calculates even if mouse focus remains on an earlier
  button. Tab navigation resets that retained-mouse-focus mode so Enter activates
  the newly keyboard-focused button, while repeated Enter after equals continues
  repeated-equals calculation.

### FR-004 - Handle invalid operations safely

The calculator must surface invalid arithmetic without executing arbitrary code
or leaving the interface unusable.

**Definition of Done**

- AC-004.1: Division by zero displays `Error` and changes the visible status from
  `Ready` to `Error`.
- AC-004.2: A numeric input after `Error` starts a new calculation.
- AC-004.3: Repeated decimal input never creates an invalid numeric token.
- AC-004.4: Arithmetic is implemented explicitly and does not call `eval`,
  `Function`, or another dynamic code-execution API.

### FR-005 - Provide an accessible themed interface

The page must be understandable and operable with common browser accessibility
features while honoring the required light/dark theme.

**Definition of Done**

- AC-005.1: The theme is selected from `scoutTheme` or the browser color-scheme
  preference before other application JavaScript runs.
- AC-005.2: All component colors use the required `--cp-*` variables.
- AC-005.3: Buttons have accessible names, visible focus indication, and a
  logical keyboard focus order.
- AC-005.4: The display exposes result changes through an appropriate live
  region without requiring color perception.
- AC-005.5: After entry or calculation, the display automatically reveals the
  latest rightmost digits while remaining keyboard-scrollable.

### FR-006 - Keep the implementation locally testable

The calculation behavior must be separated from browser wiring sufficiently for
deterministic local tests.

**Definition of Done**

- AC-006.1: `node --test test/calculator/test/*.test.js` runs without downloading
  dependencies.
- AC-006.2: Tests cover every arithmetic operator, decimal input, chaining,
  clear, backspace, sign, percent, repeated decimal input, and division by zero.
- AC-006.3: Static contract tests verify required theme, accessibility, artifact
  location, and no-dynamic-evaluation constraints.

### FR-007 - Produce an evidence-based framework dry-run assessment

The exercise must record whether the installed framework enforces and guides the
requested lifecycle as designed.

**Definition of Done**

- AC-007.1: The work item, repository binding, canonical artifact locators, and
  phase transitions are attempted through the installed `sdlc` CLI.
- AC-007.2: A blocked or unavailable capability is recorded as such rather than
  represented as success.
- AC-007.3: The final report distinguishes current-session manual adapter use
  from behavior verified after a Copilot restart.
