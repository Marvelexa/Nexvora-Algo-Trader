/**
 * Independent Forensic Audit Test Suite — Milestone 2
 * Auditor: Forensic Auditor M2 (teamwork_auditor)
 * Scope:
 *  - lib/strategies/ytCrtSmc3007Engine.ts (Port 3007)
 *  - lib/strategies/ytSolanoVwap3008Engine.ts (Port 3008)
 *  - lib/strategies/ytSecretMacd3009Engine.ts (Port 3009)
 *  - lib/strategies/ytSidewaysRange3010Engine.ts (Port 3010)
 *  - lib/strategies/strategyRegistry.ts (Switch Cases 3007-3010)
 *  - master_cluster.mjs (Isolated Supervisor Topology)
 *  - Port 3001 Codebase Boundary Integrity
 */

import fs from 'node:fs';
import path from 'node:path';
import { ytCrtSmc3007Engine, YtCrtSmc3007Engine } from '../lib/strategies/ytCrtSmc3007Engine';
import { ytSolanoVwap3008Engine, YtSolanoVwap3008Engine } from '../lib/strategies/ytSolanoVwap3008Engine';
import { ytSecretMacd3009Engine, YtSecretMacd3009Engine } from '../lib/strategies/ytSecretMacd3009Engine';
import { ytSidewaysRange3010Engine, YtSidewaysRange3010Engine } from '../lib/strategies/ytSidewaysRange3010Engine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testId: string, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  PASS [${testId}] ${description}`);
  } else {
    failedTests++;
    console.error(`  FAIL [${testId}] ${description}`);
  }
}

console.log('\n================================================================================');
console.log('   FORENSIC AUDIT INTEGRITY SUITE — MILESTONE 2 DELIVERABLES                   ');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// CHECK 1: ANTI-CHEAT & AUTHENTICITY (DYNAMIC INDICATOR COMPUTATION)
// -----------------------------------------------------------------------------
console.log('--- CHECK 1: Anti-Cheat & Dynamic Indicator Computation ---');

// Helper to create synthetic baseline candles
function createBaseCandles(count: number, basePrice: number, step: number = 0.5): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const p = basePrice + i * step;
    candles.push({
      timestamp: now - (count - i) * 15 * 60 * 1000,
      open: p,
      high: p + 1.0,
      low: p - 1.0,
      close: p + 0.2,
      volume: 1000 + (i % 5) * 100,
    });
  }
  return candles;
}

// 1.1: Verify Dynamic sensitivity of Port 3007 (CRT Engine)
{
  const c1 = createBaseCandles(40, 100, 0.2);
  const c2 = createBaseCandles(40, 200, 0.4); // Doubled price scale
  const v1 = ytCrtSmc3007Engine.evaluateSetup('TEST', c1);
  const v2 = ytCrtSmc3007Engine.evaluateSetup('TEST', c2);

  assert(v1 !== undefined && v2 !== undefined, 'F1.01', 'Port 3007 returns structured verdict');
  // Perturbation test: Scaling input prices scales entryPrice and auditLog calculations
  assert(
    v1.entryPrice !== v2.entryPrice && Math.abs(v2.entryPrice - v1.entryPrice * 2) < 5,
    'F1.02',
    'Port 3007 entryPrice scales dynamically with input candle prices'
  );
}

// 1.2: Verify Dynamic sensitivity of Port 3008 (Solano VWAP Engine)
{
  const cBullish = createBaseCandles(48, 100, 1.0); // Upward trend
  const cFlat = createBaseCandles(48, 100, 0.0001); // Flat zero trend
  const vBull = ytSolanoVwap3008Engine.evaluateSetup('TEST', cBullish);
  const vFlat = ytSolanoVwap3008Engine.evaluateSetup('TEST', cFlat);

  assert(
    vFlat.recommendedSide === null && vFlat.reasons.some(r => r.includes('FLAT VWAP RULE')),
    'F1.03',
    'Port 3008 dynamically computes VWAP slope and halts on flat slope'
  );
  assert(
    vBull.reasons.length > 0 && !vBull.reasons.some(r => r.includes('FLAT VWAP RULE')),
    'F1.04',
    'Port 3008 accepts upward sloping VWAP without flat slope rejection'
  );
}

// 1.3: Verify Dynamic sensitivity of Port 3009 (Secret MACD Engine)
{
  function createWavyCandles(count: number, basePrice: number, slope: number): KlinePoint[] {
    const candles: KlinePoint[] = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const wave = Math.sin(i * 0.3) * 2;
      const p = basePrice + i * slope + wave;
      candles.push({
        timestamp: now - (count - i) * 15 * 60 * 1000,
        open: p,
        high: p + 1.5,
        low: p - 1.5,
        close: p + 0.3,
        volume: 1000 + (i % 5) * 200,
      });
    }
    return candles;
  }

  const cMacroBull = createWavyCandles(130, 100, 1.5); // 130 bars wavy rising
  const cMacroBear = createWavyCandles(130, 300, -1.5); // 130 bars wavy falling
  const vBull = ytSecretMacd3009Engine.evaluateSetup('TEST', cMacroBull);
  const vBear = ytSecretMacd3009Engine.evaluateSetup('TEST', cMacroBear);

  assert(
    vBull.auditLog.rule1_4h_macro_trend === 'BULLISH',
    'F1.05',
    'Port 3009 dynamically computes 4H macro trend as BULLISH for rising price series'
  );
  assert(
    vBear.auditLog.rule1_4h_macro_trend === 'BEARISH',
    'F1.06',
    'Port 3009 dynamically computes 4H macro trend as BEARISH for falling price series'
  );
}

// 1.4: Verify Dynamic sensitivity of Port 3010 (Sideways Range Engine)
{
  // Highly trending candles -> ADX >= 22
  const cTrending = createBaseCandles(50, 100, 3.0);
  const vTrend = ytSidewaysRange3010Engine.evaluateSetup('TEST', cTrending);
  assert(
    vTrend.auditLog.rule1_regime_adx >= 22 && vTrend.recommendedSide === null,
    'F1.07',
    `Port 3010 dynamically computes ADX (${vTrend.auditLog.rule1_regime_adx}) and halts when ADX >= 22`
  );

  // Oscillating range-bound candles -> ADX < 22
  const cOscillating: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const cycle = Math.sin(i * 0.5) * 5;
    cOscillating.push({
      timestamp: now - (50 - i) * 15 * 60 * 1000,
      open: 100 + cycle,
      high: 100 + cycle + 2,
      low: 100 + cycle - 2,
      close: 100 + cycle + 0.5,
      volume: 1000,
    });
  }
  const vRange = ytSidewaysRange3010Engine.evaluateSetup('TEST', cOscillating);
  assert(
    vRange.auditLog.rule1_regime_adx < 22 && vRange.auditLog.rule1_is_sideways === true,
    'F1.08',
    `Port 3010 dynamically computes ADX (${vRange.auditLog.rule1_regime_adx}) < 22 in oscillating market`
  );
}

// -----------------------------------------------------------------------------
// CHECK 2: RULE FAITHFULNESS & OVER-FILTER STRIPPING
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 2: Rule Faithfulness & Over-Filter Stripping ---');

const crtCode = fs.readFileSync(path.join(process.cwd(), 'lib/strategies/ytCrtSmc3007Engine.ts'), 'utf8');
const vwapCode = fs.readFileSync(path.join(process.cwd(), 'lib/strategies/ytSolanoVwap3008Engine.ts'), 'utf8');
const macdCode = fs.readFileSync(path.join(process.cwd(), 'lib/strategies/ytSecretMacd3009Engine.ts'), 'utf8');
const rangeCode = fs.readFileSync(path.join(process.cwd(), 'lib/strategies/ytSidewaysRange3010Engine.ts'), 'utf8');

// Port 3007 Over-Filters Stripped & Exact Video Formulas Present
assert(
  !crtCode.includes('c1Range < 1.4 * atr') && !crtCode.includes('curBody >= 0.75 * atr'),
  'F2.01',
  'Port 3007: 1.4x ATR compression choke and 0.75x ATR body choke are completely stripped'
);
assert(
  !crtCode.includes('HTFBilateralBiasGatekeeper'),
  'F2.02',
  'Port 3007: HTFBilateralBiasGatekeeper external gatekeeper is completely stripped'
);
assert(
  crtCode.includes('fib50') && crtCode.includes('fib618') && crtCode.includes('bullishTurtleSoup') && crtCode.includes('bearishTurtleSoup'),
  'F2.03',
  'Port 3007: Authentic Iqshant Ladha formulas present (Turtle Soup purge + Golden Zone Fib 50-61.8%)'
);

// Port 3008 Over-Filters Stripped & Exact Video Formulas Present
assert(
  !vwapCode.includes('Math.abs(vwapSlopePct) < 0.10') && !vwapCode.includes('curBody >= 0.65 * atr'),
  'F2.04',
  'Port 3008: 0.10% slope over-choke and 0.65x ATR body choke are completely stripped'
);
assert(
  !vwapCode.includes('HTFBilateralBiasGatekeeper'),
  'F2.05',
  'Port 3008: HTFBilateralBiasGatekeeper external gatekeeper is completely stripped'
);
assert(
  vwapCode.includes('FLAT_VWAP_THRESHOLD_PCT = 0.04') && vwapCode.includes('isEma9StackedBullish') && vwapCode.includes('isEma9StackedBearish'),
  'F2.06',
  'Port 3008: Authentic Sean Solano formulas present (0.04% flat slope boundary + stacked 9 EMA/VWAP)'
);

// Port 3009 Over-Filters Stripped & Exact Video Formulas Present
assert(
  !macdCode.includes('Math.abs(curMacdLine) < 0.15 * atr') && !macdCode.includes('curBody >= 0.65 * atr') && !macdCode.includes('curPrice > curEma50'),
  'F2.07',
  'Port 3009: Contradictory zero-pullback choke (|macd| < 0.15*atr), 0.65x body choke & 50 EMA choke stripped'
);
assert(
  !macdCode.includes('HTFBilateralBiasGatekeeper'),
  'F2.08',
  'Port 3009: HTFBilateralBiasGatekeeper external gatekeeper is completely stripped'
);
assert(
  macdCode.includes('Zero-Line Law') && macdCode.includes('macd4h') && macdCode.includes('macd1h') && macdCode.includes('macd15m'),
  'F2.09',
  'Port 3009: Authentic The Secret Mindset 3-Timeframe stack and Zero-Line Law implemented'
);

// Port 3010 Over-Filters Stripped & Exact Video Formulas Present
assert(
  !rangeCode.includes('adx < 20') && !rangeCode.includes('touchCount') && !rangeCode.includes('1.6 * atr'),
  'F2.10',
  'Port 3010: Rigid 2-touch barrier, adx < 20, and 1.6x ATR span choke stripped'
);
assert(
  rangeCode.includes('calculateADX') && rangeCode.includes('hasBreakoutCloseOutside') && rangeCode.includes('rangeMid'),
  'F2.11',
  'Port 3010: Authentic 30-bar box mapping, ADX < 22 sideways regime, and instant breakout deactivation present'
);

// -----------------------------------------------------------------------------
// CHECK 3: BILATERAL SYMMETRY (LONG & SHORT SIGNALS)
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 3: Bilateral Symmetry (Long & Short Signals) ---');

// Synthesize Port 3007 Bullish CRT Turtle Soup
function makeCrtBullishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  // 12 bars prior: define C1 range [95, 105] (mid = 100)
  for (let i = 0; i < 28; i++) {
    candles.push({ timestamp: now - (40 - i) * 15 * 60 * 1000, open: 100, high: 104, low: 96, close: 100, volume: 1000 });
  }
  // C1 Reference slice (bars n-12 to n-4)
  for (let i = 28; i < 36; i++) {
    candles.push({ timestamp: now - (40 - i) * 15 * 60 * 1000, open: 98, high: 105, low: 95, close: 102, volume: 1500 });
  }
  // Candle n-4: internal high setup
  candles.push({ timestamp: now - 4 * 15 * 60 * 1000, open: 101, high: 103, low: 99, close: 101, volume: 1000 });
  // Candle n-3: Turtle soup purge - sweeps C1 Low (95) down to 93.5 and closes at 96.5 (back inside C1!)
  candles.push({ timestamp: now - 3 * 15 * 60 * 1000, open: 99, high: 100, low: 93.5, close: 96.5, volume: 2500 });
  // Candle n-2: 5m CHoCH displacement leg up to 103.5
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 96.5, high: 103.5, low: 96.0, close: 103.0, volume: 2000 });
  // Candle n-1: Pullback retest into Golden Zone (50%-61.8% of 93.5..103.5 = 98.5 to 97.3), bounce close
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 101.5, high: 102.0, low: 98.0, close: 101.0, volume: 1800 });
  return candles;
}

// Synthesize Port 3007 Bearish CRT Turtle Soup
function makeCrtBearishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 28; i++) {
    candles.push({ timestamp: now - (40 - i) * 15 * 60 * 1000, open: 100, high: 104, low: 96, close: 100, volume: 1000 });
  }
  for (let i = 28; i < 36; i++) {
    candles.push({ timestamp: now - (40 - i) * 15 * 60 * 1000, open: 102, high: 105, low: 95, close: 98, volume: 1500 });
  }
  candles.push({ timestamp: now - 4 * 15 * 60 * 1000, open: 99, high: 101, low: 97, close: 99, volume: 1000 });
  // Turtle soup purge - sweeps C1 High (105) up to 106.5 and closes at 103.5 (inside C1)
  candles.push({ timestamp: now - 3 * 15 * 60 * 1000, open: 101, high: 106.5, low: 100, close: 103.5, volume: 2500 });
  // Displacement drop down to 96.5
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 103.5, high: 104.0, low: 96.5, close: 97.0, volume: 2000 });
  // Pullback rally into Golden Zone (101.5 to 102.7), rejection star
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 98.5, high: 102.0, low: 98.0, close: 99.0, volume: 1800 });
  return candles;
}

const crtBuy = ytCrtSmc3007Engine.evaluateSetup('TEST', makeCrtBullishCandles());
const crtSell = ytCrtSmc3007Engine.evaluateSetup('TEST', makeCrtBearishCandles());
assert(crtBuy.recommendedSide === 'BUY', 'F3.01', 'Port 3007 generates authentic BUY on Bullish CRT Turtle Soup');
assert(crtSell.recommendedSide === 'SELL', 'F3.02', 'Port 3007 generates authentic SELL on Bearish CRT Turtle Soup');

// Port 3008 Bilateral Verification
function makeSolanoBullishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 46; i++) {
    const p = 100 + i * 0.4;
    candles.push({ timestamp: now - (48 - i) * 15 * 60 * 1000, open: p, high: p + 1.5, low: p - 0.5, close: p + 0.3, volume: 2000 });
  }
  // Pullback tapping 9EMA / VWAP
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 118.5, high: 119.0, low: 117.0, close: 117.8, volume: 1200 });
  // Bullish bounce breaking pullback high
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 117.8, high: 120.0, low: 117.5, close: 119.5, volume: 3000 });
  return candles;
}

function makeSolanoBearishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 46; i++) {
    const p = 150 - i * 0.4;
    candles.push({ timestamp: now - (48 - i) * 15 * 60 * 1000, open: p, high: p + 0.5, low: p - 1.5, close: p - 0.3, volume: 2000 });
  }
  // Pullback rally tapping 9EMA / VWAP
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 131.5, high: 133.0, low: 131.0, close: 132.2, volume: 1200 });
  // Bearish rejection breaking pullback low
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 132.2, high: 132.5, low: 130.0, close: 130.5, volume: 3000 });
  return candles;
}

const solBuy = ytSolanoVwap3008Engine.evaluateSetup('TEST', makeSolanoBullishCandles());
const solSell = ytSolanoVwap3008Engine.evaluateSetup('TEST', makeSolanoBearishCandles());
assert(solBuy.recommendedSide === 'BUY', 'F3.03', 'Port 3008 generates authentic BUY on Bullish VWAP + 9 EMA Retest');
assert(solSell.recommendedSide === 'SELL', 'F3.04', 'Port 3008 generates authentic SELL on Bearish VWAP + 9 EMA Retest');

// Port 3009 Bilateral Verification
function makeMacdBullishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  // 120 bars rising trend to ensure 4H MACD > 0
  for (let i = 0; i < 125; i++) {
    const p = 100 + i * 0.3;
    candles.push({ timestamp: now - (130 - i) * 15 * 60 * 1000, open: p, high: p + 1.0, low: p - 0.5, close: p + 0.2, volume: 1500 });
  }
  // 3 bars small pullback near zero
  candles.push({ timestamp: now - 4 * 15 * 60 * 1000, open: 137.5, high: 138.0, low: 136.0, close: 136.5, volume: 1000 });
  candles.push({ timestamp: now - 3 * 15 * 60 * 1000, open: 136.5, high: 137.0, low: 135.5, close: 135.8, volume: 1000 });
  // Positive hist flip / cross
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 135.8, high: 136.5, low: 135.4, close: 136.2, volume: 1200 });
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 136.2, high: 138.5, low: 136.0, close: 138.0, volume: 2500 });
  return candles;
}

function makeMacdBearishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  // 120 bars declining trend to ensure 4H MACD < 0
  for (let i = 0; i < 125; i++) {
    const p = 200 - i * 0.3;
    candles.push({ timestamp: now - (130 - i) * 15 * 60 * 1000, open: p, high: p + 0.5, low: p - 1.0, close: p - 0.2, volume: 1500 });
  }
  // 3 bars small rally near zero
  candles.push({ timestamp: now - 4 * 15 * 60 * 1000, open: 162.5, high: 164.0, low: 162.0, close: 163.5, volume: 1000 });
  candles.push({ timestamp: now - 3 * 15 * 60 * 1000, open: 163.5, high: 164.5, low: 163.0, close: 164.2, volume: 1000 });
  // Negative hist flip / cross
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 164.2, high: 164.5, low: 163.5, close: 163.8, volume: 1200 });
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 163.8, high: 164.0, low: 161.5, close: 162.0, volume: 2500 });
  return candles;
}

const macdBuy = ytSecretMacd3009Engine.evaluateSetup('TEST', makeMacdBullishCandles());
const macdSell = ytSecretMacd3009Engine.evaluateSetup('TEST', makeMacdBearishCandles());
assert(macdBuy.recommendedSide === 'BUY', 'F3.05', 'Port 3009 generates authentic BUY under 4H MACD > 0 Zero-Line Law');
assert(macdSell.recommendedSide === 'SELL', 'F3.06', 'Port 3009 generates authentic SELL under 4H MACD < 0 Zero-Line Law');

// Port 3010 Bilateral Verification
function makeRangeBullishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  // 35 bars gentle sine oscillation inside [95, 105] (ADX < 22)
  for (let i = 0; i < 34; i++) {
    const cycle = Math.sin(i * 0.4) * 4;
    candles.push({ timestamp: now - (36 - i) * 15 * 60 * 1000, open: 100 + cycle, high: 103 + cycle, low: 97 + cycle, close: 100 + cycle, volume: 1000 });
  }
  // Setup: touches/pierces Range Low (94.5) and closes back inside (98) with lower rejection pinbar
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 98, high: 99, low: 94.5, close: 96.5, volume: 1100 });
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 96.5, high: 98.5, low: 95.0, close: 98.2, volume: 1200 });
  return candles;
}

function makeRangeBearishCandles(): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 34; i++) {
    const cycle = Math.sin(i * 0.4) * 4;
    candles.push({ timestamp: now - (36 - i) * 15 * 60 * 1000, open: 100 + cycle, high: 103 + cycle, low: 97 + cycle, close: 100 + cycle, volume: 1000 });
  }
  // Setup: touches/pierces Range High (105.5) and closes back inside (102) with upper rejection star
  candles.push({ timestamp: now - 2 * 15 * 60 * 1000, open: 102, high: 105.5, low: 101, close: 103.5, volume: 1100 });
  candles.push({ timestamp: now - 1 * 15 * 60 * 1000, open: 103.5, high: 105.0, low: 101.5, close: 101.8, volume: 1200 });
  return candles;
}

const rangeBuy = ytSidewaysRange3010Engine.evaluateSetup('TEST', makeRangeBullishCandles());
const rangeSell = ytSidewaysRange3010Engine.evaluateSetup('TEST', makeRangeBearishCandles());
assert(rangeBuy.recommendedSide === 'BUY', 'F3.07', 'Port 3010 generates authentic BUY on Range Low Support Bounce');
assert(rangeSell.recommendedSide === 'SELL', 'F3.08', 'Port 3010 generates authentic SELL on Range High Resistance Fade');

// -----------------------------------------------------------------------------
// CHECK 4: CAPITAL & FEE PROTECTION (MIN_SL_DISTANCE_PCT >= 0.0045)
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 4: Capital & Fee Protection ---');

const allVerdicts = [crtBuy, crtSell, solBuy, solSell, macdBuy, macdSell, rangeBuy, rangeSell];
for (let i = 0; i < allVerdicts.length; i++) {
  const v = allVerdicts[i];
  const slDistPct = Math.abs(v.entryPrice - v.stopLossPrice) / v.entryPrice;
  assert(
    slDistPct >= 0.00449,
    `F4.0${i + 1}`,
    `${v.strategyName} (${v.recommendedSide}): Stop Loss distance ${(slDistPct * 100).toFixed(3)}% >= 0.45% minimum floor`
  );
  assert(
    v.tp1Ratio === 0.75 && v.tp2Ratio === 0.25,
    `F4.1${i + 1}`,
    `${v.strategyName} (${v.recommendedSide}): Native 75% TP1 and 25% TP2 ratios strictly preserved`
  );
  const expectedBE = v.recommendedSide === 'BUY'
    ? Number((v.entryPrice + v.riskDistance * 0.75).toFixed(4))
    : Number((v.entryPrice - v.riskDistance * 0.75).toFixed(4));
  assert(
    Math.abs(v.earlyBreakevenPrice - expectedBE) < 0.05,
    `F4.2${i + 1}`,
    `${v.strategyName} (${v.recommendedSide}): Early Breakeven price at exact +0.75R milestone`
  );
}

// -----------------------------------------------------------------------------
// CHECK 5: PORT 3001 CODEBASE BOUNDARY (ZERO CONTAMINATION)
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 5: Port 3001 Codebase Boundary ---');

const port3001Files = [
  'server.ts',
  'vite.config.ts',
  '.env',
  '.delta_auto_trader_state_3001.json',
  'src/App.tsx',
  'src/types.ts',
  'src/components/DeltaAutoTraderCard.tsx',
];

const milestone2StartTime = new Date('2026-11-02T22:00:00+05:30').getTime();

for (let i = 0; i < port3001Files.length; i++) {
  const f = port3001Files[i];
  const fullPath = path.join(process.cwd(), f);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    const mtime = stat.mtime.getTime();
    assert(
      mtime < milestone2StartTime,
      `F5.0${i + 1}`,
      `Port 3001 file '${f}' LastWriteTime (${stat.mtime.toISOString()}) pre-dates Milestone 2 start`
    );
  }
}

// -----------------------------------------------------------------------------
// CHECK 6: STRATEGY REGISTRY FORWARDING INTEGRITY (11 FIELDS)
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 6: Strategy Registry Forwarding Integrity ---');

// Test strategyRegistry.evaluateStrategy for ports 3007, 3008, 3009, 3010
const registryTestCases = [
  { port: 3007, candles: makeCrtBullishCandles() },
  { port: 3008, candles: makeSolanoBullishCandles() },
  { port: 3009, candles: makeMacdBullishCandles() },
  { port: 3010, candles: makeRangeBullishCandles() },
];

for (const tc of registryTestCases) {
  const out = evaluateStrategyForPort(tc.port, 'TEST', tc.candles);
  assert(out.signal !== null, `F6.0${tc.port - 3006}a`, `Registry Case ${tc.port}: Evaluates and returns active signal`);
  assert(out.confidenceScore > 0, `F6.0${tc.port - 3006}b`, `Registry Case ${tc.port}: Confidence score forwarded (${out.confidenceScore})`);
  assert(typeof out.strategyName === 'string', `F6.0${tc.port - 3006}c`, `Registry Case ${tc.port}: Strategy name forwarded`);
  assert(out.customSL !== undefined && out.customSL > 0, `F6.0${tc.port - 3006}d`, `Registry Case ${tc.port}: customSL forwarded (${out.customSL})`);
  assert(out.customTP !== undefined && out.customTP > 0, `F6.0${tc.port - 3006}e`, `Registry Case ${tc.port}: customTP forwarded (${out.customTP})`);
  assert(out.tp1Price !== undefined && out.tp1Price > 0, `F6.0${tc.port - 3006}f`, `Registry Case ${tc.port}: tp1Price forwarded (${out.tp1Price})`);
  assert(out.tp2Price !== undefined && out.tp2Price > 0, `F6.0${tc.port - 3006}g`, `Registry Case ${tc.port}: tp2Price forwarded (${out.tp2Price})`);
  assert(out.tp1Ratio === 0.75, `F6.0${tc.port - 3006}h`, `Registry Case ${tc.port}: tp1Ratio forwarded (0.75)`);
  assert(out.tp2Ratio === 0.25, `F6.0${tc.port - 3006}i`, `Registry Case ${tc.port}: tp2Ratio forwarded (0.25)`);
  assert(out.earlyBreakevenPrice !== undefined && out.earlyBreakevenPrice > 0, `F6.0${tc.port - 3006}j`, `Registry Case ${tc.port}: earlyBreakevenPrice forwarded (${out.earlyBreakevenPrice})`);
  assert(out.riskDistance !== undefined && out.riskDistance > 0, `F6.0${tc.port - 3006}k`, `Registry Case ${tc.port}: riskDistance forwarded (${out.riskDistance})`);
  assert(out.reasons && out.reasons.length > 0, `F6.0${tc.port - 3006}l`, `Registry Case ${tc.port}: reasons array preserved`);
  assert(out.auditLog !== undefined, `F6.0${tc.port - 3006}m`, `Registry Case ${tc.port}: auditLog preserved`);
}

// -----------------------------------------------------------------------------
// CHECK 7: MASTER CLUSTER SUPERVISOR INVARIANTS
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 7: Master Cluster Supervisor Invariants ---');

const clusterContent = fs.readFileSync(path.join(process.cwd(), 'master_cluster.mjs'), 'utf8');

// Parse systems array in master_cluster.mjs
const systemPortMatches = [...clusterContent.matchAll(/port:\s*(300\d|301\d)/g)].map(m => parseInt(m[1]));
const uniquePorts = [...new Set(systemPortMatches)].sort((a, b) => a - b);

assert(
  uniquePorts.length === 9 && uniquePorts.every((p, i) => p === 3002 + i),
  'F7.01',
  `Supervisor configures exactly 9 isolated ports (3002 through 3010): [${uniquePorts.join(', ')}]`
);

assert(
  !uniquePorts.includes(3001) && clusterContent.includes('Port 3001 remains strictly untouched'),
  'F7.02',
  'Supervisor strictly excludes Port 3001, preserving baseline and dashboard untouched'
);

assert(
  clusterContent.includes('STATE_FILE: `.delta_auto_trader_state_${sys.port}.json`'),
  'F7.03',
  'Supervisor enforces dedicated isolated state file per port (.delta_auto_trader_state_${sys.port}.json)'
);

assert(
  clusterContent.includes('system_${sys.port}.log') && clusterContent.includes('system_${sys.port}_err.log'),
  'F7.04',
  'Supervisor enforces dedicated stdout and stderr log files per port'
);

assert(
  clusterContent.includes("TOTAL_CAPITAL_INR: '15000'") && clusterContent.includes("CAPITAL_INR: '15000'"),
  'F7.05',
  'Supervisor allocates ₹15,000 INR total capital per isolated port'
);

assert(
  clusterContent.includes("MAX_CONCURRENT_POSITIONS: '4'"),
  'F7.06',
  'Supervisor enforces 4 concurrent rolling risk slots across each port'
);

assert(
  clusterContent.includes("MARGIN_PER_SLOT_USD: '43.75'"),
  'F7.07',
  'Supervisor allocates $43.75 margin per slot (₹15,000 / 4 slots @ 84 INR/USD)'
);

assert(
  clusterContent.includes("LEVERAGE: '30'"),
  'F7.08',
  'Supervisor enforces 30x leverage across isolated ports'
);

// Summary
console.log('\n================================================================================');
console.log(`TOTAL FORENSIC AUDIT TESTS EXECUTED: ${totalTests}`);
console.log(`TESTS PASSED: ${passedTests}`);
console.log(`TESTS FAILED: ${failedTests}`);
console.log(`PASS RATE   : ${((passedTests / totalTests) * 100).toFixed(1)}%`);
console.log('================================================================================\n');

if (failedTests > 0) {
  console.error('❌ FORENSIC VERDICT: INTEGRITY VIOLATION');
  process.exit(1);
} else {
  console.log('✅ FORENSIC VERDICT: CLEAN');
  process.exit(0);
}
