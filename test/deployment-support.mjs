import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fixture, coding, completeReview, finishFixtureOperation, fixtureArtifact,
  fixtureBuild, fixtureDeployment, grant, observeFixtureRepository, prepareFixtureDeployment,
  registerFixtureProviderRequest, testDefinitions, orient } from './helpers.mjs';
import { startCycle, recordArtifact, recordTest, stagingHandoff } from '../src/validation.mjs';
import { readJson, writeJson } from '../src/files.mjs';
import { prepareOperation, markDispatching, pruneWork, recordOperation } from '../src/operations.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { currentCycle, currentTestEvidence, hasStagingCompletion,
  hasStageCompletion, latestStagingResultEvent,
  stagePassed } from '../src/authority.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
import { loadConfig, synchronizeTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { formatAudit, recordAudit } from '../src/audit.mjs';
import { nextAction } from '../src/recovery.mjs';
import { stagingExecutionGuidance } from '../src/staging.mjs';

export {
  test, assert, path, fs, fixture,
  coding, completeReview, finishFixtureOperation, fixtureArtifact, fixtureBuild,
  fixtureDeployment, grant, observeFixtureRepository, prepareFixtureDeployment, registerFixtureProviderRequest,
  testDefinitions, orient, startCycle, recordArtifact, recordTest,
  stagingHandoff, readJson, writeJson, prepareOperation, markDispatching,
  pruneWork, recordOperation, evaluatePolicy, currentCycle, currentTestEvidence,
  hasStagingCompletion, hasStageCompletion, latestStagingResultEvent, stagePassed, gate,
  loadConfig, synchronizeTestPlan, testSpecificationDigest, formatAudit, recordAudit,
  nextAction, stagingExecutionGuidance,
};
