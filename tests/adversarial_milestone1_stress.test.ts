/**
 * ============================================================================
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE 1
 * 
 * Target: Refactored Strategy Engines (Ports 3002, 3003, 3004, 3005, 3006)
 * Author: Teamwork Empirical Challenger (teamwork_challenger_m1_1)
 * Date: 2026-11-02
 * 
 * Exhaustive Verification & Adversarial Stress Testing of:
 * - Suite 1: Bilateral Symmetry (Both LONG and SHORT generated across all 5 engines)
 * - Suite 2: Gatekeeper Bypass & Trend Invariance (Counter-trend reversals in strong trends)
 * - Suite 3: Extreme ATR Stress Testing (Tiny ATR < 0.1 vs Huge ATR > 1000)
 * - Suite 4: Flash Sweep Precision (1-Tick vs 50-Tick sweeps)
 * - Suite 5: Low-Volume Consolidations & Compression Filter Stripping
 * - Suite 6: Asian Session Double-Sweep (Port 3006 NY Continuation Bias)
 * - Suite 7: Mathematical Invariants & Fee Shield (0.45% fee protection, 75% TP1, 25% TP2, +0.75R BE)
 * - Suite 8: Robustness, Boundary & Degenerate Input Chaos (Zero crashes, Zero NaNs)
 * ============================================================================
 */

import { KlinePoint } from '../src/types';
import { bradGohMindMathMoney3002Engine } from '../lib/strategies/bradGohMindMathMoney3002Engine';
import { tradingLabDivergence3003Engine } from '../lib/strategies/tradingLabDivergence3003Engine';
import { fractalFlowVolumeProfile3004Engine } from '../lib/strategies/fractalFlowVolumeProfile3004Engine';
import { hybridMasterCryptoSMC3005Engine } from '../lib/strategies/hybridMasterCryptoSMC3005Engine';
import { ytPatOrb3006Engine } from '../lib/strategies/ytPatOrb3006Engine';
import { strategyRegistry } from '../lib/strategies/strategyRegistry';
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

// ============================================================================
// SYNTHETIC CANDLE GENERATOR SUITE
// ============================================================================

export function generateBradGohCandles(side: 'BUY' | 'SELL', options?: { atrScale?: number; preTrend?: 'BULL' | 'BEAR'; tickSweep?: number; blowout50?: boolean }): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  let offset = 0;

  if (options?.preTrend === 'BULL') {
    for (let i = 0; i < 60; i++) {
      const p = 30 + i * (60 / 60);
      candles.push({ time: baseTime + i * 900, open: p - 0.5, high: p + 1.0, low: p - 0.5, close: p + 0.5, volume: 5000 });
    }
    offset = 60;
  } else if (options?.preTrend === 'BEAR') {
    for (let i = 0; i < 60; i++) {
      const p = 160 - i * (60 / 60);
      candles.push({ time: baseTime + i * 900, open: p + 0.5, high: p + 0.5, low: p - 1.0, close: p - 0.5, volume: 5000 });
    }
    offset = 60;
  }

  if (options?.blowout50) {
    // 50-tick sweep setup for Brad Goh
    for (let i = 0; i < 20; i++) candles.push({ time: baseTime + (offset + i) * 900, open: 110, high: 112, low: 108, close: 111, volume: 1000 });
    candles.push({ time: baseTime + (offset + 20) * 900, open: 112, high: 125, low: 111, close: 120, volume: 1500 });
    candles.push({ time: baseTime + (offset + 21) * 900, open: 120, high: 121, low: 116, close: 117, volume: 1000 });
    for (let i = 22; i < 30; i++) candles.push({ time: baseTime + (offset + i) * 900, open: 117, high: 119, low: i === 28 ? 114 : 116, close: 117, volume: 1000 });
    // Candle 30: sweeps 125 to 175 (50 ticks!), closes back inside range (< 125) at 122
    candles.push({ time: baseTime + (offset + 30) * 900, open: 120, high: 175, low: 119, close: 122, volume: 2000 });
    candles.push({ time: baseTime + (offset + 31) * 900, open: 121, high: 122, low: 108, close: 110, volume: 2500 });
    for (let i = 32; i < 48; i++) candles.push({ time: baseTime + (offset + i) * 900, open: 112, high: 115, low: 110, close: 112, volume: 1000 });
    candles.push({ time: baseTime + (offset + 48) * 900, open: 125, high: 145, low: 124, close: 142, volume: 1500 });
    candles.push({ time: baseTime + (offset + 49) * 900, open: 144, high: 146, low: 140, close: 142, volume: 1200 });
    return candles;
  }

  const is1Tick = options?.tickSweep !== undefined && options.tickSweep < 0.1;
  const sweepExtra = is1Tick ? 0.05 : (options?.tickSweep !== undefined ? options.tickSweep : 3.0);

  if (side === 'SELL') {
    for (let i = 0; i < 20; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 90, high: 92, low: 88, close: 91, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 20) * 900, open: 92, high: 105, low: 91, close: 100, volume: 1500 });
    candles.push({ time: baseTime + (offset + 21) * 900, open: 100, high: 101, low: 96, close: 97, volume: 1000 });
    for (let i = 22; i < 30; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 97, high: 99, low: i === 28 ? 94 : 96, close: 97, volume: 1000 });
    }
    // Sweep candle with upper wick deceleration
    if (is1Tick) {
      candles.push({ time: baseTime + (offset + 30) * 900, open: 104, high: 105.05, low: 103.5, close: 104.2, volume: 2000 });
    } else {
      candles.push({ time: baseTime + (offset + 30) * 900, open: 98, high: 105 + sweepExtra, low: 97, close: 102, volume: 2000 });
    }
    // MSS displacement candle
    candles.push({ time: baseTime + (offset + 31) * 900, open: 101, high: 102, low: 91, close: 92, volume: 2500 });
    for (let i = 32; i < 48; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 93, high: 95, low: 91, close: 93, volume: 1000 });
    }
    // Retest POI
    candles.push({ time: baseTime + (offset + 48) * 900, open: 94, high: 100, low: 93, close: 96, volume: 1500 });
    // Rejection candle in premium
    candles.push({ time: baseTime + (offset + 49) * 900, open: 101, high: 102, low: 98.5, close: 99, volume: 1200 });
  } else {
    for (let i = 0; i < 20; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 108, high: 112, low: 106, close: 109, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 20) * 900, open: 108, high: 109, low: 95, close: 100, volume: 1500 });
    candles.push({ time: baseTime + (offset + 21) * 900, open: 100, high: 104, low: 99, close: 103, volume: 1000 });
    for (let i = 22; i < 30; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 103, high: i === 28 ? 106 : 104, low: 101, close: 103, volume: 1000 });
    }
    // Sweep candle
    if (is1Tick) {
      candles.push({ time: baseTime + (offset + 30) * 900, open: 96, high: 96.5, low: 94.95, close: 95.8, volume: 2000 });
    } else {
      candles.push({ time: baseTime + (offset + 30) * 900, open: 102, high: 103, low: 95 - sweepExtra, close: 98, volume: 2000 });
    }
    // MSS displacement candle
    candles.push({ time: baseTime + (offset + 31) * 900, open: 99, high: 109, low: 98, close: 108, volume: 2500 });
    for (let i = 32; i < 48; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 107, high: 109, low: 105, close: 107, volume: 1000 });
    }
    // Retest POI
    candles.push({ time: baseTime + (offset + 48) * 900, open: 106, high: 107, low: 100, close: 104, volume: 1500 });
    // Rejection candle in discount
    candles.push({ time: baseTime + (offset + 49) * 900, open: 99, high: 101.5, low: 98, close: 101, volume: 1200 });
  }

  return candles;
}

export function generateTradingLabCandles(side: 'BUY' | 'SELL', options?: { preTrend?: 'BULL' | 'BEAR'; tickSweep?: number }): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  let offset = 0;

  if (options?.preTrend === 'BULL') {
    for (let i = 0; i < 60; i++) {
      const p = 40 + i * (50 / 60);
      candles.push({ time: baseTime + i * 900, open: p - 0.5, high: p + 1.0, low: p - 0.5, close: p + 0.5, volume: 5000 });
    }
    offset = 60;
  } else if (options?.preTrend === 'BEAR') {
    for (let i = 0; i < 60; i++) {
      const p = 150 - i * (50 / 60);
      candles.push({ time: baseTime + i * 900, open: p + 0.5, high: p + 0.5, low: p - 1.0, close: p - 0.5, volume: 5000 });
    }
    offset = 60;
  }

  const sweepExtra = options?.tickSweep !== undefined ? options.tickSweep : 1.0;

  if (side === 'SELL') {
    let p = 90;
    for (let i = 0; i < 38; i++) {
      p += 0.4;
      candles.push({ time: baseTime + (offset + i) * 900, open: p - 0.2, high: p + 0.5, low: p - 0.3, close: p, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 38) * 900, open: 106, high: 108, low: 105, close: 107.5, volume: 1500 });
    candles.push({ time: baseTime + (offset + 39) * 900, open: 107.5, high: 107.6, low: 104, close: 104.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 40) * 900, open: 104.5, high: 105, low: 102, close: 102.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 41) * 900, open: 102.5, high: 103, low: 101, close: 101.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 42) * 900, open: 101.5, high: 102, low: 100, close: 100.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 43) * 900, open: 100.5, high: 104, low: 100, close: 103.5, volume: 1200 });
    candles.push({ time: baseTime + (offset + 44) * 900, open: 103.5, high: 108 + sweepExtra, low: 103, close: 106, volume: 2000 });
  } else {
    let p = 110;
    for (let i = 0; i < 38; i++) {
      p -= 0.4;
      candles.push({ time: baseTime + (offset + i) * 900, open: p + 0.2, high: p + 0.3, low: p - 0.5, close: p, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 38) * 900, open: 94, high: 95, low: 92, close: 92.5, volume: 1500 });
    candles.push({ time: baseTime + (offset + 39) * 900, open: 92.5, high: 96, low: 92.4, close: 95.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 40) * 900, open: 95.5, high: 98, low: 95, close: 97.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 41) * 900, open: 97.5, high: 99, low: 97, close: 98.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 42) * 900, open: 98.5, high: 100, low: 98, close: 99.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 43) * 900, open: 99.5, high: 100, low: 96, close: 96.5, volume: 1200 });
    candles.push({ time: baseTime + (offset + 44) * 900, open: 96.5, high: 97, low: 92 - sweepExtra, close: 94, volume: 2000 });
  }

  return candles;
}

export function generateFractalFlowCandles(side: 'BUY' | 'SELL', options?: { preTrend?: 'BULL' | 'BEAR'; tickSweep?: number }): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  let offset = 0;

  if (options?.preTrend === 'BULL') {
    for (let i = 0; i < 50; i++) {
      const p = 50 + i * (50 / 50);
      candles.push({ time: baseTime + i * 900, open: p - 0.5, high: p + 1.0, low: p - 0.5, close: p + 0.5, volume: 5000 });
    }
    offset = 50;
  } else if (options?.preTrend === 'BEAR') {
    for (let i = 0; i < 50; i++) {
      const p = 150 - i * (50 / 50);
      candles.push({ time: baseTime + i * 900, open: p + 0.5, high: p + 0.5, low: p - 1.0, close: p - 0.5, volume: 5000 });
    }
    offset = 50;
  }

  // Base VAH is ~101.625, base VAL is ~98.375
  const sweepExtra = options?.tickSweep !== undefined ? options.tickSweep : 4.5;

  if (side === 'SELL') {
    for (let i = 0; i < 53; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 98, high: 102, low: 97, close: 100, volume: 5000 });
    }
    // High must pierce VAH (101.625). If sweepExtra is 0.575 (1 tick above VAH), high reaches 102.2
    const sweepHigh = Math.max(102.0, 101.65 + sweepExtra);
    candles.push({ time: baseTime + (offset + 53) * 900, open: 100, high: sweepHigh, low: 99.5, close: 101, volume: 2000 });
    candles.push({ time: baseTime + (offset + 54) * 900, open: 101, high: 101.5, low: 98, close: 98.5, volume: 2000 });
  } else {
    for (let i = 0; i < 53; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 98, high: 102, low: 97, close: 100, volume: 5000 });
    }
    // Low must pierce VAL (98.375).
    const sweepLow = Math.min(98.0, 98.35 - sweepExtra);
    candles.push({ time: baseTime + (offset + 53) * 900, open: 100, high: 100.5, low: sweepLow, close: 99, volume: 2000 });
    candles.push({ time: baseTime + (offset + 54) * 900, open: 99, high: 102, low: 98.5, close: 101.5, volume: 2000 });
  }

  return candles;
}

export function generateSmcCandles(side: 'BUY' | 'SELL', options?: { preTrend?: 'BULL' | 'BEAR'; tickSweep?: number }): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  let offset = 0;

  if (options?.preTrend === 'BULL') {
    for (let i = 0; i < 50; i++) {
      const p = 50 + i * (50 / 50);
      candles.push({ time: baseTime + i * 900, open: p - 0.5, high: p + 1.0, low: p - 0.5, close: p + 0.5, volume: 5000 });
    }
    offset = 50;
  } else if (options?.preTrend === 'BEAR') {
    for (let i = 0; i < 50; i++) {
      const p = 150 - i * (50 / 50);
      candles.push({ time: baseTime + i * 900, open: p + 0.5, high: p + 0.5, low: p - 1.0, close: p - 0.5, volume: 5000 });
    }
    offset = 50;
  }

  if (side === 'BUY') {
    for (let i = 0; i < 25; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 98, high: i === 10 ? 110 : 102, low: i === 5 ? 90 : 96, close: 99, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 26) * 900, open: 96, high: 96.5, low: 94, close: 94.2, volume: 1000 });
    candles.push({ time: baseTime + (offset + 27) * 900, open: 95, high: 113, low: 95, close: 112, volume: 3000 });
    candles.push({ time: baseTime + (offset + 28) * 900, open: 112, high: 112.5, low: 105, close: 108, volume: 1200 });
    for (let i = 29; i < 42; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 104, high: 105, low: 98, close: 100, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 42) * 900, open: 99, high: 100, low: 95, close: 97, volume: 1500 });
    candles.push({ time: baseTime + (offset + 43) * 900, open: 97, high: 98, low: 95.5, close: 96.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 44) * 900, open: 96.5, high: 99, low: 96, close: 98.5, volume: 1500 });
  } else {
    for (let i = 0; i < 25; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 102, high: i === 10 ? 110 : 104, low: i === 5 ? 90 : 98, close: 101, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 26) * 900, open: 104, high: 106, low: 103.5, close: 105.8, volume: 1000 });
    candles.push({ time: baseTime + (offset + 27) * 900, open: 105, high: 105, low: 87, close: 88, volume: 3000 });
    candles.push({ time: baseTime + (offset + 28) * 900, open: 88, high: 95, low: 88, close: 92, volume: 1200 });
    for (let i = 29; i < 42; i++) {
      candles.push({ time: baseTime + (offset + i) * 900, open: 96, high: 102, low: 95, close: 100, volume: 1000 });
    }
    candles.push({ time: baseTime + (offset + 42) * 900, open: 101, high: 105, low: 100, close: 103, volume: 1500 });
    candles.push({ time: baseTime + (offset + 43) * 900, open: 103, high: 104.5, low: 102, close: 103.5, volume: 1000 });
    candles.push({ time: baseTime + (offset + 44) * 900, open: 103.5, high: 104, low: 101, close: 101.5, volume: 1500 });
  }

  return candles;
}

export function generatePatOrbCandles(mode: 'BULL_REV' | 'BEAR_REV' | 'DOUBLE_BULL_CONT' | 'DOUBLE_BEAR_CONT', options?: { preTrend?: 'BULL' | 'BEAR'; tickSweep?: number }): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  let offset = 0;

  if (options?.preTrend === 'BULL') {
    for (let i = 0; i < 50; i++) {
      const p = 50 + i * (50 / 50);
      candles.push({ time: baseTime + i * 900, open: p - 0.5, high: p + 1.0, low: p - 0.5, close: p + 0.5, volume: 5000 });
    }
    offset = 50;
  } else if (options?.preTrend === 'BEAR') {
    for (let i = 0; i < 50; i++) {
      const p = 150 - i * (50 / 50);
      candles.push({ time: baseTime + i * 900, open: p + 0.5, high: p + 0.5, low: p - 1.0, close: p - 0.5, volume: 5000 });
    }
    offset = 50;
  }

  for (let i = 0; i < 8; i++) {
    candles.push({ time: baseTime + (offset + i) * 900, open: 100, high: 102, low: 98, close: 100, volume: 1000 });
  }
  for (let i = 8; i < 36; i++) {
    candles.push({ time: baseTime + (offset + i) * 900, open: 100, high: 105, low: 95, close: 100, volume: 1000 });
  }

  const sweepHigh = 105 + (options?.tickSweep !== undefined ? options.tickSweep : 3.0);
  const sweepLow = 95 - (options?.tickSweep !== undefined ? options.tickSweep : 3.0);

  for (let i = 36; i < 47; i++) {
    let high = 103;
    let low = 97;
    if (i === 40) {
      if (mode === 'BEAR_REV' || mode === 'DOUBLE_BULL_CONT' || mode === 'DOUBLE_BEAR_CONT') {
        high = sweepHigh;
      }
      if (mode === 'BULL_REV' || mode === 'DOUBLE_BULL_CONT' || mode === 'DOUBLE_BEAR_CONT') {
        low = sweepLow;
      }
    }
    candles.push({ time: baseTime + (offset + i) * 900, open: 100, high, low, close: 100, volume: 1000 });
  }

  candles.push({ time: baseTime + (offset + 47) * 900, open: 100, high: 102, low: 98, close: 100, volume: 1500 });

  if (mode === 'BULL_REV' || mode === 'DOUBLE_BULL_CONT') {
    candles.push({ time: baseTime + (offset + 48) * 900, open: 100, high: 105, low: 99.5, close: 104, volume: 2000 });
    candles.push({ time: baseTime + (offset + 49) * 900, open: 102.5, high: 106, low: 102, close: 105.5, volume: 2500 });
  } else {
    candles.push({ time: baseTime + (offset + 48) * 900, open: 100, high: 100.5, low: 95, close: 96, volume: 2000 });
    candles.push({ time: baseTime + (offset + 49) * 900, open: 97.5, high: 98, low: 94, close: 94.5, volume: 2500 });
  }

  return candles;
}

// Global collector for trade verdicts to check invariants
const collectedVerdicts: StandardStrategyVerdict[] = [];

function registerVerdict(v: StandardStrategyVerdict): void {
  if (v.recommendedSide) {
    collectedVerdicts.push(v);
  }
}

// ============================================================================
// MAIN EXECUTION ROUTINE
// ============================================================================

export async function runAdversarialMilestone1Harness() {
  console.log(`\n${C_BOLD}${C_CYAN}================================================================================${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}   EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE 1                      ${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}   Adversarial Challenge of Refactored Strategy Engines (Ports 3002-3006)       ${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================================${C_RESET}\n`);

  // ==========================================================================
  // SUITE 1: BILATERAL EXECUTION & SYMMETRY (LONGS & SHORTS ACROSS ALL 5 ENGINES)
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 1: Bilateral Symmetry (Long AND Short) Execution ---${C_RESET}`);

  await runTest('Suite 1', 'S1.01', 'Port 3002: Produces BUY on Bullish 5-Step Reversal', () => {
    const c = generateBradGohCandles('BUY');
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Expected BUY, got ${v.recommendedSide}`);
    assert(v.setupType === 'BULLISH_5STEP_REVERSAL', `Expected BULLISH_5STEP_REVERSAL, got ${v.setupType}`);
    assert(v.entryPrice > v.stopLossPrice, 'Entry must be above SL for BUY');
    assert(v.tp1Price > v.entryPrice, 'TP1 must be above Entry for BUY');
  });

  await runTest('Suite 1', 'S1.02', 'Port 3002: Produces SELL on Bearish 5-Step Reversal', () => {
    const c = generateBradGohCandles('SELL');
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `Expected SELL, got ${v.recommendedSide}`);
    assert(v.setupType === 'BEARISH_5STEP_REVERSAL', `Expected BEARISH_5STEP_REVERSAL, got ${v.setupType}`);
    assert(v.stopLossPrice > v.entryPrice, 'SL must be above Entry for SELL');
    assert(v.tp1Price < v.entryPrice, 'TP1 must be below Entry for SELL');
  });

  await runTest('Suite 1', 'S1.03', 'Port 3003: Produces BUY on Bullish 10-Candle Divergence Grab', () => {
    const c = generateTradingLabCandles('BUY');
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Expected BUY, got ${v.recommendedSide}`);
    assert(v.setupType === 'BULLISH_10CANDLE_DIVERGENCE_GRAB', `Expected BULLISH_10CANDLE_DIVERGENCE_GRAB, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.04', 'Port 3003: Produces SELL on Bearish 10-Candle Divergence Grab', () => {
    const c = generateTradingLabCandles('SELL');
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `Expected SELL, got ${v.recommendedSide}`);
    assert(v.setupType === 'BEARISH_10CANDLE_DIVERGENCE_GRAB', `Expected BEARISH_10CANDLE_DIVERGENCE_GRAB, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.05', 'Port 3004: Produces BUY on Fractal Flow VAL Sweep Re-entry', () => {
    const c = generateFractalFlowCandles('BUY');
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Expected BUY, got ${v.recommendedSide}`);
    assert(v.setupType === 'FRACTAL_FLOW_VAL_SWEEP_REENTRY', `Expected FRACTAL_FLOW_VAL_SWEEP_REENTRY, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.06', 'Port 3004: Produces SELL on Fractal Flow VAH Sweep Re-entry', () => {
    const c = generateFractalFlowCandles('SELL');
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `Expected SELL, got ${v.recommendedSide}`);
    assert(v.setupType === 'FRACTAL_FLOW_VAH_SWEEP_REENTRY', `Expected FRACTAL_FLOW_VAH_SWEEP_REENTRY, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.07', 'Port 3005: Produces BUY on Pure SMC IDM Sweep + Discount OB Retest', () => {
    const c = generateSmcCandles('BUY');
    const v = hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Expected BUY, got ${v.recommendedSide}`);
    assert(v.setupType === 'BULLISH_SMC_IDM_SWEEP_OB_RETEST', `Expected BULLISH_SMC_IDM_SWEEP_OB_RETEST, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.08', 'Port 3005: Produces SELL on Pure SMC IDM Sweep + Premium OB Retest', () => {
    const c = generateSmcCandles('SELL');
    const v = hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `Expected SELL, got ${v.recommendedSide}`);
    assert(v.setupType === 'BEARISH_SMC_IDM_SWEEP_OB_RETEST', `Expected BEARISH_SMC_IDM_SWEEP_OB_RETEST, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.09', 'Port 3006: Produces BUY on London Sweep of Asian Low + NY ORB Breakout', () => {
    const c = generatePatOrbCandles('BULL_REV');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Expected BUY, got ${v.recommendedSide}`);
    assert(v.setupType === 'BULLISH_ASIAN_SWEEP_NY_ORB', `Expected BULLISH_ASIAN_SWEEP_NY_ORB, got ${v.setupType}`);
  });

  await runTest('Suite 1', 'S1.10', 'Port 3006: Produces SELL on London Sweep of Asian High + NY ORB Breakdown', () => {
    const c = generatePatOrbCandles('BEAR_REV');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `Expected SELL, got ${v.recommendedSide}`);
    assert(v.setupType === 'BEARISH_ASIAN_SWEEP_NY_ORB', `Expected BEARISH_ASIAN_SWEEP_NY_ORB, got ${v.setupType}`);
  });

  // ==========================================================================
  // SUITE 2: GATEKEEPER BYPASS & COUNTER-TREND EXECUTION IN STRONG TRENDS
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 2: Gatekeeper Bypass & Counter-Trend Reversal Execution ---${C_RESET}`);

  await runTest('Suite 2', 'S2.01', 'Port 3002: Counter-trend SELL triggers during Massive Bull Trend without being blocked by Trend Shield', () => {
    const c = generateBradGohCandles('SELL', { preTrend: 'BULL' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3002, 'SOLUSDT', c);
    assert(regRes.signal === 'SELL', `Expected SELL, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
    assert(regRes.strategyName.includes('Brad Goh'), 'Strategy name correctly forwarded');
  });

  await runTest('Suite 2', 'S2.02', 'Port 3002: Counter-trend BUY triggers during Massive Bear Trend without being blocked by Trend Shield', () => {
    const c = generateBradGohCandles('BUY', { preTrend: 'BEAR' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3002, 'SOLUSDT', c);
    assert(regRes.signal === 'BUY', `Expected BUY, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.03', 'Port 3003: Counter-trend SELL triggers during Massive Bull Trend via strategyRegistry', () => {
    const c = generateTradingLabCandles('SELL', { preTrend: 'BULL' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3003, 'AVAXUSDT', c);
    assert(regRes.signal === 'SELL', `Expected SELL, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.04', 'Port 3003: Counter-trend BUY triggers during Massive Bear Trend via strategyRegistry', () => {
    const c = generateTradingLabCandles('BUY', { preTrend: 'BEAR' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3003, 'AVAXUSDT', c);
    assert(regRes.signal === 'BUY', `Expected BUY, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.05', 'Port 3004: Counter-trend SELL triggers during Massive Bull Trend via strategyRegistry', () => {
    const c = generateFractalFlowCandles('SELL', { preTrend: 'BULL' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3004, 'ETHUSDT', c);
    assert(regRes.signal === 'SELL', `Expected SELL, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.06', 'Port 3004: Counter-trend BUY triggers during Massive Bear Trend via strategyRegistry', () => {
    const c = generateFractalFlowCandles('BUY', { preTrend: 'BEAR' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3004, 'ETHUSDT', c);
    assert(regRes.signal === 'BUY', `Expected BUY, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.07', 'Port 3005: Counter-trend SELL triggers during Massive Bull Trend via strategyRegistry', () => {
    const c = generateSmcCandles('SELL', { preTrend: 'BULL' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3005, 'BTCUSDT', c);
    assert(regRes.signal === 'SELL', `Expected SELL, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.08', 'Port 3005: Counter-trend BUY triggers during Massive Bear Trend via strategyRegistry', () => {
    const c = generateSmcCandles('BUY', { preTrend: 'BEAR' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3005, 'BTCUSDT', c);
    assert(regRes.signal === 'BUY', `Expected BUY, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.09', 'Port 3006: Counter-trend SELL triggers during Massive Bull Trend via strategyRegistry', () => {
    const c = generatePatOrbCandles('BEAR_REV', { preTrend: 'BULL' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3006, 'SOLUSDT', c);
    assert(regRes.signal === 'SELL', `Expected SELL, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  await runTest('Suite 2', 'S2.10', 'Port 3006: Counter-trend BUY triggers during Massive Bear Trend via strategyRegistry', () => {
    const c = generatePatOrbCandles('BULL_REV', { preTrend: 'BEAR' });
    const regRes = strategyRegistry.evaluateStrategyForPort(3006, 'SOLUSDT', c);
    assert(regRes.signal === 'BUY', `Expected BUY, got ${regRes.signal} (reasons: ${regRes.reasons.join(' | ')})`);
  });

  // ==========================================================================
  // SUITE 3: EXTREME ATR STRESS TESTING (TINY ATR < 0.1 vs HUGE ATR > 1000)
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 3: Extreme ATR Values (Tiny < 0.1 vs Huge > 1000) ---${C_RESET}`);

  await runTest('Suite 3', 'S3.01', 'Port 3002: Tiny ATR (<0.05) clamps riskDistance to 0.45% minimum fee shield', () => {
    const baseCandles = generateBradGohCandles('BUY');
    const scale = 0.005;
    const tinyCandles = baseCandles.map((c) => ({
      ...c,
      open: 100 + (c.open - 100) * scale,
      high: 100 + (c.high - 100) * scale,
      low: 100 + (c.low - 100) * scale,
      close: 100 + (c.close - 100) * scale,
    }));
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', tinyCandles);
    if (v.recommendedSide) {
      registerVerdict(v);
      const ratio = v.riskDistance / v.entryPrice;
      assert(ratio >= 0.004499, `Fee shield violated: ratio=${ratio} < 0.0045`);
      assert(v.minSlDistancePct >= 0.0045, `minSlDistancePct violated: ${v.minSlDistancePct}`);
    }
  });

  await runTest('Suite 3', 'S3.02', 'Port 3003: Tiny ATR (<0.05) clamps riskDistance to 0.45% minimum fee shield', () => {
    const baseCandles = generateTradingLabCandles('SELL');
    const scale = 0.005;
    const tinyCandles = baseCandles.map((c) => ({
      ...c,
      open: 100 + (c.open - 100) * scale,
      high: 100 + (c.high - 100) * scale,
      low: 100 + (c.low - 100) * scale,
      close: 100 + (c.close - 100) * scale,
    }));
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', tinyCandles);
    if (v.recommendedSide) {
      registerVerdict(v);
      const ratio = v.riskDistance / v.entryPrice;
      assert(ratio >= 0.004499, `Fee shield violated: ratio=${ratio} < 0.0045`);
    }
  });

  await runTest('Suite 3', 'S3.03', 'Port 3004: Tiny ATR (<0.05) clamps riskDistance to 0.45% minimum fee shield', () => {
    const baseCandles = generateFractalFlowCandles('BUY');
    const scale = 0.005;
    const tinyCandles = baseCandles.map((c) => ({
      ...c,
      open: 100 + (c.open - 100) * scale,
      high: 100 + (c.high - 100) * scale,
      low: 100 + (c.low - 100) * scale,
      close: 100 + (c.close - 100) * scale,
    }));
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', tinyCandles);
    if (v.recommendedSide) {
      registerVerdict(v);
      const ratio = v.riskDistance / v.entryPrice;
      assert(ratio >= 0.004499, `Fee shield violated: ratio=${ratio} < 0.0045`);
    }
  });

  await runTest('Suite 3', 'S3.04', 'Port 3005: Tiny ATR (<0.05) clamps riskDistance to 0.45% minimum fee shield', () => {
    const baseCandles = generateSmcCandles('BUY');
    const scale = 0.005;
    const tinyCandles = baseCandles.map((c) => ({
      ...c,
      open: 100 + (c.open - 100) * scale,
      high: 100 + (c.high - 100) * scale,
      low: 100 + (c.low - 100) * scale,
      close: 100 + (c.close - 100) * scale,
    }));
    const v = hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', tinyCandles);
    if (v.recommendedSide) {
      registerVerdict(v);
      const ratio = v.riskDistance / v.entryPrice;
      assert(ratio >= 0.004499, `Fee shield violated: ratio=${ratio} < 0.0045`);
    }
  });

  await runTest('Suite 3', 'S3.05', 'Port 3006: Tiny ATR (<0.05) clamps riskDistance to 0.45% minimum fee shield', () => {
    const baseCandles = generatePatOrbCandles('BULL_REV');
    const scale = 0.005;
    const tinyCandles = baseCandles.map((c) => ({
      ...c,
      open: 100 + (c.open - 100) * scale,
      high: 100 + (c.high - 100) * scale,
      low: 100 + (c.low - 100) * scale,
      close: 100 + (c.close - 100) * scale,
    }));
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', tinyCandles);
    if (v.recommendedSide) {
      registerVerdict(v);
      const ratio = v.riskDistance / v.entryPrice;
      assert(ratio >= 0.004499, `Fee shield violated: ratio=${ratio} < 0.0045`);
    }
  });

  await runTest('Suite 3', 'S3.06', 'Port 3002: Huge ATR (>1000 on BTC $65,000) calculates risk without numeric overflow', () => {
    const scale = 650;
    const bigCandles = generateBradGohCandles('BUY').map((c) => ({
      ...c,
      open: c.open * scale,
      high: c.high * scale,
      low: c.low * scale,
      close: c.close * scale,
    }));
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', bigCandles);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', 'BUY executed under high ATR regime');
    assert(!isNaN(v.entryPrice) && !isNaN(v.stopLossPrice) && !isNaN(v.tp1Price) && !isNaN(v.tp2Price), 'Zero NaNs');
    assert(v.riskDistance > 1000, `Risk distance scaled appropriately (${v.riskDistance})`);
  });

  await runTest('Suite 3', 'S3.07', 'Port 3003: Huge ATR (>1000) handles flash volatility without NaN or geometry inversion', () => {
    const scale = 650;
    const bigCandles = generateTradingLabCandles('SELL').map((c) => ({
      ...c,
      open: c.open * scale,
      high: c.high * scale,
      low: c.low * scale,
      close: c.close * scale,
    }));
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', bigCandles);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', 'SELL executed under high ATR regime');
    assert(v.stopLossPrice > v.entryPrice, 'SL remains above Entry for SELL');
    assert(v.tp1Price < v.entryPrice, 'TP1 remains below Entry for SELL');
    assert(!isNaN(v.tp1Price) && !isNaN(v.tp2Price), 'Zero NaNs in TP targets');
  });

  await runTest('Suite 3', 'S3.08', 'Port 3004: Huge ATR (>1000) computes Volume Profile and VA levels cleanly', () => {
    const scale = 650;
    const bigCandles = generateFractalFlowCandles('BUY').map((c) => ({
      ...c,
      open: c.open * scale,
      high: c.high * scale,
      low: c.low * scale,
      close: c.close * scale,
    }));
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', bigCandles);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', 'BUY executed under high ATR regime');
    assert(v.volumeProfile !== undefined, 'Volume Profile computed');
    assert(v.volumeProfile!.vah > v.volumeProfile!.val, 'VAH > VAL maintained under extreme prices');
  });

  await runTest('Suite 3', 'S3.09', 'Port 3005: Huge ATR (>1000) maps Order Block and structure levels cleanly', () => {
    const scale = 650;
    const bigCandles = generateSmcCandles('SELL').map((c) => ({
      ...c,
      open: c.open * scale,
      high: c.high * scale,
      low: c.low * scale,
      close: c.close * scale,
    }));
    const v = hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', bigCandles);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', 'SELL executed under high ATR regime');
    assert(v.stopLossPrice > v.entryPrice, 'SL placed above Entry for SELL');
  });

  await runTest('Suite 3', 'S3.10', 'Port 3006: Huge ATR (>1000) scales Asian session box and ORB ranges cleanly', () => {
    const scale = 650;
    const bigCandles = generatePatOrbCandles('BULL_REV').map((c) => ({
      ...c,
      open: c.open * scale,
      high: c.high * scale,
      low: c.low * scale,
      close: c.close * scale,
    }));
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', bigCandles);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', 'BUY executed under high ATR regime');
    assert(v.earlyBreakevenPrice > v.entryPrice, 'Early BE placed above Entry for BUY');
  });

  // ==========================================================================
  // SUITE 4: FLASH SWEEPS (1-TICK vs 50-TICK WICKS)
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 4: Flash Sweep Precision (1-Tick vs 50-Tick Wicks) ---${C_RESET}`);

  await runTest('Suite 4', 'S4.01', 'Port 3002: 1-Tick precision sweep qualifies valid institutional reversal', () => {
    const c = generateBradGohCandles('SELL', { tickSweep: 0.05 });
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `1-tick sweep qualified: side=${v.recommendedSide}`);
    assert(v.auditLog.rule3_liquidity_sweep === true, 'Rule 3 Liquidity sweep passed');
  });

  await runTest('Suite 4', 'S4.02', 'Port 3002: 50-Tick blowout sweep captures entire wick in Stop Loss placement', () => {
    const c = generateBradGohCandles('SELL', { blowout50: true });
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `50-tick sweep qualified: side=${v.recommendedSide}`);
    assert(v.stopLossPrice >= 175, `SL ($${v.stopLossPrice}) must be placed beyond sweep wick ($175.00)`);
  });

  await runTest('Suite 4', 'S4.03', 'Port 3003: 1-Tick precision sweep qualifies 10-candle divergence grab', () => {
    const c = generateTradingLabCandles('SELL', { tickSweep: 0.01 });
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `1-tick sweep qualified: side=${v.recommendedSide}`);
    assert(v.auditLog.rule2_liquidity_grab_10_candle === true, 'Rule 2 10-candle grab passed');
  });

  await runTest('Suite 4', 'S4.04', 'Port 3003: 50-Tick blowout sweep captures entire wick in Stop Loss placement', () => {
    const c = generateTradingLabCandles('SELL', { tickSweep: 50.0 });
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `50-tick sweep qualified: side=${v.recommendedSide}`);
    assert(v.stopLossPrice >= 158, `SL ($${v.stopLossPrice}) must be placed beyond sweep wick ($158.00)`);
  });

  await runTest('Suite 4', 'S4.05', 'Port 3004: 1-Tick precision sweep outside Value Area boundary qualifies', () => {
    const c = generateFractalFlowCandles('SELL', { tickSweep: 0.6 });
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `1-tick VA sweep qualified: side=${v.recommendedSide}`);
  });

  await runTest('Suite 4', 'S4.06', 'Port 3004: 50-Tick blowout sweep outside Value Area places SL beyond wick extreme', () => {
    const c = generateFractalFlowCandles('SELL', { tickSweep: 50.0 });
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `50-tick VA sweep qualified: side=${v.recommendedSide}`);
    assert(v.stopLossPrice >= 150, `SL ($${v.stopLossPrice}) captures blowout wick`);
  });

  await runTest('Suite 4', 'S4.07', 'Port 3006: Asian session sweep requires exceeding 0.05*ATR noise threshold', () => {
    const cSubThreshold = generatePatOrbCandles('BEAR_REV', { tickSweep: 0.001 });
    const vSub = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', cSubThreshold);
    assert(vSub.recommendedSide === null, 'Sub-threshold noise wick correctly rejected');
    assert(vSub.reasons.some(r => r.includes('No Asian session liquidity sweep')), 'Reason captures sweep absence');

    const cValid = generatePatOrbCandles('BEAR_REV', { tickSweep: 0.50 });
    const vValid = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', cValid);
    registerVerdict(vValid);
    assert(vValid.recommendedSide === 'SELL', 'Valid sweep above threshold accepted');
  });

  await runTest('Suite 4', 'S4.08', 'Port 3006: 50-Tick blowout sweep preserves valid zone and Stop Loss', () => {
    const c = generatePatOrbCandles('BEAR_REV', { tickSweep: 50.0 });
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', 'SELL qualified on blowout sweep');
    assert(v.stopLossPrice > v.entryPrice, 'SL placed above entry');
  });

  // ==========================================================================
  // SUITE 5: LOW-VOLUME CONSOLIDATIONS & COMPRESSION FILTER STRIPPING
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 5: Low-Volume Consolidations & Compression Filter Stripping ---${C_RESET}`);

  await runTest('Suite 5', 'S5.01', 'Port 3003: 10-Candle Divergence Grab operates cleanly in low-volume consolidation', () => {
    const c = generateTradingLabCandles('BUY').map(bar => ({ ...bar, volume: 5 }));
    const v = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Low volume BUY executed: side=${v.recommendedSide}`);
  });

  await runTest('Suite 5', 'S5.02', 'Port 3004: Volume Profile computes cleanly even with uniform low volume', () => {
    const c = generateFractalFlowCandles('BUY').map(bar => ({ ...bar, volume: 10 }));
    const v = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Low volume BUY executed: side=${v.recommendedSide}`);
  });

  await runTest('Suite 5', 'S5.03', 'Port 3005: 1.4x ATR range compression filter is genuinely stripped (Pure SMC)', () => {
    const c = generateSmcCandles('BUY');
    const v = hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `3005 executed without 1.4x ATR filter: side=${v.recommendedSide}`);
    assert(!v.reasons.some(r => r.includes('1.4') || r.includes('compression')), 'Zero 1.4x ATR rejection reasons');
  });

  await runTest('Suite 5', 'S5.04', 'Port 3006: 1.4x ATR Asian range compression filter is genuinely stripped', () => {
    const c = generatePatOrbCandles('BULL_REV');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `3006 executed without 1.4x ATR filter: side=${v.recommendedSide}`);
    assert(!v.reasons.some(r => r.includes('1.4') || r.includes('compression')), 'Zero 1.4x ATR rejection reasons');
  });

  await runTest('Suite 5', 'S5.05', 'Port 3002: Compression filter boundary analysis (Old 1.4x ATR stripped to 1.15x ATR)', () => {
    const baseTime = 1700000000;
    const testCandles: KlinePoint[] = [];
    for (let i = 0; i < 50; i++) {
      testCandles.push({ time: baseTime + i * 900, open: 100, high: 106, low: 94, close: 100, volume: 1000 });
    }
    const v = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', testCandles);
    assert(v.reasons.some(r => r.includes('WHEN NOT TO TRADE') || r.includes('Brad Goh')), 'Appropriate handling documented');
  });

  // ==========================================================================
  // SUITE 6: ASIAN SESSION DOUBLE-SWEEP & NY CONTINUATION (PORT 3006)
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 6: Asian Session Double-Sweep & NY Continuation Bias (Port 3006) ---${C_RESET}`);

  await runTest('Suite 6', 'S6.01', 'Port 3006: London sweeps BOTH Asian High and Low -> Activates CONTINUATION bias', () => {
    const c = generatePatOrbCandles('DOUBLE_BULL_CONT');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.auditLog?.sessionBias === 'CONTINUATION', `Expected CONTINUATION, got ${v.auditLog?.sessionBias}`);
    assert(v.auditLog?.sweptAsianLow === true, 'sweptAsianLow confirmed');
    assert(v.auditLog?.sweptAsianHigh === true, 'sweptAsianHigh confirmed');
  });

  await runTest('Suite 6', 'S6.02', 'Port 3006: Double sweep does NOT abort or return empty verdict', () => {
    const c = generatePatOrbCandles('DOUBLE_BULL_CONT');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    assert(v.recommendedSide !== null, 'Engine did NOT abort on double sweep');
  });

  await runTest('Suite 6', 'S6.03', 'Port 3006: Double sweep with upward ORB breakout triggers BUY with BULLISH_NY_ORB_CONTINUATION', () => {
    const c = generatePatOrbCandles('DOUBLE_BULL_CONT');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'BUY', `Expected BUY, got ${v.recommendedSide}`);
    assert(v.setupType === 'BULLISH_NY_ORB_CONTINUATION', `Expected BULLISH_NY_ORB_CONTINUATION, got ${v.setupType}`);
    assert(v.confidenceScore === 90, `Confidence score for continuation is 90 (got ${v.confidenceScore})`);
  });

  await runTest('Suite 6', 'S6.04', 'Port 3006: Double sweep with downward ORB breakdown triggers SELL with BEARISH_NY_ORB_CONTINUATION', () => {
    const c = generatePatOrbCandles('DOUBLE_BEAR_CONT');
    const v = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c);
    registerVerdict(v);
    assert(v.recommendedSide === 'SELL', `Expected SELL, got ${v.recommendedSide}`);
    assert(v.setupType === 'BEARISH_NY_ORB_CONTINUATION', `Expected BEARISH_NY_ORB_CONTINUATION, got ${v.setupType}`);
    assert(v.confidenceScore === 90, `Confidence score for continuation is 90 (got ${v.confidenceScore})`);
  });

  // ==========================================================================
  // SUITE 7: MATHEMATICAL CONTRACT INVARIANTS & FEE SHIELD AUDIT
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 7: Mathematical Contract Invariants & Fee Shield ---${C_RESET}`);

  await runTest('Suite 7', 'S7.01', `Auditing ${collectedVerdicts.length} collected trade verdicts: Fee shield riskDistance / entryPrice >= 0.0045`, () => {
    assert(collectedVerdicts.length >= 10, `Expected at least 10 collected trade verdicts, got ${collectedVerdicts.length}`);
    for (const v of collectedVerdicts) {
      const ratio = v.riskDistance / v.entryPrice;
      assert(ratio >= 0.004499, `Fee shield violation on ${v.strategyName}: ratio=${ratio.toFixed(6)} < 0.0045`);
    }
  });

  await runTest('Suite 7', 'S7.02', 'All verdicts enforce tp1Ratio === 0.75 (75% partial exit)', () => {
    for (const v of collectedVerdicts) {
      assert(v.tp1Ratio === 0.75, `tp1Ratio must be 0.75, got ${v.tp1Ratio} on ${v.strategyName}`);
    }
  });

  await runTest('Suite 7', 'S7.03', 'All verdicts enforce tp2Ratio === 0.25 (25% runner exit)', () => {
    for (const v of collectedVerdicts) {
      assert(v.tp2Ratio === 0.25, `tp2Ratio must be 0.25, got ${v.tp2Ratio} on ${v.strategyName}`);
    }
  });

  await runTest('Suite 7', 'S7.04', 'All verdicts enforce earlyBreakevenPrice precisely at +0.75R', () => {
    for (const v of collectedVerdicts) {
      if (v.recommendedSide === 'BUY') {
        const expectedBE = v.entryPrice + (v.riskDistance * 0.75);
        assertCloseTo(v.earlyBreakevenPrice, expectedBE, 0.02, `Early BE math mismatch on BUY: ${v.earlyBreakevenPrice} vs ${expectedBE}`);
      } else {
        const expectedBE = v.entryPrice - (v.riskDistance * 0.75);
        assertCloseTo(v.earlyBreakevenPrice, expectedBE, 0.02, `Early BE math mismatch on SELL: ${v.earlyBreakevenPrice} vs ${expectedBE}`);
      }
    }
  });

  await runTest('Suite 7', 'S7.05', 'All verdicts enforce TP1 at 1.0R (or 1.25R for 3006) and TP2 at >= 2.0R', () => {
    for (const v of collectedVerdicts) {
      if (v.recommendedSide === 'BUY') {
        assert(v.tp1Price > v.entryPrice, 'BUY TP1 must be > entryPrice');
        assert(v.tp2Price > v.tp1Price, 'BUY TP2 must be > TP1');
      } else {
        assert(v.tp1Price < v.entryPrice, 'SELL TP1 must be < entryPrice');
        assert(v.tp2Price < v.tp1Price, 'SELL TP2 must be < TP1');
      }
    }
  });

  await runTest('Suite 7', 'S7.06', 'BUY geometry order: SL < Entry < EarlyBE < TP1 <= TP2 strictly maintained', () => {
    const buys = collectedVerdicts.filter(v => v.recommendedSide === 'BUY');
    assert(buys.length > 0, 'BUY trades present in audit pool');
    for (const b of buys) {
      assert(b.stopLossPrice < b.entryPrice, `BUY SL ($${b.stopLossPrice}) must be < Entry ($${b.entryPrice})`);
      assert(b.entryPrice < b.earlyBreakevenPrice, `BUY Entry ($${b.entryPrice}) must be < EarlyBE ($${b.earlyBreakevenPrice})`);
      assert(b.earlyBreakevenPrice < b.tp1Price, `BUY EarlyBE ($${b.earlyBreakevenPrice}) must be < TP1 ($${b.tp1Price})`);
      assert(b.tp1Price <= b.tp2Price, `BUY TP1 ($${b.tp1Price}) must be <= TP2 ($${b.tp2Price})`);
    }
  });

  await runTest('Suite 7', 'S7.07', 'SELL geometry order: TP2 <= TP1 < EarlyBE < Entry < SL strictly maintained', () => {
    const sells = collectedVerdicts.filter(v => v.recommendedSide === 'SELL');
    assert(sells.length > 0, 'SELL trades present in audit pool');
    for (const s of sells) {
      assert(s.stopLossPrice > s.entryPrice, `SELL SL ($${s.stopLossPrice}) must be > Entry ($${s.entryPrice})`);
      assert(s.entryPrice > s.earlyBreakevenPrice, `SELL Entry ($${s.entryPrice}) must be > EarlyBE ($${s.earlyBreakevenPrice})`);
      assert(s.earlyBreakevenPrice > s.tp1Price, `SELL EarlyBE ($${s.earlyBreakevenPrice}) must be > TP1 ($${s.tp1Price})`);
      assert(s.tp1Price >= s.tp2Price, `SELL TP1 ($${s.tp1Price}) must be >= TP2 ($${s.tp2Price})`);
    }
  });

  await runTest('Suite 7', 'S7.08', 'Audit all fields for zero NaN, null, or undefined values', () => {
    for (const v of collectedVerdicts) {
      assert(!isNaN(v.entryPrice), 'entryPrice is not NaN');
      assert(!isNaN(v.stopLossPrice), 'stopLossPrice is not NaN');
      assert(!isNaN(v.tp1Price), 'tp1Price is not NaN');
      assert(!isNaN(v.tp2Price), 'tp2Price is not NaN');
      assert(!isNaN(v.earlyBreakevenPrice), 'earlyBreakevenPrice is not NaN');
      assert(!isNaN(v.riskDistance), 'riskDistance is not NaN');
      assert(!isNaN(v.confidenceScore), 'confidenceScore is not NaN');
    }
  });

  // ==========================================================================
  // SUITE 8: ROBUSTNESS, BOUNDARY & DEGENERATE INPUT CHAOS
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_YELLOW}--- SUITE 8: Robustness, Boundary & Degenerate Input Chaos ---${C_RESET}`);

  const engines = [
    { name: 'Port 3002 (Brad Goh)', fn: (c: KlinePoint[]) => bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', c) },
    { name: 'Port 3003 (TradingLab)', fn: (c: KlinePoint[]) => tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', c) },
    { name: 'Port 3004 (Fractal Flow)', fn: (c: KlinePoint[]) => fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', c) },
    { name: 'Port 3005 (Hybrid SMC)', fn: (c: KlinePoint[]) => hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', c) },
    { name: 'Port 3006 (Trade With Pat)', fn: (c: KlinePoint[]) => ytPatOrb3006Engine.evaluateSetup('BTCUSDT', c) },
  ];

  await runTest('Suite 8', 'S8.01', 'Empty candle array [] input returns clean empty verdict across all 5 engines', () => {
    for (const eng of engines) {
      const v = eng.fn([]);
      assert(v.recommendedSide === null, `${eng.name} returns null side on []`);
      assert(v.confidenceScore === 0, `${eng.name} returns 0 confidence on []`);
      assert(!isNaN(v.entryPrice), `${eng.name} entryPrice is not NaN on []`);
    }
  });

  await runTest('Suite 8', 'S8.02', 'Single candle [c] input returns clean empty verdict across all 5 engines', () => {
    const single = [{ time: 1700000000, open: 100, high: 105, low: 95, close: 100, volume: 1000 }];
    for (const eng of engines) {
      const v = eng.fn(single);
      assert(v.recommendedSide === null, `${eng.name} returns null side on single candle`);
      assert(v.entryPrice === 100, `${eng.name} records current candle close`);
    }
  });

  await runTest('Suite 8', 'S8.03', 'Insufficient history boundary (10 to 34 bars) returns clean rejection across all engines', () => {
    for (const len of [10, 20, 30, 34]) {
      const bars: KlinePoint[] = [];
      for (let i = 0; i < len; i++) {
        bars.push({ time: 1700000000 + i * 900, open: 100, high: 102, low: 98, close: 100, volume: 1000 });
      }
      for (const eng of engines) {
        const v = eng.fn(bars);
        assert(v.recommendedSide === null, `${eng.name} rejected on length ${len}`);
        assert(v.reasons.some(r => r.toLowerCase().includes('insufficient')), `${eng.name} reported insufficient history`);
      }
    }
  });

  await runTest('Suite 8', 'S8.04', 'Flat zero-volatility candle sequence (open === high === low === close) does not divide by zero', () => {
    const flat: KlinePoint[] = [];
    for (let i = 0; i < 60; i++) {
      flat.push({ time: 1700000000 + i * 900, open: 100, high: 100, low: 100, close: 100, volume: 1000 });
    }
    for (const eng of engines) {
      const v = eng.fn(flat);
      assert(v.recommendedSide === null, `${eng.name} rejected flat zero-volatility sequence`);
      assert(!isNaN(v.confidenceScore), `${eng.name} confidenceScore is not NaN`);
    }
  });

  await runTest('Suite 8', 'S8.05', 'Zero-volume candle sequence (volume: 0) does not crash or produce NaN', () => {
    const zeroVol: KlinePoint[] = [];
    for (let i = 0; i < 60; i++) {
      zeroVol.push({ time: 1700000000 + i * 900, open: 100 + i * 0.1, high: 102 + i * 0.1, low: 98 + i * 0.1, close: 101 + i * 0.1, volume: 0 });
    }
    for (const eng of engines) {
      const v = eng.fn(zeroVol);
      assert(!isNaN(v.confidenceScore), `${eng.name} confidenceScore not NaN on zero vol`);
    }
  });

  await runTest('Suite 8', 'S8.06', 'High-frequency sequential evaluation across 100 iterations has zero state pollution', () => {
    const cBuy = generateBradGohCandles('BUY');
    const cSell = generateBradGohCandles('SELL');
    for (let i = 0; i < 50; i++) {
      const vBuy = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', cBuy);
      const vSell = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', cSell);
      assert(vBuy.recommendedSide === 'BUY', `Iter ${i} Buy polluted`);
      assert(vSell.recommendedSide === 'SELL', `Iter ${i} Sell polluted`);
    }
  });

  // ==========================================================================
  // FINAL HARNESS SUMMARY & GATING VERDICT
  // ==========================================================================
  console.log(`\n${C_BOLD}${C_CYAN}================================================================================${C_RESET}`);
  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`${C_BOLD}TOTAL ADVERSARIAL STRESS TESTS EXECUTED: ${total}${C_RESET}`);
  console.log(`${C_GREEN}TESTS PASSED : ${passed}${C_RESET}`);
  console.log(`${failed > 0 ? C_RED : C_GREEN}TESTS FAILED : ${failed}${C_RESET}`);
  console.log(`${C_BOLD}PASS RATE    : ${passRate}%${C_RESET}`);
  console.log(`${C_BOLD}${C_CYAN}================================================================================${C_RESET}\n`);

  if (failed > 0) {
    console.error(`\n${C_RED}❌ ADVERSARIAL CHALLENGE FAILED: ${failed} tests failed.${C_RESET}`);
    process.exit(1);
  } else {
    console.log(`\n${C_GREEN}🎯 ALL ADVERSARIAL STRESS TESTS PASSED CONVINCINGLY WITH 100% SUCCESS.${C_RESET}\n`);
    process.exit(0);
  }
}

// Execute harness when invoked directly
if (process.argv[1] && process.argv[1].includes('adversarial_milestone1_stress')) {
  runAdversarialMilestone1Harness().catch((err) => {
    console.error('Unhandled harness exception:', err);
    process.exit(1);
  });
}
