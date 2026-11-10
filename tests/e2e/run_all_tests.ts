/**
 * Unified Master E2E Test Suite Runner
 * Executes:
 * 1. Tier 1 Feature Verification Suite (110 Tests across Features 1-22)
 * 2. Tier 2 Boundary Value Suite (Features 1-5 Boundaries)
 * 3. 4-Tier Parity & 7 Strategy Video Rules Suite (tests/e2e_parity_and_strategy.test.ts)
 */

import { getTier1Tests } from './tier1_features/index';
import { getTier2Tests } from './tier2_boundaries/index';
import { TestCase } from './harness/assertionUtils';
import { runAllTests as runParitySuite } from '../e2e_parity_and_strategy.test';

const C_RESET = '\x1b[0m';
const C_GREEN = '\x1b[32m';
const C_RED = '\x1b[31m';
const C_YELLOW = '\x1b[33m';
const C_CYAN = '\x1b[36m';
const C_BOLD = '\x1b[1m';

async function runTestList(tests: TestCase[], suiteName: string): Promise<{ passed: number; failed: number }> {
  console.log(`\n${C_BOLD}${C_CYAN}=== RUNNING ${suiteName} (${tests.length} tests) ===${C_RESET}`);
  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    const start = Date.now();
    try {
      await t.run();
      const dur = Date.now() - start;
      passed++;
      console.log(`  ${C_GREEN}✅ PASS${C_RESET} [${t.id}] ${t.name} (${dur}ms)`);
    } catch (err: any) {
      const dur = Date.now() - start;
      failed++;
      console.log(`  ${C_RED}❌ FAIL${C_RESET} [${t.id}] ${t.name} (${dur}ms)`);
      console.log(`     ${C_RED}→ Error:${C_RESET} ${err?.message || err}`);
    }
  }

  console.log(`${C_BOLD}${suiteName} Results: ${C_GREEN}${passed} passed${C_RESET}, ${failed > 0 ? C_RED : C_GREEN}${failed} failed${C_RESET}`);
  return { passed, failed };
}

async function main() {
  console.log(`\n${C_BOLD}${C_CYAN}================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}🚀 DELTA EXCHANGE INDIA UNIFIED E2E TEST RUNNER${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================${C_RESET}`);

  const tier1Tests = getTier1Tests();
  const tier2Tests = getTier2Tests();

  const r1 = await runTestList(tier1Tests, 'Tier 1 Feature Invariants');
  const r2 = await runTestList(tier2Tests, 'Tier 2 Boundary Scenarios');

  console.log(`\n${C_BOLD}${C_CYAN}=== RUNNING 4-TIER PARITY & STRATEGY RULES SUITE ===${C_RESET}`);
  const r3 = await runParitySuite();

  const totalPassed = r1.passed + r2.passed + r3.passed;
  const totalFailed = r1.failed + r2.failed + r3.failed;
  const totalBugs = r3.bugs;

  console.log(`\n${C_BOLD}${C_CYAN}================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}🏆 UNIFIED TEST SUITE FINAL SCORECARD${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================${C_RESET}`);
  console.log(`• Tier 1 Features Suite      : ${r1.passed} / ${tier1Tests.length} passed`);
  console.log(`• Tier 2 Boundaries Suite    : ${r2.passed} / ${tier2Tests.length} passed`);
  console.log(`• Parity & Strategy Suite    : ${r3.passed} passed (${r3.bugs} escalated defect gate)`);
  console.log(`• Total Passing Assertions   : ${C_GREEN}${totalPassed}${C_RESET}`);
  console.log(`• Total Direct Failures      : ${totalFailed > 0 ? C_RED : C_GREEN}${totalFailed}${C_RESET}`);
  console.log(`• Total Escalated Gates      : ${totalBugs > 0 ? C_YELLOW : C_GREEN}${totalBugs}${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================${C_RESET}\n`);

  if (totalFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1].includes('run_all_tests')) {
  main().catch(err => {
    console.error('Unified runner fatal error:', err);
    process.exit(1);
  });
}
