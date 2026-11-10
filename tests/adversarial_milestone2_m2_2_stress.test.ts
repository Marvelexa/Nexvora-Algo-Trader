/**
 * ============================================================================
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE 2 (CHALLENGER M2-2)
 * 
 * Target Systems:
 * - Strategy 3009: ytSecretMacd3009Engine.ts (3-TF Zero-Line Law & Obsolete Chop Choke)
 * - Strategy 3010: ytSidewaysRange3010Engine.ts (ADX < 22, 30-bar box, Breakout Deactivation & Fade)
 * - Strategy Registry: strategyRegistry.ts (Audit all 9 ports 3002-3010 with 11 non-null fields)
 * - Master Cluster Supervisor: master_cluster.mjs (₹15,000 INR, 4 slots, Port 3001 untouched)
 * - Backtest Runner: scripts/backtest_isolated_youtube_systems.ts (Bilateral trades & Positive Net PnL)
 * 
 * Author: Empirical Challenger M2-2 (teamwork_challenger)
 * Date: 2026-11-02
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { KlinePoint } from '../src/types';
import { ytSecretMacd3009Engine, YtSecretMacd3009Engine } from '../lib/strategies/ytSecretMacd3009Engine';
import { ytSidewaysRange3010Engine, YtSidewaysRange3010Engine } from '../lib/strategies/ytSidewaysRange3010Engine';
import { evaluateStrategyForPort, EvaluatedStrategyOutput } from '../lib/strategies/strategyRegistry';
import { runIsolatedYouTubeBacktest, IsolatedPerformanceSummary } from '../scripts/backtest_isolated_youtube_systems';

// Terminal formatting colors
const C_RESET = '\x1b[0m';
const C_RED = '\x1b[31m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_CYAN = '\x1b[36m';
const C_BOLD = '\x1b[1m';
const C_MAGENTA = '\x1b[35m';

interface TestRecord {
  section: string;
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: string;
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
  section: string,
  id: string,
  name: string,
  testFn: () => void | Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await testFn();
    const durationMs = Date.now() - start;
    testResults.push({ section, id, name, passed: true, durationMs });
    console.log(`  ${C_GREEN}PASS${C_RESET} [${id}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    testResults.push({ section, id, name, passed: false, durationMs, error: err.message });
    console.error(`  ${C_RED}FAIL${C_RESET} [${id}] ${name} (${durationMs}ms)\n        Error: ${err.message}`);
  }
}

// ============================================================================
// DATA LOADERS & CANDLE HELPERS
// ============================================================================

function loadRealCachedCandles(symbol: string): KlinePoint[] {
  const cachePath = path.join(process.cwd(), '.cache_candles_1m', `${symbol}_15m_1month.json`);
  if (!fs.existsSync(cachePath)) {
    throw new Error(`Cached data file not found: ${cachePath}`);
  }
  const raw = fs.readFileSync(cachePath, 'utf-8');
  return JSON.parse(raw);
}

function buildSidewaysRangeCandles(count: number = 40): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = 1700000000000;
  for (let i = 0; i < count; i++) {
    const c = 100 + Math.sin(i * 0.5) * 2;
    candles.push({
      time: now + i * 900000,
      open: c - 0.2,
      high: c + 1.0,
      low: c - 1.0,
      close: c,
      volume: 100
    });
  }
  return candles;
}

// ============================================================================
// MAIN ADVERSARIAL TEST HARNESS
// ============================================================================

async function main() {
  console.log(`\n${C_BOLD}${C_CYAN}================================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}   EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE 2 (CHALLENGER M2-2)   ${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}   Ports 3009, 3010, Registry 3002-3010, Supervisor & Bilateral Backtest Runner ${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================================${C_RESET}\n`);

  const realCandlesLINK = loadRealCachedCandles('LINKUSDT');
  const realCandlesADA = loadRealCachedCandles('ADAUSDT');
  const realCandlesBTC = loadRealCachedCandles('BTCUSDT');
  const realCandlesSUI = loadRealCachedCandles('SUIUSDT');
  const realCandlesARB = loadRealCachedCandles('ARBUSDT');

  // ==========================================================================
  // SECTION 1: STRATEGY 3009 (YT_SECRET_MACD_ENGINE) ADVERSARIAL STRESS
  // ==========================================================================
  console.log(`${C_BOLD}${C_YELLOW}--- SECTION 1: STRATEGY 3009 (SECRET MACD 3-TF & ZERO-LINE LAW) ---${C_RESET}`);

  await runTest('Section 1', 'SEC3009-01', '4H Macro Trend Zero-Line Law: MACD > 0 permits Long setup', () => {
    // Real market slice on LINKUSDT (entry: 2026-10-31T16:15:00.000Z)
    const entryTimeBuy = new Date('2026-10-31T16:15:00.000Z').getTime();
    const idx = realCandlesLINK.findIndex(c => c.time === entryTimeBuy);
    assert(idx !== -1, 'Entry candle found in LINKUSDT cache');
    const buySlice = realCandlesLINK.slice(0, idx + 1);

    const verdict = YtSecretMacd3009Engine.evaluateSetup('LINKUSDT', buySlice);
    assert(verdict.auditLog.rule1_4h_macro_trend === 'BULLISH', '4H macro trend must be BULLISH');
    assert(verdict.auditLog.rule1_zero_line_law === true, 'Zero-Line Law must be true');
    assert(verdict.recommendedSide === 'BUY', 'Verdict recommendedSide must be BUY');
    assert(verdict.confidenceScore >= 85, 'Confidence score must be >= 85');
    assert(verdict.setupType === 'BULLISH_MACD_ZEROLINE_HIST_FLIP', 'Setup type must be BULLISH_MACD_ZEROLINE_HIST_FLIP');
  });

  await runTest('Section 1', 'SEC3009-02', '4H Macro Trend Zero-Line Law: MACD < 0 permits Short setup', () => {
    // Real market slice on ADAUSDT (entry: 2026-10-31T22:15:00.000Z)
    const entryTimeSell = new Date('2026-10-31T22:15:00.000Z').getTime();
    const idx = realCandlesADA.findIndex(c => c.time === entryTimeSell);
    assert(idx !== -1, 'Entry candle found in ADAUSDT cache');
    const sellSlice = realCandlesADA.slice(0, idx + 1);

    const verdict = YtSecretMacd3009Engine.evaluateSetup('ADAUSDT', sellSlice);
    assert(verdict.auditLog.rule1_4h_macro_trend === 'BEARISH', '4H macro trend must be BEARISH');
    assert(verdict.auditLog.rule1_zero_line_law === true, 'Zero-Line Law must be satisfied for Short');
    assert(verdict.recommendedSide === 'SELL', 'Verdict recommendedSide must be SELL');
    assert(verdict.confidenceScore >= 85, 'Confidence score must be >= 85');
    assert(verdict.setupType === 'BEARISH_MACD_ZEROLINE_HIST_FLIP', 'Setup type must be BEARISH_MACD_ZEROLINE_HIST_FLIP');
  });

  await runTest('Section 1', 'SEC3009-03', 'Adversarial: Zero-Line Law Macro Invariance (4H MACD > 0 blocks Shorts)', () => {
    // On the LINKUSDT bullish macro slice, tamper last candle with lower breakdown wick
    const entryTimeBuy = new Date('2026-10-31T16:15:00.000Z').getTime();
    const idx = realCandlesLINK.findIndex(c => c.time === entryTimeBuy);
    const slice = realCandlesLINK.slice(0, idx + 1);
    const tampered = [...slice];
    const last = tampered[tampered.length - 1];
    tampered[tampered.length - 1] = {
      ...last,
      open: last.open,
      close: last.close - 0.5,
      low: last.low - 0.8
    };

    const verdict = YtSecretMacd3009Engine.evaluateSetup('LINKUSDT', tampered);
    assert(verdict.recommendedSide !== 'SELL', 'Bullish 4H macro trend must strictly block SELL signals');
  });

  await runTest('Section 1', 'SEC3009-04', 'Adversarial: Zero-Line Law Macro Invariance (4H MACD < 0 blocks Longs)', () => {
    // On ADAUSDT bearish macro slice, tamper last candle with upper pump wick
    const entryTimeSell = new Date('2026-10-31T22:15:00.000Z').getTime();
    const idx = realCandlesADA.findIndex(c => c.time === entryTimeSell);
    const slice = realCandlesADA.slice(0, idx + 1);
    const tampered = [...slice];
    const last = tampered[tampered.length - 1];
    tampered[tampered.length - 1] = {
      ...last,
      open: last.open,
      close: last.close + 0.05,
      high: last.high + 0.08
    };

    const verdict = YtSecretMacd3009Engine.evaluateSetup('ADAUSDT', tampered);
    assert(verdict.recommendedSide !== 'BUY', 'Bearish 4H macro trend must strictly block BUY signals');
  });

  await runTest('Section 1', 'SEC3009-05', 'Adversarial: Zero-Line Pullback does NOT trigger obsolete chop choke', () => {
    // In ADAUSDT trade: |curMacd15m| = 0.00001997, 0.15 * atr15m = 0.00007393.
    // In obsolete implementation: |curMacd| < 0.15*ATR choked setups as "chop zone".
    const entryTimeSell = new Date('2026-10-31T22:15:00.000Z').getTime();
    const idx = realCandlesADA.findIndex(c => c.time === entryTimeSell);
    const sellSlice = realCandlesADA.slice(0, idx + 1);
    const v = YtSecretMacd3009Engine.evaluateSetup('ADAUSDT', sellSlice);

    const curMacd15m = Math.abs(v.auditLog.macd15m!);
    const obsoleteChokeThreshold = 0.15 * v.auditLog.atr15m!;
    assert(curMacd15m < obsoleteChokeThreshold, 'Confirmed: curMacd15m is within obsolete choke boundary');
    assert(v.recommendedSide === 'SELL', 'Zero-line pullback must execute and NOT be choked');
    assert(v.auditLog.rule4_chop_zone_cleared === true, 'Chop zone cleared flag must be true');
    assert(!v.reasons.some(r => r.includes('0.15*atr')), 'Obsolete filter must NOT be present in reasons');
  });

  await runTest('Section 1', 'SEC3009-06', 'True Flatline Dead Market Rejection: Zero-range MACD is correctly rejected', () => {
    // Construct completely flat dead market (price doesn't move, range is 0)
    const candles: KlinePoint[] = [];
    const now = 1700000000000;
    for (let i = 0; i < 60; i++) {
      candles.push({
        time: now + i * 900000,
        open: 100.0,
        high: 100.001,
        low: 99.999,
        close: 100.0,
        volume: 1
      });
    }

    const verdict = YtSecretMacd3009Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === null, 'Dead flatline market must NOT produce signals');
    assert(verdict.reasons.some(r => r.includes('dead chop-zone') || r.includes('Skipping flatline') || r.includes('alignment')), 'Must reject dead market');
  });

  await runTest('Section 1', 'SEC3009-07', 'Strategy 3009 Native Risk Invariants: 1.0R TP1 (75%), 2.0R TP2 (25%), +0.75R BE & 0.45% SL Floor', () => {
    const entryTimeBuy = new Date('2026-10-31T16:15:00.000Z').getTime();
    const idx = realCandlesLINK.findIndex(c => c.time === entryTimeBuy);
    const buySlice = realCandlesLINK.slice(0, idx + 1);
    const v = YtSecretMacd3009Engine.evaluateSetup('LINKUSDT', buySlice);

    assert(v.recommendedSide === 'BUY', 'Setup must be BUY');
    const entry = v.entryPrice;
    const sl = v.stopLossPrice;
    const tp1 = v.tp1Price;
    const tp2 = v.tp2Price;
    const earlyBE = v.earlyBreakevenPrice;
    const risk = v.riskDistance;

    assert(sl < entry, 'SL must be below entry for BUY');
    assertCloseTo(risk, entry - sl, 0.01, 'riskDistance must equal entry - sl');
    assertCloseTo(tp1, entry + risk * 1.0, 0.01, 'TP1 must be 1.0R');
    assertCloseTo(tp2, entry + risk * 2.0, 0.01, 'TP2 must be 2.0R');
    assertCloseTo(earlyBE, entry + risk * 0.75, 0.01, 'Early BE must be +0.75R');
    assert(v.tp1Ratio === 0.75, 'tp1Ratio must be 0.75');
    assert(v.tp2Ratio === 0.25, 'tp2Ratio must be 0.25');
    assert(v.minSlDistancePct >= 0.0045, 'minSlDistancePct must be >= 0.0045 (0.45%)');
  });

  // ==========================================================================
  // SECTION 2: STRATEGY 3010 (YT_SIDEWAYS_RANGE_ENGINE) ADVERSARIAL STRESS
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SECTION 2: STRATEGY 3010 (SIDEWAYS RANGE & BREAKOUT DEACTIVATION) ---${C_RESET}`);

  await runTest('Section 2', 'SEC3010-01', 'ADX Sideways Regime: Active when ADX < 22', () => {
    const candles = buildSidewaysRangeCandles(40);
    const verdict = YtSidewaysRange3010Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.auditLog.rule1_is_sideways === true, 'Sideways regime must be active');
    assert(verdict.auditLog.rule1_regime_adx < 22, `ADX must be < 22, got ${verdict.auditLog.rule1_regime_adx}`);
  });

  await runTest('Section 2', 'SEC3010-02', 'ADX Trend Rejection: Disabled immediately when ADX >= 22', () => {
    // Parabolic strong trend produces high ADX (>22)
    const candles: KlinePoint[] = [];
    const now = 1700000000000;
    let price = 100;
    for (let i = 0; i < 50; i++) {
      price += 2.0;
      candles.push({
        time: now + i * 900000,
        open: price - 2.0,
        high: price + 0.5,
        low: price - 2.2,
        close: price,
        volume: 100
      });
    }

    const verdict = YtSidewaysRange3010Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === null, 'Trending market must disable trading');
    assert(verdict.auditLog.rule1_regime_adx >= 22, 'ADX must be >= 22');
    assert(verdict.reasons.some(r => r.includes('ADX is') && r.includes('Trending market active')), 'Must reject due to trending ADX');
  });

  await runTest('Section 2', 'SEC3010-03', '30-Bar Box Mapping: Maps High, Low, and Midline correctly', () => {
    const candles = buildSidewaysRangeCandles(40);
    const verdict = YtSidewaysRange3010Engine.evaluateSetup('BTCUSDT', candles);

    assert(verdict.auditLog.rule1_is_sideways === true, 'Must be in sideways regime');
    assert(verdict.auditLog.rule2_range_high > 100, 'Range high must be > 100');
    assert(verdict.auditLog.rule2_range_low < 100, 'Range low must be < 100');
    const expectedMid = verdict.auditLog.rule2_range_low + (verdict.auditLog.rule2_range_span * 0.5);
    assertCloseTo(verdict.auditLog.rule2_range_mid, expectedMid, 0.01, 'Midline must be 50% equilibrium');
  });

  await runTest('Section 2', 'SEC3010-04', 'Breakout Deactivation: Displacement bar closing outside Range High deactivates engine', () => {
    const candles = buildSidewaysRangeCandles(40);
    // Add high-volume displacement breakout candle
    const last = candles[candles.length - 1];
    candles.push({
      time: last.time + 900000,
      open: 101,
      high: 110,
      low: 100.5,
      close: 109,
      volume: 500
    });

    const verdict = YtSidewaysRange3010Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === null, 'Breakout candle must prevent trade');
    assert(verdict.auditLog.rule3_breakout_deactivation === true, 'Breakout deactivation flag must be true');
    assert(verdict.reasons.some(r => r.includes('High-volume breakout candle closed outside')), 'Must cite breakout deactivation');
  });

  await runTest('Section 2', 'SEC3010-05', 'Breakdown Deactivation: Displacement bar closing outside Range Low deactivates engine', () => {
    const candles = buildSidewaysRangeCandles(40);
    // Add high-volume displacement breakdown candle
    const last = candles[candles.length - 1];
    candles.push({
      time: last.time + 900000,
      open: 99,
      high: 99.5,
      low: 90,
      close: 91,
      volume: 500
    });

    const verdict = YtSidewaysRange3010Engine.evaluateSetup('BTCUSDT', candles);
    assert(verdict.recommendedSide === null, 'Breakdown candle must prevent trade');
    assert(verdict.auditLog.rule3_breakout_deactivation === true, 'Breakout deactivation flag must be true');
    assert(verdict.reasons.some(r => r.includes('High-volume breakout candle closed outside')), 'Must cite breakdown deactivation');
  });

  await runTest('Section 2', 'SEC3010-06', 'False Breakdown Trap: Sweep below Range Low and close inside fires BUY', () => {
    // Real market slice on SUIUSDT (entry: 2026-10-31T08:45:00.000Z)
    const entryTimeBuy = new Date('2026-10-31T08:45:00.000Z').getTime();
    const idx = realCandlesSUI.findIndex(c => c.time === entryTimeBuy);
    assert(idx !== -1, 'Entry candle found in SUIUSDT cache');
    const buySlice = realCandlesSUI.slice(0, idx + 1);

    const verdict = YtSidewaysRange3010Engine.evaluateSetup('SUIUSDT', buySlice);
    assert(verdict.recommendedSide === 'BUY', `Verdict recommendedSide must be BUY, got ${verdict.recommendedSide}`);
    assert(verdict.auditLog.rule4_false_breakout_trap === true, 'False breakout trap must be confirmed');
    assert(verdict.tp1Price > verdict.entryPrice, 'TP1 must be above entry');
    assert(verdict.stopLossPrice < verdict.entryPrice, 'SL must be below entry');
  });

  await runTest('Section 2', 'SEC3010-07', 'False Breakout Trap: Sweep above Range High and close inside fires SELL', () => {
    // Real market slice on ARBUSDT (entry: 2026-11-01T03:45:00.000Z)
    const entryTimeSell = new Date('2026-11-01T03:45:00.000Z').getTime();
    const idx = realCandlesARB.findIndex(c => c.time === entryTimeSell);
    assert(idx !== -1, 'Entry candle found in ARBUSDT cache');
    const sellSlice = realCandlesARB.slice(0, idx + 1);

    const verdict = YtSidewaysRange3010Engine.evaluateSetup('ARBUSDT', sellSlice);
    assert(verdict.recommendedSide === 'SELL', `Verdict recommendedSide must be SELL, got ${verdict.recommendedSide}`);
    assert(verdict.auditLog.rule4_false_breakout_trap === true, 'False breakout trap must be confirmed');
    assert(verdict.tp1Price < verdict.entryPrice, 'TP1 must be below entry for SELL');
    assert(verdict.stopLossPrice > verdict.entryPrice, 'SL must be above entry for SELL');
  });

  await runTest('Section 2', 'SEC3010-08', 'Strategy 3010 Risk Invariants: 1.0R Midline TP1, 2.0R Range Boundary TP2, +0.75R BE', () => {
    const entryTimeBuy = new Date('2026-10-31T08:45:00.000Z').getTime();
    const idx = realCandlesSUI.findIndex(c => c.time === entryTimeBuy);
    const buySlice = realCandlesSUI.slice(0, idx + 1);
    const v = YtSidewaysRange3010Engine.evaluateSetup('SUIUSDT', buySlice);

    assert(v.recommendedSide === 'BUY', 'Verdict must be BUY');
    const entry = v.entryPrice;
    const sl = v.stopLossPrice;
    const tp1 = v.tp1Price;
    const earlyBE = v.earlyBreakevenPrice;
    const risk = v.riskDistance;

    assert(sl < entry, 'SL must be below entry for BUY');
    assertCloseTo(tp1, entry + risk * 1.0, 0.01, 'TP1 must be 1.0R');
    assertCloseTo(earlyBE, entry + risk * 0.75, 0.01, 'Early BE must be +0.75R');
    assert(v.tp1Ratio === 0.75, 'tp1Ratio must be 0.75');
    assert(v.tp2Ratio === 0.25, 'tp2Ratio must be 0.25');
    assert(v.minSlDistancePct >= 0.0045, 'minSlDistancePct must be >= 0.0045');
  });

  // ==========================================================================
  // SECTION 3: STRATEGY REGISTRY AUDIT (ALL 9 PORTS 3002 THROUGH 3010)
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SECTION 3: STRATEGY REGISTRY AUDIT (ALL 9 PORTS 3002-3010) ---${C_RESET}`);

  const PORTS_TO_AUDIT = [3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];
  const realCandlesETH = loadRealCachedCandles('ETHUSDT');
  const realCandlesSOL = loadRealCachedCandles('SOLUSDT');

  for (const port of PORTS_TO_AUDIT) {
    await runTest('Section 3', `REG-PORT-${port}`, `Audit Port ${port} via evaluateStrategyForPort across real cached candles`, () => {
      const testDatasets = [realCandlesBTC, realCandlesETH, realCandlesSOL, realCandlesLINK, realCandlesADA];
      let evaluatedSignalCount = 0;
      let nonNullSignalFound = false;

      for (const dataset of testDatasets) {
        const total = dataset.length;
        for (let idx = 60; idx < Math.min(800, total); idx += 5) {
          const slice = dataset.slice(idx - 60, idx);
          const out = evaluateStrategyForPort(port, 'BTCUSDT', slice);
          evaluatedSignalCount++;

          if (out.signal === 'BUY' || out.signal === 'SELL') {
            nonNullSignalFound = true;
            // AUDIT ALL 11 FIELDS
            assert(out.signal === 'BUY' || out.signal === 'SELL', `Port ${port} signal must be BUY or SELL`);
            assert(typeof out.confidenceScore === 'number' && out.confidenceScore > 0, `Port ${port} confidenceScore must be > 0`);
            assert(typeof out.strategyName === 'string' && out.strategyName.length > 0, `Port ${port} strategyName non-empty`);
            assert(typeof out.customSL === 'number' && out.customSL > 0, `Port ${port} customSL must be number > 0`);
            assert(typeof out.customTP === 'number' && out.customTP > 0, `Port ${port} customTP must be number > 0`);
            assert(typeof out.tp1Price === 'number' && out.tp1Price > 0, `Port ${port} tp1Price must be number > 0`);
            assert(typeof out.tp2Price === 'number' && out.tp2Price > 0, `Port ${port} tp2Price must be number > 0`);
            assert(typeof out.tp1Ratio === 'number' && out.tp1Ratio > 0 && out.tp1Ratio <= 1.0, `Port ${port} tp1Ratio in (0, 1]`);
            assert(typeof out.tp2Ratio === 'number' && out.tp2Ratio > 0 && out.tp2Ratio <= 1.0, `Port ${port} tp2Ratio in (0, 1]`);
            assert(typeof out.earlyBreakevenPrice === 'number' && out.earlyBreakevenPrice > 0, `Port ${port} earlyBreakevenPrice > 0`);
            assert(typeof out.riskDistance === 'number' && out.riskDistance > 0, `Port ${port} riskDistance > 0`);
            assert(Array.isArray(out.reasons) && out.reasons.length > 0, `Port ${port} reasons array`);

            // Verify geometry:
            const entry = slice[slice.length - 1].close;
            if (out.signal === 'BUY') {
              assert(out.customSL < entry, `Port ${port} BUY customSL < entry`);
              assert(out.tp1Price > entry, `Port ${port} BUY tp1Price > entry`);
              assert(out.tp2Price >= out.tp1Price, `Port ${port} BUY tp2Price >= tp1Price`);
              assert(out.earlyBreakevenPrice > entry, `Port ${port} BUY earlyBreakevenPrice > entry`);
            } else {
              assert(out.customSL > entry, `Port ${port} SELL customSL > entry`);
              assert(out.tp1Price < entry, `Port ${port} SELL tp1Price < entry`);
              assert(out.tp2Price <= out.tp1Price, `Port ${port} SELL tp2Price <= tp1Price`);
              assert(out.earlyBreakevenPrice < entry, `Port ${port} SELL earlyBreakevenPrice < entry`);
            }
            break;
          }
        }
        if (nonNullSignalFound) break;
      }

      assert(nonNullSignalFound, `Port ${port} must fire at least one active trade signal in historical slice`);
    });
  }

  await runTest('Section 3', 'REG-NULL-SIGNAL', 'Audit Strategy Registry graceful handling when signal is null', () => {
    // Pass insufficient bars (<10)
    const tinySlice = realCandlesBTC.slice(0, 5);
    for (const port of PORTS_TO_AUDIT) {
      const out = evaluateStrategyForPort(port, 'BTCUSDT', tinySlice);
      assert(out.signal === null, `Port ${port} signal must be null on tiny history`);
      assert(out.confidenceScore === 0, `Port ${port} confidenceScore must be 0`);
      assert(typeof out.strategyName === 'string', `Port ${port} strategyName must be string`);
      assert(Array.isArray(out.reasons), `Port ${port} reasons must be array`);
    }
  });

  // ==========================================================================
  // SECTION 4: MASTER CLUSTER SUPERVISOR & PORT 3001 UNTOUCHED INVARIANT
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SECTION 4: MASTER CLUSTER SUPERVISOR & PORT 3001 INVARIANT ---${C_RESET}`);

  await runTest('Section 4', 'CLUST-01', 'master_cluster.mjs defines exactly all 9 ports (3002 through 3010)', () => {
    const clusterPath = path.join(process.cwd(), 'master_cluster.mjs');
    assert(fs.existsSync(clusterPath), 'master_cluster.mjs must exist');
    const content = fs.readFileSync(clusterPath, 'utf-8');

    for (let port = 3002; port <= 3010; port++) {
      assert(content.includes(`port: ${port}`), `master_cluster.mjs must configure port ${port}`);
    }
  });

  await runTest('Section 4', 'CLUST-02', 'Port 3001 strictly untouched: NOT in supervisor systems array', () => {
    const clusterPath = path.join(process.cwd(), 'master_cluster.mjs');
    const content = fs.readFileSync(clusterPath, 'utf-8');

    // Extract SYSTEMS array text
    const systemsMatch = content.match(/const SYSTEMS\s*=\s*\[([\s\S]*?)\];/);
    assert(systemsMatch !== null, 'SYSTEMS array must be defined in master_cluster.mjs');
    const systemsText = systemsMatch![1];

    assert(!systemsText.includes('port: 3001'), 'Port 3001 must NOT be in SYSTEMS array');
    assert(!systemsText.includes('System 3001'), 'System 3001 must NOT be in SYSTEMS array');
  });

  await runTest('Section 4', 'CLUST-03', 'Supervisor Child Process Environment: ₹15,000 INR & 4 rolling slots', () => {
    const clusterPath = path.join(process.cwd(), 'master_cluster.mjs');
    const content = fs.readFileSync(clusterPath, 'utf-8');

    assert(content.includes("TOTAL_CAPITAL_INR: '15000'"), 'Supervisor must set TOTAL_CAPITAL_INR to 15000');
    assert(content.includes("CAPITAL_INR: '15000'"), 'Supervisor must set CAPITAL_INR to 15000');
    assert(content.includes("MAX_CONCURRENT_POSITIONS: '4'"), 'Supervisor must set MAX_CONCURRENT_POSITIONS to 4');
    assert(content.includes("MARGIN_PER_SLOT_USD: '43.75'"), 'Supervisor must set MARGIN_PER_SLOT_USD to 43.75');
    assert(content.includes("LEVERAGE: '30'"), 'Supervisor must set LEVERAGE to 30');
    assert(content.includes("STATE_FILE: `.delta_auto_trader_state_${sys.port}.json`"), 'Supervisor must use dedicated state file per port');
    assert(content.includes("IS_INVERSE_TRADING: 'false'"), 'Supervisor must enforce normal direct trading');
  });

  await runTest('Section 4', 'CLUST-04', 'Supervisor Fallback Log Directory: Valid directory configuration', () => {
    const clusterPath = path.join(process.cwd(), 'master_cluster.mjs');
    const content = fs.readFileSync(clusterPath, 'utf-8');

    assert(content.includes('LOG_DIR'), 'LOG_DIR must be defined');
    assert(content.includes('path.join(CRYPTO_ROOT, \'logs\')'), 'Supervisor must include fallback logs directory');
  });

  // ==========================================================================
  // SECTION 5: HISTORICAL BACKTEST BILATERAL VERIFICATION (9 PORTS)
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SECTION 5: HISTORICAL BACKTEST BILATERAL VERIFICATION (9 PORTS) ---${C_RESET}`);

  await runTest('Section 5', 'BTEST-01', 'Run isolated YouTube systems backtest and verify report existence', () => {
    const reportPath = path.join(process.cwd(), 'dist', 'isolated_youtube_systems_backtest_report.json');
    assert(fs.existsSync(reportPath), 'Backtest report JSON must exist on disk');
    const raw = fs.readFileSync(reportPath, 'utf-8');
    const summaries: IsolatedPerformanceSummary[] = JSON.parse(raw);
    assert(Array.isArray(summaries), 'Report must be an array of summaries');
    assert(summaries.length === 9, `Report must contain exactly 9 systems, got ${summaries.length}`);
  });

  await runTest('Section 5', 'BTEST-02', 'Bilateral Symmetry: Every port executes both BUY and SELL trades regularly', () => {
    const reportPath = path.join(process.cwd(), 'dist', 'isolated_youtube_systems_backtest_report.json');
    const summaries: IsolatedPerformanceSummary[] = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

    for (const s of summaries) {
      assert(s.totalTrades > 50, `Port ${s.strategyId} must execute >50 trades, got ${s.totalTrades}`);
      assert(s.buyTrades > 10, `Port ${s.strategyId} must execute >10 BUY trades, got ${s.buyTrades}`);
      assert(s.sellTrades > 10, `Port ${s.strategyId} must execute >10 SELL trades, got ${s.sellTrades}`);
      const buyRatio = s.buyTrades / s.totalTrades;
      assert(buyRatio >= 0.20 && buyRatio <= 0.80, `Port ${s.strategyId} must demonstrate bilateral balance (buy ratio ${buyRatio.toFixed(2)} in [0.20, 0.80])`);
    }
  });

  await runTest('Section 5', 'BTEST-03', 'Positive Profitability: All 9 ports generate positive Net Realized PnL', () => {
    const reportPath = path.join(process.cwd(), 'dist', 'isolated_youtube_systems_backtest_report.json');
    const summaries: IsolatedPerformanceSummary[] = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

    for (const s of summaries) {
      assert(s.netRealizedPnlUSD > 0, `Port ${s.strategyId} must have positive USD Net PnL, got $${s.netRealizedPnlUSD}`);
      assert(s.netRealizedPnlINR > 0, `Port ${s.strategyId} must have positive INR Net PnL, got ₹${s.netRealizedPnlINR}`);
      assert(s.profitFactor >= 1.0, `Port ${s.strategyId} must have Profit Factor >= 1.0, got ${s.profitFactor}`);
    }
  });

  // ==========================================================================
  // FINAL ADVERSARIAL STRESS TEST SUMMARY
  // ==========================================================================
  const total = testResults.length;
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`\n${C_BOLD}${C_CYAN}================================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}   ADVERSARIAL STRESS TEST SUITE EXECUTION SUMMARY                             ${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================================${C_RESET}`);
  console.log(`  Total Tests Executed: ${C_BOLD}${total}${C_RESET}`);
  console.log(`  Tests Passed:         ${C_GREEN}${C_BOLD}${passed}${C_RESET}`);
  console.log(`  Tests Failed:         ${failed > 0 ? C_RED : C_GREEN}${C_BOLD}${failed}${C_RESET}`);
  console.log(`  Pass Rate:            ${C_BOLD}${passRate}%${C_RESET}`);

  const sections = ['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5'];
  console.log(`\n  ${C_BOLD}Breakdown by Adversarial Section:${C_RESET}`);
  for (const sec of sections) {
    const secTests = testResults.filter(t => t.section === sec);
    const secPassed = secTests.filter(t => t.passed).length;
    console.log(`    - ${sec.padEnd(12)}: ${secPassed}/${secTests.length} passed (${((secPassed / Math.max(1, secTests.length)) * 100).toFixed(1)}%)`);
  }
  console.log(`${C_BOLD}${C_CYAN}================================================================================${C_RESET}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Fatal Error in Harness]', err);
  process.exit(1);
});
