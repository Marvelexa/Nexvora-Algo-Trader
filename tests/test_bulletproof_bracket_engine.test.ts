import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  buildBulletproofBracket,
  roundToTickSize,
  FifteenMinCandleCloseGate,
  KlinePoint,
} from '../lib/strategies/strategyRegistry';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { DeltaExchangeEngine, deltaExchange } from '../lib/deltaExchangeEngine';
import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine';
import { DeltaPosition } from '../src/types';

function makeCandles(count: number, startPrice: number, step: number, baseTimeMs?: number): KlinePoint[] {
  const stepMs = 15 * 60 * 1000;
  const t0 = baseTimeMs ?? (Date.UTC(2026, 10, 10, 10, 15, 0) - count * stepMs);
  const out: KlinePoint[] = [];
  let p = startPrice;
  for (let i = 0; i < count; i++) {
    const open = p;
    const close = p + step;
    const high = Math.max(open, close) + Math.abs(startPrice) * 0.001;
    const low = Math.min(open, close) - Math.abs(startPrice) * 0.001;
    out.push({ time: t0 + i * stepMs, open, high, low, close, volume: 600 });
    p = close;
  }
  return out;
}

describe('All-in-One Unified Bulletproof Bracket Engine Suite', () => {
  const originalFetch = globalThis.fetch;
  const originalUpdateBracket = deltaExchange.updateBracketOrder.bind(deltaExchange);
  const originalGetCachedTicker = deltaExchange.getCachedTicker.bind(deltaExchange);
  const originalGetProductSpec = deltaExchange.getProductSpec.bind(deltaExchange);
  const envBackup = {
    PORT: process.env.PORT,
    DELTA_IS_SIMULATION: process.env.DELTA_IS_SIMULATION,
    PAPER_TRADING: process.env.PAPER_TRADING,
    DELTA_TRADING_MODE: process.env.DELTA_TRADING_MODE,
    STATE_FILE: process.env.STATE_FILE,
  };

  const cleanupPaths: string[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    deltaExchange.updateBracketOrder = originalUpdateBracket;
    deltaExchange.getCachedTicker = originalGetCachedTicker;
    deltaExchange.getProductSpec = originalGetProductSpec;
    process.env.PORT = envBackup.PORT;
    process.env.DELTA_IS_SIMULATION = envBackup.DELTA_IS_SIMULATION;
    process.env.PAPER_TRADING = envBackup.PAPER_TRADING;
    process.env.DELTA_TRADING_MODE = envBackup.DELTA_TRADING_MODE;
    process.env.STATE_FILE = envBackup.STATE_FILE;
  });

  after(() => {
    for (const p of cleanupPaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  });

  it('1. roundToTickSize handles decimals, halves, integers, and scientific-notation ticks cleanly', () => {
    assert.strictEqual(roundToTickSize(0.000123456, 1e-7), 0.0001235);
    assert.strictEqual(roundToTickSize(0.000012349, 1e-8), 0.00001235);
    assert.strictEqual(roundToTickSize(0.41236, 0.0001), 0.4124);
    assert.strictEqual(roundToTickSize(52.784, 0.01), 52.78);
    assert.strictEqual(roundToTickSize(2236.47, 0.05), 2236.45);
    assert.strictEqual(roundToTickSize(70123.3, 0.5), 70123.5);
    assert.strictEqual(roundToTickSize(1234.6, 5), 1235);

    const eng = new DeltaExchangeEngine({ isSimulation: true });
    assert.strictEqual(eng.roundToTickSize(0.000123456, 1e-7), '0.0001235');
    assert.strictEqual(eng.roundToTickSize(52.784, '0.01'), '52.78');
    assert.strictEqual(eng.roundToTickSize(2236.47, 0.05), '2236.45');
  });

  it('2. buildBulletproofBracket sanitizes freak glitch wicks, front-runs reversal wall, and sets 55%/25% profit locks', () => {
    // 2A: BUY with freak low spike in last 5 bars + clear candle-body reversal ceiling ~0.90% above entry
    const buyCandles = makeCandles(50, 99.0, 0.02);
    const entryBuy = buyCandles[buyCandles.length - 1].close;
    // Inject a freak -10% low needle spike on bar -2 (must be sanitized so SL stays 0.55%–0.80%!)
    buyCandles[buyCandles.length - 2] = {
      ...buyCandles[buyCandles.length - 2],
      low: buyCandles[buyCandles.length - 2].close * 0.90,
    };
    // Inject a prominent resistance peak at index 20 ~0.95% above entryBuy
    const wallPeak = entryBuy * 1.0095;
    buyCandles[20] = { ...buyCandles[20], open: wallPeak - 0.05, close: wallPeak, high: wallPeak + 0.1 };
    buyCandles[19] = { ...buyCandles[19], close: wallPeak - 0.2, open: wallPeak - 0.25 };
    buyCandles[21] = { ...buyCandles[21], close: wallPeak - 0.2, open: wallPeak - 0.15 };

    const buyBracket = buildBulletproofBracket({
      closedCandles: buyCandles,
      side: 'BUY',
      entryPrice: entryBuy,
      atr: 0.45,
      tickSize: 0.01,
    });

    assert.ok(buyBracket.slPrice < entryBuy, 'BUY SL must be strictly below entry');
    assert.ok(buyBracket.tpPrice > entryBuy, 'BUY TP must be strictly above entry');
    assert.ok(buyBracket.tpPrice < wallPeak, `BUY TP ($${buyBracket.tpPrice}) must front-run reversal wall ($${wallPeak.toFixed(2)})`);
    assert.ok(buyBracket.slPct >= 0.55 && buyBracket.slPct <= 0.80, `BUY slPct ${buyBracket.slPct}% must stay in [0.55%, 0.80%]`);
    assert.ok(buyBracket.tpPct >= 0.69 && buyBracket.tpPct <= 1.45, `BUY tpPct ${buyBracket.tpPct}% must stay in [0.69%, 1.45%]`);
    assert.ok(buyBracket.rrRatio >= 1.25, `Expected RR >= 1.25, got ${buyBracket.rrRatio}`);
    assert.ok(
      buyBracket.trailActivationPrice > buyBracket.trailLockPrice && buyBracket.trailLockPrice > entryBuy,
      'BUY 55% activation must exceed 25% lock and stay above entry'
    );

    // 2B: SELL with freak high spike + support floor ~0.90% below entry
    const sellCandles = makeCandles(50, 102.0, -0.02);
    const entrySell = sellCandles[sellCandles.length - 1].close;
    sellCandles[sellCandles.length - 2] = {
      ...sellCandles[sellCandles.length - 2],
      high: sellCandles[sellCandles.length - 2].close * 1.12, // freak high spike!
    };
    const floorWall = entrySell * 0.9905;
    sellCandles[20] = { ...sellCandles[20], open: floorWall + 0.05, close: floorWall, low: floorWall - 0.1 };
    sellCandles[19] = { ...sellCandles[19], close: floorWall + 0.2, open: floorWall + 0.25 };
    sellCandles[21] = { ...sellCandles[21], close: floorWall + 0.2, open: floorWall + 0.15 };

    const sellBracket = buildBulletproofBracket({
      closedCandles: sellCandles,
      side: 'SELL',
      entryPrice: entrySell,
      atr: 0.45,
      tickSize: 0.01,
    });

    assert.ok(sellBracket.slPrice > entrySell, 'SELL SL must be strictly above entry');
    assert.ok(sellBracket.tpPrice < entrySell, 'SELL TP must be strictly below entry');
    assert.ok(sellBracket.tpPrice > floorWall, `SELL TP ($${sellBracket.tpPrice}) must front-run support floor ($${floorWall.toFixed(2)})`);
    assert.ok(sellBracket.slPct >= 0.55 && sellBracket.slPct <= 0.80, `SELL slPct ${sellBracket.slPct}% must stay in [0.55%, 0.80%]`);
    assert.ok(sellBracket.rrRatio >= 1.25, `Expected SELL RR >= 1.25, got ${sellBracket.rrRatio}`);
    assert.ok(
      sellBracket.trailActivationPrice < sellBracket.trailLockPrice && sellBracket.trailLockPrice < entrySell,
      'SELL 55% activation must be below 25% lock and both below entry'
    );
  });

  it('3. UniversalTradeGuard.validateAndBuildBracket filters non-crypto tokens and enforces directional validation, $4 max risk, cached tick lookup, and 55%/25% levels', async () => {
    // Seed UniversalTradeGuard dynamic product cache from mocked /v2/products (including non-crypto items that MUST be filtered out)
    (UniversalTradeGuard as any).lastProductsFetchTime = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: true,
      result: [
        { id: 888, symbol: 'SILVERUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '0.1', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['metal'] } },
        { id: 889, symbol: 'PAXGUSD', contract_type: 'perpetual_futures', tick_size: '0.05', contract_value: '0.001', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['metal'] } },
        { id: 890, symbol: 'NVDAXUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '0.1', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['xStock'] } },
        { id: 891, symbol: 'SNDKBUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '0.1', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['xStock'] } },
        { id: 196, symbol: 'SOLUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '1', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
        { id: 3136, symbol: 'ETHUSD', contract_type: 'perpetual_futures', tick_size: '0.05', contract_value: '0.01', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
        { id: 27, symbol: 'BTCUSD', contract_type: 'perpetual_futures', tick_size: '0.5', contract_value: '0.001', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      ],
    }), { status: 200 })) as any;
    const discovered = await UniversalTradeGuard.refreshDynamicProducts(true);

    // Non-crypto assets MUST be excluded from discovery and vetoed on validateAndBuildBracket
    for (const nonCrypto of ['SILVERUSD', 'PAXGUSD', 'NVDAXUSD', 'SNDKBUSD', 'XAUTUSD']) {
      assert.strictEqual(discovered.has(nonCrypto), false, `${nonCrypto} must be excluded from product discovery`);
    }

    const stepMs = 15 * 60 * 1000;
    const closeBoundaryMs = Date.UTC(2026, 10, 10, 10, 15, 0);
    const nowMs = Date.UTC(2026, 10, 10, 10, 15, 5);
    const baseTimeMs = closeBoundaryMs - 59 * stepMs;

    const uptrend = makeCandles(60, 145.0, 0.08, baseTimeMs);
    // Forming candle at 10:15:00
    uptrend[uptrend.length - 1] = {
      time: closeBoundaryMs,
      open: 149.68,
      high: 149.72,
      low: 149.65,
      close: 149.70,
      volume: 100,
    };

    const nonCryptoVeto = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'NVDAXUSD',
      side: 'BUY',
      entryPrice: 149.68,
      candles15m: uptrend,
      accountCapitalUSD: 178.57,
      leverage: 25,
      signalReason: 'PA_W_BOTTOM_REVERSAL',
      enforceCloseWindow: true,
      nowMs,
    });
    assert.strictEqual(nonCryptoVeto.approved, false);
    assert.ok(nonCryptoVeto.vetoReason?.includes('NON_CRYPTO_STOCK_COMMODITY_VETO'));

    // Omit tickSize & contractValue to prove UniversalTradeGuard resolves them from /v2/products cache for SOLUSD (0.01 tick)!
    const guardBuy = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: 149.683,
      candles15m: uptrend,
      accountCapitalUSD: 178.57,
      leverage: 25,
      signalReason: 'PA_W_BOTTOM_REVERSAL',
      enforceCloseWindow: true,
      nowMs,
    });

    assert.strictEqual(guardBuy.approved, true, `Expected BUY approval, got: ${guardBuy.vetoReason}`);
    assert.strictEqual(guardBuy.tickSize, 0.01);
    assert.ok(guardBuy.slPrice < guardBuy.entryPrice && guardBuy.tpPrice > guardBuy.entryPrice);
    assert.ok(guardBuy.expectedMaxLossUSD <= UniversalTradeGuard.MAX_RISK_PER_TRADE_USD + 0.01);
    assert.ok(guardBuy.trailActivationPrice && guardBuy.trailLockPrice);
    assert.ok(guardBuy.trailActivationPrice! > guardBuy.trailLockPrice! && guardBuy.trailLockPrice! > guardBuy.entryPrice);
    // Exact 0.01 tick alignment check
    assert.strictEqual(Number((guardBuy.slPrice * 100).toFixed(4)) % 1, 0);
    assert.strictEqual(Number((guardBuy.tpPrice * 100).toFixed(4)) % 1, 0);

    // Verify SELL directional validation + 0.05 tick alignment from cached ETHUSD metadata
    const downtrend = makeCandles(60, 2700.0, -4.0, baseTimeMs);
    downtrend[downtrend.length - 1] = {
      time: closeBoundaryMs,
      open: 2464.0,
      high: 2466.0,
      low: 2462.0,
      close: 2463.0,
      volume: 100,
    };
    const guardSell = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'ETHUSD',
      side: 'SELL',
      entryPrice: 2464.13,
      candles15m: downtrend,
      accountCapitalUSD: 178.57,
      leverage: 25,
      signalReason: 'PA_M_TOP_REVERSAL',
      enforceCloseWindow: true,
      nowMs,
    });

    assert.strictEqual(guardSell.approved, true, `Expected SELL approval, got: ${guardSell.vetoReason}`);
    assert.strictEqual(guardSell.tickSize, 0.05);
    assert.ok(guardSell.tpPrice < guardSell.entryPrice && guardSell.slPrice > guardSell.entryPrice);
    assert.ok(guardSell.trailActivationPrice! < guardSell.trailLockPrice! && guardSell.trailLockPrice! < guardSell.entryPrice);
    assert.strictEqual(Math.round(guardSell.slPrice * 100) % 5, 0);
    assert.strictEqual(Math.round(guardSell.tpPrice * 100) % 5, 0);
  });

  it('4. DeltaExchangeEngine.placeOrder waits 2000ms post-fill & places Reduce-Only Limit TP + Stop-Market SL if /v2/orders/bracket fails', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';

    const orderPosts: any[] = [];
    let bracketAttempts = 0;

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
          result: { symbol: 'SILVERUSD', mark_price: '52.68', quotes: { best_bid: '52.67', best_ask: '52.69' } },
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/orders?') && method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders/bracket') && method === 'POST') {
        bracketAttempts++;
        // Force /v2/orders/bracket failure so Reduce-Only individual fallback fires!
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'bracket_service_unavailable' },
        }), { status: 400 });
      }
      if (urlStr.endsWith('/v2/orders') && method === 'POST') {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        orderPosts.push(body);
        return new Response(JSON.stringify({
          success: true,
          result: { id: 7000 + orderPosts.length, average_fill_price: '52.68', product_symbol: 'SILVERUSD' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const eng = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: true,
      baseUrl: 'https://cdn-ind.testnet.deltaex.org',
    });

    const tStart = Date.now();
    const res = await eng.placeOrder({
      symbol: 'SILVERUSD',
      side: 'SELL',
      size: 10.2,
      price: 52.68,
      stopLossPrice: 53.02,
      takeProfitPrice: 52.10,
      // Keep real default 2000ms wait here to prove >= 1900ms delay!
    });
    const elapsedMs = Date.now() - tStart;

    assert.strictEqual(res.success, true);
    assert.ok(elapsedMs >= 1900, `Expected mandatory ~2000ms post-fill wait, elapsed=${elapsedMs}ms`);
    assert.strictEqual(bracketAttempts, 2, 'Expected 2 /v2/orders/bracket retry attempts before reduce-only fallback');

    const tpReduceOnly = orderPosts.find((p) => p.reduce_only === true && p.order_type === 'limit_order');
    const slReduceOnly = orderPosts.find((p) => p.reduce_only === true && p.stop_order_type === 'stop_loss_order');
    assert.ok(tpReduceOnly, 'Must place Reduce-Only Limit TP fallback when bracket endpoint fails');
    assert.ok(slReduceOnly, 'Must place Reduce-Only Stop-Market SL fallback when bracket endpoint fails');
    assert.strictEqual(tpReduceOnly.product_id, 888);
    assert.strictEqual(slReduceOnly.product_id, 888);
    assert.strictEqual(tpReduceOnly.side, 'buy');
    assert.strictEqual(slReduceOnly.side, 'buy');
    assert.strictEqual(tpReduceOnly.limit_price, '52.10');
    assert.strictEqual(slReduceOnly.stop_price, '53.02');
  });

  it('5. DeltaExchangeEngine.updateBracketOrder cleanly trails SL alongside Reduce-Only Limit TP without cancelling orders', async () => {
    process.env.PORT = '3005';
    process.env.DELTA_IS_SIMULATION = 'false';
    process.env.PAPER_TRADING = 'false';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';

    const putBodies: any[] = [];
    let deleteAllCalled = false;

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
          result: { symbol: 'SILVERUSD', mark_price: '52.28' },
        }), { status: 200 });
      }
      if (urlStr.includes('/v2/orders?') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [
            { id: 801, product_id: 888, product_symbol: 'SILVERUSD', size: 102, order_type: 'limit_order', limit_price: '52.08', reduce_only: true },
            { id: 802, product_id: 888, product_symbol: 'SILVERUSD', size: 102, order_type: 'market_order', stop_order_type: 'stop_loss_order', stop_price: '53.02', reduce_only: true },
          ],
        }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders') && method === 'PUT') {
        putBodies.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ success: true, result: { id: 802 } }), { status: 200 });
      }
      if (urlStr.endsWith('/v2/orders/all') && method === 'DELETE') {
        deleteAllCalled = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const eng = new DeltaExchangeEngine({
      apiKey: 'mock-key',
      apiSecret: 'mock-secret',
      isSimulation: false,
      isTestnet: true,
      baseUrl: 'https://cdn-ind.testnet.deltaex.org',
    });

    // Trailing SL from 53.02 down to profitable 52.53 while TP stays 52.08
    const upd = await eng.updateBracketOrder('SILVERUSD', 52.53, 52.08, 'SELL', 52.68);
    assert.strictEqual(upd.success, true);
    assert.strictEqual(deleteAllCalled, false, 'Must NEVER cancel orders when both Reduce-Only TP & SL legs exist');
    assert.strictEqual(putBodies.length, 1, 'Only SL should be PUT since Limit TP limit_price is unchanged');
    assert.strictEqual(putBodies[0].id, 802);
    assert.strictEqual(putBodies[0].stop_price, '52.53');
  });

  it('6. DeltaAutoTraderEngine.evaluatePositionSLTP NEVER modifies SL in loss, and arms +25% Profit-Lock SL when crossing 55% target', async () => {
    process.env.PORT = '3005';
    process.env.STATE_FILE = '.test_state_3999.json';
    cleanupPaths.push(
      path.join(process.cwd(), '.test_state_3999.json'),
      path.join(process.cwd(), 'public', 'closed_trades_history_3999.json')
    );

    const updateCalls: Array<{ sym: string; sl?: number; tp?: number }> = [];
    deltaExchange.updateBracketOrder = (async (sym: string, sl?: number, tp?: number) => {
      updateCalls.push({ sym, sl, tp });
      return { success: true };
    }) as any;
    deltaExchange.getCachedTicker = (() => undefined) as any;
    deltaExchange.getProductSpec = (() => ({ tickSize: 0.01, contractValue: 1.0, decimals: 2 })) as any;

    const trader = new DeltaAutoTraderEngine(3999);

    const pos: DeltaPosition = {
      id: 'delta-live-sol-test',
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: 100.00,
      currentPrice: 99.60,
      quantity: 6,
      marginUSD: 24.0,
      notionalUSD: 600.0,
      leverage: 25,
      takeProfitPrice: 101.00,
      stopLossPrice: 99.40,
      initialStopLossPrice: 99.40,
      atr: 0.4,
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: 'Test-Bulletproof',
      shadowConfirmedSeconds: 0,
      trailActivationPrice: 100.55, // 55% of 1.00 TP
      trailTriggerPrice: 100.55,
      trailLockPrice: 100.25,       // +25% of 1.00 TP
    };

    // 6A: Position in negative PnL ($99.60 => -$2.40 USD): NEVER touch SL/TP or call updateBracketOrder!
    await trader.evaluatePositionSLTP(pos, 99.60, 0);
    assert.ok(pos.pnlUSD < 0);
    assert.strictEqual(pos.stopLossPrice, 99.40, 'SL must remain untouched while PnL < 0');
    assert.strictEqual(pos.takeProfitPrice, 101.00, 'TP must remain untouched while PnL < 0');
    assert.strictEqual(updateCalls.length, 0, 'Must NEVER call updateBracketOrder while PnL <= 0');

    // 6B: Position in profit below 55% ($100.40 => +$2.40 USD < $100.55 activation): SL stays at $99.40!
    await trader.evaluatePositionSLTP(pos, 100.40, 0);
    assert.strictEqual(pos.stopLossPrice, 99.40, 'SL must stay untouched before crossing 55% activation');
    assert.strictEqual(Boolean(pos.isProfitLockArmed), false);
    assert.strictEqual(updateCalls.length, 0);

    // 6C: Position crosses 55% activation ($100.58 >= $100.55): SL locks at $100.25 (+25% profit) and updates exchange bracket!
    await trader.evaluatePositionSLTP(pos, 100.58, 0);
    assert.strictEqual(pos.stopLossPrice, 100.25, 'SL must lock at +25% trailLockPrice ($100.25) once 55% reached');
    assert.strictEqual(pos.isProfitLockArmed, true);
    assert.strictEqual(updateCalls.length, 1);
    assert.strictEqual(updateCalls[0].sl, 100.25);
    assert.strictEqual(updateCalls[0].tp, 101.00);
  });
});
