import { marwadiTraderDeltaTrapEngine } from '../lib/strategies/marwadiTraderDeltaTrapEngine';
import { marwadiLiquidityTrapEngine } from '../lib/strategies/marwadiLiquidityTrapEngine';
import { mathRiskEngine } from '../lib/mathematicalRiskEngine';
import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { KlinePoint } from '../src/types';

function runMilestone3Tests() {
  console.log('========================================================================');
  console.log('🧪 MILESTONE 3 HARDENING VERIFICATION: SYSTEM 3007 & RISK ENGINE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // ============================================================================
  // TEST 1: Elimination of Sidhant Fallback
  // ============================================================================
  console.log('--- TEST 1: Zero Sidhant Fallback & Clean Null Result ---');
  // Create ordinary trending/choppy candles that do NOT form a Marwadi trap
  const plainCandles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 40; i++) {
    const p = 100 + i * 0.1;
    plainCandles.push({
      time: baseTime + i * 900,
      open: p,
      high: p + 0.5,
      low: p - 0.5,
      close: p + 0.1,
      volume: 1000,
    });
  }

  const plainRes = marwadiTraderDeltaTrapEngine.evaluateSetup('SOLUSD', plainCandles);
  assert(plainRes.recommendedSide === null, 'System 3007: Stood aside cleanly on non-trap market (recommendedSide === null)');
  assert(plainRes.setupType === 'NONE', `System 3007: setupType is 'NONE' (Actual: ${plainRes.setupType})`);
  assert(!plainRes.setupType.includes('SIDHANT'), 'System 3007: Zero Sidhant fallback');

  // ============================================================================
  // TEST 2: Genuine Bull Trap with Multi-Touch Range Boundaries
  // ============================================================================
  console.log('\n--- TEST 2: Genuine Bull Trap with Multi-Touch Confirmation ---');
  // 35 bars oscillating between 100 (ceiling) and 85 (floor)
  // ATR around 2.0. Range width = 15 (> 2 * ATR)
  const bullTrapCandles: KlinePoint[] = [];
  const R_high = 100.0;
  const R_low = 82.0;
  for (let i = 0; i < 35; i++) {
    // 35 bars oscillating between 100 and 82 with small steps (ATR ~ 2.0)
    const cycle = (i / 16) * 2 * Math.PI;
    const mid = 91.0;
    const amp = 8.5; // reaches 82.5 to 99.5
    const p = mid + amp * Math.sin(cycle);
    const open = p - 0.2;
    const close = p + 0.2;
    let high = Math.max(open, close) + 0.3;
    let low = Math.min(open, close) - 0.3;
    if (i === 4 || i === 20) {
      high = R_high; // Two confirmed ceiling touches at 100.0
    }
    if (i === 12 || i === 28) {
      low = R_low; // Two confirmed floor touches at 82.0
    }
    bullTrapCandles.push({
      time: baseTime + i * 900,
      open,
      high,
      low,
      close,
      volume: 1000,
    });
  }

  // Pre-breakout bar testing resistance
  bullTrapCandles.push({
    time: baseTime + 35 * 900,
    open: 98.8,
    high: 99.8,
    low: 98.5,
    close: 99.5,
    volume: 1200,
  });

  // Bull Trap candle: Pierces above 100.0 to 101.0, rejected with long upper wick, closes at 99.2
  bullTrapCandles.push({
    time: baseTime + 36 * 900,
    open: 99.5,
    high: 101.0, // Pierced above 100.0
    low: 99.0,
    close: 99.2, // Closed back INSIDE range
    volume: 2500, // RVOL > 1.5x
  });

  const bullTrapRes = marwadiTraderDeltaTrapEngine.evaluateSetup('SOLUSD', bullTrapCandles);
  assert(bullTrapRes.recommendedSide === 'SELL', `Bull Trap: Generated SELL (Actual: ${bullTrapRes.recommendedSide})`);
  assert(bullTrapRes.setupType === 'MARWADI_BULL_TRAP_FADE', `Bull Trap: Setup type is MARWADI_BULL_TRAP_FADE`);
  assert((bullTrapRes.riskReward || 0) >= 2.30, `Bull Trap: RR >= 1:2.30 (Actual: 1:${bullTrapRes.riskReward})`);
  assert(bullTrapRes.customSL! > 101.0, `Bull Trap: SL ($${bullTrapRes.customSL}) placed strictly beyond trap high ($101.00)`);
  assert(bullTrapRes.customTP! >= R_low, `Bull Trap: Pre-reversal TP ($${bullTrapRes.customTP}) placed before or at range floor ($${R_low})`);

  // ============================================================================
  // TEST 3: Genuine Bear Trap with Multi-Touch Range Boundaries
  // ============================================================================
  console.log('\n--- TEST 3: Genuine Bear Trap with Multi-Touch Confirmation ---');
  const bearTrapCandles: KlinePoint[] = [];
  for (let i = 0; i < 35; i++) {
    const cycle = ((i + 8) / 16) * 2 * Math.PI;
    const mid = 91.0;
    const amp = 8.5;
    const p = mid + amp * Math.sin(cycle);
    const open = p - 0.2;
    const close = p + 0.2;
    let high = Math.max(open, close) + 0.3;
    let low = Math.min(open, close) - 0.3;
    if (i === 12 || i === 28) {
      high = R_high; // Two confirmed ceiling touches at 100.0
    }
    if (i === 4 || i === 20) {
      low = R_low; // Two confirmed floor touches at 82.0
    }
    bearTrapCandles.push({
      time: baseTime + i * 900,
      open,
      high,
      low,
      close,
      volume: 1000,
    });
  }

  // Pre-breakdown bar testing support floor
  bearTrapCandles.push({
    time: baseTime + 35 * 900,
    open: 83.2,
    high: 83.5,
    low: 82.2,
    close: 82.5,
    volume: 1200,
  });

  // Bear Trap candle: Pierces below 82.0 to 81.0, bounces with long lower wick, closes at 82.8
  bearTrapCandles.push({
    time: baseTime + 36 * 900,
    open: 82.5,
    high: 83.0,
    low: 81.0, // Pierced below 82.0
    close: 82.8, // Closed back INSIDE range
    volume: 2500, // RVOL > 1.5x
  });

  const bearTrapRes = marwadiTraderDeltaTrapEngine.evaluateSetup('SOLUSD', bearTrapCandles);
  assert(bearTrapRes.recommendedSide === 'BUY', `Bear Trap: Generated BUY (Actual: ${bearTrapRes.recommendedSide})`);
  assert(bearTrapRes.setupType === 'MARWADI_BEAR_TRAP_FADE', `Bear Trap: Setup type is MARWADI_BEAR_TRAP_FADE`);
  assert((bearTrapRes.riskReward || 0) >= 2.30, `Bear Trap: RR >= 1:2.30 (Actual: 1:${bearTrapRes.riskReward})`);
  assert(bearTrapRes.customSL! < 81.0, `Bear Trap: SL ($${bearTrapRes.customSL}) placed strictly below trap low ($81.00)`);
  assert(bearTrapRes.customTP! <= R_high, `Bear Trap: Pre-reversal TP ($${bearTrapRes.customTP}) placed before or at range ceiling ($${R_high})`);

  // ============================================================================
  // TEST 4: Protection Against Single Anomalous Wick (The XMR Anomaly Test)
  // ============================================================================
  console.log('\n--- TEST 4: Protection Against Single Anomalous Wick (XMR Anomaly) ---');
  // Copy bullTrapCandles, but inject a single bad wick to 110.22 (extreme 80% spike/dump)
  const anomalyCandles: KlinePoint[] = JSON.parse(JSON.stringify(bullTrapCandles));
  // Replace candle 10 low with 110.22 on a $580 asset (or 20 on a $100 asset)
  anomalyCandles[10].low = 15; // single aberrant spike

  const bounds = marwadiTraderDeltaTrapEngine.detectRangeBoundaries(anomalyCandles.slice(0, -2), 2.0, 97);
  assert(bounds.rangeLow !== 15, `XMR Anomaly Shield: rangeLow did NOT latch onto isolated wick at 15 (Actual rangeLow: ${bounds.rangeLow})`);
  assert(bounds.rangeLow === R_low, `XMR Anomaly Shield: rangeLow correctly anchored to multi-touch support at ${R_low}`);

  // ============================================================================
  // TEST 5: Downstream Risk Engine Elimination of 0.40 ATR Squeeze
  // ============================================================================
  console.log('\n--- TEST 5: Downstream Risk Engine Mandatory Floor ---');
  const entryPrice = 1000;
  const effectiveAtr = 10;
  // If structuralSL is supplied at 998 (rawDist = 2 points, which is 0.2 ATR):
  // Old code would squeeze SL to max(2, 0.40 * 10 = 4, 2 ticks) = 4 points!
  // New code must enforce floor: max(2, 1.25 * 10 = 12.5, 2.5 * spread, entryPrice * 0.010 = 10) = 12.5 points!
  const tightBuyTargets = mathRiskEngine.calculateGeometricTargets({
    side: 'BUY',
    entryPrice,
    atr: effectiveAtr,
    structuralSL: 998, // Micro-stop: only 2 points away
    bestBid: 999.9,
    bestAsk: 1000.1,
  });

  assert(tightBuyTargets.slDistance >= 1.25 * effectiveAtr, `Risk Engine BUY: slDistance (${tightBuyTargets.slDistance}) >= 1.25 ATR (${1.25 * effectiveAtr})`);
  assert(tightBuyTargets.slDistance >= entryPrice * 0.010, `Risk Engine BUY: slDistance (${tightBuyTargets.slDistance}) >= 1.0% price distance (${entryPrice * 0.010})`);
  assert(tightBuyTargets.stopLossPrice <= entryPrice - (1.25 * effectiveAtr), `Risk Engine BUY: StopLoss price ($${tightBuyTargets.stopLossPrice}) enforces breathing room floor`);

  const tightSellTargets = mathRiskEngine.calculateGeometricTargets({
    side: 'SELL',
    entryPrice,
    atr: effectiveAtr,
    structuralSL: 1002, // Micro-stop: only 2 points away
    bestBid: 999.9,
    bestAsk: 1000.1,
  });

  assert(tightSellTargets.slDistance >= 1.25 * effectiveAtr, `Risk Engine SELL: slDistance (${tightSellTargets.slDistance}) >= 1.25 ATR (${1.25 * effectiveAtr})`);
  assert(tightSellTargets.slDistance >= entryPrice * 0.010, `Risk Engine SELL: slDistance (${tightSellTargets.slDistance}) >= 1.0% price distance (${entryPrice * 0.010})`);
  assert(tightSellTargets.stopLossPrice >= entryPrice + (1.25 * effectiveAtr), `Risk Engine SELL: StopLoss price ($${tightSellTargets.stopLossPrice}) enforces breathing room floor`);

  // ============================================================================
  // TEST 6: Execution Daemon Target Profit Positive Asymmetry ($34.50+)
  // ============================================================================
  console.log('\n--- TEST 6: Execution Daemon Target Profit Positive Asymmetry ---');
  const daemonState = deltaAutoTrader.getStatus();
  assert(daemonState.targetProfitPerTradeUSD! >= 34.50, `Execution Daemon: targetProfitPerTradeUSD ($${daemonState.targetProfitPerTradeUSD}) >= $34.50`);
  assert(
    daemonState.targetProfitPerTradeUSD! >= daemonState.maxLossPerTradeUSD! * 2.30,
    `Execution Daemon: targetProfitPerTradeUSD ($${daemonState.targetProfitPerTradeUSD}) >= 2.30x maxLoss ($${(daemonState.maxLossPerTradeUSD! * 2.30).toFixed(2)})`
  );

  console.log('\n========================================================================');
  console.log(`📊 MILESTONE 3 SUITE RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMilestone3Tests();
