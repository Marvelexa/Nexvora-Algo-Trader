import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

console.log('🔥 =========================================================================');
console.log('🔥 STARTING ADVERSARIAL CHALLENGER 2 EMPIRICAL STRESS TEST SUITE');
console.log('🔥 Scope: R3 (Mid-Way Reversal Shield & TP1 Wall) & Port 3001 Isolation');
console.log('🔥 =========================================================================\n');

let passCount = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  console.log(`[TEST ${totalTests}] ${name}`);
  try {
    fn();
    passCount++;
    console.log(`  ✅ PASSED\n`);
  } catch (err: any) {
    console.error(`  ❌ FAILED: ${err.message}\n`);
    throw err;
  }
}

// Helper to create 10-bar baseline history
function createBaselineCandles(count: number, basePrice: number, baseVol: number = 1000): KlinePoint[] {
  const bars: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < count; i++) {
    bars.push({
      time: baseTime + i * 300000,
      open: basePrice,
      high: basePrice + 0.20,
      low: basePrice - 0.20,
      close: basePrice + 0.05,
      volume: baseVol,
    });
  }
  return bars;
}

// ============================================================================
// SECTION 1: TIER 1 FEE BREAKEVEN BOUNDARY TESTING (+0.249% vs +0.251%)
// ============================================================================

runTest('1.1 Long Position at +0.249% move -> Must NOT trigger Fee Breakeven Lock', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 99.0, // slDistance = 1.0 (1.0%)
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1, // keeps pnlUSD = $0.249 < $2.00
    leverage: 30, // roe = 0.249% * 30 = 7.47% < 10%
    takeProfitPrice: 102.0,
    tp1Price: 102.0,
    tp1Hit: false,
    pnlUSD: 0.249, // strictly < 2.00
    ratchetStage: 0,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.249, // +0.249% move (< 0.25%)
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.updateBrackets, false, 'updateBrackets must be false at +0.249% move');
  assert.strictEqual(action.ratchetStage, 0, 'ratchetStage must remain 0');
  assert.strictEqual(action.newStopLossPrice, 99.0, 'Stop loss must remain untouched at 99.0');
});

runTest('1.2 Long Position at +0.251% move -> MUST trigger Tier 1 Fee Breakeven Lock at +0.12%', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 99.0,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 102.0,
    tp1Price: 102.0,
    tp1Hit: false,
    pnlUSD: 0.251, // < 2.00, so trigger is purely priceMovePct = 0.00251 >= 0.0025
    ratchetStage: 0,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.251, // +0.251% move (>= 0.25%)
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.updateBrackets, true, 'updateBrackets must be true at +0.251% move');
  assert.strictEqual(action.ratchetStage, 1, 'ratchetStage must advance to 1');
  assert.strictEqual(action.newStopLossPrice, 100.12, 'SL must lock at Entry + 0.12% ($100.12)');
  assert(action.ratchetReason.includes('TIER 1 FEE-PLUS BREAKEVEN'), `Expected Tier 1 reason, got: ${action.ratchetReason}`);
});

runTest('1.3 Short Position at +0.249% move -> Must NOT trigger Fee Breakeven Lock', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice: 100.0,
    stopLossPrice: 101.0,
    initialStopLossPrice: 101.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 98.0,
    tp1Price: 98.0,
    tp1Hit: false,
    pnlUSD: 0.249,
    ratchetStage: 0,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 99.751, // +0.249% profit move
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.updateBrackets, false, 'Short updateBrackets must be false at +0.249%');
  assert.strictEqual(action.ratchetStage, 0, 'ratchetStage must remain 0');
  assert.strictEqual(action.newStopLossPrice, 101.0, 'SL must remain at 101.0');
});

runTest('1.4 Short Position at +0.251% move -> MUST trigger Tier 1 Fee Breakeven Lock at -0.12%', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice: 100.0,
    stopLossPrice: 101.0,
    initialStopLossPrice: 101.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 98.0,
    tp1Price: 98.0,
    tp1Hit: false,
    pnlUSD: 0.251,
    ratchetStage: 0,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 99.749, // +0.251% profit move
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.updateBrackets, true, 'Short updateBrackets must be true at +0.251%');
  assert.strictEqual(action.ratchetStage, 1, 'ratchetStage must advance to 1');
  assert.strictEqual(action.newStopLossPrice, 99.88, 'SL must lock at Entry - 0.12% ($99.88)');
  assert(action.ratchetReason.includes('TIER 1 FEE-PLUS BREAKEVEN'));
});

// ============================================================================
// SECTION 2: MID-WAY REVERSAL SHIELD AT 65% TP1 DISTANCE
// ============================================================================

runTest('2.1 Long 5m opposite candle close at 64% progress to TP1 -> Must NOT trigger 100% close', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 101.0,
    tp1Price: 101.0, // distToTP1 = 1.00
    tp1Hit: false,
    pnlUSD: 0.64, // strictly < 3.50 to isolate progressToTP1
    ratchetStage: 1,
  };

  // 5m Red candle (opposite body close): open 100.65, close 100.64.
  // Kept within previous bar range (close >= prev.low) to avoid legacy opposite close.
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 100.60, high: 100.65, low: 100.58, close: 100.63, volume: 1000 },
    { time: 2000, open: 100.65, high: 100.66, low: 100.63, close: 100.64, volume: 1000 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.64, // 64% progress to TP1 ($0.64 / $1.00)
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldClose100, false, 'Opposite close at 64% progress must NOT trigger 100% close');
});

runTest('2.2 Long 5m opposite candle close at 65.1% progress to TP1 -> MUST trigger 100% market close', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 101.0,
    tp1Price: 101.0, // distToTP1 = 1.00
    tp1Hit: false,
    pnlUSD: 0.651, // < 3.50, isolating progressToTP1 = 0.651 >= 0.65
    ratchetStage: 1,
  };

  // 5m Red candle (opposite body close)
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 100.60, high: 100.66, low: 100.58, close: 100.64, volume: 1000 },
    { time: 2000, open: 100.66, high: 100.67, low: 100.64, close: 100.651, volume: 1000 }, // Red: close < open
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.651, // 65.1% progress to TP1
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldClose100, true, 'Opposite close at 65.1% progress MUST trigger 100% close');
  assert(action.closeReason.includes('MID-WAY REVERSAL SHIELD'), `Expected MID-WAY REVERSAL SHIELD, got: ${action.closeReason}`);
  assert.strictEqual(action.ratchetReason, 'MID_WAY_REVERSAL_SHIELD_EXIT');
});

runTest('2.3 Long 39% rejection wick at 66% progress -> Must NOT trigger 100% close', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 101.0,
    tp1Price: 101.0,
    tp1Hit: false,
    pnlUSD: 0.66,
    ratchetStage: 1,
  };

  // Green candle (close > open) with 39% upper rejection wick
  // span = 100.66 - 100.56 = 0.10
  // open = 100.60, close = 100.621
  // upperWick = 100.66 - 100.621 = 0.039 -> 0.039 / 0.10 = 39% (< 40%)
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 100.55, high: 100.61, low: 100.50, close: 100.60, volume: 1000 },
    { time: 2000, open: 100.60, high: 100.66, low: 100.56, close: 100.621, volume: 1000 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.66, // 66% progress
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldClose100, false, '39% rejection wick must NOT trigger 100% close');
});

runTest('2.4 Long 41% rejection wick at 66% progress -> MUST trigger 100% market close', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 101.0,
    tp1Price: 101.0,
    tp1Hit: false,
    pnlUSD: 0.66,
    ratchetStage: 1,
  };

  // Green candle with 41% upper rejection wick
  // span = 100.66 - 100.56 = 0.10
  // open = 100.60, close = 100.619
  // upperWick = 100.66 - 100.619 = 0.041 -> 0.041 / 0.10 = 41% (>= 40%)
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 100.55, high: 100.61, low: 100.50, close: 100.60, volume: 1000 },
    { time: 2000, open: 100.60, high: 100.66, low: 100.56, close: 100.619, volume: 1000 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.66, // 66% progress
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldClose100, true, '41% rejection wick MUST trigger 100% close');
  assert(action.closeReason.includes('MID-WAY REVERSAL SHIELD'));
  assert(action.closeReason.includes('Top rejection wick 41% >= 40%'));
  assert.strictEqual(action.ratchetReason, 'MID_WAY_REVERSAL_SHIELD_EXIT');
});

runTest('2.5 Long Volume drop with Bearish RSI divergence at 66% progress -> MUST trigger 100% market close', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 105.0,
    tp1Price: 105.0, // distToTP1 = 5.0
    tp1Hit: false,
    pnlUSD: 3.30, // < 3.50, isolating progressToTP1 = 3.30 / 5.0 = 66% >= 65%
    ratchetStage: 1,
  };

  // 7 candles: final candle has higher high (103.6 >= 103.5), volume drop (500 < 850),
  // RSI divergence (86.19 < 88.64), green body (close 103.3 > open 103.1), and wick 27% < 40%.
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 100.0, high: 100.2, low: 99.8, close: 100.0, volume: 1000 },
    { time: 2000, open: 100.0, high: 102.1, low: 99.9, close: 102.0, volume: 1000 },
    { time: 3000, open: 102.0, high: 102.2, low: 101.4, close: 101.5, volume: 1000 },
    { time: 4000, open: 101.5, high: 102.2, low: 101.5, close: 102.1, volume: 1000 },
    { time: 5000, open: 102.1, high: 102.8, low: 102.0, close: 102.7, volume: 1000 },
    { time: 6000, open: 102.7, high: 103.5, low: 102.6, close: 103.4, volume: 1000 },
    { time: 7000, open: 103.1, high: 103.6, low: 102.5, close: 103.3, volume: 500 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 103.30, // 66% progress
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldClose100, true, 'Volume drop with RSI divergence MUST trigger 100% close');
  assert(action.closeReason.includes('MID-WAY REVERSAL SHIELD'));
  assert(action.closeReason.includes('Volume drop with bearish RSI divergence'));
  assert.strictEqual(action.ratchetReason, 'MID_WAY_REVERSAL_SHIELD_EXIT');
});

runTest('2.6 Short Position Mid-Way Reversal Shield (Opposite close 64% vs 65.1%, Wick 39% vs 41%, RSI div)', () => {
  const baseShortPos: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice: 100.0,
    stopLossPrice: 100.50,
    initialStopLossPrice: 101.0,
    atr: 1.0,
    quantity: 1,
    leverage: 30,
    takeProfitPrice: 99.0,
    tp1Price: 99.0, // distToTP1 = 1.00
    tp1Hit: false,
    pnlUSD: 0.64,
    ratchetStage: 1,
  };

  // Case A: Opposite candle (green) at 64% progress (currentPrice = 99.36) -> NO CLOSE
  const action64 = UniversalTradeGuard.evaluateLiveProfitLock({
    position: { ...baseShortPos, pnlUSD: 0.64 },
    currentPrice: 99.36,
    candles5m: [
      { time: 1000, open: 99.40, high: 99.42, low: 99.35, close: 99.37, volume: 1000 },
      { time: 2000, open: 99.35, high: 99.37, low: 99.34, close: 99.36, volume: 1000 }, // Green: close > open
    ],
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(action64.shouldClose100, false, 'Short opposite close at 64% must NOT close');

  // Case B: Opposite candle (green) at 65.1% progress (currentPrice = 99.349) -> 100% CLOSE
  const action65 = UniversalTradeGuard.evaluateLiveProfitLock({
    position: { ...baseShortPos, pnlUSD: 0.651 },
    currentPrice: 99.349,
    candles5m: [
      { time: 1000, open: 99.40, high: 99.42, low: 99.35, close: 99.37, volume: 1000 },
      { time: 2000, open: 99.34, high: 99.36, low: 99.33, close: 99.349, volume: 1000 }, // Green
    ],
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(action65.shouldClose100, true, 'Short opposite close at 65.1% MUST 100% close');
  assert(action65.closeReason.includes('MID-WAY REVERSAL SHIELD'));

  // Case C: 39% bottom rejection wick at 66% progress -> NO CLOSE
  // span = 0.10 (99.44 - 99.34 = 0.10), red candle (open 99.40, close 99.379)
  // lowerWick = 99.379 - 99.34 = 0.039 (39%)
  const actionWick39 = UniversalTradeGuard.evaluateLiveProfitLock({
    position: { ...baseShortPos, pnlUSD: 0.66 },
    currentPrice: 99.34,
    candles5m: [
      { time: 1000, open: 99.45, high: 99.47, low: 99.39, close: 99.40, volume: 1000 },
      { time: 2000, open: 99.40, high: 99.44, low: 99.34, close: 99.379, volume: 1000 },
    ],
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(actionWick39.shouldClose100, false, 'Short 39% wick must NOT close');

  // Case D: 41% bottom rejection wick at 66% progress -> 100% CLOSE
  // span = 0.10, red candle (open 99.40, close 99.381)
  // lowerWick = 99.381 - 99.34 = 0.041 (41%)
  const actionWick41 = UniversalTradeGuard.evaluateLiveProfitLock({
    position: { ...baseShortPos, pnlUSD: 0.66 },
    currentPrice: 99.34,
    candles5m: [
      { time: 1000, open: 99.45, high: 99.47, low: 99.39, close: 99.40, volume: 1000 },
      { time: 2000, open: 99.40, high: 99.44, low: 99.34, close: 99.381, volume: 1000 },
    ],
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(actionWick41.shouldClose100, true, 'Short 41% wick MUST 100% close');
  assert(actionWick41.closeReason.includes('Bottom rejection wick 41% >= 40%'));

  // Case E: Bullish RSI divergence with volume drop on Short -> 100% CLOSE
  const shortRsiCandles: KlinePoint[] = [
    { time: 1000, open: 100.0, high: 100.2, low: 99.8, close: 100.0, volume: 1000 },
    { time: 2000, open: 100.0, high: 100.1, low: 98.0, close: 98.0, volume: 1000 },
    { time: 3000, open: 98.0, high: 98.6, low: 97.9, close: 98.5, volume: 1000 },
    { time: 4000, open: 98.5, high: 98.6, low: 97.8, close: 97.9, volume: 1000 },
    { time: 5000, open: 97.9, high: 98.0, low: 97.2, close: 97.3, volume: 1000 },
    { time: 6000, open: 97.3, high: 97.4, low: 96.5, close: 96.6, volume: 1000 },
    { time: 7000, open: 96.8, high: 97.4, low: 96.4, close: 96.7, volume: 500 }, // lower low 96.4, RSI rises, vol drops
  ];

  const actionShortRsi = UniversalTradeGuard.evaluateLiveProfitLock({
    position: {
      ...baseShortPos,
      entryPrice: 100.0,
      tp1Price: 95.0, // distToTP1 = 5.0
      pnlUSD: 3.30,   // 3.30 / 5.0 = 66% progress
    },
    currentPrice: 96.70,
    candles5m: shortRsiCandles,
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(actionShortRsi.shouldClose100, true, 'Short Bullish RSI divergence MUST 100% close');
  assert(actionShortRsi.closeReason.includes('Volume drop with bullish RSI divergence'));
});

// ============================================================================
// SECTION 3: TP1 WALL MOMENTUM EXECUTION (WEAK vs EXPLOSIVE BREAKOUT)
// ============================================================================

runTest('3.1 TP1 Wall with Weak Momentum (Body = 1.19*ATR < 1.2*ATR) -> Banks 75% at Wall & Trails SL at +0.35R', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0, // slDistance = 1.0
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 101.50,
    tp1Price: 101.50,
    tp1Hit: false,
    pnlUSD: 15.0,
    ratchetStage: 1,
  };

  // 9 baseline bars + 1 current bar where Body = 101.49 - 100.30 = 1.19 (< 1.2 * atr = 1.20)
  // Even with high volume (3000), body is strictly below threshold!
  const candles5m = createBaselineCandles(9, 100.0, 1000);
  candles5m.push({
    time: 1700000000000 + 9 * 300000,
    open: 100.30,
    high: 101.55,
    low: 100.25,
    close: 101.49,
    volume: 3000,
  });

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 101.50, // Reached TP1 wall
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldCloseTP1Partial, true, 'Must execute 75% partial cash bank');
  assert.strictEqual(action.tp1CloseRatio, 0.75, 'Close ratio must be exactly 75%');
  assert.strictEqual(action.newStopLossPrice, 100.35, 'Runner SL must lock at Entry + 0.35R ($100.35)');
  assert(action.ratchetReason.includes('75% AT TP1 WALL'));
});

runTest('3.2 TP1 Wall with Weak Momentum (Body = 1.25*ATR, Vol = 1.20x < 1.3x) -> Banks 75% at Wall & Trails SL at +0.35R', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 101.50,
    tp1Price: 101.50,
    tp1Hit: false,
    pnlUSD: 15.0,
    ratchetStage: 1,
  };

  // 9 baseline bars (vol 1000) + 1 breakout bar where volume = 1200
  // avgVol = (9*1000 + 1200)/10 = 1020. 1.3 * 1020 = 1326.
  // 1200 < 1326 -> volume threshold not satisfied!
  const candles5m = createBaselineCandles(9, 100.0, 1000);
  candles5m.push({
    time: 1700000000000 + 9 * 300000,
    open: 100.20,
    high: 101.55,
    low: 100.10,
    close: 101.45, // Body = 1.25 >= 1.2*atr
    volume: 1200,  // Vol = 1.20x < 1.3x avg
  });

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 101.50,
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldCloseTP1Partial, true, 'Must execute 75% partial cash bank when vol < 1.3x');
  assert.strictEqual(action.tp1CloseRatio, 0.75);
  assert.strictEqual(action.newStopLossPrice, 100.35);
});

runTest('3.3 TP1 Wall Explosive Breakout (Body = 1.21*ATR & Vol = 1.35x avg) -> Holds Runner & Trails SL Behind Broken Wall', () => {
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.0,
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 101.50,
    tp1Price: 101.50,
    tp1Hit: false,
    pnlUSD: 15.5,
    ratchetStage: 1,
  };

  // 9 baseline bars (vol 1000) + 1 breakout bar (vol 1350)
  // avgVol = (9000 + 1350)/10 = 1035. 1.3 * avgVol = 1345.5.
  // 1350 >= 1345.5 (>= 1.3x avgVol)!
  // Body = 101.51 - 100.30 = 1.21 >= 1.2 * atr (1.20)!
  const candles5m = createBaselineCandles(9, 100.0, 1000);
  candles5m.push({
    time: 1700000000000 + 9 * 300000,
    open: 100.30,
    high: 101.60,
    low: 100.25,
    close: 101.51,
    volume: 1350,
  });

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 101.55, // Reached/broke through TP1
    candles5m,
    atr: 1.0,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldCloseTP1Partial, false, 'Must HOLD runner on explosive breakout');
  assert.strictEqual(action.tp1CloseRatio, 0, 'Must not close any partial ratio on breakout');
  // Trailed SL = effectiveTP1 (101.50) - 0.20 * atr (0.20) = 101.30
  assert.strictEqual(action.newStopLossPrice, 101.30, 'SL must trail behind broken wall at $101.30');
  assert(action.ratchetReason.includes('EXPLOSIVE WALL BREAKOUT'));
});

runTest('3.4 Short Position TP1 Wall Execution (Weak Momentum vs Explosive Breakout)', () => {
  const baseShortPos: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice: 100.0,
    stopLossPrice: 99.88,
    initialStopLossPrice: 101.0, // slDistance = 1.0
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 98.50,
    tp1Price: 98.50,
    tp1Hit: false,
    pnlUSD: 15.0,
    ratchetStage: 1,
  };

  // 1. Weak momentum at wall -> 75% Cash bank, SL at Entry - 0.35R ($99.65)
  const candlesWeak = createBaselineCandles(9, 100.0, 1000);
  candlesWeak.push({
    time: 1700000000000 + 9 * 300000,
    open: 99.4,
    high: 99.5,
    low: 98.45,
    close: 98.51, // Body = 0.89 < 1.2 * atr
    volume: 1000,
  });

  const actionWeak = UniversalTradeGuard.evaluateLiveProfitLock({
    position: baseShortPos,
    currentPrice: 98.50,
    candles5m: candlesWeak,
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(actionWeak.shouldCloseTP1Partial, true, 'Short weak momentum must bank 75%');
  assert.strictEqual(actionWeak.tp1CloseRatio, 0.75);
  assert.strictEqual(actionWeak.newStopLossPrice, 99.65, 'Runner SL must be at $99.65');

  // 2. Explosive breakout on Short -> Hold runner, trail SL behind broken wall ($98.50 + 0.20*1.0 = $98.70)
  const candlesBreakout = createBaselineCandles(9, 100.0, 1000);
  candlesBreakout.push({
    time: 1700000000000 + 9 * 300000,
    open: 99.70,
    high: 99.75,
    low: 98.40,
    close: 98.45, // Body = 1.25 >= 1.2*atr, Vol = 1350 >= 1.3x
    volume: 1350,
  });

  const actionBreakout = UniversalTradeGuard.evaluateLiveProfitLock({
    position: baseShortPos,
    currentPrice: 98.45,
    candles5m: candlesBreakout,
    atr: 1.0,
    decimals: 4,
  });
  assert.strictEqual(actionBreakout.shouldCloseTP1Partial, false, 'Short explosive breakout must HOLD runner');
  assert.strictEqual(actionBreakout.tp1CloseRatio, 0);
  assert.strictEqual(actionBreakout.newStopLossPrice, 98.70, 'Short SL must trail behind broken wall at $98.70');
  assert(actionBreakout.ratchetReason.includes('EXPLOSIVE WALL BREAKOUT'));
});

// ============================================================================
// SECTION 4: PORT 3001 STRICT ISOLATION ACROSS ALL PORTS (3001 THROUGH 3010)
// ============================================================================

function createSyntheticMockCandles(count: number, basePrice: number, step: number = 0): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < count; i++) {
    const p = basePrice + (i * step);
    candles.push({
      time: baseTime + (i * 900000),
      open: p,
      high: p + 0.0010,
      low: p - 0.0010,
      close: p + 0.0002,
      volume: 1000,
    });
  }
  return candles;
}

runTest('4.1 Pre-Trade Gate: Sweep across ALL ports 3001 through 3010 on Rule C (Late entry wide SL > 0.55%)', () => {
  const candles = createSyntheticMockCandles(60, 100, -0.05);
  candles[15] = { time: 1000 + 15 * 900, open: 91.5, high: 92.2, low: 91.0, close: 92.0, volume: 1000 };
  candles[16] = { time: 1000 + 16 * 900, open: 92.0, high: 96.5, low: 92.0, close: 96.0, volume: 1000 };
  candles[30] = { time: 1000 + 30 * 900, open: 103.0, high: 103.5, low: 102.0, close: 102.5, volume: 1000 };
  candles[31] = { time: 1000 + 31 * 900, open: 102.0, high: 102.2, low: 98.5, close: 99.0, volume: 1000 };
  candles[32] = { time: 1000 + 32 * 900, open: 99.0, high: 99.1, low: 98.0, close: 98.0, volume: 1000 };
  candles[44] = { time: 1000 + 44 * 900, open: 98.7, high: 98.9, low: 98.5, close: 98.6, volume: 1000 };
  candles[45] = { time: 1000 + 45 * 900, open: 98.5, high: 98.6, low: 98.2, close: 98.4, volume: 2000 };
  candles[46] = { time: 1000 + 46 * 900, open: 98.5, high: 99.1, low: 98.5, close: 98.9, volume: 1000 };
  candles[candles.length - 1] = {
    time: 1000 + 59 * 900,
    open: 99.2,
    high: 99.4,
    low: 98.8,
    close: 99.0,
    volume: 1000,
  };

  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('BEARISH');

  const allPorts = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];

  for (const port of allPorts) {
    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'SELL',
      currentPrice: 99.0,
      accountCapitalUSD: 193.0,
      candles15m: candles,
      atr: 1.5,
      activePositions: [],
      port,
    });

    if (port === 3001) {
      // Port 3001 MUST STRICTLY BYPASS Clean Airway Rule C
      assert.strictEqual(verdict.allowed, true, 'Port 3001 must be approved without Clean Airway veto');
      assert(!verdict.reason.includes('LATE_ENTRY_WIDE_SL_VETO'), 'Port 3001 must NOT receive LATE_ENTRY_WIDE_SL_VETO');
      assert(!verdict.reason.includes('PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO'), 'Port 3001 must NOT receive Rule B veto');
    } else {
      // Ports 3002 through 3010 MUST STRICTLY ENFORCE Clean Airway rules
      assert.strictEqual(verdict.allowed, false, `Port ${port} must strictly veto wide SL under Clean Airway`);
      assert(
        verdict.reason.includes('LATE_ENTRY_WIDE_SL_VETO') || verdict.reason.includes('WALL_TOO_CLOSE_BAD_RR_VETO'),
        `Port ${port} expected Clean Airway veto, got: ${verdict.reason}`
      );
    }
  }
});

runTest('4.2 Direct Clean Airway Gate Evaluation: Verification of Rules A, B, C Logic', () => {
  // Test Rule A: Safe_TP_Distance < 1.35 * SL_Distance
  const resRuleA = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice: 60000,
    slDistance: 300, // 0.50% SL (valid under Rule C)
    safeTpDistance: 350, // 350 / 300 = 1.17 < 1.35
    firstPhysicalWallFrontRunTP: 60350,
  });
  assert.strictEqual(resRuleA.allowed, false);
  assert.strictEqual(resRuleA.reasonCode, 'WALL_TOO_CLOSE_BAD_RR_VETO');

  // Test Rule B: Safe_TP_Distance / entryPrice < 0.0065
  const resRuleB = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice: 60000,
    slDistance: 100, // 0.16% SL
    safeTpDistance: 200, // 200 / 100 = 2.0 RR (valid under Rule A), but 200 / 60000 = 0.33% < 0.65%
    firstPhysicalWallFrontRunTP: 60200,
  });
  assert.strictEqual(resRuleB.allowed, false);
  assert.strictEqual(resRuleB.reasonCode, 'PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO');

  // Test Rule C: SL_Distance / entryPrice > 0.0055
  const resRuleC = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice: 60000,
    slDistance: 360, // 360 / 60000 = 0.60% > 0.55%
    safeTpDistance: 600, // 600 / 360 = 1.67 RR >= 1.35, 600 / 60000 = 1.0% >= 0.65%
    firstPhysicalWallFrontRunTP: 60600,
  });
  assert.strictEqual(resRuleC.allowed, false);
  assert.strictEqual(resRuleC.reasonCode, 'LATE_ENTRY_WIDE_SL_VETO');

  // Clean setup passing all 3 rules
  const resApproved = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice: 60000,
    slDistance: 240, // 240 / 60000 = 0.40% <= 0.55% (Rule C pass)
    safeTpDistance: 480, // 480 / 60000 = 0.80% >= 0.65% (Rule B pass), 480 / 240 = 2.0 >= 1.35 (Rule A pass)
    firstPhysicalWallFrontRunTP: 60480,
  });
  assert.strictEqual(resApproved.allowed, true);
  assert.strictEqual(resApproved.reasonCode, 'CLEAN_AIRWAY_APPROVED');
});

runTest('4.3 Architecture & File Inspection: Verify Port 3001 is completely omitted from master_cluster.mjs', () => {
  const clusterFile = path.resolve('master_cluster.mjs');
  const content = fs.readFileSync(clusterFile, 'utf8');

  // Verify SYSTEMS array includes ports 3002 through 3010
  for (let port = 3002; port <= 3010; port++) {
    assert(content.includes(`port: ${port}`), `master_cluster.mjs must contain port ${port}`);
  }

  // Verify SYSTEMS array does NOT register port 3001
  assert(!content.includes('port: 3001,'), 'master_cluster.mjs must NOT contain port 3001 in SYSTEMS list');
  assert(!content.includes('port: 3001 }'), 'master_cluster.mjs must NOT contain port 3001 in SYSTEMS list');
  assert(content.includes('Port 3001 remains strictly untouched'), 'master_cluster.mjs header must document Port 3001 isolation');
});

console.log('=========================================================================');
console.log(`🎉 ALL ${passCount}/${totalTests} ADVERSARIAL CHALLENGER TESTS PASSED EMPIRICALLY!`);
console.log('=========================================================================\n');
