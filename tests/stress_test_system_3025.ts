import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { whiteboardDeFiEngine, WhiteboardCryptoDeFiEngine } from '../lib/strategies/whiteboardCryptoDeFiEngine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { mathRiskEngine } from '../lib/mathematicalRiskEngine';
import { KlinePoint } from '../src/types';

interface TestResult {
  scenario: string;
  category: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, scenario: string, category: string, expected: string, actual: string, details?: any) {
  results.push({
    scenario,
    category,
    passed: condition,
    expected,
    actual,
    details,
  });
  if (condition) {
    console.log(`  ✅ [PASS] ${scenario}`);
  } else {
    console.error(`  ❌ [FAIL] ${scenario}`);
    console.error(`     Expected: ${expected}`);
    console.error(`     Actual:   ${actual}`);
    if (details) console.error(`     Details:`, details);
  }
}

/**
 * Helper to build synthetic 15m candle sequences
 */
function createBaseCandles(count: number, basePrice: number, volatility: number = 20): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const startTime = 1700000000;
  for (let i = 0; i < count; i++) {
    const open = basePrice + Math.sin(i * 0.4) * volatility;
    const close = basePrice + Math.sin(i * 0.4 + 0.2) * volatility;
    const high = Math.max(open, close) + 8;
    const low = Math.min(open, close) - 8;
    candles.push({
      time: startTime + i * 900,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume: 100,
    });
  }
  return candles;
}

async function runEmpiricalStressTests() {
  console.log('========================================================================');
  console.log('🔬 EMPIRICAL STRESS TEST SUITE: SYSTEM 3025 (WHITEBOARD CRYPTO DEFI AMM)');
  console.log('   Adverse Regimes, Boundary Stress, Option A Verification & Math Parity');
  console.log('========================================================================\n');

  // Set Port 3025 environment
  process.env.PORT = '3025';
  (deltaAutoTrader as any).port = 3025;

  // =========================================================================
  // SUITE 1: ADVERSE SCENARIOS & QUALITY GATES (USER MANDATE COMPLIANCE)
  // "abb kuch bhi trade na lene lage follow the rule of his own video"
  // =========================================================================
  console.log('--- SUITE 1: Adverse Regimes & Zero-Degraded Trade Verification ---');

  // -------------------------------------------------------------------------
  // Scenario A1: Tight Bollinger Squeeze (Zero-Squeeze Rule)
  // Bands are compressed so distance to opposite band cannot provide 1:2.30 RR
  // -------------------------------------------------------------------------
  {
    const candles = createBaseCandles(30, 80000, 2); // Extremely tight volatility: 2 points
    const last = candles[candles.length - 1];
    last.low = 79980; // slight poke
    last.close = 80000; // close back
    last.volume = 300;

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario A1: Tight Bollinger Squeeze - Rejection (Zero-Squeeze Rule)',
      'Adverse Market - BB Squeeze',
      'recommendedSide === null (RR < 2.30 due to tight bands)',
      `recommendedSide === ${res.recommendedSide} (RR: ${res.riskReward || 'N/A'})`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario A2: Degraded Risk-Reward Rejection (Late Entry / Chasing Rebound)
  // Price has bounced too far inside bands, shrinking profit room to 1:1.02 RR
  // -------------------------------------------------------------------------
  {
    const candles = createBaseCandles(30, 80000, 180);
    candles[candles.length - 2].low = 79500;
    const last = candles[candles.length - 1];
    last.open = 79650;
    last.low = 79550;
    last.high = 79850;
    last.close = 79800; // Price chased up too far, RR is ~1.02
    last.volume = 600;

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario A2: Degraded RR Rejection - Never Chase Mid-Band (RR 1.02 < 1:2.30)',
      'Adverse Market - Sub-Optimal RR',
      'recommendedSide === null (Rebuffed by strict 1:2.30 RR filter)',
      `recommendedSide === ${res.recommendedSide} (RR: ${res.riskReward || 'N/A'})`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario B1: Runaway Vertical Bear Crash (Falling Knife Veto)
  // Slope drops more than -0.0015 per bar (steep crash)
  // -------------------------------------------------------------------------
  {
    const candles: KlinePoint[] = [];
    let price = 85000;
    for (let i = 0; i < 35; i++) {
      const prev = price;
      price = price * 0.997; // 0.3% drop per bar = steep crash
      candles.push({
        time: 1700000000 + i * 900,
        open: prev,
        high: prev + 10,
        low: price - 30,
        close: price,
        volume: 200,
      });
    }
    const last = candles[candles.length - 1];
    last.open = price - 50;
    last.low = price - 100;
    last.close = price;
    last.high = price + 10;
    last.volume = 500;

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario B1: Runaway Bear Crash Veto - No Knife Catching',
      'Adverse Market - Crash Veto',
      'recommendedSide === null (Vetoed by isRunawayBearCrash)',
      `recommendedSide === ${res.recommendedSide} (Reasons: ${res.reasons.join(', ') || 'None'})`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario B2: Runaway Vertical Bull Blowoff (Blowoff Top Veto)
  // Slope rises more than +0.0015 per bar (steep vertical pump)
  // -------------------------------------------------------------------------
  {
    const candles: KlinePoint[] = [];
    let price = 75000;
    for (let i = 0; i < 35; i++) {
      const prev = price;
      price = price * 1.003; // 0.3% pump per bar = vertical blowoff
      candles.push({
        time: 1700000000 + i * 900,
        open: prev,
        high: price + 30,
        low: prev - 10,
        close: price,
        volume: 200,
      });
    }
    const last = candles[candles.length - 1];
    last.open = price + 50;
    last.high = price + 100;
    last.close = price;
    last.low = price - 10;
    last.volume = 100;

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario B2: Runaway Bull Blowoff Veto - No Shorting Super-Trends',
      'Adverse Market - Blowoff Veto',
      'recommendedSide === null (Vetoed by isRunawayBullBlowoff)',
      `recommendedSide === ${res.recommendedSide} (Reasons: ${res.reasons.join(', ') || 'None'})`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario C: Non-Excursion Inside-Band Consolidation / Random Chop
  // %B oscillates between 0.20 and 0.80 without touching outer bands
  // -------------------------------------------------------------------------
  {
    const candles = createBaseCandles(30, 80000, 30);
    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario C: Inside-Band Chop - Abstain When Bands Untouched',
      'Adverse Market - Non-Excursion Chop',
      'recommendedSide === null (No outer band excursion)',
      `recommendedSide === ${res.recommendedSide} (%B: ${res.percentB?.toFixed(2) || 'N/A'})`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario E1: Failed Snapback - Candle Closes Outside Band (%B < 0)
  // -------------------------------------------------------------------------
  {
    const candles = createBaseCandles(30, 80000, 150);
    const last = candles[candles.length - 1];
    last.open = 79400;
    last.high = 79450;
    last.low = 79200;
    last.close = 79300; // Closed below lowerBB
    last.volume = 500;

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario E1: Failed Snapback - Rejection (Candle closed outside BB)',
      'Option A Filter - Snapback Confirmation',
      'recommendedSide === null (closedInsideLower is false)',
      `recommendedSide === ${res.recommendedSide}`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario E2: Insufficient Rejection (No Wick & Weak Body Recovery)
  // -------------------------------------------------------------------------
  {
    const candles = createBaseCandles(30, 80000, 150);
    candles[candles.length - 2].low = 79200;
    const last = candles[candles.length - 1];
    last.open = 79600;
    last.high = 79800;
    last.low = 79590; // almost no lower wick
    last.close = 79610; // close near bottom
    last.volume = 300;

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario E2: Weak Rejection Veto - Lower wick < 20% and body recovery < 60%',
      'Option A Filter - Absorption Rejection',
      'recommendedSide === null (hasLowerRejectionWick is false)',
      `recommendedSide === ${res.recommendedSide}`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario E3: Long Without Volume Surge (Declining Volume Veto)
  // -------------------------------------------------------------------------
  {
    const candles = createBaseCandles(30, 80000, 150);
    candles[candles.length - 2].low = 79200;
    candles[candles.length - 2].volume = 500;
    const last = candles[candles.length - 1];
    last.open = 79500;
    last.high = 79750;
    last.low = 79350;
    last.close = 79700;
    last.volume = 50; // RVOL ~0.3x, lower than prev bar

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', candles);
    assert(
      res.recommendedSide === null,
      'Scenario E3: Long Volume Gate - Reject Long on Diminishing Volume',
      'Option A Filter - Volume Surge',
      'recommendedSide === null (hasVolumeSurgeLong is false)',
      `recommendedSide === ${res.recommendedSide}`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario F1: Multi-Timeframe (5m) Trigger Veto
  // 15m is valid, but 5m micro-candles show dumping continuation
  // -------------------------------------------------------------------------
  {
    const candles15m: KlinePoint[] = [];
    const startTime = 1700000000;
    for (let i = 0; i < 28; i++) {
      const p = 80000 + Math.sin(i * 0.4) * 150;
      candles15m.push({
        time: startTime + i * 900,
        open: p,
        high: p + 30,
        low: p - 30,
        close: p + 10,
        volume: 100,
      });
    }
    candles15m.push({
      time: startTime + 28 * 900,
      open: 79820,
      high: 79840,
      low: 79720,
      close: 79750,
      volume: 150,
    });
    candles15m.push({
      time: startTime + 29 * 900,
      open: 79760,
      high: 79820,
      low: 79730,
      close: 79810,
      volume: 350,
    });

    // 5m candles showing active bear dump (red candle, lower close)
    const candles5m: KlinePoint[] = [
      { time: 1, open: 79800, high: 79850, low: 79700, close: 79720, volume: 100 },
      { time: 2, open: 79720, high: 79750, low: 79650, close: 79660, volume: 100 },
      { time: 3, open: 79660, high: 79680, low: 79550, close: 79560, volume: 100 }, // red close < open and < prev
    ];

    const mtfData = { candles15m, candles5m };
    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', mtfData);
    assert(
      res.recommendedSide === null,
      'Scenario F1: 5m MTF Alignment Gate - Veto Long when 5m is actively falling',
      'MTF Trigger Filter',
      'recommendedSide === null (is5mTriggerValidLong is false)',
      `recommendedSide === ${res.recommendedSide}`
    );
  }

  console.log('\n--- SUITE 2: Valid Option A Snapback Execution & Math Parity ---');

  // -------------------------------------------------------------------------
  // Scenario D1: Valid Snapback Reversal BUY
  // Deep excursion %B < 0, snapback close inside, wick >= 20%, volume surge, RR >= 2.30
  // -------------------------------------------------------------------------
  let validBuyCustomTP = 0;
  let validBuyCustomSL = 0;
  let validBuyEntry = 0;
  let validBuyUpperBB = 0;
  {
    const candles15m: KlinePoint[] = [];
    const startTime = 1700000000;
    for (let i = 0; i < 28; i++) {
      const p = 80000 + Math.sin(i * 0.4) * 150;
      candles15m.push({
        time: startTime + i * 900,
        open: p,
        high: p + 30,
        low: p - 30,
        close: p + 10,
        volume: 100,
      });
    }
    // Bar 28: Excursion poking lower BB
    candles15m.push({
      time: startTime + 28 * 900,
      open: 79820,
      high: 79840,
      low: 79720,
      close: 79750,
      volume: 150,
    });
    // Bar 29: Snapback candle closing back inside lowerBB with lower rejection wick
    candles15m.push({
      time: startTime + 29 * 900,
      open: 79760,
      high: 79820,
      low: 79730,
      close: 79810,
      volume: 350,
    });
    validBuyEntry = 79810;

    // 5m confirming bounce
    const candles5m: KlinePoint[] = [
      { time: 1, open: 79750, high: 79780, low: 79740, close: 79770, volume: 100 },
      { time: 2, open: 79770, high: 79800, low: 79760, close: 79790, volume: 100 },
      { time: 3, open: 79790, high: 79820, low: 79780, close: 79810, volume: 100 },
    ];

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', { candles15m, candles5m });
    validBuyCustomTP = res.customTP || 0;
    validBuyCustomSL = res.customSL || 0;
    validBuyUpperBB = res.upperBB || 0;

    assert(
      res.recommendedSide === 'BUY',
      'Scenario D1.1: Valid BUY Signal Generated',
      'Valid Option A Setup',
      'recommendedSide === "BUY"',
      `recommendedSide === ${res.recommendedSide}`
    );

    assert(
      (res.riskReward || 0) >= 2.30,
      'Scenario D1.2: Valid BUY Enforces Strict 1:2.30 RR',
      'Risk-to-Reward Ratio',
      'riskReward >= 2.30',
      `riskReward === ${res.riskReward}`
    );

    assert(
      (res.customTP || 0) < (res.upperBB || 0),
      'Scenario D1.3: Pre-Reversal TP Placed Strictly BEFORE Upper BB Resistance',
      'Pre-Reversal Barrier Placement',
      `customTP (${res.customTP}) < upperBB (${res.upperBB})`,
      `customTP: ${res.customTP}, upperBB: ${res.upperBB}`
    );

    assert(
      (res.customSL || 0) < 79720,
      'Scenario D1.4: Stop Loss Has Breathing Room Beyond Lowest Invalidation Wick',
      'Breathing Room SL',
      `customSL (${res.customSL}) < 79720`,
      `customSL: ${res.customSL}, Lowest Wick: 79720`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario D2: Valid Snapback Reversal SELL
  // Deep excursion %B > 1.0, snapback close inside, upper wick >= 20%, exhaustion, RR >= 2.30
  // -------------------------------------------------------------------------
  let validSellCustomTP = 0;
  let validSellCustomSL = 0;
  let validSellEntry = 0;
  let validSellLowerBB = 0;
  {
    const candles15m: KlinePoint[] = [];
    const startTime = 1700000000;
    for (let i = 0; i < 28; i++) {
      const p = 80000 + Math.sin(i * 0.4) * 150;
      candles15m.push({
        time: startTime + i * 900,
        open: p,
        high: p + 30,
        low: p - 30,
        close: p + 10,
        volume: 100,
      });
    }
    // Bar 28: Excursion poking upper BB
    candles15m.push({
      time: startTime + 28 * 900,
      open: 80180,
      high: 80290,
      low: 80160,
      close: 80260,
      volume: 150,
    });
    // Bar 29: Red candle closing inside band with upper rejection wick & exhaustion volume
    candles15m.push({
      time: startTime + 29 * 900,
      open: 80240,
      high: 80280,
      low: 80180,
      close: 80190,
      volume: 120,
    });
    validSellEntry = 80190;

    // 5m confirming rejection
    const candles5m: KlinePoint[] = [
      { time: 1, open: 80250, high: 80280, low: 80220, close: 80230, volume: 100 },
      { time: 2, open: 80230, high: 80240, low: 80200, close: 80210, volume: 100 },
      { time: 3, open: 80210, high: 80220, low: 80180, close: 80190, volume: 100 },
    ];

    const res = whiteboardDeFiEngine.evaluateSetup('BTCUSD', { candles15m, candles5m });
    validSellCustomTP = res.customTP || 0;
    validSellCustomSL = res.customSL || 0;
    validSellLowerBB = res.lowerBB || 0;

    assert(
      res.recommendedSide === 'SELL',
      'Scenario D2.1: Valid SELL Signal Generated',
      'Valid Option A Setup',
      'recommendedSide === "SELL"',
      `recommendedSide === ${res.recommendedSide}`
    );

    assert(
      (res.riskReward || 0) >= 2.30,
      'Scenario D2.2: Valid SELL Enforces Strict 1:2.30 RR',
      'Risk-to-Reward Ratio',
      'riskReward >= 2.30',
      `riskReward === ${res.riskReward}`
    );

    assert(
      (res.customTP || 0) > (res.lowerBB || 0),
      'Scenario D2.3: Pre-Reversal TP Placed Strictly BEFORE Lower BB Support',
      'Pre-Reversal Barrier Placement',
      `customTP (${res.customTP}) > lowerBB (${res.lowerBB})`,
      `customTP: ${res.customTP}, lowerBB: ${res.lowerBB}`
    );

    assert(
      (res.customSL || 0) > 80290,
      'Scenario D2.4: Stop Loss Has Breathing Room Beyond Highest Invalidation Wick',
      'Breathing Room SL',
      `customSL (${res.customSL}) > 80290`,
      `customSL: ${res.customSL}, Highest Wick: 80290`
    );
  }

  console.log('\n--- SUITE 3: Downstream Risk Engine & AutoTrader Target Pipeline ---');

  // -------------------------------------------------------------------------
  // Scenario G1: Downstream calculateAccurateReversalTP Target Preservation (BUY)
  // Ensure that deltaAutoTrader preserves the strategy targets without double-buffering
  // -------------------------------------------------------------------------
  {
    const autoTarget = (deltaAutoTrader as any).calculateAccurateReversalTP({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: validBuyEntry,
      effectiveQuantity: 1,
      atr: 60,
      customTP: validBuyCustomTP,
      customSL: validBuyCustomSL,
    });

    assert(
      autoTarget.isValidSetup === true,
      'Scenario G1.1: Downstream Pipeline Accepts Valid BUY Setup',
      'Pipeline Integration',
      'isValidSetup === true',
      `isValidSetup === ${autoTarget.isValidSetup} (${autoTarget.rejectionReason || 'No error'})`
    );

    assert(
      autoTarget.riskRewardRatio >= 2.25,
      'Scenario G1.2: Downstream Pipeline Preserves 1:2.30 RR (>= 2.25 tolerance)',
      'Pipeline RR Preservation',
      'riskRewardRatio >= 2.25',
      `riskRewardRatio === ${autoTarget.riskRewardRatio}`
    );

    assert(
      autoTarget.takeProfitPrice <= validBuyUpperBB,
      'Scenario G1.3: TP Never Extends Past Upper BB Barrier',
      'Ceiling Constraint',
      `takeProfitPrice (${autoTarget.takeProfitPrice}) <= upperBB (${validBuyUpperBB})`,
      `takeProfitPrice: ${autoTarget.takeProfitPrice}, upperBB: ${validBuyUpperBB}`
    );

    assert(
      autoTarget.stopLossPrice === validBuyCustomSL,
      'Scenario G1.4: SL Breathing Room Preserved Exactly',
      'SL Preservation',
      `stopLossPrice (${autoTarget.stopLossPrice}) === customSL (${validBuyCustomSL})`,
      `stopLossPrice: ${autoTarget.stopLossPrice}, customSL: ${validBuyCustomSL}`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario G2: Downstream calculateAccurateReversalTP Target Preservation (SELL)
  // -------------------------------------------------------------------------
  {
    const autoTarget = (deltaAutoTrader as any).calculateAccurateReversalTP({
      symbol: 'BTCUSD',
      side: 'SELL',
      entryPrice: validSellEntry,
      effectiveQuantity: 1,
      atr: 60,
      customTP: validSellCustomTP,
      customSL: validSellCustomSL,
    });

    assert(
      autoTarget.isValidSetup === true,
      'Scenario G2.1: Downstream Pipeline Accepts Valid SELL Setup',
      'Pipeline Integration',
      'isValidSetup === true',
      `isValidSetup === ${autoTarget.isValidSetup} (${autoTarget.rejectionReason || 'No error'})`
    );

    assert(
      autoTarget.riskRewardRatio >= 2.25,
      'Scenario G2.2: Downstream Pipeline Preserves 1:2.30 RR for SELL',
      'Pipeline RR Preservation',
      'riskRewardRatio >= 2.25',
      `riskRewardRatio === ${autoTarget.riskRewardRatio}`
    );

    assert(
      autoTarget.takeProfitPrice >= validSellLowerBB,
      'Scenario G2.3: SELL TP Never Drops Below Lower BB Floor',
      'Floor Constraint',
      `takeProfitPrice (${autoTarget.takeProfitPrice}) >= lowerBB (${validSellLowerBB})`,
      `takeProfitPrice: ${autoTarget.takeProfitPrice}, lowerBB: ${validSellLowerBB}`
    );

    assert(
      autoTarget.stopLossPrice === validSellCustomSL,
      'Scenario G2.4: SELL SL Breathing Room Preserved Exactly',
      'SL Preservation',
      `stopLossPrice (${autoTarget.stopLossPrice}) === customSL (${validSellCustomSL})`,
      `stopLossPrice: ${autoTarget.stopLossPrice}, customSL: ${validSellCustomSL}`
    );
  }

  console.log('\n--- SUITE 4: Strategy Registry Port Routing & Trend Shield Parity ---');

  // -------------------------------------------------------------------------
  // Scenario H1: Port 3025 Registry Dispatch
  // -------------------------------------------------------------------------
  {
    const candles15m: KlinePoint[] = [];
    const startTime = 1700000000;
    for (let i = 0; i < 28; i++) {
      const p = 80000 + Math.sin(i * 0.4) * 150;
      candles15m.push({
        time: startTime + i * 900,
        open: p,
        high: p + 30,
        low: p - 30,
        close: p + 10,
        volume: 100,
      });
    }
    candles15m.push({
      time: startTime + 28 * 900,
      open: 79820,
      high: 79840,
      low: 79720,
      close: 79750,
      volume: 150,
    });
    candles15m.push({
      time: startTime + 29 * 900,
      open: 79760,
      high: 79820,
      low: 79730,
      close: 79810,
      volume: 350,
    });

    const stratOutput = evaluateStrategyForPort('3025', 'BTCUSD', candles15m, {});
    assert(
      stratOutput.signal === 'BUY',
      'Scenario H1.1: Port 3025 Registry Returns BUY for Valid Setup',
      'Registry Routing',
      'signal === "BUY"',
      `signal === ${stratOutput.signal}`
    );

    assert(
      stratOutput.strategyName.includes('Whiteboard Crypto DeFi AMM'),
      'Scenario H1.2: Correct Strategy Named Assigned',
      'Registry Naming',
      'strategyName contains "Whiteboard Crypto DeFi AMM"',
      `strategyName === "${stratOutput.strategyName}"`
    );

    assert(
      stratOutput.customTP !== undefined && stratOutput.customSL !== undefined,
      'Scenario H1.3: Custom TP & SL Successfully Forwarded',
      'Target Forwarding',
      'customTP & customSL defined',
      `customTP: ${stratOutput.customTP}, customSL: ${stratOutput.customSL}`
    );
  }

  // -------------------------------------------------------------------------
  // Scenario H2: Trend Shield Does NOT Block Whiteboard AMM Snapbacks on Port 3025
  // (Even when market is in downtrend, mean reversion from extreme band is permitted)
  // -------------------------------------------------------------------------
  {
    const candles15m: KlinePoint[] = [];
    const startTime = 1700000000;
    for (let i = 0; i < 28; i++) {
      const p = 80000 + Math.sin(i * 0.4) * 150;
      candles15m.push({
        time: startTime + i * 900,
        open: p,
        high: p + 30,
        low: p - 30,
        close: p + 10,
        volume: 100,
      });
    }
    // Impose gentle downtrend so currPrice < ema50
    for (let i = 0; i < candles15m.length; i++) {
      candles15m[i].close -= i * 3;
      candles15m[i].open -= i * 3;
      candles15m[i].high -= i * 3;
      candles15m[i].low -= i * 3;
    }
    candles15m.push({
      time: startTime + 28 * 900,
      open: 79720,
      high: 79740,
      low: 79600,
      close: 79650,
      volume: 150,
    });
    candles15m.push({
      time: startTime + 29 * 900,
      open: 79660,
      high: 79730,
      low: 79620,
      close: 79710,
      volume: 400,
    });

    const stratOutput = evaluateStrategyForPort('3025', 'BTCUSD', candles15m, {});
    const isVetoedByTrendShield = (stratOutput.reasons || []).some((r: string) => r.includes('Strong Bear Dump Shield'));
    assert(
      !isVetoedByTrendShield,
      'Scenario H2: Trend Shield Whitelist - Mean Reversion Snapback NOT Blocked on Port 3025',
      'Trend Shield Parity',
      'isVetoedByTrendShield === false',
      `isVetoedByTrendShield === ${isVetoedByTrendShield} (Reasons: ${stratOutput.reasons?.join(', ') || 'None'})`
    );
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n========================================================================');
  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;

  console.log(`📊 EMPIRICAL STRESS TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (Total: ${totalTests})`);
  console.log('========================================================================');

  if (failedTests > 0) {
    console.error(`\n❌ ${failedTests} EMPIRICAL CHALLENGES FAILED!`);
    process.exit(1);
  } else {
    console.log('\n🎉 ALL EMPIRICAL STRESS TESTS PASSED PERFECTLY! ZERO DEGRADED TRADES OBSERVED.');
  }
}

runEmpiricalStressTests().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
