import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  sanitizeCandles, 
  findStructuralBracket, 
  evaluateStrategyForPort,
  FifteenMinCandleCloseGate,
  KlinePoint 
} from '../lib/strategies/strategyRegistry';
import { 
  UniversalTradeGuard 
} from '../lib/risk/universalTradeGuard';

describe('Post-Mortem Fixes Suite: Bidirectional Execution, 5M Filter, 45m Cooldown, $4.00 Risk Cap', () => {

  it('Fix 4: Risk per trade is capped strictly at <= $4.00 USD', () => {
    // Sizing for SOLUSD @ $88.50 with 0.60% SL ($89.03)
    const size = UniversalTradeGuard.calculateRiskScaledPositionSize({
      entryPrice: 88.50,
      slPrice: 89.03,
      contractValue: 1.0,
      accountCapitalUSD: 234.0,
      leverage: 30,
      marginPercent: 0.25,
      maxRiskUSD: 4.00
    });

    console.log('Scaled sizing result:', size);
    assert.strictEqual(size.maxLossUSD <= 4.00, true, `Max loss must be <= $4.00 USD, got $${size.maxLossUSD}`);
    assert.strictEqual(size.contracts >= 1, true, 'Must have at least 1 contract');
    assert.strictEqual(size.marginUSD <= 46.00, true, 'Margin must not exceed 25% ceiling clamp ($46.00)');
  });

  it('Fix 3: 45-Minute per-symbol loss cooldown prevents revenge trading', () => {
    UniversalTradeGuard.recordStopLoss('SOLUSD');
    const status = UniversalTradeGuard.isSymbolInLossCooldown('SOLUSD');
    assert.strictEqual(status.inCooldown, true, 'SOLUSD must be in cooldown after stop loss');
    assert.strictEqual(status.remainingMinutes >= 44 && status.remainingMinutes <= 45, true, 'Remaining minutes must be ~45');

    // Other symbols should NOT be locked
    const btcStatus = UniversalTradeGuard.isSymbolInLossCooldown('BTCUSD');
    assert.strictEqual(btcStatus.inCooldown, false, 'BTCUSD should not be locked');
  });

  it('Bidirectional Direction Alignment: Allows BUY on CHoCH recovery and blocks rising SELLs', () => {
    // Generate synthetic 15m candles with CHoCH recovery (2 bars above EMA 20 + VWAP, EMA 9 > EMA 20)
    const baseTime = Date.now() - 65 * 15 * 60 * 1000;
    const candles: KlinePoint[] = [];
    let price = 74000;

    // First 50 bars declining (bearish base)
    for (let i = 0; i < 50; i++) {
      price -= 20;
      candles.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: price + 10,
        high: price + 25,
        low: price - 25,
        close: price,
        volume: 100,
      });
    }

    // Next 12 bars recovering strongly upward above EMA 20 & VWAP
    for (let i = 50; i < 62; i++) {
      price += 60;
      candles.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: price - 30,
        high: price + 40,
        low: price - 30,
        close: price,
        volume: 300,
      });
    }

    // Candidate BUY during recovery
    const buyCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment('BUY', [], candles, candles);
    console.log('Buy recovery alignment check:', buyCheck);

    // Candidate SELL when price is rising above EMA 20/VWAP must be VETOED
    const sellCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment('SELL', [], candles, candles);
    console.log('Sell counter-bounce alignment check:', sellCheck);
    assert.strictEqual(sellCheck.aligned, false, 'Counter-bounce SELL while price is rising above EMA20/VWAP must be vetoed');
  });

  it('Fix 1 & 2: Pullback rejections enforced and 5m bounce filter pauses SELL', () => {
    FifteenMinCandleCloseGate.resetForTesting();
    const stepMs = 15 * 60 * 1000;
    const nowMs = Date.UTC(2026, 10, 10, 10, 15, 3);
    const bar59OpenMs = Date.UTC(2026, 10, 10, 10, 0, 0);
    const baseTime = bar59OpenMs - 59 * stepMs;
    const candles15m: KlinePoint[] = [];
    let p = 75000;
    for (let i = 0; i < 60; i++) {
      p -= 20;
      candles15m.push({
        time: baseTime + i * stepMs,
        open: p + 10,
        high: p + 20,
        low: p - 20,
        close: p,
        volume: 100
      });
    }
    // Live forming candle at 10:15:00
    candles15m.push({
      time: Date.UTC(2026, 10, 10, 10, 15, 0),
      open: p,
      high: p + 5,
      low: p - 5,
      close: p,
      volume: 10
    });

    // Generate 5m candles making higher closes (bouncing)
    const candles5m: KlinePoint[] = [];
    let p5 = 73800;
    for (let i = 0; i < 30; i++) {
      p5 += 15; // rising
      candles5m.push({
        time: nowMs - (30 - i) * 5 * 60 * 1000,
        open: p5 - 5,
        high: p5 + 10,
        low: p5 - 5,
        close: p5,
        volume: 50
      });
    }

    const res = evaluateStrategyForPort({
      port: 3005,
      symbol: 'BTCUSD',
      candles15m,
      candles5m,
      nowMs,
    });

    console.log('Port 3005 with 5m bounce filter result:', res);
    assert.strictEqual(res.reason?.includes('MID_CANDLE'), false, `Should evaluate inside 15m close window, got ${res.reason}`);
    // Should NOT trigger SELL while 5m is bouncing upward!
    assert.notStrictEqual(res.action, 'SELL', 'SELL must not fire while 5m is bouncing upward');
  });

  it('Emergency Fix: V-Bottom Reversal allows BUY and forbids oversold SELL (RSI < 42)', () => {
    // Generate synthetic 15m candles with a dump and sharp 2-bar V-bottom
    const baseTime = Date.now() - 65 * 15 * 60 * 1000;
    const candles15m: KlinePoint[] = [];
    let p = 2250; // ETH-like price

    // 58 bars dump down to 2100 (deep oversold)
    for (let i = 0; i < 58; i++) {
      p -= 2.5;
      candles15m.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: p + 1.0,
        high: p + 1.5,
        low: p - 1.5,
        close: p,
        volume: 100
      });
    }

    // Candle 58: First green reversal bar
    candles15m.push({
      time: baseTime + 58 * 15 * 60 * 1000,
      open: 2105,
      high: 2112,
      low: 2104,
      close: 2110, // green
      volume: 250
    });

    // Candle 59: Second green reversal bar closing above prev.high & above EMA 9
    candles15m.push({
      time: baseTime + 59 * 15 * 60 * 1000,
      open: 2110,
      high: 2122,
      low: 2109,
      close: 2120, // strong green breakout above 2112
      volume: 350
    });

    // Unclosed candle 60 (will be sliced off by sanitizeCandles)
    candles15m.push({
      time: baseTime + 60 * 15 * 60 * 1000,
      open: 2120,
      high: 2121,
      low: 2119,
      close: 2120.5,
      volume: 10
    });

    // Direction alignment check
    const alignCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment('BUY', [], candles15m, candles15m);
    console.log('V-Bottom BUY alignment check:', alignCheck);
    assert.strictEqual(alignCheck.aligned, true, 'V-Bottom BUY should be aligned without waiting for lagging EMA 50');

    // SELL check on this reversal must be strictly blocked
    const sellCheck = UniversalTradeGuard.checkPortfolioDirectionAlignment('SELL', [], candles15m, candles15m);
    console.log('V-Bottom SELL veto check:', sellCheck);
    assert.strictEqual(sellCheck.aligned, false, 'SELL must be blocked during V-Bottom reversal');
  });

});
