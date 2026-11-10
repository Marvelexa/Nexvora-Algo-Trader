import assert from 'assert';
import { ReversalProximityFlipper } from '../lib/risk/reversalProximityFlipper';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

console.log('🧪 Starting Reversal Proximity Polarity Flipper Tests (Video Skn0eSmryO8)...');

// Helper to create synthetic 15m candles
function generate15mRangeCandles(support: number, resistance: number, curPrice: number): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  
  // Create 60 candles oscillating strictly between 20% and 80% of range
  for (let i = 0; i < 55; i++) {
    const fraction = 0.20 + 0.60 * ((i % 10) / 10);
    const p = support + (resistance - support) * fraction;
    candles.push({
      time: baseTime + (i * 900000),
      open: p,
      high: p + 0.0002,
      low: p - 0.0002,
      close: p + 0.0001,
      volume: 1000,
    });
  }

  // Ensure exact major support and resistance exist in history
  candles[10].low = support;
  candles[25].high = resistance;

  // Add the last 2 candles demonstrating a sweep of support
  const prevP = support + 0.0006;
  candles.push({
    time: baseTime + (56 * 900000),
    open: prevP,
    high: prevP + 0.0004,
    low: support - 0.0001, // sweeps below support!
    close: support + 0.0002, // closes back inside!
    volume: 5000,
  });

  // Current live bar at curPrice with a lower rejection wick >= 35%
  // Span = 0.0008, lower wick = 0.0004 (50%)
  candles.push({
    time: baseTime + (57 * 900000),
    open: curPrice + 0.0001,
    high: curPrice + 0.0003,
    low: support - 0.0001, // sweep wick
    close: curPrice,
    volume: 8000,
  });

  return candles;
}

// ----------------------------------------------------------------------------
// TEST 1: ADAUSD Exact Scenario - Flip Late SELL -> BUY at Bottom Support
// ----------------------------------------------------------------------------
{
  const support = 0.18618;
  const resistance = 0.18997;
  const currentPrice = 0.18650; // At bottom 8% of the range!
  const atr = 0.0006;

  const candles = generate15mRangeCandles(support, resistance, currentPrice);

  const verdict = ReversalProximityFlipper.evaluateProximityFlip({
    symbol: 'ADAUSD',
    side: 'SELL', // Strategy requested late SHORT at bottom!
    currentPrice,
    atr,
    candles15m: candles,
    decimals: 5,
  });

  assert.strictEqual(verdict.isFlipped, true, 'Expected trade to be flipped');
  assert.strictEqual(verdict.originalSide, 'SELL', 'Original side should be SELL');
  assert.strictEqual(verdict.executedSide, 'BUY', 'Executed side MUST be flipped to BUY!');
  assert.strictEqual(verdict.reversalTag, 'ULTA_SUPPORT_SWEEP_BUY', 'Expected ULTA_SUPPORT_SWEEP_BUY tag');

  // Stop Loss must be placed below the sweep wick (support - 0.0001 - buffer)
  assert(verdict.stopLossPrice < support, `Stop loss ($${verdict.stopLossPrice}) must be below support ($${support})`);
  // TP1 must be at the 50% equilibrium (~0.18807)
  const expectedEq = support + ((resistance - support) * 0.5);
  assert(Math.abs(verdict.tp1Price - expectedEq) < 0.0002, `TP1 ($${verdict.tp1Price}) should be near 50% equilibrium ($${expectedEq})`);
  // High R:R expected
  assert(verdict.actualRR >= 1.15, `Actual RR (${verdict.actualRR}) must be >= 1.15`);

  console.log(`✅ Test 1 Passed: ADAUSD late SELL at $${currentPrice} successfully flipped to BUY (SL: $${verdict.stopLossPrice}, TP1: $${verdict.tp1Price}, RR 1:${verdict.actualRR})`);
}

// ----------------------------------------------------------------------------
// TEST 2: Top Resistance Scenario - Flip Late BUY -> SELL at Top Resistance
// ----------------------------------------------------------------------------
{
  const support = 0.18618;
  const resistance = 0.18997;
  const currentPrice = 0.18970; // At top 93% of the range!
  const atr = 0.0006;

  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < 55; i++) {
    candles.push({
      time: baseTime + (i * 900000),
      open: 0.1880,
      high: 0.1885,
      low: 0.1875,
      close: 0.1880,
      volume: 1000,
    });
  }
  candles[5].low = support;
  candles[20].high = resistance;

  // Candle sweeping resistance with an upper rejection wick
  candles.push({
    time: baseTime + (56 * 900000),
    open: currentPrice - 0.0001,
    high: resistance + 0.0002, // sweep above resistance!
    low: currentPrice - 0.0003,
    close: currentPrice, // closes back down with upper wick
    volume: 5000,
  });

  const verdict = ReversalProximityFlipper.evaluateProximityFlip({
    symbol: 'ADAUSD',
    side: 'BUY', // Strategy requested late BUY at ceiling!
    currentPrice,
    atr,
    candles15m: candles,
    decimals: 5,
  });

  assert.strictEqual(verdict.isFlipped, true, 'Expected trade to be flipped at resistance');
  assert.strictEqual(verdict.executedSide, 'SELL', 'Executed side MUST be flipped to SELL!');
  assert.strictEqual(verdict.reversalTag, 'ULTA_RESISTANCE_SWEEP_SELL');
  assert(verdict.stopLossPrice > resistance, `Stop loss ($${verdict.stopLossPrice}) must be above resistance ($${resistance})`);
  assert(verdict.actualRR >= 1.15, `Actual RR (${verdict.actualRR}) must be >= 1.15`);

  console.log(`✅ Test 2 Passed: Late BUY at ceiling $${currentPrice} successfully flipped to SELL (SL: $${verdict.stopLossPrice}, TP1: $${verdict.tp1Price})`);
}

// ----------------------------------------------------------------------------
// TEST 3: Liquidity Run Rule - Allow Short Continuation on Full Displacement
// ----------------------------------------------------------------------------
{
  const support = 100;
  const resistance = 120;
  const atr = 2.0;

  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < 50; i++) {
    candles.push({
      time: baseTime + (i * 900000),
      open: 110,
      high: 112,
      low: 108,
      close: 110,
      volume: 1000,
    });
  }
  candles[5].low = support;
  candles[10].high = resistance;

  // Candle i-2
  candles.push({ time: baseTime + 51 * 900000, open: 102, high: 103, low: 101, close: 101.5, volume: 1000 });
  // Candle i-1 (Breakout bar with huge down displacement closing at 97 < 100)
  candles.push({ time: baseTime + 52 * 900000, open: 101.5, high: 101.5, low: 96, close: 96.5, volume: 8000 });
  // Candle i (Creating an FVG with candle i-2: high 98 < candle[51].low 101)
  candles.push({ time: baseTime + 53 * 900000, open: 96.5, high: 98, low: 96, close: 97.5, volume: 4000 });

  const verdict = ReversalProximityFlipper.evaluateProximityFlip({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 97.5,
    atr,
    candles15m: candles,
  });

  assert.strictEqual(verdict.isLiquidityRunBreakout, true, 'Expected confirmed Liquidity Run breakout');
  assert.strictEqual(verdict.isFlipped, false, 'Should NOT flip a confirmed Liquidity Run breakout');
  assert.strictEqual(verdict.executedSide, 'SELL', 'Short continuation should be preserved');

  console.log(`✅ Test 3 Passed: Confirmed Liquidity Run breakout preserves Short continuation`);
}

// ----------------------------------------------------------------------------
// TEST 4: Live Mid-Trade Auto-Flip (Open Short Hits Support & Prints Rejection Wick)
// ----------------------------------------------------------------------------
{
  const support = 0.18618;
  const resistance = 0.18997;
  const currentPrice = 0.18630;
  const atr = 0.0006;

  const pos: DeltaPosition = {
    id: 'pos-short-ada',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.18800,
    currentPrice: 0.18630,
    quantity: 5000,
    marginUSD: 30,
    notionalUSD: 900,
    leverage: 30,
    takeProfitPrice: 0.18300,
    stopLossPrice: 0.19015,
    atr,
    isBreakevenLocked: true,
    pnlUSD: 8.5,
    pnlPercent: 28.3,
    entryTime: Date.now() - 250000, // 250s ago (exceeds 180s holding time floor)
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
  };

  const candles15m = generate15mRangeCandles(support, resistance, currentPrice);
  const candles1m: KlinePoint[] = [
    { time: 1000, open: 0.1866, high: 0.1867, low: 0.18610, close: 0.18630, volume: 1000 },
  ];

  const autoFlip = ReversalProximityFlipper.evaluateMidTradeAutoFlip({
    position: pos,
    currentPrice,
    atr,
    candles15m,
    candles1m,
    decimals: 5,
  });

  assert.strictEqual(autoFlip.shouldCloseCurrent, true, 'Expected open Short to close at support wall');
  assert.strictEqual(autoFlip.shouldAutoReverse, true, 'Expected auto-reverse to Long');
  assert.strictEqual(autoFlip.reverseSide, 'BUY', 'Reverse side must be BUY');
  assert(autoFlip.reversalSL < support, `Reversal SL ($${autoFlip.reversalSL}) must be below support wick`);

  console.log(`✅ Test 4 Passed: Mid-trade auto-flip closes open Short at support and triggers BUY (SL: $${autoFlip.reversalSL}, TP: $${autoFlip.reversalTP})`);
}

// ----------------------------------------------------------------------------
// TEST 5: Integration with UniversalTradeGuard.evaluatePreTradeGate
// ----------------------------------------------------------------------------
{
  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('NEUTRAL');

  const support = 0.18618;
  const resistance = 0.18997;
  const currentPrice = 0.18650;
  const atr = 0.0006;
  const candles = generate15mRangeCandles(support, resistance, currentPrice);

  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'ADAUSD',
    side: 'SELL', // Engine requested SELL
    currentPrice,
    accountCapitalUSD: 193.0,
    candles15m: candles,
    atr,
    activePositions: [],
    leverage: 30,
    decimals: 5,
  });

  assert.strictEqual(verdict.allowed, true, 'Expected trade guard approval');
  assert.strictEqual(verdict.isFlipped, true, 'Expected trade to be marked as flipped');
  assert.strictEqual(verdict.executedSide, 'BUY', 'Executed side must be BUY!');
  assert.strictEqual(verdict.reversalTag, 'ULTA_SUPPORT_SWEEP_BUY');
  assert(verdict.stopLossPrice < support, 'SL must be below support');
  assert(verdict.takeProfitPrice > currentPrice, 'TP must be above entry for BUY');

  console.log(`✅ Test 5 Passed: UniversalTradeGuard approved Polarity Flip: Inverted SELL ➔ BUY (SL: $${verdict.stopLossPrice}, TP: $${verdict.takeProfitPrice}, RR 1:${verdict.actualRR})`);
}

console.log('\n🎉 ALL 5/5 REVERSAL PROXIMITY POLARITY FLIPPER TESTS PASSED PERFECTLY!\n');
