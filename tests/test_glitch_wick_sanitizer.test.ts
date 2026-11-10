import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  sanitizeCandles, 
  findStructuralBracket, 
  calcATR, 
  KlinePoint 
} from '../lib/strategies/strategyRegistry';
import { 
  UniversalTradeGuard 
} from '../lib/risk/universalTradeGuard';

describe('Delta Testnet Glitch-Wick Sanitizer & True Reversal Zone SL/TP Suite', () => {

  it('Part 1: sanitizeCandles successfully clamps a freak needle wick', () => {
    // Normal candle with body at $2,225 - $2,235, but freak high at $2,424.55 (+8.5%)
    const glitchCandle: KlinePoint = {
      time: Date.now(),
      open: 2226.0,
      close: 2235.0,
      high: 2424.55, // Freak needle glitch!
      low: 2224.0,
      volume: 1000,
    };

    const sanitized = sanitizeCandles([glitchCandle])[0];

    // bodyTop is 2235.0
    // effectiveHigh should be clamped to 2235.0 * 1.0045 = 2245.0575
    assert.strictEqual(sanitized.high < 2246.0, true, `High must be clamped below 2246.0, got ${sanitized.high}`);
    assert.strictEqual(sanitized.high < 2400.0, true, `Freak needle to 2424.55 must be completely eliminated`);
    assert.strictEqual(sanitized.close, 2235.0, 'Body close must remain intact');
    assert.strictEqual(sanitized.open, 2226.0, 'Body open must remain intact');
  });

  it('Part 2: findStructuralBracket places SL at ~$2,238.50 and NEVER at $2,424.55 on ETH Short', () => {
    const baseTime = Date.now() - 30 * 15 * 60 * 1000;
    const candles: KlinePoint[] = [];

    // 25 candles with real body tops at ~$2,236 and bottoms at ~$2,225
    for (let i = 0; i < 25; i++) {
      candles.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: 2228.0 + (i % 2 === 0 ? 3 : -3),
        close: 2232.0 + (i % 2 === 0 ? 4 : -4),
        high: 2237.5,
        low: 2224.0,
        volume: 500,
      });
    }

    // Insert the exact Testnet Freak Glitch Wick at candle index 20
    candles[20] = {
      time: baseTime + 20 * 15 * 60 * 1000,
      open: 2227.0,
      close: 2236.0, // Body top is 2236.0 (Reversal resistance)
      high: 2424.55,  // Freak single-tick needle to $2,424.55!
      low: 2225.0,
      volume: 800,
    };

    const entryPrice = 2226.03;
    const atr = calcATR(candles, 14);

    const bracket = findStructuralBracket(candles, 'SELL', entryPrice, atr);

    console.log(`Bracket Result -> SL: $${bracket.slPrice}, TP: $${bracket.tpPrice}`);

    // SL MUST be placed near ~$2,238.50 (2236 * 1.0012 = ~$2238.68), ~0.56% away from entry
    assert.strictEqual(bracket.slPrice < 2242.0, true, `SL ($${bracket.slPrice}) must be near reversal body ~$2238.50`);
    assert.strictEqual(bracket.slPrice >= 2237.0, true, `SL ($${bracket.slPrice}) must be above reversal body $2236`);
    assert.strictEqual(bracket.slPrice < 2300.0, true, `SL must NEVER be at glitch price $2424.55`);

    // Distance must be clamped in [0.50%, 0.85%]
    const slDistPct = (bracket.slPrice - entryPrice) / entryPrice;
    assert.strictEqual(slDistPct >= 0.0050 && slDistPct <= 0.0085, true, `SL Distance (${(slDistPct * 100).toFixed(2)}%) must be within [0.50%, 0.85%]`);

    // TP must be in [0.65%, 1.15%]
    const tpDistPct = (entryPrice - bracket.tpPrice) / entryPrice;
    assert.strictEqual(tpDistPct >= 0.0065 && tpDistPct <= 0.0115, true, `TP Distance (${(tpDistPct * 100).toFixed(2)}%) must be within [0.65%, 1.15%]`);
  });

  it('Part 3: UniversalTradeGuard.validateAndBuildBracket enforces unbreakable pre-order SL clamp', () => {
    UniversalTradeGuard.resetCandleDeduplication('ETHUSD');

    const baseTime = Date.now() - 30 * 15 * 60 * 1000;
    const candles: KlinePoint[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push({
        time: baseTime + i * 15 * 60 * 1000,
        open: 2228.0,
        close: 2235.0,
        high: (i === 18 ? 2424.55 : 2238.0), // Glitch at index 18
        low: 2224.0,
        volume: 500,
      });
    }

    const guard = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'ETHUSD',
      side: 'SELL',
      entryPrice: 2226.03,
      candles15m: candles,
      contractValue: 0.01,
      accountCapitalUSD: 178.57,
      leverage: 30,
    });

    assert.strictEqual(guard.approved, true);
    assert.strictEqual(guard.slPrice < 2242.0, true, `Guard SL ($${guard.slPrice}) must NEVER accept glitch price`);
    assert.strictEqual(guard.slPrice >= 2237.0, true, `Guard SL ($${guard.slPrice}) must be near reversal body`);

    const slDistPct = (guard.slPrice - 2226.03) / 2226.03;
    assert.strictEqual(slDistPct <= 0.0085, true, `SL Distance must not exceed 0.85%`);
    console.log(`Guard Sizing Result -> Contracts: ${guard.contracts}, SL: $${guard.slPrice} (${(slDistPct * 100).toFixed(2)}%), TP: $${guard.tpPrice}, MaxLoss: -$${guard.expectedMaxLossUSD} USD`);
  });

});
