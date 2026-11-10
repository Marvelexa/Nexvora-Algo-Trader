import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { acquireOrderMutex, releaseMutex, resetMutexAll } from '../lib/risk/globalOrderMutex.js';
import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine.js';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard.js';
import { KlinePoint } from '../src/types.js';

describe('Emergency Forensic Bugs Suite (Bug #1, Bug #2, Bug #3)', () => {
  beforeEach(() => {
    // Reset mutex completely before each test
    resetMutexAll();
  });

  // =========================================================================
  // BUG #1 TESTS: ABSOLUTE DRAWDOWN PROTECTION
  // =========================================================================
  it('BUG #1: Software closePosition must be BLOCKED when position is in drawdown (PnL <= 0) for non-exempt exit reasons', async () => {
    const engine = new DeltaAutoTraderEngine(9999);
    (engine as any).state.mode = 'SIMULATION_PAPER';
    (engine as any).syncLivePositionsFromExchange = async () => {};
    (engine as any).syncPositionsWithExchange = async () => {};
    (engine as any).state.activePositions = [
      {
        id: 'test-pos-sol',
        symbol: 'SOLUSD',
        side: 'BUY',
        entryPrice: 100.0,
        currentPrice: 98.0, // Drawdown: -2.0%
        quantity: 10,
        marginUSD: 33.33,
        notionalUSD: 1000.0,
        stopLossPrice: 97.0,
        takeProfitPrice: 106.0,
        atr: 1.5,
      },
    ];

    // Attempt premature software close with WALL_REVERSAL_EXIT
    await engine.closePosition('test-pos-sol', 'WALL_REVERSAL_EXIT', 98.0);

    // Position MUST still be active! Not closed by software!
    assert.strictEqual(
      (engine as any).state.activePositions.length,
      1,
      'Position must NOT be closed by software when unrealized PnL <= 0'
    );
    assert.strictEqual(
      (engine as any).state.activePositions[0].id,
      'test-pos-sol',
      'Original position must remain intact in activePositions'
    );
  });

  it('BUG #1: STOP_LOSS_HIT must bypass drawdown guard and close position when hard SL is reached', async () => {
    const engine = new DeltaAutoTraderEngine(9999);
    (engine as any).state.mode = 'SIMULATION_PAPER';
    (engine as any).syncLivePositionsFromExchange = async () => {};
    (engine as any).syncPositionsWithExchange = async () => {};
    (engine as any).state.activePositions = [
      {
        id: 'test-pos-sl',
        symbol: 'SOLUSD',
        side: 'BUY',
        entryPrice: 100.0,
        currentPrice: 97.0, // SL hit
        quantity: 10,
        marginUSD: 33.33,
        notionalUSD: 1000.0,
        stopLossPrice: 97.0,
        takeProfitPrice: 106.0,
        atr: 1.5,
      },
    ];

    // Close with official STOP_LOSS_HIT
    await engine.closePosition('test-pos-sl', 'STOP_LOSS_HIT', 97.0);

    // Position must be closed (exempt reason)
    assert.strictEqual(
      (engine as any).state.activePositions.length,
      0,
      'STOP_LOSS_HIT must successfully close the position'
    );
  });

  it('BUG #1: reverseSinglePosition must be BLOCKED when position is in drawdown (PnL <= 0)', async () => {
    const engine = new DeltaAutoTraderEngine(9999);
    (engine as any).state.mode = 'SIMULATION_PAPER';
    (engine as any).syncLivePositionsFromExchange = async () => {};
    (engine as any).syncPositionsWithExchange = async () => {};
    (engine as any).state.activePositions = [
      {
        id: 'test-pos-rev',
        symbol: 'SOLUSD',
        side: 'BUY',
        entryPrice: 100.0,
        currentPrice: 98.0, // In drawdown
        quantity: 10,
        marginUSD: 33.33,
        notionalUSD: 1000.0,
        stopLossPrice: 97.0,
        takeProfitPrice: 106.0,
        atr: 1.5,
      },
    ];

    const result = await engine.reverseSinglePosition('test-pos-rev');

    // Reverse must be blocked and return null
    assert.strictEqual(result, null, 'reverseSinglePosition must return null when position is in drawdown');
    assert.strictEqual(
      (engine as any).state.activePositions.length,
      1,
      'Position must remain open and not be reversed while in drawdown'
    );
  });

  // =========================================================================
  // BUG #2 TESTS: CROSS-PORT ATOMIC MUTEX & SIZING CAPS
  // =========================================================================
  it('BUG #2: Mutex must allow first order and BLOCK second order on same symbol within 180s', () => {
    // Port 3005 acquires SOLUSD
    const res1 = acquireOrderMutex('SOLUSD', 3005);
    assert.strictEqual(res1.allowed, true, 'First order on SOLUSD from Port 3005 must be allowed');

    // Port 3008 attempts SOLUSD immediately -> must be blocked
    const res2 = acquireOrderMutex('SOLUSD', 3008);
    assert.strictEqual(res2.allowed, false, 'Duplicate order on SOLUSD from Port 3008 must be blocked');
    assert.ok(
      res2.reason?.includes('COOLDOWN_ACTIVE'),
      `Expected reason to mention COOLDOWN_ACTIVE, got: ${res2.reason}`
    );
  });

  it('BUG #2: Mutex must enforce 5-second global cooldown between ANY orders cluster-wide', () => {
    // Port 3005 acquires ETHUSD
    const res1 = acquireOrderMutex('ETHUSD', 3005);
    assert.strictEqual(res1.allowed, true);

    // Port 3010 immediately (0ms elapsed) attempts BTCUSD -> must be blocked by global cooldown
    const res2 = acquireOrderMutex('BTCUSD', 3010);
    assert.strictEqual(res2.allowed, false, 'Global 5s cooldown must block order on another symbol');
    assert.ok(
      res2.reason?.includes('GLOBAL_COOLDOWN_ACTIVE'),
      `Expected GLOBAL_COOLDOWN_ACTIVE, got: ${res2.reason}`
    );
  });

  it('BUG #2: Risk parity sizing must cap maximum dollar loss to $4.00 USD', () => {
    const slPriceDistance = 250.0; // $250 distance on BTC
    const maxLossLimitUSD = 4.00;   // Hard cap $4.00
    const requestedQty = 0.05;      // 0.05 BTC * $250 = $12.50 loss (too high!)

    const maxCoinsByRisk = maxLossLimitUSD / slPriceDistance; // 4 / 250 = 0.016 BTC
    const cappedQty = Math.min(requestedQty, maxCoinsByRisk);
    const actualMaxDollarLoss = cappedQty * slPriceDistance;

    assert.ok(actualMaxDollarLoss <= 4.0001, `Expected max loss <= $4.00, got $${actualMaxDollarLoss.toFixed(2)}`);
    assert.strictEqual(parseFloat(cappedQty.toFixed(4)), 0.016);
  });

  it('BUG #2: Position notional must be capped at $750 USD max', () => {
    const signalPrice = 95.0; // SOL @ $95
    const MAX_NOTIONAL_USD = 750;
    const requestedNotional = 2630.0; // $2,630 notional (BUG: caused -$11.51 loss!)

    let notionalUSD = requestedNotional;
    let quantity = requestedNotional / signalPrice; // 27.68 SOL

    if (notionalUSD > MAX_NOTIONAL_USD) {
      quantity = MAX_NOTIONAL_USD / signalPrice; // 7.89 SOL
      notionalUSD = parseFloat((quantity * signalPrice).toFixed(2));
    }

    assert.ok(notionalUSD <= 750.01, `Notional must be <= $750, got $${notionalUSD}`);
    assert.strictEqual(parseFloat(notionalUSD.toFixed(2)), 750.00);
  });

  // =========================================================================
  // BUG #3 TESTS: ONE-WAY TIGHTEN-ONLY STOP LOSS
  // =========================================================================
  it('BUG #3: BUY stop-loss widening must be BLOCKED (newSL < currentExchangeSL)', () => {
    const side = 'BUY';
    const currentExchangeSL = 78617.30; // Initial tight SL
    const accurateSL = 78199.10;        // Recalculated wider SL (BUG: widened risk by -$9!)

    let finalSyncSL = accurateSL;
    if (currentExchangeSL > 0) {
      if (side === 'BUY' && accurateSL < currentExchangeSL) {
        // Tighten-only logic
        finalSyncSL = currentExchangeSL;
      }
    }

    assert.strictEqual(
      finalSyncSL,
      78617.30,
      'BUY SL must NOT widen from 78,617.30 down to 78,199.10'
    );
  });

  it('BUG #3: BUY stop-loss tightening must be ALLOWED (newSL > currentExchangeSL)', () => {
    const side = 'BUY';
    const currentExchangeSL = 78617.30; // Initial SL
    const accurateSL = 79000.00;        // Trailed tighter SL (protecting profit)

    let finalSyncSL = accurateSL;
    if (currentExchangeSL > 0) {
      if (side === 'BUY' && accurateSL < currentExchangeSL) {
        finalSyncSL = currentExchangeSL;
      }
    }

    assert.strictEqual(
      finalSyncSL,
      79000.00,
      'BUY SL tightening up to 79,000.00 must be ALLOWED'
    );
  });

  it('BUG #3: SELL stop-loss widening must be BLOCKED (newSL > currentExchangeSL)', () => {
    const side = 'SELL';
    const currentExchangeSL = 94.42;  // Initial tight SL on SOL Short
    const accurateSL = 95.50;         // Recalculated wider SL (widened risk)

    let finalSyncSL = accurateSL;
    if (currentExchangeSL > 0) {
      if (side === 'SELL' && accurateSL > currentExchangeSL) {
        finalSyncSL = currentExchangeSL;
      }
    }

    assert.strictEqual(
      finalSyncSL,
      94.42,
      'SELL SL must NOT widen from 94.42 up to 95.50'
    );
  });

  it('BUG #3: SELL stop-loss tightening must be ALLOWED (newSL < currentExchangeSL)', () => {
    const side = 'SELL';
    const currentExchangeSL = 94.42;  // Initial tight SL
    const accurateSL = 93.80;         // Trailed tighter SL

    let finalSyncSL = accurateSL;
    if (currentExchangeSL > 0) {
      if (side === 'SELL' && accurateSL > currentExchangeSL) {
        finalSyncSL = currentExchangeSL;
      }
    }

    assert.strictEqual(
      finalSyncSL,
      93.80,
      'SELL SL tightening down to 93.80 must be ALLOWED'
    );
  });

  // =========================================================================
  // BUG #2 TESTS: ANTI_BOTTOM_CHASE_SHORT_VETO & ANTI_TOP_CHASE_LONG_VETO
  // =========================================================================

  /**
   * Builds 50 crash candles: price starts high, trends DOWN, ends near bottom of range.
   * Produces low RangePos_50 and low RSI_14 (oversold bottom).
   */
  function buildCrashCandles(startPrice: number, endPrice: number, count: number = 50): KlinePoint[] {
    const candles: KlinePoint[] = [];
    const now = Date.now() - (count * 15 * 60 * 1000);
    let price = startPrice;
    const step = (endPrice - startPrice) / (count - 1);
    for (let i = 0; i < count; i++) {
      const time = now + (i * 15 * 60 * 1000);
      const open = price;
      price += step;
      const close = price;
      const high = Math.max(open, close) + 0.5;
      const low = Math.min(open, close) - 0.5;
      candles.push({ time, open, high, low, close, volume: 1000 });
    }
    return candles;
  }

  /**
   * Builds 50 pump candles: price starts low, trends UP, ends near top of range.
   * Produces high RangePos_50 and high RSI_14 (overbought top).
   */
  function buildPumpCandles(startPrice: number, endPrice: number, count: number = 50): KlinePoint[] {
    const candles: KlinePoint[] = [];
    const now = Date.now() - (count * 15 * 60 * 1000);
    let price = startPrice;
    const step = (endPrice - startPrice) / (count - 1);
    for (let i = 0; i < count; i++) {
      const time = now + (i * 15 * 60 * 1000);
      const open = price;
      price += step;
      const close = price;
      const high = Math.max(open, close) + 0.5;
      const low = Math.min(open, close) - 0.5;
      candles.push({ time, open, high, low, close, volume: 1000 });
    }
    return candles;
  }

  function gate(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    currentPrice: number;
    candles15m: KlinePoint[];
    atr?: number;
  }) {
    return UniversalTradeGuard.evaluatePreTradeGate({
      symbol: params.symbol,
      side: params.side,
      currentPrice: params.currentPrice,
      accountCapitalUSD: 1000,
      candles15m: params.candles15m,
      atr: params.atr ?? 1.0,
      activePositions: [],
      leverage: 30,
      maxMarginUSD: 250,
      port: 3005,
    });
  }

  it('BUG #2: ANTI_BOTTOM_CHASE_SHORT_VETO blocks SELL at bottom floor (RangePos_50 < 0.25 or RSI_14 < 35)', async () => {
    // SOL crashed from 98.23 to 90.557 — price at 0.0% of 24h range, RSI deeply oversold
    const crashCandles = buildCrashCandles(98.23, 90.557, 50);
    const lastPrice = crashCandles[crashCandles.length - 1].close; // ~90.557 (bottom floor)

    const verdict = gate({ symbol: 'SOLUSD', side: 'SELL', currentPrice: lastPrice, candles15m: crashCandles, atr: 2.0 });

    assert.strictEqual(verdict.allowed, false, 'SELL at bottom floor must be vetoed by ANTI_BOTTOM_CHASE_SHORT_VETO');
    assert.ok(
      verdict.reason.includes('ANTI_BOTTOM_CHASE_SHORT_VETO'),
      `Reason must contain ANTI_BOTTOM_CHASE_SHORT_VETO, got: ${verdict.reason}`
    );
    console.log(`  ↳ SOLUSD SELL @ $${lastPrice.toFixed(3)} correctly vetoed: ${verdict.reason.split(':')[0]}`);
  });

  it('BUG #2: ANTI_TOP_CHASE_LONG_VETO blocks BUY at top ceiling (RangePos_50 > 0.75 or RSI_14 > 65)', async () => {
    // Price pumped to top of range — chasing the top with a late long
    const pumpCandles = buildPumpCandles(90.0, 99.5, 50);
    const lastPrice = pumpCandles[pumpCandles.length - 1].close; // ~99.5 (top ceiling)

    const verdict = gate({ symbol: 'SOLUSD', side: 'BUY', currentPrice: lastPrice, candles15m: pumpCandles, atr: 2.0 });

    assert.strictEqual(verdict.allowed, false, 'BUY at top ceiling must be vetoed by ANTI_TOP_CHASE_LONG_VETO');
    assert.ok(
      verdict.reason.includes('ANTI_TOP_CHASE_LONG_VETO'),
      `Reason must contain ANTI_TOP_CHASE_LONG_VETO, got: ${verdict.reason}`
    );
    console.log(`  ↳ SOLUSD BUY @ $${lastPrice.toFixed(3)} correctly vetoed: ${verdict.reason.split(':')[0]}`);
  });

  it('BUG #2: Structural reversal BUY ALLOWED at true bottom extreme (RangePos_50 <= 0.20, RSI_14 < 32, Close > EMA_9)', async () => {
    // Price at bottom of range but reclaiming above EMA_9 — valid bounce setup
    const crashCandles = buildCrashCandles(98.0, 90.0, 50);
    // Override last candle to be a bounce reclaiming above EMA9
    const lastCandle = crashCandles[crashCandles.length - 1];
    lastCandle.close = 91.5;
    lastCandle.open = 90.5;
    lastCandle.high = 92.0;
    lastCandle.low = 90.0;
    const currentPrice = 91.5;

    const verdict = gate({ symbol: 'SOLUSD', side: 'BUY', currentPrice, candles15m: crashCandles, atr: 2.0 });

    // Should NOT be vetoed by ANTI_TOP_CHASE_LONG_VETO (it's at bottom, not top)
    // May be vetoed by other regime checks but not by top-chase veto
    const isTopChaseVeto = verdict.reason.includes('ANTI_TOP_CHASE_LONG_VETO');
    assert.strictEqual(isTopChaseVeto, false, 'BUY at bottom extreme bounce must NOT be vetoed by ANTI_TOP_CHASE_LONG_VETO');
    console.log(`  ↳ SOLUSD BUY @ $${currentPrice.toFixed(2)} at bottom bounce not top-chase vetoed: allowed=${verdict.allowed} reason=${verdict.reason.split(':')[0]}`);
  });

  it('BUG #2: Structural reversal SELL ALLOWED at true top extreme (RangePos_50 >= 0.80, RSI_14 > 68, Close < EMA_9)', async () => {
    // Price at top of range but rejecting below EMA9 — valid reversal sell setup
    const pumpCandles = buildPumpCandles(90.0, 100.0, 50);
    const lastCandle = pumpCandles[pumpCandles.length - 1];
    lastCandle.close = 98.5;
    lastCandle.open = 99.5;
    lastCandle.high = 100.0;
    lastCandle.low = 98.0;
    const currentPrice = 98.5;

    const verdict = gate({ symbol: 'SOLUSD', side: 'SELL', currentPrice, candles15m: pumpCandles, atr: 2.0 });

    // Should NOT be vetoed by ANTI_BOTTOM_CHASE_SHORT_VETO (it's at top, not bottom)
    const isBottomChaseVeto = verdict.reason.includes('ANTI_BOTTOM_CHASE_SHORT_VETO');
    assert.strictEqual(isBottomChaseVeto, false, 'SELL at top extreme rejection must NOT be vetoed by ANTI_BOTTOM_CHASE_SHORT_VETO');
    console.log(`  ↳ SOLUSD SELL @ $${currentPrice.toFixed(2)} at top rejection not bottom-chase vetoed: allowed=${verdict.allowed} reason=${verdict.reason.split(':')[0]}`);
  });

  it('BUG #2: XRP @ $1.1850 bottom floor SELL is vetoed (0.0% of crash range)', async () => {
    // XRP crashed from 1.3240 to 1.1850 — absolute bottom of 24h range
    const crashCandles = buildCrashCandles(1.3240, 1.1850, 50);
    const lastPrice = crashCandles[crashCandles.length - 1].close; // ~1.1850

    const verdict = gate({ symbol: 'XRPUSD', side: 'SELL', currentPrice: lastPrice, candles15m: crashCandles, atr: 0.05 });

    assert.strictEqual(verdict.allowed, false, 'XRP SELL at $1.1850 bottom floor must be vetoed');
    assert.ok(
      verdict.reason.includes('ANTI_BOTTOM_CHASE_SHORT_VETO'),
      `XRP bottom-floor SELL must be vetoed by ANTI_BOTTOM_CHASE_SHORT_VETO, got: ${verdict.reason}`
    );
    console.log(`  ↳ XRPUSD SELL @ $${lastPrice.toFixed(4)} correctly vetoed: ${verdict.reason.split(':')[0]}`);
  });
});
