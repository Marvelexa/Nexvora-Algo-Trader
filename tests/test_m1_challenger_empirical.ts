/**
 * ============================================================================
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE: MILESTONE 1 (SYSTEMS 3002 & 3003)
 * ============================================================================
 * Target Systems:
 * - System 3002: Whiteboard Crypto AMM Constant Product Curve & Elasticity Snapback Reversal
 * - System 3003: HBA Services Market Structure Breakout
 * - Delta Contract Specifications & Diverse Tick Sizes
 */

import { whiteboardCryptoDeFiEngine } from '../lib/strategies/whiteboardCryptoDeFiEngine';
import { hbaMarketStructureBreakoutEngine } from '../lib/strategies/hbaMarketStructureBreakoutEngine';
import { DELTA_PRODUCT_SPECS } from '../lib/deltaExchangeEngine';
import { KlinePoint } from '../src/types';

interface EmpiricalTestResult {
  id: string;
  system: string;
  description: string;
  passed: boolean;
  details: string;
  bugReport?: string;
}

const testResults: EmpiricalTestResult[] = [];

function assert(
  id: string,
  system: string,
  description: string,
  condition: boolean,
  details: string,
  bugReport?: string
): void {
  const result: EmpiricalTestResult = {
    id,
    system,
    description,
    passed: condition,
    details,
    bugReport: !condition ? bugReport : undefined,
  };
  testResults.push(result);
  if (condition) {
    console.log(`  ✅ [PASS] [${id}] ${description}`);
  } else {
    console.error(`  ❌ [FAIL] [${id}] ${description}`);
    console.error(`     Details: ${details}`);
    if (bugReport) console.error(`     BUG: ${bugReport}`);
  }
}

// ============================================================================
// CANDLE GENERATORS & HELPERS
// ============================================================================

function createCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number = 1000
): KlinePoint {
  return { time, open, high, low, close, volume };
}

function buildBaseTrendCandles(
  count: number,
  basePrice: number,
  slope: number,
  volatility: number,
  baseVolume: number = 1000
): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < count; i++) {
    const price = basePrice + i * slope;
    candles.push(
      createCandle(
        baseTime + i * 900,
        price - volatility * 0.2,
        price + volatility,
        price - volatility,
        price + volatility * 0.2,
        baseVolume
      )
    );
  }
  return candles;
}

// ============================================================================
// TEST SUITE EXECUTION
// ============================================================================

async function runEmpiricalChallenge(): Promise<void> {
  console.log('\n====================================================================');
  console.log('⚡ STARTING EMPIRICAL ADVERSARIAL CHALLENGE (SYSTEMS 3002 & 3003)');
  console.log('====================================================================\n');

  // ==========================================================================
  // 1. SYSTEM 3002 AMM BB %B SNAPBACK REVERSAL
  // ==========================================================================
  console.log('--- 1. SYSTEM 3002: AMM BB %B SNAPBACK REVERSAL ---');

  // 1.1: %B < 0.0 with RVOL < 1.35 and candleRange < 1.5*ATR -> MUST NOT TRIGGER
  {
    const candles = buildBaseTrendCandles(40, 80000, 2, 20, 2000);
    // Baseline closes around 80080.
    // Calculate BB
    const closes = candles.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const lowerBB = mean - stdDev * 2.0;

    // Plunge bar below lowerBB (%B < 0), but with normal/low volume (RVOL = 1.0 < 1.35) and small range (< 1.5 ATR)
    const atr = whiteboardCryptoDeFiEngine.calcATR(candles, 14);
    const plungeLow = lowerBB - 20; // lower excursion
    const plungeClose = lowerBB + 5; // close back inside
    const plungeOpen = lowerBB + 2;
    const plungeHigh = plungeClose + 2;
    // candleRange = (plungeHigh - plungeLow) = 29. If ATR is ~35, candleRange < 1.5 * ATR
    const currentCandle = createCandle(1700040000, plungeOpen, plungeHigh, plungeLow, plungeClose, 2000); // RVOL = 1.0
    candles.push(currentCandle);

    const res = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      'CHALLENGE-3002-01',
      'System 3002',
      '%B < 0.0 with volume surge missing (RVOL = 1.0 < 1.35, Range < 1.5 ATR) must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered despite missing volume surge!'
    );
  }

  // 1.2: Adversarial Edge Case: RVOL < 1.35 (e.g. RVOL = 0.5) BUT candleRange >= 1.5*ATR (fallback loophole)
  {
    const candles = buildBaseTrendCandles(40, 80000, 2, 20, 2000);
    const closes = candles.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const lowerBB = mean - stdDev * 2.0;

    const atr = whiteboardCryptoDeFiEngine.calcATR(candles, 14);
    const deepLow = lowerBB - (atr * 1.6);
    const closeBackInside = lowerBB + 10;
    const openPrice = lowerBB + 5;
    const highPrice = closeBackInside + 2;
    // Low volume: only 800 (average is 2000, RVOL = 0.40)
    const currentCandle = createCandle(1700040000, openPrice, highPrice, deepLow, closeBackInside, 800);
    candles.push(currentCandle);

    const res = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', candles);
    const triggered = res.recommendedSide === 'BUY';
    console.log(
      `     [AUDIT NOTE] Low volume (RVOL = 0.40) with wide range (range >= 1.5 ATR): Triggered = ${triggered}. (Worker implemented range fallback 'rvol >= 1.35 || candleRange >= 1.50 * atr')`
    );
  }

  // 1.3: %B < 0.0 and volume surge (RVOL >= 1.35), but lower rejection wick < 35% -> MUST NOT TRIGGER
  {
    const candles = buildBaseTrendCandles(40, 80000, 2, 20, 2000);
    const closes = candles.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const lowerBB = mean - stdDev * 2.0;

    // Create candle where lower wick is small (< 35% of range)
    // Range = 40. Lower wick = min(open, close) - low = 5 (5/40 = 12.5% < 35%)
    const low = lowerBB - 5;
    const open = lowerBB;
    const close = lowerBB + 30; // closes back inside
    const high = close + 5;
    const highVolume = 5000; // RVOL = 2.5 > 1.35
    candles.push(createCandle(1700040000, open, high, low, close, highVolume));

    const res = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      'CHALLENGE-3002-02',
      'System 3002',
      '%B < 0.0 with RVOL >= 1.35 but lower rejection wick < 35% must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered with weak rejection wick (< 35%)!'
    );
  }

  // 1.4: Valid Long Setup -> Verify R:R >= 2.00 AND pre-reversal TP buffer placed before opposite band
  {
    const candles = buildBaseTrendCandles(50, 80000, 3, 25, 2000);
    const closes = candles.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const upperBB = mean + stdDev * 2.0;
    const lowerBB = mean - stdDev * 2.0;

    // Plunge bar with excursion and absorption lower wick, closing inside lowerBB with sufficient room for 2:1 RR
    const deepLow = lowerBB - 10;
    const closeBackAbove = lowerBB + 1;
    const openPrice = lowerBB + 0.5;
    const highPrice = closeBackAbove + 1;
    candles.push(createCandle(1700050000, openPrice, highPrice, deepLow, closeBackAbove, 6000));

    const res = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      'CHALLENGE-3002-03',
      'System 3002',
      'Valid Long setup triggers BUY',
      res.recommendedSide === 'BUY',
      `Result recommendedSide: ${res.recommendedSide}`
    );

    if (res.recommendedSide === 'BUY') {
      const entryPrice = closeBackAbove;
      const sl = res.customSL || 0;
      const tp = res.customTP || 0;
      const risk = entryPrice - sl;
      const reward = tp - entryPrice;
      const rr = reward / risk;

      assert(
        'CHALLENGE-3002-04',
        'System 3002',
        'Valid Long setup satisfies strict R:R >= 2.00',
        rr >= 2.00,
        `Measured R:R is ${rr.toFixed(2)} (expected >= 2.00)`
      );

      // Check whether TP is placed before Upper BB / opposite band or prior swing level
      const priorSwingHigh = Math.max(...candles.slice(-30).map(c => c.high));
      const reversalCeiling = Math.max(upperBB, priorSwingHigh);
      console.log(`     Long Setup Analysis: Entry: ${entryPrice}, SL: ${sl}, TP: ${tp}, UpperBB: ${upperBB.toFixed(2)}, ReversalCeiling: ${reversalCeiling.toFixed(2)}`);

      // Pre-reversal specification requires TP placed before opposite band
      const isTpBeforeOrAtCeiling = tp <= reversalCeiling;
      assert(
        'CHALLENGE-3002-05',
        'System 3002',
        'Long TP is placed before or at the reversal ceiling (not beyond opposite boundary)',
        isTpBeforeOrAtCeiling,
        `TP ${tp} vs Reversal Ceiling ${reversalCeiling.toFixed(2)} (diff: ${(tp - reversalCeiling).toFixed(2)})`,
        `TP (${tp}) is pushed past reversal ceiling (${reversalCeiling.toFixed(2)})!`
      );
    }
  }

  // 1.5: Valid Short Setup -> Verify R:R >= 2.00 AND pre-reversal TP buffer placed before opposite band
  {
    const candles = buildBaseTrendCandles(50, 80000, -3, 25, 2000);
    const closes = candles.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const upperBB = mean + stdDev * 2.0;
    const lowerBB = mean - stdDev * 2.0;

    // Surge bar with excursion above upperBB and absorption upper wick, closing inside upperBB with sufficient room for 2:1 RR
    const spikeHigh = upperBB + 10;
    const closeBackBelow = upperBB - 1;
    const openPrice = upperBB - 0.5;
    const lowPrice = closeBackBelow - 1;
    candles.push(createCandle(1700050000, openPrice, spikeHigh, lowPrice, closeBackBelow, 6000));

    const res = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      'CHALLENGE-3002-06',
      'System 3002',
      'Valid Short setup triggers SELL',
      res.recommendedSide === 'SELL',
      `Result recommendedSide: ${res.recommendedSide}`
    );

    if (res.recommendedSide === 'SELL') {
      const entryPrice = closeBackBelow;
      const sl = res.customSL || 0;
      const tp = res.customTP || 0;
      const risk = sl - entryPrice;
      const reward = entryPrice - tp;
      const rr = reward / risk;

      assert(
        'CHALLENGE-3002-07',
        'System 3002',
        'Valid Short setup satisfies strict R:R >= 2.00',
        rr >= 2.00,
        `Measured R:R is ${rr.toFixed(2)} (expected >= 2.00)`
      );

      // Check whether TP is placed before Lower BB / opposite band or prior swing level
      const priorSwingLow = Math.min(...candles.slice(-30).map(c => c.low));
      const reversalFloor = Math.min(lowerBB, priorSwingLow);
      console.log(`     Short Setup Analysis: Entry: ${entryPrice}, SL: ${sl}, TP: ${tp}, LowerBB: ${lowerBB.toFixed(2)}, ReversalFloor: ${reversalFloor.toFixed(2)}`);

      const isTpAfterOrAtFloor = tp >= reversalFloor;
      assert(
        'CHALLENGE-3002-08',
        'System 3002',
        'Short TP is placed before or at the reversal floor (not beyond lower boundary)',
        isTpAfterOrAtFloor,
        `TP ${tp} vs Reversal Floor ${reversalFloor.toFixed(2)} (diff: ${(tp - reversalFloor).toFixed(2)})`,
        `TP (${tp}) is pushed below reversal floor (${reversalFloor.toFixed(2)})!`
      );
    }
  }

  // 1.6: Adversarial Stress Test: Narrow Band Reversal TP Placement
  // When opposite band is close, does rawTP get artificially pushed miles past UpperBB to force R:R = 2.305?
  {
    // Build low-volatility baseline candles (stdDev is small)
    const candles = buildBaseTrendCandles(50, 80000, 0, 8, 2000);
    const closes = candles.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const upperBB = mean + stdDev * 2.0;
    const lowerBB = mean - stdDev * 2.0;

    // Current ATR
    const atr = whiteboardCryptoDeFiEngine.calcATR(candles, 14);
    // Force a plunge and bounce where distance to Upper BB is narrow
    const plungeLow = lowerBB - 15;
    const closeBackAbove = lowerBB + 2;
    const openPrice = lowerBB + 1;
    const highPrice = closeBackAbove + 1;
    candles.push(createCandle(1700050000, openPrice, highPrice, plungeLow, closeBackAbove, 6000));

    const res = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', candles);
    if (res.recommendedSide === 'BUY') {
      const tp = res.customTP || 0;
      const priorSwingHigh = Math.max(...candles.slice(-30).map(c => c.high));
      const targetBoundary = Math.max(upperBB, priorSwingHigh);
      const overshoot = tp - targetBoundary;
      console.log(`     [ADVERSARIAL STRESS] Narrow Band Long: TP=${tp}, TargetBoundary=${targetBoundary.toFixed(2)}, Overshoot=${overshoot.toFixed(2)}`);
      assert(
        'CHALLENGE-3002-09',
        'System 3002',
        'In narrow-band scenario, TP must NOT overshoot opposite reversal boundary by forcing arbitrary minRequiredTP',
        tp <= targetBoundary + 1.0, // allow 1 point rounding
        `TP ${tp} overshot reversal boundary ${targetBoundary.toFixed(2)} by ${overshoot.toFixed(2)} points!`,
        'Line 143 Math.max(preReversalTP, minRequiredTP) forces TP past Upper BB when bandwidth is narrow instead of rejecting the trade!'
      );
    } else {
      console.log('     [ADVERSARIAL STRESS] Narrow Band Long was properly REJECTED (null). This is the safe behavior!');
    }
  }

  // 1.7: 5m Multi-Timeframe Trigger Integration Stress Test
  {
    const candles15m = buildBaseTrendCandles(50, 80000, 3, 25, 2000);
    const closes = candles15m.map(c => c.close);
    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
    const lowerBB = mean - stdDev * 2.0;
    const deepLow = lowerBB - 10;
    const closeBackAbove = lowerBB + 1;
    candles15m.push(createCandle(1700050000, lowerBB + 0.5, closeBackAbove + 1, deepLow, closeBackAbove, 6000));

    // Test A: 5m candle is dumping hard (bearish red continuation candle)
    const candles5mDumping = [
      createCandle(1700049000, 80000, 80010, 79950, 79960, 500),
      createCandle(1700049300, 79960, 79970, 79900, 79910, 500),
      createCandle(1700049600, 79910, 79915, 79800, 79810, 1000), // last5m: close < open AND close < prev.close
    ];

    const resDumping = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', {
      candles15m,
      candles5m: candles5mDumping,
    });

    assert(
      'CHALLENGE-3002-10',
      'System 3002',
      '5m trigger integration: Bearish dump on 5m suppresses Long false positive',
      resDumping.recommendedSide === null,
      `Result recommendedSide was ${resDumping.recommendedSide} (expected null)`,
      '5m trigger failed to suppress Long entry during 5m dump!'
    );

    // Test B: 5m candle confirms bounce (green candle)
    const candles5mBouncing = [
      createCandle(1700049000, 79900, 79910, 79850, 79860, 500),
      createCandle(1700049300, 79860, 79870, 79800, 79810, 500),
      createCandle(1700049600, 79810, 79880, 79800, 79870, 1000), // last5m: close > open
    ];

    const resBouncing = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', {
      candles15m,
      candles5m: candles5mBouncing,
    });

    assert(
      'CHALLENGE-3002-11',
      'System 3002',
      '5m trigger integration: Green bounce on 5m allows Long entry',
      resBouncing.recommendedSide === 'BUY',
      `Result recommendedSide was ${resBouncing.recommendedSide} (expected BUY)`
    );
  }

  // ==========================================================================
  // 2. SYSTEM 3003: HBA MARKET STRUCTURE BREAKOUT
  // ==========================================================================
  console.log('\n--- 2. SYSTEM 3003: HBA MARKET STRUCTURE BREAKOUT ---');

  // Helper: Build range with multiple touches for clustering
  function buildRangeBreakoutHistory(options: {
    resistanceLevel: number;
    supportLevel: number;
    breakoutType: 'BULLISH' | 'BEARISH' | 'NONE';
    breakoutVolumeRatio: number;
    macroTrend: 'BULLISH' | 'BEARISH';
    higherBarrierLevel?: number;
    lowerBarrierLevel?: number;
  }): { candles15m: KlinePoint[]; candles1h: KlinePoint[] } {
    const candles15m: KlinePoint[] = [];
    const baseTime = 1700000000;
    const { resistanceLevel, supportLevel } = options;
    const rangeHeight = resistanceLevel - supportLevel;

    // Create 45 historical bars oscillating between support and resistance
    // Forming at least 3 distinct swing highs at resistanceLevel and 3 swing lows at supportLevel
    for (let i = 0; i < 45; i++) {
      const phase = (i % 8);
      let high: number;
      let low: number;
      let open: number;
      let close: number;

      if (phase === 2) {
        // Swing High touch at resistance
        high = resistanceLevel;
        open = resistanceLevel - rangeHeight * 0.3;
        close = resistanceLevel - rangeHeight * 0.1;
        low = resistanceLevel - rangeHeight * 0.4;
      } else if (phase === 6) {
        // Swing Low touch at support
        low = supportLevel;
        open = supportLevel + rangeHeight * 0.3;
        close = supportLevel + rangeHeight * 0.1;
        high = supportLevel + rangeHeight * 0.4;
      } else {
        // Mid-range bar
        open = supportLevel + rangeHeight * 0.4;
        close = supportLevel + rangeHeight * 0.6;
        high = close + rangeHeight * 0.1;
        low = open - rangeHeight * 0.1;
      }

      candles15m.push(createCandle(baseTime + i * 900, open, high, low, close, 1000));
    }

    // Now Candle 46: Prior bar near resistance (for bullish) or support (for bearish)
    const priorClose = options.breakoutType === 'BULLISH' ? resistanceLevel - 2 : supportLevel + 2;
    candles15m.push(createCandle(baseTime + 45 * 900, priorClose - 2, priorClose + 1, priorClose - 3, priorClose, 1000));

    // Candle 47: Breakout candle!
    if (options.breakoutType === 'BULLISH') {
      const breakoutClose = resistanceLevel + 15;
      const breakoutOpen = resistanceLevel - 5;
      const breakoutHigh = breakoutClose + 3;
      const breakoutLow = breakoutOpen - 2;
      const vol = 1000 * options.breakoutVolumeRatio;
      candles15m.push(createCandle(baseTime + 46 * 900, breakoutOpen, breakoutHigh, breakoutLow, breakoutClose, vol));
    } else if (options.breakoutType === 'BEARISH') {
      const breakdownClose = supportLevel - 15;
      const breakdownOpen = supportLevel + 5;
      const breakdownLow = breakdownClose - 3;
      const breakdownHigh = breakdownOpen + 2;
      const vol = 1000 * options.breakoutVolumeRatio;
      candles15m.push(createCandle(baseTime + 46 * 900, breakdownOpen, breakdownHigh, breakdownLow, breakdownClose, vol));
    }

    // If a higher barrier is specified, insert historical swing high at that level earlier in history
    if (options.higherBarrierLevel) {
      candles15m[10].high = options.higherBarrierLevel;
      candles15m[10].open = options.higherBarrierLevel - 10;
      candles15m[10].close = options.higherBarrierLevel - 5;
    }
    if (options.lowerBarrierLevel) {
      candles15m[10].low = options.lowerBarrierLevel;
      candles15m[10].open = options.lowerBarrierLevel + 10;
      candles15m[10].close = options.lowerBarrierLevel + 5;
    }

    // Build 1H candles aligned with macroTrend
    const candles1h: KlinePoint[] = [];
    let emaTargetPrice = options.macroTrend === 'BULLISH' ? resistanceLevel - 30 : resistanceLevel + 50;
    if (options.breakoutType === 'BEARISH') {
      // For bearish breakdown: if macroTrend is BULLISH, 1H EMA is below breakdown price (counter-trend)
      // if macroTrend is BEARISH, 1H EMA is above breakdown price (trend-aligned)
      emaTargetPrice = options.macroTrend === 'BULLISH' ? supportLevel - 100 : supportLevel + 100;
    }
    for (let h = 0; h < 25; h++) {
      candles1h.push(createCandle(baseTime + h * 3600, emaTargetPrice, emaTargetPrice + 5, emaTargetPrice - 5, emaTargetPrice, 4000));
    }

    return { candles15m, candles1h };
  }

  // 2.1: Breakout above resistance, but volume < 1.5x SMA20 -> MUST NOT TRIGGER
  {
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BULLISH',
      breakoutVolumeRatio: 1.20, // 1.20x < 1.50x
      macroTrend: 'BULLISH',
      higherBarrierLevel: 80500,
    });

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-01',
      'System 3003',
      'Breakout above resistance with volume < 1.5x SMA20 (1.20x) must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered breakout on low volume (< 1.50x SMA20)!'
    );
  }

  // 2.2: Breakout above resistance with volume >= 1.5x, BUT price below 1H EMA20 (counter-trend) -> MUST NOT TRIGGER
  {
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BULLISH',
      breakoutVolumeRatio: 2.0, // 2.0x > 1.50x (volume passes)
      macroTrend: 'BEARISH', // 1H EMA20 is way above current price (~80050 vs ~80015)
      higherBarrierLevel: 80500,
    });

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-02',
      'System 3003',
      'Bullish breakout with price below 1H EMA20 (counter-trend) must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered counter-trend bullish breakout below 1H EMA20!'
    );
  }

  // 2.3: Breakdown below support with volume >= 1.5x, BUT price above 1H EMA20 (counter-trend) -> MUST NOT TRIGGER
  {
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BEARISH',
      breakoutVolumeRatio: 2.0, // volume passes
      macroTrend: 'BULLISH', // 1H EMA20 is below current price (~79770 vs 79785)
      lowerBarrierLevel: 79300,
    });

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-03',
      'System 3003',
      'Bearish breakdown with price above 1H EMA20 (counter-trend) must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered counter-trend bearish breakdown above 1H EMA20!'
    );
  }

  // 2.4: Breakout candle conviction: Body < 50% of range (indecision bar) -> MUST NOT TRIGGER
  {
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BULLISH',
      breakoutVolumeRatio: 2.0,
      macroTrend: 'BULLISH',
      higherBarrierLevel: 80500,
    });

    // Modify breakout candle to have large wicks and tiny body (Doji-like)
    // Range = 40 (high = 80035, low = 79995). Body = 80016 - 80014 = 2 (2/40 = 5% < 50%)
    const last = candles15m[candles15m.length - 1];
    last.open = 80014;
    last.close = 80016;
    last.high = 80035;
    last.low = 79995;

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-04',
      'System 3003',
      'Breakout candle with weak conviction (body < 50% range) must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered on weak indecision breakout candle!'
    );
  }

  // 2.5: Valid Bullish Breakout -> Verify TP is placed EXACTLY 2 ticks before next major barrier and R:R >= 2.00
  {
    const higherBarrier = 80600.0;
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BULLISH',
      breakoutVolumeRatio: 2.2,
      macroTrend: 'BULLISH',
      higherBarrierLevel: higherBarrier,
    });

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-05',
      'System 3003',
      'Valid Bullish Breakout triggers BUY',
      res.recommendedSide === 'BUY',
      `Result recommendedSide was ${res.recommendedSide}`
    );

    if (res.recommendedSide === 'BUY') {
      const tp = res.customTP || 0;
      const sl = res.customSL || 0;
      const last = candles15m[candles15m.length - 1];
      const entry = last.close;
      const rr = (tp - entry) / (entry - sl);
      const nextBarrier = res.nextStructuralLevel || 0;
      const tickSize = 0.1; // BTCUSD tickSize
      const expectedTP = nextBarrier - 2 * tickSize;

      console.log(`     Bullish Breakout: Entry: ${entry}, SL: ${sl}, TP: ${tp}, R_next: ${nextBarrier}, ExpectedTP: ${expectedTP.toFixed(1)}, RR: ${rr.toFixed(2)}`);

      assert(
        'CHALLENGE-3003-06',
        'System 3003',
        'Valid Bullish Breakout satisfies strict R:R >= 2.00',
        rr >= 2.00,
        `Measured R:R is ${rr.toFixed(2)} (expected >= 2.00)`
      );

      // Verify TP is EXACTLY 2 ticks before R_next
      const tickDiff = (nextBarrier - tp) / tickSize;
      const isExactly2Ticks = Math.abs(tickDiff - 2.0) < 0.01;
      assert(
        'CHALLENGE-3003-07',
        'System 3003',
        'Pre-Reversal TP is placed EXACTLY 2 ticks before next major structural barrier R_next',
        isExactly2Ticks,
        `NextBarrier: ${nextBarrier}, TP: ${tp}, TickDiff: ${tickDiff.toFixed(3)} ticks (expected 2.0)`
      );
    }
  }

  // 2.6: Valid Bearish Breakdown -> Verify TP is placed EXACTLY 2 ticks before next major barrier and R:R >= 2.00
  {
    const lowerBarrier = 79200.0;
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BEARISH',
      breakoutVolumeRatio: 2.2,
      macroTrend: 'BEARISH',
      lowerBarrierLevel: lowerBarrier,
    });

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-08',
      'System 3003',
      'Valid Bearish Breakdown triggers SELL',
      res.recommendedSide === 'SELL',
      `Result recommendedSide was ${res.recommendedSide}`
    );

    if (res.recommendedSide === 'SELL') {
      const tp = res.customTP || 0;
      const sl = res.customSL || 0;
      const last = candles15m[candles15m.length - 1];
      const entry = last.close;
      const rr = (entry - tp) / (sl - entry);
      const nextBarrier = res.nextStructuralLevel || 0;
      const tickSize = 0.1; // BTCUSD tickSize
      const expectedTP = nextBarrier + 2 * tickSize;

      console.log(`     Bearish Breakdown: Entry: ${entry}, SL: ${sl}, TP: ${tp}, S_next: ${nextBarrier}, ExpectedTP: ${expectedTP.toFixed(1)}, RR: ${rr.toFixed(2)}`);

      assert(
        'CHALLENGE-3003-09',
        'System 3003',
        'Valid Bearish Breakdown satisfies strict R:R >= 2.00',
        rr >= 2.00,
        `Measured R:R is ${rr.toFixed(2)} (expected >= 2.00)`
      );

      // Verify TP is EXACTLY 2 ticks before S_next
      const tickDiff = (tp - nextBarrier) / tickSize;
      const isExactly2Ticks = Math.abs(tickDiff - 2.0) < 0.01;
      assert(
        'CHALLENGE-3003-10',
        'System 3003',
        'Pre-Reversal TP is placed EXACTLY 2 ticks before next major structural barrier S_next',
        isExactly2Ticks,
        `NextBarrier: ${nextBarrier}, TP: ${tp}, TickDiff: ${tickDiff.toFixed(3)} ticks (expected 2.0)`
      );
    }
  }

  // 2.7: Insufficient R:R rejection: Barrier is too close -> MUST NOT TRIGGER
  {
    // Higher barrier placed only 5 points above entry, so reward is ~3 points, risk is ~20 points (R:R < 0.20)
    const { candles15m, candles1h } = buildRangeBreakoutHistory({
      resistanceLevel: 80000,
      supportLevel: 79800,
      breakoutType: 'BULLISH',
      breakoutVolumeRatio: 2.2,
      macroTrend: 'BULLISH',
      higherBarrierLevel: 80020, // Barrier right on top of breakout
    });

    const res = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', { candles15m, candles1h });
    assert(
      'CHALLENGE-3003-11',
      'System 3003',
      'Breakout with next structural barrier too close (R:R < 2.00) must NOT trigger',
      res.recommendedSide === null,
      `Result recommendedSide was ${res.recommendedSide} (expected null)`,
      'Engine triggered trade with R:R < 2.00!'
    );
  }

  // ==========================================================================
  // 3. DELTA CONTRACT SPECIFICATIONS & DIVERSE TICK SIZES
  // ==========================================================================
  console.log('\n--- 3. DELTA CONTRACT SPECIFICATIONS & DIVERSE TICK SIZES ---');

  const symbolsToTest = [
    { symbol: 'BTCUSD', expectedTickSize: 0.1, expectedDecimals: 1 },
    { symbol: 'ETHUSD', expectedTickSize: 0.05, expectedDecimals: 2 },
    { symbol: 'SOLUSD', expectedTickSize: 0.0001, expectedDecimals: 4 },
    { symbol: 'XRPUSD', expectedTickSize: 0.0001, expectedDecimals: 4 },
    { symbol: 'SLVONUSD', expectedTickSize: 0.01, expectedDecimals: 2 },
    { symbol: 'SILVERUSD', expectedTickSize: 0.01, expectedDecimals: 2 },
    { symbol: 'NVDAXUSD', expectedTickSize: 0.01, expectedDecimals: 2 },
    { symbol: 'XAUTUSD', expectedTickSize: 0.01, expectedDecimals: 2 },
    { symbol: 'DOGEUSD', expectedTickSize: 0.000001, expectedDecimals: 6 },
    { symbol: '1000SHIBUSD', expectedTickSize: 0.000001, expectedDecimals: 6 },
    { symbol: 'DOGSUSD', expectedTickSize: 0.00000001, expectedDecimals: 8 },
  ];

  for (const item of symbolsToTest) {
    const spec = DELTA_PRODUCT_SPECS[item.symbol];
    assert(
      `CHALLENGE-SPEC-${item.symbol}`,
      'Delta Specs',
      `${item.symbol} specification registered: tickSize=${item.expectedTickSize}, decimals=${item.expectedDecimals}`,
      spec !== undefined && spec.tickSize === item.expectedTickSize && spec.decimals === item.expectedDecimals,
      `Actual spec: ${JSON.stringify(spec)}`
    );

    // Test quantizePrice on both engines for floating point precision & no rounding truncation
    const rawPrice = 123.456789012345;
    const factor = Math.round(rawPrice / item.expectedTickSize);
    const expectedQuantized = parseFloat((factor * item.expectedTickSize).toFixed(item.expectedDecimals));

    const qWhiteboard = whiteboardCryptoDeFiEngine.quantizePrice(rawPrice, item.expectedTickSize, item.expectedDecimals);
    const qHba = hbaMarketStructureBreakoutEngine.quantizePrice(rawPrice, item.expectedTickSize, item.expectedDecimals);

    const matchesExpected = qWhiteboard === expectedQuantized && qHba === expectedQuantized;
    assert(
      `CHALLENGE-QUANTIZE-${item.symbol}`,
      'Quantize Accuracy',
      `${item.symbol} price quantization preserves precision (${qWhiteboard} == ${expectedQuantized})`,
      matchesExpected,
      `Whiteboard: ${qWhiteboard}, HBA: ${qHba}, Expected: ${expectedQuantized}`
    );

    // Verify tick spacing: (price + 2 * tickSize) quantized minus price equals exactly 2 * tickSize
    const baseP = 100 * item.expectedTickSize;
    const basePQuantized = whiteboardCryptoDeFiEngine.quantizePrice(baseP, item.expectedTickSize, item.expectedDecimals);
    const twoTicksUp = whiteboardCryptoDeFiEngine.quantizePrice(baseP + 2 * item.expectedTickSize, item.expectedTickSize, item.expectedDecimals);
    const twoTicksDown = whiteboardCryptoDeFiEngine.quantizePrice(baseP - 2 * item.expectedTickSize, item.expectedTickSize, item.expectedDecimals);

    const upDiff = parseFloat((twoTicksUp - basePQuantized).toFixed(item.expectedDecimals));
    const downDiff = parseFloat((basePQuantized - twoTicksDown).toFixed(item.expectedDecimals));
    const expectedTwoTicks = parseFloat((2 * item.expectedTickSize).toFixed(item.expectedDecimals));

    assert(
      `CHALLENGE-2TICKS-${item.symbol}`,
      'Tick Spacing',
      `${item.symbol} 2-tick offset is exact (upDiff: ${upDiff}, downDiff: ${downDiff})`,
      upDiff === expectedTwoTicks && downDiff === expectedTwoTicks,
      `UpDiff: ${upDiff}, DownDiff: ${downDiff}, Expected: ${expectedTwoTicks}`
    );
  }

  // ==========================================================================
  // SUMMARY OF CHALLENGE RESULTS
  // ==========================================================================
  console.log('\n====================================================================');
  console.log('📊 CHALLENGE TEST SUITE RESULTS SUMMARY');
  console.log('====================================================================');

  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;

  console.log(`Total Assertions Run : ${total}`);
  console.log(`Passed               : ${passed}`);
  console.log(`Failed               : ${failed}`);

  if (failed > 0) {
    console.log('\n❌ FAILED CHALLENGES / VULNERABILITIES DETECTED:');
    for (const f of testResults.filter(r => !r.passed)) {
      console.log(`- [${f.id}] (${f.system}): ${f.description}`);
      console.log(`  Details: ${f.details}`);
      if (f.bugReport) console.log(`  Bug: ${f.bugReport}`);
    }
  } else {
    console.log('\n✅ ALL CHALLENGES PASSED! No critical flaws found.');
  }
}

runEmpiricalChallenge().catch(err => {
  console.error('Fatal test error:', err);
});
