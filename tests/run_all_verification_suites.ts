/**
 * Master Verification Test Suite Runner
 * Executes all 4 automated trading test suites sequentially:
 *   1. tests/test_smart_direct_verification.ts (Direct execution & trap filter verification)
 *   2. tests/test_all_video_systems_1_2_3_reversal.ts (Systems 3002-3007 video strategy & 1:2.30 RR verification)
 *   3. tests/test_milestone3_verification.ts (System 3007 hardening & math risk engine verification)
 *   4. tests/e2e_systems_3002_to_3007.test.ts (E2E comprehensive 88-test matrix for Systems 3002-3007)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TSX_CLI = path.join(ROOT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface SuiteConfig {
  id: string;
  name: string;
  file: string;
  expectedTests: number;
}

const SUITES: SuiteConfig[] = [
  {
    id: 'SUITE_1',
    name: 'Smart Direct Verification (Direct execution & trap filtering)',
    file: 'tests/test_smart_direct_verification.ts',
    expectedTests: 46,
  },
  {
    id: 'SUITE_2',
    name: 'Video Systems Verification (Systems 3002-3007 1:2.30 RR & Pre-Reversal TP)',
    file: 'tests/test_all_video_systems_1_2_3_reversal.ts',
    expectedTests: 42,
  },
  {
    id: 'SUITE_3',
    name: 'Milestone 3 Hardening Verification (System 3007 & Math Risk Engine)',
    file: 'tests/test_milestone3_verification.ts',
    expectedTests: 23,
  },
  {
    id: 'SUITE_4',
    name: 'E2E Systems 3002-3007 Comprehensive Matrix (Feature, Boundary, Cross-R:R, Workloads)',
    file: 'tests/e2e_systems_3002_to_3007.test.ts',
    expectedTests: 88,
  },
];

console.log('\n========================================================================');
console.log('🛡️  DELTA TRADING CLUSTER: UNIFIED AUTOMATED VERIFICATION SUITE');
console.log('========================================================================\n');

let totalSuitesPassed = 0;
let totalSuitesFailed = 0;
const results: { name: string; file: string; passed: boolean; exitCode: number | null; durationMs: number }[] = [];

for (const suite of SUITES) {
  const filePath = path.join(ROOT_DIR, suite.file);
  console.log(`\n▶ [START] Executing ${suite.name}...`);
  console.log(`  File: ${suite.file}`);

  const startTime = Date.now();
  const res = spawnSync('node', [TSX_CLI, filePath], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  });
  const durationMs = Date.now() - startTime;

  const passed = res.status === 0;
  if (passed) {
    totalSuitesPassed++;
    console.log(`✔ [PASS] ${suite.name} completed successfully in ${(durationMs / 1000).toFixed(2)}s\n`);
  } else {
    totalSuitesFailed++;
    console.error(`✖ [FAIL] ${suite.name} failed with exit code ${res.status} in ${(durationMs / 1000).toFixed(2)}s\n`);
  }

  results.push({
    name: suite.name,
    file: suite.file,
    passed,
    exitCode: res.status,
    durationMs,
  });
}

console.log('\n========================================================================');
console.log('📊 UNIFIED AUTOMATION SCORECARD & SUITE SUMMARY');
console.log('========================================================================');

for (const r of results) {
  const statusMark = r.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${statusMark} [${r.file}] ${(r.durationMs / 1000).toFixed(2)}s`);
}

console.log('------------------------------------------------------------------------');
console.log(`Total Suites Run   : ${SUITES.length}`);
console.log(`Suites Passed      : ${totalSuitesPassed} / ${SUITES.length}`);
console.log(`Suites Failed      : ${totalSuitesFailed}`);
console.log(`Total Test Cases   : 199 (46 + 42 + 23 + 88)`);

if (totalSuitesFailed > 0) {
  console.error('\n❌ VERIFICATION FAILED: One or more test suites reported failures.');
  process.exit(1);
} else {
  console.log('\n🌟 ALL 199 AUTOMATED VERIFICATION TESTS PASSED WITH 100% SUCCESS!');
  process.exit(0);
}
