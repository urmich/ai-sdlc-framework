import { digest, requireThat } from '../src/core.mjs';
import { nativeBootstrapProtocol, nativeUnitBootstrapProtocol, nativeSdkBootstrapProtocol, nativeBootstrapProtocols,
  nativeToolchain, homebrewToolchain } from './toolchain-baseline.mjs';
import { nativeFrameworkShardPlan } from './native-validation.mjs';

function selectedBodyTools({ inventory, plan, target, shard, assignment, shardProtocol }) {
  requireThat(inventory?.complete && typeof plan === 'string', 'INPUT',
    'Body bootstrap requirements need the complete independently selected source inventory and Test Plan');
  const selected = (assignment ?? nativeFrameworkShardPlan({ inventory, plan, target, protocol: shardProtocol }))
    .parts.find(part => part.shard === shard);
  requireThat(selected?.stages?.length > 0, 'INPUT', 'Body bootstrap needs its exact source-selected closure');
  const roots = selected.stages.flatMap(stage => stage.cases)
    .filter(test => !test.parents.length && test.applicability.platforms.includes(target));
  const schema = roots.some(test => test.file === 'test/public-readiness-ci.test.mjs' &&
    test.name === 'T-PRD015 actual pinned Go, Python schema and static validators execute valid and invalid owned inputs');
  const go = schema || roots.some(test => test.file === 'test/winget-launcher-native.test.mjs' && [
    'T-51 native Go launcher preserves paths, streams, arguments, working directory and child exit code',
    'T-51 reproducible launcher builds cannot delegate to an ambient GOCACHEPROG',
  ].includes(test.name));
  // Artifact consumers include stdlib subprocess readers, not schema validation.
  const python = roots.some(test => [
    'test/public-readiness-ci.test.mjs', 'test/public-readiness-consumer.test.mjs',
    'test/public-readiness-observer.test.mjs', 'test/public-readiness-native.test.mjs',
    'test/public-readiness-docs.test.mjs',
  ].includes(test.file));
  return { go, python, schema, homebrew: false, ownedPrefix: false };
}

export function sourceNativeBootstrapProtocol(sourceFiles) {
  const sources = sourceFiles.filter(source => source.file === 'scripts/toolchain-baseline.mjs');
  requireThat(sources.length === 1, 'EVIDENCE', 'Bootstrap capability needs the exact original toolchain source');
  const source = sources[0].contents;
  if (!/\bnativeBootstrapProtocol\b/u.test(source)) return null;
  const declarations = [...source.matchAll(/export const nativeBootstrapProtocol = '([^']+)';/gu)];
  requireThat(declarations.length === 1 && nativeBootstrapProtocols.includes(declarations[0][1]),
    'EVIDENCE', 'Unknown or malformed source-declared native bootstrap capability');
  return declarations[0][1];
}

export function nativeBootstrapCapability({ target, profile, component, shard = null,
  role = `${target}-${component}${shard === null ? '' : `-${shard}`}`, protocol = null,
  inventory, plan, assignment, shardProtocol }) {
  if (protocol === null) return null;
  const mac = ['macos-arm64', 'macos-x64'].includes(target);
  const targets = ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'];
  const shards = ['units', ...(target === 'macos-x64' ? ['units-1'] : []),
    'refresh', ...Array.from({ length: mac ? 3 : 4 }, (_, i) => `body-${i}`)];
  const genuine = protocol === nativeBootstrapProtocol && component === 'homebrew' && mac && shard === null;
  requireThat(nativeBootstrapProtocols.includes(protocol) && targets.includes(target) &&
    profile === 'pr' && (genuine || component === 'framework' && shards.includes(shard)) &&
    role === `${target}-${component}${shard === null ? '' : `-${shard}`}`, 'INPUT',
  'Role-specific bootstrap requires the exact source-selected PR framework producer');
  const light = shard === 'refresh' || shard === 'units' || shard === 'units-1';
  const tools = protocol === nativeBootstrapProtocol ? genuine ?
    { go: false, python: false, schema: false, homebrew: true, ownedPrefix: true } :
    light ? { go: false, python: shard !== 'refresh', schema: false, homebrew: false, ownedPrefix: false } :
      selectedBodyTools({ inventory, plan, target, shard, assignment, shardProtocol }) :
    protocol === nativeUnitBootstrapProtocol ? {
    go: !light, python: shard !== 'refresh', schema: !light,
    homebrew: mac && !light, ownedPrefix: mac && !light,
  } : protocol === nativeSdkBootstrapProtocol ? { go: shard !== 'refresh', python: shard !== 'refresh' } : null;
  return { protocol, target, profile, component, shard, role,
    runtimeProvider: 'actions/setup-node', node: nativeToolchain.node,
    homebrew: mac ? protocol === nativeBootstrapProtocol ? genuine ? 'pinned-native-node-bottles' : 'not-required' :
      protocol === nativeUnitBootstrapProtocol && light ? 'not-required' :
      'pinned-source-and-portable-ruby-without-node' : 'not-applicable',
    ...(tools ? { tools } : {}) };
}

export function nativeSdkRequirements(options) {
  const { protocol = null, component = 'full', shard = null } = options;
  requireThat(protocol === null || nativeBootstrapProtocols.includes(protocol),
    'INPUT', 'SDK requirements need an exact supported source bootstrap protocol');
  if (protocol === null || component !== 'framework' || shard === null) {
    if (protocol !== nativeBootstrapProtocol || component !== 'homebrew' || options.profile !== 'pr') {
      return { go: true, python: true };
    }
  }
  const tools = nativeBootstrapCapability(options).tools;
  return tools ? { go: tools.go, python: tools.python } : { go: true, python: true };
}

export function nativeBootstrapRequirements(options) {
  const { protocol = null, component = 'full', shard = null, target } = options;
  const sdk = nativeSdkRequirements(options);
  if ([nativeUnitBootstrapProtocol, nativeBootstrapProtocol].includes(protocol) &&
    (component === 'framework' && shard !== null ||
      protocol === nativeBootstrapProtocol && component === 'homebrew' && options.profile === 'pr')) {
    return nativeBootstrapCapability(options).tools;
  }
  const mac = ['macos-arm64', 'macos-x64'].includes(target);
  return { ...sdk, schema: sdk.python, homebrew: mac, ownedPrefix: mac };
}

export function nativeSdkContextMatches(toolchain, options) {
  const tools = nativeSdkRequirements(options);
  return (tools.go ? typeof toolchain.go === 'string' &&
    toolchain.go.startsWith(`go version ${nativeToolchain.go} `) : !Object.hasOwn(toolchain, 'go')) &&
    (tools.python ? toolchain.python === `Python ${nativeToolchain.python}` : !Object.hasOwn(toolchain, 'python'));
}

export async function probeNativeSdk(options, run) {
  const tools = nativeSdkRequirements(options);
  const facts = {};
  for (const [tool, command, args] of [
    ['go', process.env.SDLC_GO || 'go', ['version']],
    ['python', process.env.SDLC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['--version']],
  ]) {
    if (!tools[tool]) continue;
    const report = await run({ name: `${tool}-version`, command, args });
    requireThat(report.complete && report.exitCode === 0 && typeof report.stdout === 'string',
      'HOST', 'Required native SDK preflight did not complete');
    facts[tool] = report.stdout.trim();
  }
  requireThat(nativeSdkContextMatches(facts, options), 'HOST', 'Native toolchain baseline differs from the Test Plan');
  return facts;
}

export function bootstrapRequestCapability(options) {
  const fields = ['profile', 'component', 'role',
    ...(options.component === 'homebrew' ? [] : ['shard'])];
  if (!fields.some(field => options[field] !== undefined)) return null;
  requireThat(fields.every(field => typeof options[field] === 'string' && options[field]),
    'INPUT', 'Bootstrap role intent must be complete, never inferred from ambient environment');
  return nativeBootstrapCapability({ ...options, protocol: nativeBootstrapProtocol });
}

export function requireNativeBootstrapCapability({ bootstrap, target, profile, component, shard = null,
  role = `${target}-${component}${shard === null ? '' : `-${shard}`}`, protocol = null, prefix,
  inventory, plan, assignment, shardProtocol }) {
  const options = { target, profile, component, shard, role, protocol, inventory, plan, assignment, shardProtocol };
  const capability = protocol === null || !(component === 'framework' && shard !== null ||
    protocol === nativeBootstrapProtocol && component === 'homebrew' && profile === 'pr') ? null :
    nativeBootstrapCapability(options);
  const native = bootstrap?.native;
  if (capability === null) {
    requireThat(native && !Object.hasOwn(native, 'bootstrapCapability') &&
      !Object.hasOwn(native, 'runtimeProvider'), 'EVIDENCE',
    'Legacy/full bootstrap cannot borrow a role-specific runtime capability');
    return null;
  }
  const platform = target.startsWith('macos-') ? 'darwin' : target === 'windows-x64' ? 'win32' : 'linux';
  const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
  requireThat(native && native.bootstrapCapability && native.runtimeProvider &&
    bootstrap.status === 'Passed' && bootstrap.target === target &&
    digest(native.bootstrapCapability) === digest(capability) &&
    native.node === nativeToolchain.node && native.platform === platform && native.architecture === architecture &&
    digest(native.runtimeProvider) === digest({ provider: capability.runtimeProvider,
      executable: native.executables?.node, version: nativeToolchain.node, platform, architecture }) &&
    typeof native.executables?.node === 'string' && native.executables.node.length > 0,
  'EVIDENCE', 'Actual selected native runtime differs from its independently source-bound bootstrap capability');
  const tools = nativeSdkRequirements(options);
  for (const tool of ['go', 'python']) if (!tools[tool]) {
    requireThat(!Object.hasOwn(native, tool) && !Object.hasOwn(native.executables, tool) &&
      (tool !== 'python' || !Object.hasOwn(native, 'schemaPackages')) &&
      Array.isArray(bootstrap.reports) && !bootstrap.reports.some(report =>
        (tool === 'go' ? /^(?:go-root|go-version)$/u : /^(?:python-|schema-)/u).test(report.name)),
    'EVIDENCE', 'Unused SDK capabilities must be absent, not represented by fabricated tool facts');
  }
  if ([nativeUnitBootstrapProtocol, nativeBootstrapProtocol].includes(protocol)) {
    const resources = nativeBootstrapRequirements(options);
    if (resources.python) requireThat(
      native.python?.version === nativeToolchain.python && native.python.implementation === 'CPython' &&
      typeof native.executables.python === 'string' && native.executables.python.length > 0 &&
      typeof native.python.executable === 'string' &&
      (resources.schema || native.python.executable === native.executables.python) &&
      (architecture === 'arm64' ? ['arm64', 'aarch64'] : ['AMD64', 'x86_64']).includes(native.python.machine) &&
      bootstrap.reports.filter(report => report.name === 'python-identity' &&
        report.complete === true && report.exitCode === 0).length === 1,
    'EVIDENCE', 'Required pinned native CPython runtime identity is missing or invalid');
    if (!resources.schema) requireThat(!Object.hasOwn(native, 'schemaPackages') &&
      !bootstrap.reports.some(report => /^schema-/u.test(report.name)),
    'EVIDENCE', 'Unused schema facts and acquisition reports must be absent');
    if (!resources.homebrew) requireThat(!Object.hasOwn(native, 'homebrew') &&
      !['prefix', 'ownedPrefix', 'ruby', 'allocation', 'cleanup'].some(key => Object.hasOwn(native, key)) &&
      !Object.keys(native.executables).some(key => /brew|ruby|prefix/iu.test(key)) &&
      !bootstrap.reports.some(report => /^brew-/u.test(report.name)) && prefix === undefined,
    'EVIDENCE', 'Prefix-free bootstrap cannot borrow or invent Homebrew, Ruby or prefix evidence');
  }
  if (platform === 'darwin' && nativeBootstrapRequirements(options).homebrew && component === 'framework') {
    const brew = native.homebrew;
    const owned = prefix ?? brew?.prefix;
    requireThat(typeof owned === 'string' && /^\/opt\/[a-f0-9]{5}$/u.test(owned) &&
      brew?.prefix === owned && brew.repository === owned &&
      brew.commit === homebrewToolchain.commit && brew.coreCommit === homebrewToolchain.coreCommit &&
      brew.ruby === homebrewToolchain.ruby &&
      brew.rubyExecutable === `${owned}/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby` &&
      brew.nodeProvisioned === false && brew.bottlesProvisioned === false &&
      !['node', 'nodePrefix', 'bottlePlan', 'bottleReceiptsDigest'].some(key => Object.hasOwn(brew, key)) &&
      !native.executables.node.startsWith(`${owned}/`) &&
      Array.isArray(bootstrap.reports) &&
      ['brew-git-identity', 'brew-prefix', 'brew-repository', 'brew-ruby-identity',
        'brew-ruby-path', 'brew-core-identity'].every(name =>
        bootstrap.reports.filter(report => report.name === name &&
          report.complete === true && report.exitCode === 0).length === 1) &&
      !bootstrap.reports.some(report => /^brew-node-/u.test(report.name)),
    'EVIDENCE', 'Framework bootstrap must retain its own real pinned Brew/Ruby/core without invented Node bottles or runtime');
  }
  if (protocol === nativeBootstrapProtocol && component === 'homebrew') {
    const brew = native.homebrew;
    const owned = prefix ?? brew?.nodePrefix?.replace(/\/opt\/node@24$/u, '');
    requireThat(typeof owned === 'string' && /^\/opt\/[a-f0-9]{5}$/u.test(owned) &&
      brew?.commit === homebrewToolchain.commit && brew.coreCommit === homebrewToolchain.coreCommit &&
      brew.ruby === homebrewToolchain.ruby &&
      brew.rubyExecutable === `${owned}/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby` &&
      digest(brew.node) === digest({ version: nativeToolchain.node, platform: 'darwin', arch: architecture }) &&
      brew.nodePrefix === `${owned}/opt/${homebrewToolchain.formula}` &&
      brew.bottlePlan?.prefix === owned &&
      brew.bottlePlan.nativeTag === (architecture === 'arm64' ? 'arm64_sequoia' : 'sequoia') &&
      /^[a-f0-9]{64}$/u.test(brew.bottleReceiptsDigest ?? '') &&
      ['brew-git-identity', 'brew-prefix', 'brew-repository', 'brew-ruby-identity', 'brew-ruby-path',
        'brew-core-identity', 'brew-node-bottle-plan', 'brew-node-install', 'brew-node-prefix', 'brew-node-identity']
        .every(name => bootstrap.reports.filter(report => report.name === name &&
          report.complete === true && report.exitCode === 0).length === 1),
    'EVIDENCE', 'Genuine Homebrew bootstrap requires its real pinned source, Ruby, core and native Node bottle closure');
  }
  return capability;
}
