import 'dotenv/config';
import { zeroLagPriceActionEngine, ZeroLagPriceActionEngine } from '../lib/strategies/zeroLagPriceActionEngine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

console.log('========================================================================');
console.log('⚡ VERIFICATION SUITE: SYSTEM 3001 ZERO-LAG PRICE ACTION ENGINE');
console.log('   Pure Price Action, Market Structure, Sweeps & Zero Lagging Indicators');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${desc}`);
    failed++;
  }
}

// Helper to generate clean synthetic candles
function makeCandle(time: number, open: number, high: number, low: number, close: number, volume: number = 1000): KlinePoint {
  return { time, open, high, low, close, volume };
}

// 1. Test: Insufficient data handling
{
  const shortCandles: KlinePoint[] = [
    makeCandle(1000, 100, 102, 99, 101),
    makeCandle(2000, 101, 103, 100, 102)
  ];
  const res = zeroLagPriceActionEngine.evaluateSetup('BTCUSD', shortCandles);
  assert('Insufficient data returns null signal', res.recommendedSide === null);
}

// 2. Test: Bullish Liquidity Sweep (Turtle Soup Long)
{
  const candles: KlinePoint[] = [];
  let baseTime = 10000;
  let p = 100;

  // Build 25 bars of structure with a clean swing low at 95.0
  for (let i = 0; i < 15; i++) {
    candles.push(makeCandle(baseTime += 900, p, p + 1.5, p - 1.5, p + 0.2));
  }
  // Make swing high at 105
  candles.push(makeCandle(baseTime += 900, 100, 105, 99.5, 104));
  // Descend to swing low at 95.0
  candles.push(makeCandle(baseTime += 900, 104, 104.2, 97, 98));
  candles.push(makeCandle(baseTime += 900, 98, 98.5, 95.0, 96)); // Pivot low at 95.0
  candles.push(makeCandle(baseTime += 900, 96, 99.0, 95.8, 98.5)); // Bounce to 98.5
  candles.push(makeCandle(baseTime += 900, 98.5, 101.0, 97.5, 100)); // Prior swing high at 101

  // Bar 21: Sweep candle that sweeps below 95.0 (low 94.2) but closes back ABOVE at 96.5 with 70% lower wick
  candles.push(makeCandle(baseTime += 900, 95.5, 96.8, 94.2, 96.5, 2500)); // Lower wick = (95.5 - 94.2) / 2.6 = 50%

  // Current bar: Green follow-through
  candles.push(makeCandle(baseTime += 900, 96.5, 98.0, 96.2, 97.8, 2200));

  const res = zeroLagPriceActionEngine.evaluateSetup('BTCUSD', candles);
  assert('Bullish Liquidity Sweep triggers recommendedSide === BUY', res.recommendedSide === 'BUY');
  assert('Bullish Sweep sets stop loss below sweep low', typeof res.customSL === 'number' && res.customSL < 94.2);
  assert('Bullish Sweep Take Profit enforces strict 1:2.30 R:R minimum', typeof res.riskReward === 'number' && res.riskReward >= 2.30);
  assert('Bullish Sweep Take Profit > Entry Price', typeof res.customTP === 'number' && res.customTP > 97.8);
}

// 3. Test: Bearish Liquidity Sweep (Turtle Soup Short)
{
  const candles: KlinePoint[] = [];
  let baseTime = 10000;
  let p = 100;

  for (let i = 0; i < 15; i++) {
    candles.push(makeCandle(baseTime += 900, p, p + 1.5, p - 1.5, p - 0.2));
  }
  // Swing low at 92.0
  candles.push(makeCandle(baseTime += 900, 98, 98.5, 92.0, 93.5));
  // Swing high at 104.0
  candles.push(makeCandle(baseTime += 900, 93.5, 104.0, 93.0, 102.0)); // Pivot high at 104.0
  candles.push(makeCandle(baseTime += 900, 102.0, 102.5, 99.0, 99.5)); // Drop to 99.5
  candles.push(makeCandle(baseTime += 900, 99.5, 101.0, 98.0, 99.0));

  // Sweep bar: Sweeps above 104.0 (high 105.2) but closes back BELOW at 103.0 with large upper wick
  candles.push(makeCandle(baseTime += 900, 103.5, 105.2, 102.8, 103.0, 2800)); // Upper wick = (105.2 - 103.5) / 2.4 = 70%

  // Current bar: Red rejection bar
  candles.push(makeCandle(baseTime += 900, 103.0, 103.2, 101.5, 101.8, 2400));

  const res = zeroLagPriceActionEngine.evaluateSetup('BTCUSD', candles);
  assert('Bearish Liquidity Sweep triggers recommendedSide === SELL', res.recommendedSide === 'SELL');
  assert('Bearish Sweep sets stop loss above sweep high', typeof res.customSL === 'number' && res.customSL > 105.2);
  assert('Bearish Sweep Take Profit enforces strict 1:2.30 R:R minimum', typeof res.riskReward === 'number' && res.riskReward >= 2.30);
  assert('Bearish Sweep Take Profit < Entry Price', typeof res.customTP === 'number' && res.customTP < 101.8);
}

// 4. Test: StrategyRegistry case 3001 routes cleanly to Zero-Lag Engine
{
  const candles: KlinePoint[] = [];
  let baseTime = 10000;
  for (let i = 0; i < 20; i++) {
    candles.push(makeCandle(baseTime += 900, 100, 102, 98, 100.5));
  }
  const regRes = evaluateStrategyForPort(3001, 'BTCUSD', candles);
  assert('Port 3001 strategyName reflects Zero-Lag Price Action', regRes.strategyName.includes('Zero-Lag'));
}

console.log('\n========================================================================');
console.log(`📊 RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
console.log('========================================================================');

if (failed > 0) {
  process.exit(1);
}
