import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  calcADX,
  classifyTradeTierAndBuildBracket,
  evaluateStrategyForPort,
  FifteenMinCandleCloseGate,
  KlinePoint,
} from '../lib/strategies/strategyRegistry';
import {
  HybridSixSlotManager,
  UniversalTradeGuard,
} from '../lib/risk/universalTradeGuard';
import {
  DeltaExchangeEngine,
  toDeltaSymbol,
} from '../lib/deltaExchangeEngine';
import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine';

function buildTrendingCandles(opts: {
  count: number;
  startPrice: number;
  step: number;
  intervalMinutes?: number;
  baseTimeMs?: number;
}): KlinePoint[] {
  const stepMs = (opts.intervalMinutes || 15) * 60 * 1000;
  const baseTime = opts.baseTimeMs !== undefined ? opts.baseTimeMs : (Date.now() - opts.count * stepMs);
  const candles: KlinePoint[] = [];
  let p = opts.startPrice;

  for (let i = 0; i < opts.count; i++) {
    const open = p;
    const close = p + opts.step;
    const high = Math.max(open, close) + Math.abs(opts.step) * 0.25;
    const low = Math.min(open, close) - Math.abs(opts.step) * 0.25;
    candles.push({
      time: baseTime + i * stepMs,
      open,
      high,
      low,
      close,
      volume: 500,
    });
    p = close;
  }
  return candles;
}

describe('Master 6-Slot Hybrid, Two-Tier ROE & Guaranteed Exchange Bracket Suite', () => {
  const originalFetch = globalThis.fetch;
  const envBackup = {
    PORT: process.env.PORT,
    DELTA_IS_SIMULATION: process.env.DELTA_IS_SIMULATION,
    PAPER_TRADING: process.env.PAPER_TRADING,
    DELTA_TRADING_MODE: process.env.DELTA_TRADING_MODE,
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.PORT = envBackup.PORT;
    process.env.DELTA_IS_SIMULATION = envBackup.DELTA_IS_SIMULATION;
    process.env.PAPER_TRADING = envBackup.PAPER_TRADING;
    process.env.DELTA_TRADING_MODE = envBackup.DELTA_TRADING_MODE;
  });

  it('Part 1: Strict 15m candle-close gate ignores live forming candle ticks', () => {
    const stepMs = 15 * 60 * 1000;
    const nowBoundaryMs = Date.UTC(2026, 10, 10, 10, 15, 3); // 3s after 10:15:00 close
    const baseTimeMs = Date.UTC(2026, 10, 10, 10, 15, 0) - 59 * stepMs; // index 58 = 10:00:00 (closed), index 59 = 10:15:00 (forming)
    const candles = buildTrendingCandles({ count: 60, startPrice: 70000, step: 80, baseTimeMs });
    // Form a W-bottom / pullback closed bar at index 58, plus an unclosed forming spike at index 59
    const closedIdx = candles.length - 2;
    candles[closedIdx] = {
      ...candles[closedIdx],
      open: candles[closedIdx - 1].close - 10,
      low: candles[closedIdx - 1].close - 60,
      high: candles[closedIdx - 1].close + 120,
      close: candles[closedIdx - 1].close + 110,
      volume: 1200,
    };

    FifteenMinCandleCloseGate.resetForTesting();
    const evalWithGreenForming = evaluateStrategyForPort({
      port: 3005,
      symbol: 'BTCUSD',
      candles15m: [
        ...candles.slice(0, -1),
        {
          time: candles[candles.length - 1].time,
          open: 75000,
          high: 76000,
          low: 74900,
          close: 75900,
          volume: 99,
        },
      ],
      nowMs: nowBoundaryMs,
    });

    FifteenMinCandleCloseGate.resetForTesting();
    const evalWithRedForming = evaluateStrategyForPort({
      port: 3005,
      symbol: 'BTCUSD',
      candles15m: [
        ...candles.slice(0, -1),
        {
          time: candles[candles.length - 1].time,
          open: 75000,
          high: 75100,
          low: 72000,
          close: 72100,
          volume: 99,
        },
      ],
      nowMs: nowBoundaryMs,
    });

    assert.strictEqual(evalWithGreenForming.action, evalWithRedForming.action);
    assert.strictEqual(evalWithGreenForming.closedCandleTime, evalWithRedForming.closedCandleTime);
    assert.strictEqual(evalWithGreenForming.entryPrice, evalWithRedForming.entryPrice);
  });

  it('Part 1B: 15m Clock Gate blocks mid-candle & same-candle churn, sorts descending bars, and validates boundary window', () => {
    const stepMs = 15 * 60 * 1000;
    const baseTimeMs = Date.UTC(2026, 10, 10, 10, 15, 0) - 59 * stepMs;
    const candles = buildTrendingCandles({ count: 60, startPrice: 2000, step: 5, baseTimeMs });

    // (a) Mid-candle 10:22:00 (7m after 10:15:00 close) MUST be blocked
    FifteenMinCandleCloseGate.resetForTesting();
    const nowMidMs = Date.UTC(2026, 10, 10, 10, 22, 0);
    const midRes = evaluateStrategyForPort({
      port: 3005,
      symbol: 'ETHUSD',
      candles15m: candles,
      nowMs: nowMidMs,
    });
    assert.strictEqual(midRes.action, 'WAIT');
    assert.ok(midRes.reason.includes('MID_CANDLE_LATE_ENTRY_BLOCKED'));

    const midGuard = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'ETHUSD',
      side: 'BUY',
      entryPrice: 2300,
      candles15m: candles,
      accountCapitalUSD: 178.57,
      leverage: 25,
      enforceCloseWindow: true,
      nowMs: nowMidMs,
    });
    assert.strictEqual(midGuard.approved, false);
    assert.ok(midGuard.vetoReason?.includes('MID_CANDLE_LATE_ENTRY_VETO'));

    // (b) Duplicate evaluation on same 10:00:00 closed candle (10:15:03 then 10:15:20) is locked, then unlocks at 10:30:03
    FifteenMinCandleCloseGate.resetForTesting();
    const eval1 = FifteenMinCandleCloseGate.getNewlyClosed15mCandles({
      port: 3005,
      symbol: 'ETHUSD',
      rawCandles15m: candles,
      nowMs: Date.UTC(2026, 10, 10, 10, 15, 3),
    });
    assert.strictEqual(eval1.shouldEvaluate, true);
    assert.strictEqual(eval1.closedCandleTimeMs, Date.UTC(2026, 10, 10, 10, 0, 0));

    const evalDup = evaluateStrategyForPort({
      port: 3005,
      symbol: 'ETHUSD',
      candles15m: candles,
      nowMs: Date.UTC(2026, 10, 10, 10, 15, 20),
    });
    assert.strictEqual(evalDup.action, 'WAIT');
    assert.ok(evalDup.reason.includes('WAITING_FOR_NEXT_15M_CANDLE_CLOSE'));

    // Append new closed bar opening at 10:15:00 (closing at 10:30:00) + forming bar at 10:30:00
    const nextCandles: KlinePoint[] = [
      ...candles.slice(0, -1),
      { time: Date.UTC(2026, 10, 10, 10, 15, 0), open: 2295, high: 2310, low: 2290, close: 2308, volume: 600 },
      { time: Date.UTC(2026, 10, 10, 10, 30, 0), open: 2308, high: 2312, low: 2305, close: 2310, volume: 50 },
    ];
    const evalNext = FifteenMinCandleCloseGate.getNewlyClosed15mCandles({
      port: 3005,
      symbol: 'ETHUSD',
      rawCandles15m: nextCandles,
      nowMs: Date.UTC(2026, 10, 10, 10, 30, 3),
    });
    assert.strictEqual(evalNext.shouldEvaluate, true);
    assert.strictEqual(evalNext.closedCandleTimeMs, Date.UTC(2026, 10, 10, 10, 15, 0));

    // (c) Descending (newest-first) candles sort cleanly to pick newest closed bar
    const descending = [...nextCandles].reverse();
    const peekDesc = FifteenMinCandleCloseGate.peekLastClosedCandle(descending, Date.UTC(2026, 10, 10, 10, 30, 3));
    assert.strictEqual(peekDesc.closedCandleOpenMs, Date.UTC(2026, 10, 10, 10, 15, 0));

    // (d) Boundary clock window check
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 0, 2))), true);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 15, 45))), true);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 16, 30))), true);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 45, 5))), true);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 0, 0))), false);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 1, 31))), false);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 7, 30))), false);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 14, 59))), false);
    assert.strictEqual(DeltaAutoTraderEngine.isAt15mBoundaryWindow(new Date(Date.UTC(2026, 10, 10, 10, 22, 0))), false);
  });

  it('Part 2A: Tier-1 STRONG_23PCT_RUNNER assigns >= 23% ROE & routes BTC/ETH to Option slot when < 2 open', () => {
    // Blue-sky bullish trend with clear runway (no nearby ceiling wall)
    const closed15m = buildTrendingCandles({ count: 55, startPrice: 68000, step: 90 });
    const entryPrice = closed15m[closed15m.length - 1].close;
    const adx = calcADX(closed15m, 14);

    assert.ok(adx >= 22, `Expected strong trend ADX >= 22, got ${adx.toFixed(2)}`);

    const btcStrongPlan = classifyTradeTierAndBuildBracket({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice,
      closed15m,
      atr: 140,
      adx,
      rsi: 58,
      isMajorPattern: true,
      openOptionSlots: 0,
    });

    assert.strictEqual(btcStrongPlan.tier, 'STRONG_23PCT_RUNNER');
    assert.ok(btcStrongPlan.expectedRoePct >= 23.0, `Expected >= 23% ROE, got ${btcStrongPlan.expectedRoePct}%`);
    assert.ok(btcStrongPlan.targetProfitUSD >= 10.0, 'Tier-1 targetProfitUSD must be >= $10');
    assert.strictEqual(btcStrongPlan.useOptionsSlot, true, 'BTC Tier-1 with < 2 option slots must request Option slot');

    // When 2 option slots are already filled, Tier-1 still runs STRONG_23PCT_RUNNER as Perpetual without Options slot
    const btcPerpFallbackPlan = classifyTradeTierAndBuildBracket({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice,
      closed15m,
      atr: 140,
      adx,
      rsi: 58,
      isMajorPattern: true,
      openOptionSlots: 2,
    });
    assert.strictEqual(btcPerpFallbackPlan.tier, 'STRONG_23PCT_RUNNER');
    assert.strictEqual(btcPerpFallbackPlan.useOptionsSlot, false);

    // Non-BTC/ETH altcoin must never take Option slot even when ADX is high
    const solPlan = classifyTradeTierAndBuildBracket({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice,
      closed15m,
      atr: 140,
      adx,
      rsi: 58,
      isMajorPattern: true,
      openOptionSlots: 0,
    });
    assert.strictEqual(solPlan.tier, 'STRONG_23PCT_RUNNER');
    assert.strictEqual(solPlan.useOptionsSlot, false);
  });

  it('Part 2B: Crowded wall downgrades to Tier-2 NORMAL_5_TO_8_USD_SCALP ($5.50-$8.00 USD)', () => {
    const closed15m = buildTrendingCandles({ count: 55, startPrice: 98, step: 0.03 });
    const entryPrice = closed15m[closed15m.length - 1].close;
    // Inject a nearby opposing candle body ceiling only 0.65% above entryPrice
    closed15m[closed15m.length - 6] = {
      ...closed15m[closed15m.length - 6],
      open: entryPrice * 1.0065,
      close: entryPrice * 1.0068,
      high: entryPrice * 1.0075,
      low: entryPrice * 1.0055,
    };

    const plan = classifyTradeTierAndBuildBracket({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice,
      closed15m,
      atr: 0.15,
      adx: 18,
      rsi: 52,
      isMajorPattern: false,
      openOptionSlots: 0,
    });

    assert.strictEqual(plan.tier, 'NORMAL_5_TO_8_USD_SCALP');
    assert.ok(plan.targetProfitUSD >= 5.0 && plan.targetProfitUSD <= 8.0);
    assert.ok(plan.expectedRoePct >= 15.0 && plan.expectedRoePct <= 22.5);
    assert.strictEqual(plan.useOptionsSlot, false);
  });

  it('Part 3: HybridSixSlotManager enforces 4 Normal Perpetuals + 2 Options = 6 Total Slots', () => {
    assert.strictEqual(HybridSixSlotManager.MAX_TOTAL_TRADES, 6);
    assert.strictEqual(HybridSixSlotManager.MAX_PERPETUAL_SLOTS, 4);
    assert.strictEqual(HybridSixSlotManager.MAX_OPTION_SLOTS, 2);

    // 4 Perps + 0 Options: 5th Perp blocked (wantsOptionSlot=false), 1st Option allowed (wantsOptionSlot=true -> OPTION)
    const perpFullState = { activePerpetualCount: 4, activeOptionsCount: 0 };
    const perpFullPerpRes = HybridSixSlotManager.canOpenNewTrade(perpFullState, false);
    const perpFullOptRes = HybridSixSlotManager.canOpenNewTrade(perpFullState, true);
    assert.strictEqual(perpFullPerpRes.allowed, false);
    assert.strictEqual(perpFullPerpRes.assignSlotType, 'NONE');
    assert.strictEqual(perpFullOptRes.allowed, true);
    assert.strictEqual(perpFullOptRes.assignSlotType, 'OPTION');

    // 2 Perps + 2 Options: Option slots full -> falls back to PERPETUAL slot when wantsOptionSlot=true; Perp allowed
    const optFullState = { activePerpetualCount: 2, activeOptionsCount: 2 };
    const optFullOptRes = HybridSixSlotManager.canOpenNewTrade(optFullState, true);
    const optFullPerpRes = HybridSixSlotManager.canOpenNewTrade(optFullState, false);
    assert.strictEqual(optFullOptRes.allowed, true);
    assert.strictEqual(optFullOptRes.assignSlotType, 'PERPETUAL');
    assert.strictEqual(optFullPerpRes.allowed, true);
    assert.strictEqual(optFullPerpRes.assignSlotType, 'PERPETUAL');

    // 4 Perps + 2 Options: total 6/6 blocks both wantsOptionSlot=false and wantsOptionSlot=true
    const allFullState = { activePerpetualCount: 4, activeOptionsCount: 2 };
    const allFullPerpRes = HybridSixSlotManager.canOpenNewTrade(allFullState, false);
    const allFullOptRes = HybridSixSlotManager.canOpenNewTrade(allFullState, true);
    assert.strictEqual(allFullPerpRes.allowed, false);
    assert.strictEqual(allFullPerpRes.assignSlotType, 'NONE');
    assert.strictEqual(allFullOptRes.allowed, false);
    assert.strictEqual(allFullOptRes.assignSlotType, 'NONE');
  });

  it('Part 5: Sub-15% ROE (<$5 USD) blocks premature 5m reversal exits unless explicit 15m EMA9 cross occurs', () => {
    const candles5m = buildTrendingCandles({ count: 30, startPrice: 100, step: 0.2 });
    // Put a 5m shooting star on the last closed 5m candle
    candles5m[candles5m.length - 2] = {
      time: candles5m[candles5m.length - 2].time,
      open: 105.0,
      high: 107.0,
      low: 104.2,
      close: 104.3, // red with huge upper wick
      volume: 1000,
    };

    // Upward healthy 15m trend (NO 15m EMA9 cross!)
    const bullish15m = buildTrendingCandles({ count: 30, startPrice: 100, step: 0.25 });

    // At 6.5% ROE / $2.80 USD (<15% ROE & <$5.00), 5m shooting star MUST be ignored!
    const blockedPrematureExit = UniversalTradeGuard.detectLiveReversalAgainstPosition({
      side: 'BUY',
      entryPrice: 100,
      currentPrice: 100.3,
      unrealizedPnL: 2.80,
      currentRoePct: 6.5,
      candles5m,
      candles15m: bullish15m,
    });
    assert.strictEqual(blockedPrematureExit.shouldExitNow, false, 'Must NOT exit at 6.5% ROE / $2.80 without explicit 15m EMA9 cross');

    // Now inject an explicit bearish 15m candle crossing below EMA 9
    const crossed15m = buildTrendingCandles({ count: 30, startPrice: 100, step: 0.25 });
    const prevClosed = crossed15m[crossed15m.length - 3];
    crossed15m[crossed15m.length - 2] = {
      time: crossed15m[crossed15m.length - 2].time,
      open: prevClosed.close + 0.1,
      high: prevClosed.close + 0.2,
      low: prevClosed.close - 3.5,
      close: prevClosed.close - 3.2, // decisively below EMA9
      volume: 1500,
    };
    const allowed15mCrossExit = UniversalTradeGuard.detectLiveReversalAgainstPosition({
      side: 'BUY',
      entryPrice: 100,
      currentPrice: prevClosed.close - 3.1,
      unrealizedPnL: 2.80,
      currentRoePct: 6.5,
      candles5m,
      candles15m: crossed15m,
    });
    assert.strictEqual(allowed15mCrossExit.shouldExitNow, true);
    assert.ok(allowed15mCrossExit.reversalReason?.includes('EXPLICIT_15M_EMA9_CROSS'));

    // Once ROE reaches >= 15% (e.g. 16.2%), normal 5m reversal harvest activates!
    const allowedMatureHarvest = UniversalTradeGuard.detectLiveReversalAgainstPosition({
      side: 'BUY',
      entryPrice: 100,
      currentPrice: 104.5,
      unrealizedPnL: 3.90,
      currentRoePct: 16.2,
      candles5m,
      candles15m: bullish15m,
    });
    assert.strictEqual(allowedMatureHarvest.shouldExitNow, true);
    assert.ok(allowedMatureHarvest.reversalReason?.includes('LIVE_BEARISH_REVERSAL'));
  });

  it('Exchange Bracket Guarantee A: toDeltaSymbol preserves Options symbols (C-/P-) untouched', () => {
    assert.strictEqual(toDeltaSymbol('c-btc-90000-151126'), 'C-BTC-90000-151126');
    assert.strictEqual(toDeltaSymbol('P-ETH-3200-151126'), 'P-ETH-3200-151126');
    assert.strictEqual(toDeltaSymbol('SILVERUSDT'), 'SILVERUSD');
    assert.strictEqual(toDeltaSymbol('BTC'), 'BTCUSD');
  });

  it('Exchange Bracket Guarantee B: placeOrder detects missing bracket post-fill & attaches /v2/orders/bracket + recovers immediate_execution', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';

    let bracketAttempts = 0;
    let lastBracketPayload: any = null;
    const calls: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = (init?.method || 'GET').toUpperCase();
      calls.push(`${method} ${urlStr}`);

      if (urlStr.includes('/v2/products')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ id: 888, symbol: 'SILVERUSD', tick_size: '0.01', contract_value: '0.1', state: 'live' }],
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/tickers/SILVERUSD')) {
        return new Response(JSON.stringify({
          success: true,
          result: { symbol: 'SILVERUSD', mark_price: '52.78', quotes: { best_bid: '52.75', best_ask: '52.80' } },
        }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders/bracket') && method === 'POST') {
        bracketAttempts++;
        lastBracketPayload = init?.body ? JSON.parse(init.body as string) : {};
        if (bracketAttempts === 1) {
          // Simulate initial mark-band race causing HTTP 400 bracket_order_immediate_execution
          return new Response(JSON.stringify({
            success: false,
            error: { code: 'bracket_order_immediate_execution' },
          }), { status: 400 });
        }
        return new Response(JSON.stringify({
          success: true,
          result: { id: 9001, stop_loss_order: lastBracketPayload.stop_loss_order, take_profit_order: lastBracketPayload.take_profit_order },
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/orders?') && method === 'GET') {
        // Simulate Delta executing the market order WITHOUT creating child SL/TP orders!
        return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: { id: 7777, average_fill_price: '52.68', product_symbol: 'SILVERUSD' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const engine = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: true,
      baseUrl: 'https://cdn-ind.testnet.deltaex.org',
    });

    const fill = await engine.placeOrder({
      symbol: 'SILVERUSD',
      side: 'SELL',
      size: 10.2, // 102 lots at contract_value 0.1
      price: 52.68,
      stopLossPrice: 53.05,
      takeProfitPrice: 52.10,
    });

    assert.strictEqual(fill.success, true);
    assert.strictEqual(fill.fillPrice, 52.68);
    assert.strictEqual(bracketAttempts, 2, 'Expected immediate_execution retry on /v2/orders/bracket');
    assert.ok(lastBracketPayload?.stop_loss_order?.stop_price, 'Attached bracket must include stop_loss_order');
    assert.ok(lastBracketPayload?.take_profit_order?.stop_price, 'Attached bracket must include take_profit_order');
    assert.strictEqual(lastBracketPayload?.parent_type, 'position');
    assert.ok(calls.some((c) => c.includes('POST') && c.includes('/v2/orders/bracket')));
  });

  it('Exchange Bracket Guarantee C: updateBracketOrder rebuilds full SL+TP when exchange only has 1 half-leg', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';

    let calledDeleteAll = false;
    let postedFullBracket = false;
    let lastBracketBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (urlStr.includes('/v2/products')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ id: 888, symbol: 'SILVERUSD', tick_size: '0.01', contract_value: '0.1', state: 'live' }],
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/tickers/SILVERUSD')) {
        return new Response(JSON.stringify({
          success: true,
          result: { symbol: 'SILVERUSD', mark_price: '52.60' },
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/orders?') && method === 'GET') {
        // Only TP exists on exchange — SL leg is missing!
        return new Response(JSON.stringify({
          success: true,
          result: [{ id: 501, product_id: 888, product_symbol: 'SILVERUSD', size: 102, stop_order_type: 'take_profit_order' }],
        }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders') && method === 'PUT') {
        return new Response(JSON.stringify({ success: true, result: { id: 501 } }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders/all') && method === 'DELETE') {
        calledDeleteAll = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders/bracket') && method === 'POST') {
        postedFullBracket = true;
        lastBracketBody = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(JSON.stringify({ success: true, result: { id: 9900 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const engine = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: true,
      baseUrl: 'https://cdn-ind.testnet.deltaex.org',
    });

    const updateRes = await engine.updateBracketOrder('SILVERUSD', 53.02, 52.05, 'SELL', 52.68);
    assert.strictEqual(updateRes.success, true);
    assert.strictEqual(calledDeleteAll, true, 'Missing SL leg must cancel half-bracket cleanly');
    assert.strictEqual(postedFullBracket, true, 'Missing SL leg must rebuild complete SL+TP bracket');
    assert.strictEqual(lastBracketBody?.stop_loss_order?.stop_price, '53.02');
    assert.strictEqual(lastBracketBody?.take_profit_order?.stop_price, '52.05');
  });

  it('Exchange Bracket Guarantee D: Non-3005 / PAPER_TRADING ports are air-gapped even if updateCredentials() receives live keys', async () => {
    process.env.PORT = '3009';
    process.env.PAPER_TRADING = 'true';
    process.env.DELTA_IS_SIMULATION = 'true';
    process.env.DELTA_TRADING_MODE = 'SIMULATION_PAPER';

    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount++;
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const paperEngine = new DeltaExchangeEngine();
    paperEngine.updateCredentials('fake-live-key', 'fake-live-secret', false, true, 'DELTA_TESTNET');

    assert.strictEqual(paperEngine.isLiveDispatchActive(), false);
    assert.strictEqual(paperEngine.getConfig().isSimulation, true);
    assert.strictEqual(paperEngine.getConfig().apiKey, '');

    const posRes = await paperEngine.getMarginedPositions();
    const ordRes = await paperEngine.getOpenOrders();
    const cancelRes = await paperEngine.cancelBracketOrder('SILVERUSD', true);
    const updateRes = await paperEngine.updateBracketOrder('SILVERUSD', 53.05, 52.10, 'SELL', 52.68);
    const setRes = await paperEngine.setBracketOrder('SILVERUSD', 53.05, 52.10, 'SELL');

    assert.deepStrictEqual(posRes, []);
    assert.deepStrictEqual(ordRes, []);
    assert.strictEqual(cancelRes.success, false);
    assert.strictEqual(updateRes.success, false);
    assert.strictEqual(setRes.success, false);
    assert.strictEqual(fetchCount, 0, 'Paper port 3009 must make ZERO live API calls or cancellations!');
  });

  it('Exchange Bracket Guarantee E: Healthy existing SL is NEVER cancelled if TP PUT fails, & setBracketOrder escalates / falls back to SL-only', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';

    let calledDeleteAll = false;
    let postedBodies: any[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (urlStr.includes('/v2/products')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ id: 888, symbol: 'SILVERUSD', tick_size: '0.01', contract_value: '0.1', state: 'live' }],
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/tickers/SILVERUSD')) {
        return new Response(JSON.stringify({
          success: true,
          result: { symbol: 'SILVERUSD', mark_price: '52.78', spot_price: '52.79', quotes: { best_bid: '52.76', best_ask: '52.81' } },
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/orders?') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [
            { id: 501, product_id: 888, product_symbol: 'SILVERUSD', size: 102, stop_order_type: 'take_profit_order', stop_price: '52.10' },
            { id: 502, product_id: 888, product_symbol: 'SILVERUSD', size: 102, stop_order_type: 'stop_loss_order', stop_price: '53.05' },
          ],
        }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders') && method === 'PUT') {
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'bracket_order_immediate_execution' },
        }), { status: 400 });
      }
      if (urlStr.endsWith('/v2/orders/all') && method === 'DELETE') {
        calledDeleteAll = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders/bracket') && method === 'POST') {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        postedBodies.push(body);
        if (body.stop_loss_order && body.take_profit_order) {
          return new Response(JSON.stringify({
            success: false,
            error: { code: 'bracket_order_immediate_execution' },
          }), { status: 400 });
        }
        // SL-only emergency fallback succeeds!
        return new Response(JSON.stringify({
          success: true,
          result: { id: 9999, stop_loss_order: body.stop_loss_order },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const engine = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: true,
      baseUrl: 'https://cdn-ind.testnet.deltaex.org',
    });

    const updateRes = await engine.updateBracketOrder('SILVERUSD', 53.02, 52.00, 'SELL', 52.68);
    assert.strictEqual(calledDeleteAll, false, 'Healthy SL+TP orders must NEVER be cancelled just because PUT failed!');
    assert.strictEqual(updateRes.slProtected, true);

    const emergencyRes = await engine.setBracketOrder('SILVERUSD', 53.02, 52.00, 'SELL');
    assert.strictEqual(emergencyRes.success, true);
    assert.strictEqual(emergencyRes.slOnly, true, 'When combined bracket repeatedly fails immediate_execution, SL-only emergency bracket must protect position!');
    assert.ok(postedBodies.length >= 4, 'Expected combined escalation retries before SL-only emergency fallback');
  });
});
