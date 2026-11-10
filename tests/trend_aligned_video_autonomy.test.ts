import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { ReversalProximityFlipper } from '../lib/risk/reversalProximityFlipper';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

function generateTrendCandles(type: 'BULLISH' | 'BEARISH', count: number = 60): KlinePoint[] {
  const candles: KlinePoint[] = [];
  let price = type === 'BULLISH' ? 100.0 : 200.0;
  const drift = type === 'BULLISH' ? 0.7 : -0.7;
  const now = Date.now() - count * 15 * 60 * 1000;

  // Generate strong trend for first (count - 5) bars
  for (let i = 0; i < count - 5; i++) {
    const open = price;
    price += drift;
    const close = price;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    candles.push({
      time: now + i * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume: 1500,
    });
  }

  // Create a peak swing high/low that leaves room to run
  const peakOpen = price;
  const peakClose = type === 'BULLISH' ? peakOpen + 2.0 : peakOpen - 2.0;
  candles.push({
    time: now + (count - 5) * 15 * 60 * 1000,
    open: peakOpen,
    high: Math.max(peakOpen, peakClose) + 2.0,
    low: Math.min(peakOpen, peakClose) - 0.5,
    close: peakClose,
    volume: 3000,
  });
  price = peakClose;

  // Pullback bars to retest EMA (pulls back ~25% of the range so rangePos50 is ~70-75% for Bull, ~25-30% for Bear)
  const pullbackDrift = type === 'BULLISH' ? -1.2 : 1.2;
  for (let i = count - 4; i < count - 1; i++) {
    const open = price;
    price += pullbackDrift;
    const close = price;
    candles.push({
      time: now + i * 15 * 60 * 1000,
      open,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      close,
      volume: 1200,
    });
  }

  // Final trigger bar: reclaims above EMA9 to trigger clean trend continuation
  const lastOpen = price;
  const lastClose = type === 'BULLISH' ? lastOpen + 0.6 : lastOpen - 0.6;
  candles.push({
    time: now + (count - 1) * 15 * 60 * 1000,
    open: lastOpen,
    high: Math.max(lastOpen, lastClose) + 0.4,
    low: Math.min(lastOpen, lastClose) - 0.4,
    close: lastClose,
    volume: 2500,
  });

  return candles;
}

describe('Trend-Aligned Video Strategy Autonomy & Zero Signal Inversion Suite', () => {

  it('DELIVERABLE 1: ReversalProximityFlipper MUST NEVER invert strategy signals', () => {
    const bullCandles = generateTrendCandles('BULLISH', 60);
    const bearCandles = generateTrendCandles('BEARISH', 60);

    // Test BUY signal
    const buyFlip = ReversalProximityFlipper.evaluateProximityFlip({
      symbol: 'SOLUSD',
      side: 'BUY',
      currentPrice: bullCandles[bullCandles.length - 1].close,
      atr: 1.0,
      candles15m: bullCandles,
    });
    assert.strictEqual(buyFlip.isFlipped, false, 'BUY signal must NOT be flipped');
    assert.strictEqual(buyFlip.executedSide, 'BUY', 'Executed side must remain BUY');

    // Test SELL signal
    const sellFlip = ReversalProximityFlipper.evaluateProximityFlip({
      symbol: 'SOLUSD',
      side: 'SELL',
      currentPrice: bearCandles[bearCandles.length - 1].close,
      atr: 1.0,
      candles15m: bearCandles,
    });
    assert.strictEqual(sellFlip.isFlipped, false, 'SELL signal must NOT be flipped');
    assert.strictEqual(sellFlip.executedSide, 'SELL', 'Executed side must remain SELL');

    // Test mid-trade auto flip is disabled
    const mockPos: any = { id: 'p1', symbol: 'SOLUSD', side: 'BUY', entryPrice: 100, entryTime: Date.now() - 300000 };
    const midFlip = ReversalProximityFlipper.evaluateMidTradeAutoFlip({
      position: mockPos,
      currentPrice: 105,
      atr: 1.0,
      candles15m: bullCandles,
    });
    assert.strictEqual(midFlip.shouldAutoReverse, false, 'Mid-trade reversing must be permanently disabled');
    assert.strictEqual(midFlip.reverseSide, null, 'reverseSide must be null');
  });

  it('DELIVERABLE 2: UniversalTradeGuard MUST VETO counter-trend SHORTS during Bullish Trend and APPROVE trend BUYS', () => {
    const bullCandles = generateTrendCandles('BULLISH', 60);
    const curPrice = bullCandles[bullCandles.length - 1].close;

    // Counter-trend SELL during Bullish Trend MUST be vetoed
    const sellVerdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'SELL',
      currentPrice: curPrice,
      accountCapitalUSD: 193,
      candles15m: bullCandles,
      atr: 1.0,
      activePositions: [],
    });
    assert.strictEqual(sellVerdict.allowed, false, 'Counter-trend SELL in Bullish Trend must be rejected');
    assert.ok(
      sellVerdict.reason.includes('NO_SELLING_IN_BULLISH_TREND_VETO') || sellVerdict.reason.includes('BULLISH'),
      `Reason must cite Bullish trend veto: got "${sellVerdict.reason}"`
    );

    // Trend-following BUY during Bullish Trend MUST be approved
    const buyVerdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'BUY',
      currentPrice: curPrice,
      accountCapitalUSD: 193,
      candles15m: bullCandles,
      atr: 1.0,
      activePositions: [],
    });
    assert.strictEqual(buyVerdict.allowed, true, `Trend BUY in Bullish Trend must be approved: got "${buyVerdict.reason}"`);
    assert.strictEqual(buyVerdict.executedSide, 'BUY', 'Executed side must be BUY');
    assert.strictEqual(buyVerdict.isFlipped, false, 'Signal must not be flipped');
  });

  it('DELIVERABLE 2: UniversalTradeGuard MUST VETO counter-trend LONGS during Bearish Trend and APPROVE trend SELLS', () => {
    const bearCandles = generateTrendCandles('BEARISH', 60);
    const curPrice = bearCandles[bearCandles.length - 1].close;

    // Counter-trend BUY during Bearish Trend MUST be vetoed
    const buyVerdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'BUY',
      currentPrice: curPrice,
      accountCapitalUSD: 193,
      candles15m: bearCandles,
      atr: 1.0,
      activePositions: [],
    });
    assert.strictEqual(buyVerdict.allowed, false, 'Counter-trend BUY in Bearish Trend must be rejected');
    assert.ok(
      buyVerdict.reason.includes('NO_BUYING_IN_BEARISH_TREND_VETO') || buyVerdict.reason.includes('BEARISH'),
      `Reason must cite Bearish trend veto: got "${buyVerdict.reason}"`
    );

    // Trend-following SELL during Bearish Trend MUST be approved
    const sellVerdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'SELL',
      currentPrice: curPrice,
      accountCapitalUSD: 193,
      candles15m: bearCandles,
      atr: 1.0,
      activePositions: [],
    });
    assert.strictEqual(sellVerdict.allowed, true, `Trend SELL in Bearish Trend must be approved: got "${sellVerdict.reason}"`);
    assert.strictEqual(sellVerdict.executedSide, 'SELL', 'Executed side must be SELL');
    assert.strictEqual(sellVerdict.isFlipped, false, 'Signal must not be flipped');
  });

  it('DELIVERABLE 3: Across ALL 9 PORTS (3002–3010), NO port may emit counter-trend signals or flipped orders', () => {
    const bullCandles = generateTrendCandles('BULLISH', 60);
    const bearCandles = generateTrendCandles('BEARISH', 60);
    const ports = [3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];

    for (const port of ports) {
      // 1. In a Bearish Trend, NO port is allowed to emit a counter-trend BUY
      const bearEval = evaluateStrategyForPort(port, 'SOLUSD', bearCandles);
      assert.notStrictEqual(
        bearEval.signal,
        'BUY',
        `Port ${port} MUST NOT emit counter-trend BUY during a Bearish Trend! Got ${bearEval.signal}`
      );

      // 2. In a Bullish Trend, NO port is allowed to emit a counter-trend SELL
      const bullEval = evaluateStrategyForPort(port, 'SOLUSD', bullCandles);
      assert.notStrictEqual(
        bullEval.signal,
        'SELL',
        `Port ${port} MUST NOT emit counter-trend SELL during a Bullish Trend! Got ${bullEval.signal}`
      );
    }
  });

});
