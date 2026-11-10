import fs from 'fs';
import path from 'path';
import { evaluateStrategyForPort, strategyRegistry, EvaluatedStrategyOutput } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, errorMsg: string, details?: any) {
  if (condition) {
    results.push({ name: testName, passed: true, details });
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    results.push({ name: testName, passed: false, error: errorMsg, details });
    console.error(`  ❌ FAIL: ${testName} - ${errorMsg}`);
  }
}

console.log('================================================================================');
console.log('   CHALLENGER M1-2 EMPIRICAL ADVERSARIAL VERIFICATION SUITE                    ');
console.log('   Ports 3002-3006 Registry Forwarding & Isolated Integrity                    ');
console.log('================================================================================\n');

// ---------------------------------------------------------------------------
// 1. REAL CANDLE DATA HARNESS: DISCOVER ACTIVE SIGNALS FOR PORTS 3002-3006
// ---------------------------------------------------------------------------
console.log('>>> [PART 1] Scanning Real Cached Candles for Active Signals on Ports 3002-3006...');

const CACHE_DIR = path.join(process.cwd(), '.cache_candles_1m');
const targetPorts = [3002, 3003, 3004, 3005, 3006];
const discoveredSignals: Record<number, { buy?: EvaluatedStrategyOutput; sell?: EvaluatedStrategyOutput }> = {
  3002: {},
  3003: {},
  3004: {},
  3005: {},
  3006: {},
};

if (fs.existsSync(CACHE_DIR)) {
  const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('_15m_1month.json'));
  for (const file of cacheFiles) {
    const sym = file.split('_')[0];
    const raw = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
    const candles: KlinePoint[] = JSON.parse(raw);

    // Roll through candles to find signals
    for (let i = 45; i < candles.length; i += 5) {
      const window = candles.slice(0, i);
      for (const port of targetPorts) {
        if (!discoveredSignals[port].buy || !discoveredSignals[port].sell) {
          const out = evaluateStrategyForPort(port, sym, window);
          if (out.signal === 'BUY' && !discoveredSignals[port].buy) {
            discoveredSignals[port].buy = out;
          }
          if (out.signal === 'SELL' && !discoveredSignals[port].sell) {
            discoveredSignals[port].sell = out;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. VERIFY FIELD FORWARDING FOR EACH PORT (3002, 3003, 3004, 3005, 3006)
// ---------------------------------------------------------------------------
console.log('\n>>> [PART 2] Verifying Field Forwarding Completeness Without Truncation...');

function verifyVerdictFields(port: number, verdict: EvaluatedStrategyOutput | undefined, expectedSide: 'BUY' | 'SELL') {
  const prefix = `Port ${port} ${expectedSide}`;
  assert(verdict !== undefined, `${prefix} signal was found in real datasets`, 'No signal found in backtest cache');
  if (!verdict) return;

  assert(verdict.signal === expectedSide, `${prefix} signal matches expected side`, `Got ${verdict.signal}`);
  assert(typeof verdict.confidenceScore === 'number' && verdict.confidenceScore >= 50 && verdict.confidenceScore <= 100,
    `${prefix} confidenceScore is valid (50-100)`, `Got ${verdict.confidenceScore}`);
  assert(typeof verdict.strategyName === 'string' && verdict.strategyName.length > 5,
    `${prefix} strategyName is defined`, `Got ${verdict.strategyName}`);
  assert(typeof verdict.customSL === 'number' && verdict.customSL > 0,
    `${prefix} customSL is a positive number`, `Got ${verdict.customSL}`);
  assert(typeof verdict.customTP === 'number' && verdict.customTP > 0,
    `${prefix} customTP is a positive number`, `Got ${verdict.customTP}`);
  assert(typeof verdict.tp1Price === 'number' && verdict.tp1Price > 0,
    `${prefix} tp1Price is defined and positive`, `Got ${verdict.tp1Price}`);
  assert(typeof verdict.tp2Price === 'number' && verdict.tp2Price > 0,
    `${prefix} tp2Price is defined and positive`, `Got ${verdict.tp2Price}`);
  assert(verdict.tp1Ratio === 0.75,
    `${prefix} tp1Ratio is strictly 0.75 (75%)`, `Got ${verdict.tp1Ratio}`);
  assert(verdict.tp2Ratio === 0.25,
    `${prefix} tp2Ratio is strictly 0.25 (25%)`, `Got ${verdict.tp2Ratio}`);
  assert(typeof verdict.earlyBreakevenPrice === 'number' && verdict.earlyBreakevenPrice > 0,
    `${prefix} earlyBreakevenPrice is defined and positive`, `Got ${verdict.earlyBreakevenPrice}`);
  assert(typeof verdict.riskDistance === 'number' && verdict.riskDistance > 0,
    `${prefix} riskDistance is defined and positive`, `Got ${verdict.riskDistance}`);
  assert(Array.isArray(verdict.reasons) && verdict.reasons.length > 0,
    `${prefix} reasons array contains explanatory strings`, `Got ${JSON.stringify(verdict.reasons)}`);

  // Target geometry validations
  if (expectedSide === 'BUY') {
    assert(verdict.customSL! < verdict.tp1Price!, `${prefix} SL < TP1 for BUY`, `SL=${verdict.customSL}, TP1=${verdict.tp1Price}`);
    assert(verdict.earlyBreakevenPrice! > verdict.customSL!, `${prefix} Early BE > SL for BUY`, `BE=${verdict.earlyBreakevenPrice}`);
  } else {
    assert(verdict.customSL! > verdict.tp1Price!, `${prefix} SL > TP1 for SELL`, `SL=${verdict.customSL}, TP1=${verdict.tp1Price}`);
    assert(verdict.earlyBreakevenPrice! < verdict.customSL!, `${prefix} Early BE < SL for SELL`, `BE=${verdict.earlyBreakevenPrice}`);
  }
}

for (const port of targetPorts) {
  verifyVerdictFields(port, discoveredSignals[port].buy, 'BUY');
  verifyVerdictFields(port, discoveredSignals[port].sell, 'SELL');
}

// ---------------------------------------------------------------------------
// 3. ADVERSARIAL STRESS TESTING: CORNER CASES, INSUFFICIENT DATA & ROBUSTNESS
// ---------------------------------------------------------------------------
console.log('\n>>> [PART 3] Adversarial Stress Testing on Edge Cases & Boundary Conditions...');

// Stress Test A: Empty candle array
for (const port of targetPorts) {
  const emptyOut = evaluateStrategyForPort(port, 'BTCUSDT', []);
  assert(emptyOut.signal === null, `Port ${port} handles empty candle array gracefully`, `Got signal ${emptyOut.signal}`);
  assert(emptyOut.confidenceScore === 0, `Port ${port} empty candles has 0 confidence`, `Got ${emptyOut.confidenceScore}`);
}

// Stress Test B: Insufficient history (only 5 candles)
for (const port of targetPorts) {
  const shortCandles: KlinePoint[] = Array.from({ length: 5 }, (_, i) => ({
    time: Date.now() + i * 900000,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1000,
  }));
  const shortOut = evaluateStrategyForPort(port, 'BTCUSDT', shortCandles);
  assert(shortOut.signal === null, `Port ${port} rejects insufficient history (<30 bars)`, `Got signal ${shortOut.signal}`);
}

// Stress Test C: Micro-penny asset pricing (extreme floating point values)
const microPrice = 0.00001234;
const microCandles: KlinePoint[] = Array.from({ length: 50 }, (_, i) => ({
  time: Date.now() + i * 900000,
  open: microPrice * (1 + 0.001 * Math.sin(i)),
  high: microPrice * (1 + 0.005),
  low: microPrice * (1 - 0.005),
  close: microPrice * (1 - 0.001 * Math.cos(i)),
  volume: 50000000,
}));

for (const port of targetPorts) {
  const microOut = evaluateStrategyForPort(port, 'PEPEUSDT', microCandles);
  // Should not crash or produce NaN
  assert(!isNaN(microOut.confidenceScore), `Port ${port} handles micro asset pricing without NaN`, `Confidence=${microOut.confidenceScore}`);
}

// Stress Test D: Port 3001 codebase isolation invariant
// Ensure Port 3001 evaluation in strategyRegistry remains its own untouched strategy (Zero-Lag / Sidhant)
const out3001 = evaluateStrategyForPort(3001, 'BTCUSDT', []);
assert(out3001.strategyName.includes('Zero-Lag') || out3001.strategyName.includes('Sidhant') || out3001.strategyName.includes('None'),
  'Port 3001 evaluation does not invoke ports 3002-3006', `Got name: ${out3001.strategyName}`);

// Stress Test E: Trend Shield Exemption Invariant
// Ports 3002 through 3010 must NOT be blocked by the generic trend shield
console.log('\n>>> [PART 4] Verifying Trend Shield Structural Shift Exemption...');
// Create a strong uptrend dataset where standard trend shield might block shorts
const strongTrendCandles: KlinePoint[] = Array.from({ length: 50 }, (_, i) => ({
  time: Date.now() + i * 900000,
  open: 1000 + i * 20,
  high: 1000 + i * 20 + 15,
  low: 1000 + i * 20 - 5,
  close: 1000 + i * 20 + 10,
  volume: 10000,
}));

// In strategyRegistry.ts line 684:
// const isQualifiedStructuralShift = p === 3001 || (p >= 3002 && p <= 3010) ...
// Test if the code explicitly exempts ports 3002-3010
for (const port of targetPorts) {
  // If an engine returns a SELL signal, trend shield must not override it to null with 'Blocked by Strong Bull Expansion Shield'
  // We can test this by checking strategyRegistry exports and evaluating a known short or checking reasons
  const testOut = evaluateStrategyForPort(port, 'BTCUSDT', strongTrendCandles);
  const blockedByShield = (testOut.reasons || []).some(r => r.includes('Blocked by Strong Bull Expansion Shield') || r.includes('Blocked by Strong Bear Dump Shield'));
  assert(!blockedByShield, `Port ${port} is NOT blocked by generic trend shield (structural exemption preserved)`,
    `Got reasons: ${JSON.stringify(testOut.reasons)}`);
}

// ---------------------------------------------------------------------------
// 4. SUMMARY & VERDICT
// ---------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('   CHALLENGER VERIFICATION SUMMARY                                             ');
console.log('================================================================================');
const total = results.length;
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`Total Assertions Tested: ${total}`);
console.log(`Passed:                  ${passed}`);
console.log(`Failed:                  ${failed}`);
console.log(`Pass Rate:               ${((passed / total) * 100).toFixed(1)}%`);

if (failed === 0) {
  console.log('\n🌟 EMPIRICAL VERIFICATION RESULT: ALL CLAIMS INDEPENDENTLY CONFIRMED PASS');
  process.exit(0);
} else {
  console.error('\n🚨 EMPIRICAL VERIFICATION RESULT: FAILURES DETECTED');
  process.exit(1);
}
