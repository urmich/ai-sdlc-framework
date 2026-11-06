import { requireReadinessEvaluation } from './validation-readiness.mjs';
import { canonical, requireThat, text, unsafeSummaryContent } from './core.mjs';

function markdown(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replace(/([\\|`*_[\]()])/gu, '\\$1')
    .replaceAll('\r', '').replaceAll('\n', '<br>');
}
export function renderReadinessReport(evaluation, {
  maxBytes = 900 * 1024, completeReportRef,
} = {}) {
  requireReadinessEvaluation(evaluation);
  requireThat(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 4 * 1024 * 1024,
    'INPUT', 'Invalid readable-report byte budget');
  if (completeReportRef !== undefined) {
    text(completeReportRef, 'complete report reference', 2000);
    requireThat(!unsafeSummaryContent(completeReportRef), 'UNSAFE',
      'Complete report reference contains sensitive data');
  }
  const lines = [
    `# Validation: ${markdown(evaluation.profile)}`,
    '',
    `**${evaluation.status}** - required ${evaluation.counts.required}; passed ${evaluation.counts.passed}; failed ${evaluation.counts.failed}; NotRun ${evaluation.counts.notRun}.`,
    '',
    'Declared assertion bindings are counted separately from physical producer executions.',
    '',
    '| Test | Status | Execution | Assertion bindings | Diagnostics |',
    '| --- | --- | --- | --- | --- |',
  ];
  let bytes = Buffer.byteLength(lines.join('\n'));
  const footer = [
    ...(completeReportRef ? ['', `Complete report: ${markdown(completeReportRef)}`] : []),
    '', evaluation.authority,
  ];
  const reserved = Buffer.byteLength(footer.join('\n')) + 256;
  requireThat(bytes + reserved <= maxBytes, 'CAPACITY',
    'Readable-report budget is too small for its header and evidence reference');
  let omitted = 0;
  const append = line => {
    const size = Buffer.byteLength(line) + 1;
    if (bytes + size > maxBytes - reserved) { omitted++; return; }
    lines.push(line);
    bytes += size;
  };
  for (const test of evaluation.cases) {
    const reasons = test.blockers.map(blocker => blocker.message).join('; ');
    const line = `| ${markdown(test.testId)} | ${test.status} | ${markdown(test.executionId)} | ${test.assertions.length} | ${markdown(reasons)} |`;
    append(line);
  }
  if (evaluation.producerBlockers.length) {
    append('');
    append('## Execution blockers');
    append('');
    for (const blocker of evaluation.producerBlockers) {
      const line = `- ${markdown(blocker.executionId)}: ${markdown(blocker.code)} - ${markdown(blocker.message)}`;
      append(line);
    }
  }
  append('');
  append('## Assertion outcomes');
  append('');
  append('| Test / assertion | Status | Actual selector | Duration (ms) | Diagnostic |');
  append('| --- | --- | --- | --- | --- |');
  for (const test of evaluation.cases) {
    for (const assertion of test.assertions) {
      append(`| ${markdown(test.testId)} / ${markdown(assertion.id)} | ${assertion.status} | ${markdown(canonical(assertion.selector))} | ${assertion.durationMs ?? ''} | ${markdown(assertion.detail ?? '')} |`);
    }
  }
  if (omitted) {
    requireThat(completeReportRef, 'EVIDENCE',
      'A bounded UI excerpt needs the declared complete report reference');
    lines.push('', `Summary omitted ${omitted} lines because of the UI byte limit; no evidence was removed.`);
  }
  lines.push(...footer);
  return `${lines.join('\n')}\n`;
}
