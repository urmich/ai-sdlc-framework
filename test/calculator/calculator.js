(function exposeCalculator(root, factory) {
  const CalculatorEngine = factory();
  if (typeof module === 'object' && module.exports) module.exports = { CalculatorEngine };
  root.CalculatorEngine = CalculatorEngine;
}(typeof globalThis === 'object' ? globalThis : this, function createCalculatorEngine() {
  'use strict';

  const OPERATORS = new Set(['+', '-', '*', '/']);
  const MAX_INPUT_LENGTH = 15;
  const MAX_DISPLAY_LENGTH = 24;

  function significantDigitCount(value) {
    return value.replace('-', '').replace('.', '').replace(/^0+/u, '').length;
  }

  function expandExponential(value) {
    const text = String(value);
    if (!/[eE]/u.test(text)) return text;
    const [coefficient, exponentText] = text.toLowerCase().split('e');
    const negative = coefficient.startsWith('-');
    const unsigned = negative ? coefficient.slice(1) : coefficient;
    const decimalIndex = unsigned.includes('.') ? unsigned.indexOf('.') : unsigned.length;
    const digits = unsigned.replace('.', '');
    const nextIndex = decimalIndex + Number(exponentText);
    const sign = negative ? '-' : '';
    if (nextIndex <= 0) return `${sign}0.${'0'.repeat(-nextIndex)}${digits}`;
    if (nextIndex >= digits.length) return `${sign}${digits}${'0'.repeat(nextIndex - digits.length)}`;
    return `${sign}${digits.slice(0, nextIndex)}.${digits.slice(nextIndex)}`;
  }

  class CalculatorEngine {
    constructor() {
      this.clear();
    }

    clear() {
      this.display = '0';
      this.storedValue = null;
      this.pendingOperator = null;
      this.lastOperator = null;
      this.lastOperand = null;
      this.divisionCarry = null;
      this.waitingForOperand = false;
      this.error = false;
      return this.display;
    }

    inputDigit(digit) {
      if (!/^[0-9]$/u.test(String(digit))) throw new TypeError('Digit must be 0 through 9');
      if (this.error) this.clear();
      if (this.waitingForOperand) {
        if (!this.pendingOperator) {
          this.lastOperator = null;
          this.lastOperand = null;
        }
        this.display = String(digit);
        this.waitingForOperand = false;
      } else if (this.display === '0') {
        this.display = String(digit);
      } else {
        this.display = expandExponential(this.display);
        if (this.display.length >= MAX_DISPLAY_LENGTH ||
            significantDigitCount(this.display) >= MAX_INPUT_LENGTH) {
          return this.display;
        }
        this.display += String(digit);
      }
      return this.display;
    }

    inputDecimal() {
      if (this.error) this.clear();
      if (this.waitingForOperand) {
        if (!this.pendingOperator) {
          this.lastOperator = null;
          this.lastOperand = null;
        }
        this.display = '0.';
        this.waitingForOperand = false;
      } else {
        this.display = expandExponential(this.display);
        if (!this.display.includes('.')) this.display += '.';
      }
      return this.display;
    }

    chooseOperator(operator) {
      if (!OPERATORS.has(operator)) throw new TypeError('Unsupported operator');
      if (this.error) return this.display;
      if (this.pendingOperator && this.waitingForOperand) {
        if (this.pendingOperator === '*' && operator !== '*') this.divisionCarry = null;
        this.pendingOperator = operator;
        return this.display;
      }

      const currentValue = Number(this.display);
      if (this.storedValue === null) {
        this.storedValue = currentValue;
      } else if (this.pendingOperator) {
        const completedOperator = this.pendingOperator;
        const inverseDividend = completedOperator === '*' && this.divisionCarry &&
          currentValue === this.divisionCarry.divisor ?
          this.divisionCarry.dividend : null;
        const left = this.storedValue;
        const result = inverseDividend ?? this.calculate(left, currentValue, completedOperator);
        if (result === null) return this.display;
        this.divisionCarry = null;
        this.display = this.format(result);
        this.storedValue = Number(this.display);
        this.divisionCarry = completedOperator === '/' && operator === '*' ?
          { dividend: left, divisor: currentValue } : null;
      }

      this.pendingOperator = operator;
      this.waitingForOperand = true;
      return this.display;
    }

    equals() {
      if (this.error) return this.display;
      const operator = this.pendingOperator ?? this.lastOperator;
      const right = this.pendingOperator ? Number(this.display) : this.lastOperand;
      const left = this.pendingOperator ? this.storedValue : Number(this.display);
      if (!operator || right === null || left === null) return this.display;
      const inverseDividend = this.pendingOperator === '*' && this.divisionCarry &&
        right === this.divisionCarry.divisor ? this.divisionCarry.dividend : null;
      const result = inverseDividend ?? this.calculate(left, right, operator);
      if (result === null) return this.display;
      this.display = this.format(result);
      this.lastOperator = operator;
      this.lastOperand = right;
      this.storedValue = null;
      this.pendingOperator = null;
      this.divisionCarry = null;
      this.waitingForOperand = true;
      return this.display;
    }

    backspace() {
      if (this.error) return this.clear();
      if (this.waitingForOperand) return this.display;
      this.display = expandExponential(this.display);
      if (this.display.length <= 1 ||
          (this.display.startsWith('-') && this.display.length === 2)) {
        this.display = '0';
      } else {
        this.display = this.display.slice(0, -1);
      }
      return this.display;
    }

    toggleSign() {
      if (this.error || Number(this.display) === 0) return this.display;
      this.display = this.display.startsWith('-') ? this.display.slice(1) : `-${this.display}`;
      this.waitingForOperand = false;
      return this.display;
    }

    percent() {
      if (this.error) return this.display;
      const current = Number(this.display);
      const value = this.storedValue !== null &&
        ['+', '-'].includes(this.pendingOperator) ?
        this.storedValue * current / 100 : current / 100;
      this.display = this.format(value);
      this.waitingForOperand = false;
      return this.display;
    }

    calculate(left, right, operator) {
      let result;
      switch (operator) {
        case '+': result = left + right; break;
        case '-': result = left - right; break;
        case '*': result = left * right; break;
        case '/':
          if (right === 0) return this.setError();
          result = left / right;
          break;
        default: throw new TypeError('Unsupported operator');
      }
      if (Number.isInteger(left) && Number.isInteger(right) &&
          operator !== '/' && !Number.isSafeInteger(result)) {
        return this.setError();
      }
      return Number.isFinite(result) ? result : this.setError();
    }

    setError() {
      this.display = 'Error';
      this.storedValue = null;
      this.pendingOperator = null;
      this.waitingForOperand = true;
      this.error = true;
      return null;
    }

    format(value) {
      if (!Number.isFinite(value)) {
        this.setError();
        return this.display;
      }
      if (Object.is(value, -0)) return '0';
      if (Number.isSafeInteger(value)) return String(value);
      return String(Number(value.toPrecision(15)));
    }

    static actionForKey(key) {
      if (/^[0-9]$/u.test(key)) return { action: 'digit', value: key };
      if (key === '.') return { action: 'decimal' };
      if (OPERATORS.has(key)) return { action: 'operator', value: key };
      if (key === 'Enter' || key === '=') return { action: 'equals' };
      if (key === 'Escape') return { action: 'clear' };
      if (key === 'Backspace') return { action: 'backspace' };
      return null;
    }

    static dispatch(engine, action, value) {
      if (!(engine instanceof CalculatorEngine)) throw new TypeError('Calculator engine is required');
      if (action === 'digit') return engine.inputDigit(value);
      if (action === 'decimal') return engine.inputDecimal();
      if (action === 'operator') return engine.chooseOperator(value);
      if (action === 'equals') return engine.equals();
      if (action === 'clear') return engine.clear();
      if (action === 'backspace') return engine.backspace();
      if (action === 'sign') return engine.toggleSign();
      if (action === 'percent') return engine.percent();
      throw new TypeError('Unsupported calculator action');
    }
  }

  function initializeBrowserCalculator(documentObject) {
    const display = documentObject.querySelector('#display');
    const displayValue = documentObject.querySelector('#display-value');
    const statusBadge = documentObject.querySelector('#status-badge');
    const keypad = documentObject.querySelector('.keypad');
    if (!display || !displayValue || !statusBadge || !keypad) {
      throw new Error('Calculator markup is incomplete');
    }
    const engine = new CalculatorEngine();
    let keyboardSequenceActive = false;
    let focusOrigin = 'none';
    const render = () => {
      displayValue.textContent = engine.display;
      display.setAttribute('aria-label',
        engine.error ? 'Calculator error' : `Calculator display ${engine.display}`);
      statusBadge.textContent = engine.error ? 'Error' : 'Ready';
      statusBadge.classList.toggle('error', engine.error);
      display.scrollLeft = display.scrollWidth;
    };
    const act = (action, value) => {
      CalculatorEngine.dispatch(engine, action, value);
      render();
    };

    keypad.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !keypad.contains(button)) return;
      act(button.dataset.action, button.dataset.value);
      keyboardSequenceActive = false;
      focusOrigin = 'pointer';
    });

    documentObject.addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        keyboardSequenceActive = false;
        focusOrigin = 'keyboard';
        return;
      }
      if (event.key === 'Enter' && event.target?.closest?.('button') &&
          (!keyboardSequenceActive || focusOrigin === 'keyboard')) return;
      const mapped = CalculatorEngine.actionForKey(event.key);
      if (!mapped) return;
      event.preventDefault();
      act(mapped.action, mapped.value);
      keyboardSequenceActive = mapped.action !== 'clear';
      focusOrigin = 'calculator';
    });

    render();
    return engine;
  }

  CalculatorEngine.initialize = initializeBrowserCalculator;

  if (typeof document === 'object') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded',
        () => initializeBrowserCalculator(document), { once: true });
    } else {
      initializeBrowserCalculator(document);
    }
  }

  return CalculatorEngine;
}));
