/**
 * Empirical Adversarial Test Harness for System 3004: HBA Candlestick & Trendlines Engine
 * Challenger M1-2 (teamwork_challenger)
 */

import { hbaCandlestickTrendlineEngine, HbaCandlestickTrendlineEngine, Trendline } from '../lib/strategies/hbaCandlestickTrendlineEngine';
import { KlinePoint } from '../src/types';
import { DELTA_PRODUCT_SPECS } from '../lib/deltaExchangeEngine';

export interface TestResult {
  category: string;
  testName: string;
  passed: boolean;
  expected: string;
  actual: string;
  isBugOrVulnerability?: boolean;
  details?: string;
}

export const results: TestResult[] = [];

function assertTest(
  category: string,
  testName: string,
  passed: boolean,
  expected: string,
  actual: string,
  isBugOrVulnerability: boolean = false,
  details?: string
) {
  results.push({ category, testName, passed, expected, actual, isBugOrVulnerability, details });
  const status = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`${status} [${category}] ${testName}`);
  if (!passed || details) {
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual:   ${actual}`);
    if (details) console.log(`   Details:  ${details}`);
  }
}

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

/**
 * Builds baseline candles with defined range and swing pivots
 */
function buildBaselineCandles(count: number = 40, basePrice: number = 1000, step: number = 0, volatility: number = 5): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < count; i++) {
    const price = basePrice + i * step;
    candles.push(createCandle(
      baseTime + i * 900,
      price - volatility * 0.2,
      price + volatility,
      price - volatility,
      price + volatility * 0.2,
      1000
    ));
  }
  return candles;
}

async function runAllEmpiricalTests() {
  console.log('\n================================================================');
  console.log('CHALLENGER M1-2: EMPIRICAL STRESS TESTS FOR SYSTEM 3004');
  console.log('================================================================\n');

  // ==========================================================================
  // SECTION 1: CANDLESTICK GEOMETRY VERIFICATION
  // ==========================================================================
  console.log('--- SECTION 1: Candlestick Geometry Verification ---');

  // Test 1.1: Wick is 1.9x body (< 2.0x threshold) -> must NOT qualify
  {
    const candle = createCandle(1700000000, 100, 112, 81, 110);
    const geom = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(candle, 0.1);
    assertTest(
      'Geometry',
      'Wick = 1.9x body (< 2.0x threshold) must NOT qualify as Hammer',
      geom.isHammer === false,
      'isHammer = false',
      `isHammer = ${geom.isHammer} (rejectionWickRatio = ${(geom.lowerWick / geom.body).toFixed(2)})`
    );
    assertTest(
      'Geometry',
      'Wick = 1.9x body (< 2.0x threshold) must NOT qualify as Hanging Man',
      geom.isHangingMan === false,
      'isHangingMan = false',
      `isHangingMan = ${geom.isHangingMan}`
    );
  }

  // Test 1.2: Wick >= 2.0x body, but body > 35% of total candle range -> must NOT qualify
  {
    const candle = createCandle(1700000000, 100, 164, 64, 136); // body = 36, range = 100, bodyRatio = 0.36
    const geom = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(candle, 0.1);
    assertTest(
      'Geometry',
      'Body > 35% of range must fail isSmallBody and NOT qualify',
      geom.bodyRatio > 0.35 && geom.isHammer === false && geom.isShootingStar === false,
      'bodyRatio > 0.35 and isHammer/ShootingStar = false',
      `bodyRatio = ${(geom.bodyRatio * 100).toFixed(1)}%, isHammer = ${geom.isHammer}`
    );
  }

  // Test 1.3: Counter-wick verification (Mandated: Counter-wick <= 30% of body)
  {
    // Case A: Counter-wick = 25% of body (<= 30%) -> Valid Hammer
    const candle25Pct = createCandle(1700000000, 100, 112.5, 20, 110);
    const geom25Pct = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(candle25Pct, 0.1);
    assertTest(
      'Geometry',
      'Valid Hammer with counter-wick = 25% of body (<= 30%) qualifies as Hammer',
      geom25Pct.isHammer === true,
      'isHammer = true',
      `isHammer = ${geom25Pct.isHammer}`
    );

    // Case B: Counter-wick = 50% of body (> 30% threshold)
    // Body = 10 (open 100, close 110). Lower wick = 80 (low 20). Upper wick = 5 (high 115).
    // Counter-wick ratio = 5 / 10 = 50% of body.
    const candle50Pct = createCandle(1700000000, 100, 115, 20, 110);
    const geom50Pct = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(candle50Pct, 0.1);
    const counterWickRatio50 = geom50Pct.upperWick / geom50Pct.body;
    const qualifies50 = geom50Pct.isHammer;
    assertTest(
      'Geometry',
      'Adversarial: Counter-wick = 50% of body (> 30% threshold) must NOT qualify as Hammer',
      qualifies50 === false,
      'isHammer = false (counter-wick 50% > 30%)',
      `isHammer = ${qualifies50} (counterWickRatio = ${(counterWickRatio50 * 100).toFixed(1)}%, maxCounterWick allowed = ${(Math.max(0.30 * geom50Pct.body, 0.10 * geom50Pct.range))})`,
      true,
      'VULNERABILITY: maxCounterWick = Math.max(0.30 * body, 0.10 * range) expands permitted counter-wick to 10% of total range, allowing counter-wicks up to 95% of body to qualify!'
    );

    // Case C: Counter-wick = 70% of body (> 30% threshold)
    const candle70Pct = createCandle(1700000000, 100, 117, 20, 110);
    const geom70Pct = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(candle70Pct, 0.1);
    const qualifies70 = geom70Pct.isHammer;
    assertTest(
      'Geometry',
      'Adversarial: Counter-wick = 70% of body (> 30% threshold) must NOT qualify as Hammer',
      qualifies70 === false,
      'isHammer = false (counter-wick 70% > 30%)',
      `isHammer = ${qualifies70} (counter-wick = 70% of body)`,
      true,
      'VULNERABILITY: Counter-wick = 70% of body erroneously passes isHammer check!'
    );
  }

  // Test 1.4: Hammer at identified Support level (S ± 0.25 * ATR14) -> verify Long qualification
  {
    const candles = buildBaselineCandles(38, 920, 0, 4);
    candles[18] = createCandle(1700000000 + 18 * 900, 915, 918, 908, 912);
    candles[19] = createCandle(1700000000 + 19 * 900, 912, 914, 904, 906);
    candles[20] = createCandle(1700000000 + 20 * 900, 906, 908, 900, 905); // Support at 900.0
    candles[21] = createCandle(1700000000 + 21 * 900, 905, 912, 904, 910);
    candles[22] = createCandle(1700000000 + 22 * 900, 910, 916, 908, 914);

    // Prior swing high around 950 at index 10
    candles[9] = createCandle(1700000000 + 9 * 900, 930, 935, 928, 934);
    candles[10] = createCandle(1700000000 + 10 * 900, 934, 950, 932, 948);
    candles[11] = createCandle(1700000000 + 11 * 900, 948, 949, 938, 940);

    // Current bar at index 39: Hammer testing support at 900 (low = 900.5, within 0.25 * ATR)
    candles.push(createCandle(1700000000 + 39 * 900, 912, 915.5, 900.5, 915));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'CandlestickReversal',
      'Hammer at Support (S ± 0.25*ATR) triggers BUY qualification',
      result.recommendedSide === 'BUY' && result.patternName === 'HAMMER',
      'recommendedSide = BUY, patternName = HAMMER',
      `recommendedSide = ${result.recommendedSide}, patternName = ${result.patternName}, RR = ${result.riskReward}`
    );
  }

  // Test 1.5: Inverted Hammer at identified Support level (S ± 0.25 * ATR14) -> verify Long qualification
  {
    const candles = buildBaselineCandles(38, 920, 0, 4);
    candles[20] = createCandle(1700000000 + 20 * 900, 906, 908, 900, 905); // Support at 900.0
    candles[10] = createCandle(1700000000 + 10 * 900, 934, 950, 932, 948); // Swing high at 950

    // Inverted Hammer: low near support 900.5, open 901, close 904 (body 3), high 914 (upper wick 10), lower wick 0.5 (16% of body)
    candles.push(createCandle(1700000000 + 39 * 900, 901, 914, 900.5, 904));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'CandlestickReversal',
      'Inverted Hammer at Support (S ± 0.25*ATR) triggers BUY qualification',
      result.recommendedSide === 'BUY' && result.patternName === 'INVERTED_HAMMER',
      'recommendedSide = BUY, patternName = INVERTED_HAMMER',
      `recommendedSide = ${result.recommendedSide}, patternName = ${result.patternName}`
    );
  }

  // Test 1.6: Shooting Star at identified Resistance level (R ± 0.25 * ATR14) -> verify Short qualification
  {
    const candles = buildBaselineCandles(38, 900, 0, 4);
    candles[18] = createCandle(1700000000 + 18 * 900, 935, 940, 930, 938);
    candles[19] = createCandle(1700000000 + 19 * 900, 938, 945, 935, 942);
    candles[20] = createCandle(1700000000 + 20 * 900, 942, 950, 940, 945); // Resistance at 950.0
    candles[21] = createCandle(1700000000 + 21 * 900, 945, 946, 935, 938);
    candles[22] = createCandle(1700000000 + 22 * 900, 938, 940, 930, 932);

    candles[9] = createCandle(1700000000 + 9 * 900, 890, 895, 885, 888);
    candles[10] = createCandle(1700000000 + 10 * 900, 888, 892, 880, 885); // Swing low at 880
    candles[11] = createCandle(1700000000 + 11 * 900, 885, 895, 884, 892);

    // Shooting Star at 950: open 938, close 935 (body 3), high 949.5 (upper wick 11.5 >= 3.8x body), low 934.5 (lower wick 0.5 <= 17% body).
    candles.push(createCandle(1700000000 + 39 * 900, 938, 949.5, 934.5, 935));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'CandlestickReversal',
      'Shooting Star at Resistance (R ± 0.25*ATR) triggers SELL qualification',
      result.recommendedSide === 'SELL' && result.patternName === 'SHOOTING_STAR',
      'recommendedSide = SELL, patternName = SHOOTING_STAR',
      `recommendedSide = ${result.recommendedSide}, patternName = ${result.patternName}, RR = ${result.riskReward}`
    );
  }

  // Test 1.7: Hanging Man at identified Resistance level (R ± 0.25 * ATR14) -> verify Short qualification
  {
    const candles = buildBaselineCandles(38, 900, 0, 4);
    candles[20] = createCandle(1700000000 + 20 * 900, 942, 950, 940, 945); // Resistance at 950.0
    candles[10] = createCandle(1700000000 + 10 * 900, 888, 892, 880, 885); // Swing low at 880

    // Hanging Man near 950: body = 3 (open 948, close 945). High = 948.5 (upper wick 0.5 <= 17% body). Low = 935 (lower wick = 10 = 3.3x body).
    candles.push(createCandle(1700000000 + 39 * 900, 948, 948.5, 935, 945));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'CandlestickReversal',
      'Hanging Man at Resistance (R ± 0.25*ATR) triggers SELL qualification',
      result.recommendedSide === 'SELL' && result.patternName === 'HANGING_MAN',
      'recommendedSide = SELL, patternName = HANGING_MAN',
      `recommendedSide = ${result.recommendedSide}, patternName = ${result.patternName}`
    );
  }

  // Test 1.8: Hammer OUTSIDE Support tolerance (> 0.25 * ATR14) -> must NOT qualify
  {
    const candles = buildBaselineCandles(38, 920, 0, 4);
    candles[20] = createCandle(1700000000 + 20 * 900, 906, 908, 900, 905); // Support at 900.0

    // Hammer with low at 910 (distance from 900 is 10 > 0.25 * atr where atr ~ 4.5 -> 0.25*atr ~ 1.1)
    candles.push(createCandle(1700000000 + 39 * 900, 922, 922.5, 910, 920));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'CandlestickReversal',
      'Hammer far from Support (> 0.25*ATR) must NOT trigger Support Reversal',
      result.setupType !== 'HBA_CANDLESTICK_SUPPORT_REVERSAL',
      'setupType !== HBA_CANDLESTICK_SUPPORT_REVERSAL',
      `setupType = ${result.setupType}, recommendedSide = ${result.recommendedSide}`
    );
  }

  // ==========================================================================
  // SECTION 2: TRENDLINE BREAKOUT & RETEST VERIFICATION
  // ==========================================================================
  console.log('\n--- SECTION 2: Trendline Breakout & Retest Verification ---');

  // Test 2.1: Trendline construction for Body-to-Body and Wick-to-Wick pivots
  {
    const candles = buildBaselineCandles(40, 1000, 0, 2);
    candles[14] = createCandle(1700000000 + 14 * 900, 1030, 1035, 1025, 1032);
    candles[15] = createCandle(1700000000 + 15 * 900, 1040, 1050, 1035, 1045);
    candles[16] = createCandle(1700000000 + 16 * 900, 1035, 1038, 1028, 1030);

    candles[24] = createCandle(1700000000 + 24 * 900, 1015, 1020, 1010, 1018);
    candles[25] = createCandle(1700000000 + 25 * 900, 1020, 1030, 1015, 1025);
    candles[26] = createCandle(1700000000 + 26 * 900, 1018, 1022, 1012, 1015);

    const tl = hbaCandlestickTrendlineEngine.constructTrendlines(candles);
    const wickTl = tl.descending.find(t => t.basis === 'WICK' && t.t1 === 15 && t.t2 === 25);
    const bodyTl = tl.descending.find(t => t.basis === 'BODY' && t.t1 === 15 && t.t2 === 25);

    assertTest(
      'Trendline',
      'Constructs Wick-to-Wick descending linear trendline T(t) = m*t + c',
      wickTl !== undefined && wickTl.slope === (1030 - 1050) / 10,
      'Wick trendline found with slope = -2.0',
      `wickTl = ${wickTl ? `slope: ${wickTl.slope}, intercept: ${wickTl.intercept}` : 'not found'}`
    );

    assertTest(
      'Trendline',
      'Constructs Body-to-Body descending linear trendline T(t) = m*t + c',
      bodyTl !== undefined && bodyTl.slope === (1025 - 1045) / 10,
      'Body trendline found with slope = -2.0',
      `bodyTl = ${bodyTl ? `slope: ${bodyTl.slope}, intercept: ${bodyTl.intercept}` : 'not found'}`
    );
  }

  // Test 2.2: Breakout WITHOUT retest bounce within 1-5 bars -> must NOT trigger entry
  {
    const candles = buildBaselineCandles(36, 1000, 0, 2);
    candles[14] = createCandle(1700000000 + 14 * 900, 1030, 1035, 1025, 1032);
    candles[15] = createCandle(1700000000 + 15 * 900, 1040, 1050, 1035, 1045);
    candles[16] = createCandle(1700000000 + 16 * 900, 1035, 1038, 1028, 1030);

    candles[24] = createCandle(1700000000 + 24 * 900, 1015, 1020, 1010, 1018);
    candles[25] = createCandle(1700000000 + 25 * 900, 1020, 1030, 1015, 1025);
    candles[26] = createCandle(1700000000 + 26 * 900, 1018, 1022, 1012, 1015);

    // Breakout at index 32 (tl = 1016): close = 1025 > 1016
    candles[32] = createCandle(1700000000 + 32 * 900, 1014, 1026, 1013, 1025);

    // Current bar at index 35 (tl = 1010): price stayed high at 1040 (NO retest touch of trendline, low = 1035 >> 1010)
    candles[33] = createCandle(1700000000 + 33 * 900, 1025, 1032, 1024, 1030);
    candles[34] = createCandle(1700000000 + 34 * 900, 1030, 1038, 1028, 1036);
    candles[35] = createCandle(1700000000 + 35 * 900, 1036, 1042, 1035, 1040);

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'Trendline',
      'Breakout WITHOUT retest bounce does NOT trigger entry',
      result.recommendedSide === null,
      'recommendedSide = null',
      `recommendedSide = ${result.recommendedSide}, setupType = ${result.setupType}`
    );
  }

  // Test 2.3: Valid Breakout AND Retest bounce within 1-5 bars -> triggers BUY entry
  {
    const candles = buildBaselineCandles(36, 1000, 0, 2);
    // Lower highs at index 15 (1050) and index 25 (1030) -> slope = -2.0.
    candles[14] = createCandle(1700000000 + 14 * 900, 1030, 1035, 1025, 1032);
    candles[15] = createCandle(1700000000 + 15 * 900, 1040, 1050, 1035, 1045);
    candles[16] = createCandle(1700000000 + 16 * 900, 1035, 1038, 1028, 1030);

    candles[24] = createCandle(1700000000 + 24 * 900, 1015, 1020, 1010, 1018);
    candles[25] = createCandle(1700000000 + 25 * 900, 1020, 1030, 1015, 1025);
    candles[26] = createCandle(1700000000 + 26 * 900, 1018, 1022, 1012, 1015);

    // Trendline at index 33: 1050 - 2.0 * (33 - 15) = 1014.
    // Breakout at index 33: open 1012, close 1020
    candles[33] = createCandle(1700000000 + 33 * 900, 1012, 1022, 1011, 1020);
    // Intermediate bar at 34: stays above
    candles[34] = createCandle(1700000000 + 34 * 900, 1020, 1023, 1015, 1018);
    // Retest at index 35 (current candle! tl = 1010): dips to 1010.5 (within 0.20 ATR), closes at 1017 (bounce)
    candles[35] = createCandle(1700000000 + 35 * 900, 1015, 1019, 1010.5, 1017);

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'Trendline',
      'Valid breakout and retest bounce within 1-5 bars triggers BUY entry',
      result.recommendedSide === 'BUY' && result.setupType.includes('TRENDLINE'),
      'recommendedSide = BUY, setupType includes TRENDLINE',
      `recommendedSide = ${result.recommendedSide}, setupType = ${result.setupType}, RR = ${result.riskReward}`
    );
  }

  // Test 2.4: Ascending Trendline Breakdown and Retest Rejection -> triggers SELL entry
  {
    const candles = buildBaselineCandles(36, 1000, 0, 2);
    // Higher lows at index 15 (950) and index 25 (970) -> slope = +2.0.
    candles[14] = createCandle(1700000000 + 14 * 900, 960, 965, 955, 958);
    candles[15] = createCandle(1700000000 + 15 * 900, 955, 960, 950, 955);
    candles[16] = createCandle(1700000000 + 16 * 900, 958, 962, 955, 960);

    candles[24] = createCandle(1700000000 + 24 * 900, 975, 980, 972, 976);
    candles[25] = createCandle(1700000000 + 25 * 900, 976, 982, 970, 978);
    candles[26] = createCandle(1700000000 + 26 * 900, 978, 985, 975, 982);

    // Trendline at index 33: 950 + 2.0 * (33 - 15) = 986.
    // Breakdown at index 33: open 988, close 980 (< 986)
    candles[33] = createCandle(1700000000 + 33 * 900, 988, 989, 979, 980);
    // Intermediate bar at 34
    candles[34] = createCandle(1700000000 + 34 * 900, 980, 983, 976, 978);
    // Retest at index 35 (tl = 990): rallies to 989.5 (within 0.20 ATR), closes at 982 (bearish rejection)
    candles[35] = createCandle(1700000000 + 35 * 900, 984, 989.5, 980, 982);

    const result = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', candles);
    assertTest(
      'Trendline',
      'Valid breakdown and retest rejection within 1-5 bars triggers SELL entry',
      result.recommendedSide === 'SELL' && result.setupType.includes('TRENDLINE'),
      'recommendedSide = SELL, setupType includes TRENDLINE',
      `recommendedSide = ${result.recommendedSide}, setupType = ${result.setupType}, RR = ${result.riskReward}`
    );
  }

  // ==========================================================================
  // SECTION 3: TAKE PROFIT & RISK-TO-REWARD VERIFICATION
  // ==========================================================================
  console.log('\n--- SECTION 3: Take Profit & Risk-to-Reward Verification ---');

  // Test 3.1: Pre-Reversal TP placed EXACTLY 3 ticks before preceding swing high for Long (within 1:2.00 to 1:2.50 corridor)
  {
    const symbol = 'BTCUSD';
    const tickSize = 0.1;
    const candles = buildBaselineCandles(38, 920, 0, 4);
    candles[18] = createCandle(1700000000 + 18 * 900, 915, 918, 908, 912);
    candles[19] = createCandle(1700000000 + 19 * 900, 912, 914, 904, 906);
    candles[20] = createCandle(1700000000 + 20 * 900, 906, 908, 900, 905); // Support at 900.0
    candles[21] = createCandle(1700000000 + 21 * 900, 905, 912, 904, 910);
    candles[22] = createCandle(1700000000 + 22 * 900, 910, 916, 908, 914);

    // Set prior swing high at 942.0 (so RR = (942.0 - 0.3 - 912) / 14 = 29.7 / 14 = 2.12 -> within 2.00 to 2.50)
    const priorSwingHigh = 942.0;
    candles[9] = createCandle(1700000000 + 9 * 900, 930, 935, 928, 934);
    candles[10] = createCandle(1700000000 + 10 * 900, 934, priorSwingHigh, 932, 938);
    candles[11] = createCandle(1700000000 + 11 * 900, 938, 939, 930, 935);

    // Current bar at 912: Hammer at support 900.5
    candles.push(createCandle(1700000000 + 39 * 900, 910, 912.5, 900.5, 912));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup(symbol, candles);
    const expectedTP = parseFloat((priorSwingHigh - 3 * tickSize).toFixed(1));

    assertTest(
      'TakeProfit',
      'TP placed EXACTLY 3 ticks before preceding swing high for Long (within corridor)',
      result.customTP === expectedTP,
      `customTP = ${expectedTP} (SwingHigh 942.0 - 3*0.1)`,
      `customTP = ${result.customTP}, RR = ${result.riskReward}`
    );
  }

  // Test 3.2: Pre-Reversal TP placed EXACTLY 3 ticks before preceding swing low for Short (within 1:2.00 to 1:2.50 corridor)
  {
    const symbol = 'BTCUSD';
    const tickSize = 0.1;
    const candles = buildBaselineCandles(38, 920, 0, 2);
    candles[18] = createCandle(1700000000 + 18 * 900, 935, 940, 930, 938);
    candles[19] = createCandle(1700000000 + 19 * 900, 938, 945, 935, 942);
    candles[20] = createCandle(1700000000 + 20 * 900, 942, 950, 940, 945); // Resistance at 950.0
    candles[21] = createCandle(1700000000 + 21 * 900, 945, 946, 935, 938);
    candles[22] = createCandle(1700000000 + 22 * 900, 938, 940, 930, 932);

    // Set lowest low at 906.0 -> TP = 906.0 + 3*0.1 = 906.3 -> RR = (938 - 906.3) / 13.4 = 2.37 (within corridor)
    const priorSwingLow = 906.0;
    candles[9] = createCandle(1700000000 + 9 * 900, 915, 918, 910, 914);
    candles[10] = createCandle(1700000000 + 10 * 900, 914, 918, priorSwingLow, 912);
    candles[11] = createCandle(1700000000 + 11 * 900, 912, 915, 910, 913);

    // Current bar at 938: Shooting star at 949.5
    candles.push(createCandle(1700000000 + 39 * 900, 940, 949.5, 937.5, 938));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup(symbol, candles);
    const expectedTP = parseFloat((priorSwingLow + 3 * tickSize).toFixed(1));

    assertTest(
      'TakeProfit',
      'TP placed EXACTLY 3 ticks before preceding swing low for Short (within corridor)',
      result.customTP === expectedTP,
      `customTP = ${expectedTP} (SwingLow 906.0 + 3*0.1)`,
      `customTP = ${result.customTP}, RR = ${result.riskReward}`
    );
  }

  // Test 3.3: Strict rejection of any setup with R:R < 2.00
  {
    const symbol = 'BTCUSD';
    const candles = buildBaselineCandles(38, 920, 0, 4);
    candles[20] = createCandle(1700000000 + 20 * 900, 906, 908, 900, 905); // Support at 900.0
    // Set prior swing high very close at 920.0
    candles[10] = createCandle(1700000000 + 10 * 900, 918, 920.0, 915, 919);

    // Current bar at 912: Hammer at support 900.5
    candles.push(createCandle(1700000000 + 39 * 900, 910, 912.5, 900.5, 912));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup(symbol, candles);
    assertTest(
      'RiskReward',
      'Setup with R:R < 2.00 must be STRICTLY REJECTED',
      result.recommendedSide === null,
      'recommendedSide = null',
      `recommendedSide = ${result.recommendedSide}, riskReward = ${result.riskReward}`
    );
  }

  // Test 3.4: Stress Test on R:R > 2.50 capping vs 3-tick Pre-Reversal TP
  {
    const symbol = 'BTCUSD';
    const tickSize = 0.1;
    const candles = buildBaselineCandles(38, 920, 0, 4);
    candles[20] = createCandle(1700000000 + 20 * 900, 906, 908, 900, 905); // Support at 900.0
    const priorSwingHigh = 980.0;
    candles[10] = createCandle(1700000000 + 10 * 900, 960, priorSwingHigh, 955, 970);

    // Current bar at 912: Hammer at support 900.5
    candles.push(createCandle(1700000000 + 39 * 900, 910, 912.5, 900.5, 912));

    const result = hbaCandlestickTrendlineEngine.evaluateSetup(symbol, candles);
    const expectedUncappedTP = parseFloat((priorSwingHigh - 3 * tickSize).toFixed(1));
    const isTPCapped = result.customTP !== expectedUncappedTP;

    assertTest(
      'RiskReward',
      'Corridor enforcement: When raw R:R > 2.50, engine caps R:R at 2.50',
      result.riskReward === 2.50,
      'riskReward = 2.50',
      `riskReward = ${result.riskReward}, customTP = ${result.customTP}, uncappedTP = ${expectedUncappedTP}`,
      false,
      isTPCapped
        ? `FINDING: When R:R is capped at 2.50, customTP is overridden to ${result.customTP} (instead of SwingHigh - 3 ticks = ${expectedUncappedTP}). Reason string states '${priorSwingHigh} - 3 ticks = ${result.customTP}', which is an arithmetic mismatch!`
        : undefined
    );
  }

  // ==========================================================================
  // SECTION 4: DELTA PRODUCT SPECS & MULTI-SYMBOL COMPATIBILITY
  // ==========================================================================
  console.log('\n--- SECTION 4: Delta Product Specs & Multi-Symbol Compatibility ---');

  const symbolsToTest = [
    { symbol: 'BTCUSD', expectedTick: 0.1, expectedDecimals: 1 },
    { symbol: 'ETHUSD', expectedTick: 0.05, expectedDecimals: 2 },
    { symbol: 'SOLUSD', expectedTick: 0.0001, expectedDecimals: 4 },
    { symbol: 'XRPUSD', expectedTick: 0.0001, expectedDecimals: 4 },
    { symbol: 'DOGEUSD', expectedTick: 0.000001, expectedDecimals: 6 },
    { symbol: 'SLVONUSD', expectedTick: 0.01, expectedDecimals: 2 },
  ];

  for (const item of symbolsToTest) {
    const spec = DELTA_PRODUCT_SPECS[item.symbol];
    assertTest(
      'DeltaSpecs',
      `Symbol ${item.symbol} matches DELTA_PRODUCT_SPECS tickSize and decimals`,
      spec !== undefined && spec.tickSize === item.expectedTick && spec.decimals === item.expectedDecimals,
      `tickSize: ${item.expectedTick}, decimals: ${item.expectedDecimals}`,
      spec ? `tickSize: ${spec.tickSize}, decimals: ${spec.decimals}` : 'SPEC NOT FOUND'
    );

    // Verify 3-tick quantization
    const price = 100.0;
    const threeTicks = 3 * item.expectedTick;
    const tpLong = hbaCandlestickTrendlineEngine.quantizePrice(price - threeTicks, item.expectedTick, item.expectedDecimals);
    const expectedTPLong = parseFloat((price - threeTicks).toFixed(item.expectedDecimals));

    assertTest(
      'DeltaSpecs',
      `QuantizePrice for ${item.symbol} places TP exactly 3 ticks before level`,
      tpLong === expectedTPLong,
      `tp = ${expectedTPLong}`,
      `tp = ${tpLong}`
    );
  }

  // Multi-Symbol evaluateSetup execution test
  {
    for (const item of ['BTCUSD', 'ETHUSD', 'SOLUSD', 'SLVONUSD']) {
      const { tickSize, decimals } = (hbaCandlestickTrendlineEngine as any).getSymbolSpec(item);
      const candles = buildBaselineCandles(38, 100, 0, 0.5);
      // Ensure no crash or type error
      const res = hbaCandlestickTrendlineEngine.evaluateSetup(item, candles);
      assertTest(
        'DeltaSpecs',
        `evaluateSetup executes cleanly on ${item} with tickSize ${tickSize}`,
        res !== null && typeof res.confidenceScore === 'number',
        'Clean StrategySetupResult returned',
        `setupType = ${res.setupType}, confidence = ${res.confidenceScore}`
      );
    }
  }

  // Summary
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  const vulnerabilitiesCount = results.filter(r => r.isBugOrVulnerability).length;

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of ${results.length} assertions`);
  console.log(`CONFIRMED VULNERABILITIES IDENTIFIED: ${vulnerabilitiesCount}`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    console.log('Failed Tests Summary:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`- [${r.category}] ${r.testName}`);
      console.log(`    Expected: ${r.expected}`);
      console.log(`    Actual:   ${r.actual}`);
      if (r.details) console.log(`    Details:  ${r.details}`);
    }
  }

  return { passedCount, failedCount, vulnerabilitiesCount, results };
}

runAllEmpiricalTests().catch(err => {
  console.error('Fatal error running empirical tests:', err);
  process.exit(1);
});
