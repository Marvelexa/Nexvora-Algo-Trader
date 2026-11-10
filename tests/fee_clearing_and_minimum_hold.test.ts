import assert from 'assert';
import { ReversalProximityFlipper } from '../lib/risk/reversalProximityFlipper';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

console.log('🧪 Starting Fee-Clearing & Minimum Hold Time Floor Tests...');

function generate15mRangeCandles(support: number, resistance: number, curPrice: number): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
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
  candles[10].low = support;
  candles[25].high = resistance;
  const prevP = resistance - 0.0006;
  candles.push({
    time: baseTime + (56 * 900000),
    open: prevP,
    high: resistance + 0.0001,
    low: resistance - 0.0008,
    close: resistance - 0.0002,
    volume: 5000,
  });
  candles.push({
    time: baseTime + (57 * 900000),
    open: curPrice - 0.0001,
    high: resistance + 0.0001, // sweeps above resistance
    low: curPrice - 0.0003,
    close: curPrice,
    volume: 8000,
  });
  return candles;
}

// ----------------------------------------------------------------------------
// TEST 1: Holding Time Floor (< 180s) strictly BLOCKS mid-trade auto-flip
// ----------------------------------------------------------------------------
{
  const support = 76000;
  const resistance = 78000;
  const currentPrice = 77800;
  const atr = 500;

  // Position opened 20 seconds ago (micro-trade scenario)
  const pos: DeltaPosition = {
    id: 'pos-btc-young',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 77750,
    currentPrice: 77800,
    quantity: 0.016,
    marginUSD: 41.47,
    notionalUSD: 1244,
    leverage: 30,
    takeProfitPrice: 78669,
    stopLossPrice: 76989,
    atr,
    isBreakevenLocked: false,
    pnlUSD: 0.80,
    pnlPercent: 1.9,
    entryTime: Date.now() - 20000, // Only 20 seconds old!
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
  };

  const candles15m = generate15mRangeCandles(support, resistance, currentPrice);
  const candles1m: KlinePoint[] = [
    { time: 1000, open: 77790, high: 77810, low: 77785, close: 77800, volume: 100 },
  ];

  const verdict = ReversalProximityFlipper.evaluateMidTradeAutoFlip({
    position: pos,
    currentPrice,
    atr,
    candles15m,
    candles1m,
    decimals: 2,
  });

  assert.strictEqual(verdict.shouldCloseCurrent, false, 'Expected trade under 180s hold time to NOT be closed!');
  assert.strictEqual(verdict.shouldAutoReverse, false, 'Expected no auto-reverse under 180s hold time');
  assert(verdict.reason.includes('Holding time floor not met'), `Expected hold time floor reason, got: ${verdict.reason}`);

  console.log(`✅ Test 1 Passed: 20-second young trade strictly shielded from premature auto-flip (${verdict.reason})`);
}

// ----------------------------------------------------------------------------
// TEST 2: Fee-Shield Floor strictly BLOCKS micro-profit exit (< $3.50 or < 0.40%)
// ----------------------------------------------------------------------------
{
  const support = 76000;
  const resistance = 78000;
  const currentPrice = 77771.38;
  const atr = 500;

  // Trade opened 4 minutes ago, but only made +$0.35 USD (0.027% move)
  const pos: DeltaPosition = {
    id: 'pos-btc-micro',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 77749.5,
    currentPrice: 77771.38,
    quantity: 0.016,
    marginUSD: 41.47,
    notionalUSD: 1244,
    leverage: 30,
    takeProfitPrice: 78669,
    stopLossPrice: 76989,
    atr,
    isBreakevenLocked: false,
    pnlUSD: 0.35, // Only $0.35 profit! Exchange round-trip fee is $1.24!
    pnlPercent: 0.84,
    entryTime: Date.now() - 240000, // 4 minutes old (hold time met)
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
  };

  const candles15m = generate15mRangeCandles(support, resistance, currentPrice);
  const candles1m: KlinePoint[] = [
    { time: 1000, open: 77775, high: 77800, low: 77770, close: 77771.38, volume: 100 },
  ];

  const verdict = ReversalProximityFlipper.evaluateMidTradeAutoFlip({
    position: pos,
    currentPrice,
    atr,
    candles15m,
    candles1m,
    decimals: 2,
  });

  assert.strictEqual(verdict.shouldCloseCurrent, false, 'Expected micro-profit trade to NOT be closed!');
  assert.strictEqual(verdict.shouldAutoReverse, false, 'Expected no auto-reverse when fee-shield floor fails');
  assert(verdict.reason.includes('Fee-shield floor not met'), `Expected fee-shield reason, got: ${verdict.reason}`);

  console.log(`✅ Test 2 Passed: Micro-profit trade (+$0.35 USD) strictly shielded from fee-eating close (${verdict.reason})`);
}

// ----------------------------------------------------------------------------
// TEST 3: Substantial Profit + Sufficient Hold Time PERMITS Reversal Auto-Flip
// ----------------------------------------------------------------------------
{
  const support = 76000;
  const resistance = 78000;
  const currentPrice = 77950;
  const atr = 500;

  // Trade opened 5 minutes ago with +$8.50 USD profit (0.90% move, well above $1.24 fee)
  const pos: DeltaPosition = {
    id: 'pos-btc-valid',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 77250,
    currentPrice: 77950,
    quantity: 0.016,
    marginUSD: 41.47,
    notionalUSD: 1244,
    leverage: 30,
    takeProfitPrice: 78500,
    stopLossPrice: 76500,
    atr,
    isBreakevenLocked: true,
    pnlUSD: 11.20, // +$11.20 profit! >> $1.24 fee
    pnlPercent: 27.0,
    entryTime: Date.now() - 300000, // 5 minutes old
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
  };

  const candles15m = generate15mRangeCandles(support, resistance, currentPrice);
  // Upper rejection wick: high=78050, open=77940, close=77950. Span=150, upper wick=100 (66.7%)
  const candles1m: KlinePoint[] = [
    { time: 1000, open: 77940, high: 78050, low: 77900, close: 77950, volume: 100 },
  ];

  const verdict = ReversalProximityFlipper.evaluateMidTradeAutoFlip({
    position: pos,
    currentPrice,
    atr,
    candles15m,
    candles1m,
    decimals: 2,
  });

  assert.strictEqual(verdict.shouldCloseCurrent, true, 'Expected valid profitable trade at resistance to close');
  assert.strictEqual(verdict.shouldAutoReverse, true, 'Expected auto-reverse to SELL');
  assert.strictEqual(verdict.reverseSide, 'SELL', 'Expected reverse side to be SELL');
  assert(verdict.reason.includes('Closed Long with profit $11.20'), `Got: ${verdict.reason}`);

  console.log(`✅ Test 3 Passed: Profitable trade (+$11.20 USD, 5m hold) allowed to bank profit and auto-flip`);
}

// ----------------------------------------------------------------------------
// TEST 4: Structural Take Profit Geometry Guarantees Fee-Clearing Move
// ----------------------------------------------------------------------------
{
  const entryPrice = 77750;
  const stopLossPrice = 76989; // -0.98% ($761 dist)
  const takeProfitPrice = 77800; // Inverted micro TP (+0.06% = $50)

  const validated = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    atr: 500,
    isPostFill: false,
    tickSize: 0.1,
    decimals: 1,
  });

  const tpMovePct = Math.abs(validated.takeProfitPrice - entryPrice) / entryPrice;
  const projectedGrossProfitUSD = 0.016 * Math.abs(validated.takeProfitPrice - entryPrice);

  assert(tpMovePct >= 0.0050, `Expected TP move >= 0.50%, got ${(tpMovePct * 100).toFixed(2)}%`);
  assert(validated.actualRR >= 1.15, `Expected actualRR >= 1.15, got ${validated.actualRR}`);
  assert(projectedGrossProfitUSD >= 6.00, `Expected projected profit >= $6.00 USD, got $${projectedGrossProfitUSD.toFixed(2)}`);

  console.log(`✅ Test 4 Passed: Structural TP enforced at $${validated.takeProfitPrice} (Move: ${(tpMovePct * 100).toFixed(2)}%, RR: 1:${validated.actualRR.toFixed(2)}, Gross Profit: +$${projectedGrossProfitUSD.toFixed(2)} USD >> $1.24 fee)`);
}

console.log('\n🎉 ALL 4/4 FEE-CLEARING & MINIMUM HOLD TIME TESTS PASSED PERFECTLY!\n');
