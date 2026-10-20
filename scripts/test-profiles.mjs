import { matchesNodeSelection } from './validation-inventory.mjs';
import { splitMarkdownTableRow } from '../src/artifacts.mjs';
import { requireThat } from '../src/core.mjs';

export const canonicalUnitFiles = Object.freeze([
  'test/provider-observations.unit.test.mjs',
  'test/execution-artifact-identity.test.mjs',
  'test/tool-adapters.test.mjs',
]);
export const testTimingGuidance = Object.freeze({ criticalMs: 30000, affectedMs: 120000 });

export const criticalSelectors = Object.freeze([
  ['test/storage.test.mjs', 'T-16 canonical data, atomic replacement, and deterministic write-boundary failures preserve old/new state'],
  ['test/storage.test.mjs', 'T-16 old live locks are never stolen; concurrent revision updates serialize'],
  ['test/storage.test.mjs', 'T-19 bindings resolve linked worktrees and refuse stale branch authority'],
  ['test/storage.test.mjs', 'T-23 symlink escapes and unsafe identifiers are rejected'],
  ['test/advisory-gate.test.mjs', 'T-41 command-hook launcher fails open for malformed input and import failure'],
  ['test/advisory-gate.test.mjs', 'T-41 unmanaged tool execution invalidates stale candidate evidence when files changed'],
  ['test/cli-install.test.mjs', 'T-23 install/update/uninstall preserve user files, paths with spaces, modified assets and runtime'],
  ['test/cli-install.test.mjs', 'T-23 partial installation rolls back only its own unchanged writes'],
  ['test/current-evidence.test.mjs', 'publication consent for hosted URL A cannot authorize URL B from the same checkout'],
  ['test/test-runner.test.mjs', 'T-130 public runner preserves a real failing child and still executes the passing sibling'],
  ['test/test-runner.test.mjs', 'T-GHB24 native execution evidence distinguishes passing, failing and skipped assertions without overwriting reports'],
].map(selector => Object.freeze(selector)));

export const criticalProfileBudget = Object.freeze({
  schemaVersion: 1,
  canonicalFiles: canonicalUnitFiles,
  canonicalAssertions: 16,
  riskRoots: 11,
  maximumRootChecks: 27,
  maximumAssertions: 27,
  riskSelectors: criticalSelectors,
  additionPolicy: 'Explicitly revise the independent Test Plan risk obligations and this finite budget with a rationale; new tests default to PR-only.',
});

export function exactPattern(names) {
  return `^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})$`;
}

export function excludingPattern(names) {
  return `^(?!${exactPattern([...new Set(names)].sort())})`;
}

export function readCriticalRiskSelectors(contents) {
  let selectors;
  if (contents.trimStart().startsWith('{')) selectors = JSON.parse(contents).criticalSelectors;
  else {
    selectors = [];
    let reading = false;
    for (const line of contents.split('\n')) {
      if (!line.trim().startsWith('|')) { if (reading && selectors.length) break; continue; }
      const cells = splitMarkdownTableRow(line).slice(1, -1)
        .map(cell => cell.trim().replace(/^`|`$/gu, ''));
      if (cells[0] === 'File' && cells[1] === 'Exact critical case name') { reading = true; continue; }
      if (reading && cells[0]?.startsWith('test/')) selectors.push(cells.slice(0, 2));
    }
  }
  requireThat(Array.isArray(selectors) && selectors.length > 0 && selectors.every(selector =>
    Array.isArray(selector) && selector.length === 2 &&
    typeof selector[0] === 'string' && /^test\/[^\\:]+\.(?:mjs|js|cjs)$/u.test(selector[0]) &&
    !selector[0].split('/').some(part => part === '..' || part === '.') &&
    typeof selector[1] === 'string' && selector[1].trim()) &&
    new Set(selectors.map(selector => JSON.stringify(selector))).size === selectors.length,
  'INVENTORY', 'The canonical Test Plan must declare its independent exact critical-risk obligations');
  return selectors;
}

export function criticalSelection(declarations, tests, {
  canonicalFiles = [], requiredSelectors = criticalSelectors,
} = {}) {
  if (!Array.isArray(tests) || new Set(tests.map(test => test.id)).size !== tests.length) {
    throw new Error('Critical validation requires unique canonical Test Plan IDs when logical cases are declared.');
  }
  const local = tests.filter(test => !test.outOfScope && test.environment === 'local' &&
    test.checkpoint === 'pre-review' && test.location === 'development-machine');
  if (local.some(test => !['automated', 'semi-automated', 'manual'].includes(test.mode))) {
    throw new Error('Critical validation requires an explicit supported execution mode for every local case.');
  }
  const deferredCases = local.map(test => ({
    testId: test.id, mode: test.mode, owner: test.owner || null, location: test.location,
    checkpoint: test.checkpoint, implementation: test.implementation || null,
    status: 'NotRun',
    reason: test.mode === 'automated' ?
      'Exhaustive planned-case acceptance is separate from the finite sanity gate; execute applicable assertions in PR validation or explicit targeted debugging.' :
      'Requires separately observed procedure evidence; not executed by the automated critical profile.',
  }));
  const cases = declarations.flatMap(file => file.cases);
  const blockers = { unit: declarations.flatMap(file => file.unresolved), integration: [] };
  const fullName = test => [...test.parents, test.name].join(' ');
  const roots = new Map();
  for (const test of cases) {
    const key = JSON.stringify([test.file, test.parents[0] ?? test.name]);
    const tree = roots.get(key) ?? [];
    tree.push(test);
    roots.set(key, tree);
    for (let depth = 0; depth < test.parents.length; depth++) if (!cases.some(parent =>
      parent.file === test.file && parent.name === test.parents[depth] &&
      parent.parents.length === depth && parent.parents.every((name, index) => name === test.parents[index]))) {
      throw new Error('A critical selector has an undeclared parent.');
    }
  }
  const selectedRoots = new Set();
  for (const [file, name] of requiredSelectors) {
    const definitions = cases.filter(test => test.file === file && test.name === name &&
      test.parents.length === 0);
    const definition = definitions.length === 1 ? definitions[0] : null;
    if (!definition) {
      blockers.integration.push({ code: 'MISSING_CRITICAL_SELECTOR', file, name });
    } else if (!criticalSelectors.some(([memberFile, memberName]) =>
      memberFile === file && memberName === name)) {
      blockers.integration.push({ code: 'MISSING_REQUIRED_RISK_BINDING', file, name });
    } else {
      selectedRoots.add(JSON.stringify([file, name]));
    }
  }
  for (const [file, name] of criticalSelectors) if (!requiredSelectors.some(([requiredFile, requiredName]) =>
    requiredFile === file && requiredName === name)) {
    blockers.integration.push({ code: 'UNDECLARED_CRITICAL_RISK', file, name });
  }
  const canonicalCases = cases.filter(test => canonicalFiles.includes(test.file));
  const canonicalRoots = canonicalCases.filter(test => !test.parents.length).length;
  const metrics = {
    canonicalAssertions: canonicalCases.length, canonicalRoots,
    riskRoots: selectedRoots.size,
    riskAssertions: [...selectedRoots].reduce((count, key) => count + roots.get(key).length, 0),
    rootChecks: canonicalRoots + selectedRoots.size,
  };
  metrics.assertions = metrics.canonicalAssertions + metrics.riskAssertions;
  if (canonicalFiles.length && canonicalCases.length !== criticalProfileBudget.canonicalAssertions ||
      canonicalRoots + selectedRoots.size > criticalProfileBudget.maximumRootChecks ||
      metrics.assertions > criticalProfileBudget.maximumAssertions ||
      requiredSelectors.length !== criticalProfileBudget.riskRoots ||
      criticalSelectors.length !== criticalProfileBudget.riskRoots) {
    blockers.unit.push({ code: 'CRITICAL_PROFILE_BUDGET_EXCEEDED', metrics });
  }
  for (const file of canonicalFiles) if (!canonicalCases.some(test => test.file === file)) {
    blockers.unit.push({ code: 'MISSING_CANONICAL_UNIT_FILE', file });
  }
  const selection = stage => {
    const selected = cases.filter(test => stage === 'canonical' ? canonicalFiles.includes(test.file) :
      stage === 'integration' && !canonicalFiles.includes(test.file) &&
      selectedRoots.has(JSON.stringify([test.file, test.parents[0] ?? test.name])));
    const files = [...new Set(selected.map(test => test.file))];
    const name = selected.length ? exactPattern(selected.map(fullName)) : '(?!)';
    const selectionBlockers = [...(stage === 'canonical' ? blockers.unit : blockers[stage] ?? [])];
    if (stage !== 'canonical') {
      const pattern = new RegExp(name);
      const ids = new Set(selected.map(test => test.id));
      for (const test of cases) if (files.includes(test.file) && !ids.has(test.id) &&
          matchesNodeSelection(test, pattern)) selectionBlockers.push({
        code: 'AMBIGUOUS_CRITICAL_SELECTOR', file: test.file, name: test.name, parents: test.parents,
      });
    }
    return {
      files, name, cases: selected, blockers: selectionBlockers,
      bindings: [],
    };
  };
  return { ...selection('integration'), units: selection('unit'), canonical: selection('canonical'),
    deferredCases, requiredSelectors, metrics, budget: criticalProfileBudget };
}
