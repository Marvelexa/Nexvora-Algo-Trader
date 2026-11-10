import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  buildMasterSixSlotBracket,
  buildThreeBucketTradePlan,
  FifteenMinCandleCloseGate,
  KlinePoint,
} from '../lib/strategies/strategyRegistry';
import {
  ReservedSixSeatManager,
  ReservedSeatCounts,
  UniversalTradeGuard,
  DeltaOptionsMasterEngine,
  OptionProductMeta,
} from '../lib/risk/universalTradeGuard';
import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine';
import { DeltaExchangeEngine, deltaExchange } from '../lib/deltaExchangeEngine';
import { DeltaPosition } from '../src/types';

function buildStrongTrendCandles(opts: {
  count: number;
  startPrice: number;
  step: number;
  baseTimeMs?: number;
}): KlinePoint[] {
  const stepMs = 15 * 60 * 1000;
  const baseTime = opts.baseTimeMs !== undefined ? opts.baseTimeMs : (Date.now() - opts.count * stepMs);
  const out: KlinePoint[] = [];
  let p = opts.startPrice;
  for (let i = 0; i < opts.count; i++) {
    const open = p;
    const close = p + opts.step;
    const high = Math.max(open, close) + Math.abs(opts.step) * 0.2;
    const low = Math.min(open, close) - Math.abs(opts.step) * 0.2;
    out.push({ time: baseTime + i * stepMs, open, high, low, close, volume: 800 });
    p = close;
  }
  return out;
}

function buildChopPullbackCandles(opts: {
  basePrice: number;
  baseTimeMs?: number;
  wallOffsetPct?: number;
}): KlinePoint[] {
  const stepMs = 15 * 60 * 1000;
  const baseTime = opts.baseTimeMs !== undefined ? opts.baseTimeMs : (Date.now() - 60 * stepMs);
  const out: KlinePoint[] = [];
  // Range-bound sideways drift with controllable ceiling wall distance
  for (let i = 0; i < 60; i++) {
    const wave = Math.sin(i * 0.6) * opts.basePrice * 0.0022;
    const close = opts.basePrice + wave;
    const open = close - opts.basePrice * 0.0005;
    out.push({
      time: baseTime + i * stepMs,
      open,
      high: close + opts.basePrice * 0.0018,
      low: close - opts.basePrice * 0.0018,
      close,
      volume: 300,
    });
  }
  const lastClose = out[out.length - 1].close;
  // Inject a clear opposing resistance body peak inside [0.68%, 0.90%] so Chop TP front-runs it cleanly
  const wallPct = opts.wallOffsetPct ?? 0.0085;
  const wallPrice = lastClose * (1 + wallPct);
  out[30] = { ...out[30], open: wallPrice - 0.1, close: wallPrice, high: wallPrice + 0.05, low: wallPrice - 0.2 };
  out[29] = { ...out[29], open: wallPrice - 0.35, close: wallPrice - 0.3, high: wallPrice - 0.25, low: wallPrice - 0.4 };
  out[31] = { ...out[31], open: wallPrice - 0.3, close: wallPrice - 0.35, high: wallPrice - 0.25, low: wallPrice - 0.4 };
  return out;
}

describe('2 + 2 + 2 = 6-Slot Reserved Seat Architecture & Fee-Adjusted ROE Suite', () => {
  const originalFetch = globalThis.fetch;
  const originalIsAtWindow = DeltaAutoTraderEngine.isAt15mBoundaryWindow;
  const originalGetMarketPrice = deltaExchange.getMarketPrice.bind(deltaExchange);
  const originalGetProductSpec = deltaExchange.getProductSpec.bind(deltaExchange);
  const originalGetWalletBalance = deltaExchange.getWalletBalance.bind(deltaExchange);
  const originalPlaceOrder = deltaExchange.placeOrder.bind(deltaExchange);
  const originalUpdateBracket = deltaExchange.updateBracketOrder.bind(deltaExchange);
  const originalGetCachedTicker = deltaExchange.getCachedTicker.bind(deltaExchange);
  const originalGetConfig = deltaExchange.getConfig.bind(deltaExchange);
  const originalIsLiveDispatchActive = deltaExchange.isLiveDispatchActive.bind(deltaExchange);
  const originalGetTicker = deltaExchange.getTicker.bind(deltaExchange);
  const originalRegisterProduct = deltaExchange.registerProduct.bind(deltaExchange);
  const originalConsoleLog = console.log;

  const envBackup = {
    PORT: process.env.PORT,
    DELTA_IS_SIMULATION: process.env.DELTA_IS_SIMULATION,
    PAPER_TRADING: process.env.PAPER_TRADING,
    DELTA_TRADING_MODE: process.env.DELTA_TRADING_MODE,
    STATE_FILE: process.env.STATE_FILE,
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    DeltaAutoTraderEngine.isAt15mBoundaryWindow = originalIsAtWindow;
    deltaExchange.getMarketPrice = originalGetMarketPrice;
    deltaExchange.getProductSpec = originalGetProductSpec;
    deltaExchange.getWalletBalance = originalGetWalletBalance;
    deltaExchange.placeOrder = originalPlaceOrder;
    deltaExchange.updateBracketOrder = originalUpdateBracket;
    deltaExchange.getCachedTicker = originalGetCachedTicker;
    deltaExchange.getConfig = originalGetConfig;
    deltaExchange.isLiveDispatchActive = originalIsLiveDispatchActive;
    deltaExchange.getTicker = originalGetTicker;
    deltaExchange.registerProduct = originalRegisterProduct;
    console.log = originalConsoleLog;
    (UniversalTradeGuard as any).lastProductsFetchTime = 0;
    UniversalTradeGuard.resetCandleDeduplication();
    FifteenMinCandleCloseGate.resetForTesting();

    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    for (const f of [
      'undefined',
      '.delta_auto_trader_state_3098.json',
      path.join('public', 'closed_trades_history_3098.json'),
      '.test_state_3097.json',
      '.delta_auto_trader_state_3097.json',
      path.join('public', 'closed_trades_history_3097.json'),
      '.test_state_3096.json',
      '.delta_auto_trader_state_3096.json',
      path.join('public', 'closed_trades_history_3096.json'),
    ]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  });

  it('1. buildThreeBucketTradePlan & buildMasterSixSlotBracket compute Fee-Adjusted ROE (Normal 24%+ Net vs Chop 15%+ Net)', () => {
    const bigTrend = buildStrongTrendCandles({ count: 55, startPrice: 68000, step: 95 });
    const btcEntry = bigTrend[bigTrend.length - 1].close;

    const btcBigPlan = buildThreeBucketTradePlan({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: btcEntry,
      closedCandles: bigTrend,
      atr: 140,
      rsi: 59,
      reason: 'PA_W_BOTTOM_REVERSAL_BUY',
      tickSize: 0.5,
    });

    assert.strictEqual(btcBigPlan.bucket, 'NORMAL_23_TO_40PCT_SEAT');
    assert.strictEqual(btcBigPlan.leverage, 25);
    assert.ok((btcBigPlan.netRoeAfterFeesPct ?? 0) >= 24.0, `Expected >= 24% Net ROE after 0.12% fee drag, got ${btcBigPlan.netRoeAfterFeesPct}%`);
    assert.ok((btcBigPlan.grossRoePct ?? 0) >= 27.0, `Expected >= 27% Gross ROE, got ${btcBigPlan.grossRoePct}%`);
    assert.strictEqual(Number(((btcBigPlan.grossRoePct ?? 0) - (btcBigPlan.netRoeAfterFeesPct ?? 0)).toFixed(1)), 3.0, 'Round-trip 0.12% fees at 25x must deduct exact 3.0% ROE');
    assert.ok(btcBigPlan.targetProfitUSD >= 10.0, `Expected >= $10 USD target for Normal Runner, got $${btcBigPlan.targetProfitUSD}`);
    assert.strictEqual(btcBigPlan.maxRiskUSD, 3.8);
    assert.strictEqual(btcBigPlan.canAlsoTriggerOption, true, 'BTC Normal/Strong signal must also allow Option seat trigger');
    assert.ok(btcBigPlan.tpPrice > btcEntry && btcBigPlan.slPrice < btcEntry);
    assert.ok(
      btcBigPlan.breakevenPlusFeeTriggerPrice! > btcBigPlan.breakevenPlusFeeLockPrice! &&
      btcBigPlan.breakevenPlusFeeLockPrice! > btcEntry,
      'Stage 1 fee lock must sit cleanly above entry below activation trigger'
    );
    assert.ok(
      btcBigPlan.runner23PctTriggerPrice! > btcBigPlan.runner18PctLockPrice! &&
      btcBigPlan.runner18PctLockPrice! > btcBigPlan.breakevenPlusFeeLockPrice!,
      'Stage 2 23%->40% runner lock must ratchet strictly above Stage 1 lock'
    );

    const solBigPlan = buildThreeBucketTradePlan({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: btcEntry,
      closedCandles: bigTrend,
      atr: 140,
      rsi: 59,
      reason: 'PA_W_BOTTOM_REVERSAL_BUY',
      tickSize: 0.01,
    });
    assert.strictEqual(solBigPlan.bucket, 'NORMAL_23_TO_40PCT_SEAT');
    assert.strictEqual(solBigPlan.canAlsoTriggerOption, false, 'Altcoin Normal/Strong signal must NOT trigger BTC/ETH Option seat');

    // Sideways chop EMA pullback with nearby resistance wall ~0.85% away MUST classify as CHOP_15PCT_SEAT >= 15.0% Net ROE!
    const chopCandles = buildChopPullbackCandles({ basePrice: 100, wallOffsetPct: 0.0085 });
    const chopEntry = chopCandles[chopCandles.length - 1].close;
    const chopPlan = buildThreeBucketTradePlan({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: chopEntry,
      closedCandles: chopCandles,
      atr: 0.35,
      rsi: 51,
      reason: 'V6_MASTER_EMA_PULLBACK_BUY',
      tickSize: 0.01,
    });

    assert.strictEqual(chopPlan.bucket, 'CHOP_15PCT_SEAT');
    assert.strictEqual(chopPlan.leverage, 25);
    assert.ok((chopPlan.netRoeAfterFeesPct ?? 0) >= 15.0 && (chopPlan.netRoeAfterFeesPct ?? 0) <= 19.5, `Expected 15%–19.5% Net ROE for Chop, got ${chopPlan.netRoeAfterFeesPct}%`);
    assert.ok((chopPlan.grossRoePct ?? 0) >= 18.0 && (chopPlan.grossRoePct ?? 0) <= 22.5, `Expected 18%–22.5% Gross ROE for Chop, got ${chopPlan.grossRoePct}%`);
    assert.strictEqual(Number(((chopPlan.grossRoePct ?? 0) - (chopPlan.netRoeAfterFeesPct ?? 0)).toFixed(1)), 3.0);
    assert.ok(chopPlan.targetProfitUSD >= 5.5);
    assert.strictEqual(chopPlan.maxRiskUSD, 3.2);
    assert.strictEqual(chopPlan.canAlsoTriggerOption, false);
    assert.ok(chopPlan.rrRatio >= 1.25, `Expected RR >= 1.25, got ${chopPlan.rrRatio}`);
    assert.ok(chopPlan.reversalWallPrice && chopPlan.tpPrice < chopPlan.reversalWallPrice, 'Chop TP must sit strictly in front of reversal wall');
  });

  it('2. ReservedSixSeatManager keeps 2 Normal (23%-40%+) seats 100% KHALI when 2/2 Chopping seats are occupied', () => {
    const chopFullState: ReservedSeatCounts = {
      activeBigSignalSeats: 0,
      activeOptionSeats: 0,
      activeChopNormalSeats: 2,
    };

    // 3rd Chop trade (both canonical and legacy aliases) MUST be blocked & never touch empty Normal Runner seats
    const chopVeto = ReservedSixSeatManager.allocateSeat(chopFullState, 'CHOP_15PCT_SEAT');
    assert.strictEqual(chopVeto.approved, false);
    assert.ok(chopVeto.vetoReason?.includes('CHOP_2_SEATS_FULL_KEEPING_BIG_SEATS_KHALI'));

    const legacyChopVeto = ReservedSixSeatManager.allocateSeat(chopFullState, 'CHOP_NORMAL_SEAT');
    assert.strictEqual(legacyChopVeto.approved, false);

    // Normal Runner MUST be approved into NORMAL_23_TO_40PCT_SEAT
    const normalApproved = ReservedSixSeatManager.allocateSeat(chopFullState, 'NORMAL_23_TO_40PCT_SEAT');
    assert.strictEqual(normalApproved.approved, true);
    assert.strictEqual(normalApproved.allocatedBucket, 'NORMAL_23_TO_40PCT_SEAT');

    // Option MUST be approved into OPTION_UNCAPPED_SEAT
    const optApproved = ReservedSixSeatManager.allocateSeat(chopFullState, 'OPTION_UNCAPPED_SEAT');
    assert.strictEqual(optApproved.approved, true);
    assert.strictEqual(optApproved.allocatedBucket, 'OPTION_UNCAPPED_SEAT');

    // 2/2 Normal Runners blocks 3rd Normal Runner (even if Chop is 0/2!)
    const bigFullState: ReservedSeatCounts = {
      activeBigSignalSeats: 2,
      activeOptionSeats: 0,
      activeChopNormalSeats: 0,
    };
    const bigFullVeto = ReservedSixSeatManager.allocateSeat(bigFullState, 'NORMAL_23_TO_40PCT_SEAT');
    assert.strictEqual(bigFullVeto.approved, false);
    assert.ok(bigFullVeto.vetoReason?.includes('BIG_SIGNAL_2_SEATS_FULL'));

    // 2/2 Options blocks 3rd Option
    const optFullVeto = ReservedSixSeatManager.allocateSeat(
      { activeBigSignalSeats: 0, activeOptionSeats: 2, activeChopNormalSeats: 0 },
      'OPTION_UNCAPPED_SEAT'
    );
    assert.strictEqual(optFullVeto.approved, false);
    assert.ok(optFullVeto.vetoReason?.includes('OPTION_2_SEATS_FULL'));

    // 6/6 blocks everything
    const allFullVeto = ReservedSixSeatManager.allocateSeat(
      { activeBigSignalSeats: 2, activeOptionSeats: 2, activeChopNormalSeats: 2 },
      'NORMAL_23_TO_40PCT_SEAT'
    );
    assert.strictEqual(allFullVeto.approved, false);
    assert.ok(allFullVeto.vetoReason?.includes('ALL_6_SEATS_FULL'));
  });

  it('3. Engine runScanCycle reserves 2 Normal seats when Chop is 2/2 & fires BTC Normal Perp + ATM Call Option (-18% SL / +55% TP)', async () => {
    process.env.PORT = '3098';
    process.env.DELTA_IS_SIMULATION = 'true';
    process.env.PAPER_TRADING = 'true';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';

    const capturedLogs: string[] = [];
    console.log = (...args: any[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(' '));
    };

    const stepMs = 15 * 60 * 1000;
    const nowCloseBoundary = Date.UTC(2026, 10, 10, 12, 15, 5); // Valid 15m boundary close window
    const bar59Open = Date.UTC(2026, 10, 10, 12, 0, 0);
    const baseTime = bar59Open - 58 * stepMs;

    // Build BTC candles that pass Closed-Bar Breakout BUY (RSI ~64 <= 74, ADX >= 22, 60-bar high = open blue-sky runway) -> NORMAL_23_TO_40PCT_SEAT
    const btcCandles15m: KlinePoint[] = [];
    let bp = 70000;
    for (let i = 0; i < 57; i++) {
      const step = i % 3 === 2 ? -140 : 120;
      const open = bp;
      const close = bp + step;
      btcCandles15m.push({
        time: baseTime + i * stepMs,
        open,
        high: Math.max(open, close) + 20,
        low: Math.min(open, close) - 20,
        close,
        volume: 800,
      });
      bp = close;
    }
    btcCandles15m.push({
      time: baseTime + 57 * stepMs,
      open: bp,
      high: bp + 15,
      low: bp - 100,
      close: bp - 90,
      volume: 700,
    });
    const recentPeak = Math.max(...btcCandles15m.map((k) => k.high));
    const bOpen = bp - 90;
    const bBreakClose = Math.max(recentPeak + 140, bOpen + 260);
    btcCandles15m.push({
      time: bar59Open,
      open: bOpen,
      low: bOpen - 15,
      high: bBreakClose + 20,
      close: bBreakClose,
      volume: 1600,
    });
    btcCandles15m.push({
      time: nowCloseBoundary - 5000,
      open: bBreakClose,
      high: bBreakClose + 20,
      low: bBreakClose - 10,
      close: bBreakClose + 10,
      volume: 50,
    });
    const btcEntryPrice = btcCandles15m[58].close;
    const btc5m = buildStrongTrendCandles({ count: 35, startPrice: btcEntryPrice - 900, step: 26 });

    // Build SOL candles: Sideways oscillating range (ADX < 20) + wall ~0.85% above entry -> CHOP_15PCT_SEAT!
    // Must be VETOED by ReservedSixSeatManager because 2/2 Chop seats are already occupied!
    const solChopCandles: KlinePoint[] = [];
    for (let i = 0; i < 60; i++) {
      const wave = (i % 4 < 2 ? 0.12 : -0.12);
      const close = 100.0 + wave;
      solChopCandles.push({
        time: baseTime + i * stepMs,
        open: close - (i % 2 === 0 ? 0.03 : -0.03),
        high: close + 0.14,
        low: close - 0.14,
        close,
        volume: 300,
      });
    }
    solChopCandles[29] = { ...solChopCandles[29], open: 100.65, close: 100.70, high: 100.75, low: 100.60 };
    solChopCandles[30] = { ...solChopCandles[30], open: 100.88, close: 100.98, high: 101.02, low: 100.85 };
    solChopCandles[31] = { ...solChopCandles[31], open: 100.72, close: 100.65, high: 100.75, low: 100.60 };
    solChopCandles[56] = { time: baseTime + 56 * stepMs, open: 100.02, high: 100.04, low: 99.88, close: 99.90, volume: 400 };
    solChopCandles[57] = { time: baseTime + 57 * stepMs, open: 99.90, high: 100.03, low: 99.89, close: 100.01, volume: 450 };
    solChopCandles[58] = { time: bar59Open, open: 100.01, high: 100.18, low: 99.98, close: 100.13, volume: 650 };
    solChopCandles[59] = { time: nowCloseBoundary - 5000, open: 100.13, high: 100.15, low: 100.11, close: 100.14, volume: 20 };

    const bull5m = buildStrongTrendCandles({ count: 35, startPrice: 99, step: 0.08 });

    const mockProducts = [
      { id: 27, symbol: 'BTCUSD', contract_type: 'perpetual_futures', tick_size: '0.5', contract_value: '0.001', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      { id: 196, symbol: 'SOLUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '1', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
    ];
    const mockTickers = [
      { symbol: 'SOLUSD', contract_type: 'perpetual_futures', turnover_usd: '60000000', quotes: { best_bid: '100.20', best_ask: '100.25' } },
      { symbol: 'BTCUSD', contract_type: 'perpetual_futures', turnover_usd: '50000000', quotes: { best_bid: String(btcEntryPrice), best_ask: String(btcEntryPrice + 5) } },
    ];
    const optExpiryMs = nowCloseBoundary + 24 * 3600 * 1000;
    const mockOptionProducts = [
      { id: 9001, symbol: 'C-BTC-73500-111126', contract_type: 'call_options', tick_size: '1', contract_value: '0.001', state: 'live', trading_status: 'operational', settlement_time: new Date(optExpiryMs).toISOString() },
    ];
    const mockOptionTickers = [
      { symbol: 'C-BTC-73500-111126', contract_type: 'call_options', strike_price: String(Math.round(btcEntryPrice)), tick_size: '1', contract_value: '0.001', mark_price: '520', quotes: { best_bid: '518', best_ask: '522' } },
    ];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('call_options') && u.includes('/v2/products')) {
        return new Response(JSON.stringify({ success: true, result: mockOptionProducts }), { status: 200 });
      }
      if (u.includes('call_options') && u.includes('/v2/tickers')) {
        return new Response(JSON.stringify({ success: true, result: mockOptionTickers }), { status: 200 });
      }
      if (u.includes('/v2/products')) {
        return new Response(JSON.stringify({ success: true, result: mockProducts }), { status: 200 });
      }
      if (u.includes('/v2/tickers')) {
        return new Response(JSON.stringify({ success: true, result: mockTickers }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    deltaExchange.getWalletBalance = (async () => ({ balanceUSD: 178.57, availableUSD: 178.57 })) as any;
    deltaExchange.getMarketPrice = (async (sym: string) => (sym === 'BTCUSD' ? btcEntryPrice : solChopCandles[58].close)) as any;
    deltaExchange.getProductSpec = ((sym: string) => (
      sym === 'BTCUSD'
        ? { tickSize: 0.5, contractValue: 0.001, decimals: 1 }
        : { tickSize: 0.01, contractValue: 1.0, decimals: 2 }
    )) as any;

    // Seed engine with 2 existing Chop positions -> Chop is 2/2 FULL, Normal 23%-40%+ is 0/2 KHALI, Options is 0/2!
    const engine = new DeltaAutoTraderEngine(3098);
    (engine as any).engineStartTime = 0;
    DeltaAutoTraderEngine.isAt15mBoundaryWindow = () => true;

    (engine as any).state.activePositions = [
      {
        id: 'chop-1', symbol: 'DOGEUSD', side: 'BUY', entryPrice: 0.15, currentPrice: 0.15,
        quantity: 100, marginUSD: 20, notionalUSD: 500, leverage: 25,
        takeProfitPrice: 0.1512, stopLossPrice: 0.1490, initialStopLossPrice: 0.1490,
        atr: 0.001, isBreakevenLocked: false, pnlUSD: 0, pnlPercent: 0,
        entryTime: Date.now(), strategyName: 'Chop-1', shadowConfirmedSeconds: 0,
        seatBucket: 'CHOP_15PCT_SEAT',
      },
      {
        id: 'chop-2', symbol: 'ADAUSD', side: 'BUY', entryPrice: 0.60, currentPrice: 0.60,
        quantity: 100, marginUSD: 20, notionalUSD: 500, leverage: 25,
        takeProfitPrice: 0.6048, stopLossPrice: 0.5960, initialStopLossPrice: 0.5960,
        atr: 0.002, isBreakevenLocked: false, pnlUSD: 0, pnlPercent: 0,
        entryTime: Date.now(), strategyName: 'Chop-2', shadowConfirmedSeconds: 0,
        seatBucket: 'CHOP_15PCT_SEAT',
      },
    ];

    const startSeats = engine.getReservedSeatCounts();
    assert.deepStrictEqual(startSeats, {
      activeBigSignalSeats: 0,
      activeOptionSeats: 0,
      activeChopNormalSeats: 2,
    });

    (engine as any).fetchCandles = async (sym: string, tf: string) => {
      if (sym === 'BTCUSD') return tf === '15m' ? btcCandles15m : btc5m;
      if (sym === 'SOLUSD') return tf === '15m' ? solChopCandles : bull5m;
      return [];
    };

    const origDateNow = Date.now;
    Date.now = () => nowCloseBoundary;
    try {
      await engine.runScanCycle();
    } finally {
      Date.now = origDateNow;
    }

    const endSeats = engine.getReservedSeatCounts();
    const positions: DeltaPosition[] = (engine as any).state.activePositions;
    const activeSyms = positions.map((p) => p.symbol);

    // Chopping seats MUST stay strictly at 2 (SOLUSD vetoed!)
    assert.strictEqual(endSeats.activeChopNormalSeats, 2, `Expected Chop seats capped at 2, active: ${activeSyms.join(', ')}`);
    assert.strictEqual(activeSyms.includes('SOLUSD'), false, 'SOLUSD Chop signal must NOT steal a Normal 23%-40%+ seat');

    // BTCUSD Normal Runner entered + ATM Call Option entered simultaneously!
    assert.strictEqual(endSeats.activeBigSignalSeats, 1, `Expected 1 Normal Runner seat filled by BTCUSD. Logs:\n${capturedLogs.join('\n')}`);
    assert.strictEqual(endSeats.activeOptionSeats, 1, `Expected 1 Option seat filled by C-BTC Call Option. Logs:\n${capturedLogs.join('\n')}`);

    const btcPos = positions.find((p) => p.symbol === 'BTCUSD')!;
    assert.strictEqual(btcPos.seatBucket, 'NORMAL_23_TO_40PCT_SEAT');
    assert.strictEqual(btcPos.leverage, 25);
    assert.ok((btcPos.netRoeAfterFeesPct ?? 0) >= 24.0);
    assert.ok(btcPos.breakevenPlusFeeTriggerPrice && btcPos.breakevenPlusFeeLockPrice);
    assert.ok(btcPos.runner23PctTriggerPrice && btcPos.runner18PctLockPrice);

    const optPos = positions.find((p) => p.symbol.startsWith('C-BTC-'))!;
    assert.strictEqual(optPos.seatBucket, 'OPTION_UNCAPPED_SEAT');
    assert.ok((optPos.expectedRoePct ?? 0) >= 35 && (optPos.expectedRoePct ?? 0) <= 75, `Expected Spot-synced Option TP ROE in [35%, 75%], got ${optPos.expectedRoePct}%`);
    assert.strictEqual(optPos.netRoeAfterFeesPct, Number(((optPos.expectedRoePct ?? 35) - 3).toFixed(1)));
    assert.strictEqual(optPos.entryPrice, 522, 'Option limit entry must fill at min(bestAsk=522, mark*1.004=522.08) rounded to tickSize');
    assert.strictEqual(optPos.stopLossPrice, Math.round(optPos.entryPrice * 0.82));
    assert.strictEqual(optPos.takeProfitPrice, Math.round(optPos.entryPrice * (1 + (optPos.expectedRoePct ?? 35) / 100)));
    assert.strictEqual(optPos.spotSlPrice, btcPos.stopLossPrice, 'Option spotSlPrice must sync directly with BTC Spot structural SL');
    assert.strictEqual(optPos.underlyingAsset, 'BTC');
    assert.ok(optPos.marginUSD * 0.18 <= 4.25, `Option max risk @ -18% SL ($${(optPos.marginUSD * 0.18).toFixed(2)}) must stay ~$3.50-$4.25`);

    const joinedLogs = capturedLogs.join('\n');
    assert.ok(joinedLogs.includes('[SEAT STATUS] Chopping 15%+ Net:'), 'Must emit updated [SEAT STATUS] summary');
    assert.ok(
      joinedLogs.includes('🛡️ [SEAT RESERVATION] 2/2 Chopping seats occupied. Keeping 2 Normal/Big-Signal seats KHALI for 23%-40%+ ROE Runners!'),
      `Expected explicit SOLUSD [SEAT RESERVATION] veto log! Logs:\n${joinedLogs}`
    );
  });

  it('4. Chopping stays 15%-19% Net ROE [0.72%-0.88%], Normal captures 24%-38% Net ROE [1.08%-1.64%], & dead boxes (<0.60%) veto', () => {
    const stepMs = 15 * 60 * 1000;
    const baseTime = Date.now() - 60 * stepMs;

    // 4A-Chop: Choppy EMA pullback with a nearby reversal wall ~0.85% above entry -> front-runs cleanly in CHOP_15PCT_SEAT (15%–19% Net ROE)
    const chopWallCandles = buildChopPullbackCandles({ basePrice: 100, baseTimeMs: baseTime, wallOffsetPct: 0.0085 });
    const entryChop = chopWallCandles[chopWallCandles.length - 1].close;
    const chopPlan = buildMasterSixSlotBracket({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: entryChop,
      closedCandles: chopWallCandles,
      atr: 0.35,
      reason: 'V6_MASTER_EMA_PULLBACK_BUY',
      tickSize: 0.01,
    });
    assert.strictEqual(chopPlan.bucket, 'CHOP_15PCT_SEAT');
    assert.ok(chopPlan.tpPct >= 0.72 && chopPlan.tpPct <= 0.88, `Chop tpPct ${chopPlan.tpPct}% must stay in [0.72%, 0.88%]`);
    assert.ok(chopPlan.netRoeAfterFeesPct >= 15.0 && chopPlan.netRoeAfterFeesPct <= 19.0);
    assert.ok(chopPlan.nearestReversalWall && chopPlan.tpPrice < chopPlan.nearestReversalWall, 'Chop TP must front-run opposing candle-body wall');

    // 4A-Normal: Strong trend breakout with far wall ~1.48% away -> qualifies for NORMAL_23_TO_40PCT_SEAT (24%–38% Net ROE)
    const normalCandles = buildStrongTrendCandles({ count: 55, startPrice: 95, step: 0.14, baseTimeMs: baseTime });
    const entryNorm = normalCandles[normalCandles.length - 1].close;
    const farWall = entryNorm * 1.0148;
    normalCandles[20] = { ...normalCandles[20], open: farWall - 0.15, close: farWall, high: farWall + 0.05 };
    normalCandles[19] = { ...normalCandles[19], open: farWall - 0.4, close: farWall - 0.3, high: farWall - 0.2 };
    normalCandles[21] = { ...normalCandles[21], open: farWall - 0.3, close: farWall - 0.35, high: farWall - 0.2 };

    const normalPlan = buildMasterSixSlotBracket({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: entryNorm,
      closedCandles: normalCandles,
      atr: 0.35,
      reason: 'PA_W_BOTTOM_REVERSAL_BUY',
      tickSize: 0.01,
    });
    assert.strictEqual(normalPlan.bucket, 'NORMAL_23_TO_40PCT_SEAT');
    assert.ok(normalPlan.tpPct >= 1.08 && normalPlan.tpPct <= 1.64, `Normal tpPct ${normalPlan.tpPct}% must stay in [1.08%, 1.64%]`);
    assert.ok(normalPlan.netRoeAfterFeesPct >= 24.0 && normalPlan.netRoeAfterFeesPct <= 38.0);
    assert.ok(normalPlan.tpPrice < farWall, 'Normal TP must front-run far reversal wall');

    // 4B: Tight dead-box ceiling (~0.38% above entry, touched multiple times) -> VETOED (<15% Net ROE room before reversal)
    const boxCandles: KlinePoint[] = [];
    for (let i = 0; i < 60; i++) {
      const isTouch = i === 25 || i === 38 || i === 48;
      const cPrice = isTouch ? 100.38 : 100.0 + ((i % 2 === 0) ? 0.12 : -0.10);
      boxCandles.push({
        time: baseTime + i * stepMs,
        open: cPrice - 0.05,
        high: cPrice + 0.06,
        low: cPrice - 0.08,
        close: cPrice,
        volume: 300,
      });
    }
    boxCandles[58] = { ...boxCandles[58], open: 99.95, close: 100.00, high: 100.04, low: 99.92 };
    boxCandles[59] = { ...boxCandles[59], open: 100.00, close: 100.01, high: 100.02, low: 99.99 };

    UniversalTradeGuard.resetCandleDeduplication('SOLUSD');
    (UniversalTradeGuard as any).dynamicProducts.set('SOLUSD', {
      productId: 196, symbol: 'SOLUSD', contractType: 'perpetual_futures', contractValue: 1, tickSize: 0.01, state: 'live', tradingStatus: 'operational',
    });
    const tightVeto = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: 100.00,
      candles15m: boxCandles,
      contractValue: 1,
      tickSize: 0.01,
      accountCapitalUSD: 178.57,
      leverage: 25,
      signalReason: 'V6_MASTER_EMA_PULLBACK_BUY',
      threeBucketPlan: buildThreeBucketTradePlan({
        symbol: 'SOLUSD', side: 'BUY', entryPrice: 100.00, closedCandles: boxCandles.slice(0, -1), atr: 0.18, rsi: 48, reason: 'V6_MASTER_EMA_PULLBACK_BUY', tickSize: 0.01,
      }),
    });
    assert.strictEqual(tightVeto.approved, false);
    assert.ok(tightVeto.vetoReason?.includes('CHOP_REVERSAL_WALL_TOO_CLOSE_VETO'), `Expected tight-box veto, got ${tightVeto.vetoReason}`);
  });

  it('5. evaluatePositionSLTP executes Stage-1 Fee Lock (+11%/+12%->+4.5%) & Stage-2 Runner Lock (+24%->+20%), never edits SL in loss, & protects Runners from 5m noise', async () => {
    process.env.PORT = '3005';
    process.env.STATE_FILE = '.test_state_3097.json';

    const updateCalls: Array<{ sym: string; sl?: number; tp?: number }> = [];
    deltaExchange.updateBracketOrder = (async (sym: string, sl?: number, tp?: number) => {
      updateCalls.push({ sym, sl, tp });
      return { success: true };
    }) as any;
    deltaExchange.getCachedTicker = (() => undefined) as any;
    deltaExchange.getProductSpec = (() => ({ tickSize: 0.5, contractValue: 0.001, decimals: 1 })) as any;

    const trend15m = buildStrongTrendCandles({ count: 55, startPrice: 68000, step: 95 });
    const entry = 73000;
    const plan = buildMasterSixSlotBracket({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: entry,
      closedCandles: trend15m,
      atr: 140,
      reason: 'PA_W_BOTTOM_REVERSAL_BUY',
      tickSize: 0.5,
    });
    assert.strictEqual(plan.bucket, 'NORMAL_23_TO_40PCT_SEAT');

    const candles5mBase = buildStrongTrendCandles({ count: 25, startPrice: entry - 300, step: 20 });
    candles5mBase[candles5mBase.length - 2] = {
      time: candles5mBase[candles5mBase.length - 2].time,
      open: entry + 530,
      high: entry + 720,
      low: entry + 500,
      close: entry + 510, // bearish shooting star wick
      volume: 1000,
    };

    const trader = new DeltaAutoTraderEngine(3097);
    // Prevent real network fetchCandles calls during unit test
    (trader as any).fetchCandles = async (_sym: string, tf: string) => (tf === '5m' ? candles5mBase : trend15m);
    const runnerPos: DeltaPosition = {
      id: 'delta-live-btc-runner',
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: entry,
      currentPrice: entry,
      quantity: 0.01, // 10 lots * 0.001
      marginUSD: 29.2,
      notionalUSD: 730,
      leverage: 25,
      takeProfitPrice: plan.tpPrice,
      stopLossPrice: plan.slPrice,
      initialStopLossPrice: plan.slPrice,
      atr: 140,
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: 'Runner-Test',
      shadowConfirmedSeconds: 0,
      seatBucket: plan.bucket,
      tier: 'STRONG_23PCT_RUNNER',
      grossRoePct: plan.grossRoePct,
      netRoeAfterFeesPct: plan.netRoeAfterFeesPct,
      breakevenPlusFeeTriggerPrice: plan.breakevenPlusFeeTriggerPrice,
      breakevenPlusFeeLockPrice: plan.breakevenPlusFeeLockPrice,
      runner23PctTriggerPrice: plan.runner23PctTriggerPrice,
      runner18PctLockPrice: plan.runner18PctLockPrice,
    };
    (trader as any).state.activePositions = [runnerPos];

    // 5A: In drawdown -> SL NEVER touched
    await trader.evaluatePositionSLTP(runnerPos, entry - 200, 0);
    assert.ok(runnerPos.pnlUSD < 0);
    assert.strictEqual(runnerPos.stopLossPrice, plan.slPrice);
    assert.strictEqual(updateCalls.length, 0);

    // 5B: Cross Stage 1 (+12% Gross ROE -> lock +4.5% Gross ROE covering 0.12% fees!)
    await trader.evaluatePositionSLTP(runnerPos, plan.breakevenPlusFeeTriggerPrice + 5, 0);
    assert.strictEqual(runnerPos.stopLossPrice, plan.breakevenPlusFeeLockPrice);
    assert.strictEqual(runnerPos.isBreakevenLocked, true);
    assert.ok(runnerPos.stopLossPrice > entry * 1.0012, 'Stage 1 lock must exceed entry + 0.12% round-trip fees');
    assert.strictEqual(updateCalls.length, 1);
    assert.strictEqual(updateCalls[0].sl, plan.breakevenPlusFeeLockPrice);

    // 5C: Normal Runner with a 5m shooting star at +18% ROE on healthy bullish 15m trend MUST NOT exit early!
    await trader.evaluatePositionSLTP(runnerPos, entry * 1.0072, 0);
    assert.strictEqual((trader as any).state.activePositions.length, 1, 'Normal Runner must ignore 5m shooting star before Stage 2 / 40% target');

    // 5D: Cross Stage 2 (+24% Gross ROE -> lock +20% Gross / +17% Net ROE while riding full TP!)
    await trader.evaluatePositionSLTP(runnerPos, plan.runner23PctTriggerPrice + 10, 0);
    assert.strictEqual(runnerPos.stopLossPrice, plan.runner18PctLockPrice);
    assert.strictEqual(runnerPos.takeProfitPrice, plan.tpPrice, 'TP must remain untouched so trade can reach 30%-40%+ ROE');
    assert.strictEqual(updateCalls.length, 2);
    assert.strictEqual(updateCalls[1].sl, plan.runner18PctLockPrice);
  });

  it('6. DeltaExchangeEngine attaches Reduce-Only Limit TP + Stop-Market SL for C-BTC Option when /v2/orders/bracket fails & trails Option SL (+25%->+15%, +28%->+22%)', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';
    process.env.STATE_FILE = '.test_state_3097.json';

    const optSym = 'C-BTC-75000-201126';
    const optOrdersPosted: any[] = [];
    const optPutBodies: any[] = [];
    let currentExSlPrice = '410';
    let mockOptMark = '500';
    let mockOptBid = '498';
    let mockOptAsk = '502';

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = url.toString();
      const m = (init?.method || 'GET').toUpperCase();

      if (u.includes(`/v2/products/${optSym}`) || (u.includes('/v2/products') && u.includes('call_options'))) {
        return new Response(JSON.stringify({
          success: true,
          result: u.includes(optSym)
            ? { id: 9501, symbol: optSym, contract_type: 'call_options', tick_size: '1', contract_value: '0.001', state: 'live' }
            : [{ id: 9501, symbol: optSym, contract_type: 'call_options', tick_size: '1', contract_value: '0.001', state: 'live' }],
        }), { status: 200 });
      }
      if (u.includes(`/v2/tickers/${optSym}`)) {
        return new Response(JSON.stringify({
          success: true,
          result: { symbol: optSym, mark_price: mockOptMark, quotes: { best_bid: mockOptBid, best_ask: mockOptAsk } },
        }), { status: 200 });
      }
      if (u.includes('/v2/orders?') && m === 'GET') {
        // After entry post, return Reduce-Only Limit TP + Stop-Market SL for PUT trailing test!
        if (optOrdersPosted.some((o) => o.reduce_only === true)) {
          return new Response(JSON.stringify({
            success: true,
            result: [
              { id: 9601, product_id: 9501, product_symbol: optSym, size: 39, order_type: 'limit_order', limit_price: '775', reduce_only: true },
              { id: 9602, product_id: 9501, product_symbol: optSym, size: 39, order_type: 'market_order', stop_order_type: 'stop_loss_order', stop_price: currentExSlPrice, reduce_only: true },
            ],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
      }
      if (u.endsWith('/v2/orders/bracket') && m === 'POST') {
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'option_bracket_not_supported' },
        }), { status: 400 });
      }
      if (u.endsWith('/v2/orders') && m === 'POST') {
        const body = JSON.parse(init!.body as string);
        optOrdersPosted.push(body);
        return new Response(JSON.stringify({
          success: true,
          result: { id: 8100 + optOrdersPosted.length, average_fill_price: '500', product_symbol: optSym, size: body.size },
        }), { status: 200 });
      }
      if (u.endsWith('/v2/orders') && m === 'PUT') {
        const body = JSON.parse(init!.body as string);
        optPutBodies.push(body);
        if (body.stop_price) currentExSlPrice = body.stop_price;
        return new Response(JSON.stringify({ success: true, result: { id: body.id } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const ex = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: true,
      baseUrl: 'https://cdn-ind.testnet.deltaex.org',
    });

    const res = await ex.placeOrder({
      symbol: optSym,
      side: 'BUY',
      size: 0.039, // 39 contracts @ 0.001
      price: 500,
      stopLossPrice: 410,  // -18%
      takeProfitPrice: 775, // +55%
      postFillVerifyDelayMs: 5,
    });
    assert.strictEqual(res.success, true);

    const tpLimit = optOrdersPosted.find((o) => o.reduce_only === true && o.order_type === 'limit_order');
    const slStop = optOrdersPosted.find((o) => o.reduce_only === true && o.stop_order_type === 'stop_loss_order');
    assert.ok(tpLimit, 'Must place Reduce-Only Limit TP fallback for Option');
    assert.ok(slStop, 'Must place Reduce-Only Stop-Market SL fallback for Option');
    assert.strictEqual(tpLimit.product_id, 9501);
    assert.strictEqual(slStop.product_id, 9501);
    assert.strictEqual(tpLimit.limit_price, '775');
    assert.strictEqual(slStop.stop_price, '410');

    // Now simulate Option mark advancing +26% to $630 and test trailing SL PUT onto Reduce-Only SL order!
    mockOptMark = '630';
    mockOptBid = '628';
    mockOptAsk = '632';
    const upd1 = await ex.updateBracketOrder(optSym, 575, 775, 'BUY', 500);
    assert.strictEqual(upd1.success, true);
    assert.strictEqual(optPutBodies.length, 1);
    assert.strictEqual(optPutBodies[0].id, 9602);
    assert.strictEqual(optPutBodies[0].stop_price, '575');

    // Test DeltaAutoTraderEngine Option Trailing SL progression (+25%->+15%, +28%->+22% / peak*0.88)
    deltaExchange.getProductSpec = (() => ({ tickSize: 1, contractValue: 0.001, decimals: 0 })) as any;
    deltaExchange.getConfig = (() => ({ apiKey: 'mock-key', apiSecret: 'mock-secret', isSimulation: false, isTestnet: true })) as any;
    const optTrailCalls: Array<{ sl?: number; tp?: number }> = [];
    deltaExchange.updateBracketOrder = (async (_s: string, sl?: number, tp?: number) => {
      optTrailCalls.push({ sl, tp });
      return { success: true };
    }) as any;

    const trader = new DeltaAutoTraderEngine(3097);
    const optPos: DeltaPosition = {
      id: 'opt-live-1',
      symbol: optSym,
      side: 'BUY',
      entryPrice: 500,
      currentPrice: 500,
      quantity: 0.039,
      marginUSD: 19.5,
      notionalUSD: 19.5,
      leverage: 1,
      takeProfitPrice: 775,
      stopLossPrice: 410,
      initialStopLossPrice: 410,
      atr: 90,
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: 'Hybrid ATM Option [BUY CALL]',
      shadowConfirmedSeconds: 0,
      instrumentType: 'OPTION',
      seatBucket: 'OPTION_UNCAPPED_SEAT',
      optionTickSize: 1,
      optionTrailingPeakPrice: 500,
      expectedRoePct: 55,
    };

    // Loss ($450) -> NEVER modify SL
    await trader.evaluatePositionSLTP(optPos, 450, 0);
    assert.strictEqual(optPos.stopLossPrice, 410);
    assert.strictEqual(optTrailCalls.length, 0);

    // +26% gain ($630 >= +25%) -> Lock +15% ($575)
    await trader.evaluatePositionSLTP(optPos, 630, 0);
    assert.strictEqual(optPos.stopLossPrice, 575);
    assert.strictEqual(optTrailCalls.length, 1);

    // +40% gain ($700 >= +28%) -> Lock max(entry*1.22=610, peak*0.88=616) = 616
    await trader.evaluatePositionSLTP(optPos, 700, 0);
    assert.strictEqual(optPos.stopLossPrice, 616);
    assert.strictEqual(optTrailCalls.length, 2);
  });

  it('7. DeltaOptionsMasterEngine selects >=20h expiry & Slightly ITM (Delta 0.55-0.65 / strike <= spot CALL, >= spot PUT)', () => {
    const now = Date.UTC(2026, 10, 10, 15, 0, 0);
    const shortExpiry = now + 8 * 3600 * 1000;   // 8h (<20h -> must reject Theta burn expiry)
    const borderExpiry = now + 19.5 * 3600 * 1000; // 19.5h (<20h -> must reject)
    const goodExpiry = now + 28 * 3600 * 1000;   // 28h (>=20h -> valid!)
    const nextExpiry = now + 52 * 3600 * 1000;   // 52h

    // 7A. With Greeks delta supplied at spot $74,228
    const callChainWithDelta: OptionProductMeta[] = [
      { symbol: 'C-BTC-74000-101126', underlyingAsset: 'BTC', contractType: 'call_options', strikePrice: 74000, expiryTime: shortExpiry, tickSize: 1, contractValue: 0.001, delta: 0.59 },
      { symbol: 'C-BTC-74000-111126', underlyingAsset: 'BTC', contractType: 'call_options', strikePrice: 74000, expiryTime: borderExpiry, tickSize: 1, contractValue: 0.001, delta: 0.59 },
      { symbol: 'C-BTC-73600-121126', underlyingAsset: 'BTC', contractType: 'call_options', strikePrice: 73600, expiryTime: goodExpiry, tickSize: 1, contractValue: 0.001, delta: 0.69 },
      { symbol: 'C-BTC-74000-121126', underlyingAsset: 'BTC', contractType: 'call_options', strikePrice: 74000, expiryTime: goodExpiry, tickSize: 1, contractValue: 0.001, delta: 0.58 },
      { symbol: 'C-BTC-74200-121126', underlyingAsset: 'BTC', contractType: 'call_options', strikePrice: 74200, expiryTime: goodExpiry, tickSize: 1, contractValue: 0.001, delta: 0.50 },
      { symbol: 'C-BTC-74400-121126', underlyingAsset: 'BTC', contractType: 'call_options', strikePrice: 74400, expiryTime: goodExpiry, tickSize: 1, contractValue: 0.001, delta: 0.43 },
    ];
    const pickedCallDelta = DeltaOptionsMasterEngine.selectOptimalOptionContract({
      underlying: 'BTC',
      direction: 'BUY',
      currentSpotPrice: 74228,
      availableOptions: callChainWithDelta,
      nowMs: now,
    });
    assert.strictEqual(pickedCallDelta?.symbol, 'C-BTC-74000-121126', 'Must skip <20h expiries & ATM 74200 and select >=20h Slightly ITM Delta 0.58 Call');

    // 7B. Without Greeks delta supplied (strict ITM strike fallback at spot $74,228 -> prefers 74000 <= spot*0.9985 over ATM 74200)
    const callChainNoDelta = callChainWithDelta.map((c) => ({ ...c, delta: undefined }));
    const pickedCallNoDelta = DeltaOptionsMasterEngine.selectOptimalOptionContract({
      underlying: 'BTC',
      direction: 'BUY',
      currentSpotPrice: 74228,
      availableOptions: callChainNoDelta,
      nowMs: now,
    });
    assert.strictEqual(pickedCallNoDelta?.symbol, 'C-BTC-74000-121126', 'Without Greeks delta, BUY Call must still pick strict Slightly ITM 74000 <= 74228 over ATM 74200');

    // 7C. PUT Option (SELL BTC at $74,228 -> prefers 74400 >= spot*1.0015 / Delta -0.58 over ATM 74200 & short expiry)
    const putChain: OptionProductMeta[] = [
      { symbol: 'P-BTC-74400-101126', underlyingAsset: 'BTC', contractType: 'put_options', strikePrice: 74400, expiryTime: shortExpiry, tickSize: 1, contractValue: 0.001, delta: -0.58 },
      { symbol: 'P-BTC-74200-121126', underlyingAsset: 'BTC', contractType: 'put_options', strikePrice: 74200, expiryTime: goodExpiry, tickSize: 1, contractValue: 0.001, delta: -0.50 },
      { symbol: 'P-BTC-74400-121126', underlyingAsset: 'BTC', contractType: 'put_options', strikePrice: 74400, expiryTime: goodExpiry, tickSize: 1, contractValue: 0.001, delta: -0.58 },
      { symbol: 'P-BTC-74400-131126', underlyingAsset: 'BTC', contractType: 'put_options', strikePrice: 74400, expiryTime: nextExpiry, tickSize: 1, contractValue: 0.001, delta: -0.57 },
    ];
    const pickedPut = DeltaOptionsMasterEngine.selectOptimalOptionContract({
      underlying: 'BTC',
      direction: 'SELL',
      currentSpotPrice: 74228,
      availableOptions: putChain,
      nowMs: now,
    });
    assert.strictEqual(pickedPut?.symbol, 'P-BTC-74400-121126', 'PUT must select >=20h nearest expiry Slightly ITM strike >= spot (74400)');
  });

  it('8. Strict <=2.2% Option Spread Veto, Limit Order (min(bestAsk, mark*1.004)), & $4 Max Risk in Live Execute', async () => {
    const optMeta: OptionProductMeta = {
      symbol: 'C-BTC-74000-121126',
      underlyingAsset: 'BTC',
      contractType: 'call_options',
      strikePrice: 74000,
      expiryTime: Date.now() + 28 * 3600 * 1000,
      tickSize: 1,
      contractValue: 0.001,
      delta: 0.59,
    };

    // 8A. Wide spread (615 / 645 -> 4.88% > 2.2%) MUST be vetoed
    const wideVerdict = DeltaOptionsMasterEngine.buildOptionBracketPlan({
      optionMeta: optMeta,
      bestBid: 615,
      bestAsk: 645,
      markPrice: 630,
      spotEntryPrice: 74228,
      spotSlPrice: 73780,
      spotTpPrice: 75350,
    });
    assert.strictEqual(wideVerdict.approved, false);
    assert.ok(wideVerdict.vetoReason?.includes('OPTION_SPREAD_TOO_WIDE'));

    // 8B. Missing two-sided quotes MUST be vetoed
    const noQuoteVerdict = DeltaOptionsMasterEngine.buildOptionBracketPlan({
      optionMeta: optMeta,
      bestBid: 0,
      bestAsk: 645,
      markPrice: 630,
      spotEntryPrice: 74228,
      spotSlPrice: 73780,
      spotTpPrice: 75350,
    });
    assert.strictEqual(noQuoteVerdict.approved, false);

    // 8C. Tight spread (624 / 632 -> 1.28% <= 2.2%, mark=625 -> limit min(632, 627.5)=628) approves Limit Bracket
    const goodVerdict = DeltaOptionsMasterEngine.buildOptionBracketPlan({
      optionMeta: optMeta,
      bestBid: 624,
      bestAsk: 632,
      markPrice: 625,
      spotEntryPrice: 74228,
      spotSlPrice: 73780,
      spotTpPrice: 75350,
    });
    assert.strictEqual(goodVerdict.approved, true);
    assert.strictEqual(goodVerdict.plan?.entryPremiumLimit, 628);
    assert.strictEqual(goodVerdict.plan?.optionSlPrice, 515); // round(628*0.82=514.96, 1)
    assert.strictEqual(goodVerdict.plan?.spotSlPrice, 73780);
    assert.strictEqual(goodVerdict.plan?.maxRiskUSD, 4);

    // 8D. Live executeHybridAtmOption MUST pass orderType: 'limit_order' (never market_order) & budget <= $4.25 risk
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'LIVE_DELTA_INDIA';
    process.env.STATE_FILE = '.test_state_3096.json';
    deltaExchange.isLiveDispatchActive = () => true;
    deltaExchange.getConfig = (() => ({ apiKey: 'k', apiSecret: 's', isSimulation: false, isTestnet: false, baseUrl: 'https://api.india.delta.exchange' })) as any;
    deltaExchange.registerProduct = (() => {}) as any;

    const expiryIso = new Date(Date.now() + 28 * 3600 * 1000).toISOString();
    const mockProducts = [
      { id: 9201, symbol: 'C-BTC-74000-121126', contract_type: 'call_options', tick_size: '1', contract_value: '0.001', state: 'live', trading_status: 'operational', settlement_time: expiryIso },
      { id: 9202, symbol: 'C-BTC-74200-121126', contract_type: 'call_options', tick_size: '1', contract_value: '0.001', state: 'live', trading_status: 'operational', settlement_time: expiryIso },
    ];
    const mockTickers = [
      { symbol: 'C-BTC-74000-121126', contract_type: 'call_options', strike_price: '74000', tick_size: '1', contract_value: '0.001', mark_price: '625', quotes: { best_bid: '624', best_ask: '632' }, greeks: { delta: '0.59' } },
      { symbol: 'C-BTC-74200-121126', contract_type: 'call_options', strike_price: '74200', tick_size: '1', contract_value: '0.001', mark_price: '520', quotes: { best_bid: '500', best_ask: '530' }, greeks: { delta: '0.50' } },
    ];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('/v2/products')) return new Response(JSON.stringify({ success: true, result: mockProducts }), { status: 200 });
      if (u.includes('/v2/tickers')) return new Response(JSON.stringify({ success: true, result: mockTickers }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;
    deltaExchange.getTicker = (async (sym: string) => mockTickers.find((t) => t.symbol === sym)) as any;

    const placedPayloads: any[] = [];
    deltaExchange.placeOrder = (async (p: any) => {
      placedPayloads.push(p);
      return { success: true, orderId: 'opt-lim-1', fillPrice: p.limitPrice, message: 'ok' };
    }) as any;

    const engine = new DeltaAutoTraderEngine(3096);
    await new Promise((r) => setTimeout(r, 15));
    (engine as any).state.currentCapitalUSD = 180;
    const pos = await engine.executeHybridAtmOption({
      underlying: 'BTC',
      direction: 'BUY',
      spotPrice: 74228,
      closedCandleTime: Date.now(),
      isTestnetMode: false,
      spotSlPrice: 73780,
      spotTpPrice: 75350,
    });

    assert.ok(pos, 'Expected tight-spread Slightly ITM Option to fill via limit_order');
    assert.strictEqual(placedPayloads.length, 1);
    assert.strictEqual(placedPayloads[0].symbol, 'C-BTC-74000-121126');
    assert.strictEqual(placedPayloads[0].orderType, 'limit_order', 'Option entry MUST strictly use limit_order (NEVER market_order)');
    assert.strictEqual(placedPayloads[0].limitPrice, 628);
    assert.ok(pos!.marginUSD * 0.18 <= 4.25, `Option max risk @ -18% SL ($${(pos!.marginUSD * 0.18).toFixed(2)}) must stay <= $4.25`);
    assert.strictEqual(pos!.spotSlPrice, 73780);
  });

  it('9. DeltaExchangeEngine.placeOrder cancels unfilled open limit_order ($0 loss) while keeping market_order untouched', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'LIVE_DELTA_INDIA';
    const optSym = 'C-BTC-74000-121126';
    const orderPosts: any[] = [];
    const deleteCalls: any[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = url.toString();
      const m = (init?.method || 'GET').toUpperCase();
      if (u.includes('/v2/products')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ id: 9701, symbol: optSym, contract_type: 'call_options', tick_size: '1', contract_value: '0.001', state: 'live' }],
        }), { status: 200 });
      }
      if (u.includes(`/v2/tickers/${optSym}`)) {
        return new Response(JSON.stringify({
          success: true,
          result: { symbol: optSym, product_id: 9701, mark_price: '625', quotes: { best_bid: '624', best_ask: '632' } },
        }), { status: 200 });
      }
      if (u.endsWith('/v2/orders') && m === 'POST') {
        const body = JSON.parse(init!.body as string);
        orderPosts.push(body);
        return new Response(JSON.stringify({
          success: true,
          result: { id: 551122, product_symbol: optSym, size: body.size, unfilled_size: body.size, state: 'open', limit_price: body.limit_price },
        }), { status: 200 });
      }
      if (u.includes('/v2/orders/551122') && m === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: { id: 551122, product_symbol: optSym, size: 35, unfilled_size: 35, state: 'open' },
        }), { status: 200 });
      }
      if (u.endsWith('/v2/orders') && m === 'DELETE') {
        deleteCalls.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ success: true, result: { id: 551122 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const ex = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: false,
      baseUrl: 'https://api.india.delta.exchange',
    });

    const unfilledRes = await ex.placeOrder({
      symbol: optSym,
      side: 'BUY',
      size: 0.035,
      price: 628,
      orderType: 'limit_order',
      limitPrice: 628,
      stopLossPrice: 515,
      takeProfitPrice: 848,
      limitFillTimeoutMs: 20,
      postFillVerifyDelayMs: 5,
    });

    assert.strictEqual(orderPosts.length, 1);
    assert.strictEqual(orderPosts[0].order_type, 'limit_order');
    assert.strictEqual(orderPosts[0].limit_price, '628');
    assert.strictEqual(deleteCalls.length, 1, 'Unfilled resting limit_order must be cleanly cancelled via DELETE /v2/orders');
    assert.strictEqual(deleteCalls[0].id, 551122);
    assert.strictEqual(unfilledRes.success, false, 'Unfilled cancelled limit order must NOT register phantom active position');
    assert.ok(unfilledRes.message.includes('LIMIT_ORDER_UNFILLED_CANCELLED'));
  });

  it('10. Spot-Synced Option SL closes Option on underlying Spot breach while Perpetual Futures remain 100% locked against software loss close', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'LIVE_DELTA_INDIA';
    process.env.STATE_FILE = '.test_state_3096.json';
    deltaExchange.isLiveDispatchActive = () => true;
    deltaExchange.getConfig = (() => ({ apiKey: 'k', apiSecret: 's', isSimulation: false, isTestnet: false, baseUrl: 'https://api.india.delta.exchange' })) as any;

    const closedSymbolsPosted: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = url.toString();
      const m = (init?.method || 'GET').toUpperCase();
      if (u.includes('/v2/positions/margined')) {
        return new Response(JSON.stringify({
          success: true,
          result: [
            { product_id: 9701, product_symbol: 'C-BTC-74000-121126', size: 35, unrealized_pnl: '-1.50' },
            { product_id: 27, product_symbol: 'BTCUSD', size: 20, unrealized_pnl: '-2.20' },
          ],
        }), { status: 200 });
      }
      if (u.includes('/v2/orders/bracket') && m === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (u.endsWith('/v2/orders') && m === 'POST') {
        const body = JSON.parse(init!.body as string);
        closedSymbolsPosted.push(body.product_symbol);
        return new Response(JSON.stringify({ success: true, result: { id: 777111, average_fill_price: '585' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    // 10A. Verify DeltaExchangeEngine.closePosition blocks Perpetual BTCUSD loss close even if allowOptionSpotSlClose=true,
    //      but allows Option close when allowOptionSpotSlClose=true!
    const ex = new DeltaExchangeEngine({
      apiKey: 'k',
      apiSecret: 's',
      isSimulation: false,
      isTestnet: false,
      baseUrl: 'https://api.india.delta.exchange',
    });
    const perpBlock = await ex.closePosition('BTCUSD', { allowOptionSpotSlClose: true });
    assert.strictEqual(perpBlock.success, false);
    assert.ok(perpBlock.message.includes('BLOCKED SOFTWARE LOSS CLOSE'));

    const optAllow = await ex.closePosition('C-BTC-74000-121126', { allowOptionSpotSlClose: true });
    assert.strictEqual(optAllow.success, true);
    assert.deepStrictEqual(closedSymbolsPosted, ['C-BTC-74000-121126']);

    // 10B. Verify DeltaAutoTraderEngine.evaluatePositionSLTP closes Call Option when BTCUSD spot breaches spotSlPrice,
    //      while keeping losing Perpetual BTCUSD open!
    const engine = new DeltaAutoTraderEngine(3096);
    await new Promise((r) => setTimeout(r, 15));
    const callOptPos: DeltaPosition = {
      id: 'opt-spot-sl-1',
      symbol: 'C-BTC-74000-121126',
      side: 'BUY',
      entryPrice: 628,
      currentPrice: 628,
      quantity: 0.035,
      marginUSD: 21.98,
      notionalUSD: 21.98,
      leverage: 1,
      takeProfitPrice: 848,
      stopLossPrice: 515, // -18% Option SL
      initialStopLossPrice: 515,
      atr: 110,
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: 'Master ITM Option [BUY CALL]',
      shadowConfirmedSeconds: 0,
      instrumentType: 'OPTION',
      optionType: 'CALL',
      seatBucket: 'OPTION_UNCAPPED_SEAT',
      optionTickSize: 1,
      expectedRoePct: 35,
      spotEntryPrice: 74228,
      spotSlPrice: 74080,
      underlyingAsset: 'BTC',
    };
    const btcPerpPos: DeltaPosition = {
      id: 'perp-locked-1',
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: 74228,
      currentPrice: 74050,
      quantity: 0.02,
      marginUSD: 59,
      notionalUSD: 1484,
      leverage: 25,
      takeProfitPrice: 75350,
      stopLossPrice: 73780,
      initialStopLossPrice: 73780,
      atr: 140,
      isBreakevenLocked: false,
      pnlUSD: -3.56,
      pnlPercent: -6.0,
      entryTime: Date.now(),
      strategyName: 'BTC Perp Runner',
      shadowConfirmedSeconds: 0,
      seatBucket: 'NORMAL_23_TO_40PCT_SEAT',
    };
    (engine as any).state.activePositions = [callOptPos, btcPerpPos];

    deltaExchange.getMarketPrice = (async (sym: string) => (sym === 'BTCUSD' ? 74050 : 585)) as any;

    // Even with Option mark at $585 (only -6.8% loss, NOT -18% Option SL!), BTC Spot @ 74050 <= spotSlPrice 74080 must exit Option!
    await engine.evaluatePositionSLTP(callOptPos, 585, 0);
    // Attempting closePosition on losing Perpetual BTCUSD MUST be blocked by UniversalTradeGuard!
    await engine.closePosition(btcPerpPos.id, 'STOP_LOSS_HIT', 74050, { allowOptionSpotSlClose: true });

    const remainingIds = (engine as any).state.activePositions.map((p: DeltaPosition) => p.id);
    assert.strictEqual(remainingIds.includes('opt-spot-sl-1'), false, 'Option must close cleanly when underlying BTC spot breaches spotSlPrice');
    assert.strictEqual(remainingIds.includes('perp-locked-1'), true, 'Losing Perpetual BTCUSD MUST remain 100% locked against software loss closes');
  });
});
