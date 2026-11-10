import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { KlinePoint, DeltaPosition } from '../src/types';

describe('2+2 Hybrid Slot Allocation & V-Engulfing Scalp Architecture', () => {

  // Helper to create synthetic candles
  function makeCandles(prices: { open: number; high: number; low: number; close: number; volume?: number }[]): KlinePoint[] {
    const baseTime = 1700000000000;
    return prices.map((p, idx) => ({
      time: baseTime + idx * 900000,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume || 100,
    }));
  }

  it('TEST 1: 2-Candle Bullish V-Bottom Engulfing Detection', () => {
    // 5 bars establishing range, then a strong red drop, then strong green engulfing
    const candles = makeCandles([
      { open: 100, high: 101, low: 99.5, close: 100 },
      { open: 100, high: 100.5, low: 99.5, close: 100 },
      { open: 100, high: 100.8, low: 99.6, close: 100.2 },
      { open: 100.2, high: 100.5, low: 99.8, close: 100 },
      { open: 100, high: 100.2, low: 99.5, close: 99.8 },
      // Bar -2: Strong red drop sweeping to 98.8
      { open: 99.8, high: 99.9, low: 98.8, close: 99.0 }, // drop body = 0.8
      // Bar -1: Strong green reversal candle engulfing >= 85%
      { open: 98.9, high: 99.85, low: 98.85, close: 99.75 }, // green body = 0.85 (106% >= 85%)
    ]);

    const result = UniversalTradeGuard.detectVEngulfingReversal(candles);
    assert.strictEqual(result.detected, true, 'Bullish V-engulfing must be detected');
    assert.strictEqual(result.type, 'BULLISH_V_ENGULFING');
    assert.strictEqual(result.side, 'BUY');
    assert.ok(result.reversalBodyRatio >= 0.85, 'Body ratio must be >= 0.85');
    assert.strictEqual(result.triggerWickPrice, 98.8, 'Trigger wick should be the lowest wick');
  });

  it('TEST 2: 2-Candle Bearish V-Top Engulfing Detection', () => {
    const candles = makeCandles([
      { open: 100, high: 100.5, low: 99.5, close: 100 },
      { open: 100, high: 100.5, low: 99.5, close: 100 },
      { open: 100, high: 100.8, low: 99.6, close: 100.2 },
      { open: 100.2, high: 100.5, low: 99.8, close: 100 },
      { open: 100, high: 100.2, low: 99.5, close: 100.1 },
      // Bar -2: Strong green pump testing 101.5
      { open: 100.1, high: 101.5, low: 100.0, close: 101.2 }, // pump body = 1.1
      // Bar -1: Strong red drop engulfing >= 85%
      { open: 101.2, high: 101.3, low: 100.1, close: 100.2 }, // red body = 1.0 (91% >= 85%)
    ]);

    const result = UniversalTradeGuard.detectVEngulfingReversal(candles);
    assert.strictEqual(result.detected, true, 'Bearish V-engulfing must be detected');
    assert.strictEqual(result.type, 'BEARISH_V_ENGULFING');
    assert.strictEqual(result.side, 'SELL');
    assert.ok(result.reversalBodyRatio >= 0.85, 'Body ratio must be >= 0.85');
    assert.strictEqual(result.triggerWickPrice, 101.5, 'Trigger wick should be highest wick');
  });

  it('TEST 3: Clean Airway Gate accepts +$4.80 (0.60%) Target and -$3.80 (0.47%) SL for Fast Scalp Slot (activePositions < 2)', () => {
    // Exact user requirement: +$4.80 (0.60%) target vs -$3.80 (0.47%) SL
    const entryPrice = 100.00;
    const safeTpDistance = 0.60; // 0.60%
    const slDistance = 0.47; // 0.47%
    // actualRR = 0.60 / 0.47 = 1.28R

    // For Fast Scalp Slot 1/2:
    const scalpVerdict = UniversalTradeGuard.validateCleanAirwayGate({
      symbol: 'SOLUSD',
      entryPrice,
      slDistance,
      safeTpDistance,
      isFastScalpSlot: true,
    });

    assert.strictEqual(scalpVerdict.allowed, true, 'Fast scalp slot MUST approve 1.28R with 0.60% profit pocket');
    assert.strictEqual(scalpVerdict.reasonCode, 'CLEAN_AIRWAY_APPROVED');
    assert.ok(scalpVerdict.actualRR >= 1.05, 'Actual RR 1.28 must beat 1.05R min');
  });

  it('TEST 4: Clean Airway Gate REJECTS the same +$4.80 (0.60%) setup for Sniper Runner Slots (activePositions >= 2)', () => {
    const entryPrice = 100.00;
    const safeTpDistance = 0.60; // 0.60%
    const slDistance = 0.47; // 0.47% (RR 1.28 < 1.35 required for Sniper, Pocket 0.60% < 0.65%)

    // For Sniper Runner Slot 3/4 (isFastScalpSlot = false):
    const sniperVerdict = UniversalTradeGuard.validateCleanAirwayGate({
      symbol: 'SOLUSD',
      entryPrice,
      slDistance,
      safeTpDistance,
      isFastScalpSlot: false, // Slots 3 & 4
    });

    assert.strictEqual(sniperVerdict.allowed, false, 'Sniper slot MUST reject 1.28R < 1.35R');
    assert.strictEqual(sniperVerdict.reasonCode, 'WALL_TOO_CLOSE_BAD_RR_VETO');
  });

  it('TEST 5: Fast Scalp Full Pre-Trade Gate Approval when activePositions.length < 2', () => {
    // Generate 15 candles with prior range at 102.0, dropping sharply to 98.8, then clean V-engulfing bounce
    const rawCandles = [];
    rawCandles.push({ open: 105.0, high: 106.0, low: 104.5, close: 105.0 });
    for (let i = 1; i < 13; i++) {
      rawCandles.push({ open: 103.5, high: 104.0, low: 103.0, close: 103.5 });
    }
    rawCandles[13] = { open: 102.8, high: 103.0, low: 100.8, close: 101.0 }; // red drop body = 1.8
    rawCandles[14] = { open: 100.9, high: 102.7, low: 100.85, close: 102.6 }; // green engulfing body = 1.7 (94% >= 85%)
    const candles = makeCandles(rawCandles);

    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'BUY',
      currentPrice: 102.6,
      accountCapitalUSD: 178,
      candles15m: candles,
      atr: 0.5,
      activePositions: [], // 0 active positions -> Slot 1 (Fast Scalp Mode)
      port: 3008,
    });

    assert.strictEqual(verdict.allowed, true, 'Fast Scalp slot MUST be approved for confirmed V-engulfing');
    assert.strictEqual(verdict.isFastScalp, true, 'Must be marked as isFastScalp: true');
    assert.strictEqual(verdict.slotType, 'FAST_SCALP', 'Must be tagged slotType: FAST_SCALP');
    assert.ok(verdict.slDistance / 102.6 <= 0.0050, 'Fast Scalp SL must be clamped <= 0.50%');
  });

  it('TEST 6: Fast Scalp Live Profit Lock - Fee-Plus Breakeven at +$2.00', () => {
    const mockPos: DeltaPosition = {
      id: 'scalp-pos-1',
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: 100.00,
      currentPrice: 100.28, // +0.28% move (+$2.24 USD on 800 notional)
      quantity: 8,
      marginUSD: 26.67,
      notionalUSD: 800,
      leverage: 30,
      takeProfitPrice: 100.70,
      stopLossPrice: 99.55,
      initialStopLossPrice: 99.55,
      atr: 0.40,
      isBreakevenLocked: false,
      pnlUSD: 2.24,
      pnlPercent: 8.4,
      entryTime: Date.now() - 60000,
      strategyName: 'Port 3008 Fast Scalp [BULLISH_V_ENGULFING]',
      shadowConfirmedSeconds: 0,
      isFastScalp: true,
      slotType: 'FAST_SCALP',
    };

    const action = UniversalTradeGuard.evaluateLiveProfitLock({
      position: mockPos,
      currentPrice: 100.28,
      atr: 0.40,
      decimals: 2,
    });

    assert.strictEqual(action.updateBrackets, true, 'Must update brackets to Breakeven at +$2.24');
    assert.strictEqual(action.newStopLossPrice, 100.12, 'SL must lock at Entry + 0.12% buffer ($100.12)');
    assert.strictEqual(action.ratchetStage, 1);
  });

  it('TEST 7: Fast Scalp Live Profit Lock - 100% Cash Out at +$4.00 to +$6.50 Target Zone', () => {
    const mockPos: DeltaPosition = {
      id: 'scalp-pos-2',
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: 100.00,
      currentPrice: 100.60, // +0.60% move (+$4.80 USD on 800 notional)
      quantity: 8,
      marginUSD: 26.67,
      notionalUSD: 800,
      leverage: 30,
      takeProfitPrice: 100.70,
      stopLossPrice: 100.12,
      initialStopLossPrice: 99.55,
      atr: 0.40,
      isBreakevenLocked: true,
      pnlUSD: 4.80, // Hit $4.80 in $4–$7 scalp target zone
      pnlPercent: 18.0,
      entryTime: Date.now() - 120000,
      strategyName: 'Port 3008 Fast Scalp [BULLISH_V_ENGULFING]',
      shadowConfirmedSeconds: 0,
      isFastScalp: true,
      slotType: 'FAST_SCALP',
    };

    const action = UniversalTradeGuard.evaluateLiveProfitLock({
      position: mockPos,
      currentPrice: 100.60,
      atr: 0.40,
      decimals: 2,
    });

    assert.strictEqual(action.shouldClose100, true, 'Fast Scalp MUST close 100% at +$4.80 to free slot');
    assert.ok(action.closeReason.includes('FAST SCALP PROFIT TARGET HIT'), 'Close reason must state scalp target hit');
  });

  it('TEST 8: Strict Isolation of Port 3001', () => {
    // Port 3001 must NEVER be affected by cluster rules
    const verdict3001 = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'BTCUSD',
      side: 'BUY',
      currentPrice: 80000,
      accountCapitalUSD: 178,
      candles15m: makeCandles([{ open: 80000, high: 80100, low: 79900, close: 80000 }]),
      atr: 200,
      activePositions: [],
      port: 3001,
      isManualForce: true,
    });

    assert.strictEqual(verdict3001.allowed, true);
    assert.strictEqual(verdict3001.reversalTag, 'MANUAL_EXECUTION');
  });
});
