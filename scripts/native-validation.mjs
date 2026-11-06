import * as fs from 'node:fs/promises';
import { frozenDistributionContext } from './frozen-distribution-fixture.mjs';
import { needsSyntheticReleaseFixture, prepareObservedSyntheticReleaseFixture,
  syntheticReleaseContextVariable } from './synthetic-release-fixture.mjs';
import { assertCommittedSourceInputs } from './committed-source-inputs.mjs';
import { nativeSourceDummyValues } from './native-source-dummy-values.mjs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { promisify, types } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, digest, id, isCredentialQueryKey, requireThat, SdlcError } from '../src/core.mjs';
import { atomicWrite } from '../src/files.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, renderReadinessReport, requireReadinessEvaluation,
  validateExecutionContext, sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { compileValidationInventory, compileValidationSourceInventory, reconcileNodeExecution,
  validationPlatforms, validationSourcePaths, isValidationTestPath,
  partitionValidationInventory, declarationTokens, sourceLiteralAt, decodeString,
  matchesNodeSelection } from './validation-inventory.mjs';
import { discoverGoDeclarations, executeValidationCommand, reconcileGoExecution, processDiagnostic,
  createOwnedCommandRunner } from './validation-tools.mjs';
import { repositoryRoot, unitFiles, validationSelectionDescriptor, validationSelectionProtocol,
  writeValidationSelection } from './test-runner.mjs';
import { exactPattern } from './test-profiles.mjs';
import { verifyCandidate, archiveRecord } from './release-bundle.mjs';
import { readZip, canonical as releaseCanonical } from '../packaging/standalone/archive.mjs';
import { runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { hostedValidationSelection, resolveValidationWorkers,
  validationSchedulingPolicy, sourceValidationSchedulingPolicy,
  validationSchedulingPolicyDigest, validationExecutionGroups, validationGroupProtocol } from './test-scheduling.mjs';
import { buildPlatforms, renderChecksums } from './package-platforms.mjs';
import { calculatorProjectFiles, calculatorSelection, calculatorCapability, calculatorBaselineCapability, reconcileCalculator,
  calculatorArguments } from './pr-calculator.mjs';
import { prCryptoFixture } from './pr-capabilities.mjs';
import { nativeToolchain, nativeBootstrapProtocol, nativeBodyBootstrapProtocol, nativeUnitBootstrapProtocol,
  nativeSdkBootstrapProtocol, nativeBootstrapProtocols } from './toolchain-baseline.mjs';
import { beginHomebrewPrefixStage, beginHomebrewPrefixChild } from './native-homebrew-prefix.mjs';
import { sourceNativeBootstrapProtocol, requireNativeBootstrapCapability, nativeSdkRequirements,
  nativeSdkContextMatches, nativeBootstrapRequirements, probeNativeSdk,
  requireNativeCryptoEnvironment } from './native-bootstrap-capability.mjs';
export { nativeToolchain } from './toolchain-baseline.mjs';
export { deriveNativeComponentSpecification, nativeComponentSelection,
  projectNativeComponentEvidence, replayNativeComponentEvidence,
  requireNativeComponentProjection } from './native-components.mjs';

const execute = promisify(execFile);
const nativeDefinitionPass = new AsyncLocalStorage();
const suffixes = { 'linux-x64': 'LX', 'windows-x64': 'WX', 'macos-arm64': 'MA', 'macos-x64': 'MI' };
const platforms = { 'linux-x64': 'linux', 'windows-x64': 'win32',
  'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
const locations = { 'linux-x64': 'github-linux-x64', 'windows-x64': 'github-windows-x64',
  'macos-arm64': 'github-macos-arm64', 'macos-x64': 'github-macos-x64' };
export const nativeLegacyFrameworkShardProtocol = 'native-framework-shards-v1';
export const nativePlatformUnitFrameworkShardProtocol = 'native-framework-shards-v2-platform-units';
export const nativeFourBodyFrameworkShardProtocol = 'native-framework-shards-v3-four-body-platform-units';
export const nativeSplitUnitFrameworkShardProtocol = 'native-framework-shards-v4-split-intel-units';
export const nativeRootComponentFrameworkShardProtocol = 'native-framework-shards-v5-root-components';
export const nativeStableCostFrameworkShardProtocol = 'native-framework-shards-v6-stable-cost-components';
export const nativeResourceAffinityFrameworkShardProtocol = 'native-framework-shards-v7-resource-affinity-components';
export const nativeCatalogIsolationFrameworkShardProtocol = 'native-framework-shards-v8-intel-catalog-isolation';
export const nativePhasedIsolationFrameworkShardProtocol = 'native-framework-shards-v9-phased-intel-isolation';
export const nativeComponentRebalanceFrameworkShardProtocol = 'native-framework-shards-v10-phased-intel-component-rebalance';
export const nativeParallelReadyPoolFrameworkShardProtocol = 'native-framework-shards-v11-parallel-intel-ready-pool';
export const nativeServiceBalanceFrameworkShardProtocol = 'native-framework-shards-v12-intel-service-balance';
export const nativeCatalogReservationFrameworkShardProtocol = 'native-framework-shards-v13-catalog-process-reservation';
export const nativeCatalogServiceFrameworkShardProtocol = 'native-framework-shards-v14-catalog-fixture-service';
export const nativeFrameworkShardProtocol = 'native-framework-shards-v15-source-qualified-ownership';
// Partial original group timings are placement leads, never current execution evidence.
export const nativePlacementCosts = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "d7d0ebc23509647d6305dc932db0a7741a09efa4",
  "runId": "41712341373",
  "attempt": "1",
  "node": "24.20.0",
  "workers": {"linux-x64": 15, "windows-x64": 15, "macos-arm64": 7, "macos-x64": 14},
  "qualification": "historical-group-duration-leads; source changes transfer no passing credit; unknown work uses count fallback",
  "roots": [
    {"rootId":"assertion-b2f6b8cc0c4b155029db7340530b19d47c2e58ec03f5ad64c1b937c8c9797c45","sourceDigest":"8540aefa1f0651bfe834bd13d5529e4a907556cb6dbd266e81bcf792d42c0281","shapeDigest":"eec7bce119abafd9d4f5641d6bfbb4979ee0e4db22594ac1336514e2d656eb74","samples":{"linux-x64":[121260,"126185691276"],"windows-x64":[155038,"126186321871"],"macos-arm64":[111436,"126185925987"],"macos-x64":[481534,"126186785146"]}},
    {"rootId":"assertion-ae62135c83d676d2db6d13a3b7cdfd189adab6a9145d95a58d51d6113e79a06a","sourceDigest":"40fc9df1dc0f5a31f8c4820fca47e75478c64806565e365380af8591c2862342","shapeDigest":"a00a7af10779b6745c12d4ab7f772f499268a1e8f41e9eac589dae087d48d2e8","samples":{"linux-x64":[88854,"126185691276"],"macos-arm64":[54751,"126185925880"]}},
    {"rootId":"assertion-67716b485944f5af7e87adc105fb7026085b7f47639e86c6afe1bf330e998305","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"2b331b5fce15957103bd4ccd3cd5f67a30e87b1be82c2cf67021ec547e7bf8d7","samples":{"linux-x64":[87390,"126185691276"],"macos-arm64":[48621,"126185925880"]}},
    {"rootId":"assertion-fbba6948bfbddb931f8ceb750aebddfbcf2f2d4a7432bc539cf7558351d206aa","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"0a0af1c920a2449128d015017c405db236a0734b8a5364a4b65f7545ca08bf3d","samples":{"linux-x64":[83467,"126185691276"],"windows-x64":[94963,"126186321871"],"macos-arm64":[46141,"126185925987"]}},
    {"rootId":"assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5","sourceDigest":"c5ccb89802cb42b4f3a8f769898fd2ee906605a464b11d829439c2d43f94d795","shapeDigest":"40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13","samples":{"linux-x64":[261253,"126185691287"],"windows-x64":[369593,"126186321887"],"macos-arm64":[286836,"126185925987"],"macos-x64":[933534,"126186785146"]}},
    {"rootId":"assertion-15cc065c1f47ad1a636b4df121374024bf5677d256abc6df71a222d41e8ddb12","sourceDigest":"40fc9df1dc0f5a31f8c4820fca47e75478c64806565e365380af8591c2862342","shapeDigest":"efe3b463c56527f41e8ca395fd408872ed23d10992fc03c56885d610ba3fa50d","samples":{"linux-x64":[158227,"126185691287"],"windows-x64":[84392,"126186321887"],"macos-arm64":[112554,"126185925987"],"macos-x64":[553385,"126186785146"]}},
    {"rootId":"assertion-4dda1118e3095dddc78d663d95c3c839b19807c0c4d91e69ca176e40b93df30c","sourceDigest":"d5ebc6c505b085156220ec6ede8c753f8a4b1cc1b8f2e87d100196265affea61","shapeDigest":"dd3c0415779ff6a5e3d06a4ca78015b0b6683c58b7c0e2a37ca4356335fcce6c","samples":{"linux-x64":[69830,"126185691287"],"macos-arm64":[61633,"126185925880"]}},
    {"rootId":"assertion-3a7922c4722be7913112ec7dd2a54bb21ba4ce6d9960efc7a19f0192ab70d049","sourceDigest":"d9075de57cc81c471ab4ca15ce17d4a9cef2f809051b23dfc425dc62efa4cfc8","shapeDigest":"ca6256578092b38627897dfe1d652f17d00f79face97f9babd04a5d8fc201181","samples":{"linux-x64":[67235,"126185691287"]}},
    {"rootId":"assertion-080e2671f869e26190362df0dcac0349c7a47e03fd497c6a70179489ef478386","sourceDigest":"c5ccb89802cb42b4f3a8f769898fd2ee906605a464b11d829439c2d43f94d795","shapeDigest":"bfcaa88f62ce793e61a1de810faa6328c61530a7f5f48724d22d9bd32d2aa7e5","samples":{"linux-x64":[116554,"126185691313"],"windows-x64":[160141,"126186321965"],"macos-arm64":[25626,"126185926165"],"macos-x64":[202036,"126186785364"]}},
    {"rootId":"assertion-b0a14ca74a43eb87fbdece3db7dd5ca468cfef0549f890797206d7671b31afcc","sourceDigest":"04ee07ac02e8de025ffc97755da22ecfb624197d8266d8d718413c2b53c3822f","shapeDigest":"92055d23287b6f60b448820ccde4aca39abd154714033b5d023ee9c0943b9bab","samples":{"linux-x64":[92880,"126185691313"],"windows-x64":[169094,"126186321965"],"macos-arm64":[39397,"126185925987"]}},
    {"rootId":"assertion-774b6605ebd531372e319c27028ff9e9f17258323ee112a968fdfe43e3f44a2e","sourceDigest":"b325b2472b65bcfdf642968256d396c1271b6d8abfd950233a369293a604e13c","shapeDigest":"16bcccb024f09e44a788cfa45d6fcd58f8ed1b69555fb1d7907ac1612baceddf","samples":{"linux-x64":[84687,"126185691313"],"windows-x64":[155880,"126186321965"],"macos-arm64":[55220,"126185925987"]}},
    {"rootId":"assertion-0229d21e7450dc24b7c2e44468fe4e2b27de8372c040204795d7962c9ff91b13","sourceDigest":"9b39484c3a05186bd5c7d79e5549b36926514cd6c3ef82a3fffd5f1bd1dad10d","shapeDigest":"69ad5aff93ed6a45b54b3d584e04b9ee9e06b585558afc4eb121432d2e30c944","samples":{"linux-x64":[71301,"126185691313"],"windows-x64":[150910,"126186321965"],"macos-arm64":[36146,"126185925880"]}},
    {"rootId":"assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22","sourceDigest":"dd4e878f1d8d9fc15fc7b167da7edce801d06b6767cbf25f133aa9581e4a07cf","shapeDigest":"8f3e8ad75abca04eb87793bec9b882909d3eaa9b263041d1830a3724b9078951","samples":{"linux-x64":[170283,"126185691366"],"windows-x64":[228787,"126186322134"],"macos-arm64":[122466,"126185926165"]}},
    {"rootId":"assertion-063b315aa5106b822a0982a0ee26caa7c4d26179ed1a79958a3bc918d786dfde","sourceDigest":"d4b9290525cec00b352f9818d1df4720f8896f3b12133a5466383334f75ca761","shapeDigest":"6871839e5d2760bf9ef8b3d09578bfdb535a49c403dd6c34a3387a609a7571a2","samples":{"linux-x64":[98231,"126185691366"],"windows-x64":[313715,"126186322134"],"macos-arm64":[43208,"126185926165"]}},
    {"rootId":"assertion-867c856a68e6962fca9d8495772ab2ab98ddcfb3c6d0858cae4cfe44ddec7e3c","sourceDigest":"c5ccb89802cb42b4f3a8f769898fd2ee906605a464b11d829439c2d43f94d795","shapeDigest":"9126eca32fece324dacc2b4bd39840a12fbe1f8505b195f5cf5ab7c1475b1b90","samples":{"linux-x64":[63200,"126185691366"],"windows-x64":[133221,"126186322134"],"macos-arm64":[22633,"126185926165"]}},
    {"rootId":"assertion-0ea538f933586c33183708df2824759a052883291fefb6424328a21553cfa543","sourceDigest":"d64c98e670a4fc650881e3ec0f21279858bf0b3d217ccc480fcf93fcc3aab730","shapeDigest":"5e3c09692ad710209995957de63291f64e6fda72b6e91a0dd70ffc71312925a5","samples":{"linux-x64":[55900,"126185691366"],"windows-x64":[155660,"126186322134"],"macos-arm64":[47907,"126185926165"]}},
    {"rootId":"assertion-c937700e1f02501d67f93f8500acf29607768a75116ffa5c809237413d2c1505","sourceDigest":"2da5f828958be2bbaa3d5c3b2b7a888fce2c590ef00ed966829deb2416b98ddb","shapeDigest":"3c95ff0985754b08c246c7e638e667d73d649055da9a112a0c0602b76f0e8f61","samples":{"windows-x64":[118202,"126186321871"],"macos-arm64":[87190,"126185925880"]}},
    {"rootId":"assertion-d95ad479f9ef0efd1e703cecb9d5204d43116da6dc4209427b5e992a159a4635","sourceDigest":"fb81275245160616f8716e557e17d02caf4c7706681c3413d300b678b22bb6ab","shapeDigest":"b90988d9fae851614b4a10c120e3f1a1a011bd0db546912455e39f356c36edd6","samples":{"windows-x64":[85497,"126186321871"],"macos-arm64":[35838,"126185925880"]}},
    {"rootId":"assertion-8ea8f4fc474bc8084242fc97f6df2897affcd1e63ba0acbdeb6f1babdcbc66ef","sourceDigest":"cd10bc990510f014575975854729ac59f0acd1888626f33acdbb290f62b7abe8","shapeDigest":"d0e9b3b70918d33235eaa6e3014c3f1bb11868701dc73cf8eabd3974e2794e10","samples":{"windows-x64":[99416,"126186321887"]}},
    {"rootId":"assertion-6dc65d72b554282f2a61bc2fea9f59193de1503009805e33e4cf2ecc0aa50f01","sourceDigest":"038e3f4c98b0c73431891dafd064a8fee685638c650575ee24c924a79998e8ab","shapeDigest":"c4a857cd9134ca79ba5d86704c3a1fddec5f1dbfe5cdd3b5afecd166924b9276","samples":{"windows-x64":[84976,"126186321887"],"macos-arm64":[24099,"126185926165"]}}
  ]
});
Object.freeze(nativePlacementCosts.workers);
for (const hint of nativePlacementCosts.roots) {
  Object.values(hint.samples).forEach(Object.freeze);
  Object.freeze(hint.samples);
  Object.freeze(hint);
}
Object.freeze(nativePlacementCosts.roots);
export const nativePlacementCostsV7 = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "6cc595a1a12cc71a6e7fbba2ae72f3696303acea",
  "runId": "41803553551",
  "attempt": "1",
  "node": "24.20.0",
  "workers": {"macos-x64": 14},
  "qualification": "completed original Intel body-0 group leads; source changes transfer no passing credit; unknown work uses historical or count fallback",
  "roots": [
    {"rootId":"assertion-583587077cd3503a4387cce4058358a61651710ff9f49d837189dbfe8c0596af","sourceDigest":"5a7834240b7cd297d45f214097b11151541f84784fdac7bfbc67be08eb20cbd5","shapeDigest":"43387ce30b2f2976f4e8d49d9235127728821909d62a0dde4c5642d1dc26319a","samples":{"macos-x64":[166413,"126488065391"]}},
    {"rootId":"assertion-25f11a19aa339e58eae9d1d8ba6a9b7e900de69554b562d15d590ccde6462d29","sourceDigest":"ddb6e6ffb7d97fb6699679f727e1fc2ae4dda9b42b4d697367e8e8297abe6c1c","shapeDigest":"df68c8af78852cf7d0eb1e09cbd0bddb8623ad55138cfe09b095bcf000508d50","samples":{"macos-x64":[168414,"126488065391"]}},
    {"rootId":"assertion-d64083db7e19f24a97764aa257f011ea966d434ebd09b3bd40bad59aaf7bd7c7","sourceDigest":"6e725fdb097e75933a015043eb40090c5d1a2e4ca5ef49dc1915c9a164fbb309","shapeDigest":"a9120a00c85596ba1895440938ba60c5ca867e8552e9c2d4944c16d4a904bbde","samples":{"macos-x64":[174645,"126488065391"]}},
    {"rootId":"assertion-170a22b6fc70b1916f2ee09e1de78f6275b1aa46a21259d4e662a6cf3ee8e8f3","sourceDigest":"40fc9df1dc0f5a31f8c4820fca47e75478c64806565e365380af8591c2862342","shapeDigest":"f25595cc6dd05161572b94ed4aa2dcebff57e6a775ce9f605c961695bdd0af31","samples":{"macos-x64":[182475,"126488065391"]}},
    {"rootId":"assertion-05d343ab6e9f0d6aa6d7418b94901fdd4d501d22a5043da8e47129b7cecf5e85","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"bd9d28223157479cfaa61fa662739770a11714bde8437236959cfb08f1b8d6a3","samples":{"macos-x64":[186656,"126488065391"]}},
    {"rootId":"assertion-f5499e4dc0d5f9a249e2c7556748164af33a9a8717701df2670d9a516fdb52b3","sourceDigest":"1e80c22a797add7e9ac83ada791cca30beda432c264c45e904dc32035614b1d3","shapeDigest":"dc4aed2053e31a862435bea984a28752818f93a88519e6f150b61e2af5b50a9c","samples":{"macos-x64":[192657,"126488065391"]}},
    {"rootId":"assertion-0ea538f933586c33183708df2824759a052883291fefb6424328a21553cfa543","sourceDigest":"d64c98e670a4fc650881e3ec0f21279858bf0b3d217ccc480fcf93fcc3aab730","shapeDigest":"5e3c09692ad710209995957de63291f64e6fda72b6e91a0dd70ffc71312925a5","samples":{"macos-x64":[318242,"126488065391"]}},
    {"rootId":"assertion-c937700e1f02501d67f93f8500acf29607768a75116ffa5c809237413d2c1505","sourceDigest":"2da5f828958be2bbaa3d5c3b2b7a888fce2c590ef00ed966829deb2416b98ddb","shapeDigest":"3c95ff0985754b08c246c7e638e667d73d649055da9a112a0c0602b76f0e8f61","samples":{"macos-x64":[338507,"126488065391"]}},
    {"rootId":"assertion-4dda1118e3095dddc78d663d95c3c839b19807c0c4d91e69ca176e40b93df30c","sourceDigest":"89d387cd34f3bb94d7961f5885e8452307ff36c95c60b91333f1a08be8eecbd6","shapeDigest":"dd3c0415779ff6a5e3d06a4ca78015b0b6683c58b7c0e2a37ca4356335fcce6c","samples":{"macos-x64":[361150,"126488065391"]}},
    {"rootId":"assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13","samples":{"macos-x64":[1049416,"126488065391"]}}
  ]
});
Object.freeze(nativePlacementCostsV7.workers);
for (const hint of nativePlacementCostsV7.roots) {
  Object.values(hint.samples).forEach(Object.freeze);
  Object.freeze(hint.samples);
  Object.freeze(hint);
}
Object.freeze(nativePlacementCostsV7.roots);
export const nativePlacementAffinities = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "6cc595a1a12cc71a6e7fbba2ae72f3696303acea",
  "runId": "41803553551",
  "attempt": "1",
  "node": "24.20.0",
  "qualification": "source-qualified resource-compatible placement hypothesis; no execution credit or predicted latency saving",
  "affinities": [{
    "id": "arm-retained-catalogue",
    "target": "macos-arm64",
    "capacity": 7,
    "anchor": {
      "rootId": "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
      "sourceDigest": "f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94",
      "shapeDigest": "40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13",
      "minimumSlots": 1
    },
    "companion": {
      "rootId": "assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22",
      "sourceDigest": "dd4e878f1d8d9fc15fc7b167da7edce801d06b6767cbf25f133aa9581e4a07cf",
      "shapeDigest": "8f3e8ad75abca04eb87793bec9b882909d3eaa9b263041d1830a3724b9078951",
      "minimumSlots": 4
    },
    "anchorJob": "126486725289",
    "companionJob": "126486725360",
    "observedEarlierCompletionMs": 145000
  }]
});
for (const affinity of nativePlacementAffinities.affinities) {
  Object.freeze(affinity.anchor);
  Object.freeze(affinity.companion);
  Object.freeze(affinity);
}
Object.freeze(nativePlacementAffinities.affinities);
export const nativePlacementCostsV8 = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "90ae1e4ae10620e12897a5f79be03b4225d2b928",
  "runId": "41817138524",
  "attempt": "1",
  "node": "24.20.0",
  "workers": {"macos-x64": 14},
  "qualification": "completed original Intel group scheduling leads; exact target/runtime/closure/resources required; no execution credit or predicted lane duration; unknown work uses historical or count fallback",
  "originalAnnotations": {
    "126533118430": "dbdd81a08b20c671b1fc43cf7ad3bdf862402db0c7f5433f428e4fc92532866a",
    "126533553660": "1f36431c69d59b13d0784dc922b64d986597e13f57741adbf2b43320e74d00e3",
    "126533553913": "0945a8f79de847be90cb10e088022be53b8754dfe506d6625664a8942ef55627"
  },
  "roots": [
    {"rootId":"assertion-9d7eefcaa2392d0f2324467a4c0f159162c675a66c6d7809eb22ab4ddac6d430","sourceDigest":"d9075de57cc81c471ab4ca15ce17d4a9cef2f809051b23dfc425dc62efa4cfc8","shapeDigest":"f2cf20fe3ef19699d29e607dee9ddb7605153c178d30adacdfd44b1fb4773dc0","samples":{"macos-x64":[146444,"126533118430"]}},
    {"rootId":"assertion-d64083db7e19f24a97764aa257f011ea966d434ebd09b3bd40bad59aaf7bd7c7","sourceDigest":"6e725fdb097e75933a015043eb40090c5d1a2e4ca5ef49dc1915c9a164fbb309","shapeDigest":"a9120a00c85596ba1895440938ba60c5ca867e8552e9c2d4944c16d4a904bbde","samples":{"macos-x64":[172908,"126533118430"]}},
    {"rootId":"assertion-c88fcc43622cb44b08aea5a9d7adc06253c79aedbfe31a9b43ad19f03e59d63c","sourceDigest":"ddb6e6ffb7d97fb6699679f727e1fc2ae4dda9b42b4d697367e8e8297abe6c1c","shapeDigest":"2827b68451aba014b12a803b2c4129227230e2dcd54449979943fd5164afa2d6","samples":{"macos-x64":[210769,"126533118430"]}},
    {"rootId":"assertion-3a7922c4722be7913112ec7dd2a54bb21ba4ce6d9960efc7a19f0192ab70d049","sourceDigest":"d9075de57cc81c471ab4ca15ce17d4a9cef2f809051b23dfc425dc62efa4cfc8","shapeDigest":"ca6256578092b38627897dfe1d652f17d00f79face97f9babd04a5d8fc201181","samples":{"macos-x64":[235808,"126533118430"]}},
    {"rootId":"assertion-b0a14ca74a43eb87fbdece3db7dd5ca468cfef0549f890797206d7671b31afcc","sourceDigest":"04ee07ac02e8de025ffc97755da22ecfb624197d8266d8d718413c2b53c3822f","shapeDigest":"92055d23287b6f60b448820ccde4aca39abd154714033b5d023ee9c0943b9bab","samples":{"macos-x64":[257725,"126533118430"]}},
    {"rootId":"assertion-67716b485944f5af7e87adc105fb7026085b7f47639e86c6afe1bf330e998305","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"2b331b5fce15957103bd4ccd3cd5f67a30e87b1be82c2cf67021ec547e7bf8d7","samples":{"macos-x64":[284081,"126533118430"]}},
    {"rootId":"assertion-95ad460a630507970746bfdf4bbec35491dc9749218a5cb6437baaa576c36d34","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"b786c72a0cd53cc191e96099ee86c543b481ed56ab683c247fd8321e25494403","samples":{"macos-x64":[309740,"126533118430"]}},
    {"rootId":"assertion-774b6605ebd531372e319c27028ff9e9f17258323ee112a968fdfe43e3f44a2e","sourceDigest":"b325b2472b65bcfdf642968256d396c1271b6d8abfd950233a369293a604e13c","shapeDigest":"16bcccb024f09e44a788cfa45d6fcd58f8ed1b69555fb1d7907ac1612baceddf","samples":{"macos-x64":[333771,"126533118430"]}},
    {"rootId":"assertion-b1b032561853815caa7a039f5c020e573a19067118dec177cae55e2d89dc1092","sourceDigest":"59a5009da5588fe408b4837c467d99aa53446d9c6a5ccb704fd114f970105b6a","shapeDigest":"c37a4c9b2a3458f0621c8546fa8728289fb4c765e5b67c06f3f8c9e913b29f50","samples":{"macos-x64":[599437,"126533118430"]}},
    {"rootId":"assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13","samples":{"macos-x64":[991112,"126533118430"]}},
    {"rootId":"assertion-3d1695596fcc30dd7bce0e6cad7f5afc4d0550ce14e6ea506ae6a627a9ffa84b","sourceDigest":"2780d2ad1567db359976fee01d3c6499dcec116dee139784ea9ca76a2e2d860c","shapeDigest":"7b71e28212ab6a4bda5f3b1761c48dbae7c6f95b0a8bc03db0d08815e3fa5df4","samples":{"macos-x64":[113225,"126533553660"]}},
    {"rootId":"assertion-6dc65d72b554282f2a61bc2fea9f59193de1503009805e33e4cf2ecc0aa50f01","sourceDigest":"038e3f4c98b0c73431891dafd064a8fee685638c650575ee24c924a79998e8ab","shapeDigest":"c4a857cd9134ca79ba5d86704c3a1fddec5f1dbfe5cdd3b5afecd166924b9276","samples":{"macos-x64":[122201,"126533553660"]}},
    {"rootId":"assertion-ff45bf92348abb3ee3446f1084f9cfcc45bada03197936aca2981a95ad1d8665","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"b6a30ae7ff82844eb8d73c6a1585a69906206588ad1535e775a9ccd608e32808","samples":{"macos-x64":[126585,"126533553660"]}},
    {"rootId":"assertion-583587077cd3503a4387cce4058358a61651710ff9f49d837189dbfe8c0596af","sourceDigest":"39a2b08b393151cce75ef4771ee57bba99cc468489251813788462541dc3a4a0","shapeDigest":"43387ce30b2f2976f4e8d49d9235127728821909d62a0dde4c5642d1dc26319a","samples":{"macos-x64":[138269,"126533553660"]}},
    {"rootId":"assertion-170a22b6fc70b1916f2ee09e1de78f6275b1aa46a21259d4e662a6cf3ee8e8f3","sourceDigest":"59a5009da5588fe408b4837c467d99aa53446d9c6a5ccb704fd114f970105b6a","shapeDigest":"f25595cc6dd05161572b94ed4aa2dcebff57e6a775ce9f605c961695bdd0af31","samples":{"macos-x64":[145371,"126533553660"]}},
    {"rootId":"assertion-f5499e4dc0d5f9a249e2c7556748164af33a9a8717701df2670d9a516fdb52b3","sourceDigest":"1e80c22a797add7e9ac83ada791cca30beda432c264c45e904dc32035614b1d3","shapeDigest":"dc4aed2053e31a862435bea984a28752818f93a88519e6f150b61e2af5b50a9c","samples":{"macos-x64":[151129,"126533553660"]}},
    {"rootId":"assertion-fbba6948bfbddb931f8ceb750aebddfbcf2f2d4a7432bc539cf7558351d206aa","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"0a0af1c920a2449128d015017c405db236a0734b8a5364a4b65f7545ca08bf3d","samples":{"macos-x64":[221199,"126533553660"]}},
    {"rootId":"assertion-0ea538f933586c33183708df2824759a052883291fefb6424328a21553cfa543","sourceDigest":"d64c98e670a4fc650881e3ec0f21279858bf0b3d217ccc480fcf93fcc3aab730","shapeDigest":"5e3c09692ad710209995957de63291f64e6fda72b6e91a0dd70ffc71312925a5","samples":{"macos-x64":[232213,"126533553660"]}},
    {"rootId":"assertion-063b315aa5106b822a0982a0ee26caa7c4d26179ed1a79958a3bc918d786dfde","sourceDigest":"39a2b08b393151cce75ef4771ee57bba99cc468489251813788462541dc3a4a0","shapeDigest":"6871839e5d2760bf9ef8b3d09578bfdb535a49c403dd6c34a3387a609a7571a2","samples":{"macos-x64":[235660,"126533553660"]}},
    {"rootId":"assertion-b2f6b8cc0c4b155029db7340530b19d47c2e58ec03f5ad64c1b937c8c9797c45","sourceDigest":"8540aefa1f0651bfe834bd13d5529e4a907556cb6dbd266e81bcf792d42c0281","shapeDigest":"eec7bce119abafd9d4f5641d6bfbb4979ee0e4db22594ac1336514e2d656eb74","samples":{"macos-x64":[354188,"126533553660"]}},
    {"rootId":"assertion-25f11a19aa339e58eae9d1d8ba6a9b7e900de69554b562d15d590ccde6462d29","sourceDigest":"ddb6e6ffb7d97fb6699679f727e1fc2ae4dda9b42b4d697367e8e8297abe6c1c","shapeDigest":"df68c8af78852cf7d0eb1e09cbd0bddb8623ad55138cfe09b095bcf000508d50","samples":{"macos-x64":[104935,"126533553913"]}},
    {"rootId":"assertion-ae62135c83d676d2db6d13a3b7cdfd189adab6a9145d95a58d51d6113e79a06a","sourceDigest":"59a5009da5588fe408b4837c467d99aa53446d9c6a5ccb704fd114f970105b6a","shapeDigest":"a00a7af10779b6745c12d4ab7f772f499268a1e8f41e9eac589dae087d48d2e8","samples":{"macos-x64":[117095,"126533553913"]}},
    {"rootId":"assertion-a816a6dcecb801c427135b9347c34058ea1251cdd519e2fc7fe53b5ea9e2dd54","sourceDigest":"617d905e7ae5b7add0ef951c58d95673584d6ce2d2a9b921d5929803ca803a79","shapeDigest":"bbdd3d95e8376bcc6d299d7c9a469af68f80bbea7dc29f130960fc775a03d951","samples":{"macos-x64":[117329,"126533553913"]}},
    {"rootId":"assertion-c2a43c05e4202501b37d4e84c30eaa04e590c2df67cddbb50735e949c8873e04","sourceDigest":"f1594cc58df26b15fdd252a3e748a46d1d3173f9eaf400fbabef7ab27cba17e4","shapeDigest":"e982bfe54240da4d9b071ff61c98a36f83c30efcd51f475963ddcce7499538a6","samples":{"macos-x64":[123567,"126533553913"]}},
    {"rootId":"assertion-7a2b10858db982bc67823d06a1d661b264eabcbe60ac8b9f70429c5de728d3ad","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"5bea87acd3c60b6b06a6ea55da4c9e70ad1a44b4ab56e6f9a183f888dbbad214","samples":{"macos-x64":[134223,"126533553913"]}},
    {"rootId":"assertion-867c856a68e6962fca9d8495772ab2ab98ddcfb3c6d0858cae4cfe44ddec7e3c","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"9126eca32fece324dacc2b4bd39840a12fbe1f8505b195f5cf5ab7c1475b1b90","samples":{"macos-x64":[146201,"126533553913"]}},
    {"rootId":"assertion-080e2671f869e26190362df0dcac0349c7a47e03fd497c6a70179489ef478386","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"bfcaa88f62ce793e61a1de810faa6328c61530a7f5f48724d22d9bd32d2aa7e5","samples":{"macos-x64":[163295,"126533553913"]}},
    {"rootId":"assertion-4dda1118e3095dddc78d663d95c3c839b19807c0c4d91e69ca176e40b93df30c","sourceDigest":"977f2c8baeb6343559c3725d089b3b300beb09a11f78592caf59a3fb09c47a5b","shapeDigest":"dd3c0415779ff6a5e3d06a4ca78015b0b6683c58b7c0e2a37ca4356335fcce6c","samples":{"macos-x64":[177728,"126533553913"]}},
    {"rootId":"assertion-c937700e1f02501d67f93f8500acf29607768a75116ffa5c809237413d2c1505","sourceDigest":"2da5f828958be2bbaa3d5c3b2b7a888fce2c590ef00ed966829deb2416b98ddb","shapeDigest":"3c95ff0985754b08c246c7e638e667d73d649055da9a112a0c0602b76f0e8f61","samples":{"macos-x64":[210050,"126533553913"]}},
    {"rootId":"assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22","sourceDigest":"dd4e878f1d8d9fc15fc7b167da7edce801d06b6767cbf25f133aa9581e4a07cf","shapeDigest":"8f3e8ad75abca04eb87793bec9b882909d3eaa9b263041d1830a3724b9078951","samples":{"macos-x64":[614424,"126533553913"]}}
  ]
});
Object.freeze(nativePlacementCostsV8.workers);
Object.freeze(nativePlacementCostsV8.originalAnnotations);
for (const hint of nativePlacementCostsV8.roots) {
  Object.values(hint.samples).forEach(Object.freeze);
  Object.freeze(hint.samples);
  Object.freeze(hint);
}
Object.freeze(nativePlacementCostsV8.roots);
export const nativePlacementIsolationV8 = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "90ae1e4ae10620e12897a5f79be03b4225d2b928",
  "runId": "41817138524",
  "attempt": "1",
  "node": "24.20.0",
  "qualification": "exact standalone Intel catalog component isolation hypothesis; no execution credit or predicted latency saving",
  "target": "macos-x64",
  "capacity": 14,
  "shard": "body-0",
  "rootId": "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
  "sourceDigest": "f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94",
  "shapeDigest": "40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13",
  "minimumSlots": 1
});
export const nativePlacementCostsV9 = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "07c64a0018645abd3d46b690590a353aea6716f3",
  "runId": "41828352389",
  "attempt": "1",
  "node": "24.20.0",
  "workers": {"macos-x64": 14},
  "qualification": "completed original Intel group scheduling leads; exact target/runtime/closure/resources required; no execution credit or predicted lane duration; unknown work uses historical or count fallback",
  "originalAnnotations": {
    "126571226424": "ef5b16c25b7c27e116ffd3517f18fc7a2e6c0885d852ece56ae59d0a3e68bd5a",
    "126571352000": "3753403de990d4b590bb32e7fb79bee8203d698c58eb769c604e7578334d8f36",
    "126571352115": "b2ca84702da768f3d3e4be56b01b48e79b3894b06859995b676c8500f9dd1884"
  },
  "roots": [
    {"rootId":"assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13","samples":{"macos-x64":[227014,"126571226424"]}},
    {"rootId":"assertion-170a22b6fc70b1916f2ee09e1de78f6275b1aa46a21259d4e662a6cf3ee8e8f3","sourceDigest":"b93ad9aa0303a801fadd083755b42bd39eb1709159fb612fafad14d86da9227e","shapeDigest":"f25595cc6dd05161572b94ed4aa2dcebff57e6a775ce9f605c961695bdd0af31","samples":{"macos-x64":[144176,"126571352000"]}},
    {"rootId":"assertion-ff45bf92348abb3ee3446f1084f9cfcc45bada03197936aca2981a95ad1d8665","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"b6a30ae7ff82844eb8d73c6a1585a69906206588ad1535e775a9ccd608e32808","samples":{"macos-x64":[145179,"126571352000"]}},
    {"rootId":"assertion-f5499e4dc0d5f9a249e2c7556748164af33a9a8717701df2670d9a516fdb52b3","sourceDigest":"1e80c22a797add7e9ac83ada791cca30beda432c264c45e904dc32035614b1d3","shapeDigest":"dc4aed2053e31a862435bea984a28752818f93a88519e6f150b61e2af5b50a9c","samples":{"macos-x64":[152401,"126571352000"]}},
    {"rootId":"assertion-3a7922c4722be7913112ec7dd2a54bb21ba4ce6d9960efc7a19f0192ab70d049","sourceDigest":"d9075de57cc81c471ab4ca15ce17d4a9cef2f809051b23dfc425dc62efa4cfc8","shapeDigest":"ca6256578092b38627897dfe1d652f17d00f79face97f9babd04a5d8fc201181","samples":{"macos-x64":[185207,"126571352000"]}},
    {"rootId":"assertion-c88fcc43622cb44b08aea5a9d7adc06253c79aedbfe31a9b43ad19f03e59d63c","sourceDigest":"4132e8d404c4625068ddebfc7e9465c0d230e04a97de2236b8b589682c573e49","shapeDigest":"2827b68451aba014b12a803b2c4129227230e2dcd54449979943fd5164afa2d6","samples":{"macos-x64":[198259,"126571352000"]}},
    {"rootId":"assertion-774b6605ebd531372e319c27028ff9e9f17258323ee112a968fdfe43e3f44a2e","sourceDigest":"b325b2472b65bcfdf642968256d396c1271b6d8abfd950233a369293a604e13c","shapeDigest":"16bcccb024f09e44a788cfa45d6fcd58f8ed1b69555fb1d7907ac1612baceddf","samples":{"macos-x64":[206742,"126571352000"]}},
    {"rootId":"assertion-95ad460a630507970746bfdf4bbec35491dc9749218a5cb6437baaa576c36d34","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"b786c72a0cd53cc191e96099ee86c543b481ed56ab683c247fd8321e25494403","samples":{"macos-x64":[216446,"126571352000"]}},
    {"rootId":"assertion-c937700e1f02501d67f93f8500acf29607768a75116ffa5c809237413d2c1505","sourceDigest":"2da5f828958be2bbaa3d5c3b2b7a888fce2c590ef00ed966829deb2416b98ddb","shapeDigest":"3c95ff0985754b08c246c7e638e667d73d649055da9a112a0c0602b76f0e8f61","samples":{"macos-x64":[252281,"126571352000"]}},
    {"rootId":"assertion-063b315aa5106b822a0982a0ee26caa7c4d26179ed1a79958a3bc918d786dfde","sourceDigest":"a67a6da1ea28c54eb8ca17463ef232eb7afa4d4fd86b1ef090ab944e542f4809","shapeDigest":"6871839e5d2760bf9ef8b3d09578bfdb535a49c403dd6c34a3387a609a7571a2","samples":{"macos-x64":[265265,"126571352000"]}},
    {"rootId":"assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22","sourceDigest":"dd4e878f1d8d9fc15fc7b167da7edce801d06b6767cbf25f133aa9581e4a07cf","shapeDigest":"8f3e8ad75abca04eb87793bec9b882909d3eaa9b263041d1830a3724b9078951","samples":{"macos-x64":[796381,"126571352000"]}},
    {"rootId":"assertion-fbba6948bfbddb931f8ceb750aebddfbcf2f2d4a7432bc539cf7558351d206aa","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"0a0af1c920a2449128d015017c405db236a0734b8a5364a4b65f7545ca08bf3d","samples":{"macos-x64":[144560,"126571352115"]}},
    {"rootId":"assertion-b0a14ca74a43eb87fbdece3db7dd5ca468cfef0549f890797206d7671b31afcc","sourceDigest":"04ee07ac02e8de025ffc97755da22ecfb624197d8266d8d718413c2b53c3822f","shapeDigest":"92055d23287b6f60b448820ccde4aca39abd154714033b5d023ee9c0943b9bab","samples":{"macos-x64":[146062,"126571352115"]}},
    {"rootId":"assertion-67716b485944f5af7e87adc105fb7026085b7f47639e86c6afe1bf330e998305","sourceDigest":"d48a0b74138d1e0bfdf34477d80e0df7062fb636caba2cccbe947165d15beb2a","shapeDigest":"2b331b5fce15957103bd4ccd3cd5f67a30e87b1be82c2cf67021ec547e7bf8d7","samples":{"macos-x64":[146888,"126571352115"]}},
    {"rootId":"assertion-ae62135c83d676d2db6d13a3b7cdfd189adab6a9145d95a58d51d6113e79a06a","sourceDigest":"b93ad9aa0303a801fadd083755b42bd39eb1709159fb612fafad14d86da9227e","shapeDigest":"a00a7af10779b6745c12d4ab7f772f499268a1e8f41e9eac589dae087d48d2e8","samples":{"macos-x64":[148006,"126571352115"]}},
    {"rootId":"assertion-867c856a68e6962fca9d8495772ab2ab98ddcfb3c6d0858cae4cfe44ddec7e3c","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"9126eca32fece324dacc2b4bd39840a12fbe1f8505b195f5cf5ab7c1475b1b90","samples":{"macos-x64":[156078,"126571352115"]}},
    {"rootId":"assertion-080e2671f869e26190362df0dcac0349c7a47e03fd497c6a70179489ef478386","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"bfcaa88f62ce793e61a1de810faa6328c61530a7f5f48724d22d9bd32d2aa7e5","samples":{"macos-x64":[183824,"126571352115"]}},
    {"rootId":"assertion-4dda1118e3095dddc78d663d95c3c839b19807c0c4d91e69ca176e40b93df30c","sourceDigest":"03ce5028aa70a35070f7a81a8d601669c98235a89ef775da8f4928883374dcc4","shapeDigest":"dd3c0415779ff6a5e3d06a4ca78015b0b6683c58b7c0e2a37ca4356335fcce6c","samples":{"macos-x64":[187601,"126571352115"]}},
    {"rootId":"assertion-0ea538f933586c33183708df2824759a052883291fefb6424328a21553cfa543","sourceDigest":"d64c98e670a4fc650881e3ec0f21279858bf0b3d217ccc480fcf93fcc3aab730","shapeDigest":"5e3c09692ad710209995957de63291f64e6fda72b6e91a0dd70ffc71312925a5","samples":{"macos-x64":[202462,"126571352115"]}},
    {"rootId":"assertion-b1b032561853815caa7a039f5c020e573a19067118dec177cae55e2d89dc1092","sourceDigest":"b93ad9aa0303a801fadd083755b42bd39eb1709159fb612fafad14d86da9227e","shapeDigest":"c37a4c9b2a3458f0621c8546fa8728289fb4c765e5b67c06f3f8c9e913b29f50","samples":{"macos-x64":[298047,"126571352115"]}},
    {"rootId":"assertion-b2f6b8cc0c4b155029db7340530b19d47c2e58ec03f5ad64c1b937c8c9797c45","sourceDigest":"8540aefa1f0651bfe834bd13d5529e4a907556cb6dbd266e81bcf792d42c0281","shapeDigest":"eec7bce119abafd9d4f5641d6bfbb4979ee0e4db22594ac1336514e2d656eb74","samples":{"macos-x64":[414139,"126571352115"]}}
  ]
});
Object.freeze(nativePlacementCostsV9.workers);
Object.freeze(nativePlacementCostsV9.originalAnnotations);
for (const hint of nativePlacementCostsV9.roots) {
  Object.values(hint.samples).forEach(Object.freeze);
  Object.freeze(hint.samples);
  Object.freeze(hint);
}
Object.freeze(nativePlacementCostsV9.roots);
export const nativePlacementPhasesV9 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-primary-phases-v1",
  "sourceRevision": "07c64a0018645abd3d46b690590a353aea6716f3",
  "runId": "41828352389",
  "attempt": "1",
  "node": "24.20.0",
  "qualification": "exact standalone Intel catalog then retained component isolation hypothesis; no execution credit or predicted latency saving",
  "target": "macos-x64",
  "capacity": 14,
  "shard": "body-0",
  "phases": [
    {"name":"regression-catalog","rootId":"assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13","minimumSlots":1},
    {"name":"regression-retained","rootId":"assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22","sourceDigest":"dd4e878f1d8d9fc15fc7b167da7edce801d06b6767cbf25f133aa9581e4a07cf","shapeDigest":"8f3e8ad75abca04eb87793bec9b882909d3eaa9b263041d1830a3724b9078951","minimumSlots":4}
  ]
});
nativePlacementPhasesV9.phases.forEach(Object.freeze);
Object.freeze(nativePlacementPhasesV9.phases);
export const nativePlacementPhasesV10 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-primary-phases-v2",
  "sourceRevision": "ce9ff1c83b177a5d5a710c8611ae181caa225eb5",
  "runId": "41874728696",
  "attempt": "1",
  "node": "24.20.0",
  "qualification": "exact current-source standalone Intel catalog then retained then observer component rebalance hypothesis; original observer source retained separately after unrelated protocol-count maintenance; no execution credit or predicted latency saving",
  "target": "macos-x64",
  "capacity": 14,
  "shard": "body-0",
  "phases": [
    {"name":"regression-catalog","rootId":"assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5","sourceDigest":"f04e8202d5adb8cea8aee41c2910a7d551dfc3732bbc6c46f7768b72253fdb94","shapeDigest":"40b59ccff4ce9caa7d8c65b1450c4862b8770ed7a1e3fdc26e589cf6e03b5a13","minimumSlots":1},
    {"name":"regression-retained","rootId":"assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22","sourceDigest":"dd4e878f1d8d9fc15fc7b167da7edce801d06b6767cbf25f133aa9581e4a07cf","shapeDigest":"8f3e8ad75abca04eb87793bec9b882909d3eaa9b263041d1830a3724b9078951","minimumSlots":4},
    {"name":"regression-observer","rootId":"assertion-b1b032561853815caa7a039f5c020e573a19067118dec177cae55e2d89dc1092","sourceDigest":"12905ecc4796aa7ea913bbfc41f136f93dcaa7a55c15a97dc520c92a65ecaefe","observedSourceDigest":"62b7599c2eb80c198474dbae12cd4eba79d0c569f44ad540ed5c0dbf0d15463f","callbackDigest":"f0152dd07285a27a3b5182273a7e2c6778545088d3d7582919f42ea11e3d9956","shapeDigest":"c37a4c9b2a3458f0621c8546fa8728289fb4c765e5b67c06f3f8c9e913b29f50","minimumSlots":1}
  ]
});
nativePlacementPhasesV10.phases.forEach(Object.freeze);
Object.freeze(nativePlacementPhasesV10.phases);
export const nativePlacementCostsV11 = Object.freeze({
  "schemaVersion": 1,
  "sourceRevision": "8708bf00e307086b7db1c4142f11bced6e821283",
  "producerRevision": "3af2a332cf69dbf65de0ce265df823765b423b04",
  "sourceDigest": "7db3e750c5c799aa7aec3430ad7fd71c9b249c9d865e1baefa33a3837ca5bbe8",
  "runId": "41934920491",
  "attempt": "1",
  "node": "24.20.0",
  "target": "macos-x64",
  "capacity": 14,
  "qualification": "original C74 diagnostic duration upper bounds, not exact secondary ticks or execution credit; exact adopted current inventory and ordered source/callback/resource bindings required; changed callbacks and unknown roots have no cost",
  "observedInventoryDigest": "5c4c75f59c39c07dc28db25bc42faa7d22c075ddd2ac258b3eb81b8eaa1a3ec9",
  "inventoryDigest": "b3cafe8dde9fe14b738fdb493fa8fe42465a7e9b81c74367f0bf76b614383522",
  "rootBindingDigest": "c2b441850f0de01d5e366c36fba51689ac8a7f4a65abffb80de29ea909cc8982",
  "observedRootBindingDigest": "807387c9a25696ba55a0dbdd6159b42cbc40032e646552f0f25c46df6b2ad379",
  "durations": [8191,16383,8191,90111,16383,16383,114687,16383,8191,16383,40959,16383,65535,65535,32767,8191,8191,8191,40959,139263,8191,8191,57343,226624,16383,40959,24575,8191,8191,272933,24575,57343,49151,49151,16383,24575,8191,32767,8191,8191,81919,24575,8191,16383,8191,73727,8191,81919,32767,24575,32767,305319,98303,24575,8191,24575,395116,16383,16383,81919,73727,8191,8191,8191,32767,24575,57343,16383,24575,16383,16383,32767,98303,40959,8191,16383,24575,8191,32767,24575,16383,139263,8191,40959,81919,24575,8191,24575,16383,16383,24575,8191,8191,40959,24575,73727,16383,32767,73727,49151,65535,8191,49151,24575,8191,24575,24575,24575,8191,57343,8191,16383,32767,16383,32767,8191,8191,8191,8191,49151,16383,81919,8191,24575,24575,16383,32767,16383,32767,8191,16383,8191,73727,24575,57343,8191,106495,32767,8191,90111,40959,57343,40959,8191,16383,8191,8191,40959,16383,8191,8191,24575,24575,8191,8191,8191,57343,180223,16383,16383,16383,32767,16383,65535,8191,8191,57343,57343,81919,32767,8191,8191,32767,32767,49151,16383,8191,16383,8191,8191,8191,8191,8191,32767,32767,24575,8191,40959,8191,16383,24575,112581,8191,16383,32767,24575,16383,65535,8191,8191,8191,8191,24575,8191,8191,57343,16383,8191,16383,8191,90111,16383,8191,8191,8191,49151,49151,65535,40959,8191,24575,8191,16383,16383,16383,49151,8191,185489,24575,65535,32767,40959,131071,8191,32767,73727,8191,8191,16383,16383,8191,40959,57343,57343,16383,8191,98303,16383,139263,16383,16383,106495,16383,40959,null,16383,8191,16383,16383,81919,8191,8191,8191,8191,8191,106495,24575,32767,8191,16383,16383,81919,49151,16383,8191,32767,16383,8191,8191,32767,8191,8191,32767,65535,16383,49151,16383,32767,24575,8191,16383,16383,8191,32767,73727,8191,16383,8191,8191,8191,8191,16383,16383,8191,8191,16383,8191,8191,73727,16383,320274,16383,24575,49151,24575,40959,8191,32767,32767,40959,16383,16383,90111,8191,8191,8191,8191,73727,49151,90111,8191,8191,8191,24575,16383,8191,16383,16383,114687,8191,8191,40959,8191,24575,40959,16383,16383,8191,8191,49151,8191,32767,null,8191,16383,32767,57343,16383,8191,8191,8191,24575,40959,16383,8191,16383,8191,98303,24575,40959,8191,8191,16383,16383,8191,16383,16383,8191,8191,24575,16383,32767,8191,8191,40959,8191,40959,8191,8191,8191,8191,16383,24575,32767,8191,8191,49151,24575,73727,8191,32767,57343,32767,8191,40959,16383,8191,40959,16383,40959,205503,16383,57343,32767,8191,8191,16383,49151,8191,32767,8191,24575,8191,32767,16383,8191,8191,40959,32767,16383,40959,32767,8191,16383,8191,8191,16383,8191,8191,73727,73727,8191,24575,139263,40959,49151,155647,16383,8191,16383,57343,32767,8191,49151,8191,8191,8191,8191,8191,8191,90111,8191,49151,40959,8191,16383,16383,73727,24575,8191,8191,16383,8191,49151,8191,16383,73727,8191,40959,8191,65535,8191,8191,32767,8191,8191,16383,24575,8191,32767,8191,57343,274009,8191,16383,8191,8191,24575,32767,16383,8191,237016,8191,32767,8191,8191,122879,8191,16383,16383,57343,16383,16383,8191,8191,8191,57343,16383,40959,8191,40959,24575,16383,8191,81919,16383,8191,8191,49151,40959,57343,8191,81919,8191,16383,16383,120881,8191,8191,57343,16383,8191,24575,8191,8191,253359,8191,49151,16383,8191,8191,8191,16383,40959,65535,73727,49151,8191,null,24575,8191,32767,16383,8191,8191,32767,8191,16383,16383,8191,16383,16383,16383,16383,106495,8191,16383,106495,32767,16383,8191,24575,8191,8191,16383,73727,65535,24575,106495,8191,16383,32767,16383,8191,114687,8191,40959,32767,49151,16383,16383,81919,8191,16383,8191,16383,8191,235294,16383,24575,16383,8191,16383,24575,8191,8191,16383,57343,73727,90111,8191,8191,16383,144450,49151,16383,40959,40959,8191,8191,24575,24575,16383,8191,139263,16383,65535,16383,16383,8191,8191,32767,49151,90111,8191,8191,8191,40959,8191,8191,8191,16383,40959,8191,16383,8191,16383,8191,24575,8191,8191,32767,16383,8191,193982,8191,8191,8191,8191,16383,24575,8191,16383,73727,8191,8191,24575,32767,24575,8191,16383,8191,16383,40959,24575,8191,40959,32767,8191,8191,24575,8191,49151,73727,8191,null,24575,16383,24575,16383,40959,198330,73727,47834,8191,32767,24575,8191,40959,16383,563687,8191,24575,73727,32767,40959,49151,24575,8191,8191,16383,8191,8191,8191,32767,40959,8191,8191,8191,24575,16383,40959,16383,24575,8191,24575,24575,16383,81919,106495,8191,40959,32767,98303,40959,16383,32767,106495,16383,8191,8191,8191,40959,40959,32767,24575,24575,8191,8191,24575,16383,8191,24575,191681,8191,8191,8191,32767,8191,8191,8191,8191,8191,16383,114687,16383,40959,16383,8191,16383,40959,16383,32767,90111,49151,73727,16383,57343,73727,81919,40959,16383,24575,207141,8191,16383,49151,268746,16383,16383,73727,8191,16383,8191,16383,16383,98303,16383,16383,49151,73727,8191,8191,40959,24575,16383,16383,8191,32767,24575,32767,24575,8191,16383,8191,8191,8191,49151,8191,114687,8191,8191,40959,8191,40959,24575,40959,65535,8191,73727,16383,32767,null,16383,8191,8191,24575,24575,49151,81919,16383,8191,16383,163839,131071,57343,24575,8191,8191,8191,65535,24575,8191,40959,122879,16383,65535,24575,16383,16383,8191,16383,73727,16383,16383,8191,24575,32767,24575,40959,8191,73727,16383,32767,65535,8191,8191,16383,32767,24575,8191,40959,8191,8191,8191,16383,16383,8191,8191,8191,8191,65535,16383,122879,24575,90111,8191,57343,8191,40959,40959,65535,24575,73727,32767,8191,40959,32767,16383,8191,32767,16383,24575,16383,8191,24575,16383,16383,16383,24575,24575,24575,8191,24575,16383,49151,65535,8191,8191,40959,24575,8191,49151,8191,8191,122879,8191,24575,106495,16383,139263,49151,8191,32767,98303,49151,24575,49151,8191,8191,8191,16383,16383,8191,32767,16383,32767,32767,8191,16383,8191,8191,8191,8191,24575,155647,16383,65535,8191,8191,24575,16383,16383,32767,8191,57343,114687,16383,24575,8191,16383,8191,16383,8191,8191,57343,16383,16383,203160,49151,8191,57343,16383,16383,16383,16383,57343,40959,57343,8191,8191,24575,65535,73727,144905]
});
export const nativePlacementReadyPoolV11 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-parallel-ready-pool-v1",
  "node": "24.20.0",
  "target": "macos-x64",
  "capacity": 14,
  "qualification": "whole independent components share the unchanged bounded ready pool; historical slot-work offsets are planning leads only, not a lane prediction or measured contention saving",
  "anchors": [
    "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
    "assertion-30a06918b0d6d26eed9773acffe13e64087e7a1ec315a6a5c60d6a026fb52d22",
    "assertion-b1b032561853815caa7a039f5c020e573a19067118dec177cae55e2d89dc1092"
  ],
  "shards": [
    {"shard":"body-0","historicalFixedMs":346068,"tools":{"go":false,"python":true,"schema":false,"homebrew":false,"ownedPrefix":false,"crypto":false}},
    {"shard":"body-1","historicalFixedMs":520428,"tools":{"go":false,"python":true,"schema":false,"homebrew":false,"ownedPrefix":false,"crypto":true}},
    {"shard":"body-2","historicalFixedMs":707867,"tools":{"go":true,"python":true,"schema":true,"homebrew":false,"ownedPrefix":false,"crypto":false}}
  ]
});
Object.freeze(nativePlacementCostsV11.durations);
nativePlacementReadyPoolV11.shards.forEach(shard => {
  Object.freeze(shard.tools);
  Object.freeze(shard);
});
Object.freeze(nativePlacementReadyPoolV11.anchors);
Object.freeze(nativePlacementReadyPoolV11.shards);
export const nativePlacementTransfersV12 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-service-balance-v1",
  "target": "macos-x64",
  "node": "24.20.0",
  "capacity": 14,
  "baseCostsDigest": "786677996667903383bcc8f0fd135eb2c45ca9783aa5dbc6d2ecbd9da03958bb",
  "baseRootOrderDigest": "588bce3088f11005413c036687d1b11b9905b6b3975455ce59724a9d08586dbd",
  "inventoryDigest": "62094e61ba9305faef6784e4d4c551ddd8f1ab9f172b2aea6a3564eb993ac9f9",
  "rootBindingDigest": "fb9fea66d043210e2a5f6526ae253aecb84bb793c93bdf23cadb8f7c7415e587",
  "from": "body-1",
  "to": "body-2",
  "roots": [
    "assertion-867c856a68e6962fca9d8495772ab2ab98ddcfb3c6d0858cae4cfe44ddec7e3c",
    "assertion-95ad460a630507970746bfdf4bbec35491dc9749218a5cb6437baaa576c36d34",
    "assertion-67716b485944f5af7e87adc105fb7026085b7f47639e86c6afe1bf330e998305",
    "assertion-b0a14ca74a43eb87fbdece3db7dd5ca468cfef0549f890797206d7671b31afcc",
    "assertion-c2a43c05e4202501b37d4e84c30eaa04e590c2df67cddbb50735e949c8873e04",
    "assertion-c937700e1f02501d67f93f8500acf29607768a75116ffa5c809237413d2c1505"
  ],
  "unknownRoots": [
    "assertion-150c7bc6c9f0dddd0620cec5148fbed8d64ba35976405723578b06528b5e5047",
    "assertion-3e6dd22dc326d8b6ed30a052848f7a49a0f12768e6bd964b2a1b9b415a266f3e",
    "assertion-583587077cd3503a4387cce4058358a61651710ff9f49d837189dbfe8c0596af",
    "assertion-68345f06baf336a7a48e0e0e47c5206a09e27a6d20659f23740bdbefdd15eed2",
    "assertion-8a258f8e02bad65e421a093dd0bf08ac52540d6e5956e67c2710a69b83b00278",
    "assertion-ae62135c83d676d2db6d13a3b7cdfd189adab6a9145d95a58d51d6113e79a06a",
    "assertion-d33dd92ab0ef357c66eced91ec8ed8b491ac4c48b19b4f5543935ea2f64f37e7"
  ]
});
Object.freeze(nativePlacementTransfersV12.roots);
Object.freeze(nativePlacementTransfersV12.unknownRoots);
export const nativePlacementReservationV13 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-catalog-reservation-v1",
  "target": "macos-x64",
  "node": "24.20.0",
  "capacity": 14,
  "baseCostsDigest": "786677996667903383bcc8f0fd135eb2c45ca9783aa5dbc6d2ecbd9da03958bb",
  "baseRootOrderDigest": "588bce3088f11005413c036687d1b11b9905b6b3975455ce59724a9d08586dbd",
  "baseTransfersDigest": "e00b3e325fffe871a3e47d679d52b98ed553bb3e5f40d17ae3105d7d9fffeb85",
  "inventoryDigest": "167c3e04b1b7fef0c399273e323bde45a8b509f633e12013ab541f5e777095e7",
  "rootBindingDigest": "61c56f041382dc0316d1a14b64306b87b55d319764cf4855f074621f0eb0b263",
  "ownershipSourceRevision": "e72af1a6f75bd7f1862489595b37509c3c50c9ba",
  "ownershipSourceProtocol": "native-framework-shards-v12-intel-service-balance",
  "baseOwners": "1202002200222011000010020210202222110102101211021010200002212111120221220121111221200012220202120210021010110100200021121112110022221000112120220100112102001100112111221022212122202101111122002100201010021120220220000101122110002100100220221112120102011000201000010020212212020122101022100122002000110221112111020021222222220200011022212122122211000112210000120100222121200022022212202021012102122210122121210112200200102012212111022120200120211000222001001202112011110212020002002221001212210212111010220212210201202101120120200222022202101221011112111122011111010122102100222110022010202101101022221020111111002011110020101020211121111120202102201112122111211202020221001002011021012220222102111200011001002000202112222012202212000012100002011202112112001222011100020011110111201100111002101010212012122110110112202100211101221000022101001010211112221001221010000201121100112100120121001102012000101101021221002200201000100100212221000100101220220100102102011212211220200101020102020010011010022101012010011122021",
  "catalog": {
    "rootId": "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
    "definitionDigest": "5ad28b4f4848309b54fb9650eb1a4021163b23f5caf5a53fd8594817bef51df3",
    "sourceDigest": "3d689f14cea0c08026e8220497058104597324952d0f7bffc6ee61b33ce637a2",
    "shapeDigest": "67a78cebfc67220b840c4c1a5083372569277b5c60ef9845a87fb7278dd8398d",
    "minimumSlots": 7
  },
  "unknownRoots": [
    "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
    "assertion-150c7bc6c9f0dddd0620cec5148fbed8d64ba35976405723578b06528b5e5047",
    "assertion-3e6dd22dc326d8b6ed30a052848f7a49a0f12768e6bd964b2a1b9b415a266f3e",
    "assertion-583587077cd3503a4387cce4058358a61651710ff9f49d837189dbfe8c0596af",
    "assertion-68345f06baf336a7a48e0e0e47c5206a09e27a6d20659f23740bdbefdd15eed2",
    "assertion-8a258f8e02bad65e421a093dd0bf08ac52540d6e5956e67c2710a69b83b00278",
    "assertion-ae62135c83d676d2db6d13a3b7cdfd189adab6a9145d95a58d51d6113e79a06a",
    "assertion-d33dd92ab0ef357c66eced91ec8ed8b491ac4c48b19b4f5543935ea2f64f37e7"
  ]
});
Object.freeze(nativePlacementReservationV13.catalog);
Object.freeze(nativePlacementReservationV13.unknownRoots);
export const nativePlacementServiceV14 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-catalog-fixture-service-v1",
  "target": "macos-x64",
  "node": "24.20.0",
  "capacity": 14,
  "baseCostsDigest": "786677996667903383bcc8f0fd135eb2c45ca9783aa5dbc6d2ecbd9da03958bb",
  "baseTransfersDigest": "e00b3e325fffe871a3e47d679d52b98ed553bb3e5f40d17ae3105d7d9fffeb85",
  "baseReservationDigest": "087ca43a82737b3cf82d73bde152f9dcc913e32392719ac2f30ceea44a063372",
  "baseRootOrderDigest": "588bce3088f11005413c036687d1b11b9905b6b3975455ce59724a9d08586dbd",
  "currentRootOrderDigest": "0e08c465172e47f3cb1645e56a5d069d8fbeab8668f14b2ad489f316e2ac0f49",
  "inventoryDigest": "ee53d6383cc22512c53c4183d4e1d29fe6fff0d9b111534bc0577709ea8eebab",
  "rootBindingDigest": "4bfdbc6211239981c2858df25e05a056d32c5cda25ff3bcb9912a33dcb4716fb",
  "ownershipSourceRevision": "9f29a31d84119a07e082dd7d438f59f9e4ce05ff",
  "ownershipSourceProtocol": "native-framework-shards-v13-catalog-process-reservation",
  "catalog": {
    "rootId": "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
    "definitionDigest": "5ad28b4f4848309b54fb9650eb1a4021163b23f5caf5a53fd8594817bef51df3",
    "sourceDigest": "b02f5b6d88f2d54a5cec8d2a586f48a1781bdb124a2856c3f809500bd7845519",
    "shapeDigest": "67a78cebfc67220b840c4c1a5083372569277b5c60ef9845a87fb7278dd8398d",
    "minimumSlots": 7
  },
  "additionalRoots": [{
    "rootId": "assertion-0ac04224a6b64b1e7dd457ce996c953de76df4b549c9af3634eff098829070f3",
    "shard": "body-2"
  }],
  "unknownRoots": [
    "assertion-0ac04224a6b64b1e7dd457ce996c953de76df4b549c9af3634eff098829070f3",
    "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
    "assertion-150c7bc6c9f0dddd0620cec5148fbed8d64ba35976405723578b06528b5e5047",
    "assertion-3e6dd22dc326d8b6ed30a052848f7a49a0f12768e6bd964b2a1b9b415a266f3e",
    "assertion-583587077cd3503a4387cce4058358a61651710ff9f49d837189dbfe8c0596af",
    "assertion-68345f06baf336a7a48e0e0e47c5206a09e27a6d20659f23740bdbefdd15eed2",
    "assertion-6a2d4f126609d3bee285469a4b94d1c2cb0e82c84442090c6dc5b256cf36f1d6",
    "assertion-7db60410fe853de36bd473c60d4f8b4b1035bf6fa18b7c5cd83a1ae60e4c46c8",
    "assertion-807d82cab4e37ed911a2678cff21eb90b367045e7aaf5d0c95337588d7a94495",
    "assertion-8a258f8e02bad65e421a093dd0bf08ac52540d6e5956e67c2710a69b83b00278",
    "assertion-a14e69248877b8d940c6555e2dd391a891bc3639b8cc923781614f272789c571",
    "assertion-ae62135c83d676d2db6d13a3b7cdfd189adab6a9145d95a58d51d6113e79a06a",
    "assertion-d33dd92ab0ef357c66eced91ec8ed8b491ac4c48b19b4f5543935ea2f64f37e7"
  ]
});
Object.freeze(nativePlacementServiceV14.catalog);
nativePlacementServiceV14.additionalRoots.forEach(Object.freeze);
Object.freeze(nativePlacementServiceV14.additionalRoots);
Object.freeze(nativePlacementServiceV14.unknownRoots);
export const nativePlacementOwnershipV15 = Object.freeze({
  "schemaVersion": 1,
  "protocol": "native-intel-source-qualified-ownership-v1",
  "target": "macos-x64",
  "node": "24.20.0",
  "capacity": 14,
  "baseServiceDigest": "a3c0f82a85456b7263129c207b10abfa649e97d9a2827b92992328078c5fe5e4",
  "ownershipSourceRevision": "51de4c9ff6a62c655dede580d8328eb6e9ea47c8",
  "ownershipSourceProtocol": "native-framework-shards-v14-catalog-fixture-service",
  "inventoryDigest": "98fc44573604a377f05e1e721b645fcada3396500530b0019291237d720f894d",
  "rootOrderDigest": "0e08c465172e47f3cb1645e56a5d069d8fbeab8668f14b2ad489f316e2ac0f49",
  "rootBindingDigest": "d55810141bf7c03101860bf0ac3dd8b0b117df88386078de3741aa0338f6f0ee",
  "owners": "12020022002220110000100202102022221210102101211021010200002212111120221220121111221200012220202120210021010110100200021121112110022221000112120220100112102001100112111221022212122202101111122002100201010021120220220000101122110002100100220221112120102011000201000010020212212020122101022100122002000110221112111020021222222220200011022212122122211000112210000120100222121200022022212202021012102122210122121210122200200102012212111022120200120211000222001001202112011110212020002002221001212210212111010220212210201202101120120200222022202101221021112111122011111010122102100222110022010202101101022221020111211002011110020101020211121111120202102201112122111211202020221001002011021012220222102111200021001002000202112222012202212000012100002011202112112001222011200020011110111201100111002101010222012122110110112202100211101221000022101001010211112221001221010000201121100112100120121001102012000101101021221002200201000100100212221000100101220220100102102011212211220200101020102020010011010022101012010011122021",
  "serviceStatus": "unmeasured-current-service",
  "catalog": {
    "rootId": "assertion-0f5721a6329b2ef16d4f48e70ef01d0f0715e6a4f3cefeedc3449361fa57e8e5",
    "definitionDigest": "5ad28b4f4848309b54fb9650eb1a4021163b23f5caf5a53fd8594817bef51df3",
    "sourceDigest": "4e17baa4e5c6b3275aac31201c565b1e282e55485823cbf844d894c1a4fc7d63",
    "shapeDigest": "67a78cebfc67220b840c4c1a5083372569277b5c60ef9845a87fb7278dd8398d",
    "minimumSlots": 7
  }
});
Object.freeze(nativePlacementOwnershipV15.catalog);
export const nativeFrameworkShardProtocols = Object.freeze([
  nativeLegacyFrameworkShardProtocol, nativePlatformUnitFrameworkShardProtocol,
  nativeFourBodyFrameworkShardProtocol, nativeSplitUnitFrameworkShardProtocol,
  nativeRootComponentFrameworkShardProtocol, nativeStableCostFrameworkShardProtocol,
  nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
  nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
  nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
  nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol,
]);
function requireNativePlacementLiteral(source, name, adopted) {
  const tokens = declarationTokens(source);
  const declarations = [];
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    if (depth === 0 && token.kind === 'identifier' && token.value === 'export' &&
      tokens[index + 1]?.value === 'const' && tokens[index + 2]?.value === name) declarations.push(index);
    if (token.kind === 'punctuation' && ['(', '[', '{'].includes(token.value)) depth++;
    if (token.kind === 'punctuation' && [')', ']', '}'].includes(token.value)) depth--;
  }
  requireThat(declarations.length === 1, 'EVIDENCE', `Native placement needs its exact source-declared ${name}`);
  const start = declarations[0];
  requireThat(tokens.slice(start + 3, start + 9).map(token => token.value).join('') === '=Object.freeze({',
    'EVIDENCE', 'Native placement data must be the adopted literal, not executable source');
  const end = tokens.findIndex((token, index) =>
    index > start + 8 && token.kind === 'punctuation' && token.value === ';');
  requireThat(end > start + 7 && tokens[end - 1]?.value === ')' && tokens[end - 2]?.value === '}',
    'EVIDENCE', 'Native placement data must be one closed literal');
  let value;
  try { value = JSON.parse(source.slice(tokens[start + 8].start, tokens[end - 2].end)); }
  catch { requireThat(false, 'EVIDENCE', 'Native placement data must preserve exact JSON source data'); }
  requireThat(digest(value) === digest(adopted),
    'EVIDENCE', 'Captured placement data is not the adopted native protocol version');
}
export function sourceNativeFrameworkShardProtocol(sourceFiles) {
  const sources = sourceFiles.filter(source => source.file === 'scripts/native-validation.mjs');
  requireThat(sources.length === 1, 'EVIDENCE', 'Shard assignment needs the exact original native planner source');
  const declarations = [...sources[0].contents.matchAll(/export const nativeFrameworkShardProtocol = '([^']+)';/gu)];
  requireThat(declarations.length === 1 && nativeFrameworkShardProtocols.includes(declarations[0][1]),
    'EVIDENCE', 'Unknown or malformed source-declared native shard protocol');
  if ([nativeStableCostFrameworkShardProtocol, nativeResourceAffinityFrameworkShardProtocol,
    nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
    nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
    nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
    nativeFrameworkShardProtocol].includes(declarations[0][1]))
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementCosts', nativePlacementCosts);
  if ([nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
    nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
    nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
    nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(declarations[0][1])) {
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementAffinities', nativePlacementAffinities);
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementCostsV7', nativePlacementCostsV7);
  }
  if ([nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
    nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
    nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
    nativeFrameworkShardProtocol].includes(declarations[0][1])) {
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementCostsV8', nativePlacementCostsV8);
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementIsolationV8', nativePlacementIsolationV8);
  }
  if ([nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
    nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
    nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(declarations[0][1])) {
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementCostsV9', nativePlacementCostsV9);
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementPhasesV9', nativePlacementPhasesV9);
  }
  if ([nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
    nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
    nativeFrameworkShardProtocol].includes(declarations[0][1]))
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementPhasesV10', nativePlacementPhasesV10);
  if ([nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
    nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(declarations[0][1])) {
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementCostsV11', nativePlacementCostsV11);
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementReadyPoolV11', nativePlacementReadyPoolV11);
  }
  if ([nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
    nativeFrameworkShardProtocol].includes(declarations[0][1]))
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementTransfersV12', nativePlacementTransfersV12);
  if ([nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(declarations[0][1]))
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementReservationV13', nativePlacementReservationV13);
  if ([nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(declarations[0][1]))
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementServiceV14', nativePlacementServiceV14);
  if (declarations[0][1] === nativeFrameworkShardProtocol)
    requireNativePlacementLiteral(sources[0].contents, 'nativePlacementOwnershipV15', nativePlacementOwnershipV15);
  return declarations[0][1];
}
export const nativeLegacyPrParts = Object.freeze(validationPlatforms.flatMap(target =>
  (target.startsWith('macos-') ? ['framework', 'homebrew'] : ['full'])
    .map(component => Object.freeze({ target, component, role: nativeProducerRole(target, component) }))));
export const nativePrParts = nativePrPartsForProtocol();

export function nativePrPartsForProtocol(protocol = nativeFrameworkShardProtocol) {
  requireThat(nativeFrameworkShardProtocols.includes(protocol), 'INPUT', 'Select a supported native shard protocol');
  return Object.freeze(validationPlatforms.flatMap(target => [
    ...nativeFrameworkShardNames(target, protocol).map(shard => Object.freeze({
      target, component: 'framework', shard, role: nativeProducerRole(target, 'framework', shard),
    })),
    ...(target.startsWith('macos-') ? [Object.freeze({
      target, component: 'homebrew', role: nativeProducerRole(target, 'homebrew'),
    })] : []),
  ]));
}

export function nativeFrameworkShardNames(target, protocol = nativeFrameworkShardProtocol) {
  requireThat(validationPlatforms.includes(target) && nativeFrameworkShardProtocols.includes(protocol),
    'INPUT', 'Select an exact native shard target and supported protocol');
  return [...nativeFrameworkUnitShardNames(target, protocol), 'refresh', ...Array.from({
    length: target.startsWith('macos-') ? 3 :
      [nativeFourBodyFrameworkShardProtocol, nativeSplitUnitFrameworkShardProtocol,
        nativeRootComponentFrameworkShardProtocol, nativeStableCostFrameworkShardProtocol,
        nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
        nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
        nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
        nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ? 4 : 2,
  },
    (_, index) => `body-${index}`)];
}

export function nativeFrameworkUnitShardNames(target, protocol = nativeFrameworkShardProtocol) {
  requireThat(validationPlatforms.includes(target) && nativeFrameworkShardProtocols.includes(protocol),
    'INPUT', 'Select an exact native unit target and supported protocol');
  const count = target === 'macos-x64' &&
    [nativeSplitUnitFrameworkShardProtocol, nativeRootComponentFrameworkShardProtocol,
      nativeStableCostFrameworkShardProtocol, nativeResourceAffinityFrameworkShardProtocol,
      nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
      nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
      nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
      nativeFrameworkShardProtocol].includes(protocol) ? 2 : 1;
  return Array.from({ length: count }, (_, index) => index === 0 ? 'units' : `units-${index}`);
}

export function nativeProducerRole(target, component = 'full', shard = null) {
  requireThat(validationPlatforms.includes(target) && ['full', 'framework', 'homebrew'].includes(component) &&
    (shard === null ? component === 'full' || target.startsWith('macos-') :
      component === 'framework' && nativeFrameworkShardNames(target).includes(shard)), 'INPUT',
  'Native components are explicit full executions or PR-only native Mac framework/Homebrew parts');
  return component === 'full' ? target : `${target}-${component}${shard === null ? '' : `-${shard}`}`;
}

export function nativePartJobKey({ target, shard = null, component }, protocol = nativeFrameworkShardProtocol) {
  requireThat(nativeFrameworkShardProtocols.includes(protocol),
    'INPUT', 'Select an explicit supported native framework topology');
  if (component === 'homebrew') return 'native-homebrew';
  const suffix = protocol === nativeLegacyFrameworkShardProtocol || shard === null || target === 'linux-x64' ?
    '' : `-${suffixes[target]?.toLowerCase()}`;
  requireThat(shard === null || validationPlatforms.includes(target), 'INPUT', 'Native shard job keys need their target');
  return `${shard !== null && nativeFrameworkUnitShardNames(target, protocol).includes(shard) ?
    'native-units' : 'native'}${suffix}`;
}

function shardFromContext(context, target) {
  return nativeFrameworkShardNames(target).find(shard =>
    context.profile === `pr-framework-${shard}-${target}`) ?? null;
}

function componentFromContext(context, target) {
  if (shardFromContext(context, target) !== null) return 'framework';
  return ['framework', 'homebrew'].find(component => context.profile === `pr-${component}-${target}`) ?? 'full';
}

const nativeProfile = (profile, target, component, shard = null) =>
  `${profile}${component === 'full' ? '' : `-${component}`}${shard === null ? '' : `-${shard}`}-${target}`;
const nativeCaseIds = (target, profile, component) => component === 'homebrew' ?
  [`T-PRD060-${suffixes[target]}`] : component === 'framework' ?
    [`T-PRD014-${suffixes[target]}`] : canonicalIds(target, profile);
export const nativeWorkflowContract = Object.freeze({
  path: '.github/workflows/ci.yml',
  sourceJob: 'Freeze source candidate',
  intentJob: 'Classify native validation intent',
  minimumNodeJob: 'Minimum supported Node compatibility',
  jobs: Object.freeze(Object.fromEntries(validationPlatforms.map(target => [target, `native-${target}`]))),
  steps: Object.freeze({ checkout: 'Check out exact candidate', execution: 'Execute native validation',
    context: 'Record trusted execution context', sourceBytes: 'Materialize committed source bytes',
    retention: 'Retain native validation evidence', minimumNodeSetup: 'Select minimum supported Node',
    minimumNodeExecution: 'Exercise minimum-runtime compatibility',
    minimumNodeRetention: 'Retain minimum-runtime originals' }),
  artifactPrefix: 'native-evidence-',
  minimumNodeArtifactPrefix: 'minimum-node-evidence-',
  bootstrapArtifactPrefix: 'native-bootstrap-',
  cleanupArtifactPrefix: 'native-cleanup-',
  stages: Object.freeze(['unit', 'required-units', 'regression']),
  reports: Object.freeze({ execution: 'execution.json', bundle: 'readiness-bundle.json', markdown: 'readiness.md',
    producer: 'producer.json', toolchain: 'toolchain.json', candidate: 'candidate-verification.json',
    homebrew: 'native-homebrew.json' }),
});
const goApplicable = (test, target) => target !== 'windows-x64' ||
  test.name !== 'TestNativePayloadRejectsTampering/extracted_mode_changed';
const canonicalIds = (target, profile) => [
  `T-PRD${profile === 'pr' ? '014' : '079'}-${suffixes[target]}`,
  ...(profile === 'pr' && target.startsWith('macos-') ? [`T-PRD060-${suffixes[target]}`] : []),
  ...(profile === 'pr' && target === 'linux-x64' ? ['T-PRD087'] : []),
];
const safe = value => sanitizeExecutionPayload(Buffer.from(JSON.stringify(value)));

function immutableNativeDefinition(value) {
  let nodes = 0;
  const ancestors = new Set();
  const copy = (item, depth) => {
    requireThat(++nodes <= 500000 && depth <= 32, 'EVIDENCE', 'Native definition exceeds its closed JSON budget');
    if (item === null || ['string', 'boolean'].includes(typeof item) ||
      typeof item === 'number' && Number.isFinite(item)) return item;
    requireThat(item && typeof item === 'object' && !types.isProxy(item) &&
      !ancestors.has(item) && Object.getOwnPropertySymbols(item).length === 0 &&
      Object.getPrototypeOf(item) === (Array.isArray(item) ? Array.prototype : Object.prototype),
    'EVIDENCE', 'Native definition pass requires closed plain JSON source data');
    const fields = Object.getOwnPropertyDescriptors(item);
    const keys = Object.keys(fields).filter(key => !Array.isArray(item) || key !== 'length');
    requireThat(keys.every(key => fields[key].enumerable && Object.hasOwn(fields[key], 'value')) &&
      (!Array.isArray(item) || keys.length === item.length &&
        keys.every((key, index) => key === String(index))),
    'EVIDENCE', 'Native definition pass cannot admit executable or sparse source data');
    ancestors.add(item);
    const result = Array.isArray(item) ? keys.map(key => copy(fields[key].value, depth + 1)) :
      Object.fromEntries(keys.map(key => [key, copy(fields[key].value, depth + 1)]));
    ancestors.delete(item);
    return Object.freeze(result);
  };
  return copy(value, 0);
}

export async function withNativeDefinitionPass({ inventory, plan, goSources,
  shardProtocol = nativeFrameworkShardProtocol, frameworkShards = true,
  schedulingPolicy = validationSchedulingPolicy }, read) {
  requireThat(typeof read === 'function' && typeof frameworkShards === 'boolean' &&
    nativeFrameworkShardProtocols.includes(shardProtocol), 'INPUT', 'Use one explicit closed native definition pass');
  const source = immutableNativeDefinition({ inventory, plan, goSources, shardProtocol, frameworkShards });
  validationSchedulingPolicyDigest(schedulingPolicy);
  const inputs = Object.freeze({ ...source, schedulingPolicy });
  const parts = [...nativeLegacyPrParts, ...(frameworkShards ? nativePrPartsForProtocol(shardProtocol) : [])];
  const pass = { inputs, active: true, assignments: new Map(), specifications: new Map(),
    parts: new Set(parts.map(part => JSON.stringify([part.target, part.component, part.shard ?? null]))) };
  try { return await nativeDefinitionPass.run(pass, () => read(inputs)); }
  finally {
    pass.active = false;
    pass.assignments.clear();
    pass.specifications.clear();
  }
}

export function nativeExpectedAssignment({ inventory, plan, target, protocol = nativeFrameworkShardProtocol,
  schedulingPolicy = validationSchedulingPolicy }) {
  const pass = nativeDefinitionPass.getStore();
  if (!pass?.active || inventory !== pass.inputs.inventory || plan !== pass.inputs.plan ||
    protocol !== pass.inputs.shardProtocol || schedulingPolicy !== pass.inputs.schedulingPolicy ||
    !validationPlatforms.includes(target)) {
    return nativeFrameworkShardPlan({ inventory, plan, target, protocol, schedulingPolicy });
  }
  if (!pass.assignments.has(target)) pass.assignments.set(target, immutableNativeDefinition(
    nativeFrameworkShardPlan({ inventory, plan, target, protocol, schedulingPolicy })));
  return pass.assignments.get(target);
}

export function nativeConfigurationDigest({ inventory, plan, profile, target = null, configuredWorkers = null,
  calculator = calculatorCapability(inventory), component = 'full', shard = null, shardPlanDigest = null,
  shardProtocol = nativeFrameworkShardProtocol, bootstrapProtocol = null, bootstrapTools = null, assignment,
  schedulingPolicy = validationSchedulingPolicy }) {
  requireThat(bootstrapProtocol === null || nativeBootstrapProtocols.includes(bootstrapProtocol),
    'INVENTORY', 'Native configuration requires a supported source-selected bootstrap protocol');
  requireThat(inventory.complete && /^[a-f0-9]{64}$/u.test(inventory.digest) &&
    ['pr', 'r-pre'].includes(profile) && ['full', 'framework', 'homebrew'].includes(component) &&
    (component === 'full' || profile === 'pr'), 'INVENTORY',
  'Native configuration needs the complete selected source inventory and an applicable component');
  requireThat(shard === null ? shardPlanDigest === null :
    profile === 'pr' && component === 'framework' && typeof shard === 'string' &&
      /^[a-f0-9]{64}$/u.test(shardPlanDigest ?? '') &&
      nativeFrameworkShardProtocols.includes(shardProtocol), 'INVENTORY',
  'Native shard configuration requires its independently derived complete assignment');
  const requested = configuredWorkers === null ? null : String(configuredWorkers);
  requireThat(requested === null || /^[1-9]\d*$/u.test(requested) && Number(requested) <= 32,
    'INVENTORY', 'Native configuration requires the exact selected worker request or explicit automatic allocation');
  requireThat(calculator?.namespace === 'calculator' && Number.isSafeInteger(calculator.tests) &&
    calculator.tests > 0 && Array.isArray(calculator.files) && calculator.files.length > 0 &&
    new Set(calculator.files).size === calculator.files.length &&
    calculator.files.every(file => /^test\/calculator\/(?:[^/]+\/)*[^/]+\.test\.(?:js|mjs|cjs)$/u.test(file)),
  'INVENTORY', 'Native calculator capability must preserve its complete independently selected files and assertion count');
  requireThat(bootstrapTools === null || [nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(bootstrapProtocol) &&
    digest(Object.keys(bootstrapTools).sort()) === digest([
      ...(bootstrapProtocol === nativeBootstrapProtocol ? ['crypto'] : []), 'go', 'homebrew', 'ownedPrefix', 'python', 'schema']) &&
    Object.values(bootstrapTools).every(value => typeof value === 'boolean') &&
    (!bootstrapTools.schema || bootstrapTools.python) && bootstrapTools.homebrew === bootstrapTools.ownedPrefix,
  'INVENTORY', 'Projected bootstrap requirements must preserve the closed source-derived versioned tool capabilities');
  const roleCapability = bootstrapProtocol !== null && (component === 'framework' && shard !== null ||
    [nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(bootstrapProtocol) &&
      component === 'homebrew' && profile === 'pr');
  const tools = roleCapability ?
    [nativeUnitBootstrapProtocol, nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(bootstrapProtocol) ?
      bootstrapTools ?? nativeBootstrapRequirements({ inventory, plan, target, profile, component, shard,
        protocol: bootstrapProtocol, assignment, shardProtocol }) :
      nativeSdkRequirements({ target: shard === 'units-1' ? 'macos-x64' : 'linux-x64',
        profile, component, shard, protocol: bootstrapProtocol }) : null;
  return digest({ nativeToolchain, inventory: inventory.digest, profile,
    ...(component === 'full' ? {} : { component }),
    ...(shard === null ? {} : { frameworkShards: shardProtocol, shard, shardPlanDigest }),
    schedulingPolicy: validationSchedulingPolicyDigest(schedulingPolicy), selectedWorkersRequest: requested,
    selectionTransport: validationSelectionProtocol,
    requiredCapabilities: { crypto: bootstrapProtocol === nativeBootstrapProtocol && tools?.crypto === false ?
      null : prCryptoFixture, calculator,
      ...(roleCapability ?
        { bootstrapProtocol, ...([nativeSdkBootstrapProtocol, nativeUnitBootstrapProtocol, nativeBodyBootstrapProtocol,
          nativeBootstrapProtocol].includes(bootstrapProtocol) ? { tools } : {}) } : {}) } });
}

export function nativeResourceFacts({ availableParallelism = os.availableParallelism(),
  totalMemoryBytes = os.totalmem(), configuredWorkers = process.env.SDLC_TEST_WORKERS ?? null } = {},
  schedulingPolicy = validationSchedulingPolicy) {
  const selected = resolveValidationWorkers({ availableParallelism, totalMemoryBytes, requested: configuredWorkers }, schedulingPolicy);
  return { availableParallelism, totalMemoryBytes, configuredWorkers: selected.requestedWorkers,
    workerCapacity: selected.capacity, schedulingPolicy: selected.policyDigest };
}

async function writeJson(file, value) {
  await writeCanonicalJson(file, canonical(safe(value)));
}

async function writeCanonicalJson(file, contents) {
  const handle = await fs.open(file, 'wx');
  try { await handle.writeFile(contents); await handle.sync(); }
  finally { await handle.close(); }
}

export function createNativeObservationCheckpoint(file, producer) {
  let claimed = false;
  let queue = Promise.resolve();
  return value => {
    const contents = canonical(safe({ ...value, producer }));
    queue = queue.then(async () => {
      if (!claimed) {
        await writeCanonicalJson(file, contents);
        claimed = true;
      } else await atomicWrite(file, Buffer.from(contents));
    });
    return queue;
  };
}

export function nativeSpecification(options) {
  const pass = nativeDefinitionPass.getStore();
  const { inventory, plan, goSources, target, profile, component = 'full', shard = null,
    shardProtocol = nativeFrameworkShardProtocol, schedulingPolicy = validationSchedulingPolicy } = options;
  if (!pass?.active || inventory !== pass.inputs.inventory || plan !== pass.inputs.plan ||
    goSources !== pass.inputs.goSources || profile !== 'pr' || shardProtocol !== pass.inputs.shardProtocol ||
    schedulingPolicy !== pass.inputs.schedulingPolicy || typeof target !== 'string' ||
    typeof component !== 'string' || shard !== null && typeof shard !== 'string') {
    return deriveNativeSpecification(options);
  }
  const key = JSON.stringify([target, component, shard]);
  if (!pass.parts.has(key)) return deriveNativeSpecification(options);
  if (!pass.specifications.has(key)) pass.specifications.set(key,
    immutableNativeDefinition(deriveNativeSpecification(options)));
  return pass.specifications.get(key);
}

function deriveNativeSpecification({ plan, inventory, goSources, target, profile, component = 'full', shard = null,
  shardProtocol = nativeFrameworkShardProtocol, schedulingPolicy = validationSchedulingPolicy }) {
  requireThat(validationPlatforms.includes(target) && ['pr', 'r-pre'].includes(profile) && inventory.complete,
    'INVENTORY', 'Native validation requires the complete declared inventory and an explicit profile/platform');
  requireThat(shard === null || nativeFrameworkShardProtocols.includes(shardProtocol) &&
    nativeFrameworkShardNames(target, shardProtocol).includes(shard), 'INPUT',
  'Native shard selection must belong to its explicit versioned topology');
  const role = nativeProducerRole(target, component, shard);
  requireThat(component === 'full' || profile === 'pr', 'INPUT', 'Partial native components are PR-only');
  if (shard !== null) return nativeFrameworkShardSpecification({ plan, inventory, goSources, target, shard, shardProtocol, schedulingPolicy });
    calculatorSelection(inventory);
  const definitions = parseTestPlan(plan);
  const node = inventory.cases.filter(test => test.applicability.platforms.includes(target))
    .map(test => ({ id: test.id, selector: { file: test.file, name: test.name, parents: test.parents } }));
  const orderedGoSources = [...goSources].sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
  const go = discoverGoDeclarations(orderedGoSources).filter(test => goApplicable(test, target))
    .map(test => ({ id: `assertion-${digest(['go', test.file, test.name])}`,
      selector: { tool: 'go', file: test.file, name: test.name } }));
  const procedures = [...(component === 'homebrew' ? [] : ['static', 'calculator']), 'frozen-artifacts',
    ...(target.startsWith('macos-') && component !== 'framework' ? ['native-homebrew'] : []),
    ...(profile === 'r-pre' && target === 'windows-x64' ? ['native-previous-current'] : [])]
    .map(name => ({ id: `assertion-${digest(['procedure', name])}`, selector: { procedure: name } }));
  return { schemaVersion: 1, profile: nativeProfile(profile, target, component),
    cases: nativeCaseIds(target, profile, component).map(id => {
    const definition = definitions.find(test => test.id === id);
    requireThat(definition && definition.checkpoint === 'post-review' && definition.location === locations[target],
      'INVENTORY', 'The selected native case must exist at its exact native Test Plan location');
    return { id, conditions: definition.conditions, expectedDigest: digest(definition.expected),
      executionId: `native-${role}`, mode: definition.mode, owner: definition.owner,
      location: definition.location, checkpoint: definition.checkpoint,
      assertions: component === 'homebrew' ? procedures :
        id === 'T-PRD087' ? procedures.filter(assertion => assertion.selector.procedure === 'calculator') :
        id.startsWith('T-PRD060-') ? [
        ...node.filter(assertion => assertion.selector.file === 'test/distribution-channels.test.mjs'),
        ...procedures.filter(assertion => assertion.selector.procedure === 'frozen-artifacts'),
      ] : [...node, ...go, ...procedures] };
  }) };
}

function nativePlacementGroups(groups, target, protocol) {
  const byId = new Map(groups.map(group => [group.id, group]));
  return groups.map(group => {
    const phased = [nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
      nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
      nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ?
      nativePlacementCostsV9.roots.find(hint => hint.rootId === group.rootId && hint.samples[target]) : null;
    const isolated = [nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
      nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
      nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
      nativeFrameworkShardProtocol].includes(protocol) ?
      nativePlacementCostsV8.roots.find(hint => hint.rootId === group.rootId && hint.samples[target]) : null;
    const updated = [nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
      nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
      nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
      nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ?
      nativePlacementCostsV7.roots.find(hint => hint.rootId === group.rootId && hint.samples[target]) : null;
    const costs = phased ? nativePlacementCostsV9 : isolated ? nativePlacementCostsV8 :
      updated ? nativePlacementCostsV7 : nativePlacementCosts;
    const hint = phased ?? isolated ?? updated ?? nativePlacementCosts.roots.find(hint => hint.rootId === group.rootId);
    const sample = hint?.samples[target];
    const shapeDigest = digest({ assertionIds: [...group.assertionIds].sort(), minimumSlots: group.minimumSlots,
      exclusiveResources: [...group.exclusiveResources].sort(),
      dependsOn: group.dependsOn.map(id => byId.get(id)?.rootId).sort() });
    const costStatus = !costs.workers[target] ? 'unknown-target' :
      !sample ? 'unknown-root' : costs.node !== nativeToolchain.node ? 'stale-runtime' :
        phased && costs.workers[target] !== nativePlacementPhasesV9.capacity ||
          isolated && costs.workers[target] !== nativePlacementIsolationV8.capacity ? 'stale-capacity' :
        hint.shapeDigest !== shapeDigest ? 'stale-closure-or-resources' :
          hint.sourceDigest === group.sourceDigest ? 'observed-source-lead' : 'historical-source-lead';
    const eligible = costStatus === 'observed-source-lead' || costStatus === 'historical-source-lead';
    return { planningId: `placement-${digest(['native-root-planning-v1', group.file, group.root])}`,
      rootId: group.rootId, shapeDigest, costStatus, durationMs: eligible ? sample[0] : null,
      ...([nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
        nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
        nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
        nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ?
        { costSource: phased ? 'v9-observed-lead' : isolated ? 'v8-observed-lead' :
          updated ? 'v7-observed-lead' : 'v6-historical-lead' } : {}),
      ...(sample ? { observedSourceDigest: hint.sourceDigest, jobId: sample[1] } : {}) };
  });
}

function nativeReservationRule(placement) {
  return placement.reservation.protocol === nativePlacementOwnershipV15.protocol ?
    nativePlacementOwnershipV15 : placement.reservation.protocol === nativePlacementServiceV14.protocol ?
    nativePlacementServiceV14 : nativePlacementReservationV13;
}

function qualifyNativeParallelPlacement(placement, groups, inventory, plan) {
  const rule = nativePlacementReadyPoolV11;
  const costs = nativePlacementCostsV11;
  const transfer = placement.transfers ? nativePlacementTransfersV12 : null;
  const reservation = placement.reservation ? nativeReservationRule(placement) : null;
  const ownership = reservation === nativePlacementOwnershipV15;
  const binding = reservation ?? transfer ?? costs;
  const definitions = new Map(inventory.cases.filter(test => !test.parents.length).map(test => [test.id, test]));
  const planning = new Map(placement.groups.map(group => [group.rootId, group]));
  const ordered = [...groups].sort((left, right) => left.rootId.localeCompare(right.rootId, 'en'));
  const additions = reservation?.additionalRoots ?? [];
  const original = ordered.filter(group => !additions.some(added => added.rootId === group.rootId));
  // New roots must not shift indices in the immutable historical duration vector.
  const costIndexes = new Map(original.map((group, index) => [group.rootId, index]));
  const bindingDigest = digest(ordered.map(group => [group.rootId, group.sourceDigest,
    definitions.get(group.rootId)?.definitionDigest, planning.get(group.rootId).shapeDigest]));
  const status = nativeToolchain.node !== rule.node || nativeToolchain.node !== costs.node ?
    'unsupported-runtime' : nativePlacementCosts.workers[rule.target] !== rule.capacity ||
      costs.capacity !== rule.capacity ? 'unsupported-capacity' :
      ownership && (binding.baseServiceDigest !== digest(nativePlacementServiceV14) ||
        binding.rootOrderDigest !== digest(ordered.map(group => group.rootId)) ||
        binding.owners.length !== ordered.length || !/^[012]+$/u.test(binding.owners) ||
        binding.serviceStatus !== 'unmeasured-current-service') ? 'changed-historical-ownership' :
      !ownership && (reservation ?? transfer) && (binding.baseCostsDigest !== digest(costs) ||
        binding.baseRootOrderDigest !== digest(original.map(group => group.rootId)) ||
        reservation && reservation.baseTransfersDigest !== digest(transfer) ||
        reservation === nativePlacementServiceV14 &&
          (reservation.baseReservationDigest !== digest(nativePlacementReservationV13) ||
            reservation.currentRootOrderDigest !== digest(ordered.map(group => group.rootId)) ||
            new Set(additions.map(added => added.rootId)).size !== additions.length ||
            additions.some(added => !ordered.some(group => group.rootId === added.rootId) ||
              !reservation.unknownRoots.includes(added.rootId)))) ?
        'changed-historical-costs-or-order' :
      inventory.digest !== binding.inventoryDigest || bindingDigest !== binding.rootBindingDigest ||
        !ownership && original.length !== costs.durations.length ? 'changed-source-callback-or-resources' : 'qualified';
  placement.parallel.status = status;
  if (status !== 'qualified') return;
  for (const group of ordered) {
    const selectedCases = group.assertionIds.map(id => inventory.cases.find(test => test.id === id));
    const tools = nativeBootstrapRequirements({ inventory, plan, target: rule.target, profile: 'pr',
      component: 'framework', shard: 'body-0', protocol: nativeBootstrapProtocol,
      assignment: { parts: [{ shard: 'body-0', stages: [{ cases: selectedCases }] }] } });
    const allowedShards = rule.shards.filter(shard => Object.entries(tools)
      .every(([tool, required]) => !required || shard.tools[tool])).map(shard => shard.shard);
    const duration = ownership || binding.unknownRoots?.includes(group.rootId) ?
      null : costs.durations[costIndexes.get(group.rootId)];
    const reservedCatalog = group.rootId === reservation?.catalog.rootId;
    const entry = planning.get(group.rootId);
    delete entry.jobId;
    delete entry.observedSourceDigest;
    Object.assign(entry, { durationMs: duration, allowedShards,
      costStatus: duration === null ? reservedCatalog ? 'unmeasured-resources' : 'unmeasured-callback' :
        'qualified-historical-callback-lead',
      costSource: ownership ? 'v15-current-service-unmeasured' : reservedCatalog ? reservation === nativePlacementServiceV14 ?
        'v14-fixture-service-without-duration' : 'v13-reservation-without-duration' : 'v11-original-diagnostic-upper-bound',
      ...(duration === null ? {} : { observedSourceRevision: costs.sourceRevision,
        observedInventoryDigest: costs.observedInventoryDigest, observedRunId: costs.runId }) });
  }
  const anchors = rule.anchors.map(rootId => groups.find(group => group.rootId === rootId));
  const catalog = reservation && groups.find(group => group.rootId === reservation.catalog.rootId);
  const qualifiedReservation = reservation && catalog &&
    catalog.minimumSlots === reservation.catalog.minimumSlots &&
    catalog.sourceDigest === reservation.catalog.sourceDigest &&
    definitions.get(catalog.rootId)?.definitionDigest === reservation.catalog.definitionDigest &&
    planning.get(catalog.rootId).shapeDigest === reservation.catalog.shapeDigest;
  placement.parallel.status =
      anchors.some(group => !group) ? 'missing-root' :
        reservation && !qualifiedReservation ||
          anchors.some(group => planning.get(group.rootId).durationMs === null &&
            !(ownership || qualifiedReservation && group === catalog)) ? 'changed-anchor-qualification' :
          anchors.some(group => group.dependsOn.length || group.exclusiveResources.length) ?
            'changed-anchor-resources' :
            placement.groups.some(group => !group.allowedShards.length) ? 'changed-sdk-capabilities' : 'qualified';
}

function partitionNativeBodyGroups(groups, count, placement = null) {
  const parents = new Map(groups.map(group => [group.id, group.id]));
  const find = id => {
    requireThat(parents.has(id), 'INVENTORY', 'Native body dependency must remain inside the complete body selection');
    if (parents.get(id) !== id) parents.set(id, find(parents.get(id)));
    return parents.get(id);
  };
  const join = (left, right) => parents.set(find(right), find(left));
  const resources = new Map();
  for (const group of groups) {
    group.dependsOn.forEach(dependency => join(group.id, dependency));
    for (const resource of group.exclusiveResources) {
      if (resources.has(resource)) join(group.id, resources.get(resource));
      else resources.set(resource, group.id);
    }
  }
  const components = new Map();
  for (const group of groups) {
    const key = find(group.id);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(group);
  }
  const planning = new Map(placement?.groups.map(group => [group.rootId, group]) ?? []);
  const ranked = [...components.values()].map(component => ({
    groups: component, assertionIds: component.flatMap(group => group.assertionIds),
    key: placement ? digest(['native-component-planning-v1',
      ...component.map(group => planning.get(group.rootId).planningId).sort()]) :
      component.map(group => group.id).sort()[0],
    ...(placement ? {
      observedLeadMs: component.reduce((sum, group) => sum + (planning.get(group.rootId).durationMs ?? 0), 0),
      unknownAssertions: component.reduce((sum, group) =>
        sum + (planning.get(group.rootId).durationMs === null ? group.assertionIds.length : 0), 0),
      ...(placement.parallel?.status === 'qualified' ? {
        weightedSlotMs: component.reduce((sum, group) =>
          sum + (planning.get(group.rootId).durationMs ?? 0) * group.minimumSlots, 0),
        maximumDurationMs: Math.max(...component.map(group => planning.get(group.rootId).durationMs ?? 0)),
        primaryAnchor: component.some(group => nativePlacementReadyPoolV11.anchors.includes(group.rootId)),
        allowedShards: nativePlacementReadyPoolV11.shards.map(shard => shard.shard)
          .filter(shard => component.every(group => planning.get(group.rootId).allowedShards.includes(shard))),
      } : {}),
    } : {}),
  })).sort((left, right) => (placement ? right.observedLeadMs - left.observedLeadMs : 0) ||
    right.assertionIds.length - left.assertionIds.length ||
    right.groups.length - left.groups.length || left.key.localeCompare(right.key, 'en'));
  const partitions = Array.from({ length: count }, (_, index) => ({ index, assertionIds: [], groups: 0,
    ...(placement ? { observedLeadMs: 0, unknownAssertions: 0 } : {}),
    ...(placement?.parallel ? { weightedSlotMs: 0 } : {}) }));
  if (placement?.parallel?.status === 'qualified') {
    placement.parallel.status = count !== nativePlacementReadyPoolV11.shards.length || ranked.length < count ?
      'would-empty-body' : ranked.some(component => component.primaryAnchor && component.groups.length !== 1) ?
        'changed-anchor-component' : ranked.some(component => !component.allowedShards.length) ?
          'changed-sdk-component' : 'applied';
    if (placement.parallel.status === 'applied') ranked.sort((left, right) =>
      Number(right.primaryAnchor) - Number(left.primaryAnchor) || right.weightedSlotMs - left.weightedSlotMs ||
      right.maximumDurationMs - left.maximumDurationMs || left.key.localeCompare(right.key, 'en'));
  }
  let reservedOwners = null;
  if (placement?.reservation) {
    const rule = nativeReservationRule(placement);
    const ordered = [...groups].sort((left, right) => left.rootId.localeCompare(right.rootId, 'en'));
    const additions = rule.additionalRoots ?? [];
    const original = ordered.filter(group => !additions.some(added => added.rootId === group.rootId));
    const baseOwners = rule === nativePlacementOwnershipV15 ?
      rule.owners : nativePlacementReservationV13.baseOwners;
    const owners = new Map(original.map((group, index) => [group.rootId, Number(baseOwners[index])]));
    for (const added of additions) owners.set(added.rootId, Number(added.shard.slice(5)));
    const status = placement.parallel.status !== 'applied' ? 'base-placement-unqualified' :
      baseOwners.length !== original.length || !/^[012]+$/u.test(baseOwners) ||
        additions.some(added => !/^body-[012]$/u.test(added.shard)) ||
        count !== nativePlacementReadyPoolV11.shards.length ? 'changed-ownership-order' :
        ranked.some(component => new Set(component.groups.map(group => owners.get(group.rootId))).size !== 1) ?
          'changed-connected-ownership' :
          ranked.some(component => !component.allowedShards.includes(`body-${owners.get(component.groups[0].rootId)}`) ||
            component.primaryAnchor && owners.get(component.groups[0].rootId) !== 0 ||
            component.groups.some(group => group.minimumSlots > rule.capacity)) ? 'changed-ownership-capabilities' :
            new Set(owners.values()).size !== count ? 'would-empty-body' : 'applied';
    placement.reservation.status = status;
    if (status === 'applied') reservedOwners = owners;
    else placement.parallel.status = status;
  }
  let isolatedComponent = null;
  let phasedComponents = [];
  if (placement?.phases) {
    const rule = placement.phases.protocol === nativePlacementPhasesV9.protocol ?
      nativePlacementPhasesV9 : nativePlacementPhasesV10;
    const selected = rule.phases.map(phase => {
      const root = groups.find(group => group.rootId === phase.rootId);
      return { phase, root, component: ranked.find(component => component.groups.includes(root)) };
    });
    const status = nativeToolchain.node !== rule.node ? 'unsupported-runtime' :
      nativePlacementCosts.workers[rule.target] !== rule.capacity ? 'unsupported-capacity' :
        selected.some(({ root }) => !root) ? 'missing-root' :
          selected.some(({ phase, root }) => planning.get(root.rootId).shapeDigest !== phase.shapeDigest ||
            root.minimumSlots !== phase.minimumSlots) ? 'changed-closure-or-resources' :
            selected.some(({ component }) => component.groups.length !== 1) ? 'changed-component' :
              selected.some(({ phase, root }) => root.sourceDigest !== phase.sourceDigest) ? 'changed-source' :
                count !== 3 || ranked.length < count + selected.length - 1 ? 'would-empty-body' : 'applied';
    Object.assign(placement.phases, { status });
    if (status === 'applied') phasedComponents = selected.map(({ component }) => component);
  }
  if (placement?.isolation) {
    const rule = nativePlacementIsolationV8;
    const root = groups.find(group => group.rootId === rule.rootId);
    const component = ranked.find(component => component.groups.some(group => group === root));
    const status = nativeToolchain.node !== rule.node ? 'unsupported-runtime' :
      nativePlacementCosts.workers[rule.target] !== rule.capacity ? 'unsupported-capacity' :
        !root ? 'missing-root' :
          planning.get(root.rootId).shapeDigest !== rule.shapeDigest ||
            root.minimumSlots !== rule.minimumSlots ? 'changed-closure-or-resources' :
            component.groups.length !== 1 ? 'changed-component' :
              root.sourceDigest !== rule.sourceDigest ? 'changed-source' :
                count !== 3 || ranked.length < count ? 'would-empty-body' : 'applied';
    Object.assign(placement.isolation, { status });
    if (status === 'applied') isolatedComponent = component;
  }
  for (const component of ranked) {
    const parallel = placement?.parallel?.status === 'applied';
    // Frozen ownership avoids treating the newly unmeasured catalog as free backfill capacity.
    const available = reservedOwners ? [partitions[reservedOwners.get(component.groups[0].rootId)]] :
      parallel ? component.primaryAnchor ? [partitions[0]] :
      partitions.filter(partition => component.allowedShards.includes(`body-${partition.index}`)) :
      phasedComponents.length ? phasedComponents.includes(component) ?
      [partitions[0]] : partitions.slice(1) :
      isolatedComponent ? component === isolatedComponent ? [partitions[0]] : partitions.slice(1) : partitions;
    const parallelLoad = partition => nativePlacementReadyPoolV11.shards[partition.index].historicalFixedMs +
      partition.weightedSlotMs / nativePlacementReadyPoolV11.capacity;
    const selected = [...available].sort((left, right) => (parallel ?
      (component.observedLeadMs > 0 ? parallelLoad(left) - parallelLoad(right) :
        left.unknownAssertions - right.unknownAssertions || parallelLoad(left) - parallelLoad(right)) : placement ?
      component.observedLeadMs > 0 ? left.observedLeadMs - right.observedLeadMs :
        left.unknownAssertions - right.unknownAssertions || left.observedLeadMs - right.observedLeadMs : 0) ||
      left.assertionIds.length - right.assertionIds.length || left.groups - right.groups || left.index - right.index)[0];
    selected.assertionIds.push(...component.assertionIds);
    selected.groups += component.groups.length;
    if (placement) {
      selected.observedLeadMs += component.observedLeadMs;
      selected.unknownAssertions += component.unknownAssertions;
      if (parallel) selected.weightedSlotMs += component.weightedSlotMs;
      placement.components.push({ planningId: component.key, shard: `body-${selected.index}`,
        roots: component.groups.map(group => planning.get(group.rootId).planningId).sort(),
        observedLeadMs: component.observedLeadMs, unknownAssertions: component.unknownAssertions });
    }
  }
  if (placement) placement.partitions = partitions.map(({ assertionIds, ...partition }) => partition);
  return partitions;
}

function applyNativePlacementAffinities(groups, partitions, placement, target) {
  const planning = new Map(placement.groups.map(group => [group.rootId, group]));
  placement.affinities = { declarationDigest: digest(nativePlacementAffinities),
    evidenceCredit: false, predictedSavingMs: null, rules: [] };
  for (const affinity of nativePlacementAffinities.affinities) {
    const roots = [affinity.anchor, affinity.companion];
    const selected = roots.map(root => groups.find(group => group.rootId === root.rootId));
    const components = roots.map(root => placement.components.find(component =>
      component.roots.includes(planning.get(root.rootId)?.planningId)));
    const status = target !== affinity.target ? 'unsupported-target' :
      nativeToolchain.node !== nativePlacementAffinities.node ? 'unsupported-runtime' :
        nativePlacementCosts.workers[target] !== affinity.capacity ? 'unsupported-capacity' :
          selected.some(group => !group) ? 'missing-root' :
            roots.some((root, index) => root.shapeDigest !== planning.get(root.rootId).shapeDigest ||
              root.minimumSlots !== selected[index].minimumSlots) ? 'changed-closure-or-resources' :
              components.some(component => !component || component.roots.length !== 1) ? 'changed-component' :
                selected.reduce((sum, group) => sum + group.minimumSlots, 0) > affinity.capacity ?
                  'insufficient-capacity' : 'qualified';
    const record = { id: affinity.id, status, target: affinity.target, capacity: affinity.capacity,
      roots: roots.map(root => root.rootId) };
    placement.affinities.rules.push(record);
    if (status !== 'qualified') continue;
    const [anchor, companion] = components;
    record.fromShard = companion.shard;
    record.toShard = anchor.shard;
    record.minimumSlots = selected.reduce((sum, group) => sum + group.minimumSlots, 0);
    record.sourceStatus = roots.every((root, index) => root.sourceDigest === selected[index].sourceDigest) ?
      'observed-source-affinity' : 'historical-source-affinity';
    if (anchor.shard === companion.shard) {
      record.status = 'already-coassigned';
      continue;
    }
    // Affinity changes ownership only; these remain independent ready-pool groups.
    const from = partitions[Number(companion.shard.slice(5))];
    const to = partitions[Number(anchor.shard.slice(5))];
    if (from.groups === 1) {
      record.status = 'would-empty-body';
      continue;
    }
    const moved = new Set(selected[1].assertionIds);
    from.assertionIds = from.assertionIds.filter(id => !moved.has(id));
    to.assertionIds.push(...selected[1].assertionIds);
    from.groups--;
    to.groups++;
    from.observedLeadMs -= companion.observedLeadMs;
    to.observedLeadMs += companion.observedLeadMs;
    from.unknownAssertions -= companion.unknownAssertions;
    to.unknownAssertions += companion.unknownAssertions;
    companion.shard = anchor.shard;
    record.status = 'applied';
  }
  placement.partitions = partitions.map(({ assertionIds, ...partition }) => partition);
}

function nativeAffinityCapacityMatches(assignment, resources, shard = null) {
  return !assignment?.placement?.affinities?.rules.some(rule =>
    ['applied', 'already-coassigned'].includes(rule.status) && resources?.workerCapacity !== rule.capacity) &&
    !(assignment?.placement?.isolation?.status === 'applied' &&
      (shard === null || shard === assignment.placement.isolation.shard) &&
      resources?.workerCapacity !== assignment.placement.isolation.capacity) &&
    !(assignment?.placement?.phases?.status === 'applied' &&
      (shard === null || shard === assignment.placement.phases.shard) &&
      resources?.workerCapacity !== assignment.placement.phases.capacity) &&
    !(assignment?.placement?.parallel?.status === 'applied' &&
      (shard === null || shard.startsWith('body-')) &&
      resources?.workerCapacity !== assignment.placement.parallel.capacity);
}

function applyNativeServiceTransfers(groups, partitions, placement) {
  const rule = nativePlacementTransfersV12;
  const record = placement.transfers;
  const planning = new Map(placement.groups.map(group => [group.rootId, group]));
  const selected = rule.roots.map(rootId => {
    const group = groups.find(group => group.rootId === rootId);
    const entry = planning.get(rootId);
    const component = placement.components.find(component => component.roots.includes(entry?.planningId));
    return { group, entry, component };
  });
  const from = partitions[Number(rule.from.slice(5))];
  const to = partitions[Number(rule.to.slice(5))];
  const status = placement.parallel.status !== 'applied' ? 'base-placement-unqualified' :
    nativeToolchain.node !== rule.node ? 'unsupported-runtime' :
      nativePlacementCosts.workers[rule.target] !== rule.capacity ? 'unsupported-capacity' :
        rule.from !== 'body-1' || rule.to !== 'body-2' || !from || !to ||
          new Set(rule.roots).size !== rule.roots.length ? 'invalid-transfer-declaration' :
          selected.some(({ group, entry, component }) => !group || !entry || !component) ? 'missing-component' :
            selected.some(({ entry }) => entry.durationMs === null) ? 'unmeasured-component' :
              selected.some(({ component }) => component.roots.length !== 1) ? 'changed-component-closure' :
                selected.some(({ component }) => component.shard !== rule.from) ? 'changed-source-partition' :
                  selected.some(({ entry }) => !entry.allowedShards.includes(rule.to)) ?
                    'changed-sdk-capabilities' :
                    from.groups <= selected.length ? 'would-empty-body' : 'qualified';
  record.status = status;
  if (status !== 'qualified') return;
  for (const { group, entry, component } of selected) {
    const ids = new Set(group.assertionIds);
    from.assertionIds = from.assertionIds.filter(id => !ids.has(id));
    to.assertionIds.push(...group.assertionIds);
    from.groups--;
    to.groups++;
    from.observedLeadMs -= component.observedLeadMs;
    to.observedLeadMs += component.observedLeadMs;
    from.weightedSlotMs -= entry.durationMs * group.minimumSlots;
    to.weightedSlotMs += entry.durationMs * group.minimumSlots;
    component.shard = rule.to;
  }
  Object.assign(record, { status: 'applied', from: rule.from, to: rule.to, roots: [...rule.roots] });
  placement.partitions = partitions.map(({ assertionIds, ...partition }) => partition);
}

export function nativeFrameworkShardPlan({ inventory, plan, target, protocol = nativeFrameworkShardProtocol,
  schedulingPolicy = validationSchedulingPolicy }) {
  requireThat(inventory.complete && validationPlatforms.includes(target),
    'INVENTORY', 'Framework shards need the complete independently declared native inventory');
  requireThat(nativeFrameworkShardProtocols.includes(protocol),
    'INVENTORY', 'Unknown native framework prerequisite topology');
  const stages = nativeStageSelections(inventory, plan, schedulingPolicy);
  const completeGroups = validationExecutionGroups(inventory, { preserveOrder: true });
  const groupsByFile = new Map(inventory.files.map(source =>
    [source.file, completeGroups.filter(group => group.file === source.file)]));
  // Native stages select complete roots; project those validated closures within this invocation only.
  const selectedGroups = (files, pattern) => {
    const selected = pattern === undefined ? null : new RegExp(pattern);
    const assertions = new Set(inventory.cases.filter(test => files.includes(test.file) &&
      (!selected || matchesNodeSelection(test, selected))).map(test => test.id));
    const groups = files.flatMap(file => groupsByFile.get(file) ?? [])
      .filter(group => assertions.has(group.rootId));
    requireThat(groups.every(group => group.assertionIds.every(id => assertions.has(id))) &&
      groups.reduce((count, group) => count + group.assertionIds.length, 0) === assertions.size,
    'INVENTORY', 'Native shard selectors must preserve exact complete causal root closures');
    const ids = new Set(groups.map(group => group.id));
    requireThat(groups.every(group => group.dependsOn.every(id => ids.has(id))), 'INVENTORY',
      'Selected execution group is missing a prerequisite root; select its dependency explicitly');
    return groups;
  };
  const unitShards = nativeFrameworkUnitShardNames(target, protocol);
  const extendedUnits = stages.find(stage => stage.name === 'required-units');
  const unitPartitions = partitionValidationInventory({ ...inventory, cases: extendedUnits.cases,
    files: inventory.files.filter(file => extendedUnits.files.includes(file.file)) }, unitShards.length);
  const regression = stages.find(stage => stage.name === 'regression');
  const refreshFile = 'test/observation-retention-refresh.test.mjs';
  const refreshGroups = selectedGroups([refreshFile], regression.selectorName);
  requireThat(refreshGroups.length === 1 &&
    refreshGroups[0].root === 'FR-063/064 real refresh and prune archive superseded observations/facts before exhaustion',
  'INVENTORY', 'The unchanged causal refresh root must exist as one complete regression closure');
  const refreshIds = new Set(refreshGroups[0].assertionIds);
  requireThat(regression.cases.filter(test => test.file === refreshFile).length === refreshIds.size &&
    regression.cases.filter(test => refreshIds.has(test.id)).length === refreshIds.size,
  'INVENTORY', 'The complete causal refresh root cannot be partially assigned or moved between stages');
  const bodyCases = regression.cases.filter(test => !refreshIds.has(test.id));
  const bodyFiles = new Set(bodyCases.map(test => test.file));
  const roots = [nativeSplitUnitFrameworkShardProtocol, nativeRootComponentFrameworkShardProtocol,
    nativeStableCostFrameworkShardProtocol, nativeResourceAffinityFrameworkShardProtocol,
    nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
    nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
    nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
    nativeFrameworkShardProtocol].includes(protocol) ?
    completeGroups : selectedGroups(regression.files, regression.selectorName);
  const bodyCount = nativeFrameworkShardNames(target, protocol).filter(shard => shard.startsWith('body-')).length;
  const bodyIds = new Set(bodyCases.map(test => test.id));
  const bodyGroups = roots.filter(group => bodyIds.has(group.rootId));
  const { roots: costRoots, ...costConditions } = nativePlacementCosts;
  const { roots: updateRoots, ...updateConditions } = nativePlacementCostsV7;
  const { roots: isolationRoots, ...isolationConditions } = nativePlacementCostsV8;
  const { roots: phasedRoots, ...phasedConditions } = nativePlacementCostsV9;
  const phaseRule = protocol === nativePhasedIsolationFrameworkShardProtocol ?
    nativePlacementPhasesV9 : nativePlacementPhasesV10;
  const reservationRule = protocol === nativeFrameworkShardProtocol ? nativePlacementOwnershipV15 :
    protocol === nativeCatalogServiceFrameworkShardProtocol ? nativePlacementServiceV14 : nativePlacementReservationV13;
  const placement = [nativeStableCostFrameworkShardProtocol, nativeResourceAffinityFrameworkShardProtocol,
    nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
    nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
    nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
    nativeFrameworkShardProtocol].includes(protocol) ? {
    protocol: 'native-stable-component-cost-leads-v1', evidenceCredit: false,
    costs: { ...costConditions, digest: digest(nativePlacementCosts),
      ...([nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
        nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
        nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
        nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ?
        { updates: { ...updateConditions, digest: digest(nativePlacementCostsV7) } } : {}),
      ...([nativeCatalogIsolationFrameworkShardProtocol, nativePhasedIsolationFrameworkShardProtocol,
        nativeComponentRebalanceFrameworkShardProtocol, nativeParallelReadyPoolFrameworkShardProtocol,
        nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol,
        nativeFrameworkShardProtocol].includes(protocol) ?
        { intelUpdates: { ...isolationConditions, digest: digest(nativePlacementCostsV8) } } : {}),
      ...([nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
        nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
        nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ?
        { phasedUpdates: { ...phasedConditions, digest: digest(nativePlacementCostsV9) } } : {}) },
    groups: nativePlacementGroups(bodyGroups, target, protocol), components: [],
    ...(protocol === nativeCatalogIsolationFrameworkShardProtocol && target === nativePlacementIsolationV8.target ? {
      isolation: { declarationDigest: digest(nativePlacementIsolationV8), evidenceCredit: false, predictedSavingMs: null,
        target, capacity: nativePlacementIsolationV8.capacity, shard: nativePlacementIsolationV8.shard,
        rootId: nativePlacementIsolationV8.rootId },
    } : {}),
    ...([nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol].includes(protocol) &&
      target === phaseRule.target ? {
      phases: { declarationDigest: digest(phaseRule), evidenceCredit: false, predictedSavingMs: null,
        protocol: phaseRule.protocol, target, capacity: phaseRule.capacity,
        shard: phaseRule.shard, roots: phaseRule.phases.map(phase => phase.rootId) },
    } : {}),
    ...([nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
      nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) &&
      target === nativePlacementReadyPoolV11.target ? {
      parallel: { protocol: nativePlacementReadyPoolV11.protocol, capacity: nativePlacementReadyPoolV11.capacity,
        declarationDigest: digest(nativePlacementReadyPoolV11), costsDigest: digest(nativePlacementCostsV11),
        evidenceCredit: false, predictedSavingMs: null },
    } : {}),
    ...([nativeServiceBalanceFrameworkShardProtocol, nativeCatalogReservationFrameworkShardProtocol,
      nativeCatalogServiceFrameworkShardProtocol].includes(protocol) &&
      target === nativePlacementTransfersV12.target ? {
      transfers: { protocol: nativePlacementTransfersV12.protocol,
        declarationDigest: digest(nativePlacementTransfersV12), evidenceCredit: false, predictedSavingMs: null },
    } : {}),
    ...([nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) &&
      target === reservationRule.target ? {
      reservation: { protocol: reservationRule.protocol,
        declarationDigest: digest(reservationRule),
        ownershipSourceRevision: reservationRule.ownershipSourceRevision,
        ownershipSourceProtocol: reservationRule.ownershipSourceProtocol,
        evidenceCredit: false, predictedSavingMs: null },
    } : {}),
  } : null;
  if (placement?.parallel) qualifyNativeParallelPlacement(placement, bodyGroups, inventory, plan);
  const partitions = [nativeRootComponentFrameworkShardProtocol, nativeStableCostFrameworkShardProtocol,
    nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
    nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
    nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
    nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) ?
    partitionNativeBodyGroups(bodyGroups, bodyCount, placement) :
    partitionValidationInventory({ ...inventory, cases: bodyCases,
      files: inventory.files.filter(file => bodyFiles.has(file.file)) }, bodyCount);
  if ([nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
    nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
    nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
    nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol))
    applyNativePlacementAffinities(bodyGroups, partitions, placement, target);
  if (placement?.transfers) applyNativeServiceTransfers(bodyGroups, partitions, placement);
  const procedureFile = 'test/public-readiness-ci.test.mjs';
  const toolRoot = inventory.cases.find(test => test.file === procedureFile && !test.parents.length &&
    test.name === 'T-PRD015 actual pinned Go, Python schema and static validators execute valid and invalid owned inputs');
  const toolPartition = partitions.find(partition => partition.assertionIds.includes(toolRoot?.id));
  requireThat(toolRoot && toolPartition, 'INVENTORY',
    'The actual Go/Python/schema/launcher causal root must be assigned intact to one body');
  const toolShard = `body-${toolPartition.index}`;
  const parts = nativeFrameworkShardNames(target, protocol).map(shard => {
    const unitIndex = unitShards.indexOf(shard);
    let selected = unitIndex >= 0 ? [
      ...(unitIndex === 0 ? stages.filter(stage => stage.name === 'unit') : []),
      { ...extendedUnits, cases: extendedUnits.cases.filter(test =>
        unitPartitions[unitIndex].assertionIds.includes(test.id)) },
    ] :
      [{ ...regression, cases: shard === 'refresh' ?
        regression.cases.filter(test => refreshIds.has(test.id)) :
        bodyCases.filter(test => partitions[Number(shard.slice(5))].assertionIds.includes(test.id)) }];
    if (placement?.phases?.status === 'applied' && shard === placement.phases.shard) {
      selected = phaseRule.phases.map((phase, index) => {
        const group = bodyGroups.find(group => group.rootId === phase.rootId);
        const ids = new Set(group.assertionIds);
        return { ...regression, name: phase.name, kind: 'regression',
          cases: regression.cases.filter(test => ids.has(test.id)),
          phase: { protocol: phaseRule.protocol, index, rootId: phase.rootId,
            previous: index === 0 ? null : phaseRule.phases[index - 1].name } };
      });
    }
    const selectedStages = selected.map(stage => {
      const files = stage.files.filter(file => stage.cases.some(test => test.file === file));
      const selectorName = [nativeRootComponentFrameworkShardProtocol, nativeStableCostFrameworkShardProtocol,
        nativeResourceAffinityFrameworkShardProtocol, nativeCatalogIsolationFrameworkShardProtocol,
        nativePhasedIsolationFrameworkShardProtocol, nativeComponentRebalanceFrameworkShardProtocol,
        nativeParallelReadyPoolFrameworkShardProtocol, nativeServiceBalanceFrameworkShardProtocol,
        nativeCatalogReservationFrameworkShardProtocol, nativeCatalogServiceFrameworkShardProtocol, nativeFrameworkShardProtocol].includes(protocol) &&
        shard.startsWith('body-') ?
        exactPattern(stage.cases.map(test => [...test.parents, test.name].join(' '))) : stage.selectorName;
      requireThat(files.length > 0 && stage.cases.some(test => test.applicability.platforms.includes(target)),
        'INVENTORY', 'Every required native shard stage needs a nonempty applicable assertion denominator');
      const groups = selectedGroups(files, stage.name === 'unit' ? undefined : selectorName);
      requireThat(digest(groups.flatMap(group => group.assertionIds).sort()) ===
        digest(stage.cases.map(test => test.id).sort()), 'INVENTORY',
      'Native shard selectors must preserve exact complete causal root closures');
      const definition = { ...stage, files, groups, selectorName };
      if (stage.name === 'unit') return definition;
      const { payload, ...selection } = validationSelectionDescriptor({ files, name: selectorName });
      return { ...definition, args: ['targeted', '--selection-file', selection.path], selection };
    });
    const assertionIds = selectedStages.flatMap(stage => stage.cases.map(test => test.id));
    const procedures = shard === 'units' ? ['static', 'frozen-artifacts'] :
      shard === toolShard ? ['calculator'] : [];
    return { shard, role: nativeProducerRole(target, 'framework', shard),
      prerequisites: unitIndex >= 0 ? [] :
        (protocol === nativeLegacyFrameworkShardProtocol ? validationPlatforms : [target])
          .flatMap(platform => nativeFrameworkUnitShardNames(platform, protocol)
            .map(unit => nativeProducerRole(platform, 'framework', unit))),
      stages: selectedStages, assertionIds, procedures, go: shard === toolShard };
  });
  const assigned = parts.flatMap(part => part.assertionIds);
  requireThat(assigned.length === inventory.cases.length && new Set(assigned).size === assigned.length &&
    inventory.cases.every(test => assigned.includes(test.id)), 'INVENTORY',
  'Native framework shards must partition every original root and descendant exactly once');
  const owner = new Map(parts.flatMap(part => part.assertionIds.map(id => [id, part.shard])));
  for (const group of roots) {
    const shard = owner.get(group.rootId);
    requireThat(group.assertionIds.every(id => owner.get(id) === shard) &&
      group.dependsOn.every(id => {
        const dependency = roots.find(other => other.id === id);
        return dependency && owner.get(dependency.rootId) === shard;
      }) && roots.every(other => other.id === group.id ||
        !other.exclusiveResources.some(resource => group.exclusiveResources.includes(resource)) ||
        owner.get(other.rootId) === shard), 'INVENTORY',
    'Cross-host native shards cannot separate causal dependencies or shared exclusive resources');
  }
  const identity = { protocol, target, inventoryDigest: inventory.digest,
    testSpecDigest: testSpecificationDigest(plan), toolShard, goRootId: toolRoot.id,
    ...(placement ? { placement } : {}),
    parts: parts.map(({ stages: selectedStages, ...part }) => ({ ...part,
      stages: selectedStages.map(stage => ({ name: stage.name, files: stage.files,
        selectorName: stage.selectorName, groups: stage.groups, ...(stage.selection ? { selection: stage.selection } : {}),
        ...(stage.phase ? { kind: stage.kind, phase: stage.phase } : {}) })),
    })) };
  return { ...identity, digest: digest(identity), parts };
}

function nativeFrameworkShardSpecification({ plan, inventory, goSources, target, shard, shardProtocol, schedulingPolicy }) {
  const assignment = nativeExpectedAssignment({ inventory, plan, target, protocol: shardProtocol, schedulingPolicy });
  const part = assignment.parts.find(part => part.shard === shard);
  requireThat(part, 'INVENTORY', 'Unknown independently expected native framework shard');
  const whole = nativeSpecification({ plan, inventory, goSources, target, profile: 'pr',
    component: target.startsWith('macos-') ? 'framework' : 'full', schedulingPolicy });
  const ids = new Set(part.assertionIds);
  const specification = { schemaVersion: 1, profile: nativeProfile('pr', target, 'framework', shard),
    cases: whole.cases.map(test => ({ ...test, executionId: `native-${part.role}`,
      assertions: test.assertions.filter(assertion => assertion.selector.tool === 'go' ? part.go :
        assertion.selector.procedure ? part.procedures.includes(assertion.selector.procedure) : ids.has(assertion.id)),
    })).filter(test => test.assertions.length) };
  validationInventoryDigest(specification);
  return specification;
}

export function nativeArtifacts(candidate) {
  const files = candidate.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }));
  const mac = archiveRecord(candidate, 'macos-arm64');
  requireThat(mac.filename === archiveRecord(candidate, 'macos-x64').filename &&
    /-macos\.tar\.gz$/u.test(mac.filename), 'EVIDENCE', 'Both Macs must consume one frozen shared archive');
  requireThat(files.some(file => file.name === candidate.descriptor.payload.filename) &&
    new Set(files.map(file => file.name)).size === files.length,
  'EVIDENCE', 'Frozen artifact inventory must include the payload exactly once');
  return [{ name: 'frozen-descriptor', sha256: candidate.context.identity.descriptorSha256 },
    { name: 'frozen-checksums', sha256: candidate.context.identity.checksumsSha256 }, ...files]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

export async function prepareNativeHostFixtures({ candidate, candidateDir, scratch, windowsLauncher,
  environment, build = buildPlatforms }) {
  requireThat(typeof build === 'function' && typeof candidate?.descriptor?.payload?.filename === 'string' &&
    Array.isArray(candidate.descriptor.files) &&
    candidate.descriptor.files.every(file => file && typeof file.filename === 'string') &&
    typeof candidateDir === 'string' && typeof scratch === 'string' && typeof windowsLauncher === 'string',
  'INPUT', 'Private host fixtures require the exact frozen payload/launcher and owned scratch');
  const selected = await build({
    artifact: path.join(candidateDir, 'assets', candidate.descriptor.payload.filename),
    outputDir: path.join(scratch, 'private-host-fixtures'), sourceCommit: candidate.descriptor.sourceCommit,
    windowsLauncher, environment, targets: ['macos', 'windows-x64', 'linux-x64'],
  });
  requireThat(Array.isArray(selected?.archives) && selected.archives.length === 3 &&
    ['macos', 'windows-x64', 'linux-x64'].every(target =>
      selected.archives.filter(archive => archive?.target === target).length === 1), 'EVIDENCE',
  'Private host fixtures must include every shared library target exactly once');
  for (const archive of selected.archives.filter(item => item.target !== 'linux-x64')) {
    const frozen = candidate.descriptor.files.find(file => file.filename === archive.filename);
    requireThat(frozen && archive.sha256 === frozen.sha256 && archive.size === frozen.size,
      'EVIDENCE', 'Private host fixtures must preserve the exact frozen published archive bytes');
  }
  return { ...selected, kind: 'private-test-library-only' };
}

function nativeContextMatches(context, { inventory, plan, target, profile, sourceRevision, artifacts, component = 'full', shard = null,
  bootstrapProtocol = null, shardProtocol = nativeFrameworkShardProtocol, assignment,
  schedulingPolicy = validationSchedulingPolicy }) {
  const resources = context.native.toolchain.resources;
  let validResources = false;
  if (resources && typeof resources === 'object') {
    try { validResources = digest(resources) === digest(nativeResourceFacts(resources, schedulingPolicy)); }
    catch (error) { if (!['INPUT', 'BUDGET', 'INVENTORY'].includes(error.code)) throw error; }
  }
  return validResources && nativeAffinityCapacityMatches(assignment, resources, shard) &&
    context.profile === nativeProfile(profile, target, component, shard) &&
    context.sources.length === 1 && context.sources[0].revision === sourceRevision &&
    context.native.kind === 'native' && context.native.platform === platforms[target] &&
    context.native.architecture === (target === 'macos-arm64' ? 'arm64' : 'x64') &&
    context.native.toolchain.node === nativeToolchain.node &&
    nativeSdkContextMatches(context.native.toolchain, { inventory, plan, assignment, shardProtocol,
      target, profile, component, shard, protocol: bootstrapProtocol }) &&
    context.location === locations[target] && context.owner === 'provider' &&
    context.mode === 'automated' && context.environment === 'local' &&
    context.producer.provider === 'github' && context.producer.connection === 'repository-ci' &&
    context.attemptCapability === 'distinct' && context.producer.attemptKind === 'known' &&
    /^[1-9]\d*$/u.test(context.producer.executionRef) && /^[1-9]\d*$/u.test(context.producer.attemptRef) &&
    (profile === 'r-pre' ? typeof context.intentId === 'string' : context.intentId === undefined) &&
    context.jobRef === `native-${nativeProducerRole(target, component, shard)}` &&
    digest(context.artifacts) === digest(validateExecutionContext({ ...context, artifacts }).artifacts);
}

export function aggregateNativeReadiness(evaluations, { profile, sourceRevision, artifacts, executions,
  components = false, frameworkShards = false, inventory, plan, goSources, unitOrder,
  shardProtocol = nativeFrameworkShardProtocol, bootstrapProtocol = null }) {
  requireThat(typeof components === 'boolean' && (!components || profile === 'pr'),
    'INPUT', 'Native component composition is explicit and PR-only');
  requireThat(typeof frameworkShards === 'boolean' && (!frameworkShards || components && profile === 'pr'),
    'INPUT', 'Framework shard aggregation is explicit and PR-only');
  const parts = frameworkShards ? nativePrPartsForProtocol(shardProtocol) : components ? nativeLegacyPrParts : validationPlatforms.map(target => ({
    target, component: 'full', role: target,
  }));
  requireThat(Array.isArray(evaluations) && ['pr', 'r-pre'].includes(profile) && /^[a-f0-9]{40}$/u.test(sourceRevision) &&
    Array.isArray(artifacts) && artifacts.length >= 5 &&
    artifacts.some(file => file.name === 'frozen-descriptor') &&
    artifacts.some(file => file.name === 'frozen-checksums') &&
    artifacts.some(file => /-macos\.tar\.gz$/u.test(file.name)) &&
    artifacts.some(file => /-windows-x64\.zip$/u.test(file.name)) &&
    artifacts.some(file => /\.tgz$/u.test(file.name)) &&
    Array.isArray(executions) && executions.length === parts.length &&
    new Set(executions.map(item => nativeProducerRole(item.target, item.component, item.shard))).size === parts.length &&
    executions.every(item => parts.some(part =>
      part.target === item.target && part.component === (item.component ?? 'full') &&
      (part.shard ?? null) === (item.shard ?? null))),
  'INPUT', 'Native aggregation needs every independently expected producer part and the complete frozen artifact set');
  const expected = new Map(executions.map(({ target, context, component = 'full', shard = null }) => {
    const actual = validateExecutionContext(context);
    const assignment = shard === null ? null : nativeExpectedAssignment({ inventory, plan, target, protocol: shardProtocol });
    requireThat(nativeContextMatches(actual, { inventory, plan, assignment, shardProtocol,
      target, profile, sourceRevision, artifacts, component, shard, bootstrapProtocol }),
      'EVIDENCE', 'Expected native execution does not match source, artifacts, platform or baseline');
    if (frameworkShards) {
      const specification = nativeSpecification({ plan, inventory, goSources, target, profile, component, shard, shardProtocol });
      requireThat(actual.inventoryDigest === validationInventoryDigest(specification) &&
        actual.testSpecDigest === testSpecificationDigest(plan) &&
        actual.configDigest === nativeConfigurationDigest({ inventory, plan, assignment, profile, target, component, shard, shardProtocol, bootstrapProtocol,
          shardPlanDigest: assignment?.digest ?? null,
          configuredWorkers: actual.native.toolchain.resources.configuredWorkers }),
      'EVIDENCE', 'Expected shard context differs from independently derived complete source/specification/assignment');
    }
    return [nativeProducerRole(target, component, shard), actual];
  }));
  const baseline = expected.values().next().value;
  requireThat([...expected.values()].every(context =>
    digest(context.sources) === digest(baseline.sources) &&
    context.candidateDigest === baseline.candidateDigest && context.testSpecDigest === baseline.testSpecDigest &&
    (components || context.configDigest === baseline.configDigest) &&
    digest(context.producer) === digest(baseline.producer) &&
    context.intentId === baseline.intentId), 'EVIDENCE',
  'Expected native lanes must belong to one exact source, configuration and producer attempt');
  const seen = new Set();
  const blockers = [];
  for (const { target, evaluation, component = 'full', shard = null } of evaluations) {
    const protectedState = requireReadinessEvaluation(evaluation);
    const part = parts.find(part => part.target === target && part.component === component &&
      (part.shard ?? null) === shard);
    if (!part || seen.has(part.role)) {
      blockers.push('Duplicate or unexpected native lane');
      continue;
    }
    seen.add(part.role);
    const selected = protectedState.context.executions;
    const specification = frameworkShards ?
      nativeSpecification({ plan, inventory, goSources, target, profile, component, shard, shardProtocol }) : null;
    if (evaluation.profile !== nativeProfile(profile, target, component, shard) || evaluation.status !== 'Passed' ||
        digest(evaluation.cases.map(test => test.testId).sort()) !==
          digest((specification ? specification.cases.map(test => test.id) : nativeCaseIds(target, profile, component)).sort()) ||
        selected.length !== 1 || selected[0].id !== `native-${part.role}` ||
        digest(selected[0].context) !== digest(expected.get(part.role)) ||
        specification && validationInventoryDigest(protectedState.spec) !== validationInventoryDigest(specification)) {
      blockers.push(`Native ${part.role} evidence is incomplete or belongs to different inputs`);
    }
    if (frameworkShards) {
      requireThat(unitOrder && typeof unitOrder === 'object' &&
        unitOrder.protocol === shardProtocol &&
        nativeUnitOrderProofs.get(unitOrder) === digest(unitOrder) &&
        digest(unitOrder.contexts) === digest(parts.map(part => ({
          role: part.role, contextDigest: digest(expected.get(part.role)),
        }))), 'EVIDENCE', 'Framework composition requires the exact protected current unit-order proof');
    }
  }
  for (const part of parts) if (!seen.has(part.role)) blockers.push(`Missing required native ${part.role} part`);
  return { status: blockers.length ? 'NotRun' : 'Passed', blockers,
    requiredPlatforms: [...validationPlatforms],
    requiredParts: parts.map(part => part.role),
    requiredCases: [...new Set(parts.flatMap(({ target, component, shard = null }) => frameworkShards ?
      nativeSpecification({ plan, inventory, goSources, target, profile, component, shard, shardProtocol }).cases.map(test => test.id) :
      nativeCaseIds(target, profile, component)))],
    ...(frameworkShards ? { frameworkShards: shardProtocol } : {}) };
}

const nativeUnitOrderProofs = new WeakMap();
export function requireNativeShardUnitOrder(proof, executions, protocol = nativeFrameworkShardProtocol) {
  requireThat(proof && typeof proof === 'object' && proof.protocol === protocol &&
    nativeUnitOrderProofs.get(proof) === digest(proof) &&
    executions.every(part => proof.contexts.some(origin =>
      origin.role === part.context.jobRef.slice('native-'.length) &&
      origin.contextDigest === digest(part.context))), 'EVIDENCE',
  'Shard composition requires the exact protected actual unit-order proof');
  return proof;
}
export function verifyNativeShardUnitOrder(parts, { protocol = nativeFrameworkShardProtocol } = {}) {
  requireThat(nativeFrameworkShardProtocols.includes(protocol),
    'EVIDENCE', 'Unknown native unit-order proof protocol');
  const expectedParts = nativePrPartsForProtocol(protocol);
  requireThat(Array.isArray(parts) && parts.length === expectedParts.length &&
    new Set(parts.map(part => nativeProducerRole(part.target, part.component, part.shard))).size === expectedParts.length &&
    new Set(parts.map(part => part.job?.id)).size === expectedParts.length,
  'EVIDENCE', 'Unit ordering requires all exact independently acquired producer parts');
  const selected = expectedParts.map(expected => {
    const part = parts.find(part => part.target === expected.target && part.component === expected.component &&
      (part.shard ?? null) === (expected.shard ?? null));
    requireThat(part, 'EVIDENCE', 'A required unit-order producer is missing');
    const context = validateExecutionContext(part.context);
    const job = part.job;
    requireThat(job?.name === `native-${expected.role}` && job.status === 'completed' &&
      job.conclusion === 'success' && Number.isSafeInteger(job.id) && job.id > 0 &&
      String(job.run_id) === context.producer.executionRef &&
      String(job.run_attempt) === context.producer.attemptRef &&
      context.jobRef === job.name && Number.isFinite(Date.parse(job.started_at)) &&
      Number.isFinite(Date.parse(job.completed_at)) && Date.parse(job.completed_at) >= Date.parse(job.started_at),
    'EVIDENCE', 'Unit-order evidence differs from the actual required native job/context/attempt');
    return { ...expected, context, job };
  });
  for (const part of selected.filter(part => part.shard &&
    !nativeFrameworkUnitShardNames(part.target, protocol).includes(part.shard))) {
    requireThat(selected.filter(other => nativeFrameworkUnitShardNames(other.target, protocol).includes(other.shard) &&
      (protocol === nativeLegacyFrameworkShardProtocol || other.target === part.target)).every(units =>
      Date.parse(units.job.completed_at) <= Date.parse(part.job.started_at)), 'EVIDENCE',
    'Required actual platform units must complete before their regression shards start');
  }
  const proof = { protocol,
    contexts: selected.map(part => ({ role: part.role, contextDigest: digest(part.context) })),
    jobs: selected.map(part => ({ role: part.role, id: part.job.id,
      startedAt: part.job.started_at, completedAt: part.job.completed_at })) };
  nativeUnitOrderProofs.set(proof, digest(proof));
  return proof;
}

export function parseNativeOptions(args) {
  requireThat(Array.isArray(args) && args.length % 2 === 0, 'INPUT', 'Native options require explicit values');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--target': 'target', '--profile': 'profile', '--candidate-dir': 'candidateDir',
      '--evidence-dir': 'evidenceDir', '--build-candidate': 'buildCandidate', '--phase': 'phase',
      '--component': 'component', '--framework-shard': 'shard' }[args[index]];
    requireThat(key && options[key] === undefined, 'INPUT', 'Unknown or repeated native option');
    requireThat(key !== 'buildCandidate' || ['true', 'false'].includes(args[index + 1]),
      'INPUT', '--build-candidate must be exactly true or false');
    options[key] = key === 'buildCandidate' ? args[index + 1] === 'true' : args[index + 1];
  }
  return options;
}

export function validateNativeRequest({ target, profile, candidateDir, evidenceDir, buildCandidate = false,
  phase = 'validation', component = 'full', shard = null },
  environment = process.env) {
  requireThat(validationPlatforms.includes(target) && ['pr', 'r-pre'].includes(profile) &&
    typeof buildCandidate === 'boolean' && ['candidate', 'validation'].includes(phase),
  'INPUT', 'Select an exact native platform, profile, phase and boolean build flag');
  requireThat(!buildCandidate || target === 'linux-x64', 'INPUT', 'Only the Linux producer may freeze a candidate');
  requireThat(phase !== 'candidate' || target === 'linux-x64' && buildCandidate,
    'INPUT', 'Source freeze requires the Linux candidate-building phase');
  nativeProducerRole(target, component, shard);
  requireThat(component === 'full' || profile === 'pr' && phase === 'validation' && !buildCandidate,
    'INPUT', 'Partial Mac components require the PR validation phase and an already frozen candidate');
  if (profile === 'r-pre') id(environment.RELEASE_INTENT_ID, 'logical release intent');
  if (!buildCandidate) for (const name of ['EXPECTED_DESCRIPTOR_SHA256', 'EXPECTED_CHECKSUMS_SHA256']) {
    requireThat(/^[a-f0-9]{64}$/u.test(environment[name] ?? ''), 'INPUT', `Missing exact ${name}`);
  }
  requireThat(/^[a-f0-9]{40}$/u.test(environment.EXPECTED_SOURCE_COMMIT ?? ''), 'INPUT', 'Missing exact expected source');
  const local = path.join(repositoryRoot, '.test-data');
  const resolved = [candidateDir, evidenceDir].map(directory => {
    requireThat(typeof directory === 'string' && directory.trim().length > 0,
      'INPUT', 'Candidate and evidence paths must be explicit');
    const result = path.resolve(repositoryRoot, directory);
    const relative = path.relative(local, result);
    requireThat(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative), 'INPUT', 'Native output must be owned repository-local .test-data children');
    return result;
  });
  requireThat(resolved[0] !== resolved[1] &&
    !resolved.some((directory, index) => {
      const relative = path.relative(directory, resolved[1 - index]);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }), 'INPUT', 'Candidate and evidence directories must be disjoint');
  return { target, profile, candidateDir: resolved[0], evidenceDir: resolved[1], buildCandidate, phase, component, shard };
}

export async function assertGitFreeAncestors(directory, { lstat = fs.lstat } = {}) {
  let current = path.resolve(directory);
  for (;;) {
    const stat = await lstat(current);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'HOST',
      'Native ambient storage must not traverse linked or non-directory ancestors');
    let marker;
    try { marker = await lstat(path.join(current, '.git')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireThat(!marker, 'HOST', 'Native ambient temporary storage must be outside every Git working tree');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function allocateAmbientDirectory() {
  requireThat(typeof process.env.GITHUB_WORKSPACE === 'string' && process.env.GITHUB_WORKSPACE,
    'HOST', 'Native ambient storage requires the actual hosted workspace parent');
  const workspace = path.resolve(process.env.GITHUB_WORKSPACE);
  requireThat(path.relative(workspace, repositoryRoot) === 'source', 'HOST',
    'The source checkout must be the isolated child of the hosted workspace');
  await assertGitFreeAncestors(workspace);
  const directory = path.join(workspace, `.sdlc-native-ambient-${randomUUID()}`);
  await fs.mkdir(directory);
  return { directory, async dispose() {
    requireThat(path.dirname(directory) === workspace &&
      /^\.sdlc-native-ambient-[a-f0-9-]{36}$/u.test(path.basename(directory)), 'HOST',
    'Cleanup is restricted to this exact owned ambient directory');
    const stat = await fs.lstat(directory);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'HOST', 'Owned ambient storage was replaced');
    await fs.rm(directory, { recursive: true });
  } };
}

async function literalDirectory(directory, { create = false, empty = false } = {}) {
  const relative = path.relative(repositoryRoot, directory);
  requireThat(relative && relative.split(path.sep)[0] === '.test-data' &&
    !relative.split(path.sep).includes('..') && !path.isAbsolute(relative),
  'EVIDENCE', 'Native directories must remain in checkout-local .test-data');
  let current = repositoryRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat = await fs.lstat(current).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!stat && create) { await fs.mkdir(current); stat = await fs.lstat(current); }
    requireThat(stat?.isDirectory() && !stat.isSymbolicLink(),
      'EVIDENCE', 'Native paths must be literal owned directories without linked ancestors');
  }
  if (empty) requireThat(!(await fs.readdir(directory)).length, 'EVIDENCE', 'Native output directory must be new and empty');
}

async function goSources() {
  return Promise.all((await fs.readdir(path.join(repositoryRoot, 'cmd', 'sdlc-launcher')))
    .filter(file => file.endsWith('_test.go')).map(async file => ({
      file, contents: await fs.readFile(path.join(repositoryRoot, 'cmd', 'sdlc-launcher', file), 'utf8'),
    })));
}

export async function assertCommittedNativeInputs() {
  await assertCommittedSourceInputs(repositoryRoot, { include: file =>
    /^(?:test|src|scripts|cmd|packaging|assets|\.github\/(?:workflows|actions))\//u.test(file) ||
    file === '.github/release-requirements.txt' ||
    file === 'docs/sdlc/public-readiness/test-plan.md' || file === 'package.json' });
}

export function nativeGoObservations(sources, reports, target) {
  if (reports.length !== 1) return { status: 'NotRun', observations: [],
    blockers: [{ code: 'MISSING_OR_DUPLICATE_GO_REPORT', reports: reports.length }] };
  const checked = reconcileGoExecution(sources, reports[0]);
  if (reports[0].platform !== platforms[target] ||
      reports[0].architecture !== (target === 'macos-arm64' ? 'arm64' : 'x64') ||
      reports[0].node !== `v${nativeToolchain.node}`) {
    checked.blockers.push({ code: 'WRONG_NATIVE_GO_HOST' });
  }
  const observations = [];
  for (const definition of checked.expected.filter(test => goApplicable(test, target))) {
    const events = checked.executions.filter(event => event.Test === definition.name);
    if (events.length !== 1) continue;
    const event = events[0];
    if (!Number.isFinite(Date.parse(event.Time)) ||
        (event.Elapsed !== undefined && (!Number.isFinite(event.Elapsed) || event.Elapsed < 0))) {
      checked.blockers.push({ code: 'INVALID_GO_TERMINAL', name: event.Test });
      continue;
    }
    observations.push({ id: `assertion-${digest(['go', definition.file, definition.name])}`,
      status: event.Action === 'pass' ? 'Passed' : event.Action === 'fail' ? 'Failed' : 'Skipped',
      observedAt: event.Time, durationMs: (event.Elapsed ?? 0) * 1000,
      detail: event.Action === 'skip' ? 'Required Go assertion skipped; see original Go journal.' : '' });
  }
  return { ...checked, status: checked.blockers.length && checked.status === 'Passed' ? 'NotRun' :
    checked.status, observations };
}

export function nativeStageSelections(inventory, plan, schedulingPolicy = validationSchedulingPolicy) {
  const selected = hostedValidationSelection({ inventory, tests: parseTestPlan(plan), canonicalFiles: unitFiles, policy: schedulingPolicy });
  requireThat(Object.values(selected).every(stage => !stage.blockers.length),
    'INVENTORY', 'Every required unit must have an executable binding before native admission');
  const stages = [
    { ...selected.canonical, files: unitFiles.filter(file => selected.canonical.files.includes(file)),
      name: 'unit', selectorName: selected.canonical.name },
    { ...selected.units, name: 'required-units', selectorName: selected.units.name },
    { ...selected.regression, name: 'regression', selectorName: selected.regression.name },
  ];
  requireThat(stages.every(stage => stage.cases.length > 0), 'INVENTORY', 'Native validation cannot use an empty stage');
  return stages.map(stage => {
    if (stage.name === 'unit') return stage;
    const { payload, ...selection } = validationSelectionDescriptor({ files: stage.files, name: stage.selectorName });
    return { ...stage, args: ['targeted', '--selection-file', selection.path], selection };
  });
}

export function validateNativeGroupReport({ inventory, stage, report, journal, target,
  schedulingPolicy = validationSchedulingPolicy }) {
  requireThat(Array.isArray(report.selection?.namePatterns) &&
    digest(report.selection.namePatterns) === digest(stage.name === 'unit' ? [] : [stage.selectorName]) &&
    digest(report.selection?.skipPatterns ?? []) === digest([]) && report.selection?.coverage !== true,
  'EVIDENCE', 'Original native selection patterns must match the complete independently derived stage');
  const files = stage.files;
  const groups = validationExecutionGroups(inventory, {
    files, pattern: stage.name === 'unit' ? undefined : stage.selectorName, preserveOrder: true,
  });
  const retained = report.groupExecution;
  requireThat(retained?.schemaVersion === 1 && retained.protocol === validationGroupProtocol &&
    retained.policyDigest === validationSchedulingPolicyDigest(schedulingPolicy) && retained.selectionDigest === digest(groups) &&
    Array.isArray(retained.groups) && retained.groups.length === groups.length &&
    new Set(retained.groups.map(group => group.id)).size === groups.length &&
    typeof journal === 'string' && journal.length > 0,
  'EVIDENCE', 'Original root-group protocol/selection/policy/journal is missing or differs from adopted source');
  const events = journal.trim().split('\n').map(line => JSON.parse(line));
  requireThat(events.every((event, index) => event.sequence === index + 1 &&
    Number.isFinite(Date.parse(event.observedAt))), 'EVIDENCE',
  'Original root-group journal must retain a complete ordered producer event sequence');
  const fields = ['id', 'rootId', 'root', 'file', 'sourceDigest', 'assertionIds', 'name',
    'minimumSlots', 'exclusiveResources', 'dependsOn'];
  const actual = new Map(retained.groups.map(group => [group.id, group]));
  for (const expected of groups) {
    const group = actual.get(expected.id);
    const applicable = inventory.cases.filter(test => expected.assertionIds.includes(test.id) &&
      test.applicability.platforms.includes(target));
    const starts = events.filter(event => event.kind === 'group-start' && event.groupId === expected.id);
    const ends = events.filter(event => event.kind === 'group-end' && event.groupId === expected.id);
    requireThat(group && fields.every(field => digest(group[field]) === digest(expected[field])) &&
      (applicable.length ? group.status === 'Passed' : group.status === 'NotRun' &&
        group.disposition === 'not-applicable-on-this-host') &&
      Number.isFinite(Date.parse(group.startedAt)) && Number.isFinite(Date.parse(group.finishedAt)) &&
      Date.parse(group.startedAt) <= Date.parse(group.finishedAt) &&
      Date.parse(group.startedAt) >= Date.parse(report.startedAt) &&
      Date.parse(group.finishedAt) <= Date.parse(report.finishedAt) &&
      Array.isArray(group.processIds) && group.processIds.length > 0 &&
      group.processIds.every(pid => Number.isSafeInteger(pid) && pid > 0) &&
      starts.length === 1 && ends.length === 1 &&
      starts[0].startedAt === group.startedAt && ends[0].finishedAt === group.finishedAt &&
      digest(starts[0].processIds) === digest(group.processIds) &&
      digest(ends[0].processIds) === digest(group.processIds) &&
      ends[0].status === group.status && digest(ends[0].summary) === digest(group.summary) &&
      report.executions.filter(row => row.groupId === expected.id).length === expected.assertionIds.length &&
      expected.assertionIds.every(id => {
        const definition = inventory.cases.find(test => test.id === id);
        const rows = report.executions.filter(row => row.groupId === expected.id && row.file === definition.file &&
          row.name === definition.name && digest(row.parents) === digest(definition.parents));
        const completions = events.filter(event => event.kind === 'completion' && event.groupId === expected.id &&
          event.file === definition.file && event.name === definition.name &&
          digest(event.parents) === digest(definition.parents));
        return rows.length === 1 && completions.length === 1 &&
          ['status', 'observedAt', 'sequence', 'durationMs'].every(field =>
            digest(rows[0][field]) === digest(completions[0][field]));
      }), 'EVIDENCE', 'Original root-group closure/process/timing/outcome does not match its independent source selection');
    requireThat(expected.dependsOn.every(id => actual.get(id)?.status === 'Passed' &&
      Date.parse(actual.get(id).finishedAt) <= Date.parse(group.startedAt)),
    'EVIDENCE', 'Original dependent root began before its prerequisite passed');
    for (const other of retained.groups.filter(other => other.id !== group.id &&
      other.exclusiveResources.some(resource => group.exclusiveResources.includes(resource)))) {
      requireThat(Date.parse(group.finishedAt) <= Date.parse(other.startedAt) ||
        Date.parse(other.finishedAt) <= Date.parse(group.startedAt),
      'EVIDENCE', 'Original roots overlapped an exclusively owned declared resource');
    }
  }
  requireThat(events.filter(event => event.kind === 'group-start').length === groups.length &&
    events.filter(event => event.kind === 'group-end').length === groups.length &&
    events.filter(event => event.kind === 'completion').length === groups.reduce((count, group) =>
      count + group.assertionIds.length, 0),
  'EVIDENCE', 'Original root-group journal contains unexpected group executions');
  return groups;
}

async function readOptional(file) {
  try {
    const stat = await fs.lstat(file);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024 * 1024,
      'EVIDENCE', 'Native evidence must be a bounded regular file');
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return { schemaVersion: 1, kind: 'invalid-partial-report', complete: false,
        diagnostic: 'Original report contains incomplete or malformed JSON; original bytes remain retained.' };
    }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function retainedToolReports(directory) {
  const found = [];
  async function walk(parent, depth) {
    requireThat(depth <= 3, 'EVIDENCE', 'Tool evidence nesting exceeds the native producer contract');
    for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && /^tools-[a-f0-9-]+$/u.test(entry.name)) {
        found.push(await readOptional(path.join(parent, entry.name, 'go-tests.json')));
      }
    }
  }
  await walk(directory, 0);
  return found.filter(Boolean);
}

function nativeGroupTimings(groups, report, startedAt, stage) {
  return groups.map(group => {
    const original = report.groupExecution.groups.find(row => row.id === group.id);
    const root = report.executions.find(row => row.groupId === group.id &&
      row.file === group.file && row.name === group.root && row.parents.length === 0);
    const groupMs = Date.parse(original.finishedAt) - Date.parse(original.startedAt);
    requireThat(/^[a-f0-9]{64}$/u.test(group.id) &&
      /^assertion-[a-f0-9]{64}$/u.test(group.rootId) &&
      /^[a-f0-9]{64}$/u.test(group.sourceDigest) &&
      Number.isFinite(groupMs) && groupMs >= 0 &&
      Number.isFinite(root?.durationMs) && root.durationMs >= 0,
    'EVIDENCE', 'Native timing diagnostics require closed source identities and actual bounded durations');
    const startOffsetMs = Date.parse(original.startedAt) - Date.parse(startedAt);
    const endOffsetMs = Date.parse(original.finishedAt) - Date.parse(startedAt);
    const offsetsAvailable = Number.isFinite(startOffsetMs) && startOffsetMs >= 0 &&
      Number.isFinite(endOffsetMs) && endOffsetMs >= startOffsetMs;
    return { groupId: group.id, rootId: group.rootId, sourceDigest: group.sourceDigest,
      groupMs, rootMs: root.durationMs, stage, startedAt: original.startedAt, finishedAt: original.finishedAt,
      startOffsetMs: offsetsAvailable ? startOffsetMs : null, endOffsetMs: offsetsAvailable ? endOffsetMs : null };
  });
}

const nativeTimingLimitMs = 7 * 24 * 60 * 60 * 1000;

function nativeGroupCoordinates(inventory, groups, report, journal, startedAt, stage, schedulingPolicy) {
  const retained = report.groupExecution;
  const fields = ['id', 'rootId', 'root', 'file', 'sourceDigest', 'assertionIds', 'name',
    'minimumSlots', 'exclusiveResources', 'dependsOn'];
  requireThat(groups.length <= 2048 && retained?.schemaVersion === 1 &&
    retained.protocol === validationGroupProtocol &&
    retained.policyDigest === validationSchedulingPolicyDigest(schedulingPolicy) &&
    retained.selectionDigest === digest(groups) && retained.groups?.length === groups.length &&
    Array.isArray(report.executions) && report.executions.length <= 8192 &&
    typeof journal === 'string' && Buffer.byteLength(journal) <= 8 * 1024 * 1024,
  'EVIDENCE', 'Timing coordinates require bounded original source, policy, selection and journal');
  const lines = journal.trim().split('\n');
  requireThat(lines.length <= 32768, 'EVIDENCE', 'Timing journal exceeds the diagnostic bound');
  const events = lines.map(line => JSON.parse(line));
  const ids = new Set(groups.map(group => group.id));
  const starts = events.filter(event => event.kind === 'execution-start');
  const ends = events.filter(event => event.kind === 'execution-end');
  requireThat(report.executions.every(row => ids.has(row.groupId)) &&
    typeof report.complete === 'boolean' &&
    starts.length === 1 && starts[0].sequence === 1 &&
    ['files', 'selection', 'context'].every(field =>
      digest(starts[0][field] ?? null) === digest(report[field] ?? null)) &&
    ends.length <= 1 && ends.every(end => end.complete === report.complete &&
      end.exitCode === report.exitCode && digest(end.summary) === digest(report.summary)) &&
    events.every((event, index) => event.sequence === index + 1 &&
    Number.isFinite(Date.parse(event.observedAt)) &&
    (!['group-start', 'group-end', 'completion'].includes(event.kind) || ids.has(event.groupId))),
  'EVIDENCE', 'Timing journal has an invalid sequence or undeclared group');
  const offset = value => {
    if (value === null) return null;
    const result = Date.parse(value) - Date.parse(startedAt);
    requireThat(typeof value === 'string' && Number.isSafeInteger(result) &&
      result >= 0 && result <= nativeTimingLimitMs,
    'EVIDENCE', 'Timing coordinate is not an observed bounded clock');
    return result;
  };
  return groups.map((group, index) => {
    const original = retained.groups[index];
    requireThat(original && fields.every(field => digest(original[field]) === digest(group[field])) &&
      ['Passed', 'Failed', 'NotRun'].includes(original.status) &&
      Array.isArray(original.processIds),
    'EVIDENCE', 'Timing group order or source declaration differs');
    const starts = events.filter(event => event.kind === 'group-start' && event.groupId === group.id);
    const ends = events.filter(event => event.kind === 'group-end' && event.groupId === group.id);
    const rows = report.executions.filter(row => row.groupId === group.id);
    const completions = events.filter(event => event.kind === 'completion' && event.groupId === group.id);
    const definitions = inventory.cases.filter(test => group.assertionIds.includes(test.id));
    const startOffsetMs = offset(original.startedAt), endOffsetMs = offset(original.finishedAt);
    requireThat(rows.length === completions.length &&
      new Set(rows.map(row => digest([row.file, row.name, row.parents]))).size === rows.length &&
      rows.every(row => {
        const completion = completions.find(event => event.sequence === row.sequence);
        return completion && ['file', 'name', 'parents', 'status', 'observedAt', 'sequence', 'durationMs']
          .every(field => digest(row[field]) === digest(completion[field])) &&
          row.file === group.file && Array.isArray(row.parents) &&
          definitions.some(test => test.file === row.file && test.name === row.name &&
            digest(test.parents) === digest(row.parents)) &&
          ['Passed', 'Failed', 'NotRun', 'Skipped', 'Cancelled'].includes(row.status) &&
          Number.isFinite(row.durationMs) && row.durationMs >= 0 && row.durationMs <= nativeTimingLimitMs;
      }), 'EVIDENCE', 'Timing completions differ from the original journal or contain invalid durations');
    if (startOffsetMs === null) {
      requireThat(endOffsetMs === null && original.status === 'NotRun' && original.summary === null &&
        original.processIds.length === 0 && starts.length === 0 && ends.length === 0,
      'EVIDENCE', 'An unavailable process start cannot have a retained process end');
      return { groupId: group.id, rootId: group.rootId, sourceDigest: group.sourceDigest,
        state: rows.length ? 0 : 1, startOffsetMs: null, endOffsetMs: null };
    }
    requireThat(starts.length === 1 && starts[0].rootId === group.rootId &&
      starts[0].startedAt === original.startedAt &&
      digest(starts[0].processIds) === digest(original.processIds) &&
      original.processIds.length > 0 &&
      original.processIds.every(pid => Number.isSafeInteger(pid) && pid > 0) &&
      startOffsetMs >= offset(report.startedAt) && ends.length <= 1 &&
      ends.every(end => end.sequence > starts[0].sequence &&
        end.rootId === group.rootId && end.finishedAt === original.finishedAt &&
        end.status === original.status && digest(end.processIds) === digest(original.processIds) &&
        digest(end.summary) === digest(original.summary)),
    'EVIDENCE', 'Timing process boundaries differ from the original journal');
    if (endOffsetMs === null) return {
      groupId: group.id, rootId: group.rootId, sourceDigest: group.sourceDigest,
      state: 2, startOffsetMs, endOffsetMs: null,
    };
    const root = rows.filter(row => row.file === group.file && row.name === group.root && row.parents.length === 0);
    requireThat(ends.length === 1 && endOffsetMs >= startOffsetMs && original.summary !== null &&
      root.length === 1 &&
      (original.status !== 'Passed' || rows.every(row => row.status !== 'Failed')) &&
      (original.status !== 'Failed' || rows.some(row => row.status === 'Failed')) &&
      (report.finishedAt === null || endOffsetMs <= offset(report.finishedAt)),
    'EVIDENCE', 'Completed timing coordinates require original process and root completion');
    return { groupId: group.id, rootId: group.rootId, sourceDigest: group.sourceDigest,
      state: { Passed: 3, Failed: 4, NotRun: 5 }[original.status],
      startOffsetMs, endOffsetMs, groupMs: endOffsetMs - startOffsetMs, rootMs: root[0].durationMs,
      stage, startedAt: original.startedAt, finishedAt: original.finishedAt };
  });
}

export function nativeTimingSelectionDigest({ source, runId, attempt, target, component, shard, jobRef, stages }) {
  return digest({ kind: 'native-timing-selection-v1', source,
    runId: String(runId), attempt: String(attempt), target, component, shard, jobRef,
    stages: stages.map(stage =>
      [stage.name, stage.files, stage.name === 'unit' ? [] : [stage.selectorName]]) });
}

export function nativeTimingCoordinateDiagnostics(rows, {
  source, selection, policy, producer = 'partial', startedAt = null, finishedAt = null,
} = {}) {
  requireThat(rows.length > 0 && rows.length <= 2048 &&
    [source, selection, policy].every(value => /^[a-f0-9]{64}$/u.test(value)) &&
    new Set(rows.map(row => row.groupId)).size === rows.length &&
    rows.every(row => /^[a-f0-9]{64}$/u.test(row.groupId) &&
      /^assertion-[a-f0-9]{64}$/u.test(row.rootId) && /^[a-f0-9]{64}$/u.test(row.sourceDigest) &&
      Number.isInteger(row.state) && row.state >= 0 && row.state <= 5 &&
      [row.startOffsetMs, row.endOffsetMs].every(value => value === null ||
        Number.isSafeInteger(value) && value >= 0 && value <= nativeTimingLimitMs) &&
      (row.state < 2 ? row.startOffsetMs === null && row.endOffsetMs === null :
        row.state === 2 ? row.startOffsetMs !== null && row.endOffsetMs === null :
          row.startOffsetMs !== null && row.endOffsetMs !== null && row.endOffsetMs >= row.startOffsetMs &&
          Number.isFinite(row.groupMs) && row.groupMs === row.endOffsetMs - row.startOffsetMs &&
          Number.isFinite(row.rootMs) && row.rootMs >= 0 && row.rootMs <= nativeTimingLimitMs)),
  'EVIDENCE', 'Timing projection requires closed bounded numeric coordinates');
  const observed = rows.filter(row => row.state >= 3);
  const timing = nativeTimingDiagnostics(observed, {
    complete: observed.length === rows.length, producer, startedAt, finishedAt,
  });
  const longest = [...observed].sort((a, b) => b.groupMs - a.groupMs || a.groupId.localeCompare(b.groupId))
    .slice(0, 10).map(row => [rows.indexOf(row), row.groupMs, row.rootMs]);
  const terminal = timing.terminalGroup.availability === 'available' ?
    [rows.findIndex(row => row.groupId === timing.terminalGroup.groupId),
      timing.terminalGroup.startOffsetMs, timing.terminalGroup.endOffsetMs, timing.terminalGroup.tiedGroups] : null;
  const prefix = '::notice title=Native group timing::';
  const maximum = Math.max(0, ...rows.flatMap(row => [row.startOffsetMs ?? 0, row.endOffsetMs ?? 0]));
  // A tick denotes a conservative [tick*q, (tick+1)*q) interval, never a reconstructed timestamp.
  for (let quantumMs = 1; quantumMs <= 2 ** 30; quantumMs *= 2) {
    const base = Math.floor(maximum / quantumMs) + 2;
    const coordinates = rows.map(row =>
      ((row.startOffsetMs === null ? 0 : Math.floor(row.startOffsetMs / quantumMs) + 1) * base +
        (row.endOffsetMs === null ? 0 : Math.floor(row.endOffsetMs / quantumMs) + 1)) * 6 + row.state);
    if (!coordinates.every(Number.isSafeInteger)) continue;
    const header = { version: 1, source, selection, policy,
      order: digest(rows.map(row => [row.groupId, row.rootId, row.sourceDigest])),
      origin: 'producer.startedAt', producer: producer === 'completed' ? 'completed' : 'partial',
      count: rows.length, encoding: 'numeric-rle-v1', quantumMs, base, longest, terminal };
    const annotations = [prefix + JSON.stringify(header)];
    requireThat(Buffer.byteLength(annotations[0]) < 1024,
      'EVIDENCE', 'Timing identity and longest-group header exceeds its diagnostic bound');
    let chunk = [], start = 0, expanded = 0;
    for (let index = 0; index < coordinates.length;) {
      const code = coordinates[index];
      let count = 1;
      while (coordinates[index + count] === code) count++;
      const run = count >= 3 ? [code, 1 - count] : Array(count).fill(code);
      const next = [...chunk, ...run];
      if (Buffer.byteLength(prefix + JSON.stringify({ start, coordinates: next })) >= 400) {
        annotations.push(prefix + JSON.stringify({ start, coordinates: chunk }));
        start = expanded;
        chunk = run;
      } else chunk = next;
      expanded += count;
      index += count;
    }
    if (chunk.length) annotations.push(prefix + JSON.stringify({ start, coordinates: chunk }));
    if (annotations.length <= 10 && annotations.reduce((sum, line) => sum + Buffer.byteLength(line), 0) < 4096) {
      return { terminalGroup: timing.terminalGroup,
        timingProjection: { ...header, coordinates }, timingAnnotations: annotations };
    }
  }
  requireThat(false, 'EVIDENCE', 'Complete timing coordinates exceed the bounded diagnostic policy');
}

export function nativeTimingDiagnostics(timings, {
  complete = true, producer = 'partial', startedAt = null, finishedAt = null,
} = {}) {
  const rows = timings.filter(row => /^[a-f0-9]{64}$/u.test(row.groupId) &&
    /^assertion-[a-f0-9]{64}$/u.test(row.rootId) && /^[a-f0-9]{64}$/u.test(row.sourceDigest) &&
    Number.isFinite(row.groupMs) && row.groupMs >= 0 && Number.isFinite(row.rootMs) && row.rootMs >= 0);
  const closed = complete && rows.length === timings.length && rows.length > 0 &&
    rows.every(row => Number.isFinite(Date.parse(row.finishedAt)) &&
      Number.isFinite(Date.parse(row.startedAt)) && Date.parse(row.finishedAt) >= Date.parse(row.startedAt) &&
      Number.isFinite(row.startOffsetMs) && row.startOffsetMs >= 0 &&
      Number.isFinite(row.endOffsetMs) && row.endOffsetMs >= row.startOffsetMs);
  const latest = closed ? Math.max(...rows.map(row => Date.parse(row.finishedAt))) : null;
  const terminal = closed ? rows.filter(row => Date.parse(row.finishedAt) === latest)
    .sort((left, right) => left.groupId.localeCompare(right.groupId)) : [];
  const terminalGroup = closed ? { availability: 'available', ...terminal[0],
    offsetOrigin: 'producer.startedAt', tiedGroups: terminal.length } :
    { availability: 'unavailable', reason: rows.length ? 'incomplete-or-unavailable-group-timestamps' : 'no-group-timings',
      offsetOrigin: 'producer.startedAt' };
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  const producerEnvelope = { scope: 'native-execution-report',
    startedAt: Number.isFinite(Date.parse(startedAt)) ? new Date(startedAt).toISOString() : null,
    finishedAt: Number.isFinite(Date.parse(finishedAt)) ? new Date(finishedAt).toISOString() : null,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null };
  const terminalNotice = closed ? { group: terminal[0].groupId, root: terminal[0].rootId,
    source: terminal[0].sourceDigest, startMs: terminal[0].startOffsetMs,
    endMs: terminal[0].endOffsetMs, ties: terminal.length } : { availability: 'unavailable' };
  const timingAnnotations = [...rows].sort((left, right) =>
    right.groupMs - left.groupMs || left.groupId.localeCompare(right.groupId)).slice(0, 10).map((row, index) =>
    `::notice title=Native group timing::group=${row.groupId} root=${row.rootId} source=${row.sourceDigest} ` +
    `groupMs=${row.groupMs} rootMs=${row.rootMs} group=completed producer=${producer === 'completed' ? 'completed' : 'partial'} ` +
    `startMs=${Number.isFinite(row.startOffsetMs) && row.startOffsetMs >= 0 ? row.startOffsetMs : 'NA'} ` +
    `endMs=${Number.isFinite(row.endOffsetMs) && row.endOffsetMs >= 0 ? row.endOffsetMs : 'NA'} ` +
    `last=${closed ? Date.parse(row.finishedAt) === latest : 'NA'}` +
    (index === 0 ? ` envelopeMs=${producerEnvelope.durationMs ?? 'NA'} terminal=${JSON.stringify(terminalNotice)}` : ''));
  return { terminalGroup: { ...terminalGroup, producerEnvelope }, timingAnnotations };
}

export function verifyNativePhaseSettlement({ stage, report, command, journal, capacity }) {
  const rule = [nativePlacementPhasesV9, nativePlacementPhasesV10]
    .find(rule => rule.protocol === stage.phase?.protocol);
  const phase = rule?.phases[stage.phase?.index];
  requireThat(stage.kind === 'regression' && rule &&
    phase?.name === stage.name && phase.rootId === stage.phase.rootId &&
    stage.phase.previous === (stage.phase.index === 0 ? null : rule.phases[stage.phase.index - 1]?.name) &&
    capacity === rule.capacity, 'EVIDENCE',
  'Native phase settlement requires its exact source-qualified phase and host allocation');
  const budget = report?.resources?.budget;
  const events = typeof journal === 'string' && journal.trim() ?
    journal.trim().split('\n').map(line => JSON.parse(line)) : [];
  const starts = events.filter(event => event.kind === 'command-dispatched');
  const ends = events.filter(event => event.kind === 'command-end');
  const end = ends[0];
  const cleanup = end?.cleanup;
  requireThat(report?.complete === true && command?.complete === true &&
    Number.isSafeInteger(command.exitCode) && command.exitCode >= 0 &&
    Number.isSafeInteger(command.pid) && command.pid > 0 &&
    Number.isFinite(Date.parse(command.startedAt)) && Number.isFinite(Date.parse(command.finishedAt)) &&
    Date.parse(command.startedAt) <= Date.parse(report.startedAt) &&
    Date.parse(report.finishedAt) <= Date.parse(command.finishedAt) &&
    events.every((event, index) => event.sequence === index + 1 &&
      Number.isFinite(Date.parse(event.observedAt))) &&
    starts.length === 1 && starts[0].pid === command.pid && ends.length === 1 &&
    end.complete === true && end.exitCode === command.exitCode &&
    cleanup?.rootExitObserved === true &&
    (cleanup.requested === false || cleanup.requested === true && cleanup.survivorsVerified === true) &&
    command.checkpoint?.journalDurable === true &&
    command.checkpoint.originalJournalPrefix?.sha256 === digest(Buffer.from(journal)) &&
    command.checkpoint.originalJournalPrefix?.bytes === Buffer.byteLength(journal) &&
    budget?.version === 2 && budget.capacity === capacity && budget.admissionStopped === false &&
    ['activeWorkers', 'residentWorkers', 'pendingParentRestorations', 'controls']
      .every(field => budget[field] === 0) &&
    Number.isSafeInteger(budget.producers) && budget.producers >= 0 && budget.producers <= 1 &&
    Number.isSafeInteger(budget.potentialResidentWorkers) && budget.potentialResidentWorkers >= 0 &&
    budget.potentialResidentWorkers <= budget.producers,
  'UNSETTLED_WRITERS', 'Native phase cannot release its successor without original process and worker cleanup settlement');
  // The reporting producer's own future-resident reservation settles with its observed process close.
  return { schemaVersion: 1, kind: 'native-primary-phase-settlement', stage: stage.name,
    phase: stage.phase, contextDigest: digest(command.context),
    commandDigest: digest(command), reportDigest: digest(report),
    commandJournalDigest: digest(Buffer.from(journal)), settled: true };
}

async function collectExecution({ directory, data, inventory, sources, calculatorSources, target, stages, context, specification, startedAt, plan,
  candidate, profile = context.profile.startsWith('r-pre-') ? 'r-pre' : 'pr',
  component = componentFromContext(context, target), shard = shardFromContext(context, target),
  shardProtocol = nativeFrameworkShardProtocol, bootstrapProtocol = null, schedulingPolicy = validationSchedulingPolicy }) {
  const assignment = shard === null ? null : nativeExpectedAssignment({ inventory, plan, target, protocol: shardProtocol, schedulingPolicy });
  const part = assignment?.parts.find(part => part.shard === shard);
  const observations = [];
  const diagnostics = [];
  const timings = [];
  const coordinateTimings = [];
  let timingCoverageComplete = true;
  let complete = true;
  let exitCode = 0;
  const read = name => data ? Promise.resolve(data[name] ?? null) : readOptional(path.join(directory, name));
  if (bootstrapProtocol !== null) requireNativeBootstrapCapability({
    bootstrap: await read('toolchain.json'), inventory, plan, assignment, target, profile, component, shard, protocol: bootstrapProtocol });
  if ([nativeUnitBootstrapProtocol, nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(bootstrapProtocol) && !nativeBootstrapRequirements({
    inventory, plan, assignment, target, profile, component, shard, protocol: bootstrapProtocol,
  }).ownedPrefix) {
    for (const file of ['native-homebrew-prefix-allocation.json', 'native-homebrew-prefix-cleanup.json',
      'native-homebrew.json']) {
      requireThat(await read(file) === null, 'EVIDENCE',
        'Prefix-free original execution cannot contain invented Homebrew or ownership receipts');
    }
  }
  const frozen = await read('candidate-verification.json');
  if (part) {
    const names = data ? Object.keys(data) : await fs.readdir(directory);
    const extraStages = [...new Set([...nativeWorkflowContract.stages,
      ...nativePlacementPhasesV9.phases.map(phase => phase.name),
      ...nativePlacementPhasesV10.phases.map(phase => phase.name)])]
      .filter(name => !stages.some(stage => stage.name === name) &&
        names.some(file => [name + '.json', name + '-command.json', name + '-settlement.json'].includes(file)));
    const extraProcedures = ['static', 'calculator'].filter(name => !part.procedures.includes(name) &&
      names.includes(`${name}.json`));
    const extraGo = !part.go && (data ? names.some(file => /^tools-[a-f0-9-]+\/go-tests\.json$/u.test(file)) :
      (await retainedToolReports(directory)).length > 0);
    if (extraStages.length || extraProcedures.length || extraGo) {
      complete = false;
      diagnostics.push({ stage: 'assignment', code: 'UNASSIGNED_NATIVE_EXECUTION',
        stages: extraStages, procedures: extraProcedures, go: extraGo });
    }
  }
  const smallContext = producerInputs(context, target, shardProtocol);
  const commandMatches = (command, args, expectedContext, { before, after } = {}) =>
    command?.kind === 'validation-command' && command.complete === true && command.exitCode === 0 &&
    command.node === `v${nativeToolchain.node}` && command.platform === platforms[target] &&
    command.architecture === context.native.architecture && Array.isArray(command.command) &&
    digest(command.command.slice(1)) === digest(args) &&
    (expectedContext === null ? command.context === null :
      command.context && digest(command.context) === digest(expectedContext)) &&
    Number.isFinite(Date.parse(command.startedAt)) && Number.isFinite(Date.parse(command.finishedAt)) &&
    Date.parse(command.startedAt) >= Date.parse(startedAt) &&
    Date.parse(command.finishedAt) >= Date.parse(command.startedAt) &&
    (before === undefined || Date.parse(command.finishedAt) <= Date.parse(before)) &&
    (after === undefined || Date.parse(command.startedAt) >= Date.parse(after));
  const originalStages = [];
  const originalCommands = [];
  const phaseSettlements = [];
  for (const stage of stages) {
    let declaredGroups = [];
    try {
      declaredGroups = validationExecutionGroups(inventory, {
        files: stage.files, pattern: stage.name === 'unit' ? undefined : stage.selectorName, preserveOrder: true,
      });
    } catch {
      diagnostics.push({ stage: stage.name, code: 'UNAVAILABLE_NATIVE_TIMING_DECLARATIONS' });
    }
    const coordinateStart = coordinateTimings.length;
    coordinateTimings.push(...declaredGroups.map(group => ({
      groupId: group.id, rootId: group.rootId, sourceDigest: group.sourceDigest,
      state: 0, startOffsetMs: null, endOffsetMs: null,
    })));
    const report = await read(`${stage.name}.json`);
    const command = await read(`${stage.name}-command.json`);
    if (!report || !command) {
      timingCoverageComplete = false;
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'MISSING_STAGE_REPORT' });
      continue;
    }
    if (!Array.isArray(report.executions) || !Array.isArray(command.command)) {
      timingCoverageComplete = false;
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'INVALID_PARTIAL_STAGE_REPORT' });
      continue;
    }
    const reconciliation = reconcileNodeExecution({ ...inventory, cases: stage.cases }, report,
      { platform: target, files: [...new Set(stage.cases.map(test => test.file))] });
    const expectedStageContext = stage.name === 'regression' || stage.kind === 'regression' ?
      context : producerInputs(context, target, shardProtocol);
    const expectedResources = context.native.toolchain.resources;
    const resources = report.resources;
    const budget = resources?.budget;
    const capacity = expectedResources?.workerCapacity;
    let groupCount = 0;
    let stageTimings = [];
    let phaseValid = true;
    try {
      const journal = data ? data.texts?.[`${stage.name}.json.journal.ndjson`] :
        await fs.readFile(path.join(directory, `${stage.name}.json.journal.ndjson`), 'utf8');
      const groups = validateNativeGroupReport({ inventory, stage, report, journal, target, schedulingPolicy });
      groupCount = groups.length;
      try { stageTimings = nativeGroupTimings(groups, report, startedAt, stage.name); }
      catch {
        timingCoverageComplete = false;
        diagnostics.push({ stage: stage.name, code: 'INVALID_NATIVE_TIMING_METADATA' });
      }
    } catch (error) {
      timingCoverageComplete = false;
      complete = false;
      diagnostics.push({ stage: stage.name, code: error.code ?? 'INVALID_ORIGINAL_GROUP_EXECUTION', message: error.message });
    }
    const resourcesMatch = count => {
      const fileConcurrency = Math.min(capacity, Math.max(1, count));
      return expectedResources && resources && budget &&
      nativeAffinityCapacityMatches(assignment, expectedResources, shard) &&
      resources.availableParallelism === expectedResources.availableParallelism &&
      resources.totalMemoryBytes === expectedResources.totalMemoryBytes &&
      resources.fileConcurrency === fileConcurrency && report.selection?.concurrency === fileConcurrency &&
      budget.version === 2 && budget.allocationPolicy === 'dynamic-ready-worker-tokens-v2' &&
      typeof budget.id === 'string' && /^[a-f0-9-]{36}$/u.test(budget.id) &&
      budget.capacity === capacity && budget.producerLimit === capacity * 2 + 1 &&
      budget.controlLimit === capacity * 2 + 1 && budget.orchestrationLimit === capacity * 4 + 2 &&
      budget.residentLimit === capacity * 3 &&
      [['peakActiveWorkers', capacity], ['peakResidentWorkers', capacity * 3],
        ['peakPotentialResidentWorkers', capacity * 3], ['peakProducers', capacity * 2 + 1],
        ['peakControls', capacity * 2 + 1]].every(([field, limit]) =>
        Number.isSafeInteger(budget[field]) && budget[field] >= 0 && budget[field] <= limit);
    };
    const resourceMatches = resourcesMatch(groupCount);
    try {
      requireThat(resourcesMatch(declaredGroups.length) &&
        // Check the original envelope independently of success; this never admits evidence or releases a phase.
        commandMatches({ ...command, complete: true, exitCode: 0 },
          ['scripts/test-runner.mjs', ...stage.args], expectedStageContext) &&
        typeof command.complete === 'boolean' &&
        Number.isSafeInteger(command.exitCode) && command.exitCode >= 0 && command.exitCode <= 255 &&
        (report.finishedAt === null || report.exitCode === command.exitCode) &&
        report.node === `v${nativeToolchain.node}` && report.platform === platforms[target] &&
        report.architecture === context.native.architecture &&
        digest(report.context ?? null) === digest(expectedStageContext) &&
        digest(report.files) === digest(stage.files) &&
        digest(report.selection?.namePatterns) === digest(stage.name === 'unit' ? [] : [stage.selectorName]) &&
        digest(report.selection?.skipPatterns ?? []) === digest([]) && report.selection?.coverage !== true &&
        Number.isFinite(Date.parse(report.startedAt)) &&
        Date.parse(report.startedAt) >= Date.parse(command.startedAt) &&
        (report.finishedAt === null || Number.isFinite(Date.parse(report.finishedAt)) &&
          Date.parse(report.finishedAt) >= Date.parse(report.startedAt) &&
          Date.parse(report.finishedAt) <= Date.parse(command.finishedAt)),
      'EVIDENCE', 'Diagnostic original command, selection, resource or source binding differs');
      const journal = data ? data.texts?.[`${stage.name}.json.journal.ndjson`] :
        await fs.readFile(path.join(directory, `${stage.name}.json.journal.ndjson`), 'utf8');
      const coordinates = nativeGroupCoordinates(inventory, declaredGroups, report, journal, startedAt, stage.name, schedulingPolicy);
      coordinateTimings.splice(coordinateStart, declaredGroups.length, ...coordinates);
    } catch {
      diagnostics.push({ stage: stage.name, code: 'UNAVAILABLE_NATIVE_TIMING_COORDINATES' });
    }
    if (stage.phase) {
      try {
        const journal = data ? data.texts?.[`${stage.name}-command.journal.ndjson`] :
          await fs.readFile(path.join(directory, `${stage.name}-command.journal.ndjson`), 'utf8');
        const expected = verifyNativePhaseSettlement({ stage, report, command, journal, capacity });
        const retained = await read(`${stage.name}-settlement.json`);
        const { observedAt, ...proof } = retained ?? {};
        requireThat(digest(proof) === digest(expected) &&
          Number.isFinite(Date.parse(observedAt)) && Date.parse(observedAt) >= Date.parse(command.finishedAt),
        'EVIDENCE', 'Native phase settlement receipt differs from its original command, report, phase or cleanup');
        phaseSettlements.push({ stage, observedAt });
      } catch (error) {
        phaseValid = false;
        complete = false;
        timingCoverageComplete = false;
        diagnostics.push({ stage: stage.name, code: 'INVALID_NATIVE_PHASE_SETTLEMENT', message: error.message });
      }
    }
    if (!resourceMatches) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'INVALID_ORIGINAL_RESOURCE_ALLOCATION' });
    }
    const invalidStage = reconciliation.status !== 'Passed' ||
        !commandMatches(command, ['scripts/test-runner.mjs', ...stage.args], expectedStageContext) ||
        report.node !== `v${nativeToolchain.node}` ||
        digest(report.context ?? null) !== digest(expectedStageContext) ||
        Date.parse(report.startedAt) < Date.parse(command.startedAt) ||
        Date.parse(report.finishedAt) > Date.parse(command.finishedAt) ||
        !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.finishedAt));
    if (invalidStage) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'INVALID_ORIGINAL_STAGE_COMMAND' });
    }
    if (!invalidStage && resourceMatches && phaseValid) timings.push(...stageTimings);
    else timingCoverageComplete = false;
    originalStages.push(report);
    originalCommands.push(command);
    diagnostics.push({ stage: stage.name, status: reconciliation.status, blockers: reconciliation.blockers,
      dispositions: reconciliation.dispositions });
    for (const code of [report.exitCode, command.exitCode]) {
      if (Number.isSafeInteger(code) && code >= 0 && code <= 255) exitCode ||= code;
      else { complete = false; diagnostics.push({ stage: stage.name, code: 'INVALID_ORIGINAL_EXIT_CODE' }); }
    }
    for (const { assertionId, observation: row } of reconciliation.cases) {
      if (!row) continue;
      const duration = Number.isFinite(row.durationMs) && row.durationMs >= 0 ? row.durationMs : null;
      if (duration === null) {
        complete = false;
        diagnostics.push({ stage: stage.name, code: 'INVALID_NODE_DURATION', id: assertionId });
      }
      observations.push({
        id: assertionId, status: duration === null ? 'NotRun' : row.status, observedAt: row.observedAt,
        durationMs: duration, detail: row.diagnostic?.message ?? row.skipReason ?? '',
      });
    }
  }
  if (originalStages.length !== stages.length || originalStages.some((report, index) =>
    index > 0 && !(Date.parse(originalStages[index - 1].finishedAt) <= Date.parse(report.startedAt)))) {
    timingCoverageComplete = false;
    complete = false;
    diagnostics.push({ stage: 'ordering', code: 'INVALID_UNIT_FIRST_ORDER' });
  }
  if (stages.some(stage => stage.phase) &&
    (phaseSettlements.length !== stages.filter(stage => stage.phase).length ||
      phaseSettlements.some(({ stage, observedAt }, index) => stage.phase.index !== index ||
        stage.phase.previous !== (index === 0 ? null : phaseSettlements[index - 1].stage.name) ||
        index > 0 && !(Date.parse(phaseSettlements[index - 1].observedAt) <=
          Date.parse(originalCommands[stages.indexOf(stage)]?.startedAt)) ||
        !Number.isFinite(Date.parse(observedAt))))) {
    complete = false;
    timingCoverageComplete = false;
    diagnostics.push({ stage: 'ordering', code: 'INVALID_NATIVE_PHASE_ORDER' });
  }
  for (const [name, args, expected] of [
    ['go-version', ['version'], context.native.toolchain.go],
    ['python-version', ['--version'], context.native.toolchain.python],
  ]) {
    const tools = nativeSdkRequirements({ inventory, plan, assignment, target, profile, component, shard, protocol: bootstrapProtocol });
    if (!tools[name === 'go-version' ? 'go' : 'python']) {
      requireThat(await read(`${name}.json`) === null, 'EVIDENCE',
        'Refresh-only SDK reports must be absent, never fabricated');
      continue;
    }
    const report = await read(`${name}.json`);
    if (!commandMatches(report, args, smallContext, {
      before: originalStages[0]?.startedAt ?? (component === 'homebrew' ? frozen?.observedAt : undefined),
    }) ||
        typeof report?.stdout !== 'string' || report.stdout.trim() !== expected) {
      complete = false;
      diagnostics.push({ stage: name, code: 'INVALID_ORIGINAL_SDK_PREFLIGHT' });
    }
  }
  const procedure = (name, status, observedAt, detail = '') => observations.push({
    id: `assertion-${digest(['procedure', name])}`, status, detail,
    observedAt, durationMs: 0,
  });
  if (component !== 'homebrew' && (part === undefined || part.go)) {
  const goReports = data ? Object.entries(data).filter(([file]) =>
    /^tools-[a-f0-9-]+\/go-tests\.json$/u.test(file)).map(([, value]) => value) : await retainedToolReports(directory);
  const go = nativeGoObservations(sources, goReports, target);
  const toolGroups = part ? originalStages.flatMap(report => report.groupExecution?.groups ?? [])
    .filter(group => group.rootId === assignment.goRootId) : [];
  if (part && toolGroups.length !== 1) {
    complete = false;
    diagnostics.push({ stage: 'go', code: 'MISSING_CAUSAL_GO_ROOT' });
  }
  if (goReports.length === 1 && (!commandMatches(goReports[0],
    ['test', '-json', '-count=1', './...'], null, {
      after: part ? toolGroups[0]?.startedAt : originalStages.at(-1)?.startedAt,
      before: part ? toolGroups[0]?.finishedAt : originalStages.at(-1)?.finishedAt,
    }) ||
    typeof goReports[0].cwd !== 'string' ||
    !/[\\/]cmd[\\/]sdlc-launcher[\\/]?$/u.test(goReports[0].cwd))) {
    complete = false;
    diagnostics.push({ stage: 'go', code: 'INVALID_ORIGINAL_GO_COMMAND' });
  }
  observations.push(...go.observations);
  if (go.status !== 'Passed') complete = false;
  diagnostics.push({ stage: 'go', status: go.status, blockers: go.blockers, dispositions: go.dispositions ?? [] });
  }
  if (component !== 'homebrew' && (part === undefined || part.procedures.includes('calculator'))) {
  const calculatorReport = await read('calculator.json');
  const calculatorCommand = await read('calculator-command.json');
  const calculatorNodeCommand = await read('calculator-node-command.json');
  const calculatorJournal = data ? data.texts?.['calculator.json.journal.ndjson'] :
    await fs.readFile(path.join(directory, 'calculator.json.journal.ndjson'), 'utf8')
      .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  let calculatorPassed = false;
  try {
    const expectedCalculator = calculatorSelection(inventory);
    const expectedFiles = calculatorProjectFiles(inventory);
    calculatorPassed = Array.isArray(calculatorSources) && calculatorSources.length === expectedFiles.length &&
      expectedFiles.every(file => calculatorSources.filter(source => source.file === file &&
        digest(source.contents) === expectedCalculator.find(test => test.file === file).sourceDigest).length === 1) &&
      reconcileCalculator(calculatorReport, expectedCalculator, calculatorJournal) &&
      calculatorReport.node === `v${nativeToolchain.node}` &&
      calculatorReport.platform === platforms[target] && calculatorReport.architecture === context.native.architecture &&
      digest(calculatorReport.context) === digest(context) &&
      commandMatches(calculatorNodeCommand, calculatorArguments(expectedCalculator), context,
        { after: calculatorCommand?.startedAt, before: calculatorCommand?.finishedAt }) &&
      commandMatches(calculatorCommand, ['scripts/pr-calculator.mjs', '--output',
        calculatorCommand?.command?.[3]], context, { after: originalStages.at(-1)?.finishedAt }) &&
      /(?:^|[\\/])calculator\.json$/u.test(calculatorCommand.command[3]) &&
      calculatorNodeCommand.stdout === calculatorJournal &&
      Date.parse(calculatorReport.startedAt) >= Date.parse(calculatorCommand.startedAt) &&
      Date.parse(calculatorReport.finishedAt) <= Date.parse(calculatorCommand.finishedAt);
  } catch (error) {
    diagnostics.push({ stage: 'calculator', code: error.code ?? 'INVALID_CALCULATOR_ORIGINAL', message: error.message });
  }
  procedure('calculator', calculatorPassed ? 'Passed' : 'NotRun', calculatorReport?.finishedAt ?? startedAt,
    digest(calculatorCapability(inventory)) === digest(calculatorBaselineCapability) ?
      'Independent calculator namespace: all 8 engine and 3 static assertions must execute; not framework assertion totals' :
      'Independent calculator namespace: every declared project assertion must execute; not framework assertion totals');
  if (!calculatorPassed) complete = false;
  }
  if (component !== 'homebrew' && (part === undefined || part.procedures.includes('static'))) {
  const staticReport = await read('static.json');
  const staticMatches = commandMatches(staticReport, ['scripts/check.mjs'], smallContext);
  procedure('static', staticMatches ? 'Passed' :
    staticReport?.complete ? 'Failed' : 'NotRun', staticReport?.finishedAt ?? startedAt,
    staticReport?.diagnostic ?? staticReport?.stderr ?? 'Static check did not complete');
  if (!staticMatches) complete = false;
  }
  const frozenMatches = frozen && Array.isArray(frozen.artifacts) &&
    digest(frozen.artifacts) === digest(context.artifacts) &&
    frozen.sourceCommit === context.sources[0].revision && Number.isFinite(Date.parse(frozen.observedAt));
  procedure('frozen-artifacts', frozenMatches ? 'Passed' : 'NotRun', frozen?.observedAt ?? startedAt,
    frozenMatches ? '' : 'Original frozen-artifact verification is missing or mismatched');
  if (!frozenMatches) complete = false;
  if (target.startsWith('macos-') && component !== 'framework') {
    const homebrew = await read('native-homebrew.json');
    const homebrewCommand = await read('homebrew-command.json');
    let passed = false;
    const argumentsValid = Array.isArray(homebrewCommand?.command) &&
      homebrewCommand.command.length === (component === 'full' ? 13 : 15) &&
      homebrewCommand.command.every(argument => typeof argument === 'string');
    const script = argumentsValid ? homebrewCommand.command[1] : null;
    const homebrewArgs = typeof script === 'string' && /(?:^|[\\/])scripts[\\/]native-validation\.mjs$/u.test(script) ?
      [script, 'homebrew', '--target', target, '--profile', profile, '--candidate-dir',
        homebrewCommand.command[8], '--evidence-dir', homebrewCommand.command[10], '--build-candidate', 'false',
        ...(component === 'full' ? [] : ['--component', component])] : [];
    if (candidate && homebrewArgs.length && commandMatches(homebrewCommand, homebrewArgs, context,
      { after: originalStages.at(-1)?.finishedAt ?? frozen?.observedAt })) {
      try {
        const { validateNativeHomebrewEvidence } = await import('./release-gate.mjs');
        requireThat(typeof validateNativeHomebrewEvidence === 'function',
          'EVIDENCE', 'Native Homebrew evidence validator is unavailable');
        validateNativeHomebrewEvidence(homebrew, { candidate, targetArch: context.native.architecture,
          mode: 'candidate', expectedNodeVersion: nativeToolchain.node });
        passed = true;
      } catch (error) {
        diagnostics.push({ stage: 'native-homebrew', code: error.code ?? 'INVALID_HOMEBREW_EVIDENCE',
          message: error.message });
      }
    }
    procedure('native-homebrew', passed ? 'Passed' : 'NotRun',
      homebrew?.observedAt ?? startedAt,
      passed ? 'Actual isolated native Homebrew audit/style/lifecycle' : 'Required Homebrew lifecycle is incomplete or unavailable');
    if (!passed) complete = false;
  }
  if (profile === 'r-pre' && target === 'windows-x64') {
    const previous = await read('native-previous-current.json');
    let passed = false;
    try {
      validateNativePreviousLifecycle(previous, { candidate, target });
      const commandNames = (data ? Object.keys(data) : await fs.readdir(directory))
        .filter(name => /^previous-current-[1-9]\d*\.json$/u.test(name))
        .sort((left, right) => Number(/\d+/u.exec(left)[0]) - Number(/\d+/u.exec(right)[0]));
      const commands = await Promise.all(commandNames.map(read));
      requireThat(commandNames.length >= 2 &&
        commandNames.every((name, index) => name === `previous-current-${index + 1}.json`) &&
        commands.every(command => Array.isArray(command?.command) &&
          command.command.every(argument => typeof argument === 'string') &&
          commandMatches(command, command.command.slice(1), context, {
            after: originalStages.at(-1)?.finishedAt, before: previous.observedAt,
          })) &&
        commands.some(command => /(?:^|[\\/])powershell\.exe$/iu.test(command.command[0]) &&
          digest(command.command.slice(1, 4)) === digest(['-NoProfile', '-NonInteractive', '-File'])) &&
        commands.some(command => /(?:^|[\\/])cmd\.exe$/iu.test(command.command[0]) &&
          digest(command.command.slice(1, 4)) === digest(['/d', '/s', '/c'])),
      'EVIDENCE', 'Original actual PowerShell/cmd prior-current commands are missing, failed or source/time mismatched');
      passed = true;
    }
    catch (error) {
      diagnostics.push({ stage: 'native-previous-current', code: error.code ?? 'EVIDENCE', message: error.message });
    }
    procedure('native-previous-current', passed ? 'Passed' : 'NotRun', previous?.observedAt ?? startedAt);
    if (!passed) complete = false;
  }
  const results = specification.cases.flatMap(test => test.assertions.flatMap(assertion => {
    const matching = observations.filter(row => row.id === assertion.id);
    if (matching.length !== 1) {
      complete = false;
      diagnostics.push({ stage: 'assertion', id: assertion.id, code: 'MISSING_OR_DUPLICATE_NATIVE_ASSERTION' });
      return [];
    }
    const row = matching[0];
    return [{ testId: test.id, assertionId: assertion.id, selector: assertion.selector,
      status: row.status, expectedMet: row.status === 'Passed' ? true : row.status === 'Failed' ? false : null,
      expectedDigest: test.expectedDigest, checkpoint: test.checkpoint, observedAt: row.observedAt,
      sourceSequence: 1, durationMs: row.durationMs, exitCode: row.status === 'Failed' ? 1 : 0,
      ...(row.detail === undefined || row.detail === '' ? {} : { detail: row.detail }) }];
  }));
  const observedAt = observations.reduce((latest, row) => Number.isFinite(Date.parse(row.observedAt)) &&
    Date.parse(row.observedAt) > Date.parse(latest) ? row.observedAt : latest, startedAt);
  const raw = { schemaVersion: 1, kind: 'test-execution', context, startedAt,
    finishedAt: complete ? observedAt : null, observedAt, sequence: 1, complete,
    exitCode: complete ? exitCode : exitCode || 2, results };
  return { raw, diagnostics, timings, timingCoverageComplete, coordinateTimings };
}

export function reconcileNativeEvidenceData(options) {
  requireThat(options.data && Object.getPrototypeOf(options.data) === Object.prototype,
    'EVIDENCE', 'Data-only reconciliation requires the complete original report dictionary');
  return collectExecution(options);
}

export function validateNativePreviousLifecycle(report, { candidate, target }) {
  const selected = candidate?.context?.previousRelease;
  const descriptor = report?.previousMetadata?.descriptor;
  const checksums = report?.previousMetadata?.checksums;
  requireThat(selected && report?.status === 'Passed' && report.kind === 'frozen-candidate' &&
    report.publicAcceptance === 'NotRun' && report.nativePlatform === platforms[target] &&
    report.nativeArchitecture === target.split('-')[1] && report.upgradeKind === 'version' &&
    report.previousIdentity?.version === selected.version &&
    report.previousIdentity.descriptorSha256 === selected.descriptorSha256 &&
    report.previousIdentity.checksumsSha256 === selected.checksumsSha256 &&
    report.currentIdentity && digest(report.currentIdentity) === digest(candidate.context.identity) &&
    Array.isArray(report.shells) && report.shells.length === 2 &&
    ['powershell', 'cmd'].every(mode => report.shells.some(shell => shell &&
      shell.shell === mode && shell.status === 'Passed' && shell.upgradeKind === 'version' &&
      shell.previousVersion === selected.version && shell.version === candidate.context.identity.version)) &&
    report.previousIdentity.version !== report.currentIdentity.version &&
    descriptor && Array.isArray(descriptor.files) && descriptor.payload &&
    typeof checksums === 'string' && digest(Buffer.from(releaseCanonical(descriptor))) === selected.descriptorSha256 &&
    digest(Buffer.from(checksums)) === selected.checksumsSha256 &&
    renderChecksums(descriptor, Buffer.from(releaseCanonical(descriptor))) === checksums &&
    descriptor.version === report.previousIdentity.version &&
    descriptor.sourceCommit === report.previousIdentity.sourceCommit &&
    descriptor.payload.sha256 === report.previousIdentity.payloadSha256 &&
    Number.isFinite(Date.parse(report.observedAt)),
  'EVIDENCE', 'Actual Windows supported-previous/current lifecycle is missing, mismatched or incomplete');
  return report;
}

export function evaluateNativeExecution(specification, raw) {
  const context = validateExecutionContext(raw.context);
  const normalized = normalizeExecutionReport(raw, context, input => ({
    verifierId: 'native-process-host', reportDigest: input.reportDigest, context,
    sourceTime: raw.observedAt, sourceSequence: raw.sequence,
  }));
  return evaluateReadiness(specification, [normalized], {
    profile: specification.profile, executions: [{ id: context.jobRef, context }],
    now: new Date().toISOString(), policy: {
      maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact', verifierIds: ['native-process-host'],
    },
  });
}

export async function captureNativeDefinitionInputs({ target, profile, component = 'full', shard = null,
  shardProtocol = nativeFrameworkShardProtocol }) {
  requireThat(validationPlatforms.includes(target) && ['pr', 'r-pre'].includes(profile),
    'INPUT', 'Definition capture needs the explicit native profile and target');
  requireThat(/^[1-9]\d*$/u.test(process.env.GITHUB_REPOSITORY_ID ?? ''),
    'HOST', 'Definition capture requires the independently selected provider repository ID');
  await assertCommittedNativeInputs();
  const sourceRevision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
  const treeSha = (await execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot })).stdout.trim();
  const tree = (await execute('git', ['ls-tree', '-r', '-z', 'HEAD'],
    { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const files = [];
  for (const row of tree.split('\0').filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/u.exec(row);
    if (!match || !/^(?:test|src|scripts|cmd|packaging|assets|docs|bin|\.github\/(?:workflows|actions))\//u.test(match[3]) &&
        !['package.json', '.github/release-requirements.txt'].includes(match[3])) continue;
    requireThat(['100644', '100755'].includes(match[1]), 'EVIDENCE',
      'Native definitions cannot retain linked executable source');
    const selected = path.join(repositoryRoot, ...match[3].split('/'));
    const stat = await fs.lstat(selected);
    requireThat(stat.isFile() && !stat.isSymbolicLink(), 'EVIDENCE',
      'Captured source definitions must be literal committed files');
    const bytes = await fs.readFile(selected);
    const blob = createHash(match[2].length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    requireThat(blob === match[2], 'EVIDENCE',
      `Captured source ${match[3]} differs from its exact committed byte identity`);
    let contents;
    try { contents = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch (error) {
      if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
      continue;
    }
    files.push({ file: match[3], contents });
  }
  const sourceFiles = files.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
  const selectedWorkersRequest = process.env.SDLC_TEST_WORKERS ?? null;
  requireThat(sourceValidationSchedulingPolicy(sourceFiles) === validationSchedulingPolicy,
    'EVIDENCE', 'Live native capture must use only the current committed scheduling policy');
  const inputs = compileNativeDefinition({ target, profile, component, shard, shardProtocol, sourceFiles, selectedWorkersRequest });
  const definition = { schemaVersion: 1, kind: 'native-validation-definition', target, profile, sourceFiles,
    ...(component === 'full' ? {} : { component }),
    ...(shard === null ? {} : { shard, frameworkShards: shardProtocol }),
    selectedWorkersRequest, ...inputs, source: { revision: sourceRevision, treeSha,
      repositoryId: `repository-${process.env.GITHUB_REPOSITORY_ID}` } };
  requireThat(Buffer.byteLength(canonical(definition)) <= 64 * 1024 * 1024, 'CAPACITY',
    'Exact native definitions exceed their bounded source-archive budget');
  return definition;
}

function* nativeSourceLiteralViews(contents, file, tokens = declarationTokens(contents)) {
  for (const [index, literal] of tokens.entries()) {
    const previous = tokens[index - 1];
    const before = tokens[index - 2];
    const propertyAccess = before?.kind === 'punctuation' && before.value === '.';
    // Block/expression braces and contextual bindings need parser state beyond this declaration lexer.
    const ambiguousSlash = literal.kind === 'punctuation' && literal.value === '/' &&
      (previous?.kind === 'punctuation' && previous.value === '}' ||
        previous?.kind === 'identifier' && ['await', 'yield', 'of'].includes(previous.value) &&
          !propertyAccess);
    requireThat(!ambiguousSlash, 'UNSAFE',
      `Exact source ${file} contains an ambiguous JavaScript slash context; no source bytes were archived`);
    if (literal.kind === 'string') {
      nativeSourceCanonicalValue(literal.value, file, { strict: false });
      const span = contents.slice(literal.start + 1, literal.end - 1);
      const trimmed = span.replace(/(?<!\\)[\t\n\r ]+$/u, '');
      const text = trimmed === span ? literal.value :
        decodeString(contents[literal.start] + trimmed + contents[literal.start]);
      yield { text, referenceText: literal.value, kind: literal.kind, expressions: [] };
      continue;
    }
    if (literal.kind !== 'template') continue;
    // Await/yield can be CommonJS bindings; only unescaped module operators are excluded here.
    const keyword = previous?.kind === 'identifier' && !propertyAccess &&
      contents.slice(previous.start, previous.end) === previous.value &&
      (['return', 'throw', 'case', 'typeof', 'void', 'delete', 'new', 'in', 'instanceof'].includes(previous.value) ||
        file.endsWith('.mjs') && ['await', 'yield'].includes(previous.value));
    const tagged = previous && (['string', 'template', 'regex'].includes(previous.kind) ||
      previous.kind === 'identifier' && !keyword ||
      [')', ']', '}'].includes(previous.value));
    // Tags can consume raw or cooked spans; even a familiar tag name is not an authority exception.
    for (const raw of tagged ? [false, true] : [false]) {
      let text = '';
      let offset = literal.start + 1;
      const expressions = [];
      const inspect = (start, end, terminal = false) => {
        const span = contents.slice(start, end).replace(/\r\n?/gu, '\n');
        const value = raw ? span : decodeString('`' + span + '`');
        nativeSourceCanonicalValue(value, file, { strict: false });
        // Preserve existing source padding boundaries, never discard whitespace produced by an escape.
        const trimmed = terminal ? span.replace(/(?<!\\)[\t\n\r ]+$/u, '') : span;
        return trimmed === span ? value : raw ? trimmed : decodeString('`' + trimmed + '`');
      };
      for (const span of literal.interpolations) {
        text += inspect(offset, span.start);
        expressions.push({ start: text.length, end: text.length + 1 });
        text += '0';
        offset = span.end;
      }
      text += inspect(offset, literal.end - 1, true);
      yield { text, kind: literal.kind, expressions };
    }
    for (const span of literal.interpolations) {
      yield* nativeSourceLiteralViews(contents.slice(span.start + 2, span.end - 1), file);
    }
  }
}

// Map surviving URL characters back to literal spans instead of dropping credential value bytes.
function nativeSourceUrlView(value) {
  const removed = [];
  for (const match of value.matchAll(/[\t\n\r]/gu)) removed.push(match.index - removed.length);
  const text = value.replace(/[\t\n\r]/gu, '');
  const originalOffset = offset => {
    let low = 0;
    let high = removed.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (removed[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return offset + low;
  };
  return { text, originalOffset };
}

function* nativeSourceUrlReferences(contents, file, tokens) {
  // Alternate JavaScript spellings belong to lexer-owned literals, not regex source or arbitrary code.
  for (const match of contents.matchAll(tokens ? /https?:\/\//giu : /https?:/giu)) {
    if (tokens && sourceLiteralAt(contents, match.index, tokens)) continue;
    const text = /^[^\s<>]*/u.exec(contents.slice(match.index))[0];
    yield { text, sourceText: text, originalOffset: offset => offset, expressions: [] };
  }
  if (!tokens) return;
  for (const view of nativeSourceLiteralViews(contents, file, tokens)) {
    const inspected = nativeSourceUrlView(view.text);
    for (const match of inspected.text.matchAll(/https?:/giu)) {
      const start = inspected.originalOffset(match.index);
      const reference = view.kind === 'string' ?
        /^<([^<>\s]+)>(?:\s*;\s*[A-Za-z][A-Za-z0-9-]*=(?:"[^"]*"|[^\s,;]+))*$/u.exec(view.referenceText) : null;
      const text = reference && start === 1 ? reference[1] : inspected.text.slice(match.index);
      const sourceText = reference && start === 1 ? reference[1] : view.text.slice(start);
      const expressions = view.expressions.filter(span => span.start >= start)
        .map(span => ({ start: span.start - start, end: span.end - start }));
      yield { text, sourceText, expressions,
        originalOffset: offset => inspected.originalOffset(match.index + offset) - start };
    }
  }
}

function nativeSourceCredentialValues(contents, file) {
  const credentials = [];
  const tokens = /\.[cm]?js$/u.test(file) ? declarationTokens(contents) : null;
  for (const { text, sourceText, expressions, originalOffset } of nativeSourceUrlReferences(contents, file, tokens)) {
    nativeSourceCanonicalValue(text, file);
    if (sourceText !== text) nativeSourceCanonicalValue(sourceText, file);
    const overlapping = (start, end) => expressions.filter(expression =>
      expression.start < end && expression.end > start);
    const retain = (value, start, end, identity = false) => {
      const selected = overlapping(start, end);
      credentials.push({ value, expression: selected.length === 1 &&
        selected[0].start === start && selected[0].end === end, composite: selected.length > 0 &&
        !(selected.length === 1 && selected[0].start === start && selected[0].end === end), identity });
    };
    // HTTP special schemes accept zero or more slash/backslash separators without a base URL.
    const authorityStart = /^https?:[/\\]*/iu.exec(text)[0].length;
    const authorityEnd = text.slice(authorityStart).search(/[/\\?#]/u);
    const authority = text.slice(authorityStart, authorityEnd < 0 ? text.length : authorityStart + authorityEnd);
    const userinfoEnd = authority.lastIndexOf('@');
    const separator = authority.slice(0, userinfoEnd < 0 ? 0 : userinfoEnd).indexOf(':');
    if (userinfoEnd >= 0) {
      const start = originalOffset(authorityStart - 1) + 1;
      const end = originalOffset(authorityStart + (separator < 0 ? userinfoEnd : separator));
      const username = nativeSourceCanonicalValue(sourceText.slice(start, end), file);
      retain(username, start, end, true);
    }
    if (separator >= 0) {
      const start = originalOffset(authorityStart + separator) + 1;
      const end = originalOffset(authorityStart + userinfoEnd);
      const password = nativeSourceCanonicalValue(sourceText.slice(start, end), file);
      retain(password, start, end);
    }
    const fragment = text.indexOf('#');
    const query = text.indexOf('?');
    const fields = [];
    if (query >= 0 && (fragment < 0 || query < fragment)) {
      fields.push({ start: query + 1, end: fragment < 0 ? text.length : fragment });
    }
    if (fragment >= 0) fields.push({ start: fragment + 1, end: text.length });
    for (const field of fields) {
      let offset = field.start;
      for (const parameter of text.slice(offset, field.end).split('&')) {
        const equals = parameter.indexOf('=');
        const keyEnd = offset + (equals < 0 ? parameter.length : equals);
        const name = nativeSourceCanonicalValue(parameter.slice(0, keyEnd - offset), file, { form: true });
        const valueEnd = originalOffset(offset + parameter.length);
        // Structural normalization cannot shorten a credential or impersonate a genuine expression span.
        const valueStart = equals < 0 ? valueEnd : originalOffset(keyEnd) + 1;
        const value = nativeSourceCanonicalValue(sourceText.slice(valueStart, valueEnd), file, { form: true });
        if (isCredentialQueryKey(name) ||
            overlapping(originalOffset(offset), originalOffset(keyEnd)).length > 0) {
          retain(value, valueStart, valueEnd);
        }
        offset += parameter.length + 1;
      }
    }
  }
  return credentials;
}

function validateNativeSourceSecretMaterial(contents, file) {
  const credential = /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255})(?![A-Za-z0-9_])/u;
  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*(?:[A-Za-z0-9+/=]{32,}\s*)+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u;
  requireThat(!credential.test(contents) && !privateKey.test(contents), 'UNSAFE',
    `Exact source ${file} contains credential-shaped material; no source bytes were redacted or archived`);
  for (const match of contents.matchAll(/(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/gu)) {
    let header;
    try { header = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    requireThat(!header || typeof header !== 'object' || typeof header.alg !== 'string', 'UNSAFE',
      `Exact source ${file} contains a literal credential-shaped JWT; no source bytes were redacted or archived`);
  }
}

function nativeSourceCanonicalValue(value, file, { form = false, strict = true } = {}) {
  let current = form ? value.replaceAll('+', ' ') : value;
  validateNativeSourceSecretMaterial(current, file);
  // Inspection views only shrink; cap decoding independently of the existing source byte budgets.
  for (let depth = 0; current.includes('%'); depth++) {
    requireThat(depth < 8, 'UNSAFE', `Exact source ${file} contains over-nested credential encoding`);
    let decoded;
    try {
      decoded = strict ? decodeURIComponent(current) :
        new URLSearchParams('material=' + current.replaceAll('&', '%26').replaceAll('+', '%2B')).get('material');
    }
    catch (error) {
      if (!(error instanceof URIError)) throw error;
      requireThat(false, 'UNSAFE', `Exact source ${file} contains an invalid credential value`);
    }
    validateNativeSourceSecretMaterial(decoded, file);
    if (decoded === current || !/%[A-Fa-f0-9]{2}/u.test(decoded)) return decoded;
    current = decoded;
  }
  return current;
}

export function validateNativeSourceDefinitions(sourceFiles) {
  requireThat(Array.isArray(sourceFiles) && sourceFiles.length > 0 && sourceFiles.length <= 10000 &&
    sourceFiles.every(source => source && Object.getPrototypeOf(source) === Object.prototype &&
      Object.keys(source).length === 2 && Object.keys(source).every(key => ['file', 'contents'].includes(key)) &&
      typeof source.file === 'string' && !/[:\\\u0000-\u001f]/u.test(source.file) &&
      source.file.split('/').every(part => part && part !== '.' && part !== '..') &&
      typeof source.contents === 'string' && Buffer.byteLength(source.contents) <= 4 * 1024 * 1024 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source.contents)) &&
    new Set(sourceFiles.map(source => source.file)).size === sourceFiles.length &&
    sourceFiles.reduce((total, source) => total + Buffer.byteLength(source.contents), 0) <= 64 * 1024 * 1024,
  'EVIDENCE', 'Native source definitions must retain bounded distinct literal UTF-8 source bytes');
  for (const { file, contents } of sourceFiles) {
    nativeSourceCanonicalValue(contents, file, { strict: false });
    for (const { value, expression, composite, identity } of nativeSourceCredentialValues(contents, file)) {
      validateNativeSourceSecretMaterial(value, file);
      requireThat(identity || !composite && (!value || expression || nativeSourceDummyValues.includes(value)), 'UNSAFE',
        `Exact source ${file} contains a credential-bearing URL; no source bytes were redacted or archived`);
    }
  }
  return sourceFiles;
}

function compileNativeDefinition({ target, profile, sourceFiles, selectedWorkersRequest = null,
  component = 'full', shard = null, frameworkShards,
  shardProtocol = frameworkShards ?? nativeFrameworkShardProtocol }) {
  validateNativeSourceDefinitions(sourceFiles);
  if (shard !== null) requireThat(sourceNativeFrameworkShardProtocol(sourceFiles) === shardProtocol,
    'EVIDENCE', 'Archived shard protocol differs from its original native planner source');
  const schedulingPolicy = sourceValidationSchedulingPolicy(sourceFiles);
  const bootstrapProtocol = sourceNativeBootstrapProtocol(sourceFiles);
  const paths = sourceFiles.map(source => source.file);
  const selected = new Set(validationSourcePaths(paths));
  const inventory = compileValidationSourceInventory({
    files: sourceFiles.filter(source => selected.has(source.file)), surfacePaths: paths,
  });
  requireThat(inventory.complete, 'INVENTORY', 'Original source definitions do not compile a complete native inventory');
  const goSources = sourceFiles.filter(source => /^cmd\/sdlc-launcher\/[^/]+_test\.go$/u.test(source.file))
    .map(source => ({ file: path.posix.basename(source.file), contents: source.contents }));
  const plan = sourceFiles.find(source => source.file === 'docs/sdlc/public-readiness/test-plan.md')?.contents;
  requireThat(typeof plan === 'string', 'EVIDENCE', 'The original native Test Plan bytes are required');
  const specification = nativeSpecification({ plan, inventory, goSources, target, profile, component, shard, shardProtocol, schedulingPolicy });
  const assignment = shard === null ? null : nativeFrameworkShardPlan({ inventory, plan, target, protocol: shardProtocol, schedulingPolicy });
  const calculatorSources = sourceFiles.filter(source => calculatorProjectFiles(inventory).includes(source.file));
  calculatorSelection(inventory);
  return { plan, inventory, goSources, calculatorSources, specification,
    ...(bootstrapProtocol === null ? {} : { bootstrapProtocol }),
    stages: assignment ? assignment.parts.find(part => part.shard === shard).stages :
      component === 'homebrew' ? [] : nativeStageSelections(inventory, plan, schedulingPolicy),
    configDigest: nativeConfigurationDigest({ inventory, plan, assignment, profile, target, component, shard, shardProtocol, bootstrapProtocol,
      shardPlanDigest: assignment?.digest ?? null, configuredWorkers: selectedWorkersRequest, schedulingPolicy }),
    testSpecDigest: testSpecificationDigest(plan), inventoryDigest: validationInventoryDigest(specification) };
}

export async function replayNativeEvidence({ definition, data, candidate, asOf, verifyArchive }) {
  const fields = ['schemaVersion', 'kind', 'target', 'profile', 'sourceFiles', 'selectedWorkersRequest',
    'component', 'shard', 'frameworkShards', 'bootstrapProtocol',
    'plan', 'inventory', 'goSources', 'calculatorSources', 'specification', 'stages', 'configDigest', 'testSpecDigest',
    'inventoryDigest', 'source'];
  requireThat(definition && Object.getPrototypeOf(definition) === Object.prototype &&
    Object.keys(definition).every(field => fields.includes(field)) &&
    definition.schemaVersion === 1 && definition.kind === 'native-validation-definition' &&
    (definition.shard === undefined ? definition.frameworkShards === undefined :
      nativeFrameworkShardProtocols.includes(definition.frameworkShards)) &&
    validationPlatforms.includes(definition.target) && ['pr', 'r-pre'].includes(definition.profile) &&
    /^[a-f0-9]{40}$/u.test(definition.source?.revision ?? '') &&
    /^[a-f0-9]{40}$/u.test(definition.source?.treeSha ?? '') &&
    /^repository-[1-9]\d*$/u.test(definition.source?.repositoryId ?? '') &&
    Object.keys(definition.source).length === 3 &&
    Object.keys(definition.source).every(field => ['revision', 'treeSha', 'repositoryId'].includes(field)) &&
    typeof asOf === 'string' && Number.isFinite(Date.parse(asOf)) && typeof verifyArchive === 'function',
  'EVIDENCE', 'Historical native replay requires archived definitions, an explicit as-of clock and an in-process archive verifier');
  const inputs = compileNativeDefinition(definition);
  const schedulingPolicy = sourceValidationSchedulingPolicy(definition.sourceFiles);
  const assignment = definition.shard === undefined ? null : nativeFrameworkShardPlan({
    inventory: inputs.inventory, plan: inputs.plan, target: definition.target,
    protocol: definition.frameworkShards, schedulingPolicy,
  });
  requireThat((definition.bootstrapProtocol ?? null) === (inputs.bootstrapProtocol ?? null),
    'EVIDENCE', 'Archived bootstrap capability differs from its original source declaration');
  requireThat(['plan', 'inventory', 'goSources', 'calculatorSources', 'specification', 'stages', 'configDigest',
    'testSpecDigest', 'inventoryDigest'].every(key => Object.hasOwn(definition, key) &&
      digest(inputs[key]) === digest(definition[key])),
  'EVIDENCE', 'Archived native definitions differ from their recompiled original source bytes');
  const raw = data?.['execution.json'];
  const claimedContext = validateExecutionContext(raw?.context);
  const definitionDigest = digest(definition);
  requireThat(typeof data?.texts?.['execution.json'] === 'string' &&
    digest(parseOriginal(data.texts['execution.json'])) === digest(raw), 'EVIDENCE',
  'Historical native replay needs the exact original execution bytes');
  const reportDigest = digest(data.texts['execution.json']);
  const verified = await verifyArchive({ definitionDigest, reportDigest,
    candidateIdentity: candidate?.context?.identity, claimedContext, asOf });
  requireThat(verified && typeof verified.verifierId === 'string' && verified.verifierId &&
    verified.definitionDigest === definitionDigest && verified.reportDigest === reportDigest &&
    digest(verified.context) === digest(claimedContext) &&
    verified.sourceTime === raw.observedAt && verified.sourceSequence === raw.sequence,
  'EVIDENCE', 'The authenticated archive verifier did not establish the original producer/context/bytes');
  const context = validateExecutionContext(verified.context);
  const bootstrap = data['toolchain.json'];
  requireNativeBootstrapCapability({ bootstrap, target: definition.target, profile: definition.profile,
    inventory: inputs.inventory, plan: inputs.plan, assignment,
    shardProtocol: definition.frameworkShards,
    component: definition.component ?? 'full', shard: definition.shard ?? null,
    protocol: inputs.bootstrapProtocol ?? null });
  requireThat(nativeContextMatches(context, { inventory: inputs.inventory, plan: inputs.plan, assignment, schedulingPolicy,
    shardProtocol: definition.frameworkShards,
    target: definition.target, profile: definition.profile,
    component: definition.component,
    shard: definition.shard,
    sourceRevision: definition.source.revision, artifacts: nativeArtifacts(candidate),
    bootstrapProtocol: inputs.bootstrapProtocol ?? null }) &&
    context.candidateDigest === digest({ revision: definition.source.revision, tree: definition.source.treeSha }) &&
    context.sources[0].contentDigest === digest(definition.source.treeSha) &&
    context.sources[0].repositoryId === definition.source.repositoryId &&
    context.configDigest === inputs.configDigest && context.testSpecDigest === inputs.testSpecDigest &&
    context.inventoryDigest === inputs.inventoryDigest &&
    bootstrap?.status === 'Passed' && bootstrap.target === definition.target && bootstrap.native &&
    digest(context.native.toolchain.bootstrap) === digest(bootstrap.native), 'EVIDENCE',
  'Authenticated historical context differs from the original source/specification/configuration/artifact definitions');
  const reconstructed = await reconcileNativeEvidenceData({ ...inputs, sources: inputs.goSources, data,
    target: definition.target, profile: definition.profile, context, candidate, startedAt: raw.startedAt,
    shardProtocol: definition.frameworkShards ?? nativeFrameworkShardProtocol, schedulingPolicy });
  requireThat(digest(reconstructed.raw.results) === digest(raw.results) &&
    reconstructed.raw.observedAt === raw.observedAt && reconstructed.raw.complete === raw.complete &&
    reconstructed.raw.exitCode === raw.exitCode, 'EVIDENCE',
  'Historical execution does not reconcile with every original command/assertion outcome');
  const normalized = normalizeExecutionReport(raw, context, () => ({
    verifierId: verified.verifierId, reportDigest, context,
    sourceTime: verified.sourceTime, sourceSequence: verified.sourceSequence,
  }));
  const evaluation = evaluateReadiness(inputs.specification, [normalized], {
    profile: inputs.specification.profile,
    executions: [{ id: `native-${nativeProducerRole(definition.target, definition.component, definition.shard)}`, context }],
    now: asOf, policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact',
      verifierIds: [verified.verifierId] },
  });
  return { evaluation, context, artifacts: context.artifacts, sourceCommit: definition.source.revision,
    diagnostics: reconstructed.diagnostics, historical: true, evaluatedAsOf: asOf, currentCredit: 'NotRun' };
}

function parseOriginal(text) {
  try { return JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    requireThat(false, 'EVIDENCE', 'Archived original execution contains malformed JSON');
  }
}

function producerInputs(context, target, shardProtocol = nativeFrameworkShardProtocol) {
  const component = componentFromContext(context, target);
  const shard = shardFromContext(context, target);
  return { schemaVersion: 1, sourceCommit: context.sources[0].revision, target,
    profile: context.profile.startsWith('r-pre-') ? 'r-pre' : 'pr',
    ...(component === 'full' ? {} : { component }), workflowRef: context.producer.definitionRef,
    ...(shard === null ? {} : { frameworkShards: shardProtocol, shard,
      configDigest: context.configDigest, inventoryDigest: context.inventoryDigest }),
    repositoryId: context.sources[0].repositoryId, runId: context.producer.executionRef,
    attempt: context.producer.attemptRef };
}

export async function writeNativeReadinessBundle(file, evaluation) {
  // The SDK validates each bounded object; its paged container is not one retained object.
  await writeCanonicalJson(file, canonical(createEvidenceBundle(evaluation)));
}

export async function finalizeNativeEvidence({ directory, inventory, sources, calculatorSources, target, stages,
  context, specification, startedAt, candidate, plan, failure = null, cancelled = false, completeReportRef,
  shardProtocol = nativeFrameworkShardProtocol, bootstrapProtocol = null }) {
  const collected = await collectExecution({ directory, inventory, sources, calculatorSources, target, stages,
    context, specification, startedAt, candidate, plan, shardProtocol, bootstrapProtocol });
  if (failure || cancelled) {
    collected.raw.complete = false;
    collected.raw.finishedAt = null;
    collected.raw.exitCode ||= 2;
  }
  const retainedRaw = safe(collected.raw);
  await writeJson(path.join(directory, 'execution.json'), retainedRaw);
  const evaluation = evaluateNativeExecution(specification, retainedRaw);
  await writeNativeReadinessBundle(path.join(directory, 'readiness-bundle.json'), evaluation);
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('`', '&#96;').replaceAll('\r', '').replaceAll('\n', ' ');
  const markdown = `# Native execution identity\n\n` +
    (componentFromContext(context, target) === 'full' ? '' :
      `PR producer part: **${escape(componentFromContext(context, target))}` +
      `${shardFromContext(context, target) === null ? '' : '/' + escape(shardFromContext(context, target))}**. ` +
      `This report alone does not establish complete platform readiness; every required part must match.\n\n`) +
    `- Source: \`${context.sources[0].revision}\`\n` +
    `- Native host: ${escape(context.native.platform)} / ${escape(context.native.architecture)}; image ${escape(context.native.image)}\n` +
    `- Run: ${escape(context.producer.executionRef)}; attempt ${escape(context.producer.attemptRef)}; job ${escape(context.jobRef)}\n` +
    `- Frozen artifacts: ${context.artifacts.length}; descriptor \`${context.artifacts.find(file => file.name === 'frozen-descriptor')?.sha256 ?? 'NotRun'}\`\n\n` +
    `Non-applicable assertion dispositions: ${collected.diagnostics.reduce((count, row) =>
      count + (row.dispositions?.length ?? 0), 0)} (NotRun, never counted as Passed). ` +
    `Their owners, reasons and raw skips remain in producer.json and the complete original reports.\n\n` +
    renderReadinessReport(evaluation, { completeReportRef });
  await fs.writeFile(path.join(directory, 'readiness.md'), markdown, { flag: 'wx' });
  const producer = collected.raw.complete ? 'completed' : 'partial';
  let timing = nativeTimingDiagnostics(collected.timings, { producer, complete: collected.timingCoverageComplete,
    startedAt: retainedRaw.startedAt, finishedAt: retainedRaw.finishedAt });
  let timingOptions;
  try {
    timingOptions = {
      source: digest(context.sources),
      selection: nativeTimingSelectionDigest({ source: digest(context.sources),
        runId: context.producer.executionRef, attempt: context.producer.attemptRef,
        target, component: componentFromContext(context, target), shard: shardFromContext(context, target),
        jobRef: context.jobRef, stages }),
      policy: validationSchedulingPolicyDigest(), producer,
      startedAt: retainedRaw.startedAt, finishedAt: retainedRaw.finishedAt,
    };
    timing = nativeTimingCoordinateDiagnostics(collected.coordinateTimings, timingOptions);
  } catch {
    collected.diagnostics.push({ stage: 'presentation', code: 'UNAVAILABLE_NATIVE_TIMING_PROJECTION' });
    if (timingOptions) {
      try {
        timing = nativeTimingCoordinateDiagnostics(collected.coordinateTimings.map(row => ({
          groupId: row.groupId, rootId: row.rootId, sourceDigest: row.sourceDigest,
          state: 0, startOffsetMs: null, endOffsetMs: null,
        })), timingOptions);
      } catch { timing.timingAnnotations = []; }
    } else timing.timingAnnotations = [];
  }
  return { evaluation, diagnostics: collected.diagnostics, markdown, ...timing };
}

export function nativeFailureAnnotations(evaluation) {
  requireReadinessEvaluation(evaluation);
  const escape = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return evaluation.cases.flatMap(test => test.assertions.filter(assertion =>
    assertion.status === 'Failed' && typeof assertion.selector.file === 'string' &&
    isValidationTestPath(assertion.selector.file)).map(assertion =>
    `::error file=${escape(assertion.selector.file).replaceAll(',', '%2C').replaceAll(':', '%3A')}::` +
    escape(`${test.testId}: ${assertion.detail || 'Required assertion failed; see retained complete reports.'} ` +
      `[assertion ${assertion.id}]`)));
}

async function definitionInputs(target, profile, component = 'full', shard = null,
  shardProtocol = nativeFrameworkShardProtocol) {
  const plan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  const bootstrapProtocol = sourceNativeBootstrapProtocol([{ file: 'scripts/toolchain-baseline.mjs',
    contents: await fs.readFile(path.join(repositoryRoot, 'scripts', 'toolchain-baseline.mjs'), 'utf8') }]);
  const inventory = await compileValidationInventory(repositoryRoot);
  const sources = await goSources();
  const specification = nativeSpecification({ plan, inventory, goSources: sources, target, profile, component, shard, shardProtocol });
  const assignment = shard === null ? null : nativeFrameworkShardPlan({ inventory, plan, target, protocol: shardProtocol });
  const calculatorSources = await Promise.all(calculatorProjectFiles(inventory).map(async file =>
    ({ file, contents: await fs.readFile(path.join(repositoryRoot, ...file.split('/')), 'utf8') })));
  calculatorSelection(inventory);
  return { plan, inventory, sources, calculatorSources, specification, bootstrapProtocol,
    stages: assignment ? assignment.parts.find(part => part.shard === shard).stages :
      component === 'homebrew' ? [] : nativeStageSelections(inventory, plan) };
}

export async function verifyNativeEvidence({ target, profile, candidateDir, evidenceDir,
  expectedSourceCommit, expectedRunId, expectedAttempt, releaseIntentId,
  expectedRepositoryId = process.env.GITHUB_REPOSITORY_ID, expectedWorkflowRef = process.env.GITHUB_WORKFLOW_REF,
  component = 'full', shard = null, shardProtocol = nativeFrameworkShardProtocol }) {
  const actualSource = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
  requireThat(actualSource === expectedSourceCommit, 'EVIDENCE', 'Replay must use the exact selected source definitions');
  await assertCommittedNativeInputs();
  const candidate = await verifyCandidate(candidateDir, { sourceCommit: expectedSourceCommit });
  const inputs = await definitionInputs(target, profile, component, shard, shardProtocol);
  const assignment = shard === null ? null : nativeFrameworkShardPlan({
    inventory: inputs.inventory, plan: inputs.plan, target, protocol: shardProtocol });
  const stored = await readOptional(path.join(evidenceDir, 'execution.json'));
  const context = validateExecutionContext(stored?.context);
  const bootstrap = await readOptional(path.join(evidenceDir, 'toolchain.json'));
  requireNativeBootstrapCapability({ bootstrap, inventory: inputs.inventory, plan: inputs.plan, assignment, shardProtocol,
    target, profile, component, shard,
    protocol: inputs.bootstrapProtocol });
  requireThat(bootstrap?.status === 'Passed' && bootstrap.target === target &&
    digest(context.native.toolchain.bootstrap) === digest(bootstrap.native),
  'EVIDENCE', 'Original native toolchain/host bootstrap is missing or differs');
  const tree = (await execute('git', ['rev-parse', `${expectedSourceCommit}^{tree}`], { cwd: repositoryRoot })).stdout.trim();
  requireThat(nativeContextMatches(context, { inventory: inputs.inventory, plan: inputs.plan, assignment, shardProtocol,
    target, profile, component, shard, sourceRevision: expectedSourceCommit,
    artifacts: nativeArtifacts(candidate), bootstrapProtocol: inputs.bootstrapProtocol }) &&
    context.candidateDigest === digest({ revision: expectedSourceCommit, tree }) &&
    context.testSpecDigest === testSpecificationDigest(inputs.plan) &&
    context.configDigest === nativeConfigurationDigest({ inventory: inputs.inventory, plan: inputs.plan, assignment, profile, target, component, shard, shardProtocol,
      bootstrapProtocol: inputs.bootstrapProtocol,
      shardPlanDigest: assignment?.digest ?? null,
      configuredWorkers: process.env.SDLC_TEST_WORKERS ?? null }) &&
    context.inventoryDigest === validationInventoryDigest(inputs.specification) &&
    context.sources[0].contentDigest === digest(tree) &&
    context.sources[0].repositoryId === `repository-${expectedRepositoryId}` &&
    context.producer.provider === 'github' && context.producer.connection === 'repository-ci' &&
    context.producer.scopeRef === `repository:${expectedRepositoryId}` &&
    context.producer.definitionRef === expectedWorkflowRef &&
    context.producer.executionRef === String(expectedRunId) &&
    context.producer.attemptRef === String(expectedAttempt) && context.attemptCapability === 'distinct' &&
    (profile === 'r-pre' ? context.intentId === id(releaseIntentId, 'logical release intent') :
      context.intentId === undefined),
  'EVIDENCE', 'Native evidence differs from independently selected source/specification/configuration/artifact/run inputs');
  const { raw, diagnostics } = await collectExecution({ directory: evidenceDir, ...inputs,
    target, context, startedAt: stored.startedAt, candidate, shardProtocol });
  requireThat(digest(raw.results) === digest(stored.results) && raw.observedAt === stored.observedAt,
    'EVIDENCE', 'Stored normalized observations differ from the retained original stage/tool outcomes');
  if (stored.complete !== true || stored.exitCode !== 0) {
    raw.complete = false;
    raw.finishedAt = null;
    raw.exitCode ||= stored.exitCode || 2;
  }
  return { evaluation: evaluateNativeExecution(inputs.specification, raw), context,
    artifacts: context.artifacts, diagnostics, sourceCommit: expectedSourceCommit };
}

export async function runNativeValidation(options, { lifetime = { cleanupSafe: true, unsettledCommands: [] } } = {}) {
  const request = validateNativeRequest(options);
  const { target, profile, candidateDir, evidenceDir, buildCandidate, phase, component, shard } = request;
  const role = nativeProducerRole(target, component, shard);
  requireThat(process.platform === platforms[target] &&
    process.arch === (target === 'macos-arm64' ? 'arm64' : 'x64') &&
    process.versions.node === nativeToolchain.node, 'HOST', 'Native validation requires its actual selected host and pinned Node');
  requireThat(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.ImageOS && process.env.ImageVersion && process.env.GITHUB_WORKFLOW_REF &&
    ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY_ID'].every(key =>
      /^[1-9]\d*$/u.test(process.env[key] ?? '')),
  'HOST', 'Native validation needs actual hosted image, repository, workflow, run and attempt identities');
  const git = args => execute('git', args, { cwd: repositoryRoot });
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const sourceStatus = (await git(['status', '--porcelain'])).stdout.trim();
  requireThat(revision === process.env.EXPECTED_SOURCE_COMMIT &&
    !sourceStatus, 'EVIDENCE', 'Native validation requires the exact clean expected source',
  safe({ expectedSourceCommit: process.env.EXPECTED_SOURCE_COMMIT, actualSourceCommit: revision,
    sourceStatus }));
  await literalDirectory(evidenceDir, { create: true, empty: true });
  const directory = evidenceDir;
  const startedAt = new Date().toISOString();
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let context;
  let candidate;
  let inputs;
  let failure;
  let primaryFailure;
  let evaluation;
  let ambient;
  let prefixStage;
  let cleanupDiagnostic = null;
  let candidateReady = false;
  try {
    if (process.platform === 'darwin') {
      requireThat(typeof process.env.SDLC_NATIVE_TOOLCHAIN_REPORT === 'string' &&
        path.isAbsolute(process.env.SDLC_NATIVE_TOOLCHAIN_REPORT), 'HOST',
      'Native prefix settlement requires the exact owned bootstrap report directory');
      const bootstrapDirectory = path.dirname(process.env.SDLC_NATIVE_TOOLCHAIN_REPORT);
      requireThat(!process.env.SDLC_HOMEBREW_PREFIX_PROOF ||
        process.env.SDLC_HOMEBREW_PREFIX_PROOF === bootstrapDirectory, 'HOST',
      'Native prefix settlement cannot borrow another bootstrap proof');
      prefixStage = await beginHomebrewPrefixStage({ stage: 'native', bootstrapDirectory,
        repositoryRoot, target, role, sourceCommit: revision, environment: process.env });
    }
    await assertCommittedNativeInputs();
    await runtimePreflight();
    inputs = await definitionInputs(target, profile, component, shard);
    const assignment = shard === null ? null : nativeFrameworkShardPlan({ inventory: inputs.inventory, plan: inputs.plan, target });
    const part = assignment?.parts.find(part => part.shard === shard);
    const scratch = path.join(directory, 'scratch');
    await fs.mkdir(scratch);
    ambient = await allocateAmbientDirectory();
    const environment = { ...Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !/^HOMEBREW_|^RUBYOPT$|^GEM_|^BUNDLE_/iu.test(name))),
      GOTOOLCHAIN: 'local', CGO_ENABLED: '0',
      GOCACHE: path.join(scratch, 'go-cache'), GOTMPDIR: scratch,
      TMPDIR: ambient.directory, TEMP: ambient.directory, TMP: ambient.directory,
      SDLC_TEST_EVIDENCE_ROOT: directory };
    const commandContext = { schemaVersion: 1, sourceCommit: revision, target,
      profile, ...(component === 'full' ? {} : { component }), workflowRef: process.env.GITHUB_WORKFLOW_REF,
      ...(shard === null ? {} : { frameworkShards: nativeFrameworkShardProtocol, shard }),
      repositoryId: `repository-${process.env.GITHUB_REPOSITORY_ID}`,
      runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
    for (const name of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN',
      'SDLC_DISTRIBUTION_FIXTURE_CONTEXT', syntheticReleaseContextVariable]) delete environment[name];
    const bootstrap = await readOptional(process.env.SDLC_NATIVE_TOOLCHAIN_REPORT ?? path.join(directory, 'missing-bootstrap.json'));
    const bootstrapCapability = requireNativeBootstrapCapability({ bootstrap, inventory: inputs.inventory, plan: inputs.plan, assignment,
      target, profile, component, shard,
      protocol: inputs.bootstrapProtocol });
    requireNativeCryptoEnvironment(bootstrapCapability, bootstrap.native.cryptoFixture, environment);
    const resources = nativeResourceFacts();
    requireThat(bootstrap?.status === 'Passed' && bootstrap.target === target &&
      bootstrap.native.node === process.versions.node && bootstrap.native.platform === process.platform &&
      bootstrap.native.architecture === process.arch &&
      bootstrap.native.resources && digest(bootstrap.native.resources) === digest(resources) &&
      nativeAffinityCapacityMatches(assignment, resources, shard),
    'HOST', 'Required native toolchain bootstrap did not establish this actual host/resource allocation');
    if (shard !== null) Object.assign(commandContext, {
      configDigest: nativeConfigurationDigest({ inventory: inputs.inventory, plan: inputs.plan, assignment, profile, target, component, shard,
        bootstrapProtocol: inputs.bootstrapProtocol,
        shardPlanDigest: assignment.digest, configuredWorkers: resources.configuredWorkers }),
      inventoryDigest: validationInventoryDigest(inputs.specification),
    });
    environment.SDLC_TEST_REPORT_CONTEXT = JSON.stringify(commandContext);
    await writeJson(path.join(directory, 'toolchain.json'), bootstrap);
    const runTool = options => {
      const { verifySettlement, ...commandOptions } = options;
      const execute = async () => {
        let report;
        let primary;
        try {
          report = await executeValidationCommand({ outputDir: directory, environment,
            signal: cancellation.signal, ...commandOptions, lifetime });
        } catch (error) { primary = error; }
        try { if (verifySettlement) await verifySettlement(report); }
        catch (error) {
          lifetime.cleanupSafe = false;
          if (!primary) throw error;
          primary.innerSettlementError = error;
        }
        if (primary) throw primary;
        return report;
      };
      return prefixStage ? prefixStage.run(options.name, execute, lifetime) : execute();
    };
    const sdk = await probeNativeSdk({ inventory: inputs.inventory, plan: inputs.plan, assignment,
      target, profile, component, shard, protocol: inputs.bootstrapProtocol }, runTool);
    const tree = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    context = validateExecutionContext({
      candidateDigest: digest({ revision, tree }), testSpecDigest: testSpecificationDigest(inputs.plan),
      configDigest: nativeConfigurationDigest({ inventory: inputs.inventory, plan: inputs.plan, assignment, profile, target, component, shard,
        bootstrapProtocol: inputs.bootstrapProtocol,
        shardPlanDigest: assignment?.digest ?? null,
        configuredWorkers: resources.configuredWorkers }),
      inventoryDigest: validationInventoryDigest(inputs.specification),
      sources: [{ repositoryId: `repository-${process.env.GITHUB_REPOSITORY_ID}`, revision,
        contentDigest: digest(tree) }], profile: inputs.specification.profile,
      environment: 'local', location: locations[target], mode: 'automated', owner: 'provider',
      native: { kind: 'native', platform: process.platform, architecture: process.arch,
        image: `${process.env.ImageOS}/${process.env.ImageVersion}`, toolchain: {
          node: process.versions.node, ...sdk,
          os: os.release(), machine: os.machine(), git: (await git(['--version'])).stdout.trim(),
          bootstrap: bootstrap.native, resources,
        } },
      producer: { provider: 'github', connection: 'repository-ci',
        scopeRef: `repository:${process.env.GITHUB_REPOSITORY_ID}`,
        definitionRef: process.env.GITHUB_WORKFLOW_REF, executionRef: process.env.GITHUB_RUN_ID,
        attemptKind: 'known', attemptRef: process.env.GITHUB_RUN_ATTEMPT },
      attemptCapability: 'distinct', jobRef: `native-${role}`, artifacts: [],
      ...(profile === 'r-pre' ? { intentId: process.env.RELEASE_INTENT_ID } : {}),
    });
    const stage = async selected => {
      if (selected.phase) requireThat(lifetime.cleanupSafe === true,
        'UNSETTLED_WRITERS', 'Unsettled native work prevents phase admission');
      if (selected.selection) {
        const reference = await writeValidationSelection({ files: selected.files, name: selected.selectorName });
        requireThat(digest(reference) === digest(selected.selection), 'EVIDENCE',
          'Native selection transport differs from its independently derived stage identity');
      }
      const command = await runTool({ name: `${selected.name}-command`, command: process.execPath,
        args: ['scripts/test-runner.mjs', ...selected.args],
        ...(selected.phase ? { verifySettlement: async report => {
          requireThat(lifetime.cleanupSafe === true, 'UNSETTLED_WRITERS',
            'Unsettled native work prevents phase completion');
          try {
            verifyNativePhaseSettlement({ stage: selected, command: report,
              report: await readOptional(path.join(directory, `${selected.name}.json`)),
              journal: await fs.readFile(path.join(directory, `${selected.name}-command.journal.ndjson`), 'utf8'),
              capacity: resources.workerCapacity });
          } catch (error) {
            if (report?.complete === true && report.exitCode !== 0) {
              const primary = new SdlcError('VALIDATION',
                `Native ${selected.name} did not complete successfully; original reports are retained`);
              primary.innerSettlementError = error;
              throw primary;
            }
            throw error;
          }
        } } : {}),
        environment: { ...environment, SDLC_TEST_REPORT_FILE: path.join(directory, `${selected.name}.json`) } });
      requireThat(command.complete && command.exitCode === 0, 'VALIDATION',
        `Native ${selected.name} did not complete successfully; original reports are retained`);
      if (selected.phase) {
        const report = await readOptional(path.join(directory, `${selected.name}.json`));
        const journal = await fs.readFile(path.join(directory, `${selected.name}.json.journal.ndjson`), 'utf8');
        validateNativeGroupReport({ inventory: inputs.inventory, stage: selected, report, journal, target });
        const reconciliation = reconcileNodeExecution({ ...inputs.inventory, cases: selected.cases }, report,
          { platform: target, files: selected.files });
        requireThat(reconciliation.status === 'Passed' && digest(report.context) === digest(context),
          'EVIDENCE', 'Native phase must pass its entire original source-bound regression closure');
        const proof = verifyNativePhaseSettlement({ stage: selected, report, command,
          journal: await fs.readFile(path.join(directory, `${selected.name}-command.journal.ndjson`), 'utf8'),
          capacity: resources.workerCapacity });
        await writeJson(path.join(directory, `${selected.name}-settlement.json`),
          { ...proof, observedAt: new Date().toISOString() });
      }
    };
    if (component !== 'homebrew' && (part === undefined ||
      nativeFrameworkUnitShardNames(target).includes(shard))) {
    for (const selected of inputs.stages.filter(stage => stage.name !== 'regression' && stage.kind !== 'regression')) {
      if (selected.name === 'unit' || phase === 'validation') await stage(selected);
    }
    if (part === undefined || part.procedures.includes('static')) {
      const staticReport = await runTool({ name: 'static', command: process.execPath, args: ['scripts/check.mjs'] });
      requireThat(staticReport.complete && staticReport.exitCode === 0, 'VALIDATION', 'Native static validation did not pass');
    }
    }
    if (buildCandidate) {
      await literalDirectory(candidateDir, { create: true, empty: true });
      const build = await runTool({ name: 'candidate-build', command: process.execPath,
        args: ['scripts/release-bundle.mjs', 'prepare', '--output-dir', candidateDir,
          '--repository', process.env.RELEASE_REPOSITORY ?? process.env.GITHUB_REPOSITORY, '--source-commit', revision],
        environment: { ...environment, GITHUB_OUTPUT: '' } });
      requireThat(build.complete && build.exitCode === 0, 'VALIDATION',
        'Frozen candidate construction did not complete; original build journals are retained');
    } else await literalDirectory(candidateDir);
    candidate = await verifyCandidate(candidateDir, { sourceCommit: revision,
      descriptorSha256: process.env.EXPECTED_DESCRIPTOR_SHA256,
      checksumsSha256: process.env.EXPECTED_CHECKSUMS_SHA256 });
    context = validateExecutionContext({ ...context, artifacts: nativeArtifacts(candidate) });
    await writeJson(path.join(directory, 'candidate-verification.json'), {
      artifacts: context.artifacts, sourceCommit: revision, observedAt: new Date().toISOString(),
    });
    candidateReady = true;
    if (phase === 'validation') {
    environment.SDLC_TEST_REPORT_CONTEXT = JSON.stringify(context);
    const syntheticNeeded = needsSyntheticReleaseFixture(inputs.stages, target);
    const persistSyntheticObservation = createNativeObservationCheckpoint(
      path.join(directory, 'synthetic-release-fixture-evidence.json'),
      { jobRef: context.jobRef, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT });
    const prepareSyntheticObservation = () => prepareObservedSyntheticReleaseFixture({
      stages: inputs.stages, target, directory: path.join(scratch, 'synthetic-release-fixture'), environment,
      expectedSourceCommit: revision, expectedTree: tree,
      writeEvidence: persistSyntheticObservation,
    });
    if (!syntheticNeeded) await prepareSyntheticObservation();
    if (component !== 'homebrew' && (part === undefined ||
      !nativeFrameworkUnitShardNames(target).includes(shard))) {
    const windows = archiveRecord(candidate, 'windows-x64');
    const launcher = readZip(await fs.readFile(path.join(candidateDir, 'assets', windows.filename)))
      .find(entry => entry.path === 'bin/sdlc.exe');
    requireThat(launcher, 'EVIDENCE', 'Frozen candidate must contain the real Windows launcher');
    environment.SDLC_WINDOWS_LAUNCHER = path.join(scratch, 'sdlc.exe');
    await fs.writeFile(environment.SDLC_WINDOWS_LAUNCHER, launcher.data, { flag: 'wx' });
    environment.SDLC_WINDOWS_LAUNCHER_SHA256 = digest(launcher.data);
    environment.SDLC_WINDOWS_LAUNCHER_CONTEXT = JSON.stringify(context);
    environment.SDLC_RELEASE_DIR = path.join(candidateDir, 'assets');
    environment.SDLC_RELEASE_SOURCE_COMMIT = revision;
    environment.SDLC_DISTRIBUTION_TARGETS = 'macos,windows-x64';
    let fixtureKind = 'published-candidate';
    if (target === 'linux-x64') {
      const privateFixtures = await prepareNativeHostFixtures({
        candidate, candidateDir, scratch,
        windowsLauncher: environment.SDLC_WINDOWS_LAUNCHER, environment,
      });
      environment.SDLC_RELEASE_DIR = privateFixtures.outputDir;
      environment.SDLC_DISTRIBUTION_TARGETS = 'macos,windows-x64,linux-x64';
      fixtureKind = privateFixtures.kind;
      await writeJson(path.join(directory, 'private-host-fixtures.json'), {
        kind: 'private-test-library-only', sourceCommit: revision,
        payloadSha256: candidate.descriptor.payload.sha256, archives: privateFixtures.archives,
      });
    }
    environment.SDLC_DISTRIBUTION_FIXTURE_CONTEXT = JSON.stringify(await frozenDistributionContext({
      directory: environment.SDLC_RELEASE_DIR,
      targets: environment.SDLC_DISTRIBUTION_TARGETS.split(','), context, kind: fixtureKind,
    }));
    const syntheticRelease = syntheticNeeded ? await prepareSyntheticObservation() : null;
    if (syntheticRelease) {
      environment[syntheticReleaseContextVariable] = JSON.stringify(syntheticRelease);
    }
    for (const selected of inputs.stages.filter(stage =>
      stage.name === 'regression' || stage.kind === 'regression')) await stage(selected);
    if (part === undefined || part.procedures.includes('calculator')) {
    const calculator = await runTool({ name: 'calculator-command', command: process.execPath,
      args: ['scripts/pr-calculator.mjs', '--output', path.join(directory, 'calculator.json')] });
    requireThat(calculator.complete && calculator.exitCode === 0, 'VALIDATION',
      'Required independent calculator tests failed or were unavailable; see calculator originals');
    }
    if (profile === 'r-pre' && target === 'windows-x64') {
      const { downloadPreviousRelease, verifySupportedPreviousLifecycle } = await import('./accept-release.mjs');
      const pins = candidate.context.previousRelease;
      requireThat(pins && typeof pins.repository === 'string' &&
        /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u.test(pins.repository),
        'RELEASE_INTEGRATION_BLOCKED', 'R-PRE Windows upgrade needs independently frozen previous-release pins');
      const previous = await downloadPreviousRelease({ ...pins,
        directory: path.join(scratch, 'previous-release') });
      const lifecycleRoot = path.join(scratch, 'previous-current-lifecycle');
      await fs.mkdir(lifecycleRoot);
      let commandSequence = 0;
      const lifecycle = await verifySupportedPreviousLifecycle({
        bundle: { context: candidate.context, identity: candidate.context.identity, descriptor: candidate.descriptor },
        downloaded: path.join(candidateDir, 'assets'), previous, root: lifecycleRoot,
        environment, run: async (command, args, options = {}) => {
          const result = await runTool({ name: `previous-current-${++commandSequence}`, command, args,
            cwd: options.cwd, environment: options.env ?? environment });
          requireThat(result.complete && result.exitCode === 0, 'VALIDATION',
            'Actual supported-previous lifecycle command did not complete successfully');
          return result;
        },
      });
      await writeJson(path.join(directory, 'native-previous-current.json'), {
        ...lifecycle, previousMetadata: { descriptor: previous.descriptor,
          checksums: previous.checksums ?? await fs.readFile(path.join(previous.directory, 'SHA256SUMS'), 'utf8') },
        observedAt: new Date().toISOString(),
      });
    }
    }
    if (target.startsWith('macos-') && component !== 'framework') {
      requireThat(prefixStage, 'HOST', 'Native Homebrew requires its allocated prefix stage');
      const homebrewArgs = [path.join(repositoryRoot, 'scripts', 'native-validation.mjs'), 'homebrew',
        '--target', target, '--profile', profile, '--candidate-dir', candidateDir,
        '--evidence-dir', evidenceDir, '--build-candidate', 'false',
        ...(component === 'full' ? [] : ['--component', component])];
      const child = await prefixStage.prepareChild({ name: 'homebrew-command',
        command: [process.execPath, ...homebrewArgs],
        commandContext: JSON.parse(environment.SDLC_TEST_REPORT_CONTEXT), reportDirectory: directory });
      const command = await runTool({ name: 'homebrew-command', command: process.execPath,
        cwd: repositoryRoot, requireSettlement: true, verifySettlement: child.verify,
        environment: { ...environment, SDLC_NATIVE_HOMEBREW_CHILD: child.id },
        args: homebrewArgs });
      requireThat(command.complete && command.exitCode === 0, 'VALIDATION',
        'Native Homebrew did not complete successfully; original subprocess reports are retained');
    }
    }
    const finalCandidate = await verifyCandidate(candidateDir, { sourceCommit: revision,
      descriptorSha256: candidate.context.identity.descriptorSha256,
      checksumsSha256: candidate.context.identity.checksumsSha256 });
    requireThat(digest(nativeArtifacts(finalCandidate)) === digest(context.artifacts) &&
      !(await git(['status', '--porcelain'])).stdout.trim(), 'EVIDENCE',
    'Native validation cannot credit changed source or changed frozen artifacts');
  } catch (error) {
    primaryFailure = error;
    failure = safe({ code: error.code ?? 'NATIVE_PRODUCER', message: error.message });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (ambient) {
      if (!lifetime.cleanupSafe) {
        cleanupDiagnostic = safe({ code: 'UNSETTLED_WRITERS',
          message: 'Owned native workspaces and evidence are retained until writer termination is established.' });
      } else {
        try { await ambient.dispose(); }
        catch (error) {
          cleanupDiagnostic = safe({ code: error.code ?? 'NATIVE_AMBIENT_CLEANUP', message: error.message });
        }
      }
      if (cleanupDiagnostic) {
        failure ??= cleanupDiagnostic;
        lifetime.retainedWorkspaces = [...new Set([
          ...(lifetime.retainedWorkspaces ?? []),
          ...(!lifetime.cleanupSafe ? [directory] : []), ambient.directory,
        ])];
      }
    }
  }
  const details = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`;
  let diagnostics = [];
  let markdown;
  let terminalGroup = { availability: 'unavailable', reason: 'native-validation-not-entered',
    offsetOrigin: 'producer.startedAt' };
  if (context && phase === 'validation') {
    const finalized = await finalizeNativeEvidence({ directory, ...inputs, target, context, startedAt, candidate,
      failure, cancelled: cancellation.signal.aborted, completeReportRef: details });
    evaluation = finalized.evaluation;
    diagnostics = finalized.diagnostics;
    if (finalized.terminalGroup) terminalGroup = finalized.terminalGroup;
    markdown = finalized.markdown;
    for (const annotation of Array.isArray(finalized.timingAnnotations) ? finalized.timingAnnotations : []) {
      console.error(annotation);
    }
  } else {
    markdown = `# Native ${target}: NotRun\n\n${phase === 'candidate' && candidateReady && !failure ?
      'Source candidate frozen after canonical units and static validation; native assertions have not executed.' :
      'Required producer prerequisites or unit-first validation did not complete.'} ` +
      `No execution origin or passing evidence was invented. See [complete partial reports](${details}) and producer.json.\n`;
    await fs.writeFile(path.join(directory, 'readiness.md'), markdown, { flag: 'wx' });
  }
  const status = evaluation?.status ?? 'NotRun';
  if (evaluation) for (const annotation of nativeFailureAnnotations(evaluation).slice(0, 10)) console.error(annotation);
  let presentationDiagnostic = null;
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown); }
    catch (error) { presentationDiagnostic = safe({ code: error.code, message: 'Actions summary write failed; retained reports remain authoritative.' }); }
  }
  const result = { status, phase, ...(component === 'full' ? {} : { component, role }),
    ...(shard === null ? {} : { shard, frameworkShards: nativeFrameworkShardProtocol }),
    candidateReady: phase === 'candidate' && candidateReady && !failure &&
    !cancellation.signal.aborted, context: phase === 'validation' ? context ?? null : null, sourceCommit: revision,
    descriptorSha256: candidate?.context.identity.descriptorSha256 ?? null,
    checksumsSha256: candidate?.context.identity.checksumsSha256 ?? null,
    artifacts: context?.artifacts ?? [], diagnostics, terminalGroup, failure, presentationDiagnostic,
    workspaceCleanup: lifetime, cleanupDiagnostic,
    complete: status === 'Passed', cancelled: cancellation.signal.aborted, startedAt, finishedAt: new Date().toISOString() };
  try {
    await writeJson(path.join(directory, 'producer.json'), result);
    if (prefixStage) await prefixStage.finish();
  } catch (error) {
    if (!primaryFailure) throw error;
    primaryFailure.prefixSafetyRetentionError ??= error;
    primaryFailure.workspaceCleanup = lifetime;
    throw primaryFailure;
  }
  return { ...result, evaluation };
}

export async function writeNativeHomebrewReport(directory, result, primaryError) {
  const report = { ...result, observedAt: new Date().toISOString() };
  const file = path.join(directory, 'native-homebrew.json');
  try {
    await writeJson(file, report);
  } catch (error) {
    if (!(error instanceof SdlcError) || !['UNSAFE', 'CAPACITY', 'JSON'].includes(error.code)) throw error;
    const original = Buffer.from(JSON.stringify(report));
    await writeJson(file, {
      nativeValidation: 'NotRun', observedAt: report.observedAt,
      stage: ['formula', 'quality', 'lifecycle', 'verification'].includes(report.stage) ?
        report.stage : 'evidence-retention',
      diagnostic: processDiagnostic(primaryError ?? error),
      retentionDiagnostic: processDiagnostic(error),
      original: { sha256: digest(original), bytes: original.length },
    });
    throw primaryError ?? error;
  }
}

async function runHomebrewProcedure(options) {
  const { target, candidateDir, evidenceDir, component, phase, buildCandidate } = validateNativeRequest(options);
  requireThat(component !== 'framework' && phase === 'validation' && !buildCandidate,
    'INPUT', 'The actual Homebrew procedure requires a frozen full or Homebrew validation request');
  requireThat(target.startsWith('macos-') && process.platform === 'darwin' &&
    process.arch === (target === 'macos-arm64' ? 'arm64' : 'x64'), 'HOST',
  'The Homebrew subprocess must run on its actual selected native Mac architecture');
  await literalDirectory(candidateDir);
  await literalDirectory(evidenceDir);
  const candidate = await verifyCandidate(candidateDir, { sourceCommit: process.env.EXPECTED_SOURCE_COMMIT,
    descriptorSha256: process.env.EXPECTED_DESCRIPTOR_SHA256,
    checksumsSha256: process.env.EXPECTED_CHECKSUMS_SHA256 });
  const lifetime = { cleanupSafe: true, unsettledCommands: [] };
  // Register the delegated-command scope before any SDK work, including settled pre-lifecycle failures.
  createOwnedCommandRunner({ lifetime });
  const child = process.env.SDLC_NATIVE_HOMEBREW_CHILD ? await beginHomebrewPrefixChild({
    repositoryRoot, bootstrapDirectory: path.dirname(process.env.SDLC_NATIVE_TOOLCHAIN_REPORT),
    target, role: nativeProducerRole(target, component), sourceCommit: process.env.EXPECTED_SOURCE_COMMIT,
    environment: process.env,
  }) : null;
  let result;
  let primaryFailure;
  let retained = false;
  try {
    const { verifyNativeHomebrew } = await import('./release-gate.mjs');
    result = await verifyNativeHomebrew({ candidate, candidateDir, scratch: evidenceDir,
      targetArch: process.arch, mode: 'candidate', lifetime });
  } catch (error) {
    primaryFailure = error;
    result = { nativeValidation: error.homebrewResult?.nativeValidation ?? 'NotRun',
      diagnostic: processDiagnostic(error), stage: error.homebrewResult?.stage,
      evidence: error.homebrewResult?.evidence ?? null, quality: error.homebrewResult?.quality ?? error.homebrewQuality ?? null };
  }
  try {
    await writeNativeHomebrewReport(evidenceDir, result, primaryFailure);
    retained = true;
  } catch (error) {
    if (!primaryFailure) throw error;
    if (error !== primaryFailure) primaryFailure.innerReportRetentionError = error;
  }
  if (child && retained) {
    try { await child.finish({ lifetime, reportPath: path.join(evidenceDir, 'native-homebrew.json') }); }
    catch (error) {
      if (!primaryFailure) throw error;
      primaryFailure.innerSettlementError = error;
    }
  }
  if (primaryFailure) throw primaryFailure;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args[0] === 'homebrew') {
    try { await runHomebrewProcedure(parseNativeOptions(args.slice(1))); }
    catch (error) {
      console.error(JSON.stringify(processDiagnostic(error)));
      process.exitCode = 1;
    }
  } else {
    const result = await runNativeValidation(parseNativeOptions(args));
    if ((result.status === 'Passed' || result.candidateReady) && process.env.GITHUB_OUTPUT) {
      for (const field of ['sourceCommit', 'descriptorSha256', 'checksumsSha256']) {
        await fs.appendFile(process.env.GITHUB_OUTPUT, `${field}=${result[field]}\n`);
      }
    }
    process.exitCode = result.status === 'Passed' || result.candidateReady ? 0 : result.status === 'Failed' ? 1 : 2;
  }
}
