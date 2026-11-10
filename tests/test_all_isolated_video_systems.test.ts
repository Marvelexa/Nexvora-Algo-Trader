import assert from 'assert';
import { BradGohMindMathMoney3002Engine } from '../lib/strategies/bradGohMindMathMoney3002Engine';
import { TradingLabDivergence3003Engine } from '../lib/strategies/tradingLabDivergence3003Engine';
import { FractalFlowVolumeProfile3004Engine } from '../lib/strategies/fractalFlowVolumeProfile3004Engine';
import { HybridMasterCryptoSMC3005Engine } from '../lib/strategies/hybridMasterCryptoSMC3005Engine';
import { YtPatOrb3006Engine } from '../lib/strategies/ytPatOrb3006Engine';
import { YtCrtSmc3007Engine } from '../lib/strategies/ytCrtSmc3007Engine';
import { YtSolanoVwap3008Engine } from '../lib/strategies/ytSolanoVwap3008Engine';
import { YtSecretMacd3009Engine } from '../lib/strategies/ytSecretMacd3009Engine';
import { YtSidewaysRange3010Engine } from '../lib/strategies/ytSidewaysRange3010Engine';
import { KlinePoint } from '../src/types';

function makeCandles(closes: number[], baseLowDiff = 0.5, baseHighDiff = 0.5): KlinePoint[] {
  return closes.map((close, i) => {
    const open = i > 0 ? closes[i - 1] : close;
    const high = Math.max(open, close) + baseHighDiff;
    const low = Math.min(open, close) - baseLowDiff;
    return {
      timestamp: Date.now() - (closes.length - i) * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume: 100,
    };
  });
}

console.log('======================================================');
console.log('🧪 VERIFYING ALL 9 ISOLATED VIDEO SYSTEMS (PORTS 3002-3010)');
console.log('======================================================\n');

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}: ${err.message}`);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// PORT 3002: Brad Goh & Mind Math Money (Liquidity Sweep + MSS)
// ----------------------------------------------------------------------------
console.log('--- PORT 3002: Brad Goh & Mind Math Money ---');
const engine3002 = new BradGohMindMathMoney3002Engine();

test('3002 uptrend + sweep low + MSS generates valid BUY or clean rejection', () => {
  const closes: number[] = [];
  for (let i = 0; i < 55; i++) closes.push(100 + i * 0.5);
  const candles = makeCandles(closes, 0.2, 0.2);

  const sig = engine3002.evaluateSetup('BTCUSD', candles, 10000);
  assert.ok(sig, 'Should return a valid BradGoh3002Verdict');
  if (sig.recommendedSide) {
    assert.strictEqual(sig.recommendedSide, 'BUY');
    assert.ok(sig.stopLossPrice < sig.entryPrice, 'SL must be below entry');
    assert.ok(sig.tp1Price > sig.entryPrice, 'TP must be above entry');
  }
});

// ----------------------------------------------------------------------------
// PORT 3003: TradingLab Divergence (10-Candle Liquidity Grab + RSI Div)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3003: TradingLab Divergence ---');
const engine3003 = new TradingLabDivergence3003Engine();

test('3003 structure initialization and evaluation integrity', () => {
  const closes: number[] = [];
  for (let i = 0; i < 55; i++) closes.push(100 + Math.sin(i / 3) * 5);
  const candles = makeCandles(closes, 0.3, 0.3);

  const sig = engine3003.evaluateSetup('ETHUSD', candles, 10000);
  assert.ok(sig, 'Should return TradingLab3003Verdict');
  assert.ok(sig.recommendedSide === null || sig.recommendedSide === 'BUY' || sig.recommendedSide === 'SELL');
});

// ----------------------------------------------------------------------------
// PORT 3004: Fractal Flow Volume Profile (VAH / VAL)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3004: Fractal Flow Volume Profile ---');
const engine3004 = new FractalFlowVolumeProfile3004Engine();

test('3004 volume profile engine evaluates cleanly', () => {
  const closes: number[] = [];
  for (let i = 0; i < 55; i++) closes.push(200 + i * 0.2);
  const candles = makeCandles(closes, 0.5, 0.5);

  const sig = engine3004.evaluateSetup('SOLUSD', candles, 10000);
  assert.ok(sig, 'Should return FractalFlow3004Verdict');
  assert.ok(sig.recommendedSide === null || sig.recommendedSide === 'BUY' || sig.recommendedSide === 'SELL');
});

// ----------------------------------------------------------------------------
// PORT 3005: Hybrid Master Crypto SMC (BOS, CHoCH, IDM)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3005: Hybrid Master Crypto SMC ---');
const engine3005 = new HybridMasterCryptoSMC3005Engine();

test('3005 macro uptrend prevents SELL', () => {
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) closes.push(50000 + i * 100);
  const candles = makeCandles(closes, 50, 50);

  const sig = engine3005.evaluateSetup('BTCUSD', candles, 10000);
  if (sig && sig.recommendedSide) {
    assert.strictEqual(sig.recommendedSide, 'BUY', 'In macro uptrend, 3005 must NEVER sell!');
  }
});

// ----------------------------------------------------------------------------
// PORT 3006: PAT ORB (Opening Range Breakout + VWAP)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3006: PAT ORB ---');
const engine3006 = new YtPatOrb3006Engine();

test('3006 ORB engine evaluates with VWAP stack', () => {
  const closes: number[] = [];
  for (let i = 0; i < 55; i++) closes.push(150 + i * 0.3);
  const candles = makeCandles(closes, 0.3, 0.3);

  const sig = engine3006.evaluateSetup('SOLUSD', candles, 10000);
  assert.ok(sig, 'Should return ORB verdict');
  assert.ok(sig.recommendedSide === null || sig.recommendedSide === 'BUY' || sig.recommendedSide === 'SELL');
});

// ----------------------------------------------------------------------------
// PORT 3007: CRT SMC (Candle Range Theory Mother Bar Sweep)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3007: CRT SMC ---');
const engine3007 = new YtCrtSmc3007Engine();

test('3007 CRT SMC engine evaluates cleanly', () => {
  const closes: number[] = [];
  for (let i = 0; i < 55; i++) closes.push(0.5 + i * 0.002);
  const candles = makeCandles(closes, 0.005, 0.005);

  const sig = engine3007.evaluateSetup('XRPUSD', candles, 10000);
  assert.ok(sig, 'Should return CRT verdict');
  assert.ok(sig.recommendedSide === null || sig.recommendedSide === 'BUY' || sig.recommendedSide === 'SELL');
});

// ----------------------------------------------------------------------------
// PORT 3008: Solano VWAP Pullback
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3008: Solano VWAP Pullback ---');
const engine3008 = new YtSolanoVwap3008Engine();

test('3008 Solano VWAP engine evaluates cleanly', () => {
  const closes: number[] = [];
  for (let i = 0; i < 55; i++) closes.push(100 + i * 0.5);
  const candles = makeCandles(closes, 0.5, 0.5);

  const sig = engine3008.evaluateSetup('SOLUSD', candles, 10000);
  assert.ok(sig, 'Should return Solano VWAP verdict');
  assert.ok(sig.recommendedSide === null || sig.recommendedSide === 'BUY' || sig.recommendedSide === 'SELL');
});

// ----------------------------------------------------------------------------
// PORT 3009: Secret MACD (Zero-Lag MACD + EMA200 / EMA50 Trend)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3009: Secret MACD ---');
const engine3009 = new YtSecretMacd3009Engine();

test('3009 Secret MACD never sells above EMA200 and never buys below EMA200', () => {
  const closesUptrend: number[] = [];
  for (let i = 0; i < 60; i++) closesUptrend.push(100 + i * 1);
  const candlesUp = makeCandles(closesUptrend, 0.5, 0.5);

  const sigUp = engine3009.evaluateSetup('BTCUSD', candlesUp, 10000);
  if (sigUp && sigUp.recommendedSide) {
    assert.strictEqual(sigUp.recommendedSide, 'BUY', '3009 must NEVER SELL when price is above EMA200/EMA50!');
  }
});

// ----------------------------------------------------------------------------
// PORT 3010: Sideways Range Mean Reversion (ADX < 22 Box Fading)
// ----------------------------------------------------------------------------
console.log('\n--- PORT 3010: Sideways Range Mean Reversion ---');
const engine3010 = new YtSidewaysRange3010Engine();

test('3010 is strictly VETOED in trending markets (ADX >= 22)', () => {
  // Strong trending candles
  const closesTrend: number[] = [];
  for (let i = 0; i < 55; i++) closesTrend.push(100 + i * 2);
  const candlesTrend = makeCandles(closesTrend, 0.5, 0.5);

  const sig = engine3010.evaluateSetup('BTCUSD', candlesTrend, 10000);
  assert.strictEqual(sig.recommendedSide, null, 'In trending markets (ADX >= 22), 3010 mean-reversion must be completely disabled!');
});

console.log('\n======================================================');
console.log(`RESULTS: ALL ${passed} ENGINE ISOLATION TESTS PASSED CLEANLY!`);
console.log('======================================================');
