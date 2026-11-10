import { strict as assert } from 'assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { portfolioMarketRegime, MarketRegimeBiasState } from '../lib/risk/portfolioMarketRegimeEngine';
import { YtSidewaysRange3010Engine } from '../lib/strategies/ytSidewaysRange3010Engine';
import { YtSolanoVwap3008Engine } from '../lib/strategies/ytSolanoVwap3008Engine';
import { HybridMasterCryptoSMC3005Engine } from '../lib/strategies/hybridMasterCryptoSMC3005Engine';
import { KlinePoint, DeltaPosition } from '../src/types';

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
  } catch (e: any) {
    console.error(`  ❌ FAIL: ${name}\n     ${e.message}\n`);
    throw e;
  }
}

console.log('🧪 Starting Two-Way Trading & Premium/Discount Strict Gate Tests...\n');

// Build 50 mock 15m candles with known Range Low ($0.0700) and Range High ($0.0760)
function buildRangeCandles(low: number, high: number, count: number = 50): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const span = high - low;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const t = now - (count - i) * 15 * 60 * 1000;
    // Oscillate between low and high
    const mid = low + (span * 0.5);
    const osc = Math.sin(i / 3) * (span * 0.45);
    const close = mid + osc;
    candles.push({
      time: t,
      open: close - 0.0001,
      high: Math.min(high, close + 0.0003),
      low: Math.max(low, close - 0.0003),
      close,
      volume: 1000,
    });
  }
  // Anchor extremes
  candles[10].low = low;
  candles[25].high = high;
  return candles;
}

// ----------------------------------------------------------------------------
// TEST 1: Strict Top Buy Veto (NO_BUYING_AT_THE_TOP_VETO)
// ----------------------------------------------------------------------------
it('STRICT GATE: Never execute BUY when Range_Position >= 0.70 (e.g. DOGE @ $0.07562 in $0.0700-$0.0760 range)', () => {
  const candles = buildRangeCandles(0.0700, 0.0760, 50);
  // Current price at 0.07562 = 93.6% range position
  const curPrice = 0.07562;
  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'DOGEUSD',
    side: 'BUY',
    currentPrice: curPrice,
    accountCapitalUSD: 164,
    candles15m: candles,
    atr: 0.0008,
    activePositions: [],
    decimals: 5,
    tickSize: 0.00001,
  });

  // It must either be strictly vetoed (allowed: false) OR inverted to SELL (executedSide: 'SELL')
  assert.notStrictEqual(verdict.executedSide, 'BUY', 'Executed side must NEVER be BUY at top of range');
  if (verdict.isFlipped) {
    assert.strictEqual(verdict.executedSide, 'SELL', 'When at top resistance, setup flips to SELL');
  } else {
    assert.strictEqual(verdict.allowed, false, 'If not flipped, BUY is strictly vetoed at top');
    assert.ok(verdict.reason.includes('NO_BUYING_AT_THE_TOP_VETO'));
  }
});

// ----------------------------------------------------------------------------
// TEST 2: Strict Bottom Sell Veto (NO_SELLING_AT_THE_BOTTOM_VETO)
// ----------------------------------------------------------------------------
it('STRICT GATE: Never execute SELL when Range_Position <= 0.30 (Bottom Support)', () => {
  const candles = buildRangeCandles(0.0700, 0.0760, 50);
  // Current price at 0.0708 = 13.3% range position
  const curPrice = 0.0708;
  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'DOGEUSD',
    side: 'SELL',
    currentPrice: curPrice,
    accountCapitalUSD: 164,
    candles15m: candles,
    atr: 0.0008,
    activePositions: [],
    decimals: 5,
    tickSize: 0.00001,
  });

  // It must either be strictly vetoed (allowed: false) OR inverted to BUY (executedSide: 'BUY')
  assert.notStrictEqual(verdict.executedSide, 'SELL', 'Executed side must NEVER be SELL at bottom of range');
  if (verdict.isFlipped) {
    assert.strictEqual(verdict.executedSide, 'BUY', 'When at bottom support, setup flips to BUY');
  } else {
    assert.strictEqual(verdict.allowed, false, 'If not flipped, SELL is strictly vetoed at bottom');
    assert.ok(verdict.reason.includes('NO_SELLING_AT_THE_BOTTOM_VETO'));
  }
});

// ----------------------------------------------------------------------------
// TEST 3: Short Permitted at Range Top in Bullish Regime
// ----------------------------------------------------------------------------
it('REGIME ALIGNMENT: Short is ALLOWED at Range Top (Range_Position >= 0.70) even in Bullish Regime', () => {
  const check = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'DOGEUSD',
    side: 'SELL',
    currentPrice: 0.07562,
    vwap15m: 0.0740,
    rangePosition: 0.90, // 90% Premium
    biasState: {
      bias: 'BULLISH',
      timestamp: Date.now(),
      btcPrice: 78500,
      btcVwap15m: 77200,
      btcEma9: 78300,
      btcEma21: 77500,
      btcStructure15m: 'BULLISH',
      btcStructure1h: 'BULLISH',
      btcAdx14: 24,
      breadthPctAboveVwap: 0.90,
      activeBtcPositionSide: null,
      reasons: ['BTC Bullish trend'],
    },
  });

  assert.strictEqual(check.allowed, true, 'Short at Premium Resistance must be allowed in Bullish regime');
  assert.ok(check.reason.includes('BULLISH REGIME EXCEPTION APPROVED'));
});

// ----------------------------------------------------------------------------
// TEST 4: Premature Loss-Cut Suppression (SOLUSD -0.15% Protection)
// ----------------------------------------------------------------------------
it('PREMATURE LOSS-CUT SHIELD: Never auto-close a trade in loss on 1m red noise', () => {
  const dummyCandles: KlinePoint[] = [
    { time: 1, open: 94.50, high: 94.52, low: 94.47, close: 94.48, volume: 100 },
    { time: 2, open: 94.48, high: 94.50, low: 94.46, close: 94.47, volume: 100 }, // Red 1m candle
  ];

  const pos: DeltaPosition = {
    id: 'SOL-1',
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 94.633, // Bought higher
    stopLossPrice: 93.80, // True structural stop loss
    takeProfitPrice: 96.50,
    quantity: 10,
    marginUSD: 30,
    notionalUSD: 946,
    leverage: 30,
    pnlUSD: -1.45, // IN LOSS!
    entryTime: Date.now() - 30000,
  };

  const currentPrice = 94.488; // -0.15% drawdown
  const lock = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice,
    candles1m: dummyCandles,
    candles5m: dummyCandles,
    candles15m: dummyCandles,
    atr: 0.40,
    tickSize: 0.01,
    decimals: 2,
  });

  assert.strictEqual(lock.shouldClose100, false, 'Trade in loss must NEVER be closed early by live reversal filter');
});

// ----------------------------------------------------------------------------
// TEST 5: Port 3010 Range Trading (Buy at Bottom, Sell at Top)
// ----------------------------------------------------------------------------
it('PORT 3010 VIDEO RULE: Only Sell at Range Top (>= 65%), Only Buy at Bottom (<= 35%)', () => {
  // Create calm sideways consolidation with low ADX (< 20)
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 40; i++) {
    const t = now - (40 - i) * 15 * 60 * 1000;
    const base = 1.250 + (i % 2 === 0 ? 0.002 : -0.002);
    candles.push({
      time: t,
      open: base,
      high: base + 0.003,
      low: base - 0.003,
      close: base + (i % 2 === 0 ? 0.001 : -0.001),
      volume: 500,
    });
  }
  // Range: Low ~ 1.247, High ~ 1.253, span ~ 0.006, ATR ~ 0.006
  // Candle 38: tap range high at 1.253
  candles[38].high = 1.255;
  candles[38].close = 1.252;
  // Last Candle (39): Bearish Shooting Star rejection at Range Top (>= 65%)
  const lastBar = candles[39];
  lastBar.open = 1.254;
  lastBar.high = 1.256; // Pierces/touches high (1.255)
  lastBar.low = 1.251;
  lastBar.close = 1.253; // Red close (0.001 body) with upper wick = 0.002 (67% wick >= 50%) in Premium (80% of range)

  const verdict = YtSidewaysRange3010Engine.evaluateSetup('XRPUSD', candles);
  if (verdict.recommendedSide !== 'SELL') {
    console.log('Port 3010 audit:', verdict.reasons, verdict.auditLog);
  }
  assert.strictEqual(verdict.recommendedSide, 'SELL', 'Port 3010 must Short at Range High');
  assert.strictEqual(verdict.setupType, 'BEARISH_RANGE_RESISTANCE_FADE');
});

console.log('\n🎉 ALL TWO-WAY TRADING & PREMIUM/DISCOUNT TESTS PASSED 100%!');
