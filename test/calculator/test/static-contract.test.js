const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'calculator.js'), 'utf8');
const favicon = fs.readFileSync(path.join(root, 'favicon.ico'));

function assertLocalAssets(markup) {
  const references = [...markup.matchAll(
    /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu)]
    .map(match => match[1] ?? match[2] ?? match[3]);
  assert.deepEqual(references.sort(), ['calculator.js', 'favicon.svg', 'styles.css']);
  for (const reference of references) {
    assert.doesNotMatch(reference, /^(?:[a-z]+:)?\/\//iu);
    const resolved = path.resolve(root, reference);
    assert.ok(resolved.startsWith(`${root}${path.sep}`));
    assert.ok(fs.existsSync(resolved));
  }
}

function cssBlock(styles, selector) {
  const start = styles.indexOf(selector);
  assert.ok(start >= 0, `${selector} must exist`);
  const open = styles.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < styles.length; index++) {
    if (styles[index] === '{') depth++;
    if (styles[index] === '}' && --depth === 0) return styles.slice(open + 1, index);
  }
  assert.fail(`${selector} must have a complete block`);
}

function assertThemeContract(styles) {
  const variables = ['bg', 'bg-elevated', 'surface', 'surface-soft', 'border',
    'border-strong', 'text', 'text-muted', 'text-soft', 'accent', 'accent-hover',
    'accent-soft', 'accent-fg', 'success', 'danger', 'warning', 'link', 'shadow',
    'overlay', 'panel', 'panel-strong', 'sheen', 'highlight'];
  const light = cssBlock(styles, ':root');
  const dark = cssBlock(styles, 'html[data-theme="dark"]');
  for (const variable of variables) {
    assert.equal([...light.matchAll(new RegExp(`--cp-${variable}:`, 'gu'))].length, 1);
    assert.equal([...dark.matchAll(new RegExp(`--cp-${variable}:`, 'gu'))].length, 1);
  }
  for (const declaration of styles.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:\s*([^;}]+)/gimu)) {
    const property = declaration[1].toLowerCase();
    const carriesColor = property === 'color' || property.endsWith('-color') ||
      property.startsWith('background') || property.startsWith('border-') ||
      ['border', 'outline', 'box-shadow', 'text-shadow', 'fill',
        'stroke', 'caret-color'].includes(property);
    if (!carriesColor || property.endsWith('radius') || property.endsWith('width') ||
        property.endsWith('style')) continue;
    assert.match(declaration[2], /var\(--cp-/u);
    const remainder = declaration[2]
      .replace(/var\(--cp-[a-z-]+\)/gu, '')
      .replace(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|s|deg)?/gu, '')
      .replace(/\b(?:solid|dashed|dotted|double|inset|outset|none)\b/gu, '')
      .replace(/[\s,()/.-]/gu, '');
    assert.equal(remainder, '');
  }
}

function assertNoDynamicExecution(source) {
  assert.doesNotMatch(source,
    /\beval\b|\bFunction\b|\.\s*constructor\b|\[\s*["']constructor["']\s*\]|\{[^{}]*\bconstructor\b\s*(?::|[,}])|\bsetTimeout\b|\bsetInterval\b|\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/u);
}

test('T-05 exposes accessible controls, live output and keyboard mappings', () => {
  assert.match(html, /role="status"/u);
  assert.match(html, /tabindex="0"/u);
  assert.match(html, /id="display-value"/u);
  assert.match(html, /id="status-badge"[^>]*aria-live="polite"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /aria-label="Calculator keypad"/u);
  assert.match(html, /data-action="backspace"/u);
  for (const mapping of ['actionForKey', "key === 'Enter'", "key === 'Escape'",
    "key === 'Backspace'", 'CalculatorEngine.dispatch']) assert.ok(script.includes(mapping));
  for (const operator of ['+', '-', '*', '/']) assert.ok(html.includes(`data-value="${operator}"`));
  assert.match(css, /:focus-visible/u);
});

test('T-06 applies the required theme before app code and remains responsive', () => {
  const themeIndex = html.indexOf('new URLSearchParams(window.location.search)');
  const applicationIndex = html.indexOf('<script src="calculator.js">');
  assert.ok(themeIndex >= 0 && themeIndex < applicationIndex);
  assertThemeContract(css);
  for (const line of css.split('\n').filter(value => /#[0-9a-f]{3,8}|rgba?\(/iu.test(value))) {
    assert.match(line, /--cp-/u);
  }
  assert.match(css, /@media \(max-width: 400px\)/u);
  assert.match(css, /width: min\(100%, 380px\)/u);
  assert.match(css, /overflow-x: auto/u);
  assert.match(css, /\.calculator-card\s*\{[\s\S]*?min-width: 0;/u);
  assert.match(css, /\.display-value\s*\{[\s\S]*?width: max-content;/u);
  assert.match(css, /\.display-value\s*\{[\s\S]*?min-width: 100%;/u);
  assert.match(css, /\.display:focus-visible/u);
  assert.match(css, /font-family: "Segoe UI", Aptos, Calibri/u);
  assert.throws(() => assertThemeContract(css.replace(
    '  --cp-bg: #3d3b3a;\n', '')));
  assert.throws(() => assertThemeContract(css.replace(
    '  --cp-bg: #3d3b3a;\n', '  --cp-bg-elevated: #3d3b3a;\n')));
  assert.throws(() => assertThemeContract(`${css}\n.display { color: red; }\n`));
  assert.throws(() => assertThemeContract(`${css}\n.display { border-bottom-color: red; }\n`));
  assert.throws(() => assertThemeContract(`${css}\n.display { border-top: 1px solid red; }\n`));
  assert.throws(() => assertThemeContract(
    `${css}\n.display { background: linear-gradient(red, var(--cp-bg)); }\n`));
  assert.throws(() => assertThemeContract(
    `${css}\n.display { background: linear-gradient(orange, var(--cp-bg)); }\n`));
  assert.throws(() => assertThemeContract(
    `${css}\n.display { background-image: linear-gradient(red, blue); }\n`));
  assert.throws(() => assertThemeContract(
    `${css}\n.display { box-shadow: 0 0 2px red, var(--cp-shadow); }\n`));
  assert.throws(() => assertThemeContract(
    `${css}\n.display { box-shadow: 0 0 2px yellow, var(--cp-shadow); }\n`));
  assert.throws(() => assertThemeContract(
    `${css}\n.display { COLOR: red; BACKGROUND-IMAGE: linear-gradient(red, blue); }\n`));
});

test('T-07 keeps runtime local, explicit and inside the calculator folder', () => {
  assertLocalAssets(html);
  assert.doesNotMatch(`${html}\n${css}\n${script}`, /(?:https?:)?\/\//u);
  assertNoDynamicExecution(`${html}\n${script}`);
  for (const required of ['docs/requirements.md', 'docs/test-plan.md',
    'docs/technical-design.md', 'index.html', 'styles.css', 'calculator.js',
    'favicon.svg', 'favicon.ico']) {
    assert.ok(fs.existsSync(path.join(root, required)), `${required} must exist`);
  }
  assert.deepEqual([...favicon.subarray(0, 6)], [0, 0, 1, 0, 1, 0]);
  assert.throws(() => assertLocalAssets(html.replace('calculator.js', '//example.invalid/app.js')));
  assert.throws(() => assertLocalAssets(`${html}<img src='missing.png' alt=''>`));
  assert.throws(() => assertLocalAssets(`${html}<img src=missing.png alt="">`));
  assert.throws(() => assertLocalAssets(`${html}<link rel=stylesheet href=missing.css>`));
  assert.throws(() => assertLocalAssets(`${html}<img SRC="missing.png" alt="">`));
  assert.throws(() => assertNoDynamicExecution('<script>eval("1+1")</script>'));
  assert.throws(() => assertNoDynamicExecution('(0, eval)("document.title = 1")'));
  assert.throws(() => assertNoDynamicExecution('(()=>{}).constructor("return 1")()'));
  assert.throws(() => assertNoDynamicExecution('(()=>{}) . constructor("return 1")()'));
  assert.throws(() => assertNoDynamicExecution('(()=>{})[ "constructor" ]("return 1")()'));
  assert.throws(() => assertNoDynamicExecution(
    'const {constructor: compile} = ()=>{}; compile("return 1")()'));
  assert.throws(() => assertNoDynamicExecution(
    'const {constructor} = ()=>{}; constructor("return 1")()'));
  assert.throws(() => assertNoDynamicExecution(
    'const {name, constructor: compile} = ()=>{}; compile("return 1")()'));
  assert.doesNotThrow(() => assertNoDynamicExecution(
    'class SafeValue { constructor() { this.value = 1; } }'));
  assert.throws(() => assertNoDynamicExecution('setTimeout("document.title = 1", 0)'));
  assert.throws(() => assertNoDynamicExecution('setTimeout(code, 0)'));
  assert.throws(() => assertNoDynamicExecution('const later = setTimeout; later(code, 0)'));
  assert.throws(() => assertNoDynamicExecution('setInterval(code, 1000)'));
  assert.throws(() => assertNoDynamicExecution('fetch("telemetry")'));
  assert.throws(() => assertNoDynamicExecution('const request = fetch; request("telemetry")'));
  assert.throws(() => assertNoDynamicExecution('new XMLHttpRequest()'));
  assert.throws(() => assertNoDynamicExecution('new WebSocket("wss://example.invalid")'));
  assert.throws(() => assertNoDynamicExecution('new EventSource("telemetry")'));
  assert.throws(() => assertNoDynamicExecution('navigator.sendBeacon("telemetry")'));
});
