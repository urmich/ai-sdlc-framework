const test = require('node:test');
const assert = require('node:assert/strict');
const { CalculatorEngine } = require('../calculator.js');

function enter(engine, value) {
  for (const character of String(value)) {
    if (character === '.') engine.inputDecimal();
    else engine.inputDigit(character);
  }
}

function calculate(left, operator, right) {
  const engine = new CalculatorEngine();
  enter(engine, left);
  engine.chooseOperator(operator);
  enter(engine, right);
  engine.equals();
  return engine;
}

function wireCalculator() {
  const listeners = {};
  const display = { attributes: {}, scrollLeft: 0, scrollWidth: 320,
    setAttribute(name, value) { this.attributes[name] = value; } };
  const displayValue = { textContent: '' };
  const statusBadge = { textContent: '', error: false,
    classList: { toggle(name, active) { if (name === 'error') statusBadge.error = active; } } };
  const keypad = {
    addEventListener(type, listener) { listeners[type] = listener; },
    contains() { return true; },
  };
  const documentObject = {
    querySelector(selector) {
      return { '#display': display, '#display-value': displayValue,
        '#status-badge': statusBadge, '.keypad': keypad }[selector];
    },
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  const engine = CalculatorEngine.initialize(documentObject);
  const click = (action, value) => {
    const button = { dataset: { action, value }, closest() { return this; } };
    listeners.click({ target: button });
  };
  const keydown = (key, target) => {
    let prevented = false;
    listeners.keydown({ key, target, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { engine, display, displayValue, statusBadge, click, keydown };
}

test('T-01 enters integer and decimal operands with normalized output', () => {
  const engine = new CalculatorEngine();
  assert.equal(engine.display, '0');
  enter(engine, '12.5');
  assert.equal(engine.display, '12.5');
  assert.equal(calculate('0.1', '+', '0.2').display, '0.3');
});

test('T-02 performs every arithmetic operator and chains results', () => {
  assert.equal(calculate('9', '+', '4').display, '13');
  assert.equal(calculate('9', '-', '4').display, '5');
  assert.equal(calculate('9', '*', '4').display, '36');
  assert.equal(calculate('9', '/', '4').display, '2.25');
  assert.equal(calculate('999999999999', '+', '2').display, '1000000000001');
  assert.equal(calculate('1234567890123', '+', '0').display, '1234567890123');
  assert.equal(calculate('999999999999999', '-', '999999999999998').display, '1');
  const precisionChain = new CalculatorEngine();
  enter(precisionChain, '100000000000000');
  precisionChain.chooseOperator('/');
  enter(precisionChain, '3');
  precisionChain.chooseOperator('*');
  enter(precisionChain, '3');
  precisionChain.equals();
  assert.equal(precisionChain.display, '100000000000000');
  const continuedInverse = new CalculatorEngine();
  enter(continuedInverse, '100000000000000');
  continuedInverse.chooseOperator('/');
  enter(continuedInverse, '3');
  continuedInverse.chooseOperator('*');
  enter(continuedInverse, '3');
  continuedInverse.chooseOperator('-');
  enter(continuedInverse, '100000000000000');
  continuedInverse.equals();
  assert.equal(continuedInverse.display, '0');
  const exactInverse = new CalculatorEngine();
  enter(exactInverse, '999999999999999');
  exactInverse.chooseOperator('*');
  enter(exactInverse, '9');
  exactInverse.chooseOperator('/');
  enter(exactInverse, '7');
  exactInverse.chooseOperator('*');
  enter(exactInverse, '7');
  exactInverse.equals();
  assert.equal(exactInverse.display, '8999999999999991');
  const exactContinued = new CalculatorEngine();
  enter(exactContinued, '999999999999999');
  exactContinued.chooseOperator('*');
  enter(exactContinued, '9');
  exactContinued.chooseOperator('/');
  enter(exactContinued, '7');
  exactContinued.chooseOperator('*');
  enter(exactContinued, '7');
  exactContinued.chooseOperator('/');
  enter(exactContinued, '9');
  exactContinued.equals();
  assert.equal(exactContinued.display, '999999999999999');
  const nonInverse = calculate('1', '/', '6');
  nonInverse.chooseOperator('*');
  enter(nonInverse, '2');
  nonInverse.equals();
  assert.equal(nonInverse.display, '0.333333333333334');
  const replacedInverse = calculate('100000000000000', '/', '3');
  replacedInverse.chooseOperator('*');
  replacedInverse.chooseOperator('-');
  enter(replacedInverse, '33333333333333.3');
  replacedInverse.equals();
  assert.equal(replacedInverse.display, '0');
  assert.equal(calculate('0.000000000000001', '/', '1').display, '1e-15');
  assert.equal(calculate('0.999999999999999', '+', '0').display, '0.999999999999999');

  const repeated = calculate('2', '+', '3');
  repeated.equals();
  repeated.equals();
  assert.equal(repeated.display, '11');
  repeated.inputDecimal();
  repeated.inputDigit('5');
  repeated.equals();
  assert.equal(repeated.display, '0.5');
  repeated.clear();
  repeated.inputDigit('7');
  repeated.equals();
  assert.equal(repeated.display, '7');

  const engine = calculate('2', '+', '3');
  engine.chooseOperator('*');
  enter(engine, '4');
  engine.equals();
  assert.equal(engine.display, '20');

  const decimals = new CalculatorEngine();
  enter(decimals, '0.1');
  decimals.chooseOperator('+');
  enter(decimals, '0.2');
  decimals.chooseOperator('-');
  enter(decimals, '0.3');
  decimals.equals();
  assert.equal(decimals.display, '0');

  const withEquals = calculate('0.1', '+', '0.2');
  withEquals.chooseOperator('-');
  enter(withEquals, '0.3');
  withEquals.equals();
  assert.equal(withEquals.display, '0');
});

test('T-03 clear, backspace, sign and percent update state', () => {
  const engine = new CalculatorEngine();
  enter(engine, '123');
  engine.backspace();
  assert.equal(engine.display, '12');
  engine.toggleSign();
  assert.equal(engine.display, '-12');
  engine.toggleSign();
  assert.equal(engine.display, '12');
  engine.percent();
  assert.equal(engine.display, '0.12');
  engine.clear();
  assert.equal(engine.display, '0');
  assert.equal(engine.pendingOperator, null);
  assert.equal(engine.storedValue, null);
  assert.equal(engine.divisionCarry, null);

  const contextualPercent = new CalculatorEngine();
  enter(contextualPercent, '200');
  contextualPercent.chooseOperator('+');
  enter(contextualPercent, '10');
  contextualPercent.percent();
  contextualPercent.equals();
  assert.equal(contextualPercent.display, '220');
  assert.equal(calculate('200', '*', '0.1').display, '20');
});

test('T-04 handles division by zero, recovery and repeated decimal input', () => {
  const engine = calculate('8', '/', '0');
  assert.equal(engine.display, 'Error');
  engine.inputDigit('7');
  assert.equal(engine.display, '7');
  engine.inputDecimal();
  engine.inputDigit('5');
  engine.inputDecimal();
  assert.equal(engine.display, '7.5');

  const bounded = new CalculatorEngine();
  enter(bounded, '9999999999999999');
  assert.equal(bounded.display, '999999999999999');
  const decimalBoundary = new CalculatorEngine();
  enter(decimalBoundary, '0.123456789012345');
  assert.equal(decimalBoundary.display, '0.123456789012345');
  const small = new CalculatorEngine();
  enter(small, '0.000000000000001');
  assert.equal(small.display, '0.000000000000001');
  small.chooseOperator('*');
  enter(small, '100000000000000');
  small.equals();
  assert.equal(small.display, '0.1');
  assert.equal(calculate('999999999999999', '*', '999999999999999').display, 'Error');
});

test('scientific notation remains valid when edited', () => {
  const digit = new CalculatorEngine();
  enter(digit, '0.00001');
  digit.percent();
  assert.equal(digit.display, '1e-7');
  digit.inputDigit('2');
  assert.equal(digit.display, '0.00000012');

  const decimal = new CalculatorEngine();
  enter(decimal, '0.00001');
  decimal.percent();
  decimal.inputDecimal();
  assert.equal(decimal.display, '0.0000001');

  const deletion = new CalculatorEngine();
  enter(deletion, '0.00001');
  deletion.percent();
  deletion.backspace();
  assert.equal(deletion.display, '0.000000');
  assert.ok(Number.isFinite(Number(deletion.display)));
});

test('keyboard and click actions share deterministic mappings', () => {
  for (const digit of '0123456789') {
    assert.deepEqual(CalculatorEngine.actionForKey(digit), { action: 'digit', value: digit });
  }
  assert.deepEqual(CalculatorEngine.actionForKey('.'), { action: 'decimal' });
  for (const operator of ['+', '-', '*', '/']) {
    assert.deepEqual(CalculatorEngine.actionForKey(operator),
      { action: 'operator', value: operator });
  }
  assert.deepEqual(CalculatorEngine.actionForKey('Enter'), { action: 'equals' });
  assert.deepEqual(CalculatorEngine.actionForKey('='), { action: 'equals' });
  assert.deepEqual(CalculatorEngine.actionForKey('Escape'), { action: 'clear' });
  assert.deepEqual(CalculatorEngine.actionForKey('Backspace'), { action: 'backspace' });
  assert.equal(CalculatorEngine.actionForKey('a'), null);

  for (const digit of '0123456789') {
    const wired = wireCalculator();
    assert.equal(wired.keydown(digit), true);
    assert.equal(wired.displayValue.textContent, digit);
  }
  const addition = wireCalculator();
  for (const key of ['1', '.', '5', '+', '2', 'Enter']) assert.equal(addition.keydown(key), true);
  assert.equal(addition.displayValue.textContent, '3.5');
  const subtraction = wireCalculator();
  for (const key of ['9', '-', '4', '=']) assert.equal(subtraction.keydown(key), true);
  assert.equal(subtraction.displayValue.textContent, '5');
  const multiplication = wireCalculator();
  for (const key of ['3', '*', '4', 'Enter']) assert.equal(multiplication.keydown(key), true);
  assert.equal(multiplication.displayValue.textContent, '12');
  const division = wireCalculator();
  for (const key of ['8', '/', '2', 'Enter']) assert.equal(division.keydown(key), true);
  assert.equal(division.displayValue.textContent, '4');
  assert.equal(division.keydown('Escape'), true);
  assert.equal(division.displayValue.textContent, '0');
  assert.equal(division.keydown('9'), true);
  assert.equal(division.keydown('Backspace'), true);
  assert.equal(division.displayValue.textContent, '0');
  assert.equal(division.keydown('ArrowLeft'), false);
  assert.equal(division.keydown('ArrowRight'), false);
  assert.equal(division.keydown('a'), false);
  const focusedButton = { closest(selector) { return selector === 'button' ? this : null; } };
  const directFocus = wireCalculator();
  assert.equal(directFocus.keydown('Enter', focusedButton), false);
  assert.equal(directFocus.displayValue.textContent, '0');
  const afterMouse = wireCalculator();
  afterMouse.click('clear');
  for (const key of ['1', '2', '+', '3']) {
    assert.equal(afterMouse.keydown(key, focusedButton), true);
  }
  assert.equal(afterMouse.keydown('Enter', focusedButton), true);
  assert.equal(afterMouse.displayValue.textContent, '15');
  assert.equal(afterMouse.keydown('Enter', focusedButton), true);
  assert.equal(afterMouse.displayValue.textContent, '18');
  const tabbed = wireCalculator();
  assert.equal(tabbed.keydown('2'), true);
  assert.equal(tabbed.keydown('Tab', focusedButton), false);
  assert.equal(tabbed.keydown('Enter', focusedButton), false);
  tabbed.click('digit', '7');
  assert.equal(tabbed.displayValue.textContent, '27');

  const clickEditing = wireCalculator();
  clickEditing.click('digit', '1');
  clickEditing.click('digit', '2');
  assert.equal(clickEditing.displayValue.textContent, '12');
  clickEditing.click('backspace');
  assert.equal(clickEditing.displayValue.textContent, '1');
  clickEditing.click('sign');
  assert.equal(clickEditing.displayValue.textContent, '-1');
  clickEditing.click('sign');
  clickEditing.click('decimal');
  clickEditing.click('digit', '5');
  assert.equal(clickEditing.displayValue.textContent, '1.5');
  clickEditing.click('percent');
  assert.equal(clickEditing.displayValue.textContent, '0.015');
  clickEditing.click('clear');
  assert.equal(clickEditing.displayValue.textContent, '0');

  for (const [operator, expected] of [['+', '10'], ['-', '6'], ['*', '16'], ['/', '4']]) {
    const wired = wireCalculator();
    wired.click('digit', '8');
    wired.click('operator', operator);
    wired.click('digit', '2');
    wired.click('equals');
    assert.equal(wired.displayValue.textContent, expected);
    assert.match(wired.display.attributes['aria-label'], new RegExp(`${expected}$`, 'u'));
    assert.equal(wired.display.scrollLeft, wired.display.scrollWidth);
  }

  const error = wireCalculator();
  for (const [action, value] of [['digit', '8'], ['operator', '/'],
    ['digit', '0'], ['equals']]) error.click(action, value);
  assert.equal(error.displayValue.textContent, 'Error');
  assert.equal(error.statusBadge.textContent, 'Error');
  assert.equal(error.statusBadge.error, true);
  error.click('digit', '5');
  assert.equal(error.statusBadge.textContent, 'Ready');
  assert.equal(error.statusBadge.error, false);
});

test('operator replacement does not evaluate an incomplete expression', () => {
  const engine = new CalculatorEngine();
  enter(engine, '10');
  engine.chooseOperator('+');
  engine.chooseOperator('*');
  enter(engine, '2');
  engine.equals();
  assert.equal(engine.display, '20');
});

test('public input validation rejects unsupported digits and operators', () => {
  const engine = new CalculatorEngine();
  assert.throws(() => engine.inputDigit('x'), /Digit must be 0 through 9/u);
  assert.throws(() => engine.chooseOperator('^'), /Unsupported operator/u);
});
