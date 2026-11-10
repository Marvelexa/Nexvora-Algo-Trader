import assert from 'node:assert';
import { 
  CandleStructureTPCalculator, 
  LiveCandleReversalDetector, 
  CandleByCandleProfitRatchet 
} from '../lib/risk/candleStructureProfitProtectionEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

function createCandle(time: number, open: number, high: number, low: number, close: number, volume: number = 1000): KlinePoint {
  return { time, open, high, low, close, volume };
}

console.log('🧪 Starting Candle Structure TP & Live Reversal Protection Tests...\n');

// ============================================================================
// TEST SUITE 1: PRE-REVERSAL CANDLE STRUCTURE TP CALCULATION (AT ENTRY)
// ============================================================================
console.log('--- TEST SUITE 1: Pre-Reversal Candle Structure TP Calculation ---');

// 1. BUY: Snaps to nearest Bearish Order Block lower body edge
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  // 30 base candles around 100
  for (let i = 0; i < 30; i++) {
    candles.push(createCandle(baseTime + i * 900, 100, 101, 99, 100));
  }
  // Bearish Order Block at index 30: Bullish candle before displacement drop
  // Open 104, Close 105, High 105.5, Low 103.8. Lower body edge = 104.0
  candles.push(createCandle(baseTime + 30 * 900, 104, 105.5, 103.8, 105));
  // Displacement drop candles
  candles.push(createCandle(baseTime + 31 * 900, 104.5, 104.5, 101.5, 102));
  candles.push(createCandle(baseTime + 32 * 900, 102, 102.5, 99.5, 100));

  // Current entry price at 100.5, SL at 99.0 (SL dist = 1.5)
  const tpTarget = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 100.5,
    stopLossPrice: 99.0,
    atr: 1.0,
    candles15m: candles,
    tickSize: 0.1,
    decimals: 1,
  });

  assert(tpTarget.targetPrice > 100.5, `Target price ${tpTarget.targetPrice} must be above entry 100.5`);
  assert(tpTarget.zoneType === 'ORDER_BLOCK', `Expected ORDER_BLOCK, got ${tpTarget.zoneType}`);
  assert.strictEqual(tpTarget.targetPrice, 103.8, `Expected TP to front-run OB lower body (104.0 - 0.2 buffer = 103.8), got ${tpTarget.targetPrice}`);
  console.log(`  ✅ PASS: BUY snaps to nearest Bearish Order Block lower body ($${tpTarget.targetPrice})`);
}

// 2. SHORT: Snaps to nearest Bullish Order Block upper body edge
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 30; i++) {
    candles.push(createCandle(baseTime + i * 900, 100, 101, 99, 100));
  }
  // Bullish Order Block at index 30: Bearish candle before displacement rally
  // Open 96, Close 95, High 96.2, Low 94.8. Upper body edge = 96.0
  candles.push(createCandle(baseTime + 30 * 900, 96, 96.2, 94.8, 95));
  // Displacement rally candles
  candles.push(createCandle(baseTime + 31 * 900, 95.5, 98.5, 95.5, 98));
  candles.push(createCandle(baseTime + 32 * 900, 98, 100.5, 98, 100));

  const tpTarget = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'BTCUSD',
    side: 'SELL',
    entryPrice: 99.5,
    stopLossPrice: 101.0,
    atr: 1.0,
    candles15m: candles,
    tickSize: 0.1,
    decimals: 1,
  });

  assert(tpTarget.targetPrice < 99.5, `Target price ${tpTarget.targetPrice} must be below entry 99.5`);
  assert(tpTarget.zoneType === 'ORDER_BLOCK', `Expected ORDER_BLOCK, got ${tpTarget.zoneType}`);
  assert.strictEqual(tpTarget.targetPrice, 96.2, `Expected TP to front-run OB upper body (96.0 + 0.2 buffer = 96.2), got ${tpTarget.targetPrice}`);
  console.log(`  ✅ PASS: SHORT snaps to nearest Bullish Order Block upper body ($${tpTarget.targetPrice})`);
}

// 3. BUY: Front-runs Swing High body by 0.15 * ATR
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 30; i++) {
    candles.push(createCandle(baseTime + i * 900, 100, 100.5, 99.5, 100));
  }
  // Recent 15m swing high: Open 106, High 108 (wick tip), Close 107 (body high = 107).
  candles.push(createCandle(baseTime + 30 * 900, 106, 108, 105.8, 107));
  candles.push(createCandle(baseTime + 31 * 900, 106.8, 107, 103, 103.5));

  const atr = 2.0;
  // Front-run buffer = 0.15 * 2.0 = 0.30. Expected TP = 107 - 0.30 = 106.7
  const tpTarget = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'ETHUSD',
    side: 'BUY',
    entryPrice: 103.0,
    stopLossPrice: 101.5,
    atr,
    candles15m: candles,
    tickSize: 0.1,
    decimals: 1,
  });

  assert(tpTarget.targetPrice > 103.0, 'TP must be above entry');
  assert.strictEqual(tpTarget.targetPrice, 106.7, `Expected TP at 106.7 (body 107 - buffer 0.3), got ${tpTarget.targetPrice}`);
  console.log(`  ✅ PASS: Front-runs Swing High body by 0.15*ATR ($${tpTarget.targetPrice})`);
}

// ============================================================================
// TEST SUITE 2: LIVE CANDLE EXHAUSTION & REVERSAL DETECTOR
// ============================================================================
console.log('\n--- TEST SUITE 2: Live Candle Exhaustion & Reversal Detector ---');

// 1. Activation threshold: Below +0.40R does not trigger
{
  const dummyPos: DeltaPosition = {
    id: 'test-pos-1',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 100.0,
    currentPrice: 100.2, // +0.20R move
    quantity: 1,
    marginUSD: 43.75,
    notionalUSD: 1312.5,
    leverage: 30,
    takeProfitPrice: 103.0,
    stopLossPrice: 99.0, // riskDist = 1.0
    initialStopLossPrice: 99.0,
    atr: 1.0,
    isBreakevenLocked: false,
    pnlUSD: 2.0,
    pnlPercent: 4.5,
    entryTime: Date.now() - 60000,
    strategyName: 'TEST',
    shadowConfirmedSeconds: 0,
    riskDistance: 1.0,
  };

  const candles1m = [
    createCandle(Date.now() - 120000, 100.0, 100.3, 99.9, 100.2),
    createCandle(Date.now() - 60000, 100.2, 100.4, 99.8, 99.9), // shooting star
  ];

  const verdict = LiveCandleReversalDetector.evaluateReversalExhaustion({
    pos: dummyPos,
    currentPrice: 100.2,
    candles1m,
  });

  assert.strictEqual(verdict.shouldClose, false, 'Must NOT trigger below +0.40R activation threshold');
  console.log('  ✅ PASS: Reversal scanner remains dormant below +0.40R threshold');
}

// 2. Signature A: Rejection Wick / Shooting Star (>= 55% upper wick) at +0.60R triggers immediate exit
{
  const dummyPos: DeltaPosition = {
    id: 'test-pos-2',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 100.0,
    currentPrice: 100.6, // +0.60R in profit
    quantity: 1,
    marginUSD: 43.75,
    notionalUSD: 1312.5,
    leverage: 30,
    takeProfitPrice: 103.0,
    stopLossPrice: 99.0, // riskDist = 1.0
    initialStopLossPrice: 99.0,
    atr: 1.0,
    isBreakevenLocked: false,
    pnlUSD: 6.0,
    pnlPercent: 13.5,
    entryTime: Date.now() - 120000,
    strategyName: 'TEST',
    shadowConfirmedSeconds: 0,
    riskDistance: 1.0,
  };

  // 1m candle with high 101.5, open 100.8, close 100.6, low 100.5
  // Total range = 1.0. Upper wick = 101.5 - 100.8 = 0.70 (70% wick >= 55% threshold)
  const candles1m = [
    createCandle(Date.now() - 180000, 100.0, 100.4, 99.9, 100.3),
    createCandle(Date.now() - 120000, 100.3, 100.9, 100.2, 100.8),
    createCandle(Date.now() - 60000, 100.8, 101.5, 100.5, 100.6),
  ];

  const verdict = LiveCandleReversalDetector.evaluateReversalExhaustion({
    pos: dummyPos,
    currentPrice: 100.6,
    candles1m,
  });

  assert.strictEqual(verdict.shouldClose, true, 'Signature A must trigger immediate close');
  assert.strictEqual(verdict.signature, 'SIGNATURE_A');
  console.log(`  ✅ PASS: Signature A (Shooting Star >= 55% wick) triggers immediate market close`);
}

// 3. Signature B: Bearish Engulfing closes below previous candle's open
{
  const dummyPos: DeltaPosition = {
    id: 'test-pos-3',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 100.0,
    currentPrice: 100.5, // +0.50R
    quantity: 1,
    marginUSD: 43.75,
    notionalUSD: 1312.5,
    leverage: 30,
    takeProfitPrice: 103.0,
    stopLossPrice: 99.0,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    isBreakevenLocked: false,
    pnlUSD: 5.0,
    pnlPercent: 11.2,
    entryTime: Date.now() - 120000,
    strategyName: 'TEST',
    shadowConfirmedSeconds: 0,
    riskDistance: 1.0,
  };

  // Prev candle: Open 100.6, Close 101.0
  // Cur candle: Open 101.0, Close 100.5 (closed below prev open 100.6)
  const candles1m = [
    createCandle(Date.now() - 180000, 100.0, 100.7, 100.0, 100.6),
    createCandle(Date.now() - 120000, 100.6, 101.1, 100.5, 101.0),
    createCandle(Date.now() - 60000, 101.0, 101.05, 100.4, 100.5),
  ];

  const verdict = LiveCandleReversalDetector.evaluateReversalExhaustion({
    pos: dummyPos,
    currentPrice: 100.5,
    candles1m,
  });

  assert.strictEqual(verdict.shouldClose, true, 'Signature B must trigger immediate close');
  assert.strictEqual(verdict.signature, 'SIGNATURE_B');
  console.log(`  ✅ PASS: Signature B (Opposite Engulfing / Momentum Flip) triggers immediate close`);
}

// ============================================================================
// TEST SUITE 3: RATCHETING HIGH-WATERMARK PROFIT RATCHET
// ============================================================================
console.log('\n--- TEST SUITE 3: Ratcheting High-Watermark Profit Ratchet ---');

// 1. Stage 1: At +0.45R Profit -> Move SL to Entry + 0.15R
{
  const pos: DeltaPosition = {
    id: 'ratchet-pos-1',
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    currentPrice: 100.50, // +0.50R profit (>= 0.45R)
    quantity: 1,
    marginUSD: 43.75,
    notionalUSD: 1312.5,
    leverage: 30,
    takeProfitPrice: 103.0,
    stopLossPrice: 99.0, // initial SL (riskDist = 1.0)
    initialStopLossPrice: 99.0,
    atr: 1.0,
    isBreakevenLocked: false,
    pnlUSD: 2.2,
    pnlPercent: 5.2,
    entryTime: Date.now() - 60000,
    strategyName: 'TEST',
    shadowConfirmedSeconds: 0,
    riskDistance: 1.0,
  };

  const result = CandleByCandleProfitRatchet.evaluateProfitRatchet({
    pos,
    currentPrice: 100.50,
  });

  assert.strictEqual(result.ratchetStage, 1, `Expected stage 1, got ${result.ratchetStage}`);
  assert.strictEqual(result.stopLossPrice, 100.12, `Expected SL at 100.12 (Entry + 0.12%), got ${result.stopLossPrice}`);
  assert.strictEqual(result.wasUpdated, true);
  console.log(`  ✅ PASS: Stage 1 (+0.40R / +$2.00): SL moved to Entry + 0.12% ($${result.stopLossPrice})`);
}

// 2. Stage 2: At +0.70R Profit -> Lock SL at 60% of peak unrealized profit
{
  const pos: DeltaPosition = {
    id: 'ratchet-pos-2',
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    currentPrice: 100.80, // +0.80R peak profit (>= 0.70R)
    quantity: 1,
    marginUSD: 43.75,
    notionalUSD: 1312.5,
    leverage: 30,
    takeProfitPrice: 103.0,
    stopLossPrice: 100.15,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    isBreakevenLocked: true,
    pnlUSD: 8.0,
    pnlPercent: 18.2,
    entryTime: Date.now() - 60000,
    strategyName: 'TEST',
    shadowConfirmedSeconds: 0,
    riskDistance: 1.0,
    peakPriceReached: 100.80,
    peakRReached: 0.80,
    ratchetStage: 1,
  };

  // Risk dist = 1.0. SL locked at +0.35R in profit = 100.0 + 0.35 = 100.35
  const result = CandleByCandleProfitRatchet.evaluateProfitRatchet({
    pos,
    currentPrice: 100.75,
  });

  assert.strictEqual(result.ratchetStage, 2, `Expected stage 2, got ${result.ratchetStage}`);
  assert.strictEqual(result.stopLossPrice, 100.35, `Expected SL at 100.35 (+0.35R profit), got ${result.stopLossPrice}`);
  console.log(`  ✅ PASS: Stage 2 (+0.65R / +$3.50): Locked SL at +0.35R profit ($${result.stopLossPrice})`);
}

// 3. Stage 3: Above +0.90R Profit -> Candle-by-Candle 1m Bar Trailing
{
  const pos: DeltaPosition = {
    id: 'ratchet-pos-3',
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    currentPrice: 101.20, // +1.20R profit (>= 0.90R)
    quantity: 1,
    marginUSD: 43.75,
    notionalUSD: 1312.5,
    leverage: 30,
    takeProfitPrice: 103.0,
    stopLossPrice: 100.48,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    isBreakevenLocked: true,
    pnlUSD: 12.0,
    pnlPercent: 27.4,
    entryTime: Date.now() - 60000,
    strategyName: 'TEST',
    shadowConfirmedSeconds: 0,
    riskDistance: 1.0,
    peakPriceReached: 101.20,
    peakRReached: 1.20,
    ratchetStage: 2,
  };

  // Closed 1m candle with low at 100.95. Buffer = 0.05 * ATR(1.0) = 0.05.
  // Trailed SL = 100.95 - 0.05 = 100.90
  const closed1m = createCandle(Date.now() - 60000, 100.96, 101.22, 100.95, 101.18);

  const result = CandleByCandleProfitRatchet.evaluateProfitRatchet({
    pos,
    currentPrice: 101.15,
    closed1mCandle: closed1m,
    atr: 1.0,
  });

  assert.strictEqual(result.ratchetStage, 3, `Expected stage 3, got ${result.ratchetStage}`);
  assert.strictEqual(result.stopLossPrice, 100.90, `Expected trailed SL at 100.90, got ${result.stopLossPrice}`);
  console.log(`  ✅ PASS: Stage 3 (+0.90R): Trailed SL along 1m candle low ($${result.stopLossPrice})`);
}

// ============================================================================
// TEST SUITE 4: PRE-ENTRY ROOM-TO-RUN FILTER
// ============================================================================
console.log('\n--- TEST SUITE 4: Pre-Entry Room-to-Run Filter ---');

// 1. Blocks trade when reversal barrier is too close (< 0.80 * SL_Distance)
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 30; i++) {
    candles.push(createCandle(baseTime + i * 900, 100, 100.5, 99.5, 100));
  }
  // Order block lower body right at 100.8 (only 0.6 distance above entry 100.2)
  candles.push(createCandle(baseTime + 30 * 900, 100.8, 101.5, 100.4, 101.2));
  candles.push(createCandle(baseTime + 31 * 900, 101.0, 101.0, 99.5, 99.6));
  candles.push(createCandle(baseTime + 32 * 900, 99.6, 100.2, 99.0, 99.2));
  candles.push(createCandle(baseTime + 33 * 900, 99.2, 100.3, 99.1, 100.2));

  // Entry 100.2, SL 99.2 -> SL_Distance = 1.0. Required room = 0.80.
  // Nearest barrier at 100.8 -> distance = 0.60 (< 0.80).
  const verdict = CandleStructureTPCalculator.checkRoomToRun({
    entryPrice: 100.2,
    side: 'BUY',
    stopLossPrice: 99.2,
    atr: 1.0,
    candles15m: candles,
  });

  assert.strictEqual(verdict.allowed, false, 'Must block trade with insufficient room to run');
  assert(verdict.reason.includes('INSUFFICIENT_REVERSAL_ROOM_VETO') || verdict.reason.includes('ROOM-TO-RUN VETO'), 'Reason must cite INSUFFICIENT_REVERSAL_ROOM_VETO');
  console.log(`  ✅ PASS: Blocks entry when resistance is too close (${verdict.zoneDistance.toFixed(2)} < ${verdict.requiredDistance.toFixed(2)})`);
}

// 2. Permits trade when reversal barrier is far enough (>= 0.80 * SL_Distance)
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 30; i++) {
    candles.push(createCandle(baseTime + i * 900, 100, 100.5, 99.5, 100));
  }
  // Order block lower body at 102.5 (2.3 distance above entry 100.2)
  candles.push(createCandle(baseTime + 30 * 900, 102.5, 103.5, 102.2, 103.2));
  candles.push(createCandle(baseTime + 31 * 900, 103.0, 103.0, 101.0, 101.2));
  candles.push(createCandle(baseTime + 32 * 900, 101.2, 101.5, 100.0, 100.2));
  candles.push(createCandle(baseTime + 33 * 900, 100.2, 100.4, 99.8, 100.2));

  const verdict = CandleStructureTPCalculator.checkRoomToRun({
    entryPrice: 100.2,
    side: 'BUY',
    stopLossPrice: 99.2,
    atr: 1.0,
    candles15m: candles,
  });

  assert.strictEqual(verdict.allowed, true, 'Must permit trade with ample room to run');
  console.log(`  ✅ PASS: Permits entry with ample room to run (${verdict.zoneDistance.toFixed(2)} >= ${verdict.requiredDistance.toFixed(2)})`);
}

console.log('\n========================================');
console.log('🎉 ALL CANDLE STRUCTURE TP & REVERSAL TESTS PASSED (100%)');
console.log('========================================\n');
