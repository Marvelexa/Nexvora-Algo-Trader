/**
 * ============================================================================
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE 2 (CHALLENGER M2-1)
 * 
 * Target: Strategy 3007 (ytCrtSmc3007Engine.ts) & Strategy 3008 (ytSolanoVwap3008Engine.ts)
 * Author: Empirical Challenger M2-1 (teamwork_challenger)
 * 
 * Mandatory Challenge Dimensions:
 * 1. Bilateral symmetry: Assert both BUY and SELL trigger across synthetic test sequences.
 * 2. Extreme ATR survival: Verify tiny ATR (<0.05) clamps risk distance to >= 0.45%
 *    and huge ATR (>1000) does not overflow.
 * 3. 1-tick vs 50-tick sweeps: Verify sweep detection and stop loss placement beyond wick extremes.
 * 4. Mathematical invariants: Audit all trade verdicts for:
 *    - tp1Ratio === 0.75
 *    - tp2Ratio === 0.25
 *    - earlyBreakevenPrice === +0.75R
 *    - minSlDistancePct >= 0.0045
 * 5. Chaos inputs: Null, empty array, single bar, zero-volatility flat candles, zero volume, corrupted.
 * ============================================================================
 */

import { KlinePoint } from '../src/types';
import { YtCrtSmc3007Engine, ytCrtSmc3007Engine } from '../lib/strategies/ytCrtSmc3007Engine';
import { YtSolanoVwap3008Engine, ytSolanoVwap3008Engine } from '../lib/strategies/ytSolanoVwap3008Engine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { StandardStrategyVerdict } from '../lib/strategies/standardStrategyInterface';

// Terminal formatting colors
const C_RESET = '\x1b[0m';
const C_RED = '\x1b[31m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_CYAN = '\x1b[36m';
const C_BOLD = '\x1b[1m';

interface TestRecord {
  suite: string;
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const testResults: TestRecord[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function assertCloseTo(val: number, expected: number, maxDelta: number, message: string): void {
  const diff = Math.abs(val - expected);
  if (diff > maxDelta) {
    throw new Error(`Assertion Failed: ${message} (val=${val}, expected=${expected}, diff=${diff} > maxDelta=${maxDelta})`);
  }
}

async function runTest(
  suite: string,
  id: string,
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    testResults.push({ suite, id, name, passed: true, durationMs });
    console.log(`  ${C_GREEN}PASS${C_RESET} [${id}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    testResults.push({
      suite,
      id,
      name,
      passed: false,
      durationMs,
      error: err?.message || String(err),
    });
    console.log(`  ${C_RED}FAIL${C_RESET} [${id}] ${name} (${durationMs}ms)`);
    console.log(`     ${C_RED}→ Error:${C_RESET} ${err?.message || err}`);
  }
}

function createCandle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number = 1000
): KlinePoint {
  return { timestamp, open, high, low, close, volume };
}

// ============================================================================
// SYNTHETIC CANDLE GENERATORS FOR 3007 & 3008
// ============================================================================

export function generateCrt3007Candles(
  side: 'BUY' | 'SELL',
  options?: {
    tickSweep?: number; // Sweep offset beyond C1 boundary
    atrMultiplier?: number;
    basePrice?: number;
    noSweep?: boolean; // If true, touches but does not pierce C1 extreme
    clampFeeTest?: boolean; // If true, sets very tight sweep to force MIN_SL_DISTANCE_PCT clamping
  }
): KlinePoint[] {
  const basePrice = options?.basePrice ?? 100.0;
  const scale = options?.atrMultiplier ?? 1.0;
  const isFeeClamp = Boolean(options?.clampFeeTest);

  // In fee clamp test, use ultra-tight range: c1Low = 100.0, c1High = 100.4
  const c1RangeRaw = isFeeClamp ? 0.40 : (5.0 * scale);
  const c1Low = basePrice;
  const c1High = basePrice + c1RangeRaw;
  const mid = (c1Low + c1High) / 2;

  let tickSweep = options?.tickSweep;
  if (options?.noSweep) {
    tickSweep = -0.1 * (isFeeClamp ? 0.05 : scale);
  } else if (tickSweep === undefined) {
    tickSweep = isFeeClamp ? 0.02 : (1.5 * scale);
  }

  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;

  // Bars 0 to 32: Background drift (33 bars)
  for (let i = 0; i < 33; i++) {
    const p = mid + (isFeeClamp ? 0.01 : 0.2 * scale) * Math.sin(i);
    const sp = isFeeClamp ? 0.05 : (0.2 * scale);
    candles.push(createCandle(baseTime + i * 900, p, p + sp, p - sp, p, 1000));
  }

  // Bars 33 to 40: 1H CRT Window (indices 33..40, 8 bars).
  // Bar 34 sets c1High, Bar 36 sets c1Low. Bars 39..40 stay in between so internalSlice doesn't absorb extremes.
  for (let i = 33; i < 41; i++) {
    let low = c1Low + (isFeeClamp ? 0.1 : 1.0 * scale);
    let high = c1High - (isFeeClamp ? 0.1 : 1.0 * scale);
    if (i === 34) high = c1High;
    if (i === 36) low = c1Low;
    candles.push(createCandle(baseTime + i * 900, mid, high, low, mid, 1000));
  }

  if (side === 'BUY') {
    // Bar 41 (index 41, n-4): Sweep candle purging C1 Low
    const sweepLow = c1Low - tickSweep;
    const sweepHigh = c1Low + (isFeeClamp ? 0.15 : 1.0 * scale);
    candles.push(createCandle(baseTime + 41 * 900, c1Low + (isFeeClamp ? 0.05 : 0.5 * scale), sweepHigh, sweepLow, c1Low + (isFeeClamp ? 0.08 : 0.8 * scale), 2000));

    // Bar 42 (index 42, n-3): CHoCH impulse up establishing internal swing high
    const internalHigh = c1Low + (isFeeClamp ? 0.35 : 3.5 * scale);
    candles.push(createCandle(baseTime + 42 * 900, c1Low + (isFeeClamp ? 0.08 : 0.8 * scale), internalHigh, c1Low, c1Low + (isFeeClamp ? 0.30 : 3.0 * scale), 2500));

    // Bar 43 (index 43, n-2, prevCandle): Pullback retesting Golden Zone (50%-61.8% of dispRange)
    const dispRange = internalHigh - sweepLow;
    const fib50 = internalHigh - (0.50 * dispRange);
    const retestLow = fib50 - (isFeeClamp ? 0.03 : 0.2 * scale);
    candles.push(createCandle(baseTime + 43 * 900, c1Low + (isFeeClamp ? 0.30 : 3.0 * scale), internalHigh, retestLow, fib50 + (isFeeClamp ? 0.02 : 0.2 * scale), 1200));

    // Bar 44 (index 44, n-1, currentCandle): Bullish confirmation bounce closing inside C1 range
    const curOpen = fib50 + (isFeeClamp ? 0.02 : 0.2 * scale);
    const curLow = curOpen - (isFeeClamp ? 0.03 : 0.2 * scale);
    const curClose = c1Low + (isFeeClamp ? 0.25 : 2.8 * scale);
    // Break internal high on current candle to guarantee CHoCH and bullish reaction
    const curHigh = internalHigh + (isFeeClamp ? 0.05 : 0.2 * scale);
    candles.push(createCandle(baseTime + 44 * 900, curOpen, curHigh, curLow, curClose, 2800));

  } else {
    // BEARISH CRT SETUP
    // Bar 41 (index 41, n-4): Sweep candle purging C1 High
    const sweepHigh = c1High + tickSweep;
    const sweepLow = c1High - (isFeeClamp ? 0.15 : 1.0 * scale);
    candles.push(createCandle(baseTime + 41 * 900, c1High - (isFeeClamp ? 0.05 : 0.5 * scale), sweepHigh, sweepLow, c1High - (isFeeClamp ? 0.08 : 0.8 * scale), 2000));

    // Bar 42 (index 42, n-3): CHoCH impulse down establishing internal swing low
    const internalLow = c1High - (isFeeClamp ? 0.35 : 3.5 * scale);
    candles.push(createCandle(baseTime + 42 * 900, c1High - (isFeeClamp ? 0.08 : 0.8 * scale), c1High, internalLow, c1High - (isFeeClamp ? 0.30 : 3.0 * scale), 2500));

    // Bar 43 (index 43, n-2, prevCandle): Pullback retesting Golden Zone (50%-61.8% of dropRange)
    const dropRange = sweepHigh - internalLow;
    const dropFib50 = internalLow + (0.50 * dropRange);
    const retestHigh = dropFib50 + (isFeeClamp ? 0.03 : 0.2 * scale);
    candles.push(createCandle(baseTime + 43 * 900, c1High - (isFeeClamp ? 0.30 : 3.0 * scale), retestHigh, internalLow, dropFib50 - (isFeeClamp ? 0.02 : 0.2 * scale), 1200));

    // Bar 44 (index 44, n-1, currentCandle): Bearish confirmation rejection closing inside C1 range
    const curOpen = dropFib50 - (isFeeClamp ? 0.02 : 0.2 * scale);
    const curHigh = curOpen + (isFeeClamp ? 0.03 : 0.2 * scale);
    const curClose = c1High - (isFeeClamp ? 0.25 : 2.8 * scale);
    const curLow = internalLow - (isFeeClamp ? 0.05 : 0.2 * scale);
    candles.push(createCandle(baseTime + 44 * 900, curOpen, curHigh, curLow, curClose, 2800));
  }

  return candles;
}

export function generateSolano3008Candles(
  side: 'BUY' | 'SELL',
  options?: {
    vwapSlopeType?: 'UP' | 'DOWN' | 'FLAT' | 'SUB_FLAT';
    atrMultiplier?: number;
    basePrice?: number;
    clampFeeTest?: boolean;
  }
): KlinePoint[] {
  const basePrice = options?.basePrice ?? 100.0;
  const scale = options?.atrMultiplier ?? 1.0;
  const slopeType = options?.vwapSlopeType ?? (side === 'BUY' ? 'UP' : 'DOWN');
  const isFeeClamp = Boolean(options?.clampFeeTest);
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;

  let currentPrice = basePrice;
  let driftPerBar = 0;

  if (slopeType === 'UP') {
    driftPerBar = isFeeClamp ? 0.008 : (0.20 * scale);
  } else if (slopeType === 'DOWN') {
    driftPerBar = isFeeClamp ? -0.008 : (-0.20 * scale);
  } else if (slopeType === 'SUB_FLAT') {
    driftPerBar = 0.0003 * scale; // ~0.03% 10-bar slope (under 0.04% threshold)
  } else {
    driftPerBar = 0.0; // Perfectly flat
  }

  // Generate 58 bars of trending or flat market
  for (let i = 0; i < 58; i++) {
    currentPrice += driftPerBar;
    const spread = isFeeClamp ? 0.001 : (0.30 * scale);
    const open = currentPrice - (driftPerBar * 0.4);
    const close = currentPrice;
    const high = Math.max(open, close) + spread;
    const low = Math.min(open, close) - spread;
    candles.push(createCandle(baseTime + i * 900, open, high, low, close, 1000));
  }

  if (side === 'BUY' && slopeType === 'UP') {
    // Bar 58 (prevCandle, index 58): Pullback dipping into 9EMA / VWAP pocket
    const prevOpen = currentPrice;
    const prevLow = isFeeClamp ? (currentPrice - 0.02) : (currentPrice - 2.5 * scale);
    const prevClose = isFeeClamp ? (currentPrice - 0.005) : (currentPrice - 1.0 * scale);
    const prevHigh = isFeeClamp ? (currentPrice + 0.002) : (currentPrice + 0.2 * scale);
    candles.push(createCandle(baseTime + 58 * 900, prevOpen, prevHigh, prevLow, prevClose, 1200));

    // Bar 59 (currentCandle, index 59): Bullish strong bounce breaking prevHigh
    const curOpen = prevClose;
    const curLow = isFeeClamp ? (curOpen - 0.001) : (curOpen - 0.2 * scale);
    const curClose = isFeeClamp ? (prevHigh + 0.005) : (prevHigh + 0.6 * scale);
    const curHigh = curClose + (isFeeClamp ? 0.002 : 0.2 * scale);
    candles.push(createCandle(baseTime + 59 * 900, curOpen, curHigh, curLow, curClose, 2500));

  } else if (side === 'SELL' && slopeType === 'DOWN') {
    // Bar 58 (prevCandle, index 58): Pullback rally into 9EMA / VWAP pocket
    const prevOpen = currentPrice;
    const prevHigh = isFeeClamp ? (currentPrice + 0.02) : (currentPrice + 2.5 * scale);
    const prevClose = isFeeClamp ? (currentPrice + 0.005) : (currentPrice + 1.0 * scale);
    const prevLow = isFeeClamp ? (currentPrice - 0.002) : (currentPrice - 0.2 * scale);
    candles.push(createCandle(baseTime + 58 * 900, prevOpen, prevHigh, prevLow, prevClose, 1200));

    // Bar 59 (currentCandle, index 59): Bearish rejection breakdown breaking prevLow
    const curOpen = prevClose;
    const curHigh = isFeeClamp ? (curOpen + 0.001) : (curOpen + 0.2 * scale);
    const curClose = isFeeClamp ? (prevLow - 0.005) : (prevLow - 0.6 * scale);
    const curLow = curClose - (isFeeClamp ? 0.002 : 0.2 * scale);
    candles.push(createCandle(baseTime + 59 * 900, curOpen, curHigh, curLow, curClose, 2500));

  } else {
    // For flat or non-trigger tests
    candles.push(createCandle(baseTime + 58 * 900, currentPrice, currentPrice + 0.1, currentPrice - 0.1, currentPrice, 1000));
    candles.push(createCandle(baseTime + 59 * 900, currentPrice, currentPrice + 0.1, currentPrice - 0.1, currentPrice, 1000));
  }

  return candles;
}

// ============================================================================
// MAIN ADVERSARIAL TEST SUITE EXECUTION
// ============================================================================

export async function runAdversarialM2Suite(): Promise<void> {
  console.log(`\n${C_BOLD}${C_CYAN}======================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}  EMPIRICAL ADVERSARIAL STRESS TEST SUITE — MILESTONE 2 (CHALLENGER M2-1)${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}  Targets: Strategy 3007 (YT_CRT_SMC_ENGINE) & Strategy 3008 (YT_SOLANO_VWAP_ENGINE)${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}======================================================================${C_RESET}\n`);

  // ==========================================================================
  // SUITE 1: BILATERAL SYMMETRY (Assert both BUY and SELL trigger)
  // ==========================================================================
  console.log(`\n${C_BOLD}[SUITE 1: Bilateral Symmetry & Directional Unbiased Execution]${C_RESET}`);

  await runTest('Suite 1', 'ADV-M2.01', 'Port 3007: Triggers valid BUY on Bullish CRT Turtle Soup', () => {
    const candles = generateCrt3007Candles('BUY', { tickSweep: 1.5 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', `Expected BUY, got ${verdict.recommendedSide} (${verdict.reasons.join('; ')})`);
    assert(verdict.setupType === 'BULLISH_1H_CRT_TURTLE_SOUP', `Expected BULLISH_1H_CRT_TURTLE_SOUP, got ${verdict.setupType}`);
    assert(verdict.confidenceScore >= 70, `Confidence ${verdict.confidenceScore} < 70`);
    assert(verdict.entryPrice > 0, 'Entry price must be positive');
    assert(verdict.stopLossPrice < verdict.entryPrice, `Stop loss ${verdict.stopLossPrice} must be below entry ${verdict.entryPrice}`);
  });

  await runTest('Suite 1', 'ADV-M2.02', 'Port 3007: Triggers valid SELL on Bearish CRT Turtle Soup', () => {
    const candles = generateCrt3007Candles('SELL', { tickSweep: 1.5 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', `Expected SELL, got ${verdict.recommendedSide} (${verdict.reasons.join('; ')})`);
    assert(verdict.setupType === 'BEARISH_1H_CRT_TURTLE_SOUP', `Expected BEARISH_1H_CRT_TURTLE_SOUP, got ${verdict.setupType}`);
    assert(verdict.confidenceScore >= 70, `Confidence ${verdict.confidenceScore} < 70`);
    assert(verdict.entryPrice > 0, 'Entry price must be positive');
    assert(verdict.stopLossPrice > verdict.entryPrice, `Stop loss ${verdict.stopLossPrice} must be above entry ${verdict.entryPrice}`);
  });

  await runTest('Suite 1', 'ADV-M2.03', 'Port 3008: Triggers valid BUY on Bullish Solano VWAP + 9EMA Stacked Retest', () => {
    const candles = generateSolano3008Candles('BUY', { vwapSlopeType: 'UP' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', `Expected BUY, got ${verdict.recommendedSide} (${verdict.reasons.join('; ')})`);
    assert(verdict.setupType === 'BULLISH_VWAP_9EMA_STACKED_RETEST', `Expected BULLISH_VWAP_9EMA_STACKED_RETEST, got ${verdict.setupType}`);
    assert(verdict.confidenceScore >= 70, `Confidence ${verdict.confidenceScore} < 70`);
    assert(verdict.entryPrice > 0, 'Entry price must be positive');
    assert(verdict.stopLossPrice < verdict.entryPrice, `Stop loss ${verdict.stopLossPrice} must be below entry ${verdict.entryPrice}`);
  });

  await runTest('Suite 1', 'ADV-M2.04', 'Port 3008: Triggers valid SELL on Bearish Solano VWAP + 9EMA Stacked Retest', () => {
    const candles = generateSolano3008Candles('SELL', { vwapSlopeType: 'DOWN' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', `Expected SELL, got ${verdict.recommendedSide} (${verdict.reasons.join('; ')})`);
    assert(verdict.setupType === 'BEARISH_VWAP_9EMA_STACKED_RETEST', `Expected BEARISH_VWAP_9EMA_STACKED_RETEST, got ${verdict.setupType}`);
    assert(verdict.confidenceScore >= 70, `Confidence ${verdict.confidenceScore} < 70`);
    assert(verdict.entryPrice > 0, 'Entry price must be positive');
    assert(verdict.stopLossPrice > verdict.entryPrice, `Stop loss ${verdict.stopLossPrice} must be above entry ${verdict.entryPrice}`);
  });

  await runTest('Suite 1', 'ADV-M2.05', 'Registry Dispatch Port 3007: Preserves and forwards BUY signal and all 11 fields intact', () => {
    const candles = generateCrt3007Candles('BUY', { tickSweep: 1.5 });
    const regOutput = evaluateStrategyForPort(3007, 'ETHUSDT', candles);
    assert(regOutput.signal === 'BUY', `Expected registry signal BUY, got ${regOutput.signal}`);
    assert(typeof regOutput.confidenceScore === 'number' && regOutput.confidenceScore >= 70, 'Confidence score forwarded');
    assert(typeof regOutput.customSL === 'number' && regOutput.customSL > 0, 'customSL forwarded');
    assert(typeof regOutput.customTP === 'number' && regOutput.customTP > 0, 'customTP forwarded');
    assert(typeof regOutput.tp1Price === 'number' && regOutput.tp1Price > 0, 'tp1Price forwarded');
    assert(typeof regOutput.tp2Price === 'number' && regOutput.tp2Price > 0, 'tp2Price forwarded');
    assert(regOutput.tp1Ratio === 0.75, `tp1Ratio must be 0.75, got ${regOutput.tp1Ratio}`);
    assert(regOutput.tp2Ratio === 0.25, `tp2Ratio must be 0.25, got ${regOutput.tp2Ratio}`);
    assert(typeof regOutput.earlyBreakevenPrice === 'number' && regOutput.earlyBreakevenPrice > 0, 'earlyBreakevenPrice forwarded');
    assert(typeof regOutput.riskDistance === 'number' && regOutput.riskDistance > 0, 'riskDistance forwarded');
    assert(Boolean(regOutput.auditLog), 'auditLog forwarded');
  });

  await runTest('Suite 1', 'ADV-M2.06', 'Registry Dispatch Port 3007: Preserves and forwards SELL signal and all 11 fields intact', () => {
    const candles = generateCrt3007Candles('SELL', { tickSweep: 1.5 });
    const regOutput = evaluateStrategyForPort(3007, 'ETHUSDT', candles);
    assert(regOutput.signal === 'SELL', `Expected registry signal SELL, got ${regOutput.signal}`);
    assert(regOutput.tp1Ratio === 0.75, `tp1Ratio must be 0.75, got ${regOutput.tp1Ratio}`);
    assert(regOutput.tp2Ratio === 0.25, `tp2Ratio must be 0.25, got ${regOutput.tp2Ratio}`);
    assert(Boolean(regOutput.earlyBreakevenPrice), 'earlyBreakevenPrice present');
    assert(Boolean(regOutput.auditLog), 'auditLog forwarded');
  });

  await runTest('Suite 1', 'ADV-M2.07', 'Registry Dispatch Port 3008: Preserves and forwards BUY signal and all 11 fields intact', () => {
    const candles = generateSolano3008Candles('BUY', { vwapSlopeType: 'UP' });
    const regOutput = evaluateStrategyForPort(3008, 'SOLUSDT', candles);
    assert(regOutput.signal === 'BUY', `Expected registry signal BUY, got ${regOutput.signal}`);
    assert(typeof regOutput.confidenceScore === 'number' && regOutput.confidenceScore >= 70, 'Confidence score forwarded');
    assert(typeof regOutput.tp1Price === 'number' && regOutput.tp1Price > 0, 'tp1Price forwarded');
    assert(typeof regOutput.tp2Price === 'number' && regOutput.tp2Price > 0, 'tp2Price forwarded');
    assert(regOutput.tp1Ratio === 0.75, `tp1Ratio must be 0.75, got ${regOutput.tp1Ratio}`);
    assert(regOutput.tp2Ratio === 0.25, `tp2Ratio must be 0.25, got ${regOutput.tp2Ratio}`);
    assert(Boolean(regOutput.earlyBreakevenPrice), 'earlyBreakevenPrice present');
    assert(Boolean(regOutput.auditLog), 'auditLog forwarded');
  });

  await runTest('Suite 1', 'ADV-M2.08', 'Registry Dispatch Port 3008: Preserves and forwards SELL signal and all 11 fields intact', () => {
    const candles = generateSolano3008Candles('SELL', { vwapSlopeType: 'DOWN' });
    const regOutput = evaluateStrategyForPort(3008, 'SOLUSDT', candles);
    assert(regOutput.signal === 'SELL', `Expected registry signal SELL, got ${regOutput.signal}`);
    assert(regOutput.tp1Ratio === 0.75, `tp1Ratio must be 0.75, got ${regOutput.tp1Ratio}`);
    assert(regOutput.tp2Ratio === 0.25, `tp2Ratio must be 0.25, got ${regOutput.tp2Ratio}`);
    assert(Boolean(regOutput.earlyBreakevenPrice), 'earlyBreakevenPrice present');
    assert(Boolean(regOutput.auditLog), 'auditLog forwarded');
  });

  // ==========================================================================
  // SUITE 2: EXTREME ATR SURVIVAL (Tiny ATR clamp & Huge ATR overflow resilience)
  // ==========================================================================
  console.log(`\n${C_BOLD}[SUITE 2: Extreme ATR Survival (<0.05 Clamping & >1000 Overflow Resilience)]${C_RESET}`);

  await runTest('Suite 2', 'ADV-M2.09', 'Port 3007 BUY with Tiny ATR (<0.05): Clamps risk distance strictly to >= 0.45%', () => {
    const candles = generateCrt3007Candles('BUY', { clampFeeTest: true });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', 'Verdict should trigger BUY');
    const riskPct = verdict.riskDistance / verdict.entryPrice;
    assert(riskPct >= 0.00449, `Risk distance pct (${riskPct * 100}%) must be >= 0.45% fee floor`);
    assert(verdict.minSlDistancePct >= 0.00449, `minSlDistancePct field (${verdict.minSlDistancePct}) must be >= 0.0045`);
    const expectedMaxSL = verdict.entryPrice * (1 - 0.0045);
    assertCloseTo(verdict.stopLossPrice, expectedMaxSL, 0.01, 'Stop loss clamped to 0.45% floor');
  });

  await runTest('Suite 2', 'ADV-M2.10', 'Port 3007 SELL with Tiny ATR (<0.05): Clamps risk distance strictly to >= 0.45%', () => {
    const candles = generateCrt3007Candles('SELL', { clampFeeTest: true });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', 'Verdict should trigger SELL');
    const riskPct = verdict.riskDistance / verdict.entryPrice;
    assert(riskPct >= 0.00449, `Risk distance pct (${riskPct * 100}%) must be >= 0.45% fee floor`);
    assert(verdict.minSlDistancePct >= 0.00449, `minSlDistancePct field must be >= 0.0045`);
    const expectedMinSL = verdict.entryPrice * (1 + 0.0045);
    assertCloseTo(verdict.stopLossPrice, expectedMinSL, 0.01, 'Stop loss clamped to 0.45% ceiling');
  });

  await runTest('Suite 2', 'ADV-M2.11', 'Port 3008 BUY with Tiny ATR (<0.05): Clamps risk distance strictly to >= 0.45%', () => {
    const candles = generateSolano3008Candles('BUY', { clampFeeTest: true, vwapSlopeType: 'UP' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', 'Verdict should trigger BUY');
    const riskPct = verdict.riskDistance / verdict.entryPrice;
    assert(riskPct >= 0.00449, `Risk distance pct (${riskPct * 100}%) must be >= 0.45% fee floor`);
    assert(verdict.minSlDistancePct >= 0.00449, `minSlDistancePct field must be >= 0.0045`);
  });

  await runTest('Suite 2', 'ADV-M2.12', 'Port 3008 SELL with Tiny ATR (<0.05): Clamps risk distance strictly to >= 0.45%', () => {
    const candles = generateSolano3008Candles('SELL', { clampFeeTest: true, vwapSlopeType: 'DOWN' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', 'Verdict should trigger SELL');
    const riskPct = verdict.riskDistance / verdict.entryPrice;
    assert(riskPct >= 0.00449, `Risk distance pct (${riskPct * 100}%) must be >= 0.45% fee floor`);
    assert(verdict.minSlDistancePct >= 0.00449, `minSlDistancePct field must be >= 0.0045`);
  });

  await runTest('Suite 2', 'ADV-M2.13', 'Port 3007 BUY with Huge ATR (>1000): No overflow, valid finite prices, correct hierarchy', () => {
    // Base price = 50,000, scale = 1000 -> ATR ~ 2,500 > 1000
    const candles = generateCrt3007Candles('BUY', { basePrice: 50000, atrMultiplier: 1000, tickSweep: 1500 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', 'Verdict should trigger BUY');
    assert(Number.isFinite(verdict.entryPrice) && verdict.entryPrice > 0, 'Finite positive entry price');
    assert(Number.isFinite(verdict.stopLossPrice) && verdict.stopLossPrice > 0, 'Finite positive stop loss');
    assert(Number.isFinite(verdict.tp1Price) && verdict.tp1Price > verdict.entryPrice, 'Finite TP1 > entry');
    assert(Number.isFinite(verdict.tp2Price) && verdict.tp2Price >= verdict.tp1Price, 'Finite TP2 >= TP1');
    assert(verdict.stopLossPrice < verdict.entryPrice, 'SL < Entry');
    assert(verdict.auditLog?.atr > 1000, `ATR (${verdict.auditLog?.atr}) must exceed 1000`);
  });

  await runTest('Suite 2', 'ADV-M2.14', 'Port 3007 SELL with Huge ATR (>1000): No overflow, valid finite prices, correct hierarchy', () => {
    const candles = generateCrt3007Candles('SELL', { basePrice: 50000, atrMultiplier: 1000, tickSweep: 1500 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', 'Verdict should trigger SELL');
    assert(Number.isFinite(verdict.entryPrice) && verdict.entryPrice > 0, 'Finite positive entry price');
    assert(Number.isFinite(verdict.stopLossPrice) && verdict.stopLossPrice > verdict.entryPrice, 'Finite SL > entry');
    assert(Number.isFinite(verdict.tp1Price) && verdict.tp1Price < verdict.entryPrice, 'Finite TP1 < entry');
    assert(Number.isFinite(verdict.tp2Price) && verdict.tp2Price <= verdict.tp1Price, 'Finite TP2 <= TP1');
    assert(verdict.auditLog?.atr > 1000, `ATR (${verdict.auditLog?.atr}) must exceed 1000`);
  });

  await runTest('Suite 2', 'ADV-M2.15', 'Port 3008 BUY with Huge ATR (>1000): No overflow, valid finite prices, correct hierarchy', () => {
    const candles = generateSolano3008Candles('BUY', { basePrice: 50000, atrMultiplier: 1500, vwapSlopeType: 'UP' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', 'Verdict should trigger BUY');
    assert(Number.isFinite(verdict.entryPrice) && verdict.entryPrice > 0, 'Finite positive entry');
    assert(verdict.stopLossPrice < verdict.entryPrice, 'SL < Entry');
    assert(verdict.tp1Price > verdict.entryPrice, 'TP1 > Entry');
    assert(verdict.auditLog?.atr > 1000, `ATR (${verdict.auditLog?.atr}) must exceed 1000`);
  });

  await runTest('Suite 2', 'ADV-M2.16', 'Port 3008 SELL with Huge ATR (>1000): No overflow, valid finite prices, correct hierarchy', () => {
    const candles = generateSolano3008Candles('SELL', { basePrice: 50000, atrMultiplier: 1500, vwapSlopeType: 'DOWN' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', 'Verdict should trigger SELL');
    assert(Number.isFinite(verdict.entryPrice) && verdict.entryPrice > 0, 'Finite positive entry');
    assert(verdict.stopLossPrice > verdict.entryPrice, 'SL > Entry');
    assert(verdict.tp1Price < verdict.entryPrice, 'TP1 < Entry');
    assert(verdict.auditLog?.atr > 1000, `ATR (${verdict.auditLog?.atr}) must exceed 1000`);
  });

  // ==========================================================================
  // SUITE 3: 1-TICK VS 50-TICK SWEEPS (Sweep detection & Stop Placement)
  // ==========================================================================
  console.log(`\n${C_BOLD}[SUITE 3: 1-Tick vs 50-Tick Sweeps & Stop Loss Placement beyond Wick Extremes]${C_RESET}`);

  await runTest('Suite 3', 'ADV-M2.17', 'Port 3007: 1-tick micro-sweep of C1 Low triggers BUY & places SL beyond sweep wick', () => {
    // 1-tick sweep = 0.05 beyond C1 Low (100.00 -> 99.95)
    const candles = generateCrt3007Candles('BUY', { tickSweep: 0.05 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', `1-tick sweep must trigger BUY, got ${verdict.recommendedSide}`);
    assert(verdict.auditLog?.sweepMinLow <= 99.96, `Audit log sweepMinLow should be <= 99.95, got ${verdict.auditLog?.sweepMinLow}`);
    assert(verdict.stopLossPrice < verdict.auditLog?.sweepMinLow, 'Stop loss must be placed below sweep wick extreme');
  });

  await runTest('Suite 3', 'ADV-M2.18', 'Port 3007: 1-tick micro-sweep of C1 High triggers SELL & places SL beyond sweep wick', () => {
    // 1-tick sweep = 0.05 beyond C1 High (105.00 -> 105.05)
    const candles = generateCrt3007Candles('SELL', { tickSweep: 0.05 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', `1-tick sweep must trigger SELL, got ${verdict.recommendedSide}`);
    assert(verdict.auditLog?.sweepMaxHigh >= 105.04, `Audit log sweepMaxHigh should be >= 105.05, got ${verdict.auditLog?.sweepMaxHigh}`);
    assert(verdict.stopLossPrice > verdict.auditLog?.sweepMaxHigh, 'Stop loss must be placed above sweep wick extreme');
  });

  await runTest('Suite 3', 'ADV-M2.19', 'Port 3007: 50-tick deep blowout sweep of C1 Low triggers BUY with proportional SL', () => {
    // 50-tick sweep = 5.0 below C1 Low (100.00 -> 95.00)
    const candles = generateCrt3007Candles('BUY', { tickSweep: 5.0 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', `50-tick sweep must trigger BUY, got ${verdict.recommendedSide}`);
    assert(verdict.auditLog?.sweepMinLow <= 95.01, `Audit log sweepMinLow should reflect deep blowout <= 95.0, got ${verdict.auditLog?.sweepMinLow}`);
    // Raw SL formula: sweepMinLow - (0.20 * atr)
    const expectedRawSL = verdict.auditLog?.sweepMinLow - (0.20 * verdict.auditLog?.atr);
    assertCloseTo(verdict.stopLossPrice, expectedRawSL, 0.05, 'Stop loss reflects deep blowout low + 0.20 ATR buffer');
  });

  await runTest('Suite 3', 'ADV-M2.20', 'Port 3007: 50-tick deep blowout sweep of C1 High triggers SELL with proportional SL', () => {
    // 50-tick sweep = 5.0 above C1 High (105.00 -> 110.00)
    const candles = generateCrt3007Candles('SELL', { tickSweep: 5.0 });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', `50-tick sweep must trigger SELL, got ${verdict.recommendedSide}`);
    assert(verdict.auditLog?.sweepMaxHigh >= 109.99, `Audit log sweepMaxHigh reflects blowout >= 110.0, got ${verdict.auditLog?.sweepMaxHigh}`);
    const expectedRawSL = verdict.auditLog?.sweepMaxHigh + (0.20 * verdict.auditLog?.atr);
    assertCloseTo(verdict.stopLossPrice, expectedRawSL, 0.05, 'Stop loss reflects deep blowout high + 0.20 ATR buffer');
  });

  await runTest('Suite 3', 'ADV-M2.21', 'Port 3007: Non-swept C1 Low (touches within C1 but no sweep) correctly REJECTS BUY', () => {
    const candles = generateCrt3007Candles('BUY', { noSweep: true });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === null, `Expected rejection (null), got ${verdict.recommendedSide}`);
    assert(verdict.reasons.some(r => r.includes('No 1H CRT Turtle Soup')), 'Reason cites no setup');
  });

  await runTest('Suite 3', 'ADV-M2.22', 'Port 3007: Non-swept C1 High (touches within C1 but no sweep) correctly REJECTS SELL', () => {
    const candles = generateCrt3007Candles('SELL', { noSweep: true });
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === null, `Expected rejection (null), got ${verdict.recommendedSide}`);
    assert(verdict.reasons.some(r => r.includes('No 1H CRT Turtle Soup')), 'Reason cites no setup');
  });

  await runTest('Suite 3', 'ADV-M2.23', 'Port 3008: Retest pocket tap verifies SL placement under recent swing extreme', () => {
    const candles = generateSolano3008Candles('BUY', { vwapSlopeType: 'UP' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', 'Expected BUY');
    const recentLows = candles.slice(-8).map(c => c.low);
    const swingLow = Math.min(...recentLows);
    assert(verdict.stopLossPrice <= swingLow, `SL (${verdict.stopLossPrice}) must be <= swing low (${swingLow})`);
  });

  await runTest('Suite 3', 'ADV-M2.24', 'Port 3008: Retest pocket rally verifies SL placement above recent swing extreme', () => {
    const candles = generateSolano3008Candles('SELL', { vwapSlopeType: 'DOWN' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', 'Expected SELL');
    const recentHighs = candles.slice(-8).map(c => c.high);
    const swingHigh = Math.max(...recentHighs);
    assert(verdict.stopLossPrice >= swingHigh, `SL (${verdict.stopLossPrice}) must be >= swing high (${swingHigh})`);
  });

  // ==========================================================================
  // SUITE 4: MATHEMATICAL INVARIANTS AUDIT
  // ==========================================================================
  console.log(`\n${C_BOLD}[SUITE 4: Mathematical Invariants Audit (tp1Ratio, tp2Ratio, earlyBreakeven, minSlDistancePct)]${C_RESET}`);

  const invariantTestCases = [
    { port: 3007, side: 'BUY' as const, gen: () => generateCrt3007Candles('BUY') },
    { port: 3007, side: 'SELL' as const, gen: () => generateCrt3007Candles('SELL') },
    { port: 3008, side: 'BUY' as const, gen: () => generateSolano3008Candles('BUY') },
    { port: 3008, side: 'SELL' as const, gen: () => generateSolano3008Candles('SELL') },
  ];

  for (let idx = 0; idx < invariantTestCases.length; idx++) {
    const tc = invariantTestCases[idx];
    const testId = `ADV-M2.${25 + idx}`;
    await runTest('Suite 4', testId, `Mathematical Invariants Audit: Port ${tc.port} ${tc.side}`, () => {
      const candles = tc.gen();
      const verdict = tc.port === 3007 
        ? ytCrtSmc3007Engine.evaluateSetup('TEST', candles)
        : ytSolanoVwap3008Engine.evaluateSetup('TEST', candles);

      assert(verdict.recommendedSide === tc.side, `Verdict side ${verdict.recommendedSide} matches ${tc.side}`);

      // 1. tp1Ratio === 0.75
      assert(verdict.tp1Ratio === 0.75, `tp1Ratio must be strictly 0.75, got ${verdict.tp1Ratio}`);

      // 2. tp2Ratio === 0.25
      assert(verdict.tp2Ratio === 0.25, `tp2Ratio must be strictly 0.25, got ${verdict.tp2Ratio}`);

      // 3. minSlDistancePct >= 0.0045
      assert(verdict.minSlDistancePct >= 0.00449, `minSlDistancePct must be >= 0.0045, got ${verdict.minSlDistancePct}`);

      // 4. riskDistance calculation
      const calculatedRisk = Number(Math.abs(verdict.entryPrice - verdict.stopLossPrice).toFixed(4));
      assertCloseTo(verdict.riskDistance, calculatedRisk, 0.001, `riskDistance must equal |entry - SL|`);

      // 5. earlyBreakevenPrice === entry ± 0.75 * riskDistance
      const expectedBE = tc.side === 'BUY'
        ? Number((verdict.entryPrice + (verdict.riskDistance * 0.75)).toFixed(4))
        : Number((verdict.entryPrice - (verdict.riskDistance * 0.75)).toFixed(4));
      assertCloseTo(verdict.earlyBreakevenPrice, expectedBE, 0.001, `earlyBreakevenPrice must be +0.75R`);

      // 6. Monotonic ordering of targets
      if (tc.side === 'BUY') {
        assert(verdict.stopLossPrice < verdict.entryPrice, 'SL < Entry');
        assert(verdict.entryPrice < verdict.earlyBreakevenPrice, 'Entry < EarlyBE');
        assert(verdict.earlyBreakevenPrice < verdict.tp1Price, 'EarlyBE < TP1');
        assert(verdict.tp1Price <= verdict.tp2Price, 'TP1 <= TP2');
      } else {
        assert(verdict.stopLossPrice > verdict.entryPrice, 'SL > Entry');
        assert(verdict.entryPrice > verdict.earlyBreakevenPrice, 'Entry > EarlyBE');
        assert(verdict.earlyBreakevenPrice > verdict.tp1Price, 'EarlyBE > TP1');
        assert(verdict.tp1Price >= verdict.tp2Price, 'TP1 >= TP2');
      }
    });
  }

  // ==========================================================================
  // SUITE 5: FLAT VWAP FILTER BOUNDARY (Port 3008)
  // ==========================================================================
  console.log(`\n${C_BOLD}[SUITE 5: Port 3008 Flat VWAP Slope Boundary Stress-Testing]${C_RESET}`);

  await runTest('Suite 5', 'ADV-M2.29', 'Port 3008: Perfectly flat slope (0.000%) strictly blocked', () => {
    const candles = generateSolano3008Candles('BUY', { vwapSlopeType: 'FLAT' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === null, 'Flat VWAP must produce recommendedSide = null');
    assert(verdict.reasons.some(r => r.includes('FLAT VWAP RULE')), 'Reason notes FLAT VWAP RULE');
  });

  await runTest('Suite 5', 'ADV-M2.30', 'Port 3008: Sub-threshold micro-slope (0.03% < 0.04%) strictly blocked', () => {
    const candles = generateSolano3008Candles('BUY', { vwapSlopeType: 'SUB_FLAT' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === null, 'Sub-threshold VWAP slope must produce recommendedSide = null');
    assert(verdict.reasons.some(r => r.includes('FLAT VWAP RULE')), 'Reason cites FLAT VWAP RULE');
  });

  await runTest('Suite 5', 'ADV-M2.31', 'Port 3008: Active upward slope (+0.20% >= 0.04%) permits trade discovery', () => {
    const candles = generateSolano3008Candles('BUY', { vwapSlopeType: 'UP' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'BUY', 'Non-flat upward VWAP permits BUY');
    assert(verdict.auditLog?.vwapSlopePct >= 0.04, 'Slope in auditLog >= 0.04%');
  });

  await runTest('Suite 5', 'ADV-M2.32', 'Port 3008: Active downward slope (-0.20% <= -0.04%) permits trade discovery', () => {
    const candles = generateSolano3008Candles('SELL', { vwapSlopeType: 'DOWN' });
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === 'SELL', 'Non-flat downward VWAP permits SELL');
    assert(verdict.auditLog?.vwapSlopePct <= -0.04, 'Slope in auditLog <= -0.04%');
  });

  // ==========================================================================
  // SUITE 6: CHAOS INPUTS & BOUNDARY RESILIENCE
  // ==========================================================================
  console.log(`\n${C_BOLD}[SUITE 6: Chaos Inputs & Boundary Resilience (Null, Empty, Degenerate, Corrupted)]${C_RESET}`);

  await runTest('Suite 6', 'ADV-M2.33', 'Port 3007: Handles null candles array gracefully without crash', () => {
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', null as any);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(verdict.confidenceScore === 0, 'confidenceScore is 0');
    assert(verdict.reasons.length > 0, 'reason provided');
  });

  await runTest('Suite 6', 'ADV-M2.34', 'Port 3008: Handles null candles array gracefully without crash', () => {
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', null as any);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(verdict.confidenceScore === 0, 'confidenceScore is 0');
    assert(verdict.reasons.length > 0, 'reason provided');
  });

  await runTest('Suite 6', 'ADV-M2.35', 'Port 3007: Handles empty array [] gracefully', () => {
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', []);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(verdict.reasons.some(r => r.includes('<30 bars')), 'Cites <30 bars');
  });

  await runTest('Suite 6', 'ADV-M2.36', 'Port 3008: Handles empty array [] gracefully', () => {
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', []);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(verdict.reasons.some(r => r.includes('<35 bars')), 'Cites <35 bars');
  });

  await runTest('Suite 6', 'ADV-M2.37', 'Port 3007: Handles single candle gracefully', () => {
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', [createCandle(1000, 100, 101, 99, 100, 1000)]);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
  });

  await runTest('Suite 6', 'ADV-M2.38', 'Port 3008: Handles single candle gracefully', () => {
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', [createCandle(1000, 100, 101, 99, 100, 1000)]);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
  });

  await runTest('Suite 6', 'ADV-M2.39', 'Port 3007: Handles sub-threshold candle count (29 bars) cleanly', () => {
    const candles: KlinePoint[] = [];
    for (let i = 0; i < 29; i++) {
      candles.push(createCandle(1000 + i * 900, 100, 101, 99, 100, 1000));
    }
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(verdict.reasons.some(r => r.includes('<30 bars')), 'Cites <30 bars requirement');
  });

  await runTest('Suite 6', 'ADV-M2.40', 'Port 3008: Handles sub-threshold candle count (34 bars) cleanly', () => {
    const candles: KlinePoint[] = [];
    for (let i = 0; i < 34; i++) {
      candles.push(createCandle(1000 + i * 900, 100, 101, 99, 100, 1000));
    }
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(verdict.reasons.some(r => r.includes('<35 bars')), 'Cites <35 bars requirement');
  });

  await runTest('Suite 6', 'ADV-M2.41', 'Port 3007: Handles perfectly flat candles (0 volatility) without NaN or crash', () => {
    const flatCandles: KlinePoint[] = [];
    for (let i = 0; i < 45; i++) {
      flatCandles.push(createCandle(1000 + i * 900, 100, 100, 100, 100, 1000));
    }
    const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', flatCandles);
    assert(verdict.recommendedSide === null, 'recommendedSide is null');
    assert(!Number.isNaN(verdict.confidenceScore), 'Confidence score is not NaN');
    assert(verdict.reasons.some(r => r.includes('flat reference 1H candle range')), 'Cites flat range');
  });

  await runTest('Suite 6', 'ADV-M2.42', 'Port 3008: Handles zero volume candles without division by zero', () => {
    const zeroVolCandles: KlinePoint[] = [];
    for (let i = 0; i < 45; i++) {
      zeroVolCandles.push(createCandle(1000 + i * 900, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100.5 + i * 0.1, 0));
    }
    const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', zeroVolCandles);
    assert(!Number.isNaN(verdict.confidenceScore), 'Confidence score is not NaN');
    assert(!Number.isNaN(verdict.entryPrice), 'Entry price is not NaN');
  });

  await runTest('Suite 6', 'ADV-M2.43', 'Port 3007: Corrupted candle with NaN prices does not throw unhandled exception', () => {
    const candles = generateCrt3007Candles('BUY');
    candles[15] = createCandle(1000 + 15 * 900, NaN, NaN, NaN, NaN, 1000);
    let threw = false;
    try {
      const v = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
      assert(typeof v === 'object', 'Returned verdict object');
    } catch (e) {
      threw = true;
    }
    assert(!threw, 'Should handle NaN candle without unhandled exception');
  });

  await runTest('Suite 6', 'ADV-M2.44', 'Port 3008: Corrupted candle with Infinity does not throw unhandled exception', () => {
    const candles = generateSolano3008Candles('BUY');
    candles[10] = createCandle(1000 + 10 * 900, Infinity, Infinity, 100, 100, 1000);
    let threw = false;
    try {
      const v = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
      assert(typeof v === 'object', 'Returned verdict object');
    } catch (e) {
      threw = true;
    }
    assert(!threw, 'Should handle Infinity candle without unhandled exception');
  });

  // ==========================================================================
  // FINAL SCORECARD & SUMMARY
  // ==========================================================================
  const total = testResults.length;
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`\n${C_BOLD}${C_CYAN}======================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}  ADVERSARIAL STRESS TEST SUMMARY — MILESTONE 2${C_RESET}`);
  console.log(`${C_BOLD}  Total Tests Executed: ${total}${C_RESET}`);
  console.log(`  ${C_GREEN}Passed: ${passed}${C_RESET}`);
  console.log(`  ${failed > 0 ? C_RED : C_GREEN}Failed: ${failed}${C_RESET}`);
  console.log(`  ${C_BOLD}Pass Rate: ${passRate}%${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}======================================================================${C_RESET}\n`);

  if (failed > 0) {
    console.error(`${C_RED}ADVERSARIAL CHALLENGE FAILED: ${failed} test(s) failed.${C_RESET}`);
    process.exit(1);
  } else {
    console.log(`${C_GREEN}ALL EMPIRICAL ADVERSARIAL CHALLENGES PASSED SUCCESSFULLY!${C_RESET}`);
  }
}

// Direct execution entrypoint
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) || process.argv[1].includes('adversarial_milestone2_m2_1_stress')) {
  runAdversarialM2Suite().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
