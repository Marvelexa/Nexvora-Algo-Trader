import assert from 'assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

console.log('🧪 Starting Universal Trade Guard Unit & Integration Tests...');

// Helper to generate synthetic candles
function createCandles(count: number, basePrice: number, step: number = 0): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < count; i++) {
    const p = basePrice + (i * step);
    candles.push({
      time: baseTime + (i * 900000),
      open: p,
      high: p + 1.0,
      low: p - 1.0,
      close: p + 0.2,
      volume: 1000,
    });
  }
  return candles;
}

// ----------------------------------------------------------------------------
// TEST 1: Anti-Chase Filter (Reject Short into Bottom Support)
// ----------------------------------------------------------------------------
{
  const candles = createCandles(60, 100, 0);
  candles[20].low = 90; // Swing low at 90
  const atr = 5.0; // 0.35 * atr = 1.75
  const currentPrice = 91.0; // Within 1.0 of swing low (<= 1.75 threshold)

  const res = UniversalTradeGuard.validateAntiChase({
    symbol: 'BTCUSD',
    side: 'SELL',
    currentPrice,
    candles15m: candles,
    atr,
  });

  assert.strictEqual(res.allowed, false, 'Expected Anti-Chase to block short into bottom support');
  assert(res.reason.includes('ANTI-CHASE VETO'), `Expected veto reason, got: ${res.reason}`);
  console.log('✅ Test 1 Passed: Anti-Chase blocks selling near bottom support');
}

// ----------------------------------------------------------------------------
// TEST 2: Anti-Chase Filter (Reject Long into Top Ceiling)
// ----------------------------------------------------------------------------
{
  const candles = createCandles(60, 100, 0);
  candles[20].high = 110; // Swing high at 110
  const atr = 5.0; // 0.35 * atr = 1.75
  const currentPrice = 109.0; // Within 1.0 of swing high (<= 1.75 threshold)

  const res = UniversalTradeGuard.validateAntiChase({
    symbol: 'BTCUSD',
    side: 'BUY',
    currentPrice,
    candles15m: candles,
    atr,
  });

  assert.strictEqual(res.allowed, false, 'Expected Anti-Chase to block buy into top resistance');
  assert(res.reason.includes('ANTI-CHASE VETO'), `Expected veto reason, got: ${res.reason}`);
  console.log('✅ Test 2 Passed: Anti-Chase blocks buying near top resistance');
}

// ----------------------------------------------------------------------------
// TEST 3: Anti-Chase Filter (Reject 3 Consecutive Dumping Red Bars)
// ----------------------------------------------------------------------------
{
  const candles = createCandles(20, 100, 0);
  candles[0].low = 70; // Keep support far away at 70 so 3-bar check is isolated
  // Add 3 consecutive red dumping candles
  candles.push({ time: 1000, open: 98, high: 98.5, low: 95, close: 95.5, volume: 100 });
  candles.push({ time: 2000, open: 95.5, high: 96, low: 93, close: 93.5, volume: 100 });
  candles.push({ time: 3000, open: 93.5, high: 94, low: 90, close: 90.5, volume: 100 });

  const res = UniversalTradeGuard.validateAntiChase({
    symbol: 'ADAUSD',
    side: 'SELL',
    currentPrice: 90.5,
    candles15m: candles,
    atr: 2.0,
  });

  assert.strictEqual(res.allowed, false, 'Expected Anti-Chase to block 3-bar dump chase');
  assert(res.reason.includes('3 consecutive red dumping candles'), `Got: ${res.reason}`);
  console.log('✅ Test 3 Passed: Anti-Chase blocks chasing 3-bar dump');
}

// ----------------------------------------------------------------------------
// TEST 4: Room-to-Run Filter (Reject if Opposing Reversal Barrier < 1.15 * SL)
// ----------------------------------------------------------------------------
{
  const entryPrice = 100;
  const slDistance = 2.0; // Required room: 2.0 * 1.15 = 2.30
  const targetPrice = 98.5; // Only 1.50 away for SHORT (< 2.30)

  const roomCheck = UniversalTradeGuard.validateRoomToRun({
    symbol: 'SOLUSD',
    entryPrice,
    side: 'SELL',
    slDistance,
    targetPrice,
  });

  assert.strictEqual(roomCheck.allowed, false, 'Expected room-to-run rejection');
  assert(roomCheck.reason.includes('INSUFFICIENT_REVERSAL_ROOM_VETO') || roomCheck.reason.includes('ROOM-TO-RUN VETO'), `Got: ${roomCheck.reason}`);
  console.log('✅ Test 4 Passed: Room-to-run rejects trade when reversal wall is closer than 1.05R');
}

// ----------------------------------------------------------------------------
// TEST 5: Sweep-Proof Stop-Loss Placement (Strictly beyond 3-5 candle wicks)
// ----------------------------------------------------------------------------
{
  const candles = createCandles(15, 0.1860, 0);
  for (const c of candles) { c.high = 0.1865; c.low = 0.1855; }
  // Place high wick within structural limits at 0.18780 (0.54% above entry)
  candles[candles.length - 3].high = 0.18780;
  const atr = 0.0004; // 0.10 * atr = 0.00004
  const entryPrice = 0.18679;

  const slResult = UniversalTradeGuard.calculateSweepProofSL({
    side: 'SELL',
    entryPrice,
    atr,
    candles15m: candles,
    decimals: 5,
  });

  // Stop Loss MUST be strictly above the 0.18780 wick and capped <= 0.85%!
  assert(slResult.stopLossPrice > 0.18780, `Expected SL > 0.18780 wick, got ${slResult.stopLossPrice}`);
  assert(slResult.slDistance <= entryPrice * 0.0085, `SL distance (${slResult.slDistance}) must be <= 0.85%`);
  console.log(`✅ Test 5 Passed: Sweep-Proof SL placed at $${slResult.stopLossPrice} strictly above 0.18780 wick`);
}

// ----------------------------------------------------------------------------
// TEST 6: Position Sizing with Strict 1%-2% Capital Risk Cap
// ----------------------------------------------------------------------------
{
  const accountCapitalUSD = 193.0; // User's capital
  const entryPrice = 0.18679;
  const slDistance = 0.00336; // 0.19015 - 0.18679

  const sizing = UniversalTradeGuard.calculatePositionSize({
    accountCapitalUSD,
    entryPrice,
    slDistance,
    leverage: 30,
    riskPct: 0.02, // 2% max risk
  });

  const maxLoss = sizing.quantity * slDistance;
  assert(maxLoss <= accountCapitalUSD * 0.021, `Max loss ($${maxLoss}) exceeded 2% risk cap`);
  assert(sizing.riskCapUSD <= 3.86 + 0.01, `Expected risk cap <= $3.86`);
  console.log(`✅ Test 6 Passed: Position sized to ${sizing.quantity} contracts with max loss capped at $${maxLoss.toFixed(2)} USD (<= 2%)`);
}

// ----------------------------------------------------------------------------
// TEST 7: Universal Live Profit Lock (+0.45R Fee-Plus Breakeven)
// ----------------------------------------------------------------------------
{
  const pos: DeltaPosition = {
    id: 'test-1',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.18679,
    currentPrice: 0.18520, // In profit
    quantity: 1000,
    marginUSD: 20,
    notionalUSD: 600,
    leverage: 30,
    takeProfitPrice: 0.18200,
    stopLossPrice: 0.19015,
    initialStopLossPrice: 0.19015,
    atr: 0.0004,
    isBreakevenLocked: false,
    pnlUSD: 1.59,
    pnlPercent: 7.95,
    entryTime: Date.now(),
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
    ratchetStage: 0,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.18520, // +0.47R profit
    atr: 0.0004,
    decimals: 5,
  });

  assert.strictEqual(action.updateBrackets, true, 'Expected brackets to update');
  assert.strictEqual(action.ratchetStage, 1, 'Expected ratchetStage 1');
  assert(action.newStopLossPrice < pos.entryPrice, 'Expected SL to move into profit (below entry for Short)');
  console.log(`✅ Test 7 Passed: Stage 1 fee shield triggered at +0.47R, SL moved to $${action.newStopLossPrice}`);
}

// ----------------------------------------------------------------------------
// TEST 8: Universal Live Profit Lock (+0.80R Ratchet locks 65% of peak profit)
// ----------------------------------------------------------------------------
{
  const pos: DeltaPosition = {
    id: 'test-2',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.18679,
    currentPrice: 0.18380, // deep in profit (+0.88R)
    quantity: 1000,
    marginUSD: 20,
    notionalUSD: 600,
    leverage: 30,
    takeProfitPrice: 0.18200,
    stopLossPrice: 0.19015,
    initialStopLossPrice: 0.19015,
    atr: 0.0004,
    isBreakevenLocked: true,
    pnlUSD: 2.99,
    pnlPercent: 14.95,
    entryTime: Date.now(),
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
    ratchetStage: 1,
    peakPriceReached: 0.18380,
    peakRReached: 0.88,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.18380,
    atr: 0.0004,
    decimals: 5,
  });

  assert.strictEqual(action.updateBrackets, true, 'Expected Stage 2 ratchet update');
  assert.strictEqual(action.ratchetStage, 2, 'Expected ratchetStage 2');
  // Tier 2 locks runner SL at +0.35R in profit (0.18679 - 0.35*0.00336 = 0.18561)
  assert.strictEqual(action.newStopLossPrice, 0.18561, `Expected SL at +0.35R ($0.18561), got ${action.newStopLossPrice}`);
  console.log(`✅ Test 8 Passed: Tier 2 cash bank triggered at +0.88R, runner SL locked at +0.35R ($${action.newStopLossPrice})`);
}

// ----------------------------------------------------------------------------
// TEST 9: Universal Live Candle Reversal (Pinbar Rejection Wick >= 55% closes 100%)
// ----------------------------------------------------------------------------
{
  const pos: DeltaPosition = {
    id: 'test-3',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.18679,
    currentPrice: 0.18500, // In profit (+0.53R)
    quantity: 1000,
    marginUSD: 20,
    notionalUSD: 600,
    leverage: 30,
    takeProfitPrice: 0.18200,
    stopLossPrice: 0.19015,
    initialStopLossPrice: 0.19015,
    atr: 0.0004,
    isBreakevenLocked: false,
    pnlUSD: 1.79,
    pnlPercent: 8.95,
    entryTime: Date.now(),
    strategyName: 'TEST',
    shadowConfirmedSeconds: 15,
    ratchetStage: 0,
  };

  // 1m candle with lower rejection wick: low=0.1840, open=0.1849, close=0.1850, high=0.1851
  // Span = 0.0011, lower wick = 0.1849 - 0.1840 = 0.0009 (81.8% wick opposing Short!)
  const candles1m: KlinePoint[] = [
    { time: 1000, open: 0.1855, high: 0.1856, low: 0.1848, close: 0.1849, volume: 100 },
    { time: 2000, open: 0.1849, high: 0.1851, low: 0.1840, close: 0.1850, volume: 200 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.18500,
    candles1m,
    atr: 0.0004,
  });

  assert.strictEqual(action.shouldClose100, true, 'Expected 100% close on reversal pinbar');
  assert(action.closeReason.includes('LIVE REVERSAL CLOSE'), `Got: ${action.closeReason}`);
  console.log(`✅ Test 9 Passed: Live reversal pinbar (82% opposing wick) triggered 100% market close`);
}

// ----------------------------------------------------------------------------
// TEST 10: Complete Pre-Trade Gate Interception (Approved Setup)
// ----------------------------------------------------------------------------
{
  const candles = createCandles(60, 100, -0.15); // Consistent downtrend (Bearish structure)
  // Overhead Order block supply at 101
  candles[20].open = 101.0;
  candles[20].close = 100.5;
  candles[20].high = 101.5;
  candles[20].low = 100.0;
  candles[21].close = 98.0;
  candles[21].low = 97.5;
  candles[22].close = 97.0;

  // Below-market demand floor at 85
  candles[10].open = 85.5;
  candles[10].close = 86.0;
  candles[10].low = 85.0;
  candles[10].high = 86.2;

  // Pullback up (green candle) followed by rejection breakdown (not 3 red bars)
  const lastIdx = candles.length - 1;
  candles[lastIdx - 2].open = 92.2;
  candles[lastIdx - 2].high = 92.8;
  candles[lastIdx - 2].low = 92.0;
  candles[lastIdx - 2].close = 92.6; // Green pullback candle

  candles[lastIdx - 1].open = 92.6;
  candles[lastIdx - 1].high = 92.7;
  candles[lastIdx - 1].low = 92.3;
  candles[lastIdx - 1].close = 92.4;

  candles[lastIdx].open = 93.0;
  candles[lastIdx].high = 93.1;
  candles[lastIdx].low = 91.8;
  candles[lastIdx].close = 92.2;

  // Set regime to BEARISH to align with SELL signal
  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('BEARISH');

  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 92.0,
    accountCapitalUSD: 193.0,
    candles15m: candles,
    atr: 1.5,
    activePositions: [],
    leverage: 30,
    decimals: 4,
  });

  assert.strictEqual(verdict.allowed, true, `Expected pre-trade gate to approve setup, got reason: ${verdict.reason}`);
  assert(verdict.actualRR >= 1.05, `Actual RR (${verdict.actualRR}) must be >= 1.05`);
  assert(verdict.stopLossPrice > 92.0, `SL must be above entry for Short`);
  assert(verdict.takeProfitPrice < 92.0, `TP must be below entry for Short`);
  console.log(`✅ Test 10 Passed: Full Pre-Trade Gate approved setup with RR 1:${verdict.actualRR} (SL: $${verdict.stopLossPrice}, TP: $${verdict.takeProfitPrice})`);
}

console.log('\n🎉 ALL 10/10 UNIVERSAL TRADE GUARD TESTS PASSED PERFECTLY!\n');
