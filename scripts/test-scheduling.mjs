import path from 'node:path';
import { digest, requireThat } from '../src/core.mjs';
import { exactPattern, excludingPattern } from './test-profiles.mjs';
import { declarationTokens, matchesNodeSelection, requiredFileWorkers } from './validation-inventory.mjs';

export const validationGroupProtocol = 'isolated-root-ready-pool-v1';

export const measuredFilePriorities = Object.freeze([
  'observation-retention-refresh.test.mjs', 'observation-retention-regression.test.mjs',
  'public-readiness-observer.test.mjs',
  'github-retained-identity-acceptance.test.mjs',
  'validation-catalog.test.mjs',
  'winget-launcher-native.test.mjs',
  'public-readiness-release-report.test.mjs',
  'github-operation-results.unit.test.mjs', 'github-existing-consumer-boundaries.unit.test.mjs',
  'github-consumer-policy.unit.test.mjs', 'github-operation-dispatch.unit.test.mjs',
  'github-consumer-source.unit.test.mjs', 'github-consumer-refresh.unit.test.mjs',
  'github-operation-publication.unit.test.mjs',
  'deployment.test.mjs', 'recovery-gate.test.mjs',
  'normalized-operation-retry.test.mjs', 'workflow.test.mjs',
  'pr-artifact-readiness.test.mjs', 'pr.test.mjs',
  'deployment-staging.test.mjs', 'pr-fork-identity.test.mjs',
  'deployment-revisions.test.mjs', 'pr-publication.test.mjs',
]);
export const validationSchedulingPolicy = Object.freeze({
  schemaVersion: 4, algorithm: 'source-bound-ready-root-v4',
  groupProtocol: validationGroupProtocol,
  priorities: measuredFilePriorities, hints: 'exact-assertion-and-source-digest; no nested double-counting',
  hostedUnits: 'complete-unit-test-files-plus-automated-plan-unit-root-closure',
  targeted: 'preserve-explicit-caller-order',
  budget: Object.freeze({ protocol: 'shared-host-worker-tokens-v2', maxWorkers: 32,
    defaults: 'max(1,min(16,cpu,floor(memory/1GiB)))',
    producerLimit: '2*capacity+1', controlLimit: '2*capacity+1',
    residentLimit: '3*capacity', orchestrationLimit: '4*capacity+2',
    files: 'process-isolated-root-closures; dynamic-shared-ready-pool; minimum-and-exclusive-before-module-setup',
    nested: 'awaited-parent-yield; ancestor-token-loan; restore-before-return' }),
});
const middleSchedulingPolicy = Object.freeze({
  ...validationSchedulingPolicy,
  schemaVersion: 3, algorithm: 'source-bound-ready-root-v3',
  priorities: Object.freeze(measuredFilePriorities.filter(file =>
    !['winget-launcher-native.test.mjs', 'public-readiness-release-report.test.mjs'].includes(file))),
});
const priorSchedulingPolicy = Object.freeze({
  ...middleSchedulingPolicy,
  schemaVersion: 2, algorithm: 'source-bound-ready-root-v2',
  priorities: Object.freeze(middleSchedulingPolicy.priorities.filter(file => file !== 'validation-catalog.test.mjs')),
});
const knownPolicies = new Set([validationSchedulingPolicy, middleSchedulingPolicy, priorSchedulingPolicy]);
export function validationSchedulingPolicyDigest(policy = validationSchedulingPolicy) {
  requireThat(knownPolicies.has(policy), 'EVIDENCE', 'Scheduling policy must be current or independently source-selected');
  return digest(policy);
}

function schedulingDeclarations(source) {
  const names = new Set(['validationGroupProtocol', 'measuredFilePriorities', 'validationSchedulingPolicy']);
  const tokens = declarationTokens(source);
  const found = {};
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (depth === 0 && token.kind === 'identifier' && token.value === 'export' &&
        tokens[index + 1]?.value === 'const' && names.has(tokens[index + 2]?.value)) {
      const name = tokens[index + 2].value;
      requireThat(!Object.hasOwn(found, name) && tokens[index + 3]?.value === '=',
        'EVIDENCE', 'Source scheduling declarations must be unique literal contracts');
      const expression = [];
      let nesting = 0;
      let cursor = index + 4;
      for (; cursor < tokens.length; cursor++) {
        const selected = tokens[cursor];
        if (selected.kind === 'punctuation' && selected.value === ';' && nesting === 0) break;
        expression.push([selected.kind, selected.value]);
        if (selected.kind === 'punctuation' && ['(', '[', '{'].includes(selected.value)) nesting++;
        if (selected.kind === 'punctuation' && [')', ']', '}'].includes(selected.value)) nesting--;
        requireThat(nesting >= 0, 'EVIDENCE', 'Source scheduling declaration is malformed');
      }
      requireThat(cursor < tokens.length && nesting === 0, 'EVIDENCE', 'Source scheduling declaration is incomplete');
      found[name] = expression.filter(([kind, value], position) =>
        !(kind === 'punctuation' && value === ',' &&
          [']', '}'].includes(expression[position + 1]?.[1])));
      index = cursor;
    } else {
      if (token.kind === 'punctuation' && ['(', '[', '{'].includes(token.value)) depth++;
      if (token.kind === 'punctuation' && [')', ']', '}'].includes(token.value)) depth--;
    }
  }
  requireThat(Object.keys(found).length === names.size, 'EVIDENCE', 'Captured scheduling source is missing its literal policy');
  return digest(found);
}

function schedulingContract(policy) {
  const literal = value => typeof value === 'object' ?
    Array.isArray(value) ? `[${value.map(literal).join(',')}]` :
      `{${Object.entries(value).map(([key, entry]) => `${key}:${literal(entry)}`).join(',')}}` :
    JSON.stringify(value);
  const fields = Object.entries(policy).map(([key, value]) =>
    `${key}:${key === 'groupProtocol' ? 'validationGroupProtocol' :
      key === 'priorities' ? 'measuredFilePriorities' :
      key === 'budget' ? `Object.freeze(${literal(value)})` : literal(value)}`).join(',');
  return `export const validationGroupProtocol=${literal(validationGroupProtocol)};
export const measuredFilePriorities=Object.freeze(${literal(policy.priorities)});
export const validationSchedulingPolicy=Object.freeze({${fields}});`;
}

const policyContracts = [...knownPolicies].map(policy => ({
  policy, declarations: schedulingDeclarations(schedulingContract(policy)),
}));

export function sourceValidationSchedulingPolicy(sourceFiles) {
  requireThat(Array.isArray(sourceFiles), 'EVIDENCE', 'Historical scheduling requires captured source records');
  const sources = sourceFiles.filter(source => source.file === 'scripts/test-scheduling.mjs');
  requireThat(sources.length === 1 && typeof sources[0].contents === 'string' &&
    Buffer.byteLength(sources[0].contents) <= 4 * 1024 * 1024,
  'EVIDENCE', 'Historical scheduling requires the exact bounded captured scheduling source');
  const declarations = schedulingDeclarations(sources[0].contents);
  const selected = policyContracts.find(contract => contract.declarations === declarations);
  requireThat(selected, 'EVIDENCE', 'Captured scheduling policy is not an adopted literal version');
  return selected.policy;
}

export function resolveValidationWorkers({ availableParallelism, totalMemoryBytes, requested = null },
  policy = validationSchedulingPolicy) {
  requireThat(Number.isSafeInteger(availableParallelism) && availableParallelism > 0 &&
    Number.isSafeInteger(totalMemoryBytes) && totalMemoryBytes > 0,
  'BUDGET', 'Resolve worker capacity from independently captured actual host resources');
  requireThat(requested === null || requested === undefined ||
    /^[1-9]\d*$/u.test(String(requested)) && Number(requested) <= 32,
  'BUDGET', 'Requested worker capacity must be an integer from 1 to 32');
  const capacity = requested === null || requested === undefined ?
    Math.max(1, Math.min(16, availableParallelism, Math.floor(totalMemoryBytes / (1024 ** 3)))) :
    Number(requested);
  return { workers: capacity, capacity,
    requestedWorkers: requested === null || requested === undefined ? null : String(requested),
    resources: { availableParallelism, totalMemoryBytes },
    policyDigest: validationSchedulingPolicyDigest(policy) };
}

export function allocateValidationWorkers(producers, capacity, minimums = []) {
  requireThat(Number.isInteger(producers) && producers > 0 && producers <= 32 &&
    Number.isInteger(capacity) && capacity > 0 && capacity <= 32,
  'BUDGET', 'Allocate a bounded host budget across independent producers');
  const result = Array.from({ length: producers }, (_, index) =>
    Math.min(capacity, minimums[index] ?? 1));
  requireThat(result.every(value => Number.isInteger(value) && value > 0),
    'BUDGET', 'Each producer has a declared positive minimum allocation');
  let remaining = Math.max(0, capacity - result.reduce((sum, value) => sum + value, 0));
  for (let index = producers - 1; remaining > 0; index = (index + producers - 1) % producers) {
    result[index]++;
    remaining--;
  }
  return result;
}

export function scheduleValidationFiles(inventory, {
  files = inventory.files.map(file => file.file), durations = [], policy = validationSchedulingPolicy,
} = {}) {
  validationSchedulingPolicyDigest(policy);
  requireThat(Array.isArray(files) && new Set(files).size === files.length &&
    files.every(file => inventory.files.some(source => source.file === file)),
  'INVENTORY', 'Schedule each selected declared file exactly once');
  const timings = new Map();
  for (const hint of durations) {
    requireThat(hint && Number.isFinite(hint.durationMs) && hint.durationMs >= 0,
      'INVENTORY', 'Scheduling hints require actual nonnegative durations');
    const assertion = inventory.cases.find(test => test.id === hint.assertionId);
    if (assertion && assertion.sourceDigest === hint.sourceDigest) timings.set(assertion.id, hint.durationMs);
  }
  const duration = file => inventory.cases.filter(test => test.file === file && timings.has(test.id) &&
    !test.parents.some((name, depth) => inventory.cases.some(parent =>
      parent.file === file && parent.name === name && parent.parents.length === depth &&
      parent.parents.every((name, index) => name === test.parents[index]) && timings.has(parent.id))))
    .reduce((sum, test) => sum + timings.get(test.id), 0);
  const ranked = files.map(file => ({ file, durationMs: duration(file),
    priority: policy.priorities.indexOf(path.posix.basename(file.replaceAll('\\', '/'))) }));
  return ranked.sort((left, right) => right.durationMs - left.durationMs ||
    (left.priority < 0 ? policy.priorities.length : left.priority) -
      (right.priority < 0 ? policy.priorities.length : right.priority) ||
    left.file.localeCompare(right.file, 'en')).map(value => value.file);
}

export function validationExecutionGroups(inventory, {
  files = inventory.files.map(file => file.file), pattern, preserveOrder = false,
} = {}) {
  requireThat(Array.isArray(files) && files.length > 0 && new Set(files).size === files.length &&
    files.every(file => inventory.files.some(source => source.file === file)) &&
    new Set(inventory.cases.map(test => test.id)).size === inventory.cases.length,
  'INVENTORY', 'Execution groups require unique adopted files and assertion identities');
  const resourceFiles = (inventory.resourceRequirements ?? []).map(resource => resource.file);
  requireThat(new Set(resourceFiles).size === resourceFiles.length &&
    resourceFiles.every(file => inventory.files.some(source => source.file === file)),
  'INVENTORY', 'Execution resources require unique declared source files');
  const orderedFiles = preserveOrder ? files : scheduleValidationFiles(inventory, { files });
  const selected = pattern === undefined ? null : new RegExp(pattern);
  const roots = inventory.cases.filter(test => !test.parents.length);
  const all = roots.map(root => {
    requireThat(roots.filter(other => other.file === root.file && other.name === root.name).length === 1,
      'INVENTORY', 'Overlapping root selectors cannot be isolated into distinct processes');
    const closure = inventory.cases.filter(test => test.file === root.file &&
      (test.id === root.id || test.parents[0] === root.name));
    const declaration = (inventory.groupDeclarations ?? []).filter(group =>
      group.file === root.file && group.root === root.name);
    requireThat(declaration.length <= 1, 'INVENTORY', 'Duplicate execution group declaration');
    const group = declaration[0] ?? {};
    const cases = closure.filter(test => !selected || matchesNodeSelection(test, selected));
    return {
      id: digest([validationGroupProtocol, root.id, root.sourceDigest]), rootId: root.id, root: root.name,
      file: root.file, sourceDigest: root.sourceDigest,
      assertionIds: cases.map(test => test.id),
      name: cases.length ? exactPattern(cases.map(test => [...test.parents, test.name].join(' '))) : '(?!)',
      minimumSlots: Math.max(group.minimumSlots ?? 1, requiredFileWorkers({
        cases: closure, resources: inventory.resourceRequirements?.find(resource => resource.file === root.file),
      }, pattern)),
      exclusiveResources: group.exclusiveResources ?? [],
      dependencyNames: group.dependsOn ?? [],
    };
  });
  for (const declaration of inventory.groupDeclarations ?? []) requireThat(all.some(group =>
    group.file === declaration.file && group.root === declaration.root),
  'INVENTORY', 'Execution group declaration references an unknown root');
  for (const group of all) {
    requireThat(Number.isInteger(group.minimumSlots) && group.minimumSlots > 0 && group.minimumSlots <= 32 &&
      new Set(group.exclusiveResources).size === group.exclusiveResources.length &&
      group.exclusiveResources.every(resource => typeof resource === 'string' && resource.trim()) &&
      new Set(group.dependencyNames).size === group.dependencyNames.length,
    'INVENTORY', 'Execution groups require bounded slots and unique resources/dependencies');
    group.dependsOn = group.dependencyNames.map(name => {
      const matches = all.filter(other => other.file === group.file && other.root === name);
      requireThat(matches.length === 1 && matches[0].id !== group.id,
        'INVENTORY', 'Execution group has an unknown or self dependency');
      return matches[0].id;
    });
    delete group.dependencyNames;
  }
  const visited = new Set();
  const active = new Set();
  const visit = group => {
    requireThat(!active.has(group.id), 'INVENTORY', 'Execution group dependencies contain a cycle');
    if (visited.has(group.id)) return;
    active.add(group.id);
    group.dependsOn.forEach(id => visit(all.find(other => other.id === id)));
    active.delete(group.id);
    visited.add(group.id);
  };
  all.forEach(visit);
  const groups = orderedFiles.flatMap(file => all.filter(group => group.file === file && group.assertionIds.length));
  const ids = new Set(groups.map(group => group.id));
  requireThat(groups.every(group => group.dependsOn.every(id => ids.has(id))),
    'INVENTORY', 'Selected execution group is missing a prerequisite root; select its dependency explicitly');
  const assertions = groups.flatMap(group => group.assertionIds);
  const expected = inventory.cases.filter(test => files.includes(test.file) &&
    (!selected || matchesNodeSelection(test, selected)));
  requireThat(assertions.length === expected.length && new Set(assertions).size === assertions.length &&
    expected.every(test => assertions.includes(test.id)),
  'INVENTORY', 'Execution groups must partition the exact selected assertion union without overlap or omission');
  return groups;
}

export async function runValidationReadyPool(groups, { concurrency, capacity = concurrency, execute, signal }) {
  requireThat(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 32 &&
    Number.isInteger(capacity) && capacity > 0 && capacity <= 32 &&
    groups.every(group => Number.isInteger(group.minimumSlots) &&
      group.minimumSlots > 0 && group.minimumSlots <= capacity),
    'BUDGET', 'A ready-work pool requires bounded host concurrency');
  const pending = new Map(groups.map(group => [group.id, group]));
  requireThat(pending.size === groups.length && groups.every(group =>
    group.dependsOn.every(id => pending.has(id) && id !== group.id)),
  'INVENTORY', 'Ready-work groups require unique IDs and present nonself dependencies');
  const completed = new Map();
  const running = new Map();
  const resources = new Set();
  let allocated = 0;
  let failure;
  while (pending.size || running.size) {
    for (const [id, group] of pending) {
      if (signal?.aborted || failure || running.size >= concurrency) break;
      if (!group.dependsOn.every(dependency => completed.get(dependency) === 'Passed') ||
          allocated + group.minimumSlots > capacity ||
          group.exclusiveResources.some(resource => resources.has(resource))) continue;
      pending.delete(id);
      allocated += group.minimumSlots;
      group.exclusiveResources.forEach(resource => resources.add(resource));
      running.set(id, Promise.resolve().then(() => execute(group)).then(status => {
        completed.set(id, status);
      }).catch(error => {
        failure ??= error;
        completed.set(id, 'NotRun');
      }).finally(() => {
        allocated -= group.minimumSlots;
        group.exclusiveResources.forEach(resource => resources.delete(resource));
        running.delete(id);
      }));
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  if (failure) throw failure;
  return { completed, notRun: [...pending.values()] };
}

export function validationUnitAssertionIds({ cases, tests, canonicalFiles = [] }) {
  requireThat(Array.isArray(cases) && Array.isArray(tests) && Array.isArray(canonicalFiles),
    'INVENTORY', 'Classify units from declared source cases and canonical Plan definitions');
  const plan = new Map(tests.filter(test => !test.outOfScope && test.mode === 'automated')
    .map(test => [test.id, test]));
  const bySelector = new Map(cases.map(test => [JSON.stringify([test.file, test.parents, test.name]), test]));
  const isUnit = test => /\.unit\.test\.(?:mjs|cjs|js)$/u.test(test.file) ||
    [...test.parents, test.name].some(name => plan.get(name.split(' ')[0])?.level === 'unit') ||
    [test, ...test.parents.map((name, depth) =>
      bySelector.get(JSON.stringify([test.file, test.parents.slice(0, depth), name])))]
      .some(parent => parent?.plannedCases?.some(id => plan.get(id)?.level === 'unit'));
  const unitRoots = new Set(cases.filter(isUnit)
    .map(test => JSON.stringify([test.file, test.parents[0] ?? test.name])));
  return new Set(cases.filter(test => canonicalFiles.includes(test.file) ||
    unitRoots.has(JSON.stringify([test.file, test.parents[0] ?? test.name]))).map(test => test.id));
}

export function hostedValidationSelection({ inventory, tests, canonicalFiles, policy = validationSchedulingPolicy }) {
  requireThat(inventory.complete && Array.isArray(tests) && Array.isArray(canonicalFiles) &&
    new Set(inventory.cases.map(test => test.id)).size === inventory.cases.length &&
    inventory.cases.every(test => inventory.files.some(source => source.file === test.file)),
  'INVENTORY', 'Hosted selection requires the complete unique adopted inventory');
  const cases = inventory.cases;
  const unitIds = validationUnitAssertionIds({ cases, tests, canonicalFiles });
  const canonical = cases.filter(test => canonicalFiles.includes(test.file));
  const units = cases.filter(test => !canonicalFiles.includes(test.file) && unitIds.has(test.id));
  const regression = cases.filter(test => !unitIds.has(test.id));
  const fullName = test => [...test.parents, test.name].join(' ');
  const select = (selected, stage) => {
    const files = scheduleValidationFiles(inventory, { files: [...new Set(selected.map(test => test.file))], policy });
    const name = stage === 'regression' ? excludingPattern([...canonical, ...units].map(fullName)) :
      selected.length ? exactPattern(selected.map(fullName)) : '(?!)';
    const pattern = new RegExp(name);
    const ids = new Set(selected.map(test => test.id));
    const blockers = [];
    if (stage === 'canonical') for (const file of canonicalFiles) {
      if (!files.includes(file)) blockers.push({ code: 'MISSING_CANONICAL_UNIT_FILE', file });
    }
    else for (const test of cases) if (files.includes(test.file) &&
      matchesNodeSelection(test, pattern) !== ids.has(test.id)) blockers.push({
      code: 'AMBIGUOUS_HOSTED_SELECTOR', file: test.file, name: test.name, parents: test.parents,
    });
    return { files, cases: selected, name, blockers,
      args: stage === 'canonical' ? ['unit'] : ['targeted', '--name', name, ...files] };
  };
  const result = { canonical: select(canonical, 'canonical'), units: select(units, 'units'),
    regression: select(regression, 'regression') };
  requireThat(Object.values(result).reduce((count, stage) => count + stage.cases.length, 0) === cases.length,
    'INVENTORY', 'Hosted stages must preserve every assertion exactly once');
  return result;
}
