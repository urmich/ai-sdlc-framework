export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/native-validation.mjs", "scripts/native-toolchain.mjs", "scripts/native-homebrew-prefix.mjs", "scripts/validation-tools.mjs", "scripts/accept-release.mjs", "scripts/homebrew-lifecycle.mjs", "scripts/homebrew-switch.mjs", "packaging/homebrew/switch-state.mjs", "scripts/toolchain-baseline.mjs", "scripts/native-bootstrap-capability.mjs", "scripts/pr-capabilities.mjs", "scripts/pr-calculator.mjs", "scripts/pr-calculator-reporter.mjs", "scripts/native-components.mjs"]}
  ],
  "groups": [
    {"root": "TOOL03 native failure retains exact ambient workspace and lease for unsettled writers without replacing the primary failure",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 prefix cleanup requires bootstrap and native settlement with owned source and role proof",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 public Homebrew caller enrolls before prefix use and retains unsafe or unretained consumer work",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 full lifecycle finalization retains unsettled taps and preserves evidence failure identity",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD061 candidate lifecycle respects Brew link ownership through alias switching and promotion rollback retry",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 switch recovery finalizers retain private unsettled state and reject serialized authority",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 actual native child boundary quarantines a surviving detached writer before outer cleanup",
      "minimumSlots": 4, "exclusiveResources": []}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import { atomicWrite } from '../src/files.mjs';
import { canonical, digest, requireThat, SdlcError } from '../src/core.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, readEvidenceBundle, requireReadinessEvaluation, validateExecutionContext,
  sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { aggregateNativeReadiness, nativeArtifacts, nativeSpecification, nativeGoObservations,
  parseNativeOptions, validateNativeRequest, evaluateNativeExecution,
  finalizeNativeEvidence, writeNativeReadinessBundle, nativeFailureAnnotations, assertGitFreeAncestors,
  nativeResourceFacts, prepareNativeHostFixtures,
  validateNativeSourceDefinitions, validateNativeGroupReport, nativeConfigurationDigest,
  deriveNativeComponentSpecification, writeNativeHomebrewReport,
  nativePrParts, nativeLegacyPrParts, nativeProducerRole,
  nativeFrameworkShardPlan, verifyNativeShardUnitOrder,
  nativeFrameworkShardProtocol, nativeLegacyFrameworkShardProtocol,
  nativePlatformUnitFrameworkShardProtocol, nativeFourBodyFrameworkShardProtocol,
  nativeFrameworkUnitShardNames, nativeStageSelections, nativePrPartsForProtocol } from '../scripts/native-validation.mjs';
import { runNativeValidation } from '../scripts/native-validation.mjs';
import { observerApiFixture } from './readiness-observer-fixture.mjs';
import * as nativePass from '../scripts/native-validation.mjs';
import { sourceValidationSchedulingPolicy, validationSchedulingPolicy } from '../scripts/test-scheduling.mjs';
import { validateBootstrapRequest, bootstrapNativeToolchain, nativeBootstrapEnvironment,
  nativeBootstrapExports, portableRubyBootstrapEnvironment, requireHomebrewBottlePlan,
  requireHomebrewBottleReceipts, homebrewSetupLimits, homebrewBottlePlanSource } from '../scripts/native-toolchain.mjs';
import { cleanupNativeToolchain } from '../scripts/native-toolchain.mjs';
import { reconcileGoExecution, executeValidationCommand, validationCommandArguments } from '../scripts/validation-tools.mjs';
import { repositoryRoot, createPlan, parseOptions, run as runTests } from '../scripts/test-runner.mjs';
import { discoverDeclarations, compileValidationInventory, compileValidationSourceInventory, validationSourcePaths } from '../scripts/validation-inventory.mjs';
import { runCalculator, calculatorFiles, calculatorSelection, calculatorArguments,
  calculatorCommandArguments, reconcileCalculator } from '../scripts/pr-calculator.mjs';
import { fetchPinnedFixture, provisionPrCryptoFixture, prCryptoFixture } from '../scripts/pr-capabilities.mjs';
import { nativeToolchain } from '../scripts/toolchain-baseline.mjs';
import { nativeBootstrapProtocol as nativeCryptoBootstrapProtocol, nativeBodyBootstrapProtocol as nativeBootstrapProtocol,
  nativeUnitBootstrapProtocol, nativeSdkBootstrapProtocol, homebrewToolchain } from '../scripts/toolchain-baseline.mjs';
import { sourceNativeBootstrapProtocol, nativeBootstrapCapability, bootstrapRequestCapability,
  requireNativeBootstrapCapability, nativeSdkRequirements, nativeSdkContextMatches,
  nativeBootstrapRequirements, probeNativeSdk, requireNativeCryptoEnvironment } from '../scripts/native-bootstrap-capability.mjs';
import { nativeComponentSelection } from '../scripts/native-components.mjs';
import { expectedBodySdkRequirements } from './native-sdk-expectations.mjs';
import { acceptRelease, acceptPublicHomebrew, retainConsumerResult } from '../scripts/accept-release.mjs';
import { assertNativeMacHost, runHomebrewCommand } from '../scripts/homebrew-switch.mjs';
import { sanitizeConsumerResultPayload } from '../scripts/consumer-evidence.mjs';
import * as switchState from '../packaging/homebrew/switch-state.mjs';
import * as consumerLifecycle from '../scripts/consumer-lifecycle.mjs';
import { canonical as archiveCanonical } from '../packaging/standalone/archive.mjs';
import { renderChecksums } from '../scripts/package-platforms.mjs';
import { verifyReleaseChecksums } from '../scripts/verify-platform-package.mjs';
import { releaseRepository } from '../scripts/release-bundle.mjs';
import { generateHomebrewFormula } from '../packaging/homebrew/generate-formula.mjs';
import { homebrewFormulaEvidence } from '../packaging/homebrew/evidence.mjs';

async function nativeChildPrefixApi(project, directory, environment, commandProof) {
  const disk = ownedMacFilesystem(directory);
  const stat = value => new Proxy(value, { get(object, key) {
    if (key === 'uid' || key === 'gid') return typeof object.uid === 'bigint' ? 1000n : 1000;
    if (key === 'mode') return typeof object.mode === 'bigint' ? 0o700n : 0o700;
    const member = object[key];
    return typeof member === 'function' ? member.bind(object) : member;
  } });
  const adapted = { ...disk, lstat: async (...args) => stat(await disk.lstat(...args)),
    open: async (file, ...args) => {
      if ((await disk.lstat(file).catch(() => null))?.isDirectory()) return { sync: async () => {}, close: async () => {} };
      const handle = await disk.open(file, ...args);
      return { writeFile: bytes => handle.writeFile(bytes), sync: () => handle.sync(), close: () => handle.close(),
        read: (...values) => handle.read(...values), stat: async (...values) => stat(await handle.stat(...values)) };
    } };
  const source = (await fs.readFile(path.join(project, 'scripts', 'native-homebrew-prefix.mjs'), 'utf8'))
    .replace(/^import[\s\S]*?;\r?$/gmu, '').replace(/^export /gmu, '');
  const context = createContext({ fs: adapted, constants, path, createHash, randomBytes, Buffer, performance,
    canonical: value => canonical(JSON.parse(JSON.stringify(value))),
    digest: value => digest(value && typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.parse(JSON.stringify(value)) : value),
    requireThat, SdlcError, ownedCommandLifetimeProof: commandProof,
    os: { machine: () => 'x86_64', release: () => '24.6.0', hostname: () => 'owned-host' },
    process: { platform: 'darwin', arch: 'x64', pid: process.pid, ppid: process.ppid, env: environment,
      getuid: () => 1000, getgid: () => 1000 }, execFile() {},
    promisify: () => async () => ({ stdout: environment.EXPECTED_SOURCE_COMMIT }) });
  return runInContext(`${source}
requireShortHomebrewPrefix = value => value;
({allocateOwnedDirectory,beginHomebrewPrefixStage,cleanupHomebrewPrefix,productionContext,
  beginHomebrewPrefixChild: typeof beginHomebrewPrefixChild === 'function' ? beginHomebrewPrefixChild : undefined});`, context);
}

test('TOOL03 actual native child boundary quarantines a surviving detached writer before outer cleanup',
  { timeout: 45000 }, async t => {
    for (const mode of ['settled-failure', 'pre-lifecycle-failure', 'controller-exit', 'controller-cancel']) {
      const settledFailure = mode === 'settled-failure' || mode === 'pre-lifecycle-failure';
      const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'tool06-boundary-'));
      const checkout = path.join(directory, 'workspace', 'source');
      const bootstrapDirectory = path.join(checkout, '.test-data', 'bootstrap');
      const nativeDirectory = path.join(checkout, '.test-data', 'native');
      const ambient = path.join(directory, 'ambient');
      const prefix = path.join(directory, 'prefix');
      const control = path.join(directory, 'control');
      const token = randomUUID();
      for (const folder of [bootstrapDirectory, nativeDirectory, ambient, control]) await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(ambient, 'lease'), 'original ambient lease');
      await fs.writeFile(path.join(nativeDirectory, 'lease'), 'original native evidence lease');
      const target = 'macos-x64';
      const role = `${target}-homebrew`;
      const environment = { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_WORKSPACE: path.dirname(checkout), GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'owned/project', GITHUB_REPOSITORY_ID: '1', GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'native_homebrew', RUNNER_NAME: 'owned-runner',
        RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64', GITHUB_WORKFLOW_REF: 'owned/native',
        ImageOS: 'owned', ImageVersion: 'owned', EXPECTED_SOURCE_COMMIT: 'a'.repeat(40),
        EXPECTED_DESCRIPTOR_SHA256: 'b'.repeat(64), EXPECTED_CHECKSUMS_SHA256: 'c'.repeat(64),
        SDLC_NATIVE_TOOLCHAIN_REPORT: path.join(bootstrapDirectory, 'toolchain.json'),
        SDLC_HOMEBREW_PREFIX_PROOF: bootstrapDirectory, SDLC_NATIVE_ROLE: role,
        SDLC_BOUNDARY_PROJECT: repositoryRoot, SDLC_BOUNDARY_DIRECTORY: directory, SDLC_BOUNDARY_MODE: mode,
        SDLC_BOUNDARY_TOKEN: token, SDLC_BOUNDARY_AMBIENT: ambient, SDLC_BOUNDARY_PREFIX: prefix };
      delete environment.SDLC_TEST_REPORT_CONTEXT;
      const api = await nativeChildPrefixApi(repositoryRoot, directory, environment);
      const options = { repositoryRoot: checkout, bootstrapDirectory, target, role, sourceCommit: 'a'.repeat(40), environment };
      const bootstrap = await api.beginHomebrewPrefixStage({ ...options, stage: 'bootstrap' });
      const owner = await api.productionContext(options);
      await api.allocateOwnedDirectory({ ...owner, prefix,
        createDirectory: selected => fs.mkdir(selected), claimDirectory: async () => {} });
      await fs.mkdir(path.join(prefix, 'tap'));
      await fs.writeFile(path.join(prefix, 'lease'), 'original prefix lease');
      await bootstrap.bindAllocation();
      const bootstrapReport = { status: 'Passed', target, native: {
        node: nativeToolchain.node, platform: 'darwin', architecture: 'x64', resources: {} } };
      await fs.writeFile(environment.SDLC_NATIVE_TOOLCHAIN_REPORT, JSON.stringify(bootstrapReport));
      await bootstrap.finish();
      const program = path.join(control, 'controller.mjs');
      const source = `import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';import {createContext,runInContext} from 'node:vm';
import {finished} from 'node:stream/promises';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {setTimeout as pause} from 'node:timers/promises';
import {canonical,digest,requireThat,SdlcError} from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'src', 'core.mjs')).href)};
import {atomicWrite} from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'src', 'files.mjs')).href)};
${ownedMacFilesystem.toString()}
${nativeChildPrefixApi.toString()}
const env=process.env;const directory=env.SDLC_BOUNDARY_DIRECTORY;const control=path.join(directory,'control');
const token=env.SDLC_BOUNDARY_TOKEN;const sourceSha=digest(await fs.readFile(import.meta.filename));
if(process.argv[2]==='writer'){
 const identity={pid:process.pid,parentPid:process.ppid,token,creation:performance.timeOrigin,sourceSha};
 await atomicWrite(path.join(control,'writer-ready.json'),JSON.stringify(identity));
 const deadline=Date.now()+30000;let answered='';
 while(Date.now()<deadline){
  const request=await fs.readFile(path.join(control,'decision.json'),'utf8').then(JSON.parse,e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(request&&request.id!==answered){answered=request.id;await atomicWrite(path.join(control,'ack-'+request.id+'.json'),JSON.stringify({...identity,challenge:request.id}));}
  if(await fs.stat(path.join(control,'release')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))break;
  for(const file of [path.join(env.SDLC_BOUNDARY_AMBIENT,'writer-stream'),path.join(env.SDLC_BOUNDARY_PREFIX,'tap','writer-stream')]){
   await fs.appendFile(file,'owned\\n').catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  await pause(10);
 }
 await atomicWrite(path.join(control,'writer-drained.json'),JSON.stringify(identity));
}else{
 const tools=await fs.readFile(path.join(env.SDLC_BOUNDARY_PROJECT,'scripts','validation-tools.mjs'),'utf8');
 let clock=0;
 const kernel=createContext({Buffer,path,finished,performance:{now:()=>clock},delay:async ms=>{clock+=ms;},
  setTimeout,clearTimeout,processDiagnostic:e=>({code:e.code,message:e.message}),
  process:{platform:'darwin',kill(){throw Object.assign(Error('Absent'),{code:'ESRCH'});}},
  spawn(){const child=Object.assign(new EventEmitter(),{pid:910001,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),unref(){}});
   queueMicrotask(()=>{child.stdout.end('settled failure tail');child.stderr.end('expected failure');child.exitCode=7;child.emit('close',7,null);});return child;}});
 const raw=runInContext(tools.slice(tools.indexOf('export function stopOwnedProcessGroup(')).split('export async function executeValidationCommand(')[0].replace(/^export /gm,'')+
  '\\n({createOwnedCommandRunner,proof:typeof ownedCommandLifetimeProof===\\'function\\'?ownedCommandLifetimeProof:undefined});',kernel);
 const api=await nativeChildPrefixApi(env.SDLC_BOUNDARY_PROJECT,directory,env,raw.proof);
 const child=api.beginHomebrewPrefixChild&&env.SDLC_NATIVE_HOMEBREW_CHILD?
  await api.beginHomebrewPrefixChild({repositoryRoot:path.join(env.GITHUB_WORKSPACE,'source'),bootstrapDirectory:path.dirname(env.SDLC_NATIVE_TOOLCHAIN_REPORT),
   target:'macos-x64',role:env.SDLC_NATIVE_ROLE,sourceCommit:env.EXPECTED_SOURCE_COMMIT,environment:env}):null;
 if(!['settled-failure','pre-lifecycle-failure'].includes(env.SDLC_BOUNDARY_MODE)){
  const writer=spawn(process.execPath,[import.meta.filename,'writer'],{env,stdio:'ignore',detached:true});writer.unref();
  while(!await fs.stat(path.join(control,'writer-ready.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))await pause(10);
  await atomicWrite(path.join(control,'controller-ready.json'),JSON.stringify({pid:process.pid,writerPid:writer.pid,token,sourceSha}));
  if(env.SDLC_BOUNDARY_MODE==='controller-cancel')while(!await fs.stat(path.join(control,'release')).catch(()=>null))await pause(10);
  process.exitCode=73;
 }else{
  const lifetime={cleanupSafe:true};const owned=raw.createOwnedCommandRunner({lifetime});
  if(env.SDLC_BOUNDARY_MODE!=='pre-lifecycle-failure')await owned.run('owned-negative',[]).catch(()=>{});
  const report=path.join(env.SDLC_TEST_EVIDENCE_ROOT,'native-homebrew.json');
  await atomicWrite(report,JSON.stringify({nativeValidation:'Failed',diagnostic:{code:'OWNED_SEMANTIC_FAILURE'}}));
  if(child)await child.finish({lifetime,reportPath:report});
  process.exitCode=1;
 }
}`;
      await fs.writeFile(program, source);
      const programSha = digest(Buffer.from(source));
      const lifetime = { cleanupSafe: true, unsettledCommands: [] };
      let controller;
      let controllerClosed;
      let atDecision;
      const signals = new Map();
      const executionSource = (await fs.readFile(new URL('../scripts/validation-tools.mjs', import.meta.url), 'utf8'))
        .replace(/^import .+;\r?$/gmu, '').replace(/^export /gmu, '').replace(/^const root = .+;\r?$/gmu, '');
      const executorContext = createContext({ Buffer, TextDecoder, URL, path, createHash, digest, SdlcError,
        sanitizeExecutionPayload, atomicWrite, open: fs.open, realpath: fs.realpath, root: checkout,
        setTimeout, clearTimeout, performance, delay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
        process: { platform: 'darwin', arch: 'x64', version: process.version, env: environment,
          kill(pid, signal) {
            assert.equal(pid, -controller.pid, 'Only the held controller group may be addressed');
            if (signal === 'SIGTERM') {
              assert.equal(controller.exitCode, null);
              return controller.kill('SIGTERM');
            }
            assert.equal(signal, 0);
            if (controller.exitCode !== null || controller.signalCode !== null) throw Object.assign(new Error('Absent'), { code: 'ESRCH' });
            return true;
          } },
        spawn(command, args, settings) {
          assert.ok(args.includes('homebrew'), 'The actual native caller must request its existing isolated procedure');
          controller = spawn(command, [program], { ...settings, env: { ...settings.env, SDLC_TEST_EVIDENCE_ROOT: nativeDirectory } });
          controllerClosed = new Promise(resolve => controller.once('close', resolve));
          return controller;
        } });
      const execute = runInContext(`${executionSource}\nexecuteValidationCommand;`, executorContext);
      const candidate = { context: { identity: { sourceCommit: 'a'.repeat(40), descriptorSha256: 'b'.repeat(64),
        checksumsSha256: 'c'.repeat(64) } }, descriptor: {} };
      const context = createContext({ Buffer, path, AbortController,
        digest: value => digest(value && typeof value === 'object' && !Buffer.isBuffer(value) ?
          JSON.parse(JSON.stringify(value)) : value), requireThat, console,
        os: { release: () => 'owned', machine: () => 'x86_64' },
        repositoryRoot: checkout, nativeToolchain, platforms: { [target]: 'darwin' }, locations: { [target]: 'owned' },
        process: { platform: 'darwin', arch: 'x64', pid: process.pid, ppid: process.ppid, execPath: process.execPath,
          versions: { node: nativeToolchain.node }, env: environment,
          on(name, callback) { signals.set(name, callback); },
          off(name) {
            if (name !== 'SIGTERM' || atDecision) return;
            const id = randomUUID();
            if (!settledFailure) {
              const identity = JSON.parse(fsSync.readFileSync(path.join(control, 'writer-ready.json'), 'utf8'));
              const temporary = path.join(control, `decision-${id}.json`);
              fsSync.writeFileSync(temporary, JSON.stringify({ id, token }), { flag: 'wx' });
              fsSync.renameSync(temporary, path.join(control, 'decision.json'));
              const end = Date.now() + 3000;
              let ack;
              while (!ack && Date.now() < end) {
                try { ack = JSON.parse(fsSync.readFileSync(path.join(control, `ack-${id}.json`), 'utf8')); }
                catch (error) { if (error.code !== 'ENOENT') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
              }
              assert.ok(ack, 'The original detached writer must answer at the original cleanup decision, not after a grace period');
              assert.equal(ack.challenge, id); assert.equal(ack.token, token); assert.equal(ack.pid, identity.pid);
              assert.equal(ack.creation, identity.creation); assert.equal(ack.sourceSha, programSha);
              assert.equal(ack.parentPid, controller.pid);
              assert.equal(process.kill(ack.pid, 0), true);
              atDecision = { writer: ack, cleanupSafe: lifetime.cleanupSafe, at: Date.now() };
            } else atDecision = { cleanupSafe: lifetime.cleanupSafe, at: Date.now() };
          } },
        validateNativeRequest: value => value, nativeProducerRole: () => role,
        execute: async (_, args) => ({ stdout: args[0] === 'status' ? '' : 'a'.repeat(40) }),
        literalDirectory: async () => {}, safe: value => value,
        beginHomebrewPrefixStage: api.beginHomebrewPrefixStage,
        assertCommittedNativeInputs: async () => {}, runtimePreflight: async () => {},
        definitionInputs: async () => ({ inventory: {}, plan: {}, stages: [], specification: { profile: 'pr-native-homebrew' } }),
        allocateAmbientDirectory: async () => ({ directory: ambient, dispose: () => fs.rm(ambient, { recursive: true }) }),
        fs, syntheticReleaseContextVariable: 'SDLC_OWNED_FIXTURE', readOptional: async () => bootstrapReport,
        requireNativeBootstrapCapability: () => ({}), requireNativeCryptoEnvironment() {}, nativeResourceFacts: () => ({}),
        writeJson: async (file, value) => fs.writeFile(file, JSON.stringify(value)),
        probeNativeSdk: async () => ({}), nativeConfigurationDigest: () => digest('config'),
        testSpecificationDigest: () => digest('spec'), validationInventoryDigest: () => digest('inventory'),
        validateExecutionContext: value => value, nativeArtifacts: () => [], verifyCandidate: async () => candidate,
        needsSyntheticReleaseFixture: () => false, createNativeObservationCheckpoint: () => async () => {},
        prepareObservedSyntheticReleaseFixture: async () => {}, executeValidationCommand: execute,
        finalizeNativeEvidence: async () => ({ evaluation: { status: 'Failed' }, diagnostics: [], markdown: 'Controlled boundary; native NotRun' }),
        nativeFailureAnnotations: () => [] });
      let pending;
      try {
        const run = runInContext(`(${runNativeValidation.toString()})`, context);
        pending = run({ target, profile: 'pr', candidateDir: path.join(checkout, '.test-data', 'candidate'),
          evidenceDir: nativeDirectory, phase: 'validation', component: 'homebrew', shard: null }, { lifetime });
        pending.catch(() => {});
        if (mode === 'controller-cancel') {
          const deadline = Date.now() + 7000;
          while (!await fs.stat(path.join(control, 'controller-ready.json')).catch(error => {
            if (error.code !== 'ENOENT') throw error; return null;
          })) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
          signals.get('SIGTERM')();
        }
        const result = await pending;
        assert.ok(atDecision);
        assert.equal(result.status, 'Failed');
        t.diagnostic(JSON.stringify({ mode, atOriginalCleanupDecision: atDecision, resourceCleanupSafe: lifetime.cleanupSafe }));
        if (settledFailure) {
          assert.equal(JSON.parse(await fs.readFile(path.join(nativeDirectory, 'native-homebrew.json'), 'utf8'))
            .diagnostic.code, 'OWNED_SEMANTIC_FAILURE');
          assert.equal(atDecision.cleanupSafe, true);
          assert.equal((await api.cleanupHomebrewPrefix({ ...options, run: async () => fs.rmdir(prefix) })).status, 'removed');
          await assert.rejects(fs.stat(ambient), { code: 'ENOENT' });
        } else {
          assert.equal(atDecision.cleanupSafe, false, 'Controller/group completion cannot erase an unknown detached writer');
          assert.equal(await fs.readFile(path.join(ambient, 'lease'), 'utf8'), 'original ambient lease');
          assert.equal(await fs.readFile(path.join(prefix, 'lease'), 'utf8'), 'original prefix lease');
          assert.equal(await fs.readFile(path.join(nativeDirectory, 'lease'), 'utf8'), 'original native evidence lease');
          await fs.access(path.join(prefix, 'tap', 'writer-stream'));
          await assert.rejects(api.cleanupHomebrewPrefix({ ...options, run: async () => fs.rmdir(prefix) }));
        }
      } finally {
        await fs.writeFile(path.join(control, 'release'), token);
        await pending?.catch(() => {});
        await controllerClosed;
        const ready = await fs.readFile(path.join(control, 'writer-ready.json'), 'utf8').then(JSON.parse, error => {
          if (error.code !== 'ENOENT') throw error; return null;
        });
        if (ready) {
          const deadline = Date.now() + 7000;
          while (true) {
            let alive;
            try { alive = process.kill(ready.pid, 0); }
            catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; }
            if (!alive) break;
            assert.ok(Date.now() < deadline, 'Exact owned detached writer must drain through its release barrier');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          const drained = JSON.parse(await fs.readFile(path.join(control, 'writer-drained.json'), 'utf8'));
          assert.equal(drained.pid, ready.pid); assert.equal(drained.creation, ready.creation); assert.equal(drained.token, token);
        }
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      }
    }
  });

async function controlledPublicCommands(mode) {
  let clock = 0;
  const groups = new Map();
  const inputs = [];
  const uncertain = ['throw', 'unsettled', 'forged-fault', 'interrupt', 'throw-and-persist',
    'intel-unsettled', 'root-exit-pipes', 'timeout', 'unknown-stop', 'denied-probe'].includes(mode);
  const outcome = command => command === '/usr/bin/uname' ? { code: 0, stdout: 'x86_64\n', stderr: '' } :
    command === '/usr/sbin/sysctl' ? { code: 1, stdout: '', stderr: 'sysctl: unknown oid sysctl.proc_translated\n' } :
      command === 'owned-negative' ? { code: 7, stdout: 'nonzero tail', stderr: 'expected nonzero\n' } :
        command === 'unsettled-writer' ? { code: 73, stdout: 'original-command-tail', stderr: 'unsettled writer\n' } :
        { code: 0, stdout: 'owned', stderr: '' };
  const legacyContext = createContext({ finished, execute(command) {
    const value = outcome(command);
    const pending = Promise.resolve().then(() => {
      if (value.code) throw Object.assign(new Error('Controlled command failed'), value,
        { code: value.code });
      return { stdout: value.stdout, stderr: value.stderr };
    });
    pending.child = { stdin: new PassThrough() };
    pending.child.stdin.on('data', bytes => inputs.push(bytes.toString()));
    return pending;
  } });
  const legacy = runInContext(`(${runHomebrewCommand.toString()})`, legacyContext);
  const tools = await fs.readFile(new URL('../scripts/validation-tools.mjs', import.meta.url), 'utf8');
  const source = tools.slice(tools.indexOf('export function stopOwnedProcessGroup('))
    .split('export async function executeValidationCommand(')[0].replace(/^export /gmu, '');
  const context = createContext({
    Buffer, path, finished, processDiagnostic: error => ({ code: error.code ?? 'PROCESS_ERROR', message: error.message }),
    performance: { now: () => clock }, delay: async milliseconds => { clock += milliseconds; },
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds };
      if (mode === 'timeout' && milliseconds === 15000) queueMicrotask(callback);
      return timer;
    }, clearTimeout() {},
    process: { platform: 'darwin', kill(pid, signal) {
      const group = groups.get(-pid);
      assert.ok(group, 'Only the original fixture process group may be addressed');
      if (signal === 'SIGTERM') {
        assert.equal(group.child.exitCode, null, 'No late destructive signal after root exit');
        group.child.signalCode = 'SIGTERM';
        queueMicrotask(() => group.child.emit('close', null, 'SIGTERM'));
        return true;
      }
      assert.equal(signal, 0);
      if (group.present && mode === 'denied-probe') throw Object.assign(new Error('Denied'), { code: 'EPERM' });
      if (group.present && mode === 'unknown-stop') return false;
      if (!group.present) throw Object.assign(new Error('Absent'), { code: 'ESRCH' });
      return true;
    } },
    spawn(command, args, options) {
      assert.equal(options.detached, true);
      const value = outcome(command);
      const child = Object.assign(new EventEmitter(), { pid: 810001 + groups.size,
        exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(),
        stdin: new PassThrough(), unref() {} });
      child.stdin.on('data', bytes => inputs.push(bytes.toString()));
      groups.set(child.pid, { child, present: uncertain && command !== '/usr/bin/uname' ||
        mode === 'selected-unsafe' && command === 'unsettled-writer' });
      if (mode !== 'timeout') queueMicrotask(() => {
        child.exitCode = value.code;
        if (mode === 'root-exit-pipes') {
          child.stdout.write(value.stdout); child.stderr.write(value.stderr);
          child.emit('exit', value.code, null);
        } else {
          child.stdout.end(value.stdout); child.stderr.end(value.stderr);
          child.emit('close', value.code, null);
        }
      });
      return child;
    },
  });
  const api = runInContext(`${source}\n({
    createOwnedCommandRunner: typeof createOwnedCommandRunner === 'function' ? createOwnedCommandRunner : undefined
  });`, context);
  return { ...api, legacy, clock: () => clock, inputs };
}

function ownedMacFilesystem(directory) {
  const retry = method => async (...args) => {
    for (let attempt = 0; ; attempt++) {
      try { return await fs[method](...args); }
      catch (error) {
        const owned = [args[0], ...(method === 'rename' ? [args[1]] : [])]
          .every(file => path.relative(directory, file).split(path.sep)[0] !== '..');
        if (process.platform !== 'win32' || !owned || !['EPERM', 'EBUSY'].includes(error.code) || attempt === 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  };
  return { ...fs, rename: retry('rename'), rm: retry('rm'), unlink: retry('unlink') };
}

async function fullLifecycleFixture(directory, mode, { faithfulBrew = false, lifecycleMode = 'public' } = {}) {
  const fs = ownedMacFilesystem(directory);
  const root = path.join(directory, 'source');
  const data = path.join(root, '.test-data');
  const prefix = path.join(data, 'prefix');
  const cellar = path.join(prefix, 'Cellar');
  const nodeKeg = path.join(cellar, homebrewToolchain.formula, homebrewToolchain.node);
  const node = path.join(nodeKeg, 'bin', 'node');
  const brew = path.join(prefix, 'bin', 'brew');
  const destination = path.join(prefix, 'bin', 'sdlc');
  const work = path.join(data, 'lifecycle');
  const home = path.join(work, 'copilot home');
  await fs.mkdir(path.dirname(node), { recursive: true });
  await fs.mkdir(path.dirname(brew), { recursive: true });
  await fs.writeFile(node, 'owned runtime, never executed');
  await fs.writeFile(brew, 'owned brew, never executed');
  const receipt = (version, tap = 'homebrew/core', dependencies = []) => ({
    installed_on_request: false, source: { tap, versions: { stable: version } }, runtime_dependencies: dependencies,
  });
  await fs.writeFile(path.join(nodeKeg, 'INSTALL_RECEIPT.json'), JSON.stringify(receipt(homebrewToolchain.node)));
  const replaceLink = async (file, target) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.symlink(target, file);
  };
  await replaceLink(path.join(prefix, 'opt', homebrewToolchain.formula), nodeKeg);
  const releases = [];
  for (const version of ['1.0.0', '2.0.0']) {
    const selected = path.join(data, `release-${version}`);
    await fs.mkdir(selected);
    const archive = `ai-sdlc-framework-${version}-macos.tar.gz`;
    const archiveBytes = Buffer.from(`owned archive ${version}`);
    const payload = `ai-sdlc-framework-${version}.tgz`;
    const formula = Buffer.from(`class AiSdlcFramework < Formula\n  url "https://github.com/owned/project/releases/download/v${version}/${archive}"\nend\n`);
    const files = [{ filename: archive, kind: 'archive', sha256: digest(archiveBytes), size: archiveBytes.length },
      { filename: payload, kind: 'archive', sha256: digest(Buffer.from(version)), size: version.length },
      { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: digest(formula), size: formula.length }]
      .sort((a, b) => a.filename < b.filename ? -1 : 1);
    const descriptor = { schemaVersion: 1, name: 'ai-sdlc-framework', version, sourceCommit: 'a'.repeat(40),
      payload: { filename: payload, sha256: digest(Buffer.from(version)), inventoryDigest: 'b'.repeat(64) }, files };
    const bytes = Buffer.from(archiveCanonical(descriptor));
    const sums = renderChecksums(descriptor, bytes);
    await fs.writeFile(path.join(selected, 'release-descriptor.json'), bytes);
    await fs.writeFile(path.join(selected, 'SHA256SUMS'), sums);
    await fs.writeFile(path.join(selected, archive), archiveBytes);
    await fs.writeFile(path.join(selected, payload), version);
    await fs.writeFile(path.join(selected, 'ai-sdlc-framework.rb'), formula);
    releases.push({ directory: selected, identity: { version, sourceCommit: descriptor.sourceCommit,
      payloadSha256: descriptor.payload.sha256, descriptorSha256: digest(bytes), checksumsSha256: digest(Buffer.from(sums)) } });
  }
  const kernel = await controlledPublicCommands('selected-unsafe');
  const lifetime = { cleanupSafe: true, unsettledCommands: [] };
  const owned = kernel.createOwnedCommandRunner({ lifetime });
  let primary;
  let primarySnapshot;
  let tapRoot;
  let formulaFile;
  let formulaName;
  let currentVersion = '1.0.0';
  let installedVersion = '1.0.0';
  let evidencePassedAtWrite;
  const brewTrace = [];
  const writeFailure = Object.assign(new Error('Owned evidence ENOSPC'), { code: 'ENOSPC' });
  const hooks = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
    'postToolUseFailure', 'preCompact', 'agentStop', 'sessionEnd'];
  const installHome = async purge => {
    if (purge) await fs.rm(path.join(home, 'sdlc', 'runtime'), { recursive: true, force: true });
    await fs.mkdir(path.join(home, 'sdlc', 'bin'), { recursive: true });
    await fs.mkdir(path.join(home, 'hooks'), { recursive: true });
    const cli = Buffer.from('owned copied cli');
    const routing = Buffer.from(JSON.stringify({ hooks: Object.fromEntries(hooks.map(event => [event, [{
      exec: node, args: [path.join(home, 'sdlc', 'bin', 'sdlc.mjs'),
        ...(event === 'preToolUse' ? ['gate'] : ['hook', event]), '--home', home],
    }]])) }));
    await fs.writeFile(path.join(home, 'sdlc', 'bin', 'sdlc.mjs'), cli);
    await fs.writeFile(path.join(home, 'hooks', 'sdlc.json'), routing);
    await fs.writeFile(path.join(home, 'sdlc', 'install-manifest.json'), JSON.stringify({
      owner: 'ai-sdlc-framework', schemaVersion: 1, version: installedVersion,
      files: { 'sdlc/bin/sdlc.mjs': digest(cli), 'hooks/sdlc.json': digest(routing) },
    }));
  };
  const createKeg = async (version, name = 'ai-sdlc-framework') => {
    const keg = path.join(cellar, name, version);
    if (faithfulBrew && await fs.stat(keg).catch(error => {
      if (error.code !== 'ENOENT') throw error; return null;
    })) return keg;
    await fs.mkdir(path.join(keg, 'bin'), { recursive: true });
    await fs.mkdir(path.join(keg, 'libexec', 'package', 'bin'), { recursive: true });
    await fs.writeFile(path.join(keg, 'bin', 'sdlc'), version);
    await fs.writeFile(path.join(keg, 'libexec', 'package', 'package.json'),
      JSON.stringify({ name: 'ai-sdlc-framework', version }));
    await fs.writeFile(path.join(keg, 'libexec', 'package', 'bin', 'sdlc.mjs'), version);
    await fs.writeFile(path.join(keg, 'INSTALL_RECEIPT.json'), JSON.stringify(receipt(version,
      formulaName.split('/').slice(0, 2).join('/'), [{ full_name: homebrewToolchain.formula, pkg_version: homebrewToolchain.node }])));
    await replaceLink(path.join(prefix, 'opt', name), keg);
    if (!faithfulBrew) await replaceLink(path.join(prefix, 'var', 'homebrew', 'linked', name), keg);
    return keg;
  };
  const runCommand = async (command, args, options = {}) => {
    if (path.basename(command) === 'node') command = await fs.realpath(command);
    const json = value => JSON.stringify(value);
    let stdout = '';
    if (command === '/usr/bin/uname') stdout = 'x86_64';
    else if (command === '/usr/sbin/sysctl') stdout = '0';
    else if (command === 'git') {
      tapRoot = args.at(-1);
      await fs.writeFile(path.join(tapRoot, 'writer-marker'), 'original tap data');
      if (mode.startsWith('git-')) {
        await fs.writeFile(path.join(tapRoot, 'Formula', 'writer-partial.rb'), 'original partial formula');
        try { await owned.run(mode === 'git-unsafe' ? 'unsettled-writer' : 'owned-negative', []); }
        catch (error) {
          primary = error;
          primarySnapshot = { code: error.code, message: error.message, stdout: error.stdout,
            stderr: error.stderr, ownedProcess: error.ownedProcess };
          throw error;
        }
      }
    } else if (command === brew) {
      const selectedFormula = args.find(value => value.startsWith('local/'));
      const selectedName = selectedFormula?.split('/').at(-1);
      const linkBefore = faithfulBrew ? await switchState.linkState(destination) : undefined;
      const trace = { args: [...args], linkBefore };
      if (faithfulBrew) brewTrace.push(trace);
      if (args[0] === '--prefix') stdout = args[1] === undefined ? prefix :
        path.join(prefix, 'opt', args[1].split('/').at(-1));
      else if (args[0] === '--repository') stdout = prefix;
      else if (args[0] === '--cellar') stdout = cellar;
      else if (args[0] === '--version') stdout = 'Homebrew owned fixture';
      else {
        formulaName ??= args.find(value => value.startsWith('local/'));
        if (args[0] === 'style') formulaFile = args[1];
        if (formulaFile) {
          const formula = await fs.readFile(formulaFile, 'utf8');
          currentVersion = (/\/v(\d+\.\d+\.\d+)\//u.exec(formula) ??
            /version "(\d+\.\d+\.\d+)"/u.exec(formula))[1];
        }
        if (args[0] === 'info') stdout = json({ formulae: [{ name: selectedName ?? 'ai-sdlc-framework',
          full_name: selectedFormula ?? formulaName,
          versions: { stable: currentVersion }, revision: 0 }] });
        if (['install', 'upgrade'].includes(args[0])) {
          if (mode.startsWith('install-') || mode === 'command-plus-evidence-failure' ||
              mode === 'switch-upgrade-unsafe' && args[0] === 'upgrade') {
            await fs.writeFile(path.join(tapRoot, 'writer-install'), 'partial install');
            const pending = path.join(cellar, 'ai-sdlc-framework', currentVersion);
            await fs.mkdir(pending, { recursive: true });
            await fs.writeFile(path.join(pending, 'writer-partial'), 'original pending keg');
            if (mode === 'switch-upgrade-unsafe') await createKeg(currentVersion);
            try { await owned.run(mode.includes('unsafe') ? 'unsettled-writer' : 'owned-negative', []); }
            catch (error) {
              primary = error;
              primarySnapshot = { code: error.code, message: error.message, stdout: error.stdout,
                stderr: error.stderr, ownedProcess: error.ownedProcess };
              throw error;
            }
          }
          const keg = await createKeg(currentVersion, faithfulBrew ? selectedName : undefined);
          if (args[0] === 'upgrade') await replaceLink(destination, path.join(keg, 'bin', 'sdlc'));
        }
        if (args[0] === 'link') {
          const name = faithfulBrew ? selectedName : 'ai-sdlc-framework';
          const keg = path.join(cellar, name, currentVersion);
          if (faithfulBrew && linkBefore.kind !== 'absent' &&
              !switchState.ownsLauncher(linkBefore, keg)) {
            trace.refused = true;
            throw Object.assign(new Error('Could not symlink bin/sdlc: existing destination belongs to another formula'), {
              code: 1, stdout: '', stderr: 'Target bin/sdlc already exists. Unlink its owning formula first.',
            });
          }
          await replaceLink(destination, path.join(keg, 'bin', 'sdlc'));
          await replaceLink(path.join(prefix, 'opt', name), keg);
          await replaceLink(path.join(prefix, 'var', 'homebrew', 'linked', name), keg);
        }
        if (args[0] === 'unlink') {
          const opt = path.join(prefix, 'opt', selectedName ?? 'ai-sdlc-framework');
          const keg = faithfulBrew ? await fs.realpath(opt) : undefined;
          if (!faithfulBrew || switchState.ownsLauncher(linkBefore, keg)) {
            await fs.unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
          }
        }
        if (args[0] === 'tab') {
          const file = path.join(nodeKeg, 'INSTALL_RECEIPT.json');
          const value = JSON.parse(await fs.readFile(file, 'utf8'));
          value.installed_on_request = args.includes('--installed-on-request');
          await fs.writeFile(file, json(value));
        }
        if (args[0] === 'uninstall') {
          const name = faithfulBrew ? selectedName : 'ai-sdlc-framework';
          if (faithfulBrew) {
            const keg = await fs.realpath(path.join(prefix, 'opt', name));
            trace.removedLauncherSha256 = digest(await fs.readFile(path.join(keg, 'bin', 'sdlc')));
          }
          const ownsDestination = faithfulBrew && linkBefore.kind === 'link' &&
            path.relative(path.join(cellar, name), linkBefore.absolute).split(path.sep)[0] !== '..';
          await fs.rm(path.join(cellar, name), { recursive: true, force: true });
          for (const file of [...(!faithfulBrew || ownsDestination ? [destination] : []),
            path.join(prefix, 'opt', name), path.join(prefix, 'var', 'homebrew', 'linked', name)]) {
            await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
          }
        }
      }
      if (faithfulBrew) trace.linkAfter = await switchState.linkState(destination);
    } else if (command === node && args[0] === '--version') stdout = `v${homebrewToolchain.node}`;
    else if (command === node && args[0] === '-p') stdout = json({
      ...(args[1].includes('execPath') ? { execPath: node } : {}),
      platform: 'darwin', arch: 'x64', major: homebrewToolchain.major,
    });
    else {
      let cli = args[0] === '--input-type=module' ? args.slice(3) : [...args];
      if (cli[0]?.endsWith('.mjs')) cli = cli.slice(1);
      const action = cli[0];
      if (action === 'install' || action === 'update') {
        if (command !== node) installedVersion = path.basename(path.dirname(path.dirname(command)));
        await installHome(cli.includes('--purge-existing'));
        stdout = json({ installed: true, changedFiles: [] });
      } else if (action === 'doctor') stdout = json({
        installed: true, findings: [], home, frameworkVersion: installedVersion,
      });
      else if (action === 'uninstall') {
        const manifest = JSON.parse(await fs.readFile(path.join(home, 'sdlc', 'install-manifest.json'), 'utf8'));
        const removed = Object.keys(manifest.files);
        for (const file of [...removed, 'sdlc/install-manifest.json']) await fs.unlink(path.join(home, file));
        if (cli.includes('--purge')) await fs.rm(path.join(home, 'sdlc'), { recursive: true });
        stdout = json({ uninstalled: true, removed, preserved: [], purged: cli.includes('--purge') });
      } else if (action === 'hook' || action === 'gate') {
        const event = action === 'gate' ? 'preToolUse' : cli[1];
        const payload = JSON.parse(options.input);
        const sessions = path.join(home, 'sdlc', 'runtime', 'sessions');
        if (['sessionStart', 'preCompact', 'sessionEnd'].includes(event)) {
          const file = path.join(sessions, `${payload.sessionId}.json`);
          const previous = await fs.readFile(file, 'utf8').then(JSON.parse, error => {
            if (error.code !== 'ENOENT') throw error; return null;
          });
          await fs.mkdir(sessions, { recursive: true });
          await fs.writeFile(file, json({ sessionId: payload.sessionId, orientationGeneration: (previous?.orientationGeneration ?? 0) + 1,
            orientationReason: event, acknowledgedToken: null }));
        }
        if (event === 'userPromptSubmitted') {
          const folder = path.join(sessions, payload.sessionId, 'receipts');
          await fs.mkdir(folder, { recursive: true });
          await fs.writeFile(path.join(folder, 'receipt.json'), json({ sessionId: payload.sessionId, source: event }));
        }
        stdout = json(event === 'sessionStart' ? { additionalContext: 'AI SDLC lifecycle stages are advisory.' } : {});
      } else throw new Error(`Unexpected controlled command: ${command} ${args}`);
    }
    const observed = await owned.run('controlled-brew', [], { input: options.input ?? '' });
    return { ...observed, stdout, stderr: '' };
  };
  const strip = source => source.replace(/^import[\s\S]*?;\r?$/gmu, '')
    .replace(/^export /gmu, '').split("if (process.argv[1]")[0];
  const stateSource = strip(await fs.readFile(new URL('../packaging/homebrew/switch-state.mjs', import.meta.url), 'utf8'));
  const stateContext = createContext({ fs, constants, path, createHash, randomUUID, isDeepStrictEqual, Buffer, process });
  const actualState = runInContext(`${stateSource}\n({advanceSwitchState,captureSwitchState,findInstalledKeg,
    finishSwitchState,linkState,ownsLauncher,resolveHomebrewCandidate,restoreCapturedUpgradeLinks,verifyCapturedKegs});`, stateContext);
  const switchSource = strip(await fs.readFile(new URL('../scripts/homebrew-switch.mjs', import.meta.url), 'utf8'));
  const switchContext = createContext({ ...actualState, fs, path, assert, randomUUID, finished,
    process: { platform: 'darwin', arch: 'x64', env: {} }, createOwnedCommandRunner: kernel.createOwnedCommandRunner,
    promisify: () => () => { throw new Error('Uncontrolled process invocation'); }, execFile() {},
    ...consumerLifecycle });
  const switching = runInContext(`${switchSource}\n({switchToHomebrew,switchFromHomebrew,assertNativeMacHost,verifyCopiedHomebrewInstallation,runHomebrewCommand});`, switchContext);
  const lifecycleSource = strip(await fs.readFile(new URL('../scripts/homebrew-lifecycle.mjs', import.meta.url), 'utf8'))
    .replace(/^const ROOT = .+;\r?$/gmu, '');
  const lifeContext = createContext({ ...switching, ...consumerLifecycle, fs: { ...fs, writeFile: async (file, ...args) => {
    if (path.basename(file) === 'evidence.json') {
      evidencePassedAtWrite = JSON.parse(args[0]).passed;
      if (mode.includes('evidence-failure')) throw writeFailure;
    }
    return fs.writeFile(file, ...args);
  } }, path, assert, Buffer, createHash, randomUUID, validationCommandArguments, verifyReleaseChecksums,
    nativeToolchain, homebrewToolchain, releaseRepository, ROOT: root,
    createOwnedCommandRunner: kernel.createOwnedCommandRunner, processDiagnostic: error => ({ code: error.code, message: error.message }),
    process: { platform: 'darwin', arch: 'x64', version: process.version, env: {}, hrtime: process.hrtime },
    createServer() {
      assert.equal(faithfulBrew, true, 'Network not allowed');
      return Object.assign(new EventEmitter(), {
        listen(port, host, ready) { assert.equal(port, 0); assert.equal(host, '127.0.0.1'); ready(); },
        address: () => ({ port: 12345 }), close: done => done(),
      });
    },
    fetch: async url => {
      assert.equal(faithfulBrew, true, 'Network not allowed');
      assert.match(url, /^http:\/\/127\.0\.0\.1:12345\/ai-sdlc-framework-1\.0\.0-macos\.tar\.gz$/u);
      return { status: 200 };
    },
    generateHomebrewFormula: faithfulBrew ? generateHomebrewFormula :
      () => { throw new Error('Public test cannot provision a generator'); },
    homebrewFormulaEvidence,
  });
  const life = runInContext(`${lifecycleSource}\nverifyHomebrewLifecycle;`, lifeContext);
  return { work, home, prefix, node, destination, brewTrace, get tapRoot() { return tapRoot; }, get primary() { return primary; },
    get originalFailure() { return primarySnapshot; }, get evidencePassedAtWrite() { return evidencePassedAtWrite; }, writeFailure,
    run: () => life({ brew, root: work, candidateDirectory: releases[0].directory, upgradeDirectory: releases[1].directory,
      mode: lifecycleMode, targetArch: 'x64', expectedPreviousIdentity: releases[0].identity, expectedCurrentIdentity: releases[1].identity,
      expectedPreviousRepository: 'owned/project', expectedCurrentRepository: 'owned/project',
      environment: {}, runCommand, processSettlement: mode === 'missing-guard' ? undefined :
        mode === 'json-guard' ? { isSettled: true } : owned.isSettled }) };
}

test('T-PRD061 candidate lifecycle respects Brew link ownership through alias switching and promotion rollback retry',
  async t => {
    for (const lifecycleMode of ['candidate', 'public']) {
      const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'brew-link-owner-'));
      let fixture;
      try {
        fixture = await fullLifecycleFixture(directory, 'success', { faithfulBrew: true, lifecycleMode });
        const foreignTarget = path.join(directory, 'unrelated-launcher');
        const foreignLink = path.join(fixture.prefix, 'bin', 'unrelated-tool');
        await fs.writeFile(foreignTarget, 'unrelated owned fixture bytes');
        await fs.symlink(foreignTarget, foreignLink);
        const originalRuntime = digest(await fs.readFile(fixture.node));
        const result = await fixture.run();
        assert.equal(result.passed, true);
        assert.equal(result.failedPromotionRetry.passed, true);
        assert.equal(result.failedPromotionRetry.candidateVersion, '2.0.0');
        assert.equal(result.publicAcceptance, lifecycleMode === 'public' ? 'Passed' : 'NotRun');
        assert.equal(fixture.brewTrace.some(entry => entry.refused), false);
        assert.equal(fixture.brewTrace.some(entry => entry.args.includes('--overwrite')), false);
        const aliasInstall = fixture.brewTrace.findIndex(entry => entry.args[0] === 'install' &&
          entry.args.at(-1).endsWith('/ai-sdlc-framework-previous'));
        if (lifecycleMode === 'candidate') {
          assert.ok(aliasInstall >= 0);
          const installed = fixture.brewTrace[aliasInstall];
          assert.ok(installed.args.includes('--skip-link'));
          assert.equal(installed.linkBefore.kind, 'link', 'The settled negative control must restore the current launcher');
          assert.match(installed.linkBefore.absolute, /ai-sdlc-framework[/\\]1\.0\.0[/\\]bin[/\\]sdlc$/u);
          assert.deepEqual(installed.linkAfter, installed.linkBefore, 'Skip-link install must not replace the current link');
          const aliasLink = fixture.brewTrace.findIndex((entry, index) => index > aliasInstall &&
            entry.args[0] === 'link' && entry.args.at(-1).endsWith('/ai-sdlc-framework-previous'));
          assert.ok(aliasLink > aliasInstall);
          assert.equal(fixture.brewTrace[aliasLink].linkBefore.kind, 'absent');
          assert.match(fixture.brewTrace[aliasLink].linkAfter.absolute, /ai-sdlc-framework-previous[/\\]1\.0\.0[/\\]bin[/\\]sdlc$/u);
          const aliasRemoval = fixture.brewTrace.find(entry => entry.args[0] === 'uninstall' &&
            entry.args.at(-1).endsWith('/ai-sdlc-framework-previous'));
          assert.match(aliasRemoval.linkAfter.absolute, /ai-sdlc-framework[/\\]1\.0\.0[/\\]bin[/\\]sdlc$/u);
          assert.equal(aliasRemoval.removedLauncherSha256, digest(Buffer.from('1.0.0')),
            'The old alias payload must survive until verified forward switching permits removal');
        } else assert.equal(aliasInstall, -1);
        const injected = result.commands.filter(entry => entry.faultInjected);
        assert.equal(injected.length, 1);
        assert.equal(injected[0].success, false, 'The deliberate promotion negative control must still fail');
        const recoveryRoot = path.join(fixture.prefix, 'var', 'ai-sdlc-framework-switch');
        const states = await Promise.all((await fs.readdir(recoveryRoot)).map(async name =>
          JSON.parse(await fs.readFile(path.join(recoveryRoot, name, 'state.json'), 'utf8'))));
        const failed = states.find(state => state.requestedCandidate?.pkgVersion === '2.0.0' &&
          !state.postSwitchVerified);
        assert.ok(failed, 'Keep the actual failed-promotion recovery record');
        assert.equal(failed.capturedLink.absolute, path.join(result.failedPromotionRetry.priorKeg, 'bin', 'sdlc'));
        const capturedPrior = failed.kegs.find(keg => keg.path === result.failedPromotionRetry.priorKeg);
        assert.equal(capturedPrior.files.find(file => file.path === path.join('bin', 'sdlc')).sha256,
          digest(Buffer.from('1.0.0')));
        const retried = states.find(state => state.postSwitchVerified && state.requestedCandidate?.pkgVersion === '2.0.0');
        assert.equal(retried.requestedCandidate.keg, result.failedPromotionRetry.candidateKeg);
        assert.equal(retried.capturedLink.absolute, failed.capturedLink.absolute);
        assert.equal(retried.retentionVerifiedBeforePromotion, true);
        assert.equal(retried.oldPackageCleanupAllowed, true);
        assert.equal(fixture.brewTrace.filter(entry => entry.args[0] === 'upgrade').length, 1,
          'Retry must reuse the retained candidate, not repeat the semantic upgrade');
        assert.equal((await switchState.linkState(fixture.destination)).kind, 'absent');
        assert.equal(await fs.readlink(foreignLink), foreignTarget);
        assert.equal(await fs.readFile(foreignLink, 'utf8'), 'unrelated owned fixture bytes');
        assert.equal(digest(await fs.readFile(fixture.node)), originalRuntime);
        const runtimeReceipt = JSON.parse(await fs.readFile(path.join(path.dirname(path.dirname(fixture.node)),
          'INSTALL_RECEIPT.json'), 'utf8'));
        assert.equal(runtimeReceipt.installed_on_request, true);
        assert.equal(await fs.readFile(path.join(fixture.home, 'copilot-instructions.md'), 'utf8'),
          'Unrelated user instructions.\n');
        await assert.rejects(fs.access(path.join(recoveryRoot, 'active.lock')), { code: 'ENOENT' });
        t.diagnostic(JSON.stringify({ lifecycleMode, actualLifecycleAndSwitch: true, realFilesystemLinks: true,
          controlledDarwinAndCommands: true, genuineNative: false, promotionFailureAndRetry: true }));
      } catch (error) {
        t.diagnostic(JSON.stringify({ lifecycleMode, genuineNative: false,
          refusedLinks: fixture?.brewTrace.filter(entry => entry.refused) }));
        throw error;
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  });

test('TOOL03 full lifecycle finalization retains unsettled taps and preserves evidence failure identity', async t => {
  const failures = [];
  for (const mode of ['git-unsafe', 'install-unsafe', 'install-unsafe-evidence-failure', 'switch-upgrade-unsafe', 'git-safe', 'install-safe',
    'command-plus-evidence-failure', 'success-evidence-failure', 'success', 'missing-guard', 'json-guard']) {
    const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'tool05-life-'));
    try {
      const fixture = await fullLifecycleFixture(directory, mode);
      const result = await fixture.run().then(value => ({ value }), error => ({ error }));
      if (['missing-guard', 'json-guard'].includes(mode)) {
        assert.equal(result.error?.name, 'TypeError');
        assert.equal(fixture.tapRoot, undefined, 'Missing in-process authority must fail before prefix work');
        t.diagnostic(JSON.stringify({ mode, actualFullLifecycle: true, prefixUseRejected: true }));
        continue;
      }
      if (mode === 'success' || mode === 'success-evidence-failure') {
        if (mode === 'success') {
          assert.equal(result.error, undefined);
          assert.equal(result.value.passed, true);
          assert.equal(result.value.failedPromotionRetry.passed, true);
        } else {
          assert.equal(fixture.evidencePassedAtWrite, true,
            `The full successful body must reach evidence finalization: ${result.error?.stack}`);
          assert.equal(result.error, fixture.writeFailure);
        }
      } else {
        assert.equal(result.error, fixture.primary, 'Evidence finalization must preserve the original process failure object');
        assert.ok(fixture.primary?.ownedProcess);
        for (const field of ['code', 'message', 'stdout', 'stderr', 'ownedProcess']) {
          assert.equal(result.error[field], fixture.originalFailure[field], `Original ${field} must be preserved`);
        }
        if (mode.includes('evidence-failure')) assert.equal(result.error.evidenceRetentionError, fixture.writeFailure);
      }
      if (mode.includes('unsafe')) {
        assert.equal(await fs.readFile(path.join(fixture.tapRoot, 'writer-marker'), 'utf8'), 'original tap data');
        await fs.access(path.join(fixture.tapRoot, 'Formula'));
        if (mode.startsWith('git-')) {
          assert.equal(await fs.readFile(path.join(fixture.tapRoot, 'Formula', 'writer-partial.rb'), 'utf8'), 'original partial formula');
        } else {
          assert.equal(await fs.readFile(path.join(fixture.tapRoot, 'writer-install'), 'utf8'), 'partial install');
          await fs.access(path.join(fixture.tapRoot, 'Formula', 'ai-sdlc-framework.rb'));
          const keg = path.join(fixture.prefix, 'Cellar', 'ai-sdlc-framework',
            mode === 'switch-upgrade-unsafe' ? '2.0.0' : '1.0.0');
          assert.equal(await fs.readFile(path.join(keg, 'writer-partial'), 'utf8'), 'original pending keg');
        }
        if (mode === 'switch-upgrade-unsafe') {
          const lock = JSON.parse(await fs.readFile(path.join(fixture.prefix, 'var', 'ai-sdlc-framework-switch', 'active.lock'), 'utf8'));
          await fs.access(path.join(lock.root, 'kegs'));
          assert.equal(await fs.realpath(path.join(fixture.prefix, 'opt', 'ai-sdlc-framework')),
            path.join(fixture.prefix, 'Cellar', 'ai-sdlc-framework', '2.0.0'));
        }
        if (mode.includes('evidence-failure')) await assert.rejects(fs.stat(path.join(fixture.work, 'evidence.json')), { code: 'ENOENT' });
        else assert.equal(JSON.parse(await fs.readFile(path.join(fixture.work, 'evidence.json'), 'utf8')).passed, false);
      } else await assert.rejects(fs.stat(fixture.tapRoot), { code: 'ENOENT' });
      t.diagnostic(JSON.stringify({ mode, actualFullLifecycle: true, retained: mode.includes('unsafe') }));
    } catch (error) {
      failures.push({ mode, message: error.message });
      t.diagnostic(JSON.stringify({ mode, actualFullLifecycleFailure: error.message }));
    }
    finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
  }
  assert.deepEqual(failures, []);
});

test('TOOL03 switch recovery finalizers retain private unsettled state and reject serialized authority', async t => {
  const failures = [];
  for (const mode of ['capture-unsafe', 'finish-unsafe', 'safe-rollback', 'safe-complete', 'serialized-copy']) {
    const root = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'tool05-switch-'));
    try {
      const prefix = path.join(root, 'prefix');
      const cellar = path.join(prefix, 'Cellar');
      const keg = path.join(cellar, 'ai-sdlc-framework', '1.0.0');
      await fs.mkdir(keg, { recursive: true });
      await fs.writeFile(path.join(keg, 'payload'), 'original payload');
      await fs.writeFile(path.join(keg, 'INSTALL_RECEIPT.json'), JSON.stringify({
        source: { tap: 'homebrew/core' }, runtime_dependencies: [],
      }));
      const kernel = await controlledPublicCommands('selected-unsafe');
      const owned = kernel.createOwnedCommandRunner({ lifetime: { cleanupSafe: true } });
      await owned.run('controlled-brew', []);
      let primary;
      const runBrew = async () => {
        try { await owned.run(mode === 'capture-unsafe' ? 'unsettled-writer' : 'controlled-brew', []); }
        catch (error) { primary = error; throw error; }
        return { stdout: keg };
      };
      const captured = await switchState.captureSwitchState({ prefix, cellar, formula: 'ai-sdlc-framework',
        runBrew, processSettlement: owned.isSettled }).then(value => ({ value }), error => ({ error }));
      const lock = path.join(prefix, 'var', 'ai-sdlc-framework-switch', 'active.lock');
      if (mode === 'capture-unsafe') {
        assert.equal(captured.error, primary);
        assert.equal(primary.switchRecovery.lock, lock);
        await fs.access(lock);
      } else {
        const state = captured.value;
        assert.ok(state, captured.error?.stack);
        const backup = path.join(state.kegs[0].backup, 'payload');
        if (mode !== 'safe-complete') await fs.rm(keg, { recursive: true });
        if (mode === 'finish-unsafe') {
          await owned.run('unsettled-writer', []).catch(error => { primary = error; });
        } else if (mode === 'safe-rollback') {
          await owned.run('owned-negative', []).catch(error => { primary = error; });
        }
        const outcome = await switchState.finishSwitchState(mode === 'serialized-copy' ?
          JSON.parse(JSON.stringify(state)) : state, { error: primary }).then(value => ({ value }), error => ({ error }));
        if (['finish-unsafe', 'serialized-copy'].includes(mode)) {
          assert.ok(outcome.error);
          if (primary) assert.equal(outcome.error, primary);
          assert.equal(outcome.error.switchRecovery.lock, lock);
          assert.equal(await fs.readFile(backup, 'utf8'), 'original payload');
          await fs.access(lock);
          await assert.rejects(fs.stat(keg), { code: 'ENOENT' });
        } else {
          if (mode === 'safe-rollback') {
            assert.equal(outcome.error.code, 'HOMEBREW_SWITCH_FAILED');
            assert.equal(outcome.error.cause, primary);
            assert.equal(await fs.readFile(path.join(keg, 'payload'), 'utf8'), 'original payload');
          } else assert.equal(outcome.error, undefined);
          await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
          await assert.rejects(fs.stat(backup), { code: 'ENOENT' });
        }
      }
      t.diagnostic(JSON.stringify({ mode, actualSwitchState: true }));
    } catch (error) { failures.push({ mode, message: error.message }); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
  }
  assert.deepEqual(failures, []);
});

test('TOOL03 public Homebrew caller enrolls before prefix use and retains unsafe or unretained consumer work',
  { timeout: 60000 }, async t => {
    const failures = [];
    const jsonValue = value => value && typeof value === 'object' && !Buffer.isBuffer(value) ?
      JSON.parse(JSON.stringify(value)) : value;
    const vmDigest = value => digest(jsonValue(value));
    const prefixSource = (await fs.readFile(new URL('../scripts/native-homebrew-prefix.mjs', import.meta.url), 'utf8'))
      .replace(/^import .+;\r?$/gmu, '').replace(/^export /gmu, '');
    const lifecycleSource = await fs.readFile(new URL('../scripts/homebrew-lifecycle.mjs', import.meta.url), 'utf8');
    const collector = lifecycleSource.slice(lifecycleSource.indexOf('  const run = async (command, args, options = {}) => {'),
      lifecycleSource.indexOf('  const runBrew = args => run(brew, args);'));
    for (const mode of ['success', 'throw', 'unsettled', 'forged-fault', 'interrupt', 'missing-report', 'corrupt-report',
      'persist-failure', 'misbound-report', 'throw-and-persist', 'production-root', 'intel-probe', 'nonzero-settled',
      'semantic-failure-settled', 'stdin-and-tail', 'intel-unsettled', 'root-exit-pipes', 'timeout', 'cancelled', 'unknown-stop', 'denied-probe']) {
      const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'tool03-public-prefix-'));
      const workspace = path.join(directory, 'workspace');
      const checkout = path.join(workspace, 'source');
      const bootstrapDirectory = path.join(checkout, '.test-data', 'bootstrap');
      const prefix = path.join(directory, 'prefix');
      await fs.mkdir(bootstrapDirectory, { recursive: true });
      const target = 'macos-x64';
      const revision = 'a'.repeat(40);
      const owner = { repositoryRoot: checkout, bootstrapDirectory, prefix,
        createDirectory: selected => fs.mkdir(selected, { mode: 0o700 }), claimDirectory: async () => {} };
      // Adapt host/stat capabilities, not production context construction or its canonical-path guards.
      const ownedStat = stat => new Proxy(stat, { get(value, key) {
        if (key === 'uid' || key === 'gid') return typeof value.uid === 'bigint' ? 1000n : 1000;
        if (key === 'mode') return typeof value.mode === 'bigint' ? 0o700n : 0o700;
        const member = value[key];
        return typeof member === 'function' ? member.bind(value) : member;
      } });
      const nativeFs = { ...fs, lstat: async (...args) => ownedStat(await fs.lstat(...args)),
        open: async (file, ...args) => {
          if ((await fs.lstat(file).catch(() => null))?.isDirectory()) return { sync: async () => {}, close: async () => {} };
          const handle = await fs.open(file, ...args);
          return { writeFile: bytes => handle.writeFile(bytes), sync: () => handle.sync(), close: () => handle.close(),
            read: (...values) => handle.read(...values), stat: async (...values) => ownedStat(await handle.stat(...values)) };
        } };
      const prefixContext = createContext({ fs: nativeFs, constants, path, randomBytes,
        os: { machine: () => 'x86_64', release: () => '24.6.0', hostname: () => 'owned-host' },
        canonical: value => canonical(jsonValue(value)), digest: vmDigest, requireThat,
        SdlcError, Buffer, process: { platform: 'darwin', arch: 'x64', getuid: () => 1000, getgid: () => 1000 },
        owner, execFile() {},
        promisify: () => async () => ({ stdout: revision }) });
      const api = runInContext(`${prefixSource}
requireShortHomebrewPrefix = value => value;
({allocateOwnedDirectory,cleanupHomebrewPrefix,beginHomebrewPrefixStage,productionContext});`, prefixContext);
      const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_REPOSITORY: 'owned/repository', GITHUB_REPOSITORY_ID: '1',
        GITHUB_WORKFLOW_REF: 'owned/acceptance', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1',
        GITHUB_WORKSPACE: workspace, GITHUB_SERVER_URL: 'https://github.com', GITHUB_JOB: 'public_prefix',
        RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64', RUNNER_NAME: 'owned-runner',
        ImageOS: 'owned', ImageVersion: 'owned', EXPECTED_SOURCE_COMMIT: revision,
        SDLC_NATIVE_TOOLCHAIN_REPORT: path.join(bootstrapDirectory, 'toolchain.json'),
        SDLC_HOMEBREW_PREFIX_PROOF: bootstrapDirectory,
        SDLC_HOMEBREW_BREW: path.join(prefix, 'bin', 'brew') };
      const stageOptions = { repositoryRoot: checkout, bootstrapDirectory, target, role: target,
        sourceCommit: revision, environment };
      owner.binding = (await api.productionContext(stageOptions)).binding;
      const bootstrap = await api.beginHomebrewPrefixStage({ ...stageOptions, stage: 'bootstrap' });
      await api.allocateOwnedDirectory(owner);
      await fs.writeFile(path.join(prefix, 'lease'), 'owned public prefix');
      await fs.mkdir(path.join(prefix, 'bin'));
      await fs.writeFile(environment.SDLC_HOMEBREW_BREW, 'owned executable fixture', { mode: 0o700 });
      await bootstrap.bindAllocation();
      await fs.writeFile(environment.SDLC_NATIVE_TOOLCHAIN_REPORT,
        JSON.stringify({ status: 'Passed', target, native: {} }));
      await bootstrap.finish();
      const outputFile = path.join(checkout, '.test-data', 'consumer.json');
      const consumerRoot = path.join(checkout, '.test-data', 'release-acceptance-owned');
      const bundle = { identity: { sourceCommit: revision, version: '2.0.0', payloadSha256: 'b'.repeat(64) },
        releaseIntentId: 'owned-release', releaseRepository: 'owned/current',
        descriptor: { name: 'owned-framework', payload: { filename: 'current.tgz' },
          files: [{ kind: 'homebrew', filename: 'ai-sdlc-framework.rb', size: 7, sha256: digest(Buffer.from('formula')) }] },
        context: { prerelease: false, previousRelease: { repository: 'owned/previous' } } };
      const previous = { identity: { version: '1.0.0', payloadSha256: 'c'.repeat(64) },
        directory: path.join(checkout, '.test-data', 'previous'),
        descriptor: { payload: { filename: 'previous.tgz' },
          files: [{ kind: 'homebrew', filename: 'ai-sdlc-framework.rb', sha256: 'e'.repeat(64) }] } };
      const primary = Object.assign(new Error('Owned public consumer stopped'), { code: 'OWNED_CONSUMER' });
      const persistence = Object.assign(new Error('Owned consumer report could not be retained'), { code: 'OWNED_RETENTION' });
      let pendingWasDurable = false;
      let release;
      let entered;
      const ready = new Promise(resolve => { entered = resolve; });
      let flow;
      let outcome;
      const commands = await controlledPublicCommands(mode);
      const productionRoot = fileURLToPath(new URL('../', pathToFileURL(path.join(checkout, 'scripts', 'release-bundle.mjs'))));
      const cleanup = () => api.cleanupHomebrewPrefix({ ...stageOptions,
        run: async () => fs.rmdir(prefix) });
      const context = createContext({
        fs, path, Buffer, assert, ROOT: mode === 'production-root' ? productionRoot : checkout,
        nativeToolchain, suffixes: { [target]: 'MI' },
        randomUUID: () => 'owned', process: { platform: 'darwin', arch: 'x64',
          versions: { node: nativeToolchain.node }, execPath: process.execPath, env: environment,
          stdout: { write() {} }, stderr: { write() {} } },
        canonical: value => canonical(jsonValue(value)), digest: vmDigest, requireThat,
        sanitizeExecutionPayload, sanitizeConsumerResultPayload,
        blocked: message => Object.assign(new Error(message), { code: 'RELEASE_INTEGRATION_BLOCKED' }),
        verifyBundle: async () => bundle, requirePublicationReady() {}, runtimePreflight: async () => {},
        assertNativeMacHost: async () => ({ uname: 'x86_64', translated: '0' }),
        downloadPublicAssets: async (_, selected) => {
          await fs.mkdir(selected);
          await fs.writeFile(path.join(selected, 'ai-sdlc-framework.rb'), 'formula');
        },
        requireSupportedPrevious: () => ({ repository: 'owned/previous' }),
        downloadPreviousRelease: async () => {
          await fs.mkdir(previous.directory);
          await fs.writeFile(path.join(previous.directory, 'previous.tgz'), 'previous');
          return previous;
        },
        verifyHomebrewUpgradeInputs: async () => {}, payloadIdentity() {},
        boundedReadback: action => action(), registryPackage: async (_, version) => ({ version }),
        verifyRegistryPayload: async metadata => Buffer.from(metadata.version === '1.0.0' ? 'previous' : 'current'),
        pinnedNpmTool: async () => ({}), verifyPublishedProvenance: async () => ({ status: 'Passed' }),
        verifyNpmConsumer: async () => ({ status: 'Passed' }),
        verifyStandaloneConsumer: async () => ({ status: 'Passed' }),
        execute: async () => { throw new Error('Unexpected real command transport'); },
        beginHomebrewPrefixStage: api.beginHomebrewPrefixStage,
        createOwnedCommandRunner: commands.createOwnedCommandRunner,
        nativeToolchain, sha256: bytes => digest(bytes),
        verifyHomebrewLifecycle: async options => {
          assert.equal(options.expectedCurrentRepository, 'owned/current');
          assert.equal(options.expectedPreviousRepository, 'owned/previous');
          const names = (await fs.readdir(bootstrapDirectory))
            .filter(name => name.startsWith('native-homebrew-prefix-native-safety-')).sort();
          const latest = JSON.parse(await fs.readFile(path.join(bootstrapDirectory, names.at(-1)), 'utf8'));
          pendingWasDurable = latest.cleanupSafe === false && latest.scope.sourceCommit === revision;
          await fs.appendFile(path.join(prefix, 'lease'), ' public-use');
          const evidence = { commands: [] };
          const runContext = createContext({ fs, Buffer, assert, createHash, validationCommandArguments,
            evidence, environment: { ...environment, HOMEBREW_NO_INSTALL_CLEANUP: '1' },
            brew: environment.SDLC_HOMEBREW_BREW, currentFormula: null,
            process: { hrtime: process.hrtime }, snapshot: async () => ({}),
            execute: options.runCommand ?? commands.legacy, runCommand: options.runCommand ?? commands.legacy });
          const run = runInContext(`${collector}\nrun;`, runContext);
          if (['intel-probe', 'intel-unsettled'].includes(mode)) {
            const probe = runInContext(`(${assertNativeMacHost.toString()})`,
              createContext({ process: { platform: 'darwin', arch: 'x64' } }));
            assert.equal((await probe(run, environment)).translated, 'unavailable on native Intel');
            assert.equal(evidence.commands.some(command => command.success === false), true);
            if (options.runCommand) {
              const failed = evidence.commands.find(command => command.success === false);
              assert.equal(failed.ownedProcess.exitCode, 1);
              assert.equal(failed.ownedProcess.settled, mode === 'intel-probe');
              assert.equal(failed.ownedProcess.cleanup.survivorsVerified, mode === 'intel-probe');
            }
          } else if (['nonzero-settled', 'semantic-failure-settled'].includes(mode)) {
            await assert.rejects(run('owned-negative', []), error => error.code === 7 && error.stdout === 'nonzero tail');
            if (options.runCommand) assert.equal(evidence.commands[0].ownedProcess.settled, true);
          } else {
            const cancellation = new AbortController();
            if (mode === 'cancelled') cancellation.abort();
            const guard = mode === 'root-exit-pipes' ? setTimeout(() => cancellation.abort(), 100) : null;
            try {
              await run('controlled-brew', [], mode === 'timeout' ? { timeout: 15000 } :
                ['cancelled', 'root-exit-pipes'].includes(mode) ? { signal: cancellation.signal } :
                  mode === 'stdin-and-tail' ? { input: 'owned hook input' } : {}).catch(error => {
                assert.ok(['throw', 'unsettled', 'forged-fault', 'interrupt', 'throw-and-persist',
                  'root-exit-pipes', 'timeout', 'cancelled', 'unknown-stop', 'denied-probe'].includes(mode), error.stack);
                if (mode === 'root-exit-pipes' && options.runCommand) {
                  assert.equal(error.code, 'STOP_TIMEOUT', 'Root exit must bound pipe/group settlement without awaiting cancellation');
                  assert.equal(error.ownedProcess.exitCode, 0);
                  assert.equal(error.ownedProcess.settled, false);
                }
              });
            } finally { clearTimeout(guard); }
            if (mode === 'stdin-and-tail') assert.deepEqual(commands.inputs, ['owned hook input']);
          }
          if (mode === 'interrupt') await new Promise((_, reject) => {
            release = () => reject(primary);
            entered();
          });
          if (['throw', 'throw-and-persist', 'semantic-failure-settled'].includes(mode)) throw primary;
          const promotionFault = 'one candidate promotion fails to exercise rollback and retry';
          const formula = 'local/sdlc-owned/ai-sdlc-framework';
          if (['unsettled', 'forged-fault'].includes(mode)) evidence.commands[0].success = false;
          if (mode === 'forged-fault') Object.assign(evidence.commands[0], {
            command: environment.SDLC_HOMEBREW_BREW, args: ['link', formula],
            faultInjected: promotionFault, noInstallCleanup: '1', elapsedMs: 0,
            ownedProcess: { settled: true, cleanup: { survivorsVerified: true } },
          });
          return { passed: true, mode: 'public', upgradeKind: 'version', publicAcceptance: 'Passed',
            platform: 'darwin', architecture: 'x64', previousIdentity: previous.identity, currentIdentity: bundle.identity,
            formulas: { candidate: { source: 'exact-published-bytes', sha256: 'e'.repeat(64) },
              upgrade: { source: 'exact-published-bytes', sha256: digest(Buffer.from('formula')) } },
            failedPromotionRetry: { passed: true, priorKeg: path.join(prefix, 'previous'),
              candidateKeg: path.join(prefix, 'current') },
            commands: [
              ...evidence.commands,
              { command: environment.SDLC_HOMEBREW_BREW, args: ['link', formula], success: false,
                noInstallCleanup: '1', faultInjected: promotionFault },
            ] };
        },
        retainConsumerExecution: async ({ result }) => fs.writeFile(`${outputFile}.execution.json`,
          JSON.stringify({ identity: result.identity, status: result.status })),
        writeJson: async (file, value) => {
          if (file === outputFile && ['persist-failure', 'throw-and-persist'].includes(mode)) throw persistence;
          await fs.writeFile(file, JSON.stringify(value));
          if (file === outputFile && mode === 'missing-report') await fs.unlink(file);
          if (file === outputFile && mode === 'corrupt-report') await fs.writeFile(file, '{corrupt');
          if (file === outputFile && mode === 'misbound-report') {
            await fs.writeFile(file, JSON.stringify({ ...value, identity: { ...value.identity, sourceCommit: 'd'.repeat(40) } }));
          }
        },
        consumerScope: () => ({ repository: 'owned/repository', repositoryId: '1',
          workflowRef: 'owned/acceptance', runId: '1', attempt: '1' }),
        consumerOriginalInventory: async () => [], consumerEvidenceMarker: 'controlled-consumer:',
      });
      context.acceptPublicHomebrew = runInContext(`(${acceptPublicHomebrew.toString()})`, context);
      context.retainConsumerResult = runInContext(`(${retainConsumerResult.toString()})`, context);
      try {
        const accept = runInContext(`(${acceptRelease.toString()})`, context);
        flow = accept({ directory: 'owned-bundle', outputFile, target, previousVersion: '1.0.0' });
        const observed = flow.then(value => ({ value }), error => ({ error }));
        if (mode === 'interrupt') {
          assert.equal(await Promise.race([ready.then(() => true), observed.then(() => false)]), true);
          let admitted;
          try { admitted = await cleanup().then(() => true, () => false); }
          finally { release(); }
          outcome = await observed;
          assert.equal(admitted, false, 'Cleanup cannot consume the stale native-not-started proof during public prefix work');
        } else outcome = await observed;
        const safe = ['success', 'production-root', 'intel-probe', 'nonzero-settled',
          'semantic-failure-settled', 'stdin-and-tail'].includes(mode);
        if (safe) {
          if (mode === 'semantic-failure-settled') {
            assert.equal(outcome.error, primary);
            assert.equal(JSON.parse(await fs.readFile(outputFile, 'utf8')).status, 'Failed');
            assert.equal((await fs.stat(consumerRoot)).isDirectory(), true);
          }
          else { assert.equal(outcome.error, undefined); assert.equal(outcome.value.status, 'Passed'); }
          assert.equal((await cleanup()).status, 'removed');
        } else {
          await assert.rejects(cleanup(), 'Unsettled or unretained public consumption must keep the allocated prefix');
          assert.ok(outcome.error);
          if (['throw', 'interrupt', 'throw-and-persist'].includes(mode)) assert.equal(outcome.error, primary);
          if (mode === 'throw-and-persist') assert.equal(outcome.error.prefixSafetyRetentionError, persistence);
          assert.equal(await fs.readFile(path.join(prefix, 'lease'), 'utf8'), 'owned public prefix public-use');
          assert.equal((await fs.stat(consumerRoot)).isDirectory(), true);
        }
        assert.equal(pendingWasDurable, true, 'Public prefix use must follow durable native stage enrollment');
        t.diagnostic(JSON.stringify({ mode, pendingBeforePrefixUse: pendingWasDurable, cleanupAllowed: safe,
          realProductionContext: true, settlementClockMs: commands.clock() }));
      } catch (error) {
        failures.push({ mode, message: error.message });
      } finally {
        release?.();
        await flow?.catch(() => {});
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      }
    }
    assert.deepEqual(failures, []);
  });

test('TOOL03 prefix cleanup requires bootstrap and native settlement with owned source and role proof', async t => {
  const failures = [];
  const jsonValue = value => value && typeof value === 'object' && !Buffer.isBuffer(value) ?
    JSON.parse(JSON.stringify(value)) : value;
  const vmDigest = value => digest(jsonValue(value));
  const prefixSource = (await fs.readFile(new URL('../scripts/native-homebrew-prefix.mjs', import.meta.url), 'utf8'))
    .replace(/^import .+;\r?$/gmu, '').replace(/^export /gmu, '');
  for (const mode of ['safe', 'bootstrap-uncertain', 'bootstrap-throw', 'bootstrap-retention',
    'native-uncertain', 'native-throw', 'native-retention', 'missing-bootstrap', 'corrupt-bootstrap',
    'missing-native', 'corrupt-native', 'source-change', 'role-change', 'owner-change',
    'native-pending', 'not-required', 'safe-native-failure', 'allocation-change',
    'child-uid', 'child-gid', 'child-group-writable', 'child-world-writable']) {
    const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'tool03-prefix-'));
    const checkout = path.join(directory, 'source');
    const bootstrapDirectory = path.join(checkout, '.test-data', 'bootstrap');
    const prefix = path.join(directory, 'prefix');
    await fs.mkdir(bootstrapDirectory, { recursive: true });
    const stat = await fs.lstat(directory);
    const metadataDenial = mode.startsWith('child-');
    const binding = { host: { uid: metadataDenial ? 501 : stat.uid, gid: metadataDenial ? 20 : stat.gid },
      job: 'owned-prefix', attempt: '1' };
    const owner = { repositoryRoot: checkout, bootstrapDirectory, prefix, binding,
      createDirectory: selected => fs.mkdir(selected, { mode: 0o700 }), claimDirectory: async () => {} };
    const target = 'macos-x64';
    let revision = 'a'.repeat(40);
    const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
      ImageOS: 'owned', ImageVersion: 'owned', GITHUB_WORKFLOW_REF: 'owned',
      GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY_ID: '1',
      GITHUB_REPOSITORY: 'owned/repository', EXPECTED_SOURCE_COMMIT: revision };
    const rejectedChild = path.join(prefix, 'Library', 'vendor', 'portable-ruby', 'private-user-retained');
    // The retained root owner was 501:20; rejected child facts are controlled, not observed native metadata.
    const posixStat = (value, file) => new Proxy(value, { get(object, key) {
      if (key === 'uid') return BigInt(binding.host.uid + (file === rejectedChild && mode === 'child-uid' ? 1 : 0));
      if (key === 'gid') return BigInt(binding.host.gid + (file === rejectedChild && mode === 'child-gid' ? 1 : 0));
      if (key === 'mode') return BigInt(file === rejectedChild && mode === 'child-group-writable' ? 0o100664 :
        file === rejectedChild && mode === 'child-world-writable' ? 0o100646 :
          object.isDirectory() ? 0o40700 : 0o100600);
      const member = object[key];
      return typeof member === 'function' ? member.bind(object) : member;
    } });
    const prefixFilesystem = metadataDenial ? { ...fs,
      lstat: async (file, ...args) => posixStat(await fs.lstat(file, ...args), file),
      open: async (file, ...args) => {
        if ((await fs.lstat(file).catch(() => null))?.isDirectory()) return { sync: async () => {}, close: async () => {} };
        const handle = await fs.open(file, ...args);
        return { writeFile: bytes => handle.writeFile(bytes), sync: () => handle.sync(), close: () => handle.close(),
          read: (...values) => handle.read(...values), stat: async (...values) => posixStat(await handle.stat(...values), file) };
      },
    } : fs;
    const prefixContext = createContext({ fs: prefixFilesystem, constants, path, os, randomBytes,
      canonical: value => canonical(jsonValue(value)), digest: vmDigest, requireThat,
      SdlcError, Buffer, process: metadataDenial ? { ...process, platform: 'darwin' } : process,
      promisify: () => async () => ({ stdout: revision }), owner,
      execFile: (_, __, ___, callback) => callback(null, revision, ''),
    });
    const api = runInContext(`${prefixSource}
productionContext = async () => ({...owner});
requireShortHomebrewPrefix = value => value;
({allocateOwnedDirectory,cleanupHomebrewPrefix,recordOwnedDirectoryNotRequired,verifyOwnedDirectoryOwnership,
  beginHomebrewPrefixStage: typeof beginHomebrewPrefixStage === 'function' ? beginHomebrewPrefixStage : null});`, prefixContext);
    const begin = options => api.beginHomebrewPrefixStage?.(options);
    const calls = [];
    const plan = { schemaVersion: 1, kind: 'native-homebrew-bottle-plan', prefix,
      cellar: path.join(prefix, 'Cellar'), nativeTag: 'sequoia', macosVersion: '15.7',
      relocationEnabled: true, architecture: 'x86_64', rubyPlatform: 'x64-darwin',
      rubyVersion: homebrewToolchain.ruby,
      entries: [{ name: homebrewToolchain.formula, version: homebrewToolchain.node,
        pkgVersion: homebrewToolchain.node,
        prefix: path.join(prefix, 'Cellar', homebrewToolchain.formula, homebrewToolchain.node),
        bottleTag: 'sequoia', bottleAvailable: true, compatible: true, pourable: true,
        builtCellar: 'any', sha256: 'a'.repeat(64) }] };
    const ruby = path.join(prefix, 'portable-ruby', 'ruby');
    const nodePrefix = path.join(prefix, 'opt', homebrewToolchain.formula);
    const primary = Object.assign(new Error('Original owned command failure'), { code: 'OWNED_COMMAND' });
    const transport = async options => {
      calls.push(options.name);
      if (options.name === 'brew-prefix-rmdir') {
        await fs.rmdir(prefix);
        return { complete: true, exitCode: 0, stdout: '', stderr: '' };
      }
      if ((options.name === 'brew-node-install' && mode.startsWith('bootstrap-')) ||
          (options.name === 'native-owned-command' && ['native-uncertain', 'native-throw'].includes(mode))) {
        if (options.lifetime) {
          options.lifetime.cleanupSafe = false;
          options.lifetime.unsettledCommands.push({ name: options.name, pid: 12345 });
        }
        if (mode.endsWith('throw')) throw primary;
        return { complete: false, exitCode: null, stdout: '', stderr: '',
          cleanup: { requested: true, survivorsVerified: false, outcome: 'uncertain' } };
      }
      if (options.name === 'brew-node-install') {
        await fs.mkdir(plan.entries[0].prefix, { recursive: true });
        await fs.writeFile(path.join(plan.entries[0].prefix, 'INSTALL_RECEIPT.json'), JSON.stringify({
          poured_from_bottle: true, source: { versions: { stable: homebrewToolchain.node } } }));
      }
      const values = { 'git-version': 'git owned', 'mac-uname': 'x86_64', 'mac-translation': '0',
        'brew-git-identity': homebrewToolchain.commit, 'brew-prefix': prefix, 'brew-repository': prefix,
        'brew-ruby-identity': homebrewToolchain.ruby, 'brew-ruby-path': ruby,
        'brew-core-identity': homebrewToolchain.coreCommit, 'brew-node-bottle-plan': JSON.stringify(plan),
        'brew-node-prefix': nodePrefix, 'brew-node-identity': JSON.stringify({
          version: homebrewToolchain.node, platform: 'darwin', arch: 'x64' }) };
      return { complete: true, exitCode: 0, stdout: values[options.name] ?? '', stderr: '' };
    };
    const bootstrapContext = createContext({
      fs: { ...fs, open: async (file, ...args) => {
        if (mode === 'bootstrap-retention' && file === path.join(bootstrapDirectory, 'toolchain.json')) throw primary;
        return fs.open(file, ...args);
      } },
      path, os: { release: () => '24.6.0', machine: () => 'x86_64' },
      process: { platform: 'darwin', arch: 'x64', versions: { node: nativeToolchain.node },
        execPath: process.execPath, env: environment, on() {}, off() {} },
      repositoryRoot: checkout, targets: { [target]: ['darwin', 'x64'] },
      digest: vmDigest, requireThat, sanitizeExecutionPayload, nativeToolchain, homebrewToolchain,
      bootstrapRequestCapability: () => null,
      nativeBootstrapRequirements: () => ({ go: false, python: false, schema: false,
        homebrew: mode !== 'not-required', crypto: false }),
      requireNativeCryptoEnvironment() {}, nativeResourceFacts: () => ({}),
      homebrewSetupLimits, homebrewBottlePlanSource, AbortController, AbortSignal, Buffer,
      console: { log() {} }, beginHomebrewPrefixStage: begin,
      executeValidationCommand: transport,
      allocateHomebrewPrefix: async () => {
        const allocation = await api.allocateOwnedDirectory(owner);
        await fs.mkdir(path.dirname(ruby), { recursive: true });
        await fs.writeFile(ruby, 'owned ruby path, never executed');
        await fs.mkdir(nodePrefix, { recursive: true });
        await fs.writeFile(path.join(prefix, 'lease'), 'original owned lease');
        return allocation;
      },
      recordHomebrewPrefixNotRequired: () => api.recordOwnedDirectoryNotRequired(owner),
    });
    for (const fn of [validateBootstrapRequest, nativeBootstrapEnvironment, nativeBootstrapExports,
      portableRubyBootstrapEnvironment, requireHomebrewBottlePlan, requireHomebrewBottleReceipts]) {
      bootstrapContext[fn.name] = runInContext(`(${fn.toString()})`, bootstrapContext);
    }
    try {
      const bootstrap = runInContext(`(${bootstrapNativeToolchain.toString()})`, bootstrapContext);
      const bootstrapped = await bootstrap({ target, outputDir: bootstrapDirectory }).catch(error => {
        assert.ok(mode.startsWith('bootstrap-'), error.stack);
        return null;
      });
      if (metadataDenial) {
        await fs.mkdir(path.dirname(rejectedChild), { recursive: true });
        await fs.writeFile(rejectedChild, 'retain rejected descendant');
        const marker = await fs.readFile(path.join(prefix, '.sdlc-native-homebrew-prefix.json'));
        const allocationPath = path.join(bootstrapDirectory, 'native-homebrew-prefix-allocation.json');
        const allocation = await fs.readFile(allocationPath);
        await assert.rejects(api.cleanupHomebrewPrefix({ bootstrapDirectory, repositoryRoot: checkout,
          target, role: target, sourceCommit: revision, environment,
          run: async name => { calls.push(name); assert.fail('Unsafe descendant must prevent empty-root removal'); } }), error => {
          assert.equal(error.code, 'HOST');
          assert.ok(error.details, `Rejected ${mode} must identify the offending descendant and POSIX metadata: ${error.message}`);
          assert.deepEqual(jsonValue(error.details), {
            entrySha256: digest(path.relative(prefix, rejectedChild).split(path.sep).join('/')),
            entryDepth: 4,
            expected: { uid: binding.host.uid, gid: binding.host.gid },
            actual: {
              uid: binding.host.uid + (mode === 'child-uid' ? 1 : 0),
              gid: binding.host.gid + (mode === 'child-gid' ? 1 : 0),
              mode: mode === 'child-group-writable' ? '0664' : mode === 'child-world-writable' ? '0646' : '0600',
              symbolicLink: false,
            },
          });
          const diagnostic = JSON.stringify(error.details);
          assert.equal(diagnostic.includes(directory), false, 'Ownership diagnostics must not disclose the user checkout');
          assert.equal(diagnostic.includes('private-user-retained'), false, 'Unknown descendant names remain private');
          return true;
        });
        assert.equal(await fs.readFile(rejectedChild, 'utf8'), 'retain rejected descendant');
        assert.deepEqual(await fs.readFile(path.join(prefix, '.sdlc-native-homebrew-prefix.json')), marker);
        assert.deepEqual(await fs.readFile(allocationPath), allocation);
        await assert.rejects(fs.lstat(path.join(bootstrapDirectory, 'native-homebrew-prefix-cleanup.json')),
          { code: 'ENOENT' });
        assert.equal(calls.includes('brew-prefix-rmdir'), false);
        continue;
      }
      if (bootstrapped) Object.assign(environment, Object.fromEntries(Object.entries(bootstrapped).filter(([key]) => key !== 'report')));
      if ((mode.startsWith('native-') && mode !== 'native-pending') || mode === 'safe-native-failure') {
        const evidence = path.join(checkout, '.test-data', 'native');
        await fs.mkdir(evidence);
        const ambient = path.join(directory, 'ambient');
        await fs.mkdir(ambient);
        const nativeContext = createContext({
          Buffer, path, AbortController, digest, requireThat, console, repositoryRoot: checkout,
          process: { platform: 'darwin', arch: 'x64', versions: { node: nativeToolchain.node },
            env: environment, on() {}, off() {} },
          platforms: { [target]: 'darwin' }, nativeToolchain,
          validateNativeRequest: value => value, nativeProducerRole: () => target,
          execute: async (_, args) => ({ stdout: args[0] === 'status' ? '' : revision }),
          literalDirectory: async () => {}, safe: value => value,
          assertCommittedNativeInputs: async () => {}, runtimePreflight: async () => {},
          definitionInputs: async () => ({ inventory: {}, plan: {}, stages: [] }),
          allocateAmbientDirectory: async () => ({ directory: ambient,
            dispose: () => fs.rm(ambient, { recursive: true }) }),
          fs, syntheticReleaseContextVariable: 'SDLC_OWNED_FIXTURE',
          readOptional: async () => bootstrapped.report,
          requireNativeBootstrapCapability: () => ({}), requireNativeCryptoEnvironment() {},
          nativeResourceFacts: () => ({}), beginHomebrewPrefixStage: begin,
          writeJson: async (file, value) => {
            if (mode === 'native-retention' && path.basename(file) === 'producer.json') throw primary;
            return fs.writeFile(file, JSON.stringify(value));
          },
          probeNativeSdk: async (_, run) => {
            await run({ name: 'native-owned-command', command: process.execPath, args: [] });
            throw primary;
          },
          executeValidationCommand: transport,
        });
        const native = runInContext(`(${runNativeValidation.toString()})`, nativeContext);
        await native({ target, profile: 'r-pre', candidateDir: 'owned', evidenceDir: evidence,
          phase: 'validation', component: 'full', shard: null }).catch(error => {
          assert.equal(mode, 'native-retention');
          assert.equal(error, primary);
        });
      }
      if (mode === 'native-pending') await begin({ stage: 'native', bootstrapDirectory,
        repositoryRoot: checkout, target, role: target, sourceCommit: revision, environment });
      const selectedStage = mode.endsWith('bootstrap') ? 'bootstrap' : 'native';
      if (mode.startsWith('missing-')) {
        for (const file of await fs.readdir(bootstrapDirectory)) {
          if (file.startsWith(`native-homebrew-prefix-${selectedStage}-safety-`)) await fs.unlink(path.join(bootstrapDirectory, file));
        }
      }
      if (mode.startsWith('corrupt-')) {
        await fs.writeFile(path.join(bootstrapDirectory,
          `native-homebrew-prefix-${selectedStage}-safety-0000.json`), '{corrupt');
      }
      if (mode === 'source-change') revision = 'b'.repeat(40);
      if (mode === 'role-change') environment.SDLC_NATIVE_ROLE = `${target}-homebrew`;
      if (mode === 'owner-change') binding.attempt = '2';
      if (mode === 'allocation-change') {
        const requestFile = path.join(bootstrapDirectory, 'native-homebrew-prefix-request.json');
        const allocationFile = path.join(bootstrapDirectory, 'native-homebrew-prefix-allocation.json');
        const request = JSON.parse(await fs.readFile(requestFile, 'utf8'));
        const allocation = JSON.parse(await fs.readFile(allocationFile, 'utf8'));
        request.nonce = 'f'.repeat(64);
        const requestBytes = `${canonical(request)}\n`;
        await fs.writeFile(requestFile, requestBytes);
        allocation.requestDigest = digest(requestBytes);
        const marker = `${canonical({ requestDigest: allocation.requestDigest,
          prefixIdentity: allocation.prefixIdentity })}\n`;
        await fs.writeFile(path.join(prefix, '.sdlc-native-homebrew-prefix.json'), marker);
        allocation.markerDigest = digest(marker);
        await fs.writeFile(allocationFile, `${canonical(allocation)}\n`);
        assert.equal((await api.verifyOwnedDirectoryOwnership(owner)).prefix, prefix,
          'The replacement is valid ownership, but cannot borrow the old writer-settlement proof');
      }
      const cleanupContext = createContext({ path, environment, repositoryRoot: checkout,
        validateBootstrapRequest: () => bootstrapDirectory,
        nativeBootstrapEnvironment: () => environment,
        executeValidationCommand: transport, requireThat, AbortSignal,
        cleanupHomebrewPrefix: api.cleanupHomebrewPrefix });
      const cleanup = runInContext(`(${cleanupNativeToolchain.toString()})`, cleanupContext);
      const safe = ['safe', 'safe-native-failure', 'not-required'].includes(mode);
      if (safe) {
        const result = await cleanup({ target, outputDir: bootstrapDirectory });
        assert.equal(result.status, mode === 'not-required' ? 'not-required' : 'removed');
        await assert.rejects(fs.stat(prefix), { code: 'ENOENT' });
      } else {
        await assert.rejects(cleanup({ target, outputDir: bootstrapDirectory }));
        assert.equal(await fs.readFile(path.join(prefix, 'lease'), 'utf8'), 'original owned lease');
        assert.equal(calls.includes('brew-prefix-rmdir'), false);
      }
      t.diagnostic(JSON.stringify({ mode, prefixRemoved: safe && mode !== 'not-required', blocked: !safe }));
    } catch (error) {
      failures.push({ mode, message: error.message });
    } finally {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
  assert.deepEqual(failures, []);
});

test('TOOL03 native failure retains exact ambient workspace and lease for unsettled writers without replacing the primary failure', async () => {
  const failures = [];
  for (const mode of ['uncertain-report', 'uncertain-throw', 'settled-failure', 'cleanup-failure']) {
    const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'tool03-native-'));
    const ambientPath = path.join(directory, 'ambient');
    await fs.mkdir(ambientPath);
    await fs.writeFile(path.join(ambientPath, 'lease.json'), '{"owned":"original"}');
    const primary = Object.assign(new Error('Original command failure'), { code: 'OWNED_PRIMARY' });
    const lifetime = { cleanupSafe: true, unsettledCommands: [] };
    let receivedLifetime;
    const processEnvironment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
      ImageOS: 'owned', ImageVersion: 'owned', GITHUB_WORKFLOW_REF: 'owned',
      GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY_ID: '1',
      EXPECTED_SOURCE_COMMIT: 'a'.repeat(40), GITHUB_REPOSITORY: 'owned/repository' };
    const context = createContext({
      Buffer, path, AbortController, digest, requireThat, console, repositoryRoot,
      process: { platform: 'win32', arch: 'x64', versions: { node: nativeToolchain.node },
        env: processEnvironment, on() {}, off() {} },
      platforms: { 'windows-x64': 'win32' }, nativeToolchain,
      validateNativeRequest: value => value, nativeProducerRole: () => 'owned',
      execute: async (_, args) => ({ stdout: args[0] === 'status' ? '' : 'a'.repeat(40) }),
      literalDirectory: async () => {}, safe: value => value,
      assertCommittedNativeInputs: async () => {}, runtimePreflight: async () => {},
      definitionInputs: async () => ({ inventory: {}, plan: {}, stages: [] }),
      allocateAmbientDirectory: async () => ({ directory: ambientPath, async dispose() {
        if (mode === 'cleanup-failure') throw Object.assign(new Error('Owned cleanup failed'), { code: 'OWNED_CLEANUP' });
        await fs.rm(ambientPath, { recursive: true });
      } }),
      fs, syntheticReleaseContextVariable: 'SDLC_OWNED_FIXTURE',
      readOptional: async () => ({ status: 'Passed', target: 'windows-x64', native: {
        node: nativeToolchain.node, platform: 'win32', architecture: 'x64', resources: {} } }),
      requireNativeBootstrapCapability: () => ({}), requireNativeCryptoEnvironment() {},
      nativeResourceFacts: () => ({}), writeJson: async (file, value) => fs.writeFile(file, JSON.stringify(value)),
      probeNativeSdk: async (_, run) => {
        await run({ name: 'owned-command', command: process.execPath, args: [] });
        throw primary;
      },
      executeValidationCommand: async options => {
        receivedLifetime = options.lifetime;
        if (mode.startsWith('uncertain')) {
          lifetime.cleanupSafe = false;
          lifetime.unsettledCommands.push({ name: options.name, pid: 12345,
            cleanup: { requested: true, survivorsVerified: false, outcome: 'uncertain' } });
        }
        if (mode === 'uncertain-throw') throw primary;
        return { complete: !mode.startsWith('uncertain'), exitCode: 1 };
      },
    });
    try {
      const run = runInContext(`(${runNativeValidation.toString()})`, context);
      const result = await run({ target: 'windows-x64', profile: 'pr', candidateDir: 'owned',
        evidenceDir: directory, phase: 'validation', component: 'full', shard: null }, { lifetime });
      assert.equal(result.failure.code, 'OWNED_PRIMARY');
      assert.equal(result.status, 'NotRun');
      if (mode.startsWith('uncertain')) {
        assert.equal(await fs.readFile(path.join(ambientPath, 'lease.json'), 'utf8'), '{"owned":"original"}');
        assert.equal(receivedLifetime, lifetime);
        assert.equal(result.workspaceCleanup.cleanupSafe, false);
        assert.ok(result.workspaceCleanup.retainedWorkspaces.includes(ambientPath));
        assert.equal(result.cleanupDiagnostic.code, 'UNSETTLED_WRITERS');
      } else if (mode === 'cleanup-failure') {
        assert.equal(result.cleanupDiagnostic.code, 'OWNED_CLEANUP');
        assert.equal(result.workspaceCleanup.cleanupSafe, true, 'A removal failure is not evidence of an unsettled writer');
        assert.deepEqual([...result.workspaceCleanup.retainedWorkspaces], [ambientPath]);
        assert.equal(await fs.readFile(path.join(ambientPath, 'lease.json'), 'utf8'), '{"owned":"original"}');
      } else assert.equal(await fs.stat(ambientPath).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error; return false;
      }), false);
    } catch (error) {
      failures.push({ mode, message: error.message });
    } finally {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
  assert.deepEqual(failures, []);
});

test('T-PRD015 refresh SDK dispatch omits unused commands while historical and other roles probe exact tools in order', async () => {
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework', shard: 'refresh',
    protocol: nativeSdkBootstrapProtocol };
  assert.deepEqual(await probeNativeSdk(request, () => { throw new Error('Unused Go/Python invoked'); }), {});
  for (const change of [{ protocol: null }, { protocol: 'native-bootstrap-role-capabilities-v2' }, { shard: 'units' },
    { target: 'macos-x64', shard: 'units-1' },
    { shard: 'body-0' }, { component: 'full', shard: null }, { component: 'homebrew', shard: null }]) {
    const calls = [];
    const facts = await probeNativeSdk({ ...request, ...change }, async command => {
      calls.push({ name: command.name, args: command.args });
      return { complete: true, exitCode: 0, stdout: command.name === 'go-version' ?
        `go version ${nativeToolchain.go} darwin/arm64\n` : `Python ${nativeToolchain.python}\n` };
    });
    assert.deepEqual(calls, [{ name: 'go-version', args: ['version'] }, { name: 'python-version', args: ['--version'] }]);
    assert.equal(facts.python, `Python ${nativeToolchain.python}`);
    await assert.rejects(probeNativeSdk({ ...request, ...change }, async () => ({
      complete: true, exitCode: 0, stdout: 'NotRequired',
    })), { code: 'HOST' });
  }
});

test('T-PRD015 refresh SDK requirements reject producer downgrades and retain historical full tool identities', () => {
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework', shard: 'refresh',
    protocol: nativeSdkBootstrapProtocol };
  const actual = { go: `go version ${nativeToolchain.go} darwin/arm64`, python: `Python ${nativeToolchain.python}` };
  assert.deepEqual(nativeSdkRequirements(request), { go: false, python: false });
  assert.equal(nativeSdkContextMatches({}, request), true);
  assert.equal(nativeSdkContextMatches(actual, request), false);
  for (const protocol of [null, 'native-bootstrap-role-capabilities-v2']) {
    assert.deepEqual(nativeSdkRequirements({ ...request, protocol }), { go: true, python: true });
    assert.equal(nativeSdkContextMatches({}, { ...request, protocol }), false);
    assert.equal(nativeSdkContextMatches(actual, { ...request, protocol }), true);
  }
  for (const shard of ['units', 'body-0', 'body-1', 'body-2']) {
    assert.equal(nativeSdkContextMatches({}, { ...request, shard }), false);
    assert.equal(nativeSdkContextMatches(actual, { ...request, shard }), true);
  }
  assert.throws(() => nativeSdkRequirements({ ...request, protocol: 'producer-not-required' }), { code: 'INPUT' });
  assert.throws(() => nativeSdkRequirements({ ...request, profile: 'r-pre' }), { code: 'INPUT' });
  assert.throws(() => nativeSdkRequirements({ ...request, role: 'macos-arm64-framework-units' }), { code: 'INPUT' });
});

test('T-PRD015 role bootstrap is source-selected and cannot downgrade full release or historical configurations', async () => {
  const inventory = { complete: true, digest: '1'.repeat(64) };
  const calculator = { namespace: 'calculator', tests: 1, files: ['test/calculator/capability.test.js'] };
  const source = value => [{ file: 'scripts/toolchain-baseline.mjs', contents: value }];
  assert.equal(sourceNativeBootstrapProtocol(source('export const nativeToolchain = {};')), null);
  assert.equal(sourceNativeBootstrapProtocol(source(`export const nativeBootstrapProtocol = '${nativeBootstrapProtocol}';`)),
    nativeBootstrapProtocol);
  for (const text of [`export const nativeBootstrapProtocol = 'unknown';`,
    `export const nativeBootstrapProtocol = "${nativeBootstrapProtocol}";`]) {
    assert.throws(() => sourceNativeBootstrapProtocol(source(text)), { code: 'EVIDENCE' });
  }
  assert.equal(bootstrapRequestCapability({ target: 'macos-arm64' }), null);
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework',
    shard: 'units', role: 'macos-arm64-framework-units' };
  const selectedInventory = await compileValidationInventory(repositoryRoot);
  const selectedPlan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  assert.equal(bootstrapRequestCapability({ ...request, inventory: selectedInventory, plan: selectedPlan }).homebrew, 'not-required');
  for (const change of [{ profile: 'r-pre' }, { component: 'full' }, { component: 'homebrew' },
    { shard: 'body-3' }, { role: 'macos-x64-framework-units' }, { profile: undefined }]) {
    assert.throws(() => bootstrapRequestCapability({ ...request, ...change }), { code: 'INPUT' });
  }
  const options = { inventory, calculator, target: request.target, profile: 'pr', component: 'framework', shard: 'units',
    shardPlanDigest: 'a'.repeat(64) };
  assert.notEqual(nativeConfigurationDigest(options),
    nativeConfigurationDigest({ ...options, bootstrapProtocol: nativeBootstrapProtocol }));
  for (const profile of ['pr', 'r-pre']) assert.equal(
    nativeConfigurationDigest({ inventory, calculator, profile }),
    nativeConfigurationDigest({ inventory, calculator, profile, bootstrapProtocol: nativeBootstrapProtocol }));
});

test('T-PRD015 role bootstrap rejects forged runtime providers borrowed prefixes and invented bottle evidence', () => {
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework',
    shard: 'units', role: 'macos-arm64-framework-units', protocol: nativeSdkBootstrapProtocol };
  const prefix = '/opt/abcde';
  const bootstrap = { status: 'Passed', target: request.target, native: {
    platform: 'darwin', architecture: 'arm64', node: nativeToolchain.node,
    bootstrapCapability: nativeBootstrapCapability(request),
    executables: { node: '/hostedtoolcache/node/bin/node' },
    runtimeProvider: { provider: 'actions/setup-node', executable: '/hostedtoolcache/node/bin/node',
      version: nativeToolchain.node, platform: 'darwin', architecture: 'arm64' },
    homebrew: { prefix, repository: prefix, commit: homebrewToolchain.commit, coreCommit: homebrewToolchain.coreCommit,
      ruby: homebrewToolchain.ruby,
      rubyExecutable: `${prefix}/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby`,
      nodeProvisioned: false, bottlesProvisioned: false },
  }, reports: ['brew-git-identity', 'brew-prefix', 'brew-repository', 'brew-ruby-identity',
    'brew-ruby-path', 'brew-core-identity'].map(name => ({ name, complete: true, exitCode: 0 })) };
  assert.deepEqual(requireNativeBootstrapCapability({ ...request, bootstrap, prefix }), bootstrap.native.bootstrapCapability);
  const refreshRequest = { ...request, shard: 'refresh', role: 'macos-arm64-framework-refresh' };
  const refresh = structuredClone(bootstrap);
  refresh.native.bootstrapCapability = nativeBootstrapCapability(refreshRequest);
  assert.deepEqual(requireNativeBootstrapCapability({ ...refreshRequest, bootstrap: refresh, prefix }),
    refresh.native.bootstrapCapability);
  for (const mutate of [
    value => { value.native.go = 'NotRequired'; },
    value => { value.native.python = { status: 'Passed' }; },
    value => { value.reports.push({ name: 'go-version', complete: true, exitCode: 0 }); },
    value => { value.reports.pop(); },
  ]) {
    const changed = structuredClone(refresh);
    mutate(changed);
    assert.throws(() => requireNativeBootstrapCapability({ ...refreshRequest, bootstrap: changed, prefix }),
      { code: 'EVIDENCE' });
  }
  for (const mutate of [
    value => { value.native.bootstrapCapability.tools.go = false; },
    value => { value.native.bootstrapCapability.tools.python = false; },
    value => { value.native.runtimeProvider.executable = '/other/node'; },
    value => { value.native.runtimeProvider.architecture = 'x64'; },
    value => { value.native.homebrew.prefix = '/opt/fffff'; },
    value => { value.native.homebrew.coreCommit = 'f'.repeat(40); },
    value => { value.native.homebrew.nodePrefix = `${prefix}/opt/node@24`; },
    value => { value.native.homebrew.bottleReceiptsDigest = 'a'.repeat(64); },
    value => { value.native.homebrew.nodeProvisioned = true; },
    value => { value.reports.pop(); },
    value => { value.reports.push({ name: 'brew-node-install', complete: true, exitCode: 0 }); },
  ]) {
    const changed = structuredClone(bootstrap);
    mutate(changed);
    assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap: changed, prefix }), { code: 'EVIDENCE' });
  }
  assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap, protocol: null }), { code: 'EVIDENCE' });
  assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap, component: 'homebrew' }), { code: 'EVIDENCE' });
});

test('T-PRD015 v4 unit runtime is required while unused SDK schema and prefix evidence cannot be invented', async () => {
  for (const target of ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64']) {
    for (const shard of ['units', ...(target === 'macos-x64' ? ['units-1'] : []), 'refresh']) {
      const request = { target, profile: 'pr', component: 'framework', shard,
        protocol: nativeBootstrapProtocol };
      const python = shard !== 'refresh';
      assert.deepEqual(nativeBootstrapRequirements(request),
        { go: false, python, schema: false, homebrew: false, ownedPrefix: false });
      const calls = [];
      assert.deepEqual(await probeNativeSdk(request, async command => {
        calls.push(command.name);
        return { complete: true, exitCode: 0, stdout: `Python ${nativeToolchain.python}\n` };
      }), python ? { python: `Python ${nativeToolchain.python}` } : {});
      assert.deepEqual(calls, python ? ['python-version'] : []);
      if (python) await assert.rejects(probeNativeSdk(request, async () =>
        ({ complete: false, exitCode: 1, stdout: '' })), { code: 'HOST' });
      const platform = target.startsWith('macos-') ? 'darwin' : target === 'windows-x64' ? 'win32' : 'linux';
      const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
      const executable = '/controlled-fixture/python';
      const bootstrap = { status: 'Passed', target, native: {
        platform, architecture, node: nativeToolchain.node,
        bootstrapCapability: nativeBootstrapCapability(request),
        executables: { node: '/controlled-fixture/node', ...(python ? { python: executable } : {}) },
        runtimeProvider: { provider: 'actions/setup-node', executable: '/controlled-fixture/node',
          version: nativeToolchain.node, platform, architecture },
        ...(python ? { python: { executable, version: nativeToolchain.python,
          implementation: 'CPython', machine: architecture === 'arm64' ? 'arm64' : 'x86_64' } } : {}),
      }, reports: python ? [{ name: 'python-identity', complete: true, exitCode: 0 }] : [] };
      assert.deepEqual(requireNativeBootstrapCapability({ ...request, bootstrap }),
        bootstrap.native.bootstrapCapability);
      for (const mutate of [
        value => { value.native.go = 'NotRequired'; },
        value => { value.native.schemaPackages = {}; },
        value => { value.native.homebrew = { prefix: '/opt/abcde' }; },
        value => { value.native.prefix = '/opt/abcde'; },
        value => { value.reports.push({ name: 'schema-dependency-probe', complete: true, exitCode: 0 }); },
        value => { value.reports.push({ name: 'brew-prefix', complete: true, exitCode: 0 }); },
        ...['go', 'python', 'schema', 'homebrew', 'ownedPrefix'].map(tool => value => {
          value.native.bootstrapCapability.tools[tool] = 'false';
        }),
        value => { value.native.bootstrapCapability.tools.unknown = false; },
        value => { value.native.bootstrapCapability.role = `${target}-framework-body-0`; },
        value => { value.native.runtimeProvider.provider = 'producer-claimed'; },
        value => { value.native.bootstrapCapability.tools.python = !python; },
        value => {
          if (python) delete value.native.python;
          else value.native.python = { status: 'Passed' };
        },
      ]) {
        const changed = structuredClone(bootstrap);
        mutate(changed);
        assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap: changed }),
          { code: 'EVIDENCE' });
      }
      assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap, prefix: '/opt/abcde' }),
        { code: 'EVIDENCE' });
    }
    for (const options of [
      { profile: 'pr', component: 'framework', shard: 'body-0', protocol: nativeUnitBootstrapProtocol },
      { profile: 'pr', component: 'homebrew', protocol: nativeUnitBootstrapProtocol },
      { profile: 'r-pre', component: 'full', protocol: nativeBootstrapProtocol },
      { profile: 'pr', component: 'framework', shard: 'units', protocol: nativeSdkBootstrapProtocol },
      { profile: 'pr', component: 'framework', shard: 'refresh', protocol: 'native-bootstrap-role-capabilities-v2' },
      { profile: 'pr', component: 'full', protocol: null },
    ]) {
      const mac = target.startsWith('macos-');
      assert.deepEqual(nativeBootstrapRequirements({ target, ...options }),
        { go: true, python: true, schema: true, homebrew: mac, ownedPrefix: mac });
    }
  }
  const inventory = await compileValidationInventory(repositoryRoot);
  const plan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  for (const target of ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64']) {
    const assignment = nativeFrameworkShardPlan({ inventory, plan, target });
    for (const part of assignment.parts.filter(part => part.shard.startsWith('body-'))) {
      const request = { inventory, plan, assignment, target, ...part, profile: 'pr', component: 'framework',
        protocol: nativeBootstrapProtocol };
      const required = nativeBootstrapRequirements(request);
      const expected = expectedBodySdkRequirements(inventory, target, part);
      assert.equal(expected.schema, part.shard === assignment.toolShard);
      assert.deepEqual(required, { ...expected, homebrew: false, ownedPrefix: false });
      const calls = [];
      await probeNativeSdk(request, async command => {
        calls.push(command.name);
        return { complete: true, exitCode: 0, stdout: command.name === 'go-version' ?
          `go version ${nativeToolchain.go} darwin/arm64\n` : `Python ${nativeToolchain.python}\n` };
      });
      assert.deepEqual(calls, [...(required.go ? ['go-version'] : []),
        ...(required.python ? ['python-version'] : [])]);
      assert.deepEqual(nativeBootstrapRequirements({ ...request, protocol: nativeUnitBootstrapProtocol }),
        { go: true, python: true, schema: true,
          homebrew: target.startsWith('macos-'), ownedPrefix: target.startsWith('macos-') });
      assert.throws(() => nativeBootstrapRequirements({ ...request, assignment: undefined, inventory: undefined }),
        { code: 'INPUT' });
    }
    if (target.startsWith('macos-')) {
      const request = { target, profile: 'pr', component: 'homebrew', protocol: nativeBootstrapProtocol };
      assert.deepEqual(nativeBootstrapRequirements(request),
        { go: false, python: false, schema: false, homebrew: true, ownedPrefix: true });
      assert.deepEqual(await probeNativeSdk(request, () => assert.fail('Genuine Homebrew does not execute Go/Python SDKs')), {});
      assert.throws(() => nativeBootstrapRequirements({ ...request, role: `${target}-framework-units` }),
        { code: 'INPUT' });
    }
  }
});

test('T-PRD015 genuine Homebrew bootstrap records its capability and installs the complete native bottle closure', async () => {
  const selectedInventory = await compileValidationInventory(repositoryRoot);
  const selectedPlan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  const assignments = new Map(['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'].map(target =>
    [target, nativeFrameworkShardPlan({ inventory: selectedInventory, plan: selectedPlan, target })]));
  for (const target of ['macos-arm64', 'macos-x64']) {
    const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
    const prefix = '/opt/abcde';
    const root = '/controlled-source';
    const directory = `${root}/.test-data/bootstrap`;
    const rubyExecutable = `${prefix}/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby`;
    const files = new Map();
    const calls = [];
    const listeners = new Map();
    const plan = {
      schemaVersion: 1, kind: 'native-homebrew-bottle-plan', prefix, cellar: `${prefix}/Cellar`,
      nativeTag: architecture === 'arm64' ? 'arm64_sequoia' : 'sequoia', macosVersion: '15.7',
      relocationEnabled: true, architecture: architecture === 'arm64' ? 'arm64' : 'x86_64',
      rubyPlatform: `${architecture}-darwin`, rubyVersion: homebrewToolchain.ruby,
      entries: [{ name: homebrewToolchain.formula, version: homebrewToolchain.node,
        pkgVersion: homebrewToolchain.node,
        prefix: `${prefix}/Cellar/${homebrewToolchain.formula}/${homebrewToolchain.node}`,
        bottleTag: architecture === 'arm64' ? 'arm64_sequoia' : 'sequoia',
        bottleAvailable: true, compatible: true, pourable: true, builtCellar: 'any',
        sha256: 'a'.repeat(64) }],
    };
    const receipt = { poured_from_bottle: true, source: { versions: { stable: homebrewToolchain.node } } };
    const writeFile = async (file, value) => {
      assert.equal(files.has(file), false, `Controlled bootstrap cannot overwrite ${file}`);
      files.set(file, Buffer.from(value));
    };
    const folder = name => ({ name, isDirectory: () => true, isSymbolicLink: () => false });
    const context = createContext({
      fs: {
        mkdir: async () => {},
        lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
        realpath: async file => file,
        readdir: async file => file === plan.cellar ? [folder(homebrewToolchain.formula)] :
          file === `${plan.cellar}/${homebrewToolchain.formula}` ? [folder(homebrewToolchain.node)] : [],
        readFile: async file => {
          if (file === `${root}/docs/sdlc/public-readiness/test-plan.md`) return selectedPlan;
          assert.equal(file, `${plan.entries[0].prefix}/INSTALL_RECEIPT.json`);
          assert.ok(calls.includes('brew-node-install'), 'Receipts must follow actual dispatched installation');
          return Buffer.from(JSON.stringify(receipt));
        },
        writeFile,
        open: async (file, flags) => {
          assert.equal(flags, 'wx');
          return { writeFile: value => writeFile(file, value), sync: async () => {}, close: async () => {} };
        },
      },
      path: path.posix, os: { release: () => '24.6.0', machine: () => plan.architecture },
      process: {
        platform: 'darwin', arch: architecture, versions: { node: nativeToolchain.node },
        execPath: '/controlled-actions/node', env: {},
        on: (signal, listener) => { listeners.set(signal, listener); },
        off: (signal, listener) => { assert.equal(listeners.get(signal), listener); listeners.delete(signal); },
      },
      repositoryRoot: root, targets: {
        'macos-arm64': ['darwin', 'arm64'], 'macos-x64': ['darwin', 'x64'],
      },
      digest: value => digest(value !== null && typeof value === 'object' && !Buffer.isBuffer(value) ?
        JSON.parse(JSON.stringify(value)) : value),
      requireThat, sanitizeExecutionPayload, nativeToolchain, homebrewToolchain,
      bootstrapRequestCapability, nativeBootstrapRequirements, requireNativeCryptoEnvironment,
      compileValidationInventory: async () => selectedInventory,
      homebrewSetupLimits, homebrewBottlePlanSource, AbortController, AbortSignal, Buffer,
      console: { log: () => {} },
      nativeResourceFacts: () => ({ configuredWorkers: 4 }),
      beginHomebrewPrefixStage: async () => null,
      allocateHomebrewPrefix: async () => ({ prefix }),
      recordHomebrewPrefixNotRequired: () => assert.fail('Genuine Homebrew requires its own allocated prefix'),
      provisionPrCryptoFixture: () => assert.fail('Genuine Homebrew never acquires the unused crypto fixture'),
      prCryptoFixture,
      executeValidationCommand: async ({ name }) => {
        calls.push(name);
        assert.doesNotMatch(name, /^(?:go-|python-|schema-)/u);
        const values = {
          'git-version': 'git version controlled',
          'bash-version': 'controlled bash', 'zsh-version': 'controlled zsh',
          'mac-uname': plan.architecture, 'mac-translation': '0',
          'brew-git-identity': homebrewToolchain.commit, 'brew-prefix': prefix, 'brew-repository': prefix,
          'brew-ruby-identity': homebrewToolchain.ruby, 'brew-ruby-path': rubyExecutable,
          'brew-core-identity': homebrewToolchain.coreCommit,
          'brew-node-bottle-plan': JSON.stringify(plan),
          'brew-node-prefix': `${prefix}/opt/${homebrewToolchain.formula}`,
          'brew-node-identity': JSON.stringify({ version: nativeToolchain.node, platform: 'darwin', arch: architecture }),
        };
        return { complete: true, exitCode: 0, stdout: values[name] ?? '', stderr: '' };
      },
    });
    for (const fn of [validateBootstrapRequest, nativeBootstrapEnvironment, nativeBootstrapExports,
      portableRubyBootstrapEnvironment, requireHomebrewBottlePlan, requireHomebrewBottleReceipts]) {
      context[fn.name] = runInContext(`(${fn.toString()})`, context);
    }
    const bootstrap = runInContext(`(${bootstrapNativeToolchain.toString()})`, context);
    const request = { target, outputDir: '.test-data/bootstrap', profile: 'pr',
      component: 'homebrew', role: `${target}-homebrew` };
    const result = await bootstrap(request);
    const expectedReports = ['brew-node-bottle-plan', 'brew-node-install', 'brew-node-prefix', 'brew-node-identity'];
    for (const name of expectedReports) assert.equal(calls.filter(call => call === name).length, 1, name);
    assert.ok(calls.indexOf('brew-node-bottle-plan') < calls.indexOf('brew-node-install'));
    assert.ok(calls.indexOf('brew-node-install') < calls.indexOf('brew-node-identity'));
    assert.equal(result.report.status, 'Passed');
    const retained = JSON.parse(files.get(`${directory}/toolchain.json`).toString('utf8'));
    assert.equal(retained.status, 'Passed');
    assert.deepEqual(requireNativeBootstrapCapability({ ...request, bootstrap: retained, prefix,
      inventory: selectedInventory, plan: selectedPlan, protocol: nativeCryptoBootstrapProtocol }),
    nativeBootstrapCapability({ ...request, inventory: selectedInventory, plan: selectedPlan, protocol: nativeCryptoBootstrapProtocol }));
    assert.equal(Object.hasOwn(retained.native, 'cryptoFixture'), false);
    assert.equal(Object.keys(result).some(name => /^SDLC_NPM_/u.test(name)), false);
    assert.equal([...files.keys()].some(file => file.includes('/crypto-fixture/')), false);
    assert.equal(files.has(`${directory}/homebrew-bottle-plan.json`), true);
    assert.equal(files.has(`${directory}/homebrew-bottle-receipts.json`), true);
    assert.equal(listeners.size, 0);
  }
  const roleResults = [];
  for (const part of nativePrParts.filter(part => part.component === 'framework')) {
    const request = { ...part, profile: 'pr', protocol: nativeCryptoBootstrapProtocol,
      inventory: selectedInventory, plan: selectedPlan, assignment: assignments.get(part.target) };
    const expected = nativeBootstrapRequirements(request);
    const historical = nativeBootstrapRequirements({ ...request, protocol: nativeBootstrapProtocol });
    assert.deepEqual(Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'crypto')), historical);
    assert.deepEqual(nativeSdkRequirements(request), nativeSdkRequirements({ ...request, protocol: nativeBootstrapProtocol }));
    const run = await controlledFrameworkBootstrap(request);
    const fixture = run.report.native.cryptoFixture;
    assert.equal(run.cryptoCalls, Number(expected.crypto), part.role);
    assert.equal(Object.hasOwn(run.report.native, 'cryptoFixture'), expected.crypto);
    assert.equal(run.directories.some(file => file.includes('/crypto-fixture')), expected.crypto);
    assert.equal(run.report.reports.some(item => /^crypto-/u.test(item.name)), expected.crypto);
    assert.equal(Object.keys(run.exports).some(name => /^SDLC_NPM_/u.test(name)), expected.crypto);
    assert.deepEqual(requireNativeBootstrapCapability({ ...request, bootstrap: run.report }),
      nativeBootstrapCapability(request));
    requireNativeCryptoEnvironment(nativeBootstrapCapability(request), fixture, run.exports);
    roleResults.push({ role: part.role, crypto: expected.crypto });
    for (const mutate of [
      value => { value.native.bootstrapCapability.tools.crypto = !expected.crypto; },
      value => { value.native.bootstrapCapability.tools.crypto = 'false'; },
      value => { value.native.bootstrapCapability.tools.extra = false; },
      value => { delete value.native.bootstrapCapability.tools.crypto; },
      value => { value.native.executables.verifier = '/borrowed/npm'; },
      value => {
        if (expected.crypto) delete value.native.cryptoFixture;
        else value.native.cryptoFixture = { status: 'NotRequired' };
      },
      value => {
        if (expected.crypto) value.reports = value.reports.filter(item => !/^crypto-/u.test(item.name));
        else value.reports.push({ name: 'crypto-tool-99', complete: true, exitCode: 0 });
      },
      ...(expected.crypto ? [
        value => { value.native.cryptoFixture.bundleSha256 = '0'.repeat(64); },
        value => { value.native.cryptoFixture.trustSha256 = '0'.repeat(64); },
        value => { value.native.cryptoFixture.verifier = 'ambient'; },
        value => { value.native.cryptoFixture.paths.toolRoot = '/borrowed/npm'; },
        value => { value.native.cryptoFixture.paths.bundleFile = '/borrowed/public-intoto.sigstore'; },
        value => { value.native.cryptoFixture.paths.cachePath = '/borrowed/offline-trust'; },
      ] : []),
    ]) {
      const altered = structuredClone(run.report);
      mutate(altered);
      assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap: altered }), { code: 'EVIDENCE' });
    }
    const forgedTools = { ...expected, crypto: 'false' };
    assert.throws(() => nativeConfigurationDigest({ ...request, bootstrapProtocol: nativeCryptoBootstrapProtocol,
      bootstrapTools: forgedTools, shardPlanDigest: request.assignment.digest }), { code: 'INVENTORY' });
    if (expected.crypto) {
      for (const change of [
        values => { delete values.SDLC_NPM_TOOL_ROOT; },
        values => { values.SDLC_NPM_SIGNED_FIXTURE_SHA256 = '0'.repeat(64); },
        values => { values.SDLC_NPM_TOOL_ROOT = '/borrowed/npm'; },
      ]) await assert.rejects(controlledFrameworkBootstrap(request, change), { code: 'EVIDENCE' });
    } else assert.throws(() => requireNativeCryptoEnvironment(nativeBootstrapCapability(request), undefined,
      { SDLC_NPM_TOOL_ROOT: '/ambient/npm' }), { code: 'EVIDENCE' });
  }
  assert.equal(roleResults.filter(item => item.crypto).length, 4);
  assert.equal(roleResults.filter(item => !item.crypto).length, 19);
  const missing = structuredClone(selectedInventory);
  missing.cases = missing.cases.filter(item => item.applicability.owner !== 'consumer-crypto-fixture');
  assert.throws(() => nativeBootstrapRequirements({ inventory: missing, plan: selectedPlan, profile: 'pr',
    target: 'macos-arm64', component: 'homebrew', protocol: nativeCryptoBootstrapProtocol }), { code: 'INVENTORY' });
  const changed = structuredClone(selectedInventory);
  const body = nativeFrameworkShardPlan({ inventory: changed, plan: selectedPlan, target: 'linux-x64' })
    .parts.find(part => part.shard === 'body-1');
  const root = body.stages.flatMap(stage => stage.cases).find(item => !item.parents.length);
  root.applicability.prerequisites.push('Unrecognized authentic crypto verifier capability');
  assert.equal(nativeBootstrapRequirements({ inventory: changed, plan: selectedPlan, profile: 'pr',
    target: 'linux-x64', component: 'framework', shard: 'body-1', protocol: nativeCryptoBootstrapProtocol }).crypto, true);
});

async function controlledFrameworkBootstrap(request, changeCrypto) {
  const root = '/controlled-source';
  const directory = `${root}/.test-data/bootstrap-${request.role}`;
  const platform = request.target.startsWith('macos-') ? 'darwin' :
    request.target === 'windows-x64' ? 'win32' : 'linux';
  const architecture = request.target === 'macos-arm64' ? 'arm64' : 'x64';
  const files = new Map();
  const directories = [];
  let cryptoCalls = 0;
  const writeFile = async (file, value) => { assert.equal(files.has(file), false); files.set(file, Buffer.from(value)); };
  const context = createContext({
    fs: {
      mkdir: async file => { directories.push(file); }, readdir: async () => [],
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      readFile: async file => file.endsWith('/test-plan.md') ? request.plan : 'jsonschema==4.26.0',
      writeFile, open: async file => ({ writeFile: value => writeFile(file, value),
        sync: async () => {}, close: async () => {} }),
    },
    path: path.posix, os: { release: () => '24.6.0', machine: () => architecture },
    process: { platform, arch: architecture, versions: { node: nativeToolchain.node }, execPath: '/controlled-actions/node',
      env: { GITHUB_ACTIONS: 'true', SDLC_NPM_TOOL_ROOT: '/ambient/npm' }, on: () => {}, off: () => {} },
    repositoryRoot: root, targets: { [request.target]: [platform, architecture] },
    digest: value => digest(value && typeof value === 'object' && !Buffer.isBuffer(value) ?
      JSON.parse(JSON.stringify(value)) : value),
    requireThat, sanitizeExecutionPayload, nativeToolchain, homebrewToolchain, prCryptoFixture,
    bootstrapRequestCapability, nativeBootstrapRequirements, requireNativeCryptoEnvironment, nativeFrameworkShardPlan,
    compileValidationInventory: async () => request.inventory, nativeResourceFacts: () => ({ configuredWorkers: 4 }),
    AbortController, AbortSignal, Buffer, console: { log: () => {} },
    recordHomebrewPrefixNotRequired: async () => {},
    allocateHomebrewPrefix: () => assert.fail('No framework role allocates a Homebrew prefix'),
    schemaPipInstallArguments: () => assert.fail('Controlled schema probe already supplies pinned packages'),
    executeValidationCommand: async ({ name, args, environment }) => {
      assert.equal(Object.keys(environment).some(key => /^SDLC_NPM_/u.test(key)), false);
      const python = '/controlled/python';
      const values = {
        'go-root': '/controlled/go', 'go-version': `go version ${nativeToolchain.go} controlled`,
        'python-identity': JSON.stringify({ executable: python, version: nativeToolchain.python,
          implementation: 'CPython', machine: architecture === 'arm64' ? 'arm64' : 'x86_64' }),
        'schema-dependency-probe': '{"jsonschema":"4.26.0"}', 'schema-dependencies-verify': '{"jsonschema":"4.26.0"}',
        'mac-uname': architecture === 'arm64' ? 'arm64' : 'x86_64', 'mac-translation': '0',
      };
      return { complete: true, exitCode: 0, stdout: values[name] ?? '', stderr: '' };
    },
    provisionPrCryptoFixture: async ({ root: fixtureRoot, run }) => {
      cryptoCalls++;
      directories.push(fixtureRoot);
      await run('controlled-npm', ['install']);
      await run('controlled-node', ['--version']);
      const values = {
        SDLC_NPM_SIGNED_FIXTURE_BUNDLE: `${fixtureRoot}/public-intoto.sigstore`,
        SDLC_NPM_SIGNED_FIXTURE_SHA256: prCryptoFixture.bundle.sha256,
        SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY: prCryptoFixture.certificateIdentity,
        SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY_KIND: prCryptoFixture.certificateIdentityKind,
        SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_ISSUER: prCryptoFixture.certificateIssuer,
        SDLC_NPM_TOOL_ROOT: `${fixtureRoot}/npm-tool/node_modules/npm`,
        SDLC_NPM_TUF_CACHE: `${fixtureRoot}/offline-trust`,
        SDLC_NPM_SIGNED_FIXTURE_TRUST_SHA256: prCryptoFixture.trust.sha256,
      };
      changeCrypto?.(values);
      return values;
    },
  });
  for (const fn of [validateBootstrapRequest, nativeBootstrapEnvironment, nativeBootstrapExports]) {
    context[fn.name] = runInContext(`(${fn.toString()})`, context);
  }
  const bootstrap = runInContext(`(${bootstrapNativeToolchain.toString()})`, context);
  const result = await bootstrap({ target: request.target, outputDir: directory, profile: 'pr',
    component: 'framework', shard: request.shard, role: request.role });
  return { report: JSON.parse(files.get(`${directory}/toolchain.json`)), exports: result, cryptoCalls, directories };
}

const targets = ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'];
const nativePlatforms = { 'linux-x64': 'linux', 'windows-x64': 'win32',
  'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
const sourceRevision = 'a'.repeat(40);
const sources = [{ file: 'contract_test.go', contents:
  'const validationContractInventory = `{"schemaVersion":1,"tests":{"TestContract":["one","two"]}}`\n' +
  'func TestContract(t *testing.T) {}\n' }];
const plan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
const baselineCalculatorSources = await Promise.all(calculatorFiles.map(async file =>
  ({ file, contents: await fs.readFile(path.join(repositoryRoot, ...file.split('/')), 'utf8') })));
const calculatorManifest = await fs.readFile(path.join(repositoryRoot, 'test', 'calculator', 'package.json'), 'utf8');
function calculatorFixtureSources(selected) {
  const policy = { schemaVersion: 1,
    surfaces: [{ coverage: 'fixture-only', paths: ['scripts/pr-calculator-reporter.mjs'] }],
    projects: [{ root: 'test/calculator', files: selected.map(source => source.file),
      coverage: 'fixture-only', owner: 'owned-calculator-fixture', reason: 'Independent source selection regression',
      command: ['node', '--test', 'test/*.test.js'], prerequisites: ['Owned calculator assets'] }] };
  return [{ file: 'test/calculator-project.test.mjs', contents:
    `export const validationDeclarations=${JSON.stringify(policy)};import test from 'node:test';test('project policy',()=>{});` },
  { file: 'test/calculator/package.json', contents: calculatorManifest }, ...selected];
}
function calculatorFixtureInventory(selected) {
  const files = calculatorFixtureSources(selected);
  return compileValidationSourceInventory({ files,
    surfacePaths: [...files.map(source => source.file), 'scripts/pr-calculator-reporter.mjs'] });
}
const baselineCalculatorInventory = calculatorFixtureInventory(baselineCalculatorSources);
const inventory = { complete: true, digest: digest('fixture-inventory'), cases: [{
  id: 'distribution-contract', file: 'test/distribution-channels.test.mjs',
  name: 'native frozen lifecycle', parents: [], applicability: { platforms: targets },
}], independentProjects: baselineCalculatorInventory.independentProjects };
const candidate = { descriptor: { version: '1.2.3', payload: { filename: 'ai-sdlc-framework-1.2.3.tgz' },
  files: [
    { filename: 'ai-sdlc-framework-1.2.3.tgz', sha256: '1'.repeat(64), kind: 'npm' },
    { filename: 'ai-sdlc-framework-1.2.3-macos.tar.gz', sha256: '2'.repeat(64), kind: 'archive' },
    { filename: 'ai-sdlc-framework-1.2.3-windows-x64.zip', sha256: '3'.repeat(64), kind: 'archive' },
  ] }, context: { identity: { descriptorSha256: '4'.repeat(64), checksumsSha256: '5'.repeat(64) } } };

test('T-PRD015 required public crypto fixture provisioning rejects missing CI capability and unpinned bytes', async t => {
  const bytes = Buffer.from('public verification material');
  const pin = { url: 'https://fixtures.example/public', sha256: digest(bytes) };
  // Fixture transport is controlled here; T-PRD041 separately invokes the real cryptographic verifier.
  const { createHash } = await import('node:crypto');
  pin.sha256 = createHash('sha256').update(bytes).digest('hex');
  let options;
  const fetcher = async (_url, selected) => {
    options = selected;
    return { ok: true, arrayBuffer: async () => bytes };
  };
  assert.deepEqual(await fetchPinnedFixture(pin, fetcher), bytes);
  assert.equal(options.redirect, 'error');
  await assert.rejects(fetchPinnedFixture({ ...pin, sha256: '0'.repeat(64) }, fetcher), /integrity mismatch/u);
  await assert.rejects(fetchPinnedFixture(pin, async () => ({ ok: false })), /unavailable/u);
  await assert.rejects(provisionPrCryptoFixture({ root: 'never-created', environment: {} }), /only in CI/u);
  const root = path.join(repositoryRoot, '.test-data', `crypto-missing-input-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const environment = { ...process.env, GITHUB_ACTIONS: 'true' };
  for (const name of Object.keys(environment)) if (name.startsWith('SDLC_NPM_')) delete environment[name];
  delete environment.NODE_TEST_CONTEXT;
  const missing = await executeValidationCommand({ name: 'missing-pr-crypto', command: process.execPath,
    args: ['--test', '--test-reporter=tap', '--test-name-pattern=T-PRD041 retained signed fixtures',
      'test/public-readiness-release-consumer.test.mjs'], environment, outputDir: root });
  assert.equal(missing.complete, true);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stdout, /Required PR crypto inputs are missing/u);
  assert.match(missing.stdout, /# skipped 0/u);
});

test('T-PRD087 independent calculator PR command retains eleven namespaced originals and rejects partial skipped or duplicate credit', async t => {
  const root = path.join(repositoryRoot, '.test-data', `calculator-evidence-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const output = path.join(root, 'calculator.json');
  const report = await runCalculator({ root: repositoryRoot, output, context: { source: 'owned focused execution' } });
  const expected = calculatorSelection(baselineCalculatorInventory);
  const journal = await fs.readFile(`${output}.journal.ndjson`, 'utf8');
  assert.equal(reconcileCalculator(report, expected, journal), true);
  assert.deepEqual(report.summary, { tests: 11, passed: 11, failed: 0, skipped: 0, cancelled: 0 });
  assert.equal(expected.filter(test => test.file === calculatorFiles[0]).length, 8);
  assert.equal(expected.filter(test => test.file === calculatorFiles[1]).length, 3);
  for (const alter of [
    value => { value.results.pop(); },
    value => { value.results[0].status = 'Skipped'; },
    value => { value.results[1] = value.results[0]; },
    value => { value.complete = false; },
    value => { value.selection[0].sourceDigest = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(report);
    alter(changed);
    assert.equal(reconcileCalculator(changed, expected, journal), false);
  }
  assert.equal(reconcileCalculator(report, expected, ''), false);
});

test('T-PRD087 calculator source selection includes declared growth and rejects unsupported or ambiguous selectors', () => {
  const expected = calculatorSelection(baselineCalculatorInventory);
  assert.equal(expected.length, 11);
  assert.deepEqual(calculatorArguments(expected), calculatorCommandArguments);
  const legacy = baselineCalculatorSources.flatMap(source =>
    [...source.contents.matchAll(/^test\('([^'\r\n]+)', \(\) => \{/gmu)].map(match => ({
      namespace: 'calculator', file: source.file, name: match[1], sourceDigest: digest(source.contents),
    })));
  assert.deepEqual(expected, legacy, 'Historical two-file selector identities and ordering remain unchanged');
  const extra = { file: 'test/calculator/test/additional.test.js',
    contents: `const test=require('node:test');test(${JSON.stringify(expected[0].name)},()=>{});` };
  const grown = calculatorFixtureInventory([...baselineCalculatorSources, extra]);
  assert.equal(grown.complete, true);
  assert.equal(calculatorSelection(grown).length, 12);
  assert.equal(calculatorSelection(grown).filter(test => test.name === expected[0].name).length, 2);
  assert.ok(calculatorArguments(calculatorSelection(grown)).includes(extra.file));
  const components = deriveNativeComponentSpecification({ inventory: grown, testPlan: plan,
    adapterSourceDigest: 'a'.repeat(64) });
  assert.equal(components.calculator.tests, 12);
  assert.equal(components.calculator.files.length, 3);
  assert.equal(nativeConfigurationDigest({ inventory: grown, profile: 'pr' }),
    nativeConfigurationDigest({ inventory: { complete: true, digest: grown.digest }, profile: 'pr',
      calculator: components.calculator }),
  'Component source/config replay binds the grown project rather than falling back to the eleven-test baseline');
  const appended = baselineCalculatorSources.map(source => ({ ...source }));
  appended[0].contents += "\ntest('added assertion with different quoting',()=>{});\n";
  assert.equal(calculatorSelection(calculatorFixtureInventory(appended)).length, 12);
  const nested = { ...extra, contents: "const test=require('node:test');" +
    "test('root',async t=>{await t.test('nested',()=>{});});" };
  assert.throws(() => calculatorSelection(calculatorFixtureInventory([...baselineCalculatorSources, nested])),
    /supported flat tests/u);
  const wrongCommand = structuredClone(grown);
  wrongCommand.independentProjects[0].command = ['node', '--test', 'test/calculator.test.js'];
  assert.throws(() => calculatorSelection(wrongCommand), /Every declared calculator test file/u);
});

test('T-PRD087 actual calculator command executes an added declared file and appended assertion without borrowing eleven-test success', async t => {
  const root = path.join(repositoryRoot, '.test-data', `calculator-growth-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const assets = ['calculator.js', 'index.html', 'styles.css', 'favicon.svg', 'favicon.ico',
    'docs/requirements.md', 'docs/test-plan.md', 'docs/technical-design.md'];
  for (const mode of ['declared-file', 'appended-assertion']) {
    const fixtureRoot = path.join(root, mode);
    await fs.mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, '.test-data'));
    await fs.copyFile(path.join(repositoryRoot, 'scripts', 'pr-calculator-reporter.mjs'),
      path.join(fixtureRoot, 'scripts', 'pr-calculator-reporter.mjs'));
    const selected = baselineCalculatorSources.map(source => ({ ...source }));
    const baselineName = calculatorSelection(baselineCalculatorInventory)[0].name;
    if (mode === 'declared-file') selected.push({
      file: 'test/calculator/test/additional.test.js',
      contents: "const test=require('node:test');const assert=require('node:assert/strict');" +
        `test(${JSON.stringify(baselineName)},()=>assert.equal(6*7,42));`,
    });
    else selected[0].contents += `\ntest(${JSON.stringify(baselineName + ' extended')},()=>assert.equal(6*7,42));\n`;
    for (const source of calculatorFixtureSources(selected)) {
      const file = path.join(fixtureRoot, ...source.file.split('/'));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, source.contents);
    }
    for (const asset of assets) {
      const destination = path.join(fixtureRoot, 'test', 'calculator', ...asset.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(repositoryRoot, 'test', 'calculator', ...asset.split('/')), destination);
    }
    const compiled = calculatorFixtureInventory(selected);
    const expected = calculatorSelection(compiled);
    const output = path.join(fixtureRoot, '.test-data', 'calculator.json');
    const report = await runCalculator({ root: fixtureRoot, output });
    const journal = await fs.readFile(`${output}.journal.ndjson`, 'utf8');
    assert.equal(report.exitCode, 0);
    assert.deepEqual(report.summary, { tests: 12, passed: 12, failed: 0, skipped: 0, cancelled: 0 });
    if (mode === 'declared-file') {
      assert.equal(new Set(report.results.filter(row => row.name === baselineName).map(row => row.file)).size, 2);
    }
    assert.equal(reconcileCalculator(report, expected, journal), true);
    assert.equal(reconcileCalculator(report, calculatorSelection(baselineCalculatorInventory), journal), false);
    const swapped = journal.trim().split('\n').map(JSON.parse);
    const terminal = swapped.find(event => event.type === 'test:pass' && event.data.nesting === 0);
    terminal.data.file = '/unrelated/test/calculator/test/not-declared.test.js';
    assert.equal(reconcileCalculator(report, expected, swapped.map(JSON.stringify).join('\n')), false);
    const renamed = structuredClone(report);
    renamed.results[0].name = renamed.results[0].name.slice(0, -1);
    assert.equal(reconcileCalculator(renamed, expected, journal), false);
  }
});

test('T-PRD021 native collector admits real isolated root originals with declared dependencies and rejects journal substitution', async t => {
  const root = path.join(repositoryRoot, '.test-data', `native-group-contract-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'test'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const file = 'test/group-contract.test.mjs';
  const source = `export const validationDeclarations=${JSON.stringify({ schemaVersion: 1, groups: [
    { root: 'second root', dependsOn: ['first root'], exclusiveResources: ['owned-resource'] },
    { root: 'first root', exclusiveResources: ['owned-resource'] },
  ] })};\n` +
    'import test from "node:test";import assert from "node:assert/strict";\n' +
    'test("first root",async t=>{await t.test("causal child",()=>assert.equal(1+1,2));});\n' +
    'test("second root",()=>assert.equal(2+2,4));\n';
  await fs.writeFile(path.join(root, ...file.split('/')), source);
  const declared = discoverDeclarations(source, file);
  assert.deepEqual(declared.unresolved, []);
  const inventory = { complete: true, files: [{ file }], cases: declared.cases,
    groupDeclarations: declared.declared.groups.map(group => ({ file, ...group })) };
  const selected = await createPlan(parseOptions(['targeted', '--workers', '2',
    path.join(root, ...file.split('/'))]), root);
  const output = path.join(root, 'original.json');
  const code = await runTests(selected, { reportPath: output });
  assert.equal(code, 0);
  const report = JSON.parse(await fs.readFile(output, 'utf8'));
  const journal = await fs.readFile(`${output}.journal.ndjson`, 'utf8');
  const stage = { name: 'unit', files: [file], cases: declared.cases };
  const target = process.platform === 'win32' ? 'windows-x64' :
    process.platform === 'darwin' ? `macos-${process.arch}` : 'linux-x64';
  assert.equal(validateNativeGroupReport({ inventory, stage, report, journal, target }).length, 2);
  assert.throws(() => validateNativeGroupReport({ inventory, stage, report,
    journal: journal.split('\n').filter(line => !line.includes('"kind":"group-start"')).join('\n'), target }),
  { code: 'EVIDENCE' });
});

test('T-PRD023 native ambient scratch checks every Git ancestor and rejects linked storage rather than inheriting checkout Git', async () => {
  const directory = path.join(repositoryRoot, '.test-data', 'virtual-native-ambient');
  const visited = [];
  const directoryStat = { isDirectory: () => true, isSymbolicLink: () => false };
  const lstat = async file => {
    visited.push(file);
    if (path.basename(file) === '.git') throw Object.assign(new Error('Absent marker'), { code: 'ENOENT' });
    return directoryStat;
  };
  await assertGitFreeAncestors(directory, { lstat });
  assert.ok(visited.includes(path.join(repositoryRoot, '.git')));
  assert.ok(visited.includes(path.join(path.parse(directory).root, '.git')));
  await assert.rejects(assertGitFreeAncestors(directory, { lstat: async file =>
    file === path.join(repositoryRoot, '.git') ? { isDirectory: () => false, isSymbolicLink: () => false } :
      lstat(file) }), { code: 'HOST' });
  await assert.rejects(assertGitFreeAncestors(directory, { lstat: async file =>
    file === path.dirname(directory) ? { isDirectory: () => true, isSymbolicLink: () => true } :
      lstat(file) }), { code: 'HOST' });
});

test('T-PRD016 private Linux library fixtures preserve frozen published bytes without adding a Linux distribution', async () => {
  const frozen = structuredClone(candidate);
  frozen.descriptor.sourceCommit = sourceRevision;
  for (const file of frozen.descriptor.files) file.size = 16;
  const before = structuredClone(frozen);
  let selected;
  const build = async input => {
    selected = input;
    return { outputDir: input.outputDir, archives: [
      ...frozen.descriptor.files.filter(file => file.kind === 'archive').map(file =>
        ({ ...file, target: file.filename.endsWith('-macos.tar.gz') ? 'macos' : 'windows-x64' })),
      { target: 'linux-x64', filename: 'private-linux-fixture.tar.gz', sha256: 'f'.repeat(64), size: 16 },
    ] };
  };
  const options = { candidate: frozen, candidateDir: path.join(repositoryRoot, '.test-data', 'virtual-candidate'),
    scratch: path.join(repositoryRoot, '.test-data', 'virtual-scratch'), windowsLauncher: 'owned-frozen-launcher',
    environment: {}, build };
  const fixtures = await prepareNativeHostFixtures(options);
  assert.equal(fixtures.kind, 'private-test-library-only');
  assert.equal(selected.artifact, path.join(options.candidateDir, 'assets', frozen.descriptor.payload.filename));
  assert.equal(selected.sourceCommit, sourceRevision);
  assert.deepEqual(selected.targets, ['macos', 'windows-x64', 'linux-x64']);
  assert.deepEqual(frozen, before);
  assert.ok(!nativeArtifacts(frozen).some(file => file.name.includes('linux')),
    'Native credit still binds only the unchanged frozen published asset inventory');
  await assert.rejects(prepareNativeHostFixtures({ ...options, build: async input => {
    const result = await build(input);
    result.archives[0].sha256 = 'e'.repeat(64);
    return result;
  } }), { code: 'EVIDENCE' });
  await assert.rejects(prepareNativeHostFixtures({ ...options, build: async input => {
    const result = await build(input);
    result.archives.pop();
    return result;
  } }), { code: 'EVIDENCE' });
});

test('T-PRD074 exact typed native source retains code and credential-negative fixtures without becoming sanitized log text', () => {
  const files = [{ file: 'test/controlled-source.test.mjs',
    contents: '\uFEFFconst fixture = {token:"fixture-value", headers:{Authorization:"Bearer fixture-token"}};\n' +
      'const reserved = "https://owner:dummy@example.test/path?sig=fixture-only-signature-value";\n' }];
  const original = Buffer.from(files[0].contents);
  assert.equal(validateNativeSourceDefinitions(files), files);
  assert.deepEqual(Buffer.from(files[0].contents), original);
  for (const text of [
    `"${'ghp_' + 'a'.repeat(36)}"`,
    `"${Buffer.from('{"alg":"HS256"}').toString('base64url')}.` +
      `${Buffer.from('{"fixture":true}').toString('base64url')}.fixtureSignature"`,
    `"https://github.com/fixture/repo?token=${'a'.repeat(40)}"`,
    `"-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----"`,
  ]) {
    assert.throws(() => validateNativeSourceDefinitions([{ file: 'src/unsafe-source.mjs', contents: text }]),
      error => error.code === 'UNSAFE' && !error.message.includes(text));
  }
});
function fixture(profile = 'pr', frozenCandidate = candidate, components = false) {
  const artifacts = nativeArtifacts(frozenCandidate);
  const parts = components ? nativeLegacyPrParts : targets.map(target => ({ target, component: 'full', role: target }));
  const lanes = parts.map(({ target, component, role }) => {
    const specification = nativeSpecification({ plan, inventory, goSources: sources, target, profile, component });
    const context = {
      candidateDigest: digest('candidate'), testSpecDigest: digest('specification'), configDigest: digest(profile),
      inventoryDigest: validationInventoryDigest(specification),
      sources: [{ repositoryId: 'repository-123', revision: sourceRevision, contentDigest: digest('source-tree') }],
      profile: specification.profile, environment: 'local',
      location: specification.cases[0].location, mode: 'automated', owner: 'provider',
      native: { kind: 'native', platform: nativePlatforms[target],
        architecture: target === 'macos-arm64' ? 'arm64' : 'x64', image: `actual-${target}/20261019.1`,
        toolchain: { node: nativeToolchain.node, go: 'go version go1.27.1 fixture-native',
          python: 'Python 3.12.10', resources: nativeResourceFacts({
            availableParallelism: 4, totalMemoryBytes: 8 * 1024 ** 3, configuredWorkers: null,
          }) } },
      producer: { provider: 'github', connection: 'repository-ci', scopeRef: 'repository:123',
        definitionRef: 'fixture/repo/.github/workflows/ci.yml@refs/pull/7/merge',
        executionRef: '12345', attemptKind: 'known', attemptRef: '1' },
      attemptCapability: 'distinct', jobRef: `native-${role}`, artifacts: structuredClone(artifacts),
      ...(profile === 'r-pre' ? { intentId: 'release-fixture-1' } : {}),
    };
    return { target, component, specification, context };
  });
  const expected = { profile, sourceRevision, artifacts, components,
    executions: lanes.map(({ target, component, context }) => ({ target, component, context: structuredClone(context) })) };
  const report = (lane, mutate = () => {}) => {
    const observedAt = new Date(Date.now() - 1000).toISOString();
    const raw = { schemaVersion: 1, kind: 'test-execution', context: structuredClone(lane.context),
      startedAt: observedAt, finishedAt: observedAt, observedAt, sequence: 1, complete: true, exitCode: 0,
      results: lane.specification.cases.flatMap(test => test.assertions.map(assertion => ({
        testId: test.id, assertionId: assertion.id, selector: structuredClone(assertion.selector),
        status: 'Passed', expectedMet: true, expectedDigest: test.expectedDigest, checkpoint: test.checkpoint,
        observedAt, sourceSequence: 1, durationMs: 1, exitCode: 0,
      }))) };
    mutate(raw);
    return raw;
  };
  const evaluate = (lane, mutate, spec = lane.specification) => {
    const raw = report(lane, mutate);
    raw.context.inventoryDigest = validationInventoryDigest(spec);
    const normalized = normalizeExecutionReport(raw, raw.context, input => ({
      verifierId: 'fixture-native-host', reportDigest: input.reportDigest, context: raw.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    return evaluateReadiness(spec, [normalized], { profile: spec.profile,
      executions: [{ id: raw.context.jobRef, context: raw.context }], now: new Date().toISOString(),
      policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-native-host'] } });
  };
  const passing = () => lanes.map(lane => ({ target: lane.target, component: lane.component, evaluation: evaluate(lane) }));
  return { lanes, expected, report, evaluate, passing };
}

test('T-PRD016 PR Mac components partition the complete original framework closure and reject non-PR partial requests', () => {
  const environment = { EXPECTED_SOURCE_COMMIT: sourceRevision,
    EXPECTED_DESCRIPTOR_SHA256: 'a'.repeat(64), EXPECTED_CHECKSUMS_SHA256: 'b'.repeat(64) };
  const selectedInventory = { ...inventory, digest: digest('component-causal-fixture'),
    cases: [...inventory.cases, { ...inventory.cases[0], id: 'distribution-child',
      name: 'retained causal child', parents: [inventory.cases[0].name] }] };
  for (const target of ['macos-arm64', 'macos-x64']) {
    const options = { target, profile: 'pr', candidateDir: '.test-data/component-candidate',
      evidenceDir: '.test-data/component-evidence', buildCandidate: false, component: 'framework' };
    assert.equal(validateNativeRequest(options, environment).component, 'framework');
    assert.equal(parseNativeOptions(['--component', 'homebrew']).component, 'homebrew');
    for (const delta of [
      { target: 'linux-x64' }, { target: 'windows-x64' }, { profile: 'r-pre' },
      { phase: 'candidate' }, { buildCandidate: true }, { component: 'unknown' }, { component: '' },
    ]) assert.throws(() => validateNativeRequest({ ...options, ...delta }, environment), { code: 'INPUT' });
    const inputs = { plan, inventory: selectedInventory, goSources: sources, target, profile: 'pr' };
    const full = nativeSpecification(inputs);
    assert.deepEqual(full, nativeSpecification({ ...inputs, component: 'full' }),
      'The existing whole-native CLI profile, selectors and execution identities are unchanged');
    const framework = nativeSpecification({ ...inputs, component: 'framework' });
    const homebrew = nativeSpecification({ ...inputs, component: 'homebrew' });
    assert.deepEqual(framework.cases[0].assertions,
      full.cases[0].assertions.filter(assertion => assertion.selector.procedure !== 'native-homebrew'));
    assert.deepEqual(homebrew.cases[0].assertions,
      full.cases[0].assertions.filter(assertion =>
        ['native-homebrew', 'frozen-artifacts'].includes(assertion.selector.procedure)));
    assert.equal(framework.cases.length, 1);
    assert.match(framework.cases[0].id, /^T-PRD014-/u);
    assert.equal(homebrew.cases.length, 1);
    assert.match(homebrew.cases[0].id, /^T-PRD060-/u);
    assert.equal(homebrew.cases[0].assertions.some(assertion => assertion.selector.file), false);
    assert.deepEqual(framework.cases[0].assertions.filter(assertion => assertion.selector.file && !assertion.selector.tool)
      .map(assertion => assertion.id), selectedInventory.cases.map(assertion => assertion.id));
    assert.deepEqual(framework.cases[0].assertions.find(assertion => assertion.id === 'distribution-child').selector.parents,
      [inventory.cases[0].name], 'The native root and descendant identities remain in one unchanged framework closure');
    assert.notEqual(nativeConfigurationDigest({ inventory, profile: 'pr', component: 'framework' }),
      nativeConfigurationDigest({ inventory, profile: 'pr', component: 'homebrew' }));
    const release = nativeSpecification({ ...inputs, profile: 'r-pre' });
    assert.deepEqual(release, nativeSpecification({ ...inputs, profile: 'r-pre', component: 'full' }));
    assert.ok(release.cases[0].assertions.some(assertion => assertion.selector.procedure === 'native-homebrew'));
    assert.throws(() => nativeSpecification({ ...inputs, profile: 'r-pre', component: 'homebrew' }), { code: 'INPUT' });
    assert.equal(framework.cases[0].executionId, `native-${nativeProducerRole(target, 'framework')}`);
  }
});

test('T-PRD016 six PR producer parts require both exact Mac originals and reject duplicate swapped failed or stale parts', () => {
  const f = fixture('pr', candidate, true);
  const passing = f.passing();
  const result = aggregateNativeReadiness(passing, f.expected);
  assert.equal(result.status, 'Passed');
  assert.equal(result.requiredParts.length, 6);
  assert.equal(result.requiredCases.length, 7);
  assert.equal(aggregateNativeReadiness(passing.slice(0, -1), f.expected).status, 'NotRun');
  assert.equal(aggregateNativeReadiness([...passing, passing[2]], f.expected).status, 'NotRun');
  const swapped = [...passing];
  swapped[2] = { ...passing[2], component: 'homebrew' };
  assert.equal(aggregateNativeReadiness(swapped, f.expected).status, 'NotRun');
  const index = f.lanes.findIndex(lane => lane.component === 'homebrew');
  assert.throws(() => f.evaluate(f.lanes[index], raw => {
    raw.context.jobRef = `native-${f.lanes[index].target}-framework`;
  }), { code: 'EVIDENCE', message: 'Case execution owner/location/checkpoint differs from the expected producer' });
  for (const mutate of [
    raw => { raw.context.sources[0].revision = 'b'.repeat(40); },
    raw => { raw.context.producer.attemptRef = '2'; },
    raw => { raw.context.artifacts[0].sha256 = 'f'.repeat(64); },
    raw => { raw.results[0].status = 'Skipped'; raw.results[0].expectedMet = null; },
    raw => { raw.results[0].status = 'Failed'; raw.results[0].expectedMet = false;
      raw.results[0].exitCode = 1; raw.exitCode = 1; },
  ]) {
    const changed = [...passing];
    changed[index] = { ...passing[index], evaluation: f.evaluate(f.lanes[index], mutate) };
    assert.equal(aggregateNativeReadiness(changed, f.expected).status, 'NotRun');
  }
});

test('T-PRD016 twenty-five native shard selections preserve complete root unions and require both actual Intel unit origins', async t => {
  const f = await observerApiFixture(t, { frameworkShards: true });
  assert.equal(f.parts.size, 25);
  const request = { target: 'linux-x64', profile: 'pr', component: 'framework', shard: 'units',
    candidateDir: '.test-data/shard-candidate', evidenceDir: '.test-data/shard-evidence' };
  const environment = { EXPECTED_SOURCE_COMMIT: f.revisions.merge,
    EXPECTED_DESCRIPTOR_SHA256: 'a'.repeat(64), EXPECTED_CHECKSUMS_SHA256: 'b'.repeat(64) };
  assert.equal(validateNativeRequest(request, environment).shard, 'units');
  for (const delta of [{ shard: 'body-4' }, { shard: '' }, { component: 'full' },
    { component: 'homebrew' }, { profile: 'r-pre' }, { phase: 'candidate' }, { buildCandidate: true }]) {
    assert.throws(() => validateNativeRequest({ ...request, ...delta }, environment), { code: 'INPUT' });
  }
  assert.equal(parseNativeOptions(['--framework-shard', 'body-1']).shard, 'body-1');
  assert.equal(validateNativeRequest({ ...request, shard: 'body-3' }, environment).shard, 'body-3');
  for (const shardProtocol of [nativeLegacyFrameworkShardProtocol, nativePlatformUnitFrameworkShardProtocol]) {
    assert.throws(() => nativeSpecification({ plan: f.source.plan, inventory: f.source.inventory,
      goSources: f.source.goSources, target: 'linux-x64', profile: 'pr',
      component: 'framework', shard: 'body-3', shardProtocol }), { code: 'INPUT' });
  }
  for (const target of targets) {
    const assignment = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan, target });
    const selected = assignment.parts.flatMap(part => part.assertionIds);
    assert.deepEqual([...selected].sort(), f.source.inventory.cases.map(test => test.id).sort());
    assert.equal(new Set(selected).size, selected.length);
    assert.equal(assignment.parts.filter(part => part.go).length, 1);
    assert.equal(assignment.parts.find(part => part.shard === 'refresh').assertionIds.length, 1);
    assert.equal(assignment.parts.length, target === 'macos-arm64' ? 5 : 6);
    assert.ok(assignment.parts.filter(part => part.shard.startsWith('body-')).every(part => part.assertionIds.length));
    const unitShards = nativeFrameworkUnitShardNames(target);
    assert.ok(assignment.parts.every(part => digest(part.prerequisites) === digest(unitShards.includes(part.shard) ?
      [] : unitShards.map(shard => nativeProducerRole(target, 'framework', shard)))));
    const unitParts = assignment.parts.filter(part => unitShards.includes(part.shard));
    const stageSelection = nativeStageSelections(f.source.inventory, f.source.plan);
    assert.deepEqual(unitParts.flatMap(part => part.stages.filter(stage => stage.name === 'unit'))
      .flatMap(stage => stage.cases.map(test => test.id)),
    stageSelection.find(stage => stage.name === 'unit').cases.map(test => test.id),
    'Canonical assertions execute once, on the original units producer');
    assert.deepEqual(unitParts.flatMap(part => part.stages.filter(stage => stage.name === 'required-units'))
      .flatMap(stage => stage.cases.map(test => test.id)).sort(),
    stageSelection.find(stage => stage.name === 'required-units').cases.map(test => test.id).sort());
    assert.ok(unitParts.every(part => part.stages.every(stage => stage.cases.length > 0)));
    const fourBody = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target, protocol: nativeFourBodyFrameworkShardProtocol });
    assert.deepEqual(fourBody.parts.filter(part => part.shard !== 'units').map(part => part.assertionIds),
      assignment.parts.filter(part => !unitShards.includes(part.shard)).map(part => part.assertionIds),
      'The new unit host does not move regression roots or change the refresh boundary');
    const global = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target, protocol: nativeLegacyFrameworkShardProtocol });
    const previous = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target, protocol: nativePlatformUnitFrameworkShardProtocol });
    assert.notEqual(global.digest, assignment.digest);
    assert.deepEqual(global.parts.map(part => part.assertionIds), previous.parts.map(part => part.assertionIds));
    assert.equal(previous.parts.length, target.startsWith('macos-') ? 5 : 4);
    assert.deepEqual(global.parts.flatMap(part => part.assertionIds).sort(), [...selected].sort());
    assert.ok(previous.parts.every(part => digest(part.prerequisites) === digest(part.shard === 'units' ?
      [] : [nativeProducerRole(target, 'framework', 'units')])));
    assert.ok(global.parts.filter(part => part.shard !== 'units').every(part => part.prerequisites.length === 4));
  }
  const executions = [...f.parts.values()].map(part => ({
    target: part.target, component: part.component, shard: part.shard, context: part.context,
    job: f.jobs.find(job => job.name === `native-${part.role}`),
  }));
  const unitOrder = verifyNativeShardUnitOrder(executions);
  const evaluations = [...f.parts.values()].map(part => {
    const raw = part.data.get('execution.json');
    const report = normalizeExecutionReport(raw, part.context, input => ({
      verifierId: 'controlled-shard-origin', reportDigest: input.reportDigest, context: part.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    return { target: part.target, component: part.component, shard: part.shard,
      evaluation: evaluateReadiness(part.specification, [report], {
        profile: part.specification.profile, executions: [{ id: part.context.jobRef, context: part.context }],
        now: new Date(Date.parse(raw.observedAt) + 1000).toISOString(),
        policy: { maxAgeMs: 86400000, revisionPolicy: 'exact', verifierIds: ['controlled-shard-origin'] },
      }) };
  });
  const expected = { profile: 'pr', components: true, frameworkShards: true,
    sourceRevision: f.revisions.merge, artifacts: nativeArtifacts(f.candidate), executions,
    inventory: f.source.inventory, plan: f.source.plan, goSources: f.source.goSources, unitOrder };
  assert.equal(aggregateNativeReadiness(evaluations, expected).status, 'Passed');
  const passInputs = { inventory: structuredClone(expected.inventory), plan: expected.plan,
    goSources: structuredClone(expected.goSources), shardProtocol: nativeFrameworkShardProtocol,
    frameworkShards: true };
  const runPass = nativePass.withNativeDefinitionPass ?? (async (inputs, read) => read(inputs));
  let firstBaseline;
  let escapedInputs;
  let release;
  let late;
  await runPass(passInputs, async owned => {
    escapedInputs = owned;
    const request = { ...owned, target: 'linux-x64', profile: 'pr', component: 'framework', shard: 'body-0' };
    const baseline = nativeSpecification(request);
    assert.deepEqual(baseline, nativeSpecification({ ...request,
      inventory: structuredClone(owned.inventory), goSources: structuredClone(owned.goSources) }));
    assert.strictEqual(nativeSpecification(request), baseline,
      'One immutable SDK pass must derive each pure native baseline only once');
    firstBaseline = baseline;
    const assignment = nativePass.nativeExpectedAssignment({
      inventory: owned.inventory, plan: owned.plan, target: 'linux-x64',
    });
    assert.strictEqual(nativePass.nativeExpectedAssignment({
      inventory: owned.inventory, plan: owned.plan, target: 'linux-x64',
    }), assignment);
    assert.throws(() => owned.inventory.cases[0].parents.push('altered private source'), TypeError);
    assert.throws(() => baseline.cases[0].assertions.pop(), TypeError);
    passInputs.inventory.cases[0].parents.push('altered external source');
    assert.throws(() => nativeSpecification({ ...request, inventory: passInputs.inventory }));
    assert.strictEqual(nativeSpecification(request), baseline);
    const changedGo = structuredClone(owned.goSources);
    changedGo[0].contents += '\nfunc TestDifferentPass(t *testing.T) {}\n';
    const whole = { ...request, component: 'full', shard: null };
    assert.throws(() => nativeSpecification({ ...whole, goSources: changedGo }),
      /Go declarations must cover every current test function/u);
    assert.strictEqual(nativeSpecification(request), baseline);
    for (const delta of [
      { target: 'foreign-platform' }, { shard: 'body-7' }, { shardProtocol: 'unknown-protocol' },
    ]) assert.throws(() => nativeSpecification({ ...request, ...delta }));
    const blocked = new Promise(resolve => { release = resolve; });
    late = (async () => {
      await blocked;
      return nativeSpecification(request);
    })();
  });
  release();
  assert.notStrictEqual(await late, firstBaseline,
    'An async descendant cannot retain a completed pass cache');
  await runPass({ ...passInputs, inventory: structuredClone(expected.inventory) }, async owned => {
    const baseline = nativeSpecification({ ...owned, target: 'linux-x64', profile: 'pr',
      component: 'framework', shard: 'body-0' });
    assert.deepEqual(baseline, firstBaseline);
    assert.notStrictEqual(baseline, firstBaseline, 'A fresh SDK observation starts a fresh private pass');
  });
  assert.notStrictEqual(nativeSpecification({ ...escapedInputs, target: 'linux-x64', profile: 'pr',
    component: 'framework', shard: 'body-0' }), firstBaseline);
  const unsafe = { ...passInputs, inventory: structuredClone(expected.inventory) };
  Object.defineProperty(unsafe.inventory, 'complete', { enumerable: true, get() {
    throw new Error('Executable source must not run');
  } });
  await assert.rejects(runPass(unsafe, () => assert.fail('Unsafe input reached the pass')), { code: 'EVIDENCE' });
  const schedulingSource = await fs.readFile(new URL('../scripts/test-scheduling.mjs', import.meta.url), 'utf8');
  const historicalPolicy = sourceValidationSchedulingPolicy([{ file: 'scripts/test-scheduling.mjs',
    contents: schedulingSource.replace("  'public-readiness-pr-description.test.mjs',\n", '')
      .replace("  'public-readiness-native.test.mjs',\n", '')
      .replace("schemaVersion: 9, algorithm: 'source-bound-ready-root-v9'",
        "schemaVersion: 6, algorithm: 'source-bound-ready-root-v6'").replace('; demand-first-ready-backfill', ''),
  }]);
  assert.equal(historicalPolicy.schemaVersion, 6, 'The fixture must select the historical policy, not silently retest the current one');
  for (const schedulingPolicy of [historicalPolicy, validationSchedulingPolicy]) {
    const inputs = { ...passInputs, inventory: structuredClone(expected.inventory), schedulingPolicy };
    const request = { ...inputs, target: 'linux-x64', profile: 'pr', component: 'framework', shard: 'body-0' };
    const original = nativeSpecification(request);
    const originalAssignment = nativeFrameworkShardPlan({
      inventory: inputs.inventory, plan: inputs.plan, target: 'linux-x64', schedulingPolicy,
    });
    await runPass(inputs, async owned => {
      const selected = { ...request, ...owned };
      const baseline = nativeSpecification(selected);
      assert.deepEqual(baseline, original);
      assert.strictEqual(nativeSpecification(selected), baseline);
      assert.strictEqual(owned.schedulingPolicy, schedulingPolicy,
        'Independently source-selected scheduling authority must retain its recognized identity');
      assert.deepEqual(nativePass.nativeExpectedAssignment({
        inventory: owned.inventory, plan: owned.plan, target: 'linux-x64', schedulingPolicy: owned.schedulingPolicy,
      }), originalAssignment);
    });
    await assert.rejects(runPass({ ...inputs, schedulingPolicy: structuredClone(schedulingPolicy) },
      () => assert.fail('Equal JSON must not become recognized scheduling authority')), { code: 'EVIDENCE' });
  }
  assert.equal(unitOrder.protocol, nativeFrameworkShardProtocol);
  assert.equal(aggregateNativeReadiness(evaluations, expected).requiredCases.length, 7);
  assert.equal(aggregateNativeReadiness(evaluations.slice(0, -1), expected).status, 'NotRun');
  assert.equal(aggregateNativeReadiness([...evaluations, evaluations[0]], expected).status, 'NotRun');
  const swapped = [...evaluations];
  swapped[1] = { ...swapped[1], shard: 'units' };
  assert.equal(aggregateNativeReadiness(swapped, expected).status, 'NotRun');
  assert.throws(() => aggregateNativeReadiness(evaluations,
    { ...expected, unitOrder: JSON.parse(JSON.stringify(unitOrder)) }), { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol: nativeLegacyFrameworkShardProtocol }),
    { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol: nativePlatformUnitFrameworkShardProtocol }),
    { code: 'EVIDENCE' });
  assert.throws(() => aggregateNativeReadiness(evaluations, { ...expected,
    shardProtocol: nativePlatformUnitFrameworkShardProtocol }),
    { code: 'INPUT' });
  const staggered = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  const intelUnit = staggered.find(part => part.target === 'macos-x64' && part.shard === 'units');
  intelUnit.job.completed_at = '2026-10-18T10:01:50.000Z';
  for (const part of staggered.filter(part => part.target === 'macos-x64' &&
    part.shard && !nativeFrameworkUnitShardNames(part.target).includes(part.shard))) {
    part.job.started_at = '2026-10-18T10:02:00.000Z';
  }
  assert.equal(verifyNativeShardUnitOrder(staggered).protocol, nativeFrameworkShardProtocol);
  assert.throws(() => verifyNativeShardUnitOrder(staggered, { protocol: nativeLegacyFrameworkShardProtocol }),
    { code: 'EVIDENCE' });
  intelUnit.job.status = 'in_progress';
  assert.throws(() => verifyNativeShardUnitOrder(staggered), { code: 'EVIDENCE' });
  const early = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  early.find(part => part.shard === 'refresh').job.started_at = early[0].job.started_at;
  assert.throws(() => verifyNativeShardUnitOrder(early), { code: 'EVIDENCE' });
  const failed = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  failed[0].job.conclusion = 'failure';
  assert.throws(() => verifyNativeShardUnitOrder(failed), { code: 'EVIDENCE' });
  failed[0].job.conclusion = 'skipped';
  assert.throws(() => verifyNativeShardUnitOrder(failed), { code: 'EVIDENCE' });
  failed[0].job.conclusion = 'success';
  failed[0].job.run_attempt++;
  assert.throws(() => verifyNativeShardUnitOrder(failed), { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions.slice(1)), { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol: 'unknown' }), { code: 'EVIDENCE' });
  const duplicateJobs = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  duplicateJobs[1].job.id = duplicateJobs[0].job.id;
  assert.throws(() => verifyNativeShardUnitOrder(duplicateJobs), { code: 'EVIDENCE' });
  const intelExtra = executions.find(part => part.target === 'macos-x64' && part.shard === 'units-1');
  for (const mutate of [
    job => { job.conclusion = 'failure'; },
    job => { job.conclusion = 'cancelled'; },
    job => { job.conclusion = 'skipped'; },
    job => { job.run_attempt++; },
    job => { job.run_id++; },
  ]) {
    const changed = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
    mutate(changed.find(part => part.target === 'macos-x64' && part.shard === 'units-1').job);
    assert.throws(() => verifyNativeShardUnitOrder(changed), { code: 'EVIDENCE' });
  }
  const foreign = executions.map(part => ({ ...part, context: structuredClone(part.context) }));
  foreign.find(part => part.target === 'macos-x64' && part.shard === 'units-1')
    .context.sources[0].revision = 'f'.repeat(40);
  assert.throws(() => aggregateNativeReadiness(evaluations, { ...expected, executions: foreign }),
    { code: 'EVIDENCE' });
  for (const shard of ['refresh', 'body-0', 'body-1', 'body-2']) {
    const earlyIntel = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
    earlyIntel.find(part => part.target === 'macos-x64' && part.shard === shard).job.started_at =
      new Date(Date.parse(intelExtra.job.completed_at) - 1000).toISOString();
    assert.throws(() => verifyNativeShardUnitOrder(earlyIntel), { code: 'EVIDENCE' },
      `${shard} must wait for the second Intel units producer, not just the original`);
  }
  assert.throws(() => verifyNativeShardUnitOrder(executions.filter(part => part !== intelExtra)), { code: 'EVIDENCE' });
  const extraEvaluation = evaluations.findIndex(part => part.target === 'macos-x64' && part.shard === 'units-1');
  assert.equal(aggregateNativeReadiness(evaluations.filter((_, index) => index !== extraEvaluation),
    expected).status, 'NotRun', 'Six of seven Intel parts cannot pass the logical lane');
  assert.equal(nativePrPartsForProtocol(nativeLegacyFrameworkShardProtocol).length, 20);
  assert.equal(nativePrPartsForProtocol(nativePlatformUnitFrameworkShardProtocol).length, 20);
  assert.equal(nativePrPartsForProtocol(nativeFourBodyFrameworkShardProtocol).length, 24);
  assert.equal(f.calls.length, 0, 'No provider, native toolchain or Python execution is needed for this controlled proof');
});

test('T-PRD016 split native units execute disjoint complete root closures with real isolated Node workers', async t => {
  const f = await observerApiFixture(t, { frameworkShards: true });
  const sourceFiles = [...f.source.files].map(([file, contents]) => ({ file, contents: contents.replace(
    'throw new Error("candidate test source must never execute in the trusted observer");', '') }));
  const extended = sourceFiles.filter(source => /observer-(?:critical|unplanned)\.unit\.test\.mjs$/u.test(source.file));
  const firstRoot = f.source.names.find(test => test.file === extended[0].file).name;
  extended[0].contents = `export const validationDeclarations=${JSON.stringify({ schemaVersion: 1, groups: [
    { root: firstRoot, exclusiveResources: ['owned-unit-fixture'] },
    { root: 'dependent unit root', dependsOn: [firstRoot], exclusiveResources: ['owned-unit-fixture'] },
  ] })};\nimport test from 'node:test';import assert from 'node:assert/strict';\n` +
    `test(${JSON.stringify(firstRoot)},async t=>{await t.test('complete child',()=>assert.equal(2+2,4));});\n` +
    "test('dependent unit root',()=>assert.equal(3+3,6));\n";
  const testPaths = new Set(validationSourcePaths(sourceFiles.map(source => source.file)));
  const inventory = compileValidationSourceInventory({ files: sourceFiles.filter(source => testPaths.has(source.file)),
    surfacePaths: sourceFiles.map(source => source.file) });
  assert.equal(inventory.complete, true, JSON.stringify(inventory.unresolved));
  const assignment = nativeFrameworkShardPlan({ inventory, plan: f.source.plan, target: 'macos-x64' });
  const units = assignment.parts.filter(part => nativeFrameworkUnitShardNames('macos-x64').includes(part.shard));
  const actual = [];
  const target = process.platform === 'win32' ? 'windows-x64' :
    process.platform === 'darwin' ? `macos-${process.arch}` : 'linux-x64';
  for (const part of units) for (const stage of part.stages) {
    for (const file of stage.files) {
      const source = sourceFiles.find(source => source.file === file);
      const destination = path.join(f.root, ...file.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, source.contents.replace(
        'throw new Error("candidate test source must never execute in the trusted observer");', ''));
    }
    const selected = await createPlan(parseOptions(['targeted', '--workers', '2',
      ...(stage.name === 'unit' ? [] : ['--name', stage.selectorName]),
      ...stage.files.map(file => path.join(f.root, ...file.split('/')))]), f.root);
    const reportPath = path.join(f.root, `${part.shard}-${stage.name}.json`);
    assert.equal(await runTests(selected, { reportPath }), 0);
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    const journal = await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8');
    validateNativeGroupReport({ inventory, stage, report, journal, target });
    actual.push(...report.executions.filter(row => row.status === 'Passed').map(row =>
      [row.file, row.parents, row.name]));
  }
  const selectedCases = units.flatMap(part => part.stages.flatMap(stage => stage.cases));
  assert.deepEqual(actual.map(digest).sort(),
    selectedCases.map(test => digest([test.file, test.parents, test.name])).sort());
  assert.equal(new Set(actual.map(digest)).size, actual.length);
  assert.ok(actual.some(([, parents, name]) => parents[0] === firstRoot && name === 'complete child'));
  const conflicting = structuredClone(inventory);
  conflicting.groupDeclarations.push({ file: extended[1].file,
    root: f.source.names.find(test => test.file === extended[1].file).name,
    exclusiveResources: ['owned-unit-fixture'] });
  assert.throws(() => nativeFrameworkShardPlan({ inventory: conflicting,
    plan: f.source.plan, target: 'macos-x64' }), { code: 'INVENTORY' },
  'Cross-host shared exclusive resources must be rejected rather than split');
});

test('T-PRD004 native policy rejects fixture, metadata and cross-build credit and uses protected evaluation inputs', () => {
  const f = fixture();
  assert.equal(aggregateNativeReadiness(f.passing(), f.expected).status, 'Passed');
  for (const kind of ['fixture', 'cross-build', 'metadata']) {
    const evaluations = f.passing();
    evaluations[2] = { target: f.lanes[2].target, context: f.lanes[2].context,
      evaluation: f.evaluate(f.lanes[2], raw => { raw.context.native.kind = kind; }) };
    assert.equal(evaluations[2].evaluation.status, 'Passed', 'Generic fixture truth is distinct from native policy');
    assert.equal(aggregateNativeReadiness(evaluations, f.expected).status, 'NotRun');
  }
  const forged = f.passing();
  forged[0].evaluation = JSON.parse(JSON.stringify(forged[0].evaluation));
  assert.throws(() => aggregateNativeReadiness(forged, f.expected), { code: 'EVIDENCE' });
  const lane = f.lanes[0];
  const unverified = normalizeExecutionReport(f.report(lane), lane.context);
  for (const report of [unverified, JSON.parse(JSON.stringify(unverified))]) {
    const evaluation = evaluateReadiness(lane.specification, [report], {
      profile: lane.specification.profile,
      executions: [{ id: `native-${lane.target}`, context: lane.context }], now: new Date().toISOString(),
      policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-native-host'] },
    });
    assert.equal(evaluation.status, 'NotRun', 'Data-only Passed outcomes cannot supply their own origin proof');
  }
  assert.throws(() => validateBootstrapRequest({ target: 'foreign-platform', outputDir: '.test-data/never-created' }),
    { code: 'HOST' });
  const componentPlan = expected => JSON.stringify({ tests: ['T-FIX-FIRST', 'T-FIX-SECOND'].map((id, index) => ({
    id, requirements: ['FR-203'], conditions: ['AC-203.4'], environment: 'local', level: 'integration',
    checkpoint: 'post-review', mode: index ? 'manual' : 'automated', owner: index ? 'user' : 'provider',
    location: 'github-pr-matrix', expected, implementation: 'procedure: controlled-component-selection',
    status: 'NotRun',
  })) });
  const selections = [];
  for (const expected of ['Complete original source outcomes', 'Freshly revised source expectations']) {
    const definition = deriveNativeComponentSpecification({ inventory, testPlan: componentPlan(expected),
      adapterSourceDigest: 'a'.repeat(64) });
    const expectedLanes = f.lanes.map(lane => ({ target: lane.target, context: {
      ...lane.context, testSpecDigest: definition.testSpecDigest,
      configDigest: nativeConfigurationDigest({ inventory, target: lane.target, profile: 'pr' }),
    } }));
    const selected = nativeComponentSelection({ definition, expectedLanes, now: '2026-10-18T10:10:00.000Z' });
    const matrix = expectedLanes.map(({ target, context }) => ({
      target, contextDigest: digest(context), platform: context.native.platform,
      architecture: context.native.architecture, image: context.native.image,
      toolchainDigest: digest(context.native.toolchain),
    }));
    for (const [index, execution] of selected.executions.entries()) {
      const test = definition.specification.cases[index];
      assert.deepEqual(execution, { id: test.executionId, context: validateExecutionContext({
        candidateDigest: expectedLanes[0].context.candidateDigest, testSpecDigest: definition.testSpecDigest,
        configDigest: digest({ adapter: definition.adapterDefinitionDigest, matrix }),
        inventoryDigest: validationInventoryDigest(definition.specification),
        sources: expectedLanes[0].context.sources, profile: definition.specification.profile,
        environment: 'local', location: definition.policy.location, mode: test.mode, owner: test.owner,
        native: { kind: 'metadata', platform: 'verified-native-matrix', architecture: 'x64-and-arm64',
          image: 'derived-from-four-native-jobs', toolchain: {
            adapter: definition.policy.protocol, adapterDefinitionDigest: definition.adapterDefinitionDigest, matrix,
          } },
        producer: expectedLanes[0].context.producer,
        attemptCapability: expectedLanes[0].context.attemptCapability,
        jobRef: `native-component-projection/${test.id}`, artifacts: expectedLanes[0].context.artifacts,
      }) });
    }
    assert.notEqual(selected.executions[0].context.mode, selected.executions[1].context.mode);
    assert.notEqual(selected.executions[0].context.owner, selected.executions[1].context.owner);
    const empty = structuredClone(definition);
    empty.specification.cases = [];
    const { adapterDefinitionDigest, ...emptyInputs } = empty;
    empty.adapterDefinitionDigest = digest(emptyInputs);
    assert.throws(() => nativeComponentSelection({ definition: empty, expectedLanes: [],
      now: selected.now }), { code: 'INPUT', message: 'Invalid required profile cases' },
    'An empty specification must fail before lane or per-case digest derivation');
    assert.throws(() => nativeComponentSelection({ definition: { ...definition, adapterDefinitionDigest: '0'.repeat(64) },
      expectedLanes: [], now: selected.now }), { code: 'EVIDENCE' });
    assert.throws(() => nativeComponentSelection({ definition, expectedLanes: expectedLanes.slice(1),
      now: selected.now }), { code: 'EVIDENCE' });
    selections.push(selected);
  }
  assert.notEqual(selections[0].executions[0].context.configDigest, selections[1].executions[0].context.configDigest);
  assert.notEqual(selections[0].executions[0].context.inventoryDigest, selections[1].executions[0].context.inventoryDigest);
});

test('T-PRD016 native aggregation closes four platforms and six PR or four R-PRE cases without JSON Passed bypasses', () => {
  for (const profile of ['pr', 'r-pre']) {
    const f = fixture(profile);
    const passing = f.passing();
    const good = aggregateNativeReadiness(passing, f.expected);
    assert.equal(good.status, 'Passed');
    assert.equal(good.requiredCases.filter(id => id !== 'T-PRD087').length, profile === 'pr' ? 6 : 4);
    assert.equal(good.requiredCases.includes('T-PRD087'), profile === 'pr');
    assert.equal(aggregateNativeReadiness(passing.slice(0, -1), f.expected).status, 'NotRun');
    assert.equal(aggregateNativeReadiness([...passing, passing[0]], f.expected).status, 'NotRun');
    assert.equal(aggregateNativeReadiness([...passing.slice(0, -1), { ...passing[3], target: 'macos-universal' }],
      f.expected).status, 'NotRun');
    for (const mutate of [
      raw => { raw.context.sources[0].revision = 'b'.repeat(40); },
      raw => { raw.context.sources[0].repositoryId = 'foreign-repository'; },
      raw => { raw.context.testSpecDigest = digest('changed native specification'); },
      raw => { raw.context.configDigest = digest('changed native configuration'); },
      raw => { raw.context.producer.attemptRef = '2'; },
      raw => { raw.context.native.architecture = 'arm64'; },
      raw => { raw.context.artifacts[2].sha256 = 'f'.repeat(64); },
      raw => { raw.context.artifacts.pop(); },
      raw => { raw.context.artifacts.push({ name: 'undeclared.tgz', sha256: 'f'.repeat(64) }); },
      raw => { raw.context.native.toolchain.node = '22.23.3'; },
      raw => { raw.context.native.toolchain.python = 'Python 3.13.0'; },
      raw => { raw.results[0].status = 'Failed'; raw.results[0].expectedMet = false; raw.results[0].exitCode = 1; raw.exitCode = 1; },
      raw => { raw.results[0].status = 'Skipped'; raw.results[0].expectedMet = null; },
      raw => { raw.results[0].status = 'Cancelled'; raw.results[0].expectedMet = null; },
      raw => { raw.complete = false; raw.finishedAt = null; raw.exitCode = 2; },
      raw => {
        const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        raw.startedAt = expired; raw.finishedAt = expired; raw.observedAt = expired;
        for (const result of raw.results) result.observedAt = expired;
      },
    ]) {
      const changed = f.passing();
      changed[0] = { target: f.lanes[0].target, evaluation: f.evaluate(f.lanes[0], mutate),
        context: structuredClone(f.lanes[0].context) };
      assert.notEqual(aggregateNativeReadiness(changed, f.expected).status, 'Passed');
    }
    const wrongCases = f.passing();
    const lane = f.lanes[2];
    const spec = structuredClone(lane.specification);
    spec.cases = [spec.cases[0], { ...spec.cases[0], id: 'T-UNDECLARED-NATIVE' }];
    wrongCases[2] = { target: lane.target, evaluation: f.evaluate(lane, raw => {
      raw.results = spec.cases.flatMap(test => test.assertions.map(assertion => ({
        ...raw.results[0], testId: test.id, assertionId: assertion.id, selector: assertion.selector,
        expectedDigest: test.expectedDigest,
      })));
    }, spec) };
    assert.notEqual(aggregateNativeReadiness(wrongCases, f.expected).status, 'Passed');
    const other = fixture(profile === 'pr' ? 'r-pre' : 'pr');
    assert.equal(aggregateNativeReadiness(other.passing(), f.expected).status, 'NotRun');
  }
});

test('T-PRD016 native artifact ordering preserves complete stable metadata and rejects a changed WinGet digest', () => {
  const stable = structuredClone(candidate);
  stable.descriptor.files.push(
    { filename: 'Urmich.AISDLCFramework.yaml', kind: 'winget', sha256: '6'.repeat(64) },
    { filename: 'Urmich.AISDLCFramework.installer.yaml', kind: 'winget', sha256: '7'.repeat(64) },
    { filename: 'Urmich.AISDLCFramework.locale.en-US.yaml', kind: 'winget', sha256: '8'.repeat(64) },
    { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: '9'.repeat(64) },
  );
  const f = fixture('pr', stable);
  const artifacts = nativeArtifacts(stable);
  const context = validateExecutionContext(f.lanes[0].context);
  assert.deepEqual(artifacts, context.artifacts);
  assert.equal(digest(nativeArtifacts(structuredClone(stable))), digest(context.artifacts),
    'Unchanged final candidate must match the execution-context artifact identity exactly');
  assert.deepEqual(new Set(artifacts.map(file => file.name)), new Set([
    ...stable.descriptor.files.map(file => file.filename), 'frozen-descriptor', 'frozen-checksums',
  ]));
  assert.equal(aggregateNativeReadiness(f.passing(), f.expected).status, 'Passed');
  const changed = structuredClone(stable);
  changed.descriptor.files.find(file => file.filename === 'Urmich.AISDLCFramework.installer.yaml').sha256 =
    'f'.repeat(64);
  assert.notEqual(digest(nativeArtifacts(changed)), digest(context.artifacts));
  assert.equal(aggregateNativeReadiness(fixture('pr', changed).passing(), f.expected).status, 'NotRun');
});

test('T-PRD016 native input validation rejects invalid R-PRE intent and build booleans before filesystem mutation', async () => {
  const options = { target: 'linux-x64', profile: 'r-pre', candidateDir: '.test-data/native-never-candidate',
    evidenceDir: '.test-data/native-never-evidence', buildCandidate: true };
  options.candidateDir += `-${randomUUID()}`;
  options.evidenceDir += `-${randomUUID()}`;
  const environment = { EXPECTED_SOURCE_COMMIT: sourceRevision };
  for (const intent of [undefined, '', 'contains spaces', 'line\nbreak']) {
    assert.throws(() => validateNativeRequest(options, { ...environment, RELEASE_INTENT_ID: intent }));
  }
  assert.equal(validateNativeRequest(options, { ...environment, RELEASE_INTENT_ID: 'release-1' }).profile, 'r-pre');
  for (const value of ['TRUE', '1', '', 'falsey']) {
    assert.throws(() => parseNativeOptions(['--build-candidate', value]), { code: 'INPUT' });
  }
  assert.equal(parseNativeOptions(['--build-candidate', 'false']).buildCandidate, false);
  assert.equal(parseNativeOptions(['--build-candidate', 'true']).buildCandidate, true);
  assert.throws(() => validateNativeRequest({ ...options, buildCandidate: 'false' }, environment), { code: 'INPUT' });
  assert.throws(() => validateNativeRequest({ ...options, profile: 'pr', evidenceDir: options.candidateDir }, environment),
    { code: 'INPUT' });
  for (const directory of [options.candidateDir, options.evidenceDir]) {
    await assert.rejects(fs.stat(path.join(repositoryRoot, directory)), { code: 'ENOENT' });
  }
});

test('T-PRD040 unavailable Intel runtime and denied required clients remain explicit non-passing native dispositions', () => {
  const f = fixture();
  const missing = aggregateNativeReadiness(f.passing().filter(lane => lane.target !== 'macos-x64'), f.expected);
  assert.equal(missing.status, 'NotRun');
  assert.ok(missing.blockers.some(blocker => blocker.includes('macos-x64')));
  for (const detail of ['Required native Intel runtime is unavailable', 'Corporate policy denied required native client']) {
    const evaluations = f.passing();
    evaluations[3] = { target: 'macos-x64', evaluation: f.evaluate(f.lanes[3], raw => {
      raw.results[0].status = 'Blocked';
      raw.results[0].expectedMet = null;
      raw.results[0].detail = detail;
    }) };
    assert.equal(aggregateNativeReadiness(evaluations, f.expected).status, 'NotRun');
    assert.ok(JSON.stringify(evaluations[3].evaluation).includes(detail));
  }
});

function goReport() {
  const Time = new Date().toISOString();
  return { complete: true, exitCode: 0, platform: 'linux', architecture: 'x64', node: `v${nativeToolchain.node}`, stdout: [
    ...['TestContract', 'TestContract/one', 'TestContract/two'].flatMap(Test =>
      [{ Time, Action: 'run', Test }, { Time, Action: 'pass', Test, Elapsed: 0.001 }]),
    { Time, Action: 'pass', Package: 'fixture-launcher', Elapsed: 0.003 },
  ].map(JSON.stringify).join('\n') };
}

test('T-PRD018 malformed unknown duplicate and missing Go terminals retain diagnostics without throwing or receiving credit', () => {
  const good = goReport();
  assert.equal(nativeGoObservations(sources, [good], 'linux-x64').status, 'Passed');
  const original = structuredClone(good);
  for (const stdout of [
    `${good.stdout}\nnot-json`,
    `${good.stdout}\n${JSON.stringify({ Action: 'pass', Test: 'TestForeign', Time: new Date().toISOString() })}`,
    `${good.stdout}\n${good.stdout.split('\n')[1]}`,
    good.stdout.split('\n').filter(line => !line.includes('TestContract/two')).join('\n'),
  ]) {
    const result = nativeGoObservations(sources, [{ ...good, stdout }], 'linux-x64');
    assert.notEqual(result.status, 'Passed');
    assert.ok(result.blockers.length > 0);
  }
  assert.equal(nativeGoObservations(sources, [], 'linux-x64').status, 'NotRun');
  assert.equal(nativeGoObservations(sources, [good, good], 'linux-x64').status, 'NotRun');
  assert.equal(reconcileGoExecution(sources, { ...good, complete: false, exitCode: null }).status, 'NotRun');
  assert.deepEqual(good, original, 'Reconciliation does not rewrite original diagnostics');
  const failed = { ...good, stdout: good.stdout.replace('"Action":"pass","Test":"TestContract/one"',
    '"Action":"fail","Test":"TestContract/one"'), exitCode: 1 };
  assert.equal(nativeGoObservations(sources, [failed], 'linux-x64').status, 'Failed');
});

test('T-PRD018 partial native reports retain original generic evidence and cannot pass by completed sibling assertions', () => {
  const f = fixture();
  const lane = f.lanes[0];
  const raw = f.report(lane, raw => {
    raw.complete = false;
    raw.finishedAt = null;
    raw.exitCode = 2;
    raw.results[0].status = 'Cancelled';
    raw.results[0].expectedMet = null;
    raw.results[0].detail = 'Owned native process was interrupted; original journal retained.';
  });
  const evaluation = evaluateNativeExecution(lane.specification, raw);
  assert.notEqual(evaluation.status, 'Passed');
  const protectedState = requireReadinessEvaluation(evaluation);
  assert.equal(protectedState.context.executions[0].context.sources[0].revision, sourceRevision);
  const bundle = createEvidenceBundle(evaluation);
  assert.ok(JSON.stringify(bundle).includes('execution-bytes'));
  assert.ok(JSON.stringify(evaluation).includes('interrupted'));
  assert.throws(() => requireReadinessEvaluation({ ...evaluation, status: 'Passed' }), { code: 'EVIDENCE' });
});

test('T-PRD018 native finalization persists missing-stage failure bundles and preserves partial journals without overwrites', async t => {
  const f = fixture();
  const lane = f.lanes[0];
  const directory = path.join(repositoryRoot, '.test-data', `native-partial-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(directory), path.join(repositoryRoot, '.test-data'));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  const journal = '{"sequence":1,"kind":"registered","name":"native frozen lifecycle"}\n';
  await fs.writeFile(path.join(directory, 'regression.json.journal.ndjson'), journal, { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'static.json'), '', { flag: 'wx' });
  const args = { directory, inventory, sources, target: lane.target,
    stages: [{ name: 'regression', cases: inventory.cases, args: ['targeted'] }],
    context: lane.context, specification: lane.specification, startedAt: new Date(Date.now() - 1000).toISOString(),
    cancelled: true, completeReportRef: 'https://github.com/fixture/repo/actions/runs/1/attempts/1' };
  const result = await finalizeNativeEvidence(args);
  assert.notEqual(result.evaluation.status, 'Passed');
  const raw = JSON.parse(await fs.readFile(path.join(directory, 'execution.json'), 'utf8'));
  assert.equal(raw.complete, false);
  assert.equal(raw.finishedAt, null);
  assert.notEqual(raw.exitCode, 0);
  assert.ok(result.diagnostics.some(row => row.code === 'MISSING_STAGE_REPORT'));
  assert.equal(await fs.readFile(path.join(directory, 'regression.json.journal.ndjson'), 'utf8'), journal);
  const bundle = JSON.parse(await fs.readFile(path.join(directory, 'readiness-bundle.json'), 'utf8'));
  const original = bundle.objects.find(object => object.value.kind === 'execution-bytes').value;
  const executionBytes = await fs.readFile(path.join(directory, 'execution.json'));
  assert.equal(original.sha256, digest(executionBytes));
  assert.deepEqual(Buffer.from(original.content, 'base64'), executionBytes);
  assert.match(await fs.readFile(path.join(directory, 'readiness.md'), 'utf8'), /NotRun|Failed/u);
  await assert.rejects(finalizeNativeEvidence(args), { code: 'EEXIST' });
});

test('T-PRD018 native readiness persistence retains large paged failure bundles without whole-container sanitizer limits', async t => {
  const f = fixture();
  const lane = f.lanes[0];
  const largeInventory = { ...inventory, cases: Array.from({ length: 1800 }, (_, index) => ({
    ...inventory.cases[0], id: `native-large-${index}`, name: `native incomplete assertion ${index}`,
  })) };
  const specification = nativeSpecification({ plan, inventory: largeInventory, goSources: sources,
    target: lane.target, profile: 'pr' });
  const context = { ...lane.context, inventoryDigest: validationInventoryDigest(specification) };
  const directory = path.join(repositoryRoot, '.test-data', `native-partial-large-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(directory), path.join(repositoryRoot, '.test-data'));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  const raw = f.report({ ...lane, context, specification }, report => {
    report.complete = false;
    report.finishedAt = null;
    report.exitCode = 2;
  });
  const evaluation = evaluateNativeExecution(specification, raw);
  const file = path.join(directory, 'readiness-bundle.json');
  await writeNativeReadinessBundle(file, evaluation);
  assert.equal(evaluation.status, 'NotRun');
  const bundle = JSON.parse(await fs.readFile(file, 'utf8'));
  const original = bundle.objects.find(object => object.value.kind === 'execution-bytes').value;
  assert.equal(original.sha256, digest(raw));
  assert.deepEqual(JSON.parse(Buffer.from(original.content, 'base64').toString('utf8')), raw);
  const replayed = readEvidenceBundle(bundle, { specification,
    context: requireReadinessEvaluation(evaluation).context });
  assert.equal(replayed.evaluation.status, 'NotRun');
  assert.equal(replayed.evaluation.cases[0].assertions.length, specification.cases[0].assertions.length);
  await assert.rejects(writeNativeReadinessBundle(file, evaluation), { code: 'EEXIST' });
});

test('T-PRD018 native Homebrew CLI failures retain structured diagnostics without unsafe stack output', async t => {
  const directory = path.join(repositoryRoot, '.test-data', `native-cli-error-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(directory), path.join(repositoryRoot, '.test-data'));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  const report = await executeValidationCommand({ name: 'homebrew-cli-error', command: process.execPath,
    args: [path.join(repositoryRoot, 'scripts', 'native-validation.mjs'), 'homebrew',
      '--unsupported-option', 'fixture'], outputDir: directory });
  assert.equal(report.complete, true, JSON.stringify({ diagnostic: report.diagnostic, causes: report.causes }));
  assert.equal(report.exitCode, 1);
  const diagnostic = JSON.parse(report.stderr);
  assert.equal(diagnostic.code, 'INPUT');
  assert.equal(diagnostic.message, 'Unknown or repeated native option');
  assert.equal(report.cleanup.requested, false);
  assert.deepEqual(report.causes, []);
});

test('T-PRD018 Homebrew command evidence omits inline source while preserving its identity and actual execution', async t => {
  const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'homebrew-inline-'));
  t.after(() => fs.rm(directory, { recursive: true }));
  const source = 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})';
  const expected = `[inline source omitted; sha256=${digest(source)}; bytes=${Buffer.byteLength(source)}]`;
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    command: process.execPath, args: ['-p', source],
  }))), { code: 'UNSAFE' });
  for (const flag of ['--eval', '-e', '--print', '-p', '-c']) {
    assert.deepEqual(validationCommandArguments([flag, source, '--version']), [flag, expected, '--version']);
  }
  const report = await executeValidationCommand({ name: 'homebrew-inline', command: process.execPath,
    args: ['-p', source], outputDir: directory });
  assert.equal(report.complete, true);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(JSON.parse(report.stdout), { platform: process.platform, arch: process.arch,
    major: Number(process.versions.node.split('.')[0]) });
  assert.deepEqual(report.command, [process.execPath, '-p', expected]);
  await writeNativeHomebrewReport(directory, { nativeValidation: 'Failed', stage: 'lifecycle',
    evidence: { passed: false, commands: [{ command: process.execPath,
      args: validationCommandArguments(['-p', source]), success: true, stdout: report.stdout }] } });
  const retained = JSON.parse(await fs.readFile(path.join(directory, 'native-homebrew.json'), 'utf8'));
  assert.equal(retained.nativeValidation, 'Failed');
  assert.deepEqual(retained.evidence.commands[0].args, ['-p', expected]);
});

test('T-PRD018 Homebrew report rejection preserves the primary failure and safe stage without false passing credit', async t => {
  for (const kind of ['unsafe', 'capacity']) {
    const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'homebrew-retention-'));
    t.after(() => fs.rm(directory, { recursive: true }));
    const primary = Object.assign(new Error('Homebrew lifecycle command failed'), { code: 'BREW_FAILED' });
    const evidence = kind === 'unsafe' ? { stderr: 'unsupported({ password: "owned-fixture-secret" })' } :
      { commands: Array.from({ length: 66000 }, () => ({ success: true })) };
    await assert.rejects(writeNativeHomebrewReport(directory,
      { nativeValidation: 'Failed', stage: 'lifecycle', evidence }, primary), error => error === primary);
    const bytes = await fs.readFile(path.join(directory, 'native-homebrew.json'));
    const retained = JSON.parse(bytes);
    assert.equal(retained.nativeValidation, 'NotRun');
    assert.equal(retained.stage, 'lifecycle');
    assert.equal(retained.diagnostic.code, 'BREW_FAILED');
    assert.equal(retained.diagnostic.message, primary.message);
    assert.equal(retained.diagnostic.original.sha256, digest(primary.message));
    assert.equal(retained.retentionDiagnostic.code, kind === 'unsafe' ? 'UNSAFE' : 'CAPACITY');
    assert.deepEqual(retained.original, { sha256: digest(JSON.stringify({
      nativeValidation: 'Failed', stage: 'lifecycle', evidence, observedAt: retained.observedAt,
    })), bytes: Buffer.byteLength(JSON.stringify({
      nativeValidation: 'Failed', stage: 'lifecycle', evidence, observedAt: retained.observedAt,
    })) });
    assert.ok(bytes.length < 2000);
    assert.ok(!bytes.includes(Buffer.from('owned-fixture-secret')));
  }
});

test('T-PRD018 unretainable successful Homebrew evidence fails explicitly and cannot replace an original report', async t => {
  const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'homebrew-success-retention-'));
  t.after(() => fs.rm(directory, { recursive: true }));
  await assert.rejects(writeNativeHomebrewReport(directory, { nativeValidation: 'Passed',
    evidence: { stdout: 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})' } }),
  { code: 'UNSAFE' });
  const original = await fs.readFile(path.join(directory, 'native-homebrew.json'));
  const report = JSON.parse(original);
  assert.equal(report.nativeValidation, 'NotRun');
  assert.equal(report.stage, 'evidence-retention');
  assert.equal(report.diagnostic.code, 'UNSAFE');
  await assert.rejects(writeNativeHomebrewReport(directory, { nativeValidation: 'Passed' }), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(path.join(directory, 'native-homebrew.json')), original);
});

test('T-PRD018 native failure annotations escape workflow-command injection without changing the underlying failure', () => {
  const f = fixture();
  const lane = f.lanes[0];
  const evaluation = f.evaluate(lane, raw => {
    raw.results[0].status = 'Failed';
    raw.results[0].expectedMet = false;
    raw.results[0].exitCode = 1;
    raw.results[0].detail = '50% failed\r\n::notice::not another annotation';
    raw.exitCode = 1;
  });
  const annotations = nativeFailureAnnotations(evaluation);
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /50%25 failed%0D%0A::notice::/u);
  assert.ok(!/[\r\n]/u.test(annotations[0]));
  assert.equal(evaluation.status, 'Failed');
});
