import { parseRequirements, parseTestPlan } from '../src/artifacts.mjs';
import { requireThat } from '../src/core.mjs';

export function verifyAcceptance({ requirements, plan, bindings, context, reports = [], gates = [] }) {
  const definitions = parseTestPlan(plan);
  const required = parseRequirements(requirements).filter(item => !item.outOfScope);
  const conditions = [...requirements.matchAll(/^- (AC-\d+\.\d+):/gmu)].map(match => match[1]);
  requireThat(required.length > 0 && new Set(required.map(item => item.id)).size === required.length,
    'COVERAGE', 'Requirements must have distinct stable identities');
  requireThat(new Set(definitions.map(item => item.id)).size === definitions.length &&
    new Set(bindings.map(item => item.id)).size === bindings.length,
  'COVERAGE', 'Duplicate planned or bound test identity');
  requireThat(definitions.length === bindings.length &&
    bindings.every(item => definitions.some(definition => definition.id === item.id)),
  'COVERAGE', 'Every planned case needs exactly one binding; orphan bindings are invalid');
  for (const requirement of required) {
    requireThat(requirement.dod && definitions.some(item => item.requirements.includes(requirement.id)),
      'COVERAGE', `Uncovered requirement ${requirement.id}`);
  }
  for (const condition of conditions) {
    requireThat(definitions.some(item => item.conditions.includes(condition)),
      'COVERAGE', `Uncovered acceptance condition ${condition}`);
  }
  const sameContext = evidence => ['candidateDigest', 'testSpecDigest', 'configDigest']
    .every(key => typeof context[key] === 'string' && context[key].length > 0 &&
      evidence.context?.[key] === context[key]);
  for (const report of reports) {
    requireThat(sameContext(report), 'STALE', 'Execution report belongs to another candidate, specification or configuration');
    requireThat(report.summary?.success === true && report.summary.counts.failed === 0 &&
      report.summary.counts.cancelled === 0 && report.summary.counts.todo === 0 &&
      report.executions.length === report.summary.counts.tests,
    'EVIDENCE', 'Incomplete or unsuccessful suite cannot establish acceptance');
  }
  for (const gate of gates) requireThat(sameContext(gate), 'STALE', 'Gate belongs to another candidate context');
  const cases = definitions.map(definition => {
    const binding = bindings.find(item => item.id === definition.id);
    requireThat(['assertions', 'command', 'review', 'ci', 'live'].includes(binding.kind),
      'COVERAGE', 'Unsupported acceptance binding');
    if (binding.kind !== 'assertions') {
      requireThat(typeof binding.command === 'string' && binding.command.length > 0,
        'COVERAGE', 'A gate or external case needs an exact executable procedure');
      const matches = gates.filter(gate => gate.id === binding.id && gate.command === binding.command);
      requireThat(matches.length <= 1, 'EVIDENCE', 'Ambiguous gate execution');
      const outcome = matches[0];
      return { id: definition.id,
        status: outcome?.status === 'Passed' && outcome.exitCode === 0 &&
          outcome.expectedMet === true ? 'Passed' : outcome?.status === 'Failed' ? 'Failed' : 'NotRun',
        ...(outcome?.evidenceRef ? { evidenceRef: outcome.evidenceRef } : {}) };
    }
    requireThat(Array.isArray(binding.selectors) && binding.selectors.length > 0 &&
      binding.selectors.every(selector => /^test\/[^\\]+\.test\.mjs$/u.test(selector.file) &&
        typeof selector.name === 'string' && selector.name.length > 0),
    'COVERAGE', 'Each assertion needs an exact test file and executable name');
    const lanes = reports.filter(report => binding.selectors.every(selector =>
      report.files.includes(selector.file)));
    const results = lanes.map(report => {
      const executions = binding.selectors.map(selector => {
        const matches = report.executions.filter(item =>
          item.file === selector.file && item.name === selector.name);
        requireThat(matches.length <= 1, 'EVIDENCE', 'Ambiguous named assertion execution');
        return matches[0];
      });
      return { platform: report.platform, architecture: report.architecture,
        status: executions.every(item => item?.status === 'Passed') ? 'Passed' :
          executions.some(item => item?.status === 'Failed') ? 'Failed' : 'NotRun' };
    });
    return { id: definition.id,
      status: results.length && results.every(item => item.status === 'Passed') ? 'Passed' :
        results.some(item => item.status === 'Failed') ? 'Failed' : 'NotRun',
      lanes: results };
  });
  return { requirements: required.length, conditions: new Set(conditions).size,
    planned: definitions.length, bound: bindings.length, cases,
    counts: Object.fromEntries(['Passed', 'Failed', 'NotRun'].map(status =>
      [status, cases.filter(item => item.status === status).length])) };
}
