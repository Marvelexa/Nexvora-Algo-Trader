import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard.js';
import { CandleStructureTPCalculator } from '../lib/risk/candleStructureProfitProtectionEngine.js';
import { KlinePoint } from '../src/types.js';

describe('Strategy Engine Freedom & Intermediate Wall TP Verification', () => {
  function create50BarMacroChart(rangeLow: number, rangeHigh: number, currentPrice: number, isBearishRed: boolean): KlinePoint[] {
    const candles: KlinePoint[] = [];
    const baseTime = 1700000000000;

    // Bar 0: Establishes range low
    candles.push({
      time: baseTime,
      open: rangeLow + 0.5,
      high: rangeLow + 1.0,
      low: rangeLow,
      close: rangeLow + 0.8,
      volume: 1000,
    });

    // Bar 25: Establishes range high
    candles.push({
      time: baseTime + 25 * 900000,
      open: rangeHigh - 1.0,
      high: rangeHigh,
      low: rangeHigh - 1.5,
      close: rangeHigh - 0.5,
      volume: 1500,
    });

    // Intermediate bars
    for (let i = 1; i < 48; i++) {
      if (i === 25) continue;
      candles.push({
        time: baseTime + i * 900000,
        open: currentPrice,
        high: currentPrice + 0.5,
        low: currentPrice - 0.5,
        close: currentPrice,
        volume: 800,
      });
    }

    // Bar 48 (Current candle):
    if (isBearishRed) {
      // Shooting star / red pinbar rejection (NOT an engulfing!)
      candles.push({
        time: baseTime + 48 * 900000,
        open: currentPrice + 0.05,
        high: currentPrice + 0.35, // 0.30 upper wick
        low: currentPrice - 0.02,
        close: currentPrice, // closes red with heavy upper wick
        volume: 2000,
      });
    } else {
      // Hammer / green pinbar bounce (NOT an engulfing!)
      candles.push({
        time: baseTime + 48 * 900000,
        open: currentPrice - 0.05,
        high: currentPrice + 0.02,
        low: currentPrice - 0.35, // 0.30 lower wick
        close: currentPrice, // closes green with heavy lower wick
        volume: 2000,
      });
    }

    return candles;
  }

  it('TEST 1: Port 3005 SMC Short at rangePos50 = 0.75 is APPROVED without isVEngulfingConfirmed', () => {
    // 50-bar range: 100 to 200 -> currentPrice = 175 (rangePos50 = 75% premium)
    const candles = create50BarMacroChart(100, 200, 175, true);

    // Verify it is NOT detected as a V-engulfing
    const vEngulfing = UniversalTradeGuard.detectVEngulfingReversal(candles);
    assert.strictEqual(vEngulfing.type !== 'BULLISH_V_ENGULFING' && vEngulfing.type !== 'BEARISH_V_ENGULFING', true);

    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'SELL',
      currentPrice: 175,
      accountCapitalUSD: 178,
      candles15m: candles,
      atr: 2.0,
      activePositions: [], // Slot 1
      port: 3005,
    });

    assert.strictEqual(verdict.allowed, true, `Port 3005 SMC Short MUST be APPROVED! Reason: ${verdict.reason}`);
    assert.ok(!verdict.reason.includes('NO_SELLING_AT_THE_BOTTOM_VETO'));
  });

  it('TEST 2: Port 3008 VWAP Long at rangePos50 = 0.25 is APPROVED without isVEngulfingConfirmed', () => {
    // 50-bar range: 100 to 200 -> currentPrice = 125 (rangePos50 = 25% discount)
    const candles = create50BarMacroChart(100, 200, 125, false);

    // Verify it is NOT detected as a V-engulfing
    const vEngulfing = UniversalTradeGuard.detectVEngulfingReversal(candles);
    assert.strictEqual(vEngulfing.type !== 'BULLISH_V_ENGULFING' && vEngulfing.type !== 'BEARISH_V_ENGULFING', true);

    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'BUY',
      currentPrice: 125,
      accountCapitalUSD: 178,
      candles15m: candles,
      atr: 2.0,
      activePositions: [], // Slot 1
      port: 3008,
    });

    assert.strictEqual(verdict.allowed, true, `Port 3008 VWAP Long MUST be APPROVED! Reason: ${verdict.reason}`);
    assert.ok(!verdict.reason.includes('NO_BUYING_AT_THE_TOP_VETO'));
  });

  it('TEST 3: Intermediate Order Block at +$5 (0.60%) is targeted by TP1; does NOT jump to low50', () => {
    // Current price = 100.0, low50 = 90.0, intermediate Bullish Order Block at 99.45
    // SL = 100.35 (slDistance = 0.35).
    // Wall at 99.45 + 0.06 buffer = 99.51 (safe distance = 0.49 = 1.40R >= 1.05R).
    const candles: KlinePoint[] = [];
    const baseTime = 1700000000000;
    for (let i = 0; i < 40; i++) {
      candles.push({ time: baseTime + i * 900000, open: 100.1, high: 100.4, low: 99.9, close: 100.0, volume: 1000 });
    }
    // Macro low50 established at bar 5
    candles[5] = { time: baseTime + 5 * 900000, open: 90.5, high: 91.0, low: 90.0, close: 90.8, volume: 2000 };

    // Institutional Bullish Order Block at index 25 (down candle at 99.40 followed by displacement > 1.2*ATR)
    candles[25] = { time: baseTime + 25 * 900000, open: 99.45, high: 99.50, low: 99.35, close: 99.40, volume: 3000 };
    candles[26] = { time: baseTime + 26 * 900000, open: 99.40, high: 100.20, low: 99.38, close: 100.15, volume: 4500 };
    candles[27] = { time: baseTime + 27 * 900000, open: 100.15, high: 100.35, low: 100.10, close: 100.30, volume: 4000 };

    // Active candle at 100.0
    candles[candles.length - 1] = { time: baseTime + 39 * 900000, open: 100.1, high: 100.35, low: 99.95, close: 100.0, volume: 1500 };

    const tpResult = UniversalTradeGuard.calculateUniversalStructuralTP({
      symbol: 'SOLUSD',
      side: 'SELL',
      entryPrice: 100.0,
      stopLossPrice: 100.35,
      atr: 0.5,
      candles15m: candles,
      isFastScalpSlot: true,
      low50: 90.0,
      high50: 105.0,
    });

    assert.strictEqual(tpResult.hasPhysicalWall, true, 'Must detect physical wall');
    // TP1 must stop at the intermediate wall (around 99.51), NOT at low50 (90.0)!
    assert.ok(tpResult.targetPrice >= 99.40 && tpResult.targetPrice <= 99.60, `TP1 ($${tpResult.targetPrice}) must snap to intermediate wall (~99.51) instead of low50 ($90.0)`);
    // Runner TP2 should hold the macro low50 runner
    assert.ok(tpResult.tp2Price !== undefined && tpResult.tp2Price <= 91.0, `TP2 ($${tpResult.tp2Price}) should point to macro low50 runner (~90.0)`);
  });

  it('TEST 4: Unbreakable R:R Gatekeeper strictly tightens SL or enforces Reward >= 1.15 * Risk (No SL > TP)', () => {
    // Simulate chart at entry 2396.00 with candles
    const candles = create50BarMacroChart(2350, 2450, 2396, false);
    
    // Evaluate pre-trade gate for Fast Scalp
    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'ETHUSD',
      side: 'BUY',
      currentPrice: 2396.0,
      accountCapitalUSD: 178,
      candles15m: candles,
      atr: 8.0,
      activePositions: [], // Fast Scalp Slot 1
      port: 3005,
    });

    if (verdict.allowed) {
      const reward = Math.abs(verdict.takeProfitPrice - 2396.0);
      const risk = Math.abs(2396.0 - verdict.stopLossPrice);
      assert.ok(
        reward >= 1.15 * risk,
        `UNBREAKABLE LAW: Reward ($${reward.toFixed(2)}) MUST be >= 1.15 * Risk ($${risk.toFixed(2)}), got ratio ${(reward / risk).toFixed(2)}R!`
      );
      assert.ok(
        verdict.takeProfitPrice > 2396.0 && verdict.stopLossPrice < 2396.0,
        'BUY must have TP > Entry and SL < Entry'
      );
      assert.ok(reward > risk, `Take-profit dollar distance ($${reward.toFixed(2)}) MUST be larger than stop-loss distance ($${risk.toFixed(2)})!`);
    } else {
      assert.ok(verdict.reason.length > 0);
    }
  });

  it('TEST 5: If Reward < 1.15 * Risk and SL cannot be safely tightened above fee floor, it is HARD VETOED', () => {
    // Construct pre-trade check with tiny profit pocket where reward is tiny
    const cleanAirwayCheck = UniversalTradeGuard.validateCleanAirwayGate({
      symbol: 'TESTUSD',
      entryPrice: 100.0,
      slDistance: 0.85, // 0.85% SL
      safeTpDistance: 0.58, // 0.58% TP (Inverted 0.68R!)
      isFastScalpSlot: true,
    });

    assert.strictEqual(cleanAirwayCheck.allowed, false, 'Must veto inverted 0.68R trade!');
    assert.strictEqual(cleanAirwayCheck.reasonCode, 'WALL_TOO_CLOSE_BAD_RR_VETO');
  });
});
