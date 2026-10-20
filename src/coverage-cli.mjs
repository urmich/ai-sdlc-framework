import { LIMITS, SdlcError, digest, id, object, requireThat } from './core.mjs';
import { artifactDocumentId, artifactRepositoryId, testSpecificationDigest } from './artifacts.mjs';
import { canonicalPath, readBytes, safePath } from './files.mjs';
import { git } from './git.mjs';
import { sameNativePath } from './platform.mjs';
import { prepareCoverage, renderCoverageSection, replaceCoverageSection, inspectCoverage,
  validateCoverageSourcePath } from './coverage.mjs';

async function loadDocuments(root, values) {
  requireThat(Array.isArray(values) && values.length > 0 && values.length <= 100,
    'COVERAGE', 'Supply canonical document references');
  return Promise.all(values.map(async reference => {
    object(reference, ['artifactId', 'path'], ['path']);
    const relative = validateCoverageSourcePath(reference.path);
    const bytes = await readBytes(await safePath(root, relative), LIMITS.artifact);
    let contents;
    try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      requireThat(false, 'COVERAGE', 'Specification must contain valid UTF-8');
    }
    return { artifactId: reference.artifactId ?? 'default', path: relative, contents };
  }));
}
function sameDefinition(role, left, right) {
  if (role === 'requirements') return digest(left) === digest(right);
  try { return testSpecificationDigest(left) === testSpecificationDigest(right); }
  catch (error) {
    if (!(error instanceof SyntaxError) &&
        !(error instanceof SdlcError && ['JSON', 'ARTIFACT'].includes(error.code))) throw error;
    return false;
  }
}
async function sourceDocument(root, sourceRevision, role, item) {
  const reference = `${sourceRevision}:${item.path}`;
  const objectId = await git(root, ['rev-parse', '--verify', '-q', reference],
    { optional: true });
  if (!objectId) return { document: item, matches: false };
  const [committed, checkout] = await Promise.all([
    git(root, ['show', reference], { trim: false }),
    git(root, ['cat-file', '--filters', reference], { trim: false }),
  ]);
  const matches = sameDefinition(role, checkout, item.contents);
  return { document: matches ? { ...item, contents: committed } : item, matches };
}
async function registeredReferences(store, cwd, flags, input) {
  await store.ready();
  const sessionId = flags.session ?? process.env.SDLC_SESSION_ID;
  const workItemId = flags['work-item'] ?? input.workItemId ??
    (sessionId && (await store.resolve(cwd, sessionId)).workItemId);
  requireThat(workItemId, 'COVERAGE',
    'Supply a bound work item/session or explicit Requirements and Test Plan references');
  const { manifest, metadata } = await store.manifest(workItemId);
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  const selected = input.repositoryId ?? flags.repository;
  const member = metadata.members.find(item =>
    (!selected || item.repositoryId === selected) && sameNativePath(item.root, root));
  requireThat(member, 'BINDING', 'Coverage source must be the selected repository checkout');
  const references = role => {
    const locators = manifest.artifacts.filter(item => item.role === role &&
      artifactRepositoryId(item, manifest) === member.repositoryId);
    requireThat(locators.length > 0 && locators.every(item =>
      item.kind === 'git' && !item.planned && item.digest !== 'pending'),
    'COVERAGE', `PR coverage needs materialized repository ${role} documents`);
    return locators.map(item => ({ artifactId: artifactDocumentId(item), path: item.path }));
  };
  return { root: member.root, repositoryId: member.repositoryId,
    requirements: references('requirements'), testPlans: references('test-plan') };
}
export async function runCoverageCommand(store, { subcommand, cwd, flags, input }) {
  requireThat(['prepare', 'inspect'].includes(subcommand), 'INPUT', 'Use coverage prepare|inspect');
  object(input, ['workItemId', 'repositoryId', 'requirements', 'testPlans', 'body']);
  if (input.repositoryId && flags.repository) requireThat(
    input.repositoryId === flags.repository, 'BINDING', 'Conflicting coverage repository selection');
  const explicit = input.requirements !== undefined || input.testPlans !== undefined;
  requireThat(!explicit || !input.workItemId && !flags['work-item'],
    'COVERAGE', 'Choose registered documents or explicit references, not both');
  const selected = explicit ? {
    root: await canonicalPath(await git(cwd, ['rev-parse', '--show-toplevel'])),
    repositoryId: id(input.repositoryId ?? flags.repository ?? 'primary', 'repository ID'),
    requirements: input.requirements, testPlans: input.testPlans,
  } : await registeredReferences(store, cwd, flags, input);
  const [workingRequirements, workingPlans, sourceRevision] = await Promise.all([
    loadDocuments(selected.root, selected.requirements),
    loadDocuments(selected.root, selected.testPlans),
    git(selected.root, ['rev-parse', 'HEAD']),
  ]);
  const [requirementSources, planSources] = await Promise.all([
    Promise.all(workingRequirements.map(item =>
      sourceDocument(selected.root, sourceRevision, 'requirements', item))),
    Promise.all(workingPlans.map(item =>
      sourceDocument(selected.root, sourceRevision, 'testPlans', item))),
  ]);
  const requirements = requirementSources.map(item => item.document);
  const testPlans = planSources.map(item => item.document);
  const sources = { repositoryId: selected.repositoryId, sourceRevision, requirements, testPlans };
  const metadata = prepareCoverage(sources);
  const section = renderCoverageSection(metadata);
  requireThat(subcommand !== 'inspect' || typeof input.body === 'string',
    'COVERAGE', 'Supply the actual PR description as body data for inspection');
  const result = inspectCoverage({
    ...sources, body: subcommand === 'inspect' ? input.body : section,
  });
  const uncommitted = [...requirementSources, ...planSources]
    .filter(item => !item.matches).map(item => item.document.path);
  if (uncommitted.length) {
    result.complete = false;
    result.diagnostics.push({ code: 'UNCOMMITTED_SPECIFICATION',
      message: 'Selected definitions differ from HEAD; refresh coverage after the authorized commit/push',
      paths: uncommitted });
  }
  result.sourceMatches = uncommitted.length === 0;
  result.authority = 'Declaration only; no test execution, provider write or lifecycle approval';
  if (subcommand === 'prepare') {
    result.section = section;
    if (input.body !== undefined) result.body = replaceCoverageSection(input.body, metadata);
  }
  return { result, exitCode: subcommand === 'inspect' && !result.complete ? 2 : 0 };
}
