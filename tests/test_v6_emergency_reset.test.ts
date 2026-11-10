import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  DeltaAutoTraderEngine, 
  ALLOWED_CRYPTO_SYMBOLS, 
  FORBIDDEN_COINS, 
  PRIME_LIQUID_WATCHLIST 
} from '../lib/deltaAutoTraderEngine';
import { KlinePoint } from '../src/types';

describe('V6 Emergency Hard Reset Verification Suite', () => {
  const engine = new DeltaAutoTraderEngine(3005);

  it('Part 1: Single Port, Single Position, Top 2 Coins Only', () => {
    // Port 3005
    assert.strictEqual(engine.port, 3005, 'Engine must run on Port 3005');

    // Max 1 position
    const status = engine.getStatus();
    assert.strictEqual(status.maxConcurrentPositions, 1, 'Max concurrent positions must be strictly 1');

    // Top 2 Coins Only
    assert.strictEqual(ALLOWED_CRYPTO_SYMBOLS.has('BTCUSD'), true, 'BTCUSD must be allowed');
    assert.strictEqual(ALLOWED_CRYPTO_SYMBOLS.has('ETHUSD'), true, 'ETHUSD must be allowed');
    assert.strictEqual(ALLOWED_CRYPTO_SYMBOLS.size, 2, 'Allowed crypto symbols must strictly have only 2 symbols');

    // Altcoins banned
    assert.strictEqual(FORBIDDEN_COINS.has('SOLUSD'), true, 'SOLUSD must be banned');
    assert.strictEqual(FORBIDDEN_COINS.has('XRPUSD'), true, 'XRPUSD must be banned');
    assert.strictEqual(FORBIDDEN_COINS.has('DOGEUSD'), true, 'DOGEUSD must be banned');
    assert.strictEqual(FORBIDDEN_COINS.has('ADAUSD'), true, 'ADAUSD must be banned');

    // Watchlist restricted
    assert.deepStrictEqual(engine.WATCHLIST, ['BTCUSD', 'ETHUSD'], 'Watchlist must be strictly BTCUSD and ETHUSD');
    assert.deepStrictEqual(PRIME_LIQUID_WATCHLIST, ['BTCUSD', 'ETHUSD'], 'Prime liquid watchlist must be strictly BTCUSD and ETHUSD');
  });

  it('Part 3: V6 Closed-Candle Rule accurately triggers on closed 15M candles', () => {
    // Generate synthetic 60 candles with an uptrend
    const candles: KlinePoint[] = [];
    const baseTime = Date.now() - 70 * 15 * 60 * 1000;
    let p = 50000;

    for (let i = 0; i < 60; i++) {
      const step = (i % 2 === 0 ? 20 : -16);
      p += step;
      candles.push({ 
        time: baseTime + i * 15 * 60 * 1000, 
        open: p - (step > 0 ? 8 : -8), 
        high: p + 10, 
        low: p - 10, 
        close: p, 
        volume: 100 
      });
    }

    const prClose = p;
    const closedTime = baseTime + 58 * 15 * 60 * 1000;
    candles[58] = {
      time: closedTime,
      open: prClose - 5,
      high: prClose + 25,
      low: prClose - 20,
      close: prClose + 20,
      volume: 200,
    };
    candles[59] = {
      time: baseTime + 59 * 15 * 60 * 1000,
      open: prClose + 20,
      high: prClose + 40,
      low: prClose + 15,
      close: prClose + 30,
      volume: 50,
    };

    const signal = engine.evaluateV6ClosedCandleRule(candles);
    assert.ok(signal, 'V6 evaluation should trigger signal on closed candle');
    assert.strictEqual(signal.signal, 'BUY', 'Signal must be BUY');
    assert.strictEqual(signal.closedCandle.time, closedTime, 'Evaluated candle must be the closed candle, not forming candle');

    // Test SELL Signal
    const sellCandles: KlinePoint[] = [];
    let sp = 50000;
    for (let i = 0; i < 60; i++) {
      const step = (i % 2 === 0 ? -20 : 16);
      sp += step;
      sellCandles.push({ 
        time: baseTime + i * 15 * 60 * 1000, 
        open: sp - (step > 0 ? 8 : -8), 
        high: sp + 10, 
        low: sp - 10, 
        close: sp, 
        volume: 100 
      });
    }
    const sellPrClose = sp;
    sellCandles[58] = {
      time: closedTime,
      open: sellPrClose + 5,
      high: sellPrClose + 20,
      low: sellPrClose - 25,
      close: sellPrClose - 20,
      volume: 200,
    };
    sellCandles[59] = {
      time: baseTime + 59 * 15 * 60 * 1000,
      open: sellPrClose - 20,
      high: sellPrClose - 15,
      low: sellPrClose - 40,
      close: sellPrClose - 30,
      volume: 50,
    };

    const sellSignal = engine.evaluateV6ClosedCandleRule(sellCandles);
    assert.ok(sellSignal, 'V6 evaluation should trigger SELL signal');
    assert.strictEqual(sellSignal.signal, 'SELL', 'Signal must be SELL');
    assert.strictEqual(sellSignal.closedCandle.time, closedTime, 'Evaluated candle must be the closed candle');
  });

  it('Part 4: Wide Swing-Protected Bracket ($3.00 Max Risk Sizing)', () => {
    // For BTCUSD:
    // entry = 76,000, atr = 600
    // contractValue = 0.001
    // slDistance = max(1.20 * 600, 76000 * 0.0075) = max(720, 570) = 720
    // tpDistance = 2.10 * 600 = 1260
    // riskPerContract = 720 * 0.001 = $0.72 USD
    // contracts = floor(3.00 / 0.72) = 4
    // quantity = 4 * 0.001 = 0.004 BTC
    // actualRiskUSD = 4 * 0.72 = $2.88 USD (strictly <= $3.00 USD)
    // actualRewardUSD = 4 * 1260 * 0.001 = $5.04 USD (~1.75R)
    const btcBrackets = engine.calculateV6Brackets({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: 76000,
      atr14: 600,
    });

    assert.strictEqual(btcBrackets.slDistance, 720, 'SL distance must be 1.20 * ATR = 720');
    assert.strictEqual(btcBrackets.tpDistance, 1260, 'TP distance must be 2.10 * ATR = 1260');
    assert.strictEqual(btcBrackets.contracts, 4, 'Contracts must be Math.floor(3.00 / 0.72) = 4');
    assert.strictEqual(btcBrackets.quantity, 0.004, 'Quantity must be 0.004 BTC');
    assert.ok(btcBrackets.actualRiskUSD <= 3.00, 'Actual risk must never exceed $3.00 USD');
    assert.strictEqual(btcBrackets.actualRiskUSD, 2.88, 'Actual risk should be $2.88 USD');
    assert.strictEqual(btcBrackets.actualRewardUSD, 5.04, 'Actual reward should be $5.04 USD (1.75R)');
    assert.strictEqual(btcBrackets.stopLossPrice, 75280, 'SL price for BUY must be 76000 - 720 = 75280');
    assert.strictEqual(btcBrackets.takeProfitPrice, 77260, 'TP price for BUY must be 76000 + 1260 = 77260');

    // Verify minimum 0.75% distance floor:
    // If ATR is tiny (e.g. 200 on BTC at 76,000, 1.20 * 200 = 240 < 570), SL distance must be 570 (0.75% of 76000)
    const lowVolBrackets = engine.calculateV6Brackets({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: 76000,
      atr14: 200,
    });
    assert.strictEqual(lowVolBrackets.slDistance, 570, 'SL distance must be clamped to minimum 0.75% = 570');
  });
});
