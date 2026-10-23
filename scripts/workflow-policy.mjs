import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireThat, SdlcError } from '../src/core.mjs';

export const workflowActionPins = Object.freeze({
  'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/setup-go': '40f1582b2485089dde7abd97c1529aa768e1baff',
  'actions/setup-python': 'a26af69be951a213d495a4c3e4e4022e16d87065',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact': 'd3f86a106a0bac45b974a628896c90dbdf5c8093',
  'actions/attest-build-provenance': '977bb373ede98d70efdf65b84cb5f73e068dcc2a',
});
const read = { contents: 'read' };
const actionsRead = { contents: 'read', actions: 'read' };
const npmPublish = { ...actionsRead, 'id-token': 'write' };
const attest = { ...actionsRead, 'id-token': 'write', attestations: 'write' };
const statusWriter = { ...actionsRead, 'pull-requests': 'read', statuses: 'write' };
export const workflowPermissionPolicies = Object.freeze({
  '.github/workflows/ci.yml': { role: 'producer', workflow: read,
    jobs: { intent: {}, 'minimum-node': read, source: read, 'native-units': read,
      native: read, 'native-units-wx': read, 'native-wx': read,
      'native-units-ma': read, 'native-ma': read, 'native-units-mi': read, 'native-mi': read,
      'native-homebrew': read, 'native-homebrew-mi': read, 'native-mi-refresh': read,
      'native-ma-refresh': read, 'native-mi-retained': read,
      'mac-admission': actionsRead, 'intel-admission': actionsRead,
      'intel-homebrew-admission': actionsRead, 'intel-retained-admission': actionsRead,
      'arm-refresh-admission': actionsRead, 'producer-summary': {} } },
  '.github/workflows/pr-policy-refresh.yml': { role: 'refresh', workflow: {},
    jobs: { refresh: {}, probe: statusWriter }, jobRoles: { probe: 'observer' } },
  '.github/workflows/pr-readiness.yml': { role: 'observer', workflow: statusWriter, jobs: { observe: statusWriter } },
  '.github/workflows/coverage-metadata.yml': { role: 'observer', workflow: statusWriter, jobs: { observe: statusWriter } },
  '.github/workflows/release.yml': { role: 'release', workflow: read, jobs: {
    preflight: { ...actionsRead, statuses: 'read', 'pull-requests': 'read' },
    candidate: actionsRead, 'release-gates': actionsRead, 'release-bundle': attest,
    'draft-assets': { ...actionsRead, contents: 'write' }, 'npm-readiness': actionsRead,
    'npm-handoff': npmPublish, promote: { ...actionsRead, contents: 'write' }, acceptance: actionsRead,
    completion: { ...attest, contents: 'write' },
  } },
  '.github/workflows/npm-publish.yml': { role: 'publisher', workflow: read, jobs: { publish: npmPublish } },
  '.github/workflows/release-acceptance.yml': { role: 'consumer', workflow: actionsRead,
    jobs: { 'anonymous-acceptance': actionsRead } },
});
const scopes = new Set(['actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions',
  'id-token', 'issues', 'models', 'packages', 'pages', 'pull-requests', 'security-events', 'statuses']);
const levels = { none: 0, read: 1, write: 2 };
const workflowEvents = {
  '.github/workflows/ci.yml': ['pull_request', 'push', 'workflow_dispatch'],
  '.github/workflows/pr-policy-refresh.yml': ['pull_request_review', 'workflow_dispatch'],
  '.github/workflows/pr-readiness.yml': ['workflow_run', 'workflow_dispatch'],
  '.github/workflows/coverage-metadata.yml': ['pull_request_target', 'workflow_dispatch'],
  '.github/workflows/release.yml': ['workflow_dispatch'],
  '.github/workflows/npm-publish.yml': ['workflow_call'],
  '.github/workflows/release-acceptance.yml': ['workflow_call'],
};
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const unsafeKey = key => ['__proto__', 'prototype', 'constructor', '<<'].includes(key);
const sourcePath = value => typeof value === 'string' && !/[:\\\u0000-\u001f]/u.test(value) &&
  value.split('/').every(part => part && part !== '.' && part !== '..');

function yamlError(file, line, message) {
  throw new SdlcError('WORKFLOW_YAML', `${file}:${line}: ${message}`);
}
function stripComment(value) {
  let quoted = null;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quoted === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = null;
    } else if (quoted === "'") {
      if (character === "'" && value[index + 1] === "'") index++;
      else if (character === "'") quoted = null;
    } else if (character === '"' || character === "'") quoted = character;
    else if (character === '#' && (index === 0 || /\s/u.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}
function flowParts(value, delimiter, file, line) {
  const parts = [];
  let start = 0;
  let quoted = null;
  let escaped = false;
  const stack = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quoted === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = null;
    } else if (quoted === "'") {
      if (character === "'" && value[index + 1] === "'") index++;
      else if (character === "'") quoted = null;
    } else if (character === '"' || character === "'") quoted = character;
    else if (character === '[' || character === '{') stack.push(character);
    else if (character === ']' || character === '}') {
      const expected = character === ']' ? '[' : '{';
      if (stack.pop() !== expected) yamlError(file, line, 'Unbalanced flow syntax');
    } else if (character === delimiter && !stack.length) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted || stack.length) yamlError(file, line, 'Unsupported multiline or unbalanced scalar');
  parts.push(value.slice(start));
  return parts;
}

// Parse the bounded YAML subset used by the adopted workflows; never evaluate expressions or tags.
export function parseWorkflow({ file, contents }) {
  requireThat(sourcePath(file) && typeof contents === 'string' && Buffer.byteLength(contents) <= 4 * 1024 * 1024,
    'WORKFLOW_YAML', 'Workflow source must be literal bounded text');
  const lines = contents.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  let index = 0;
  let nodes = 0;
  const indentation = line => /^ */u.exec(line)[0].length;
  const content = line => stripComment(line.slice(indentation(line)));
  const skip = () => {
    while (index < lines.length && !content(lines[index]).trim()) index++;
  };
  const key = (value, line) => {
    const selected = scalar(value.trim(), line, 0);
    if (typeof selected !== 'string' || !selected || unsafeKey(selected)) {
      yamlError(file, line, 'Unsupported or unsafe mapping key');
    }
    return selected;
  };
  function scalar(value, line, depth) {
    if (++nodes > 100000 || depth > 32) yamlError(file, line, 'Workflow structure budget exceeded');
    if (!value) return null;
    if (value[0] === '"') {
      try { return JSON.parse(value); }
      catch { yamlError(file, line, 'Unsupported double-quoted scalar'); }
    }
    if (value[0] === "'") {
      if (!/^'(?:[^']|'')*'$/u.test(value)) yamlError(file, line, 'Unbalanced single-quoted scalar');
      return value.slice(1, -1).replaceAll("''", "'");
    }
    if (value[0] === '[') {
      if (!value.endsWith(']')) yamlError(file, line, 'Unsupported multiline flow collection');
      const inner = value.slice(1, -1).trim();
      return inner ? flowParts(inner, ',', file, line).map(item => scalar(item.trim(), line, depth + 1)) : [];
    }
    if (value[0] === '{') {
      if (!value.endsWith('}')) yamlError(file, line, 'Unsupported multiline flow collection');
      const result = {};
      const inner = value.slice(1, -1).trim();
      if (inner) for (const item of flowParts(inner, ',', file, line)) {
        const pair = flowParts(item, ':', file, line);
        if (pair.length !== 2) yamlError(file, line, 'Unsupported flow mapping entry');
        const name = key(pair[0], line);
        if (Object.hasOwn(result, name)) yamlError(file, line, 'Duplicate mapping key');
        result[name] = scalar(pair[1].trim(), line, depth + 1);
      }
      return result;
    }
    if (/^[!&*]|^(?:---|\.\.\.)$/u.test(value)) yamlError(file, line, 'Tags, aliases and multiple documents are unsupported');
    if (value === 'true' || value === 'false') return value === 'true';
    if (value === 'null' || value === '~') return null;
    if (/^-?(?:0|[1-9]\d*)$/u.test(value)) return Number(value);
    return value;
  }
  function pair(value, line) {
    let quoted = null;
    let escaped = false;
    for (let offset = 0; offset < value.length; offset++) {
      const character = value[offset];
      if (quoted === '"') {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = null;
      } else if (quoted === "'") {
        if (character === "'" && value[offset + 1] === "'") offset++;
        else if (character === "'") quoted = null;
      } else if (character === '"' || character === "'") quoted = character;
      else if (character === ':') return [key(value.slice(0, offset), line), value.slice(offset + 1).trim()];
    }
    yamlError(file, line, 'Unsupported mapping or plain continuation');
  }
  function blockValue(value, indent, line, depth) {
    if (/^[>|][+-]?$/u.test(value)) {
      const body = [];
      while (index < lines.length && (!lines[index].trim() || indentation(lines[index]) > indent)) body.push(lines[index++]);
      const nonempty = body.filter(item => item.trim());
      const margin = nonempty.length ? Math.min(...nonempty.map(indentation)) : indent + 2;
      const values = body.map(item => item.slice(Math.min(margin, item.length)));
      let text = value.startsWith('>') ? values.map((item, offset) =>
        item && values[offset + 1] && !/^ /u.test(item) && !/^ /u.test(values[offset + 1]) ? `${item} ` : `${item}\n`).join('') :
        `${values.join('\n')}\n`;
      if (value.endsWith('-')) text = text.trimEnd();
      else if (!value.endsWith('+')) text = `${text.trimEnd()}\n`;
      return text;
    }
    if (/^[>|]/u.test(value)) yamlError(file, line, 'Unsupported block indentation indicator');
    if (value) return scalar(value, line, depth);
    skip();
    return index < lines.length && indentation(lines[index]) > indent ? node(indentation(lines[index]), depth + 1) : null;
  }
  function node(indent, depth) {
    if (depth > 32) yamlError(file, index + 1, 'Workflow nesting budget exceeded');
    skip();
    const sequence = /^-(?: |$)/u.test(content(lines[index] ?? ''));
    const result = sequence ? [] : {};
    while (index < lines.length) {
      skip();
      if (index >= lines.length || indentation(lines[index]) < indent) break;
      if (/^\s*\t/u.test(lines[index]) || indentation(lines[index]) !== indent) {
        yamlError(file, index + 1, 'Unsupported indentation or continuation');
      }
      const line = index + 1;
      const value = content(lines[index]);
      if (sequence) {
        if (!/^-(?: |$)/u.test(value)) yamlError(file, line, 'Mixed mapping and sequence');
        index++;
        const tail = value.slice(1).trimStart();
        if (!tail) {
          skip();
          if (index >= lines.length || indentation(lines[index]) <= indent) yamlError(file, line, 'Empty sequence entry');
          result.push(node(indentation(lines[index]), depth + 1));
        } else if (/^[{[]/u.test(tail) ||
            !/^(?:"(?:\\.|[^"\\])*"|'(?:[^']|'')*'|[^:'"]+):(?:\s|$)/u.test(tail)) {
          result.push(scalar(tail, line, depth + 1));
        } else {
          const entry = {};
          const [name, remainder] = pair(tail, line);
          entry[name] = blockValue(remainder, indent + 2, line, depth + 1);
          skip();
          if (index < lines.length && indentation(lines[index]) > indent) {
            const rest = node(indent + 2, depth + 1);
            if (!plain(rest)) yamlError(file, line, 'Sequence mappings need literal fields');
            for (const [child, field] of Object.entries(rest)) {
              if (Object.hasOwn(entry, child)) yamlError(file, line, 'Duplicate mapping key');
              entry[child] = field;
            }
          }
          result.push(entry);
        }
      } else {
        if (/^-(?: |$)/u.test(value)) yamlError(file, line, 'Mixed mapping and sequence');
        index++;
        const [name, remainder] = pair(value, line);
        if (Object.hasOwn(result, name)) yamlError(file, line, 'Duplicate mapping key');
        result[name] = blockValue(remainder, indent, line, depth + 1);
      }
    }
    return result;
  }
  skip();
  if (index === lines.length) yamlError(file, 1, 'Empty workflow');
  const result = node(indentation(lines[index]), 0);
  skip();
  if (!plain(result) || index !== lines.length) yamlError(file, index + 1, 'Expected one complete workflow mapping');
  return result;
}

function normalizePermissions(value) {
  if (!plain(value)) return null;
  const normalized = {};
  for (const [scope, level] of Object.entries(value)) {
    if (!scopes.has(scope) || !Object.hasOwn(levels, level)) return null;
    if (scope === 'id-token' && level === 'read' || scope === 'models' && level === 'write') return null;
    if (level !== 'none') normalized[scope] = level;
  }
  return normalized;
}
function allowed(grants, policy) {
  return Object.entries(grants).every(([scope, level]) => levels[level] <= (levels[policy[scope]] ?? 0));
}
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return plain(value) ? Object.values(value).flatMap(strings) : [];
}
const privileged = role => ['observer', 'publisher', 'release', 'consumer'].includes(role);

export function inspectWorkflowPolicy(workflows, { permissionPolicies = workflowPermissionPolicies } = {}) {
  requireThat(Array.isArray(workflows) && workflows.length > 0 && workflows.length <= 256 &&
    new Set(workflows.map(item => item.file)).size === workflows.length,
  'WORKFLOW_POLICY', 'Supply the complete distinct workflow/action sources as data');
  const blockers = [];
  const parsed = new Map();
  const add = (file, code, message, extra = {}) => blockers.push({ file, code, message, ...extra });
  for (const source of workflows) {
    try { parsed.set(source.file, { file: source.file, document: parseWorkflow(source), jobs: [] }); }
    catch (error) {
      if (!(error instanceof SdlcError) || error.code !== 'WORKFLOW_YAML') throw error;
      add(source.file, 'UNSUPPORTED_WORKFLOW_YAML', error.message);
    }
  }
  function grants(file, value, fallback, location) {
    if (value === undefined) {
      if (fallback) return { ...fallback };
      add(file, 'UNKNOWN_PERMISSION_DEFAULT', 'Explicit permissions are required; repository defaults are not assumed', { path: location });
      return {};
    }
    const selected = normalizePermissions(value);
    if (!selected) {
      add(file, 'UNSUPPORTED_PERMISSIONS', 'Permissions must be a literal bounded scope/read/write/none mapping', { path: location });
      return {};
    }
    return selected;
  }
  function reference(file, uses, role, current, ancestry, location) {
    if (typeof uses !== 'string') {
      add(file, 'UNSUPPORTED_ACTION_REFERENCE', 'Action/callee references must be literal strings', { path: location });
      return;
    }
    if (privileged(role) && /^actions\/cache(?:\/restore)?@/u.test(uses)) {
      add(file, 'PRIVILEGED_CACHE_RESTORE', 'Privileged jobs must not restore candidate-controlled executable caches', { path: location });
    }
    if (uses.startsWith('./')) {
      const local = uses.slice(2);
      if (!sourcePath(local) || !/^\.github\/(?:actions|workflows)\//u.test(local)) {
        add(file, 'UNSAFE_LOCAL_ACTION', 'Local actions/callees must use literal repository-owned paths', { path: location });
        return;
      }
      const selected = /\.ya?ml$/u.test(local) ? local : [`${local}/action.yml`, `${local}/action.yaml`]
        .find(candidate => parsed.has(candidate));
      if (!selected || !parsed.has(selected)) {
        add(file, 'MISSING_LOCAL_DEPENDENCY', 'Every local action/callee must be present in the inspected graph', { path: location, reference: uses });
        return;
      }
      if (ancestry.includes(selected)) {
        add(file, 'WORKFLOW_REFERENCE_CYCLE', 'Workflow/action references must be acyclic', { path: location });
        return;
      }
      if (role === 'publisher') add(file, 'PUBLISHER_REPOSITORY_EXECUTION',
        'The OIDC publisher may not import or execute repository actions', { path: location });
      visit(selected, current, [...ancestry, selected], role);
      return;
    }
    const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)@([a-f0-9]{40})$/u.exec(uses);
    if (!match) {
      add(file, 'UNPINNED_ACTION', 'Every external action/callee requires an approved immutable commit', { path: location, reference: uses });
    } else if (workflowActionPins[match[1]] !== match[2]) {
      add(file, 'UNAPPROVED_ACTION', 'External action/callee commit is not in the adopted policy', { path: location, reference: uses });
    }
    if (role === 'publisher' && /^actions\/checkout@/u.test(uses)) {
      add(file, 'PUBLISHER_REPOSITORY_EXECUTION', 'The OIDC publisher must not check out repository code', { path: location });
    }
  }
  function steps(file, value, role, current, ancestry, location) {
    if (!Array.isArray(value)) {
      add(file, 'UNSUPPORTED_STEPS', 'Executable jobs/actions need an explicit steps array', { path: location });
      return;
    }
    for (const [index, step] of value.entries()) {
      const at = `${location}[${index}]`;
      if (!plain(step) || Object.hasOwn(step, 'permissions') ||
          (Object.hasOwn(step, 'uses') === Object.hasOwn(step, 'run')) ||
          (Object.hasOwn(step, 'run') && typeof step.run !== 'string')) {
        add(file, 'UNSUPPORTED_STEP', 'A step must select exactly one run/action and cannot redefine token permissions', { path: at });
        continue;
      }
      if (step.uses !== undefined) {
        reference(file, step.uses, role, current, ancestry, `${at}.uses`);
        if (/^actions\/checkout@/u.test(step.uses)) {
          if (step.with?.['persist-credentials'] !== false) add(file, 'PERSISTED_CHECKOUT_CREDENTIALS',
            'Repository checkouts must explicitly disable persisted credentials', { path: at });
          if (role === 'observer' &&
              step.with?.ref !== '${{ github.event.repository.default_branch }}') {
            add(file, 'CANDIDATE_EXECUTION_IN_PRIVILEGED_WORKFLOW',
              'Status writers may check out only the trusted default branch', { path: at });
          }
        }
        if (role === 'observer' && /^actions\/download-artifact@/u.test(step.uses)) {
          add(file, 'EXECUTABLE_HANDOFF_IN_PRIVILEGED_WRITER',
            'Observers must use their bounded data reader, not extract candidate artifact files', { path: at });
        }
      }
      const text = strings(step).join('\n');
      for (const secret of text.matchAll(/\$\{\{\s*secrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[)/gu)) {
        if (secret[1] !== 'GITHUB_TOKEN' || ['producer', 'refresh'].includes(role)) {
          add(file, 'UNAPPROVED_SECRET', 'Referenced action/step secrets exceed their caller role', { path: at });
        }
      }
      if (step.env !== undefined && !plain(step.env)) add(file, 'UNSUPPORTED_ENVIRONMENT',
        'Step environments must be literal name/value mappings', { path: `${at}.env` });
      if (['producer', 'refresh'].includes(role)) for (const [name, value] of Object.entries(step.env ?? {})) {
        if (['HOME', 'USERPROFILE', 'COPILOT_HOME'].includes(name) &&
            (typeof value !== 'string' || !value.includes('.test-data/'))) {
          add(file, 'UNOWNED_INSTALLATION_TARGET', 'Contribution steps cannot select a real installation home',
            { path: `${at}.env.${name}` });
        }
      }
      if (role === 'observer' && /(?:pull_request\.head|workflow_run\.head_sha|(?:import|require)\s*\(?\s*['"]\.\/(?:candidate|artifact))/u.test(text)) {
        add(file, 'CANDIDATE_EXECUTION_IN_PRIVILEGED_WORKFLOW',
          'Privileged observers cannot execute candidate refs or artifact helpers', { path: at });
      }
      if (role === 'publisher' && typeof step.run === 'string' &&
          /(?:\bnode\s+(?!-{1,2})[^\s]+\.m?js\b|(?:from\s*|require\s*\(\s*)['"]\.\.?\/)/u.test(step.run)) {
        add(file, 'PUBLISHER_REPOSITORY_EXECUTION', 'Publisher code must remain inline/data-only apart from pinned tooling', { path: at });
      }
      if (role === 'producer' && typeof step.run === 'string') {
        for (const flag of ['candidate-dir', 'evidence-dir', 'output-dir']) {
          const argument = new RegExp(`--${flag}\\s+["']?([^\\s"']+)`, 'u').exec(step.run)?.[1];
          if (argument && !argument.startsWith('.test-data/')) add(file, 'UNOWNED_INSTALLATION_TARGET',
            'Native producer output/install targets must be owned checkout fixtures', { path: `${at}.run`, flag });
        }
        if (/\b(?:sdlc(?:\.mjs)?\s+(?:install|update|uninstall)|install\.(?:sh|ps1))\b/u.test(step.run) &&
            !/--home\s+["']?\.test-data\//u.test(step.run)) {
          add(file, 'UNOWNED_INSTALLATION_TARGET', 'Direct lifecycle commands require an explicit owned fixture home', { path: at });
        }
      }
    }
  }
  function visit(file, caller, ancestry, callerRole) {
    const selected = parsed.get(file);
    if (!selected) return;
    const document = selected.document;
    if (/^\.github\/actions\//u.test(file)) {
      if (Object.hasOwn(document, 'permissions') || document.runs?.using !== 'composite') {
        add(file, 'UNSUPPORTED_LOCAL_ACTION', 'Only inspected same-source composite actions are supported');
      } else steps(file, document.runs.steps, callerRole, caller, ancestry, 'runs.steps');
      return;
    }
    const policy = permissionPolicies[file];
    if (!policy || !plain(document.jobs)) {
      add(file, 'UNADOPTED_WORKFLOW_ROLE', 'Workflow/job roles must be explicitly adopted');
      return;
    }
    const events = typeof document.on === 'string' ? [document.on] :
      Array.isArray(document.on) ? document.on : plain(document.on) ? Object.keys(document.on) : [];
    if (!events.length || events.some(event => !workflowEvents[file]?.includes(event))) {
      add(file, 'UNSAFE_WORKFLOW_EVENT', 'Workflow triggers must stay within their independently adopted trust boundary', { path: 'on' });
    }
    const { jobs: ignoredJobs, ...rootDocument } = document;
    for (const secret of strings(rootDocument).join('\n').matchAll(/\$\{\{\s*secrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[)/gu)) {
      if (secret[1] !== 'GITHUB_TOKEN' || ['producer', 'refresh'].includes(policy.role)) {
        add(file, 'UNAPPROVED_SECRET', 'This workflow role cannot receive the referenced secret',
          { path: 'secrets', secret: secret[1] ?? 'dynamic' });
      }
    }
    if (['producer', 'refresh'].includes(policy.role)) {
      for (const [location, environment] of [['env', document.env],
        ...Object.entries(document.jobs).filter(([id]) => !policy.jobRoles?.[id])
          .map(([id, job]) => [`jobs.${id}.env`, job?.env])]) {
        if (environment !== undefined && !plain(environment)) add(file, 'UNSUPPORTED_ENVIRONMENT',
          'Contribution environments must be literal name/value mappings', { path: location });
        for (const [name, value] of Object.entries(environment ?? {})) {
          if (['HOME', 'USERPROFILE', 'COPILOT_HOME'].includes(name) &&
              (typeof value !== 'string' || !value.includes('.test-data/'))) {
            add(file, 'UNOWNED_INSTALLATION_TARGET', 'Contribution workflows cannot select a real installation home',
              { path: `${location}.${name}` });
          }
        }
      }
    }
    if (callerRole && ['producer', 'refresh'].includes(callerRole) && privileged(policy.role)) {
      add(file, 'PRODUCER_PRIVILEGED_CALLEE', 'Unprivileged contribution workflows cannot dispatch privileged callees');
    }
    const root = grants(file, document.permissions, caller, 'permissions');
    if (!allowed(root, policy.workflow)) add(file, 'EXCESS_WORKFLOW_PERMISSION',
      'Workflow grants exceed their independently adopted role', { path: 'permissions', actual: root, allowed: policy.workflow });
    if (document.secrets === 'inherit') add(file, 'INHERITED_SECRETS', 'Secret inheritance is not permitted');
    for (const [id, job] of Object.entries(document.jobs)) {
      if (!plain(job) || !Object.hasOwn(policy.jobs, id)) {
        add(file, 'UNADOPTED_JOB_ROLE', 'Every executable job needs an explicit adopted permission role', { jobId: id });
        continue;
      }
      const role = policy.jobRoles?.[id] ?? policy.role;
      if (policy.jobRoles?.[id] && (file !== '.github/workflows/pr-policy-refresh.yml' || id !== 'probe' ||
          job.if !== "${{ github.event_name == 'workflow_dispatch' }}")) {
        add(file, 'UNSCOPED_DISPOSABLE_WRITER', 'The disposable writer is reachable only through explicit workflow_dispatch',
          { jobId: id });
      }
      for (const secret of strings(job).join('\n').matchAll(/\$\{\{\s*secrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[)/gu)) {
        if (secret[1] !== 'GITHUB_TOKEN' || ['producer', 'refresh'].includes(role)) add(file,
          'UNAPPROVED_SECRET', 'Job secrets exceed the independently adopted execution role', { jobId: id });
      }
      const requested = grants(file, job.permissions, root, `jobs.${id}.permissions`);
      const effective = caller ? Object.fromEntries(Object.entries(requested).filter(([scope]) => caller[scope])
        .map(([scope, level]) => [scope, levels[level] <= levels[caller[scope]] ? level : caller[scope]])) : requested;
      if (!allowed(requested, policy.jobs[id])) add(file, 'EXCESS_JOB_PERMISSION',
        'Job grants exceed their independently adopted role', { jobId: id, path: `jobs.${id}.permissions`,
          actual: requested, allowed: policy.jobs[id] });
      if (caller && !allowed(requested, caller)) add(file, 'CALLEE_PERMISSION_ESCALATION',
        'Reusable callees cannot elevate caller token permissions', { jobId: id });
      if (!selected.jobs.some(item => item.id === id)) selected.jobs.push({ id, role,
        effectivePermissions: effective, requestedPermissions: requested });
      if (job.secrets !== undefined) add(file, 'INHERITED_SECRETS', 'Workflow call secrets must not be inherited or forwarded', { jobId: id });
      if (job.container !== undefined || job.services !== undefined) add(file, 'UNSUPPORTED_EXECUTION_ENVIRONMENT',
        'Containers/services require an explicit separate adopted image policy', { jobId: id });
      if (role === 'observer' && (document.concurrency?.group !== 'framework-readiness-status-writer' ||
          document.concurrency?.['cancel-in-progress'] !== false)) {
        add(file, 'STATUS_WRITER_NOT_SERIALIZED', 'All status writers share the non-cancelling global concurrency group', { jobId: id });
      }
      if (job.uses !== undefined) {
        if (job.steps !== undefined) add(file, 'UNSUPPORTED_JOB', 'A reusable-call job cannot also execute steps', { jobId: id });
        reference(file, job.uses, role, effective, ancestry, `jobs.${id}.uses`);
      } else steps(file, job.steps, role, effective, ancestry, `jobs.${id}.steps`);
    }
  }
  const called = new Set();
  for (const { document } of parsed.values()) {
    for (const job of Object.values(document.jobs ?? {})) if (typeof job?.uses === 'string' && job.uses.startsWith('./')) {
      called.add(job.uses.slice(2));
    }
  }
  for (const file of parsed.keys()) if (!called.has(file) && /^\.github\/workflows\//u.test(file)) visit(file, null, [file]);
  for (const file of parsed.keys()) if (/^\.github\/workflows\//u.test(file) &&
      !parsed.get(file).jobs.length && !blockers.some(item => item.file === file)) visit(file, null, [file]);
  return { complete: blockers.length === 0, blockers, workflows: [...parsed.values()] };
}

export function validateWorkflowPolicy(workflows, options) {
  const result = inspectWorkflowPolicy(workflows, options);
  requireThat(result.complete, 'WORKFLOW_POLICY', result.blockers.map(item =>
    `${item.file}:${item.path ?? item.jobId ?? ''}:${item.code}`).join('; '));
  return result;
}

export async function readWorkflowPolicySources(root) {
  const result = [];
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      requireThat(!entry.isSymbolicLink(), 'WORKFLOW_POLICY', 'Workflow graphs cannot traverse linked source');
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (/\.ya?ml$/u.test(entry.name)) result.push({
        file, contents: await fs.readFile(path.join(root, ...file.split('/')), 'utf8'),
      });
    }
  }
  await walk('.github/workflows');
  try { await walk('.github/actions'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  requireThat(process.argv.length === 2, 'INPUT', 'Workflow policy checks accept no untrusted policy override');
  validateWorkflowPolicy(await readWorkflowPolicySources(path.resolve(path.dirname(process.argv[1]), '..')));
}
