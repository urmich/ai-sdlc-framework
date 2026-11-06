import { LIMITS, SdlcError, object, requireThat } from './core.mjs';
import { readBytes, safePath } from './files.mjs';
import { evaluateReadiness, normalizeExecutionReport, readEvidenceBundle,
  validateReadinessData } from './validation-readiness.mjs';
import { renderReadinessReport } from './validation-report.mjs';

function json(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
    throw new SdlcError('EVIDENCE', 'Readiness input requires valid UTF-8 JSON');
  }
}
export async function runReadinessCommand({ subcommand, cwd, input }) {
  requireThat(['evaluate', 'report'].includes(subcommand), 'INPUT', 'Use readiness evaluate|report');
  validateReadinessData(input);
  object(input, ['specification', 'context', 'reports', 'bundle', 'completeReportRef', 'maxBytes'],
    ['specification', 'context']);
  requireThat((input.reports !== undefined) !== (input.bundle !== undefined), 'INPUT',
    'Supply normalized/raw execution reports or one retained bundle');
  let evaluation;
  if (input.bundle) evaluation = readEvidenceBundle(input.bundle, {
    specification: input.specification, context: input.context,
  }).evaluation;
  else {
    requireThat(Array.isArray(input.reports), 'INPUT', 'Supply execution report data');
    const reports = await Promise.all(input.reports.map(async report => {
      let value = report;
      let bytes;
      if (report && Object.hasOwn(report, 'file')) {
        object(report, ['file'], ['file']);
        bytes = await readBytes(await safePath(cwd, report.file), LIMITS.artifact);
        value = json(bytes);
      }
      return value?.kind === 'normalized-execution' ? value :
        normalizeExecutionReport(bytes ?? value, value?.context);
    }));
    evaluation = evaluateReadiness(input.specification, reports, input.context);
  }
  const result = subcommand === 'report' ? {
    evaluation, markdown: renderReadinessReport(evaluation, {
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
      ...(input.completeReportRef !== undefined ? { completeReportRef: input.completeReportRef } : {}),
    }),
  } : evaluation;
  return { result, exitCode: evaluation.exitCode };
}
