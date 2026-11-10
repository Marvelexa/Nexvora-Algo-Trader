import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  evaluateStrategyForPort, 
  detectNonOverlappingPriceAction, 
  FifteenMinCandleCloseGate,
  calcEMA, 
  calcATR, 
  calcRSI, 
  calcBollinger, 
  KlinePoint 
} from '../lib/strategies/strategyRegistry';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';

describe('Price-Action Sniper Triggers Suite (W-Bottom, M-Top Reversal, Zero-Overlap Waterfall)', () => {

  it('1. W-Pattern Double Bottom Reversal triggers PA_W_BOTTOM_REVERSAL_BUY', () => {
    FifteenMinCandleCloseGate.resetForTesting();
    const stepMs = 15 * 60 * 1000;
    const nowMs = Date.UTC(2026, 10, 10, 10, 15, 3); // 3s after 10:15:00 close
    const bar59OpenMs = Date.UTC(2026, 10, 10, 10, 0, 0); // closed at 10:15:00
    const baseTime = bar59OpenMs - 59 * stepMs;
    const candles15m: KlinePoint[] = [];

    // Create 45 base candles
    for (let i = 0; i < 45; i++) {
      candles15m.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: 2150,
        high: 2155,
        low: 2145,
        close: 2150,
        volume: 200,
      });
    }

    // Leg 1 Low: Bar 46-48 dumps to swingLow1 = 2100
    candles15m.push({
      time: baseTime + 46 * 15 * 60 * 1000,
      open: 2150,
      high: 2152,
      low: 2120,
      close: 2125,
      volume: 400,
    });
    candles15m.push({
      time: baseTime + 47 * 15 * 60 * 1000,
      open: 2125,
      high: 2130,
      low: 2099, // swingLow1
      close: 2105,
      volume: 800,
    });
    candles15m.push({
      time: baseTime + 48 * 15 * 60 * 1000,
      open: 2105,
      high: 2120,
      low: 2102,
      close: 2118,
      volume: 400,
    });

    // Middle Neckline Peak: Bars 49-52 bounce to 2135
    for (let i = 49; i <= 52; i++) {
      candles15m.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: 2118 + (i - 49) * 4,
        high: 2125 + (i - 49) * 4,
        low: 2116 + (i - 49) * 4,
        close: 2122 + (i - 49) * 4,
        volume: 250,
      });
    }

    // Leg 2 Low: Bars 53-57 re-test support near 2102 (Double Bottom / Higher Low)
    candles15m.push({
      time: baseTime + 53 * 15 * 60 * 1000,
      open: 2130,
      high: 2132,
      low: 2115,
      close: 2116,
      volume: 300,
    });
    candles15m.push({
      time: baseTime + 54 * 15 * 60 * 1000,
      open: 2116,
      high: 2118,
      low: 2105,
      close: 2107,
      volume: 350,
    });
    candles15m.push({
      time: baseTime + 55 * 15 * 60 * 1000,
      open: 2107,
      high: 2110,
      low: 2101, // Leg 2 floor holds above 2099
      close: 2103,
      volume: 400,
    });
    candles15m.push({
      time: baseTime + 56 * 15 * 60 * 1000,
      open: 2103,
      high: 2108,
      low: 2100,
      close: 2105,
      volume: 350,
    });
    candles15m.push({
      time: baseTime + 57 * 15 * 60 * 1000,
      open: 2105,
      high: 2112,
      low: 2104,
      close: 2110,
      volume: 400,
    });

    // Bar 58 (prev): consolidates at 2110-2114
    candles15m.push({
      time: baseTime + 58 * 15 * 60 * 1000,
      open: 2110,
      high: 2114,
      low: 2108,
      close: 2112,
      volume: 300,
    });

    // Bar 59 (current closed candle c): Strong Green Reclaim candle breaking above prev.high & EMA 9
    candles15m.push({
      time: baseTime + 59 * 15 * 60 * 1000,
      open: 2112,
      high: 2125,
      low: 2111,
      close: 2124, // strong green breakout
      volume: 600,
    });

    // Unclosed forming candle 60 (to be sliced off)
    candles15m.push({
      time: baseTime + 60 * 15 * 60 * 1000,
      open: 2124,
      high: 2126,
      low: 2123,
      close: 2125,
      volume: 20,
    });

    const res = evaluateStrategyForPort({
      port: 3005,
      symbol: 'ETHUSD',
      candles15m,
      nowMs,
    });

    console.log('W-Bottom Reversal evaluation result:', res);
    assert.strictEqual(res.action, 'BUY');
    assert.strictEqual(res.reason, 'PA_W_BOTTOM_REVERSAL_BUY');
    assert.strictEqual(res.confidence >= 90, true);
  });

  it('2. M-Pattern Double Top Reversal triggers PA_M_TOP_REVERSAL_SELL', () => {
    FifteenMinCandleCloseGate.resetForTesting();
    const stepMs = 15 * 60 * 1000;
    const nowMs = Date.UTC(2026, 10, 10, 10, 15, 3); // 3s after 10:15:00 close
    const bar59OpenMs = Date.UTC(2026, 10, 10, 10, 0, 0);
    const baseTime = bar59OpenMs - 59 * stepMs;
    const candles15m: KlinePoint[] = [];

    // Create 45 base candles
    for (let i = 0; i < 45; i++) {
      candles15m.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: 73000,
        high: 73100,
        low: 72900,
        close: 73000,
        volume: 200,
      });
    }

    // Leg 1 High: Bar 46-48 surges to swingHigh1 = 75500
    candles15m.push({
      time: baseTime + 46 * 15 * 60 * 1000,
      open: 73000,
      high: 74200,
      low: 72950,
      close: 74100,
      volume: 500,
    });
    candles15m.push({
      time: baseTime + 47 * 15 * 60 * 1000,
      open: 74100,
      high: 75520, // swingHigh1
      low: 74050,
      close: 75450,
      volume: 900,
    });
    candles15m.push({
      time: baseTime + 48 * 15 * 60 * 1000,
      open: 75450,
      high: 75480,
      low: 75100,
      close: 75150,
      volume: 400,
    });

    // Middle Valley: Bars 49-52 pull back to 74600
    for (let i = 49; i <= 52; i++) {
      candles15m.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: 75150 - (i - 49) * 150,
        high: 75200 - (i - 49) * 150,
        low: 74600 - (i - 49) * 50,
        close: 74700 - (i - 49) * 50,
        volume: 300,
      });
    }

    // Leg 2 High: Bars 53-57 re-test ceiling near 75450
    candles15m.push({
      time: baseTime + 53 * 15 * 60 * 1000,
      open: 74700,
      high: 75100,
      low: 74650,
      close: 75050,
      volume: 350,
    });
    candles15m.push({
      time: baseTime + 54 * 15 * 60 * 1000,
      open: 75050,
      high: 75350,
      low: 75000,
      close: 75300,
      volume: 400,
    });
    candles15m.push({
      time: baseTime + 55 * 15 * 60 * 1000,
      open: 75300,
      high: 75460, // Leg 2 ceiling re-test near 75520
      low: 75250,
      close: 75400,
      volume: 450,
    });
    candles15m.push({
      time: baseTime + 56 * 15 * 60 * 1000,
      open: 75400,
      high: 75450,
      low: 75320,
      close: 75380,
      volume: 300,
    });
    candles15m.push({
      time: baseTime + 57 * 15 * 60 * 1000,
      open: 75380,
      high: 75420,
      low: 75300,
      close: 75350,
      volume: 250,
    });

    // Bar 58 (prev): green hesitation candle near top
    candles15m.push({
      time: baseTime + 58 * 15 * 60 * 1000,
      open: 75350,
      high: 75430,
      low: 75340,
      close: 75410,
      volume: 300,
    });

    // Bar 59 (current closed candle c): Massive Red Rejection candle breaking below prev.low
    candles15m.push({
      time: baseTime + 59 * 15 * 60 * 1000,
      open: 75410,
      high: 75420,
      low: 75050,
      close: 75100, // strong red breakdown
      volume: 750,
    });

    // Unclosed forming candle 60 (to be sliced off)
    candles15m.push({
      time: baseTime + 60 * 15 * 60 * 1000,
      open: 75100,
      high: 75120,
      low: 75080,
      close: 75110,
      volume: 15,
    });

    const res = evaluateStrategyForPort({
      port: 3005,
      symbol: 'BTCUSD',
      candles15m,
      nowMs,
    });

    console.log('M-Top Reversal evaluation result:', res);
    assert.strictEqual(res.action, 'SELL');
    assert.strictEqual(res.reason, 'PA_M_TOP_REVERSAL_SELL');
    assert.strictEqual(res.confidence >= 90, true);
  });

  it('3. Zero-Overlap Guarantee: Priority Waterfall returns strictly ONE pattern result', () => {
    // Generate synthetic candles where multiple criteria might loosely apply
    const closes = [75000, 75100, 75050, 75200, 75150, 75300];
    const bb = { upper: 75500, lower: 74800, middle: 75150 };
    const dummyCandles: KlinePoint[] = closes.map((c, i) => ({
      time: Date.now() - (closes.length - i) * 15 * 60 * 1000,
      open: c - 20,
      high: c + 30,
      low: c - 30,
      close: c,
      volume: 100,
    }));

    const result = detectNonOverlappingPriceAction(
      dummyCandles,
      75150,
      75100,
      150,
      55,
      52,
      bb
    );

    // Guaranteed single output with valid fields
    assert.strictEqual(typeof result.matched, 'boolean');
    assert.strictEqual(['BUY', 'SELL', 'WAIT'].includes(result.side), true);
    assert.strictEqual(typeof result.patternName, 'string');
    assert.strictEqual(typeof result.confidence, 'number');
    assert.strictEqual(typeof result.isMajorReversal, 'boolean');
  });

  it('4. UniversalTradeGuard allows PA_ patterns without lagging EMA leader veto', () => {
    // W-Bottom BUY bypasses leader lock
    const wCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment(
      'BUY',
      [],
      [],
      [],
      'PA_W_BOTTOM_REVERSAL_BUY'
    );
    console.log('W-Bottom guard alignment check:', wCheck);
    assert.strictEqual(wCheck.aligned, true);

    // M-Top SELL bypasses leader lock
    const mCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment(
      'SELL',
      [],
      [],
      [],
      'PA_M_TOP_REVERSAL_SELL'
    );
    console.log('M-Top guard alignment check:', mCheck);
    assert.strictEqual(mCheck.aligned, true);

    // Hammer Pin-Bar BUY bypasses leader lock
    const hammerCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment(
      'BUY',
      [],
      [],
      [],
      'PA_HAMMER_PINBAR_BUY'
    );
    console.log('Hammer Pin-bar guard alignment check:', hammerCheck);
    assert.strictEqual(hammerCheck.aligned, true);
  });

});
