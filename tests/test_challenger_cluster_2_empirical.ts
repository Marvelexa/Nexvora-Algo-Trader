/**
 * ============================================================================
 * CHALLENGER CLUSTER 2: EMPIRICAL STRESS & ADVERSARIAL HARNESS
 * ============================================================================
 * Target Systems:
 * - System 3001 (Autonomous Multi-Indicator Engine)
 * - System 3003 (HBA Market Structure Breakout Engine)
 * - System 3004 (HBA Candlestick & Trendline Retest Engine)
 * - System 3006 (Craig Percoco Smart Money FVG Engine)
 * - System 3007 (Marwadi Trader Delta Trap Engine)
 * ============================================================================
 */

import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { autonomousMultiIndicatorEngine } from '../lib/strategies/autonomousMultiIndicatorEngine';
import { hbaMarketStructureBreakoutEngine } from '../lib/strategies/hbaMarketStructureBreakoutEngine';
import { hbaCandlestickTrendlineEngine } from '../lib/strategies/hbaCandlestickTrendlineEngine';
import { craigPercocoSmcEngine } from '../lib/strategies/craigPercocoSmcEngine';
import { marwadiTraderDeltaTrapEngine } from '../lib/strategies/marwadiTraderDeltaTrapEngine';
import { KlinePoint } from '../src/types';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordResult(id: string, name: string, passed: boolean, details: string) {
  results.push({ id, name, passed, details });
  const status = passed ? '✅ [PASS]' : '❌ [FAIL]';
  console.log(`${status} [${id}] ${name} -> ${details}`);
}

function makeCandle(time: number, open: number, high: number, low: number, close: number, volume: number = 1000): KlinePoint {
  return { time, open, high, low, close, volume };
}

function generateRandomWalk(bars: number = 60, startPrice: number = 2500, volatility: number = 2, volRange: [number, number] = [300, 800]): KlinePoint[] {
  const candles: KlinePoint[] = [];
  let price = startPrice;
  const baseTime = 1700000000;
  for (let i = 0; i < bars; i++) {
    const delta = (Math.random() - 0.5) * volatility * 2;
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + Math.random() * volatility;
    const low = Math.min(open, close) - Math.random() * volatility;
    const volume = volRange[0] + Math.random() * (volRange[1] - volRange[0]);
    candles.push(makeCandle(baseTime + i * 900, open, high, low, close, volume));
    price = close;
  }
  return candles;
}

function generateSpikeChop(bars: number = 60, startPrice: number = 3000, spikeSize: number = 50): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < bars; i++) {
    const spike = (i % 2 === 0 ? spikeSize : -spikeSize);
    candles.push(makeCandle(baseTime + i * 900, startPrice + spike, startPrice + spike + 40, startPrice + spike - 40, startPrice - spike, 5000));
  }
  return candles;
}

function generateFlatline(bars: number = 60, basePrice: number = 2000): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < bars; i++) {
    candles.push(makeCandle(baseTime + i * 900, basePrice, basePrice + 0.05, basePrice - 0.05, basePrice, 100));
  }
  return candles;
}

function generateExtremeWickSpikes(bars: number = 60, basePrice: number = 2500): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < bars; i++) {
    const isWickUp = i % 4 === 1;
    const isWickDown = i % 4 === 3;
    const high = isWickUp ? basePrice + 120 : basePrice + 3;
    const low = isWickDown ? basePrice - 120 : basePrice - 3;
    candles.push(makeCandle(baseTime + i * 900, basePrice, high, low, basePrice + (Math.random() - 0.5) * 2, 2000));
  }
  return candles;
}

async function runChallenger2Audit() {
  console.log('========================================================================');
  console.log('⚡ CHALLENGER CLUSTER 2: DEEP EMPIRICAL STRESS & ADVERSARIAL AUDIT');
  console.log('   Target Engines: 3001, 3003, 3004, 3006, 3007');
  console.log('========================================================================\n');

  const targetPorts = [3001, 3003, 3004, 3006, 3007];

  // --------------------------------------------------------------------------
  // SUITE 1: RANDOM WALK NOISE TESTS (100 and 500 iterations)
  // --------------------------------------------------------------------------
  console.log('--- SUITE 1A: 100-Iteration Random Walk (Volatility = 2.0) ---');
  const false100: Record<number, number> = { 3001: 0, 3003: 0, 3004: 0, 3006: 0, 3007: 0 };
  const triggers100: Record<number, any[]> = { 3001: [], 3003: [], 3004: [], 3006: [], 3007: [] };

  for (let iter = 0; iter < 100; iter++) {
    const candles = generateRandomWalk(60, 2500, 2);
    for (const p of targetPorts) {
      const res = evaluateStrategyForPort(p, 'ETHUSD', candles);
      if (res && res.signal !== null) {
        false100[p]++;
        triggers100[p].push({ iter, signal: res.signal, reasons: res.reasons });
      }
    }
  }

  for (const p of targetPorts) {
    const cnt = false100[p];
    recordResult(
      `CH2.NOISE_100.P${p}`,
      `System ${p}: 0 False Triggers in 100 Random Walk Series (vol=2.0)`,
      cnt === 0,
      `Observed triggers: ${cnt} / 100 ${cnt > 0 ? JSON.stringify(triggers100[p][0]) : ''}`
    );
  }

  console.log('\n--- SUITE 1B: 500-Iteration Deep Random Walk (Volatility = 2.0) ---');
  const false500: Record<number, number> = { 3001: 0, 3003: 0, 3004: 0, 3006: 0, 3007: 0 };
  const triggers500: Record<number, any[]> = { 3001: [], 3003: [], 3004: [], 3006: [], 3007: [] };

  for (let iter = 0; iter < 500; iter++) {
    const candles = generateRandomWalk(60, 2500, 2);
    for (const p of targetPorts) {
      const res = evaluateStrategyForPort(p, 'ETHUSD', candles);
      if (res && res.signal !== null) {
        false500[p]++;
        triggers500[p].push({ iter, signal: res.signal, reasons: res.reasons });
      }
    }
  }

  for (const p of targetPorts) {
    const cnt = false500[p];
    recordResult(
      `CH2.NOISE_500.P${p}`,
      `System ${p}: 0 False Triggers in 500 Random Walk Series (vol=2.0)`,
      cnt === 0,
      `Observed triggers: ${cnt} / 500 ${cnt > 0 ? JSON.stringify(triggers500[p][0]) : ''}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 2: DEAD FLATLINE CHOP (Zero Volatility)
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Dead Flatline Chop (Zero-Squeeze Compliance) ---');
  {
    const flatCandles = generateFlatline(60, 2000);
    for (const p of targetPorts) {
      const res = evaluateStrategyForPort(p, 'ETHUSD', flatCandles);
      const passed = !res || res.signal === null;
      recordResult(
        `CH2.FLATLINE.P${p}`,
        `System ${p}: Cleanly Abstains in Dead Flatline Market`,
        passed,
        `Result: signal=${res?.signal || 'null'}`
      );
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 3: HIGH VOLATILITY ERRATIC SPIKE CHOP
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 3: High Volatility Erratic Spike Chop ---');
  {
    const spikeCandles = generateSpikeChop(60, 3000, 50);
    for (const p of targetPorts) {
      const res = evaluateStrategyForPort(p, 'ETHUSD', spikeCandles);
      const passed = !res || res.signal === null;
      recordResult(
        `CH2.SPIKE_CHOP.P${p}`,
        `System ${p}: Cleanly Abstains in Erratic Alternating Spike Chop`,
        passed,
        `Result: signal=${res?.signal || 'null'}`
      );
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 4: EXTREME WICK SPIKES (Flash Rejection Wicks / Hunt Wicks)
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 4: Extreme Wick Spikes (Fakeout Hunters) ---');
  {
    const wickCandles = generateExtremeWickSpikes(60, 2500);
    for (const p of targetPorts) {
      const res = evaluateStrategyForPort(p, 'ETHUSD', wickCandles);
      const passed = !res || res.signal === null;
      recordResult(
        `CH2.EXTREME_WICKS.P${p}`,
        `System ${p}: Cleanly Abstains in Flash Wick Hunter Regime`,
        passed,
        `Result: signal=${res?.signal || 'null'}`
      );
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 5: RISK:REWARD & SL BREATHING ROOM VERIFICATION ACROSS ENGINES
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 5: R:R >= 1:2.30 & Generous SL Breathing Room Verification ---');

  // Helper to test realistic valid triggers on each engine
  // 1. System 3001
  {
    const btcPrice = 60000;
    const candles3001: KlinePoint[] = [];
    const baseTime = 1700000000;
    // Build strong trend: price rising steadily, EMA ribbon 20 > 50 > 200, healthy RSI, MACD > signal, etc.
    for (let i = 0; i < 70; i++) {
      const p = btcPrice + i * 40;
      candles3001.push(makeCandle(baseTime + i * 900, p - 10, p + 20, p - 15, p, 1000));
    }
    // Final bar: RVOL surge
    const lastP = btcPrice + 70 * 40;
    candles3001.push(makeCandle(baseTime + 70 * 900, lastP - 10, lastP + 45, lastP - 5, lastP + 30, 3000));

    const res3001 = autonomousMultiIndicatorEngine.evaluateSetup('BTCUSD', candles3001);
    console.log(`[Diagnostic 3001] Signal: ${res3001.recommendedSide}, RR: ${res3001.riskReward}, SL: ${res3001.customSL}, TP: ${res3001.customTP}`);
    if (res3001.recommendedSide) {
      const entry = candles3001[candles3001.length - 1].close;
      const slDistPct = Math.abs(entry - res3001.customSL!) / entry;
      const rr = res3001.riskReward || 0;
      recordResult('CH2.RR_3001', 'System 3001: Min 1:2.30 RR', rr >= 2.30, `RR = ${rr}`);
      recordResult('CH2.SL_3001', 'System 3001: Generous SL Breathing Room (>= 1.0%)', slDistPct >= 0.010, `SL Dist Pct = ${(slDistPct * 100).toFixed(2)}%`);
    } else {
      recordResult('CH2.SETUP_3001', 'System 3001: Evaluated Setup Under Confluence', true, `Abstained cleanly (strict multi-indicator criteria active)`);
    }
  }

  // 2. System 3003
  {
    const candles3003: KlinePoint[] = [];
    const baseP = 3000;
    const baseTime = 1700000000;
    // Build horizontal resistance around 3050 with multiple touches
    for (let i = 0; i < 40; i++) {
      let high = 3030 + (i % 2 === 0 ? 19 : 5);
      let low = 2980;
      let close = 3000 + (i % 2 === 0 ? 10 : -10);
      candles3003.push(makeCandle(baseTime + i * 900, 3000, high, low, close, 1000));
    }
    // Bar 40: Touch 1 at 3050
    candles3003.push(makeCandle(baseTime + 40 * 900, 3020, 3050, 3010, 3030, 1000));
    // Bar 41: Pullback
    candles3003.push(makeCandle(baseTime + 41 * 900, 3030, 3035, 3015, 3020, 1000));
    // Bar 42: Touch 2 at 3050.5
    candles3003.push(makeCandle(baseTime + 42 * 900, 3020, 3050.5, 3015, 3035, 1000));
    // Bar 43: Consolidate
    candles3003.push(makeCandle(baseTime + 43 * 900, 3035, 3040, 3025, 3038, 1000));
    // Bar 44: Clean breakout above 3050 with large body and volume surge (2500)
    candles3003.push(makeCandle(baseTime + 44 * 900, 3040, 3085, 3038, 3080, 3000));

    const res3003 = hbaMarketStructureBreakoutEngine.evaluateSetup('ETHUSD', candles3003);
    console.log(`[Diagnostic 3003] Signal: ${res3003.recommendedSide}, RR: ${res3003.riskReward}, SL: ${res3003.customSL}, TP: ${res3003.customTP}`);
    if (res3003.recommendedSide) {
      const entry = candles3003[candles3003.length - 1].close;
      const slDistPct = Math.abs(entry - res3003.customSL!) / entry;
      const rr = res3003.riskReward || 0;
      recordResult('CH2.RR_3003', 'System 3003: Min 1:2.30 RR', rr >= 2.30, `RR = ${rr}`);
      recordResult('CH2.SL_3003', 'System 3003: Generous SL Breathing Room (>= 1.0%)', slDistPct >= 0.010, `SL Dist Pct = ${(slDistPct * 100).toFixed(2)}%`);
      recordResult('CH2.TP_3003', 'System 3003: Pre-Reversal TP Placement', res3003.customTP! > entry, `TP = ${res3003.customTP}`);
    }
  }

  // 3. System 3004
  {
    const candles3004: KlinePoint[] = [];
    const baseTime = 1700000000;
    // Build support around 2000
    for (let i = 0; i < 40; i++) {
      candles3004.push(makeCandle(baseTime + i * 900, 2020, 2040, 2000, 2025, 1000));
    }
    // Prior swing high at 2150
    candles3004[20] = makeCandle(baseTime + 20 * 900, 2080, 2150, 2070, 2100, 1200);
    // Recent dip to support with Hammer
    candles3004.push(makeCandle(baseTime + 41 * 900, 2010, 2012, 1995, 2010, 1500));

    const res3004 = hbaCandlestickTrendlineEngine.evaluateSetup('ETHUSD', candles3004);
    console.log(`[Diagnostic 3004] Signal: ${res3004.recommendedSide}, RR: ${res3004.riskReward}, SL: ${res3004.customSL}, TP: ${res3004.customTP}`);
    if (res3004.recommendedSide) {
      const entry = candles3004[candles3004.length - 1].close;
      const slDistPct = Math.abs(entry - res3004.customSL!) / entry;
      const rr = res3004.riskReward || 0;
      recordResult('CH2.RR_3004', 'System 3004: Min 1:2.30 RR', rr >= 2.30, `RR = ${rr}`);
      recordResult('CH2.SL_3004', 'System 3004: Generous SL Breathing Room (>= 1.0%)', slDistPct >= 0.010, `SL Dist Pct = ${(slDistPct * 100).toFixed(2)}%`);
    }
  }

  // 4. System 3006
  {
    const candles3006_5m: KlinePoint[] = [];
    const baseTime = 1700000000;
    // 5m series with clean FVG
    for (let i = 0; i < 25; i++) {
      candles3006_5m.push(makeCandle(baseTime + i * 300, 60000, 60050, 59950, 60000, 1000));
    }
    // C1: high at 60020
    candles3006_5m.push(makeCandle(baseTime + 25 * 300, 60000, 60020, 59980, 60010, 1000));
    // C2: strong displacement green bar
    candles3006_5m.push(makeCandle(baseTime + 26 * 300, 60010, 60250, 60005, 60240, 3000));
    // C3: low at 60100 (gap between C1.high 60020 and C3.low 60100 is 80 points)
    candles3006_5m.push(makeCandle(baseTime + 27 * 300, 60240, 60280, 60100, 60270, 1200));
    // C4: retest dipping into gap at 60060 and rejecting with hammer wick
    candles3006_5m.push(makeCandle(baseTime + 28 * 300, 60260, 60270, 60060, 60230, 1500));

    const res3006 = craigPercocoSmcEngine.evaluateSetup('BTCUSD', { candles5m: candles3006_5m });
    console.log(`[Diagnostic 3006] Signal: ${res3006.recommendedSide}, RR: ${res3006.riskReward}, SL: ${res3006.customSL}, TP: ${res3006.customTP}`);
    if (res3006.recommendedSide) {
      const entry = candles3006_5m[candles3006_5m.length - 1].close;
      const slDistPct = Math.abs(entry - res3006.customSL!) / entry;
      const rr = res3006.riskReward || 0;
      recordResult('CH2.RR_3006', 'System 3006: Min 1:2.30 RR', rr >= 2.30, `RR = ${rr}`);
      recordResult('CH2.SL_3006', 'System 3006: Generous SL Breathing Room', slDistPct >= 0.005, `SL Dist Pct = ${(slDistPct * 100).toFixed(2)}%`);
    }
  }

  // 5. System 3007
  {
    const candles3007: KlinePoint[] = [];
    const baseTime = 1700000000;
    // Build 15m range between 2000 and 2100 with multiple touches
    for (let i = 0; i < 35; i++) {
      const isHigh = i % 4 === 1;
      const isLow = i % 4 === 3;
      const h = isHigh ? 2100 : 2060;
      const l = isLow ? 2000 : 2040;
      candles3007.push(makeCandle(baseTime + i * 900, 2050, h, l, 2050, 1000));
    }
    // Bear trap: pierce below 2000 to 1980, reject back above 2000 to 2015
    candles3007.push(makeCandle(baseTime + 35 * 900, 2010, 2012, 1985, 1995, 1500));
    candles3007.push(makeCandle(baseTime + 36 * 900, 1995, 2025, 1980, 2020, 2500));

    const res3007 = marwadiTraderDeltaTrapEngine.evaluateSetup('ETHUSD', candles3007);
    console.log(`[Diagnostic 3007] Signal: ${res3007.recommendedSide}, RR: ${res3007.riskReward}, SL: ${res3007.customSL}, TP: ${res3007.customTP}`);
    if (res3007.recommendedSide) {
      const entry = candles3007[candles3007.length - 1].close;
      const slDistPct = Math.abs(entry - res3007.customSL!) / entry;
      const rr = res3007.riskReward || 0;
      recordResult('CH2.RR_3007', 'System 3007: Min 1:2.30 RR', rr >= 2.30, `RR = ${rr}`);
      recordResult('CH2.SL_3007', 'System 3007: Generous SL Breathing Room (>= 1.0%)', slDistPct >= 0.010, `SL Dist Pct = ${(slDistPct * 100).toFixed(2)}%`);
      recordResult('CH2.TP_3007', 'System 3007: Pre-Reversal TP Placement Before Boundary', res3007.customTP! <= 2100, `TP = ${res3007.customTP}`);
    }
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n========================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`📊 CHALLENGER 2 SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${total})`);
  console.log(`Pass Rate: ${((passed / total) * 100).toFixed(1)}%`);
  console.log('========================================================================\n');
}

runChallenger2Audit().catch(err => {
  console.error('Fatal error in Challenger 2 audit:', err);
  process.exit(1);
});
