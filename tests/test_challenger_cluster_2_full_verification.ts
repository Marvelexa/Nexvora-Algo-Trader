/**
 * ============================================================================
 * CHALLENGER CLUSTER 2: FULL EMPIRICAL VERIFICATION & ADVERSARIAL HARNESS
 * ============================================================================
 * Engines under evaluation:
 * 1. System 3001: Autonomous Multi-Indicator Engine (autonomousMultiIndicatorEngine.ts)
 * 2. System 3003: HBA Market Structure Breakout (hbaMarketStructureBreakoutEngine.ts)
 * 3. System 3004: HBA Candlestick & Trendline Retest (hbaCandlestickTrendlineEngine.ts)
 * 4. System 3006: Craig Percoco Smart Money FVG (craigPercocoSmcEngine.ts)
 * 5. System 3007: Marwadi Trader Delta Trap (marwadiTraderDeltaTrapEngine.ts)
 * ============================================================================
 */

import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { autonomousMultiIndicatorEngine } from '../lib/strategies/autonomousMultiIndicatorEngine';
import { hbaMarketStructureBreakoutEngine } from '../lib/strategies/hbaMarketStructureBreakoutEngine';
import { hbaCandlestickTrendlineEngine } from '../lib/strategies/hbaCandlestickTrendlineEngine';
import { craigPercocoSmcEngine } from '../lib/strategies/craigPercocoSmcEngine';
import { marwadiTraderDeltaTrapEngine } from '../lib/strategies/marwadiTraderDeltaTrapEngine';
import { mathRiskEngine } from '../lib/mathematicalRiskEngine';
import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { KlinePoint } from '../src/types';

interface VerificationResult {
  category: string;
  testId: string;
  name: string;
  passed: boolean;
  details: string;
}

const allResults: VerificationResult[] = [];

function record(category: string, testId: string, name: string, passed: boolean, details: string) {
  allResults.push({ category, testId, name, passed, details });
  const icon = passed ? '✅ [PASS]' : '❌ [FAIL]';
  console.log(`${icon} [${testId}] ${name} -> ${details}`);
}

function makeCandle(time: number, open: number, high: number, low: number, close: number, volume: number = 1000): KlinePoint {
  return { time, open, high, low, close, volume };
}

function calcATR(candles: KlinePoint[], period: number = 14): number {
  if (candles.length < 2) return 1.0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ----------------------------------------------------------------------------
// SYNTHETIC MARKET GENERATORS
// ----------------------------------------------------------------------------

function generateRandomWalk(bars: number = 60, startPrice: number = 2500, volatility: number = 2): KlinePoint[] {
  const candles: KlinePoint[] = [];
  let price = startPrice;
  const baseTime = 1700000000;
  for (let i = 0; i < bars; i++) {
    const delta = (Math.random() - 0.5) * volatility * 2;
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + Math.random() * volatility;
    const low = Math.min(open, close) - Math.random() * volatility;
    const volume = 300 + Math.random() * 500;
    candles.push(makeCandle(baseTime + i * 900, open, high, low, close, volume));
    price = close;
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

function generateSpikeChop(bars: number = 60, startPrice: number = 3000, spikeSize: number = 50): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < bars; i++) {
    const spike = (i % 2 === 0 ? spikeSize : -spikeSize);
    candles.push(makeCandle(baseTime + i * 900, startPrice + spike, startPrice + spike + 40, startPrice + spike - 40, startPrice - spike, 5000));
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

// ----------------------------------------------------------------------------
// AUTHENTIC SCENARIO BUILDERS
// ----------------------------------------------------------------------------

// 1. System 3001 Scenario Builder
function build3001Scenario(side: 'BUY' | 'SELL'): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  const startPrice = side === 'BUY' ? 2000 : 3500;
  const step = side === 'BUY' ? 12 : -12;

  // Build 210 bars to give 200 EMA clean history and allow ribbon to stack:
  // For BUY: Price > 20 EMA > 50 EMA > 200 EMA
  for (let i = 0; i < 210; i++) {
    const p = startPrice + i * step;
    const open = p - step * 0.4;
    const close = p;
    const high = Math.max(open, close) + 8;
    const low = Math.min(open, close) - 8;
    // Volume steady around 1000
    candles.push(makeCandle(baseTime + i * 900, open, high, low, close, 1000));
  }

  // Final bar: Surge in volume (2500 vs avg 1000 = 2.5x RVOL), healthy range
  const lastIdx = candles.length - 1;
  const lastClose = candles[lastIdx].close;
  const surgeClose = side === 'BUY' ? lastClose + 15 : lastClose - 15;
  const surgeOpen = lastClose;
  const surgeHigh = side === 'BUY' ? surgeClose + 5 : surgeOpen + 5;
  const surgeLow = side === 'BUY' ? surgeOpen - 5 : surgeClose - 5;
  candles[lastIdx] = makeCandle(baseTime + lastIdx * 900, surgeOpen, surgeHigh, surgeLow, surgeClose, 2500);

  return candles;
}

// 2. System 3003 Scenario Builder
function build3003Scenario(side: 'BUY' | 'SELL'): { candles15m: KlinePoint[]; candles1h: KlinePoint[] } {
  const candles15m: KlinePoint[] = [];
  const baseTime = 1700000000;
  const baseP = 3000;
  const rLevel = 3050;
  const sLevel = 2950;

  for (let i = 0; i < 45; i++) {
    const isPeak = i === 10 || i === 25;
    const isTrough = i === 18 || i === 35;
    const high = isPeak ? rLevel : 3030;
    const low = isTrough ? sLevel : 2970;
    candles15m.push(makeCandle(baseTime + i * 900, 3000, high, low, 3000, 1000));
  }

  // Pre-breakout bar
  const preClose = side === 'BUY' ? rLevel - 2 : sLevel + 2;
  candles15m.push(makeCandle(baseTime + 45 * 900, preClose - 2, preClose + 2, preClose - 3, preClose, 1000));

  // Breakout bar with strong body and 2.5x volume
  if (side === 'BUY') {
    const boOpen = rLevel - 4;
    const boClose = rLevel + 30;
    candles15m.push(makeCandle(baseTime + 46 * 900, boOpen, boClose + 5, boOpen - 2, boClose, 2500));
  } else {
    const boOpen = sLevel + 4;
    const boClose = sLevel - 30;
    candles15m.push(makeCandle(baseTime + 46 * 900, boOpen, boOpen + 2, boClose - 5, boClose, 2500));
  }

  // Add structural barriers in history
  if (side === 'BUY') {
    candles15m[5] = makeCandle(baseTime + 5 * 900, 3300, 3350, 3290, 3310, 1000);
  } else {
    candles15m[5] = makeCandle(baseTime + 5 * 900, 2680, 2700, 2650, 2670, 1000);
  }

  // 1H candles aligned with trend
  const candles1h: KlinePoint[] = [];
  const ema1hPrice = side === 'BUY' ? 2950 : 3100;
  for (let h = 0; h < 25; h++) {
    candles1h.push(makeCandle(baseTime + h * 3600, ema1hPrice, ema1hPrice + 10, ema1hPrice - 10, ema1hPrice, 4000));
  }

  return { candles15m, candles1h };
}

// 3. System 3004 Scenario Builder
function build3004Scenario(side: 'BUY' | 'SELL'): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  const sLevel = 2000;
  const rLevel = 2200;

  for (let i = 0; i < 40; i++) {
    const isLow = i === 10 || i === 25;
    const isHigh = i === 15 || i === 30;
    const high = isHigh ? rLevel : 2120;
    const low = isLow ? sLevel : 2080;
    candles.push(makeCandle(baseTime + i * 900, 2100, high, low, 2100, 1000));
  }

  // Prior swing high/low for TP placement
  if (side === 'BUY') {
    candles[20] = makeCandle(baseTime + 20 * 900, 2240, 2300, 2230, 2260, 1200);
    // Hammer at support: open 2010, close 2015, high 2017, low 1985 (lower wick 25 vs body 5 = 5x body!)
    candles.push(makeCandle(baseTime + 41 * 900, 2010, 2017, 1985, 2015, 1500));
  } else {
    candles[20] = makeCandle(baseTime + 20 * 900, 1950, 1960, 1900, 1920, 1200);
    // Shooting Star at resistance: open 2190, close 2185, low 2183, high 2225 (upper wick 35 vs body 5 = 7x body!)
    candles.push(makeCandle(baseTime + 41 * 900, 2190, 2225, 2183, 2185, 1500));
  }

  return candles;
}

// 4. System 3006 Scenario Builder
function build3006Scenario(side: 'BUY' | 'SELL'): { candles5m: KlinePoint[]; candles1h: KlinePoint[] } {
  const candles5m: KlinePoint[] = [];
  const baseTime = 1700000000;
  const baseP = 60000;

  for (let i = 0; i < 40; i++) {
    candles5m.push(makeCandle(baseTime + i * 300, baseP, baseP + 30, baseP - 30, baseP + 5, 1000));
  }

  // Opposing liquidity pool far ahead for Pre-Reversal TP
  if (side === 'BUY') {
    candles5m[10].high = 63000;
    // C1: high at 60050
    candles5m.push(makeCandle(baseTime + 40 * 300, 60000, 60050, 59990, 60040, 1000));
    // C2: strong displacement candle body 250, volume 3500
    candles5m.push(makeCandle(baseTime + 41 * 300, 60040, 60300, 60030, 60290, 3500));
    // C3: low at 60120 (gap = 60120 - 60050 = 70 points)
    candles5m.push(makeCandle(baseTime + 42 * 300, 60290, 60350, 60120, 60330, 1200));
    // C4: retest dipping into gap at 60080 with rejection wick
    candles5m.push(makeCandle(baseTime + 43 * 300, 60200, 60220, 60080, 60180, 2200));
  } else {
    candles5m[10].low = 57000;
    // C1: low at 59950
    candles5m.push(makeCandle(baseTime + 40 * 300, 60000, 60010, 59950, 59960, 1000));
    // C2: strong displacement red candle
    candles5m.push(makeCandle(baseTime + 41 * 300, 59960, 59970, 59700, 59710, 3500));
    // C3: high at 59880 (gap = 59950 - 59880 = 70 points)
    candles5m.push(makeCandle(baseTime + 42 * 300, 59710, 59880, 59650, 59670, 1200));
    // C4: retest into gap at 59920 with rejection wick
    candles5m.push(makeCandle(baseTime + 43 * 300, 59800, 59920, 59780, 59820, 2200));
  }

  // 1H trend alignment
  const candles1h: KlinePoint[] = [];
  for (let h = 0; h < 25; h++) {
    const p = side === 'BUY' ? 58000 + h * 50 : 62000 - h * 50;
    candles1h.push(makeCandle(baseTime + h * 3600, p, p + 50, p - 50, p, 5000));
  }

  return { candles5m, candles1h };
}

// 5. System 3007 Scenario Builder
function build3007Scenario(side: 'BUY' | 'SELL'): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  const rangeHigh = 2100;
  const rangeLow = 1950;

  for (let i = 0; i < 35; i++) {
    const isHigh = i === 4 || i === 20;
    const isLow = i === 12 || i === 28;
    const h = isHigh ? rangeHigh : 2060;
    const l = isLow ? rangeLow : 1980;
    candles.push(makeCandle(baseTime + i * 900, 2025, h, l, 2025, 1000));
  }

  if (side === 'BUY') {
    // Bear Trap: breakdown below 1950 to 1930, followed by sharp rejection back inside
    candles.push(makeCandle(baseTime + 35 * 900, 1960, 1962, 1935, 1940, 1200));
    candles.push(makeCandle(baseTime + 36 * 900, 1940, 1970, 1928, 1965, 2500));
  } else {
    // Bull Trap: breakout above 2100 to 2120, followed by sharp rejection back inside
    candles.push(makeCandle(baseTime + 35 * 900, 2080, 2115, 2078, 2110, 1200));
    candles.push(makeCandle(baseTime + 36 * 900, 2110, 2122, 2080, 2085, 2500));
  }

  return candles;
}

// ----------------------------------------------------------------------------
// MAIN AUDIT EXECUTION
// ----------------------------------------------------------------------------

async function runEmpiricalAudit() {
  console.log('========================================================================');
  console.log('⚡ CHALLENGER CLUSTER 2: COMPREHENSIVE EMPIRICAL AUDIT EXECUTION');
  console.log('========================================================================\n');

  // ==========================================================================
  // SECTION 1: ADVERSARIAL STRESS TESTING (Zero False Triggers Mandate)
  // ==========================================================================
  console.log('--- SECTION 1: Adversarial Stress Testing Across 5 Engines ---');
  const targetPorts = [3001, 3003, 3004, 3006, 3007];

  // 1A: 500 Random Walk Series
  const rwCount: Record<number, number> = { 3001: 0, 3003: 0, 3004: 0, 3006: 0, 3007: 0 };
  const rwExamples: Record<number, any[]> = { 3001: [], 3003: [], 3004: [], 3006: [], 3007: [] };

  for (let i = 0; i < 500; i++) {
    const rw = generateRandomWalk(60, 2500, 2.0);
    for (const p of targetPorts) {
      const res = evaluateStrategyForPort(p, 'ETHUSD', rw);
      if (res && res.signal !== null) {
        rwCount[p]++;
        if (rwExamples[p].length < 2) rwExamples[p].push(res);
      }
    }
  }

  for (const p of targetPorts) {
    const cnt = rwCount[p];
    record(
      'ADVERSARIAL_NOISE',
      `ADV.RW500.P${p}`,
      `System ${p}: Zero False Triggers across 500 Random Walk Series (vol=2.0)`,
      cnt === 0,
      `Observed triggers: ${cnt} / 500 ${cnt > 0 ? JSON.stringify(rwExamples[p][0].reasons[0]) : ''}`
    );
  }

  // 1B: Dead Flatline Chop
  const flatCandles = generateFlatline(60, 2000);
  for (const p of targetPorts) {
    const res = evaluateStrategyForPort(p, 'ETHUSD', flatCandles);
    const pass = !res || res.signal === null;
    record(
      'ADVERSARIAL_FLATLINE',
      `ADV.FLAT.P${p}`,
      `System ${p}: Clean Abstention in Dead Flatline Market`,
      pass,
      `Signal: ${res?.signal || 'null'}`
    );
  }

  // 1C: Spike Chop
  const spikeCandles = generateSpikeChop(60, 3000, 50);
  for (const p of targetPorts) {
    const res = evaluateStrategyForPort(p, 'ETHUSD', spikeCandles);
    const pass = !res || res.signal === null;
    record(
      'ADVERSARIAL_SPIKE',
      `ADV.SPIKE.P${p}`,
      `System ${p}: Clean Abstention in Erratic Alternating Spike Chop`,
      pass,
      `Signal: ${res?.signal || 'null'}`
    );
  }

  // 1D: Extreme Wick Spikes
  const wickCandles = generateExtremeWickSpikes(60, 2500);
  for (const p of targetPorts) {
    const res = evaluateStrategyForPort(p, 'ETHUSD', wickCandles);
    const pass = !res || res.signal === null;
    record(
      'ADVERSARIAL_WICKS',
      `ADV.WICKS.P${p}`,
      `System ${p}: Clean Abstention in Extreme Wick Hunt Regime`,
      pass,
      `Signal: ${res?.signal || 'null'}`
    );
  }

  // ==========================================================================
  // SECTION 2: AUTHENTIC SCENARIOS & MATHEMATICAL RISK METRICS
  // ==========================================================================
  console.log('\n--- SECTION 2: Authentic Setup Generation, R:R >= 2.30, SL Breathing Room & Pre-Reversal TP ---');

  // Helper verification for a setup result
  function verifySetupMetrics(
    systemId: string,
    side: 'BUY' | 'SELL',
    res: any,
    entryPrice: number,
    atrVal: number
  ) {
    if (!res || !res.recommendedSide) {
      record('SETUP_VALIDITY', `SETUP.${systemId}.${side}`, `${systemId} ${side}: Valid Setup Generated`, false, 'Signal returned null');
      return;
    }

    const recSide = res.recommendedSide;
    const isCorrectSide = recSide === side;
    record(
      'SETUP_VALIDITY',
      `SETUP.${systemId}.${side}`,
      `${systemId} ${side}: Valid Signal Generated`,
      isCorrectSide,
      `Signal = ${recSide} (expected ${side})`
    );

    const sl = res.customSL!;
    const tp = res.customTP!;
    const rr = res.riskReward || 0;

    // Check R:R >= 2.30
    record(
      'RR_RATIO',
      `RR.${systemId}.${side}`,
      `${systemId} ${side}: Enforces Strict Minimum 1:2.30 Risk:Reward`,
      rr >= 2.30,
      `Actual R:R = 1:${rr.toFixed(2)} (>= 1:2.30 mandated)`
    );

    // Check Stop Loss Breathing Room
    const slDist = Math.abs(entryPrice - sl);
    const slDistPct = slDist / entryPrice;
    const slAtrMult = slDist / (atrVal || 1);

    const hasBreathingRoom = slDistPct >= 0.010; // at least 1.0% price distance
    record(
      'SL_BREATHING_ROOM',
      `SL_ROOM.${systemId}.${side}`,
      `${systemId} ${side}: Generous SL Breathing Room (>= 1.0% Price Distance)`,
      hasBreathingRoom,
      `SL Distance = ${slDist.toFixed(2)} (${(slDistPct * 100).toFixed(2)}% of price, ${slAtrMult.toFixed(2)}x ATR)`
    );

    // Check Pre-Reversal TP Placement
    const isPreReversal = side === 'BUY' ? tp > entryPrice : tp < entryPrice;
    record(
      'PRE_REVERSAL_TP',
      `TP_PREREV.${systemId}.${side}`,
      `${systemId} ${side}: Pre-Reversal TP Positioned in Direction of Trade`,
      isPreReversal,
      `Entry = ${entryPrice.toFixed(2)}, TP = ${tp.toFixed(2)}, SL = ${sl.toFixed(2)}`
    );
  }

  // 2A: System 3001
  console.log('\n--- Evaluating System 3001 (Autonomous Multi-Indicator Engine) ---');
  {
    const buyCandles = build3001Scenario('BUY');
    const buyRes = autonomousMultiIndicatorEngine.evaluateSetup('ETHUSD', buyCandles);
    const buyEntry = buyCandles[buyCandles.length - 1].close;
    const atrBuy = calcATR(buyCandles, 14);
    verifySetupMetrics('S3001', 'BUY', buyRes, buyEntry, atrBuy);

    const sellCandles = build3001Scenario('SELL');
    const sellRes = autonomousMultiIndicatorEngine.evaluateSetup('ETHUSD', sellCandles);
    const sellEntry = sellCandles[sellCandles.length - 1].close;
    const atrSell = calcATR(sellCandles, 14);
    verifySetupMetrics('S3001', 'SELL', sellRes, sellEntry, atrSell);
  }

  // 2B: System 3003
  console.log('\n--- Evaluating System 3003 (HBA Market Structure Breakout) ---');
  {
    const buyData = build3003Scenario('BUY');
    const buyRes = hbaMarketStructureBreakoutEngine.evaluateSetup('ETHUSD', buyData);
    const buyEntry = buyData.candles15m[buyData.candles15m.length - 1].close;
    const atrBuy = calcATR(buyData.candles15m, 14);
    verifySetupMetrics('S3003', 'BUY', buyRes, buyEntry, atrBuy);

    const sellData = build3003Scenario('SELL');
    const sellRes = hbaMarketStructureBreakoutEngine.evaluateSetup('ETHUSD', sellData);
    const sellEntry = sellData.candles15m[sellData.candles15m.length - 1].close;
    const atrSell = calcATR(sellData.candles15m, 14);
    verifySetupMetrics('S3003', 'SELL', sellRes, sellEntry, atrSell);
  }

  // 2C: System 3004
  console.log('\n--- Evaluating System 3004 (HBA Candlestick & Trendline Retest) ---');
  {
    const buyCandles = build3004Scenario('BUY');
    const buyRes = hbaCandlestickTrendlineEngine.evaluateSetup('ETHUSD', buyCandles);
    const buyEntry = buyCandles[buyCandles.length - 1].close;
    const atrBuy = calcATR(buyCandles, 14);
    verifySetupMetrics('S3004', 'BUY', buyRes, buyEntry, atrBuy);

    const sellCandles = build3004Scenario('SELL');
    const sellRes = hbaCandlestickTrendlineEngine.evaluateSetup('ETHUSD', sellCandles);
    const sellEntry = sellCandles[sellCandles.length - 1].close;
    const atrSell = calcATR(sellCandles, 14);
    verifySetupMetrics('S3004', 'SELL', sellRes, sellEntry, atrSell);
  }

  // 2D: System 3006
  console.log('\n--- Evaluating System 3006 (Craig Percoco Smart Money FVG) ---');
  {
    const buyData = build3006Scenario('BUY');
    const buyRes = craigPercocoSmcEngine.evaluateSetup('BTCUSD', buyData);
    const buyEntry = buyData.candles5m[buyData.candles5m.length - 1].close;
    const atrBuy = calcATR(buyData.candles5m, 14);
    verifySetupMetrics('S3006', 'BUY', buyRes, buyEntry, atrBuy);

    const sellData = build3006Scenario('SELL');
    const sellRes = craigPercocoSmcEngine.evaluateSetup('BTCUSD', sellData);
    const sellEntry = sellData.candles5m[sellData.candles5m.length - 1].close;
    const atrSell = calcATR(sellData.candles5m, 14);
    verifySetupMetrics('S3006', 'SELL', sellRes, sellEntry, atrSell);
  }

  // 2E: System 3007
  console.log('\n--- Evaluating System 3007 (Marwadi Trader Delta Trap) ---');
  {
    const buyCandles = build3007Scenario('BUY');
    const buyRes = marwadiTraderDeltaTrapEngine.evaluateSetup('ETHUSD', buyCandles);
    const buyEntry = buyCandles[buyCandles.length - 1].close;
    const atrBuy = calcATR(buyCandles, 14);
    verifySetupMetrics('S3007', 'BUY', buyRes, buyEntry, atrBuy);

    const sellCandles = build3007Scenario('SELL');
    const sellRes = marwadiTraderDeltaTrapEngine.evaluateSetup('ETHUSD', sellCandles);
    const sellEntry = sellCandles[sellCandles.length - 1].close;
    const atrSell = calcATR(sellCandles, 14);
    verifySetupMetrics('S3007', 'SELL', sellRes, sellEntry, atrSell);
  }

  // ==========================================================================
  // SECTION 3: DOWNSTREAM RISK ENGINE & DAEMON INTEGRITY
  // ==========================================================================
  console.log('\n--- SECTION 3: Downstream Risk Engine & Daemon Verification ---');
  {
    // Test mathRiskEngine buffer floor
    const geomRes = mathRiskEngine.calculateGeometricTargets({
      side: 'BUY',
      entryPrice: 65000,
      atr: 250,
      structuralSL: 64900, // close swing low (only 100 away)
      structuralTPTarget: 68000,
      tickSize: 0.1,
      decimals: 1,
    });

    const riskDist = 65000 - geomRes.stopLossPrice;
    const minBuffer = Math.max(1.25 * 250, 65000 * 0.010); // at least 1.25 ATR or 1.0% = 650
    record(
      'RISK_ENGINE',
      'RE.SL_FLOOR',
      'Mathematical Risk Engine enforces >= 1.25 ATR / >= 1.0% SL floor (no 0.40 ATR squeeze)',
      riskDist >= minBuffer,
      `Calculated SL Distance = ${riskDist} (Floor = ${minBuffer}, SL = ${geomRes.stopLossPrice})`
    );

    record(
      'RISK_ENGINE',
      'RE.RR_RATIO',
      'Mathematical Risk Engine enforces >= 1:2.30 R:R',
      geomRes.riskRewardRatio >= 2.30,
      `Calculated R:R = ${geomRes.riskRewardRatio}`
    );

    // Verify Daemon Target Profit Cap
    const targetProfit = (deltaAutoTrader as any).riskConfig?.targetProfitUSD || 0;
    record(
      'DAEMON_RISK',
      'DAEMON.PROFIT_CAP',
      'Delta Auto Trader Daemon Profit Cap >= $34.50 (2.30x $15 max loss)',
      targetProfit >= 34.50,
      `Configured targetProfitUSD = $${targetProfit}`
    );
  }

  // ==========================================================================
  // FINAL REPORT & TALLY
  // ==========================================================================
  console.log('\n========================================================================');
  const total = allResults.length;
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  console.log(`📊 CHALLENGER 2 FINAL TALLY: ${passed} PASSED, ${failed} FAILED (Total: ${total})`);
  console.log(`Pass Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ FAILED CHECKS SUMMARY:');
    allResults.filter(r => !r.passed).forEach(r => {
      console.log(`  - [${r.testId}] ${r.name}: ${r.details}`);
    });
  }
  console.log('========================================================================\n');
}

runEmpiricalAudit().catch(err => {
  console.error('Fatal error in empirical audit:', err);
  process.exit(1);
});
