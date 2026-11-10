import { KlinePoint } from '../src/types';
import { ytCrtSmc3007Engine, YtCrtSmc3007Engine } from '../lib/strategies/ytCrtSmc3007Engine';
import { ytSolanoVwap3008Engine, YtSolanoVwap3008Engine } from '../lib/strategies/ytSolanoVwap3008Engine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, msg: string) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`  FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  } else {
    passedTests++;
    console.log(`  PASS: ${msg}`);
  }
}

function makeCandle(time: number, open: number, high: number, low: number, close: number, volume: number = 1000): KlinePoint {
  return { time, open, high, low, close, volume };
}

console.log('================================================================================');
console.log('   ADVERSARIAL REVIEWER M2-1 INDEPENDENT PROBE HARNESS                         ');
console.log('   Stress Testing Ports 3007 (CRT SMC) and 3008 (Solano VWAP)                   ');
console.log('================================================================================\n');

// ----------------------------------------------------------------------------
// SUITE 1: Port 3007 CRT SMC Bilateral Setup Generation & Exact Mechanics
// ----------------------------------------------------------------------------
console.log('--- SUITE 1: Port 3007 CRT SMC Mechanics & Bilateral Symmetry ---');

// 1.1 Bullish 1H CRT Turtle Soup Setup
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  // Step 1: Base consolidation establishing reference range
  // Reference C1 slice (n-12 to n-4)
  for (let i = 0; i < 30; i++) {
    candles.push(makeCandle(baseTime + i * 900, 100, 102, 98, 100, 1000));
  }
  // At bars 30-38 (which will be n-12 to n-4 when total = 42):
  // Set C1 range: High 105, Low 95. Midpoint = 100.
  for (let i = 0; i < 8; i++) {
    candles.push(makeCandle(baseTime + (30 + i) * 900, 100, i === 2 ? 105 : 102, i === 5 ? 95 : 97, 100, 1200));
  }
  // Candle 39 (n-4): Internal consolidation
  candles.push(makeCandle(baseTime + 38 * 900, 99, 101, 98, 99, 1100));
  // Candle 40 (n-3): Candle 2 Turtle Soup sweep below C1 Low (95) -> wicks down to 93, closes back inside at 97!
  candles.push(makeCandle(baseTime + 39 * 900, 98, 98.5, 93, 97, 3000));
  // Candle 41 (n-2): 5m CHoCH displacement breaking internal high (101) up to 102
  candles.push(makeCandle(baseTime + 40 * 900, 97, 102, 96.5, 101.5, 2500));
  // Candle 42 (n-1 / current): Pullback tapping Golden Zone (50%-61.8% of 93 to 102: 50% = 97.5, 61.8% = 96.44)
  // Low reaches 97.0 (taps GZ), closes at 99.5 with hammer lower wick (99.5 - 97.0 = 2.5 wick vs 3.0 height)
  candles.push(makeCandle(baseTime + 41 * 900, 98, 100, 97.0, 99.5, 1800));

  const verdict = ytCrtSmc3007Engine.evaluateSetup('BTCUSDT', candles);
  console.log('DEBUG VERDICT:', {
    entryPrice: verdict.entryPrice,
    stopLossPrice: verdict.stopLossPrice,
    riskDistance: verdict.riskDistance,
    tp1Price: verdict.tp1Price,
    tp2Price: verdict.tp2Price,
    calcTp2: verdict.entryPrice + 2.0 * verdict.riskDistance
  });
  assert(verdict.recommendedSide === 'BUY', 'Port 3007 produces BUY on Bullish CRT Turtle Soup');
  assert(verdict.setupType === 'BULLISH_1H_CRT_TURTLE_SOUP', 'Setup type is BULLISH_1H_CRT_TURTLE_SOUP');
  assert(verdict.tp1Ratio === 0.75, 'Port 3007 BUY tp1Ratio === 0.75');
  assert(verdict.tp2Ratio === 0.25, 'Port 3007 BUY tp2Ratio === 0.25');
  assert(verdict.earlyBreakevenPrice > verdict.entryPrice, 'Early BE is above Entry for BUY');
  assert(verdict.tp1Price >= verdict.entryPrice + verdict.riskDistance - 0.001, 'TP1 is at least 1.0R for BUY');
  assert(verdict.tp2Price >= verdict.entryPrice + 2.0 * verdict.riskDistance - 0.001, 'TP2 is at least 2.0R for BUY');
  assert(verdict.stopLossPrice < verdict.entryPrice, 'SL is below Entry for BUY');
  assert(verdict.minSlDistancePct >= 0.0045, 'minSlDistancePct >= 0.0045 fee shield enforced on BUY');
}

// 1.2 Bearish 1H CRT Turtle Soup Setup
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  // Step 1: Base consolidation
  for (let i = 0; i < 30; i++) {
    candles.push(makeCandle(baseTime + i * 900, 100, 102, 98, 100, 1000));
  }
  // Reference C1 slice (n-12 to n-4): High 105, Low 95.
  for (let i = 0; i < 8; i++) {
    candles.push(makeCandle(baseTime + (30 + i) * 900, 100, i === 2 ? 105 : 102, i === 5 ? 95 : 97, 100, 1200));
  }
  // Candle 39: Internal consolidation (low = 99)
  candles.push(makeCandle(baseTime + 38 * 900, 101, 102, 99, 101, 1100));
  // Candle 40 (n-3): Candle 2 Turtle Soup sweep above C1 High (105) -> wicks up to 107, closes back inside at 103!
  candles.push(makeCandle(baseTime + 39 * 900, 102, 107, 101.5, 103, 3000));
  // Candle 41 (n-2): 5m CHoCH displacement breaking internal low (99) down to 96!
  candles.push(makeCandle(baseTime + 40 * 900, 103, 103.5, 96, 96.5, 2500));
  // Candle 42 (n-1 / current): Pullback tapping Golden Zone (50%-61.8% of 107 to 96: 50% = 101.5, 61.8% = 102.8)
  // High reaches 102.5 (taps GZ), closes at 101.0 with red shooting star upper wick
  candles.push(makeCandle(baseTime + 41 * 900, 102, 102.5, 100.0, 101.0, 1800));

  const verdict = ytCrtSmc3007Engine.evaluateSetup('ETHUSDT', candles);
  console.log('DEBUG SELL 3007 VERDICT:', verdict);
  assert(verdict.recommendedSide === 'SELL', 'Port 3007 produces SELL on Bearish CRT Turtle Soup');
  assert(verdict.setupType === 'BEARISH_1H_CRT_TURTLE_SOUP', 'Setup type is BEARISH_1H_CRT_TURTLE_SOUP');
  assert(verdict.tp1Ratio === 0.75, 'Port 3007 SELL tp1Ratio === 0.75');
  assert(verdict.tp2Ratio === 0.25, 'Port 3007 SELL tp2Ratio === 0.25');
  assert(verdict.earlyBreakevenPrice < verdict.entryPrice, 'Early BE is below Entry for SELL');
  assert(verdict.tp1Price <= verdict.entryPrice - verdict.riskDistance + 0.001, 'TP1 is at least 1.0R for SELL');
  assert(verdict.tp2Price <= verdict.entryPrice - 2.0 * verdict.riskDistance + 0.001, 'TP2 is at least 2.0R for SELL');
  assert(verdict.stopLossPrice > verdict.entryPrice, 'SL is above Entry for SELL');
  assert(verdict.minSlDistancePct >= 0.0045, 'minSlDistancePct >= 0.0045 fee shield enforced on SELL');
}

// ----------------------------------------------------------------------------
// SUITE 2: Port 3008 Solano VWAP Mechanics & Bilateral Symmetry
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 2: Port 3008 Solano VWAP Mechanics & Bilateral Symmetry ---');

// 2.1 Flat VWAP Chop Filter Check
{
  const flatCandles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 50; i++) {
    flatCandles.push(makeCandle(baseTime + i * 900, 100, 100.02, 99.98, 100, 1000));
  }
  const flatVerdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', flatCandles);
  assert(flatVerdict.recommendedSide === null, 'Port 3008 strictly blocks flat VWAP chop');
  assert(flatVerdict.reasons.some(r => r.includes('FLAT VWAP RULE')), 'Reason notes FLAT VWAP RULE');
}

// 2.2 Bullish Solano VWAP + 9 EMA Stacked Retest
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  // Step 1: Upward trend establishing rising VWAP and 9 EMA above VWAP
  let price = 100;
  for (let i = 0; i < 45; i++) {
    price += 0.40;
    candles.push(makeCandle(baseTime + i * 900, price - 0.2, price + 0.3, price - 0.3, price, 1500));
  }
  // Pullback candle tapping 9 EMA / VWAP pocket
  const pullPrice = price - 0.6;
  candles.push(makeCandle(baseTime + 45 * 900, price, price + 0.1, pullPrice - 0.5, pullPrice, 2000));
  // Current candle: Bullish hammer / strong reaction breaking pullback high
  const bouncePrice = pullPrice + 0.9;
  candles.push(makeCandle(baseTime + 46 * 900, pullPrice, bouncePrice + 0.2, pullPrice - 0.1, bouncePrice, 3000));

  const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
  assert(verdict.recommendedSide === 'BUY', 'Port 3008 produces BUY on Bullish VWAP + 9 EMA bounce');
  assert(verdict.setupType === 'BULLISH_VWAP_9EMA_STACKED_RETEST', 'Setup type is BULLISH_VWAP_9EMA_STACKED_RETEST');
  assert(verdict.tp1Ratio === 0.75, 'Port 3008 BUY tp1Ratio === 0.75');
  assert(verdict.tp2Ratio === 0.25, 'Port 3008 BUY tp2Ratio === 0.25');
  assert(verdict.earlyBreakevenPrice === Number((verdict.entryPrice + verdict.riskDistance * 0.75).toFixed(4)), 'Early BE is +0.75R');
  assert(verdict.tp1Price === Number((verdict.entryPrice + verdict.riskDistance * 1.0).toFixed(4)), 'TP1 is +1.0R');
  assert(verdict.tp2Price === Number((verdict.entryPrice + verdict.riskDistance * 2.0).toFixed(4)), 'TP2 is +2.0R');
  assert(verdict.minSlDistancePct >= 0.0045, 'Fee shield >= 0.0045 enforced');
}

// 2.3 Bearish Solano VWAP + 9 EMA Stacked Retest
{
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  // Step 1: Downward trend establishing falling VWAP and 9 EMA below VWAP
  let price = 200;
  for (let i = 0; i < 45; i++) {
    price -= 0.40;
    candles.push(makeCandle(baseTime + i * 900, price + 0.2, price + 0.3, price - 0.3, price, 1500));
  }
  // Pullback rally tapping 9 EMA / VWAP pocket
  const pullPrice = price + 0.6;
  candles.push(makeCandle(baseTime + 45 * 900, price, pullPrice + 0.5, price - 0.1, pullPrice, 2000));
  // Current candle: Bearish shooting star / strong rejection breaking pullback low
  const bouncePrice = pullPrice - 0.9;
  candles.push(makeCandle(baseTime + 46 * 900, pullPrice, pullPrice + 0.1, bouncePrice - 0.2, bouncePrice, 3000));

  const verdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
  assert(verdict.recommendedSide === 'SELL', 'Port 3008 produces SELL on Bearish VWAP + 9 EMA bounce');
  assert(verdict.setupType === 'BEARISH_VWAP_9EMA_STACKED_RETEST', 'Setup type is BEARISH_VWAP_9EMA_STACKED_RETEST');
  assert(verdict.tp1Ratio === 0.75, 'Port 3008 SELL tp1Ratio === 0.75');
  assert(verdict.tp2Ratio === 0.25, 'Port 3008 SELL tp2Ratio === 0.25');
  assert(verdict.earlyBreakevenPrice === Number((verdict.entryPrice - verdict.riskDistance * 0.75).toFixed(4)), 'Early BE is -0.75R');
  assert(verdict.tp1Price === Number((verdict.entryPrice - verdict.riskDistance * 1.0).toFixed(4)), 'TP1 is -1.0R');
  assert(verdict.tp2Price === Number((verdict.entryPrice - verdict.riskDistance * 2.0).toFixed(4)), 'TP2 is -2.0R');
  assert(verdict.minSlDistancePct >= 0.0045, 'Fee shield >= 0.0045 enforced');
}

// ----------------------------------------------------------------------------
// SUITE 3: Strategy Registry Forwarding Integrity (Ports 3007 & 3008)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 3: Strategy Registry Forwarding Integrity ---');

{
  // Build a valid 3007 BUY setup and route through strategyRegistry
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 30; i++) {
    candles.push(makeCandle(baseTime + i * 900, 100, 102, 98, 100, 1000));
  }
  for (let i = 0; i < 8; i++) {
    candles.push(makeCandle(baseTime + (30 + i) * 900, 100, i === 2 ? 105 : 102, i === 5 ? 95 : 97, 100, 1200));
  }
  candles.push(makeCandle(baseTime + 38 * 900, 99, 101, 98, 99, 1100));
  candles.push(makeCandle(baseTime + 39 * 900, 98, 98.5, 93, 97, 3000));
  candles.push(makeCandle(baseTime + 40 * 900, 97, 102, 96.5, 101.5, 2500));
  candles.push(makeCandle(baseTime + 41 * 900, 98, 100, 97.0, 99.5, 1800));

  const directVerdict = ytCrtSmc3007Engine.evaluateSetup('BTCUSDT', candles);
  const regOutput = evaluateStrategyForPort(3007, 'BTCUSDT', candles);

  assert(regOutput.signal === directVerdict.recommendedSide, 'Registry signal matches direct verdict');
  assert(regOutput.confidenceScore === directVerdict.confidenceScore, 'Registry confidence matches direct verdict');
  assert(regOutput.customSL === directVerdict.stopLossPrice, 'Registry customSL forwarded');
  assert(regOutput.tp1Price === directVerdict.tp1Price, 'Registry tp1Price forwarded without drop');
  assert(regOutput.tp2Price === directVerdict.tp2Price, 'Registry tp2Price forwarded without drop');
  assert(regOutput.tp1Ratio === directVerdict.tp1Ratio, 'Registry tp1Ratio forwarded without drop');
  assert(regOutput.tp2Ratio === directVerdict.tp2Ratio, 'Registry tp2Ratio forwarded without drop');
  assert(regOutput.earlyBreakevenPrice === directVerdict.earlyBreakevenPrice, 'Registry earlyBreakevenPrice forwarded without drop');
  assert(regOutput.riskDistance === directVerdict.riskDistance, 'Registry riskDistance forwarded without drop');
  assert(regOutput.auditLog !== undefined, 'Registry auditLog forwarded');
}

{
  // Build a valid 3008 BUY setup and route through strategyRegistry
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000;
  let price = 100;
  for (let i = 0; i < 45; i++) {
    price += 0.40;
    candles.push(makeCandle(baseTime + i * 900, price - 0.2, price + 0.3, price - 0.3, price, 1500));
  }
  const pullPrice = price - 0.6;
  candles.push(makeCandle(baseTime + 45 * 900, price, price + 0.1, pullPrice - 0.5, pullPrice, 2000));
  const bouncePrice = pullPrice + 0.9;
  candles.push(makeCandle(baseTime + 46 * 900, pullPrice, bouncePrice + 0.2, pullPrice - 0.1, bouncePrice, 3000));

  const directVerdict = ytSolanoVwap3008Engine.evaluateSetup('SOLUSDT', candles);
  const regOutput = evaluateStrategyForPort(3008, 'SOLUSDT', candles);

  assert(regOutput.signal === directVerdict.recommendedSide, 'Registry signal matches direct 3008 verdict');
  assert(regOutput.tp1Price === directVerdict.tp1Price, 'Registry tp1Price forwarded without drop for 3008');
  assert(regOutput.tp2Price === directVerdict.tp2Price, 'Registry tp2Price forwarded without drop for 3008');
  assert(regOutput.tp1Ratio === directVerdict.tp1Ratio, 'Registry tp1Ratio forwarded for 3008');
  assert(regOutput.tp2Ratio === directVerdict.tp2Ratio, 'Registry tp2Ratio forwarded for 3008');
  assert(regOutput.earlyBreakevenPrice === directVerdict.earlyBreakevenPrice, 'Registry earlyBreakevenPrice forwarded for 3008');
  assert(regOutput.riskDistance === directVerdict.riskDistance, 'Registry riskDistance forwarded for 3008');
}

// ----------------------------------------------------------------------------
// SUITE 4: Boundary & Degenerate Input Robustness
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 4: Boundary & Degenerate Input Robustness ---');

{
  // Empty candle array
  const empty3007 = ytCrtSmc3007Engine.evaluateSetup('TEST', []);
  assert(empty3007.recommendedSide === null, '3007 returns null on empty candles');
  assert(empty3007.reasons.length > 0, '3007 provides reason for empty candles');

  const empty3008 = ytSolanoVwap3008Engine.evaluateSetup('TEST', []);
  assert(empty3008.recommendedSide === null, '3008 returns null on empty candles');
  assert(empty3008.reasons.length > 0, '3008 provides reason for empty candles');
}

{
  // Insufficient history (<30 for 3007, <35 for 3008)
  const shortCandles: KlinePoint[] = [];
  for (let i = 0; i < 20; i++) {
    shortCandles.push(makeCandle(1700000000 + i * 900, 100, 101, 99, 100, 1000));
  }
  const res3007 = ytCrtSmc3007Engine.evaluateSetup('TEST', shortCandles);
  assert(res3007.recommendedSide === null, '3007 rejects <30 candles');

  const res3008 = ytSolanoVwap3008Engine.evaluateSetup('TEST', shortCandles);
  assert(res3008.recommendedSide === null, '3008 rejects <35 candles');
}

{
  // Zero volume handling
  const zeroVolCandles: KlinePoint[] = [];
  for (let i = 0; i < 50; i++) {
    zeroVolCandles.push(makeCandle(1700000000 + i * 900, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100 + i * 0.1, 0));
  }
  const zeroVol3007 = ytCrtSmc3007Engine.evaluateSetup('TEST', zeroVolCandles);
  assert(zeroVol3007 !== undefined && !isNaN(zeroVol3007.confidenceScore), '3007 handles zero volume without NaN');

  const zeroVol3008 = ytSolanoVwap3008Engine.evaluateSetup('TEST', zeroVolCandles);
  assert(zeroVol3008 !== undefined && !isNaN(zeroVol3008.confidenceScore), '3008 handles zero volume without NaN');
}

console.log('\n================================================================================');
console.log(`PROBE SUMMARY: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
console.log('================================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
