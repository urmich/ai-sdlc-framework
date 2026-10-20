import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, requireThat } from '../src/core.mjs';
import { executeValidationCommand } from './validation-tools.mjs';
import { compileValidationInventory } from './validation-inventory.mjs';

// Historical baseline only; current execution always derives the complete project.
export const calculatorFiles = Object.freeze([
  'test/calculator/test/calculator.test.js', 'test/calculator/test/static-contract.test.js',
]);
export const calculatorCommandArguments = Object.freeze([
  '--test', '--test-reporter=./scripts/pr-calculator-reporter.mjs', ...calculatorFiles,
]);
export const calculatorBaselineCapability = Object.freeze({
  namespace: 'calculator', tests: 11, files: calculatorFiles,
});

function calculatorProject(inventory) {
  const projects = inventory?.independentProjects?.filter(project => project.root === 'test/calculator');
  requireThat(inventory?.complete === true && projects?.length === 1,
    'INVENTORY', 'Calculator execution needs its complete independently compiled project inventory');
  const project = projects[0];
  requireThat(project.files.length > 0 && project.cases.length > 0 &&
    new Set(project.files.map(source => source.file)).size === project.files.length &&
    project.files.every(source => /^[a-f0-9]{64}$/u.test(source.sourceDigest)) &&
    project.cases.every(test => test.parents.length === 0 &&
      project.files.some(source => source.file === test.file && source.sourceDigest === test.sourceDigest)) &&
    new Set(project.cases.map(test => digest([test.file, test.name]))).size === project.cases.length,
  'INVENTORY', 'Calculator declarations require supported flat tests with exact unambiguous file/name identities');
  const patterns = project.command?.slice(2);
  requireThat(project.command?.[0] === 'node' && project.command?.[1] === '--test' &&
    patterns.length > 0 && patterns.every(pattern => !pattern.includes('**') &&
      !/[[\]{}]/u.test(pattern)), 'INVENTORY',
  'Calculator package command needs supported explicit paths or single-directory Node test globs');
  const matchers = patterns.map(pattern => new RegExp('^' + [...pattern].map(character =>
    character === '*' ? '[^/]*' : character === '?' ? '[^/]' :
      character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('') + '$', 'u'));
  const relative = file => path.posix.relative(project.root, file);
  requireThat(project.files.every(source => matchers.some(pattern => pattern.test(relative(source.file)))) &&
    matchers.every(pattern => project.files.some(source => pattern.test(relative(source.file)))),
  'INVENTORY', 'Every declared calculator test file must be selected by its actual package test command');
  return project;
}

export function calculatorProjectFiles(inventory) {
  return calculatorProject(inventory).files.map(source => source.file);
}

export function calculatorSelection(inventory) {
  return calculatorProject(inventory).cases.map(test => ({
    namespace: 'calculator', file: test.file, name: test.name, sourceDigest: test.sourceDigest,
  }));
}

export function calculatorCapability(inventory) {
  return { namespace: 'calculator', tests: calculatorSelection(inventory).length,
    files: calculatorProjectFiles(inventory) };
}

export function calculatorArguments(expected) {
  requireThat(Array.isArray(expected) && expected.length > 0, 'INVENTORY',
    'Calculator selection must contain every independently declared assertion');
  return ['--test', '--test-reporter=./scripts/pr-calculator-reporter.mjs',
    ...new Set(expected.map(test => test.file))];
}

function eventFile(event, expected) {
  const file = event.data?.file?.replaceAll('\\', '/');
  if (typeof file !== 'string') return null;
  const files = [...new Set(expected.map(test => test.file))]
    .filter(selected => file === selected || file.endsWith(`/${selected}`));
  return files.length === 1 ? files[0] : null;
}

export function reconcileCalculator(report, expected, journal) {
  const events = typeof journal === 'string' ? journal.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const terminals = events.filter(event => ['test:pass', 'test:fail'].includes(event?.type));
  return expected.length > 0 && report?.schemaVersion === 1 && report.namespace === 'calculator' &&
    report.complete === true && report.exitCode === 0 &&
    digest(report.command?.slice(1)) === digest(calculatorArguments(expected)) && report.summary?.tests === expected.length &&
    report.summary.passed === expected.length && report.summary.failed === 0 && report.summary.skipped === 0 &&
    report.summary.cancelled === 0 && digest(report.selection) === digest(expected) &&
    report.results?.length === expected.length && terminals.length === expected.length &&
    expected.every(test => report.results.filter(row => row.file === test.file && row.name === test.name &&
      row.status === 'Passed').length === 1 && terminals.filter(event =>
      event.type === 'test:pass' && eventFile(event, expected) === test.file &&
      event.data.name === test.name && !event.data.skip &&
      !event.data.todo && event.data.nesting === 0 &&
      (event.data.details?.type === undefined || event.data.details.type === 'test')).length === 1);
}

export async function runCalculator({ root, output, context = null }) {
  const selectedInventory = await compileValidationInventory(root);
  const selection = calculatorSelection(selectedInventory);
  for (const source of calculatorProject(selectedInventory).files) {
    requireThat(digest(await fs.readFile(path.join(root, ...source.file.split('/')), 'utf8')) === source.sourceDigest,
      'EVIDENCE', 'Calculator execution source differs from its independently compiled selection');
  }
  const args = calculatorArguments(selection);
  const report = { schemaVersion: 1, namespace: 'calculator', node: process.version,
    platform: process.platform, architecture: process.arch, context,
    command: [process.execPath, ...args], selection, results: [],
    summary: { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0 },
    startedAt: new Date().toISOString(), complete: false, exitCode: 2 };
  try {
    const environment = { ...process.env, SDLC_TEST_REPORT_CONTEXT: JSON.stringify(context) };
    delete environment.NODE_TEST_CONTEXT;
    const command = await executeValidationCommand({ name: 'calculator-node-command',
      command: process.execPath, args, cwd: root,
      environment, outputDir: path.dirname(output) });
    await fs.writeFile(`${output}.journal.ndjson`, command.stdout, { flag: 'wx' });
    for (const line of command.stdout.trim().split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      if (!['test:pass', 'test:fail'].includes(event.type) || event.data.nesting !== 0) continue;
      report.results.push({ file: eventFile(event, selection), name: event.data.name,
        status: event.data.skip || event.data.todo ? 'Skipped' : event.type === 'test:pass' ? 'Passed' : 'Failed',
        durationMs: event.data.details?.duration_ms ?? 0 });
    }
    report.summary.tests = report.results.length;
    for (const row of report.results) report.summary[row.status.toLowerCase()]++;
    report.complete = command.complete && command.exitCode === 0 && report.results.length === selection.length;
    report.exitCode = report.complete && report.summary.passed === selection.length ? 0 : 1;
    if (!reconcileCalculator(report, selection, command.stdout)) {
      report.complete = false;
      report.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(output, JSON.stringify(report) + '\n', { flag: 'wx' });
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  requireThat(process.argv.length === 4 && process.argv[2] === '--output', 'INPUT',
    'Usage: node scripts/pr-calculator.mjs --output OWNED_REPORT');
  const report = await runCalculator({ root: path.resolve(import.meta.dirname, '..'),
    output: path.resolve(process.argv[3]), context: JSON.parse(process.env.SDLC_TEST_REPORT_CONTEXT ?? 'null') });
  console.log(`calculator: ${report.summary.passed}/${report.summary.tests} Passed (independent namespace)`);
  process.exitCode = report.exitCode;
}
