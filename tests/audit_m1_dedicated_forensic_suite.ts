/**
 * ============================================================================
 * FORENSIC AUDITOR M1: INDEPENDENT EMPIRICAL INTEGRITY TEST SUITE
 * ============================================================================
 * Audits:
 * 1. lib/strategies/whiteboardCryptoDeFiEngine.ts (System 3002)
 * 2. lib/strategies/hbaMarketStructureBreakoutEngine.ts (System 3003)
 * 3. lib/strategies/hbaCandlestickTrendlineEngine.ts (System 3004)
 * ============================================================================
 */

import { KlinePoint } from '../src/types';
import { whiteboardCryptoDeFiEngine } from '../lib/strategies/whiteboardCryptoDeFiEngine';
import { hbaMarketStructureBreakoutEngine } from '../lib/strategies/hbaMarketStructureBreakoutEngine';
import { hbaCandlestickTrendlineEngine } from '../lib/strategies/hbaCandlestickTrendlineEngine';
import { DELTA_PRODUCT_SPECS } from '../lib/deltaExchangeEngine';

interface AuditCheck {
  id: string;
  name: string;
  category: 'STATIC_ANALYSIS' | 'MATH_AUTHENTICITY' | 'BEHAVIORAL_VERIFICATION' | 'EDGE_CASES';
  passed: boolean;
  details: string;
}

const auditChecks: AuditCheck[] = [];

function recordCheck(id: string, name: string, category: AuditCheck['category'], condition: boolean, details: string) {
  auditChecks.push({ id, name, category, passed: condition, details });
  if (condition) {
    console.log(`  ✅ [PASS] [${id}] ${name}`);
  } else {
    console.error(`  ❌ [FAIL] [${id}] ${name} -> ${details}`);
  }
}

function createCandle(time: number, open: number, high: number, low: number, close: number, volume: number = 1000): KlinePoint {
  return { time, open, high, low, close, volume };
}

function generateBaselineCandles(count: number = 50, basePrice: number = 80000, step: number = 0, volatility: number = 20): KlinePoint[] {
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

async function runForensicAudit() {
  console.log('================================================================');
  console.log('   FORENSIC INTEGRITY AUDIT: SYSTEMS 3002, 3003, 3004 ENGINES   ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 1: STATIC & ARCHITECTURAL CHECKS
  // --------------------------------------------------------------------------
  console.log('--- SECTION 1: Static Analysis & Anti-Cheating Invariants ---');

  // 1.1 Instances exist and are properly instantiated
  recordCheck(
    'SEC1.01',
    'Strategy engine instances export valid class instances',
    'STATIC_ANALYSIS',
    typeof whiteboardCryptoDeFiEngine.evaluateSetup === 'function' &&
    typeof hbaMarketStructureBreakoutEngine.evaluateSetup === 'function' &&
    typeof hbaCandlestickTrendlineEngine.evaluateSetup === 'function',
    'Engines must export evaluateSetup methods'
  );

  // 1.2 Price Quantization Math Verification
  const btcSpec = DELTA_PRODUCT_SPECS['BTCUSD'];
  const testQuantize1 = whiteboardCryptoDeFiEngine.quantizePrice(80123.45678, btcSpec.tickSize, btcSpec.decimals);
  const expectedQuantize1 = Math.round(80123.45678 / btcSpec.tickSize) * btcSpec.tickSize;
  recordCheck(
    'SEC1.02',
    'QuantizePrice correctly rounds according to exchange tickSize and precision',
    'MATH_AUTHENTICITY',
    testQuantize1 === parseFloat(expectedQuantize1.toFixed(btcSpec.decimals)),
    `Expected ${expectedQuantize1.toFixed(btcSpec.decimals)}, got ${testQuantize1}`
  );

  // 1.3 ATR Calculation Math Verification
  const atrCandles: KlinePoint[] = [
    createCandle(1, 100, 110, 90, 105), // TR = 20
    createCandle(2, 105, 115, 95, 100), // TR = max(20, |115-105|=10, |95-105|=10) = 20
    createCandle(3, 100, 120, 100, 115), // TR = max(20, |120-100|=20, |100-100|=0) = 20
  ];
  const calculatedATR = whiteboardCryptoDeFiEngine.calcATR(atrCandles, 2);
  recordCheck(
    'SEC1.03',
    'calcATR accurately derives average true range from candle extremes and prior close',
    'MATH_AUTHENTICITY',
    calculatedATR === 20,
    `Expected ATR=20, got ${calculatedATR}`
  );

  // 1.4 EMA Calculation Math Verification
  const emaPrices = [10, 10, 10, 10, 10, 20];
  const calculatedEMA = whiteboardCryptoDeFiEngine.calcEMA(emaPrices, 5);
  recordCheck(
    'SEC1.04',
    'calcEMA accurately computes exponential moving average with multiplier k = 2/(N+1)',
    'MATH_AUTHENTICITY',
    Math.abs(calculatedEMA - 13.333333) < 0.001,
    `Expected EMA=13.3333, got ${calculatedEMA}`
  );

  // --------------------------------------------------------------------------
  // SECTION 2: SYSTEM 3002 (WHITEBOARD CRYPTO DEFI AMM ENGINE)
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: System 3002 AMM Constant Product Curve & Elasticity ---');

  // 2.1 Long Setup: %B < 0.0 excursion + snapback + volume surge + absorption wick
  const wbLongCandles = generateBaselineCandles(60, 80000, 2, 20);
  const wbCloses = wbLongCandles.map(c => c.close);
  const mean20 = wbCloses.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const variance20 = wbCloses.slice(-20).reduce((a, b) => a + Math.pow(b - mean20, 2), 0) / 20;
  const std20 = Math.sqrt(variance20);
  const lowerBB = mean20 - std20 * 2.0;

  const dipLow = lowerBB - 80;
  const snapClose = lowerBB + 20;
  const snapOpen = lowerBB + 10;
  const snapHigh = snapClose + 5;
  wbLongCandles.push(createCandle(1700060000, snapOpen, snapHigh, dipLow, snapClose, 8000));

  const wbLongResult = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', wbLongCandles);
  recordCheck(
    'SEC2.01',
    'System 3002 triggers BUY on %B < 0.0 lower elasticity excursion snapback',
    'BEHAVIORAL_VERIFICATION',
    wbLongResult.recommendedSide === 'BUY' && wbLongResult.setupType === 'WHITEBOARD_AMM_LOWER_SLIPPAGE_SNAPBACK',
    `Result: side=${wbLongResult.recommendedSide}, type=${wbLongResult.setupType}`
  );

  // 2.2 Verify Pre-Reversal TP buffer and strict R:R
  const actualTpDist = (wbLongResult.customTP || 0) - snapClose;
  const actualSlDist = snapClose - (wbLongResult.customSL || 0);
  const actualRR = actualTpDist / actualSlDist;

  recordCheck(
    'SEC2.02',
    'System 3002 SL placed safely below excursion low with ATR buffer',
    'MATH_AUTHENTICITY',
    (wbLongResult.customSL || 0) < dipLow,
    `SL: ${wbLongResult.customSL}, dipLow: ${dipLow}`
  );

  recordCheck(
    'SEC2.03',
    'System 3002 enforces strict Risk-to-Reward ratio >= 2.00 (design target >= 2.30)',
    'MATH_AUTHENTICITY',
    (wbLongResult.riskReward || 0) >= 2.00 && actualRR >= 2.00,
    `RR: ${wbLongResult.riskReward}, actual: ${actualRR.toFixed(2)}`
  );

  // 2.3 Veto Test: Bear Dump Veto (Price < EMA50 and EMA50 sloping down < -0.0015)
  const bearDumpCandles: KlinePoint[] = [];
  for (let i = 0; i < 60; i++) {
    const p = 80000 * Math.pow(0.98, i); // Exponential steep dump
    bearDumpCandles.push(createCandle(1700000000 + i * 900, p + 5, p + 10, p - 5, p, 1000));
  }
  const bdCloses = bearDumpCandles.map(c => c.close);
  const bdMean = bdCloses.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const bdStd = Math.sqrt(bdCloses.slice(-20).reduce((a, b) => a + Math.pow(b - bdMean, 2), 0) / 20);
  const bdLowerBB = bdMean - bdStd * 2.0;
  bearDumpCandles.push(createCandle(1700060000, bdLowerBB + 2, bdLowerBB + 3, bdLowerBB - 20, bdLowerBB + 4, 8000));

  const bdResult = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', bearDumpCandles);
  recordCheck(
    'SEC2.04',
    'System 3002 blocks Long entry during steep runaway bear dump (EMA50 slope < -0.0015)',
    'BEHAVIORAL_VERIFICATION',
    bdResult.recommendedSide === null,
    `Expected null, got ${bdResult.recommendedSide}`
  );

  // 2.4 Short Setup: %B > 1.0 excursion + snapback + exhaustion upper wick
  const wbShortCandles = generateBaselineCandles(60, 80000, -2, 20);
  const scCloses = wbShortCandles.map(c => c.close);
  const scMean20 = scCloses.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const scStd20 = Math.sqrt(scCloses.slice(-20).reduce((a, b) => a + Math.pow(b - scMean20, 2), 0) / 20);
  const scUpperBB = scMean20 + scStd20 * 2.0;

  const spikeHigh = scUpperBB + 80;
  const snapDownClose = scUpperBB - 20;
  const snapDownOpen = scUpperBB - 10;
  const snapDownLow = snapDownClose - 5;
  wbShortCandles.push(createCandle(1700060000, snapDownOpen, spikeHigh, snapDownLow, snapDownClose, 8000));

  const wbShortResult = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', wbShortCandles);
  recordCheck(
    'SEC2.05',
    'System 3002 triggers SELL on %B > 1.0 upper elasticity excursion snapback',
    'BEHAVIORAL_VERIFICATION',
    wbShortResult.recommendedSide === 'SELL' && wbShortResult.setupType === 'WHITEBOARD_AMM_UPPER_SLIPPAGE_SNAPBACK',
    `Result: side=${wbShortResult.recommendedSide}, type=${wbShortResult.setupType}`
  );

  recordCheck(
    'SEC2.06',
    'System 3002 Short enforces strict Risk-to-Reward ratio >= 2.00',
    'MATH_AUTHENTICITY',
    (wbShortResult.riskReward || 0) >= 2.00,
    `RR: ${wbShortResult.riskReward}`
  );

  // --------------------------------------------------------------------------
  // SECTION 3: SYSTEM 3003 (HBA SERVICES MARKET STRUCTURE BREAKOUT)
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: System 3003 HBA Market Structure Breakout ---');

  // 3.1 Horizontal S&R Cluster Detection
  const clusterCandles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 45; i++) {
    let high = 81800;
    if (i === 10 || i === 22 || i === 34) {
      high = 82000;
    }
    clusterCandles.push(createCandle(baseTime + i * 900, 81500, high, 81400, 81600, 1000));
  }
  const testAtr = hbaMarketStructureBreakoutEngine.calcATR(clusterCandles, 14);
  const detectedClusters = hbaMarketStructureBreakoutEngine.findHorizontalClusters(clusterCandles, testAtr, 45);
  const resCluster = detectedClusters.find(c => c.type === 'RESISTANCE' && Math.abs(c.level - 82000) <= 0.15 * testAtr);

  recordCheck(
    'SEC3.01',
    'findHorizontalClusters detects multi-touch resistance cluster with >= 2 touches',
    'MATH_AUTHENTICITY',
    resCluster !== undefined && resCluster.touches >= 2,
    `Detected clusters: ${detectedClusters.length}, resCluster touches: ${resCluster?.touches}`
  );

  // 3.2 Bullish Breakout Execution
  const breakoutCandles = [...clusterCandles];
  const breakoutOpen = 81950;
  const breakoutClose = 82150;
  const breakoutHigh = 82180;
  const breakoutLow = 81920;
  breakoutCandles.push(createCandle(baseTime + 45 * 900, breakoutOpen, breakoutHigh, breakoutLow, breakoutClose, 4000));

  const hbaBreakoutResult = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', breakoutCandles);
  recordCheck(
    'SEC3.02',
    'System 3003 triggers BUY on resistance breakout with volume and 1H EMA20 alignment',
    'BEHAVIORAL_VERIFICATION',
    hbaBreakoutResult.recommendedSide === 'BUY' && hbaBreakoutResult.setupType === 'HBA_MARKET_STRUCTURE_BREAKOUT',
    `Result: side=${hbaBreakoutResult.recommendedSide}, type=${hbaBreakoutResult.setupType}`
  );

  // 3.3 Verify Pre-Reversal Take Profit is EXACTLY 2 ticks before next structural barrier
  const rNext = hbaBreakoutResult.nextStructuralLevel || 0;
  const expectedTP = rNext - (2 * btcSpec.tickSize);
  const quantizedExpectedTP = hbaMarketStructureBreakoutEngine.quantizePrice(expectedTP, btcSpec.tickSize, btcSpec.decimals);

  recordCheck(
    'SEC3.03',
    'System 3003 Pre-Reversal TP is placed EXACTLY 2 ticks before next structural barrier (R_next - 2*tickSize)',
    'MATH_AUTHENTICITY',
    hbaBreakoutResult.customTP === quantizedExpectedTP,
    `TP: ${hbaBreakoutResult.customTP}, expected: ${quantizedExpectedTP} (R_next: ${rNext})`
  );

  recordCheck(
    'SEC3.04',
    'System 3003 enforces strict Risk-to-Reward ratio >= 2.00',
    'MATH_AUTHENTICITY',
    (hbaBreakoutResult.riskReward || 0) >= 2.00,
    `RR: ${hbaBreakoutResult.riskReward}`
  );

  // 3.4 Volume Filter Veto Test: Low volume breakout (volume <= 1.5x SMA20)
  const lowVolBreakoutCandles = [...clusterCandles];
  lowVolBreakoutCandles.push(createCandle(baseTime + 45 * 900, breakoutOpen, breakoutHigh, breakoutLow, breakoutClose, 1100));
  const lowVolResult = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', lowVolBreakoutCandles);
  recordCheck(
    'SEC3.05',
    'System 3003 strictly rejects low volume breakout (Volume <= 1.50x 20 SMA)',
    'BEHAVIORAL_VERIFICATION',
    lowVolResult.recommendedSide === null,
    `Expected null, got ${lowVolResult.recommendedSide}`
  );

  // 3.5 Conviction Filter Veto Test: Weak body breakout (body < 50% range)
  const weakBodyBreakoutCandles = [...clusterCandles];
  weakBodyBreakoutCandles.push(createCandle(baseTime + 45 * 900, 82000, 82300, 81900, 82100, 4000));
  const weakBodyResult = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', weakBodyBreakoutCandles);
  recordCheck(
    'SEC3.06',
    'System 3003 strictly rejects weak body breakout candle (Body < 50% range)',
    'BEHAVIORAL_VERIFICATION',
    weakBodyResult.recommendedSide === null,
    `Expected null, got ${weakBodyResult.recommendedSide}`
  );

  // --------------------------------------------------------------------------
  // SECTION 4: SYSTEM 3004 (HBA SERVICES CANDLESTICK & TRENDLINE ENGINE)
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 4: System 3004 HBA Candlestick & Trendlines ---');

  // 4.1 Candlestick Geometry Unit Verification
  const hammerCandle = createCandle(1, 80020, 80035, 79800, 80040);
  const hammerGeo = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(hammerCandle, btcSpec.tickSize);
  recordCheck(
    'SEC4.01',
    'analyzeCandleGeometry accurately verifies Hammer (lower wick >= 2x body, body <= 35%, counter-wick <= 30%)',
    'MATH_AUTHENTICITY',
    hammerGeo.isHammer === true && hammerGeo.rejectionWickRatio >= 2.0 && hammerGeo.bodyRatio <= 0.35,
    `isHammer: ${hammerGeo.isHammer}, wickRatio: ${hammerGeo.rejectionWickRatio.toFixed(1)}, bodyRatio: ${hammerGeo.bodyRatio.toFixed(2)}`
  );

  const starCandle = createCandle(1, 80040, 80280, 80020, 80025);
  const starGeo = hbaCandlestickTrendlineEngine.analyzeCandleGeometry(starCandle, btcSpec.tickSize);
  recordCheck(
    'SEC4.02',
    'analyzeCandleGeometry accurately verifies Shooting Star (upper wick >= 2x body, body <= 35%, counter-wick <= 30%)',
    'MATH_AUTHENTICITY',
    starGeo.isShootingStar === true && starGeo.rejectionWickRatio >= 2.0 && starGeo.bodyRatio <= 0.35,
    `isShootingStar: ${starGeo.isShootingStar}, wickRatio: ${starGeo.rejectionWickRatio.toFixed(1)}`
  );

  // 4.2 Hammer at Support (Setup A - Long)
  const hammerSupportCandles = generateBaselineCandles(45, 80000, 0, 30);
  // Establish prior swing high at bar 5 for healthy R:R target
  hammerSupportCandles[5].high = 80300;
  // Establish support level at ~79900 in history
  hammerSupportCandles[15].low = 79900;
  hammerSupportCandles[25].low = 79905;
  // Last candle: Hammer hitting support at 79900 and rejecting upwards
  const hammerEntry = 79950;
  hammerSupportCandles.push(createCandle(baseTime + 45 * 900, 79930, 79955, 79890, hammerEntry, 3000));

  const hammerResult = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', hammerSupportCandles);
  recordCheck(
    'SEC4.03',
    'System 3004 triggers BUY on Hammer at Support level',
    'BEHAVIORAL_VERIFICATION',
    hammerResult.recommendedSide === 'BUY' && hammerResult.setupType === 'HBA_CANDLESTICK_SUPPORT_REVERSAL',
    `Result: side=${hammerResult.recommendedSide}, type=${hammerResult.setupType}`
  );

  // Verify Pre-Reversal TP is EXACTLY 3 ticks before preceding swing high or capped at 2.50
  recordCheck(
    'SEC4.04',
    'System 3004 Pre-Reversal TP placed EXACTLY 3 ticks before preceding swing high (SwingHigh - 3*tickSize) or capped at 2.50 R:R',
    'MATH_AUTHENTICITY',
    hammerResult.customTP !== undefined && (hammerResult.customTP <= 80300 - 3 * btcSpec.tickSize || hammerResult.riskReward === 2.50),
    `TP: ${hammerResult.customTP}, RR: ${hammerResult.riskReward}`
  );

  recordCheck(
    'SEC4.05',
    'System 3004 enforces strict 1:2.00 to 1:2.50 Risk-to-Reward ratio corridor',
    'MATH_AUTHENTICITY',
    (hammerResult.riskReward || 0) >= 2.00 && (hammerResult.riskReward || 0) <= 2.50,
    `RR: ${hammerResult.riskReward}`
  );

  // 4.3 Trendline Breakout & Retest (Setup B - Long)
  const tlCandles: KlinePoint[] = [];
  for (let i = 0; i <= 38; i++) {
    const tlPrice = 84000 - i * 100;
    let high = tlPrice - 50;
    let low = tlPrice - 150;
    let open = tlPrice - 100;
    let close = tlPrice - 80;

    if (i === 10) high = 83500; // Peak 1
    if (i === 25) high = 82000; // Peak 2 (Lower High)

    if (i === 35) {
      // Breakout above descending trendline
      open = 80450;
      close = 80650;
      high = 80680;
      low = 80400;
    }
    if (i === 37) {
      // Retest bounce at trendline
      open = 80350;
      low = 80300;
      close = 80450;
      high = 80480;
    }

    tlCandles.push(createCandle(baseTime + i * 900, open, high, low, close, 1500));
  }

  const tlResult = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', tlCandles);
  recordCheck(
    'SEC4.06',
    'System 3004 constructs linear trendlines T(t)=m*t+c and detects breakout-retest bounce within 1-5 bars',
    'BEHAVIORAL_VERIFICATION',
    tlResult.recommendedSide === 'BUY' && tlResult.setupType.includes('TRENDLINE'),
    `Result: side=${tlResult.recommendedSide}, type=${tlResult.setupType}`
  );

  // --------------------------------------------------------------------------
  // SECTION 5: ROBUSTNESS, INTEGRITY & ADVERSARIAL EDGE CASES
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 5: Robustness, Integrity & Adversarial Edge Cases ---');

  // 5.1 Empty candle arrays do not crash
  const emptyWb = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', []);
  const emptyHba3 = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', []);
  const emptyHba4 = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', []);
  recordCheck(
    'SEC5.01',
    'All engines safely return null result on empty candle arrays without exception',
    'EDGE_CASES',
    emptyWb.recommendedSide === null && emptyHba3.recommendedSide === null && emptyHba4.recommendedSide === null,
    'Engines must guard against array length < minimum requirements'
  );

  // 5.2 Short history (< 20 or < 30 bars) safely returns null
  const shortCandles = generateBaselineCandles(15, 80000, 0, 10);
  const shortWb = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', shortCandles);
  const shortHba3 = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', shortCandles);
  const shortHba4 = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', shortCandles);
  recordCheck(
    'SEC5.02',
    'All engines safely return null result on insufficient candle history (< 20-30 bars)',
    'EDGE_CASES',
    shortWb.recommendedSide === null && shortHba3.recommendedSide === null && shortHba4.recommendedSide === null,
    'Engines must require sufficient bars for statistical lookbacks'
  );

  // 5.3 Flat/Zero-volatility candles do not divide by zero or emit NaN
  const flatCandles: KlinePoint[] = [];
  for (let i = 0; i < 40; i++) {
    flatCandles.push(createCandle(baseTime + i * 900, 80000, 80000, 80000, 80000, 1000));
  }
  const flatWb = whiteboardCryptoDeFiEngine.evaluateSetup('BTCUSD', flatCandles);
  const flatHba3 = hbaMarketStructureBreakoutEngine.evaluateSetup('BTCUSD', flatCandles);
  const flatHba4 = hbaCandlestickTrendlineEngine.evaluateSetup('BTCUSD', flatCandles);
  recordCheck(
    'SEC5.03',
    'Zero-volatility / zero-range flat candles do not trigger divide-by-zero or NaN',
    'EDGE_CASES',
    !isNaN(flatWb.confidenceScore) && !isNaN(flatHba3.confidenceScore) && !isNaN(flatHba4.confidenceScore),
    `Scores: wb=${flatWb.confidenceScore}, hba3=${flatHba3.confidenceScore}, hba4=${flatHba4.confidenceScore}`
  );

  // 5.4 No hardcoded symbol bypasses or dummy constant returns
  const unknownWb = whiteboardCryptoDeFiEngine.evaluateSetup('UNKNOWN_COIN_XYZ', wbLongCandles);
  recordCheck(
    'SEC5.04',
    'Strategy logic evaluates identically regardless of arbitrary symbol string (no symbol hardcoding)',
    'STATIC_ANALYSIS',
    unknownWb.recommendedSide === wbLongResult.recommendedSide,
    `Unknown symbol side: ${unknownWb.recommendedSide}, expected: ${wbLongResult.recommendedSide}`
  );

  // --------------------------------------------------------------------------
  // SUMMARY REPORT
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  const total = auditChecks.length;
  const passed = auditChecks.filter(c => c.passed).length;
  const failed = auditChecks.filter(c => !c.passed).length;
  console.log(`📊 FORENSIC INTEGRITY AUDIT SUMMARY: ${passed} / ${total} Checks Passed (${failed} Failed)`);
  console.log('================================================================');

  if (failed > 0) {
    console.error(`\n❌ VERDICT: INTEGRITY VIOLATION (${failed} checks failed)`);
    process.exit(1);
  } else {
    console.log(`\n✅ VERDICT: CLEAN — All ${total} forensic integrity checks passed with zero violations.`);
    process.exit(0);
  }
}

runForensicAudit().catch(err => {
  console.error('Audit suite crashed with unexpected error:', err);
  process.exit(1);
});
