import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine';

describe('Dynamic Perpetual Product Discovery & Precision Sizing Suite', () => {
  const originalFetch = globalThis.fetch;
  const originalIsAtWindow = DeltaAutoTraderEngine.isAt15mBoundaryWindow;
  const envBackup = {
    PORT: process.env.PORT,
    DELTA_IS_SIMULATION: process.env.DELTA_IS_SIMULATION,
    PAPER_TRADING: process.env.PAPER_TRADING,
    DELTA_TRADING_MODE: process.env.DELTA_TRADING_MODE,
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    DeltaAutoTraderEngine.isAt15mBoundaryWindow = originalIsAtWindow;
    (UniversalTradeGuard as any).lastProductsFetchTime = 0;
    process.env.PORT = envBackup.PORT;
    process.env.DELTA_IS_SIMULATION = envBackup.DELTA_IS_SIMULATION;
    process.env.PAPER_TRADING = envBackup.PAPER_TRADING;
    process.env.DELTA_TRADING_MODE = envBackup.DELTA_TRADING_MODE;
    for (const f of ['.delta_auto_trader_state_3099.json', path.join('public', 'closed_trades_history_3099.json')]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  });

  it('Part 1 & 2: Dynamic product discovery loads pure crypto perps & excludes stocks/commodities on Live and Testnet', async () => {
    // 1. Test Demo/Testnet discovery (9 tradfi tokens excluded -> 8 pure crypto perpetuals remain)
    (UniversalTradeGuard as any).lastProductsFetchTime = 0;
    const testnetMap = await UniversalTradeGuard.refreshDynamicProducts(true, 'https://cdn-ind.testnet.deltaex.org');
    console.log(`Discovered ${testnetMap.size} pure crypto Testnet perpetuals`);
    assert.strictEqual(testnetMap.size >= 8, true, `Testnet should discover at least 8 pure crypto perpetuals, got ${testnetMap.size}`);
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('BTCUSD'), true, 'BTCUSD should be tradable');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('ETHUSD'), true, 'ETHUSD should be tradable');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('SOLUSD'), true, 'SOLUSD should be tradable');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('1000SHIBUSD'), true, '1000SHIBUSD should be tradable');

    for (const nonCrypto of ['NVDAXUSD', 'SNDKBUSD', 'XAUTUSD', 'SILVERUSD', 'SLVONUSD', 'PAXGUSD', 'SPYXUSD', 'QQQXUSD', 'USOONUSD', 'EURUSD']) {
      assert.strictEqual(testnetMap.has(nonCrypto), false, `${nonCrypto} must be excluded from Testnet map`);
      assert.strictEqual(UniversalTradeGuard.isSymbolTradable(nonCrypto), false, `${nonCrypto} must NOT be tradable`);
    }

    // Genuine crypto ending with *XUSD must NEVER be blocked by suffix rule
    for (const genuineXusd of ['IMXUSD', 'SNXUSD', 'STXUSD', 'CVXUSD', 'GMXUSD', 'CFXUSD', 'IOTXUSD', 'TRXUSD', 'AVAXUSD', 'DYDXUSD']) {
      assert.strictEqual(UniversalTradeGuard.isPureCryptoPerpetual(genuineXusd), true, `${genuineXusd} must remain allowed as genuine crypto`);
    }

    // 2. Test Live India discovery
    // Force refresh by resetting timestamp
    (UniversalTradeGuard as any).lastProductsFetchTime = 0;
    const liveMap = await UniversalTradeGuard.refreshDynamicProducts(false, 'https://api.india.delta.exchange');
    console.log(`Discovered ${liveMap.size} pure crypto Live India perpetuals`);
    assert.strictEqual(liveMap.size >= 189, true, `Live should discover 189+ pure crypto perpetuals, got ${liveMap.size}`);
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('ZECUSD'), true, 'ZECUSD should be tradable on Live');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('NEARUSD'), true, 'NEARUSD should be tradable on Live');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('AVAXUSD'), true, 'AVAXUSD (*XUSD crypto) should be tradable on Live');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('STXUSD'), true, 'STXUSD (*XUSD crypto) should be tradable on Live');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('TRXUSD'), true, 'TRXUSD (*XUSD crypto) should be tradable on Live');
    assert.strictEqual(UniversalTradeGuard.isSymbolTradable('SOONUSD'), true, 'SOONUSD should NOT be confused with USOONUSD');

    for (const liveNonCrypto of ['NVDAXUSD', 'SNDKBUSD', 'XAUTUSD', 'TSLAXUSD', 'AAPLXUSD', 'MSFTBUSD', 'OILUSD', 'COINXUSD', 'QQQXUSD', 'SPYXUSD']) {
      assert.strictEqual(liveMap.has(liveNonCrypto), false, `${liveNonCrypto} must be excluded from Live map`);
      assert.strictEqual(UniversalTradeGuard.isSymbolTradable(liveNonCrypto), false, `${liveNonCrypto} must NOT be tradable on Live`);
    }
  });

  it('Part 4: Dynamic tick size rounding works across different coin precisions', () => {
    // BTC: tick size 0.1
    const btcRounded = UniversalTradeGuard.roundToTick(75142.5489, 0.1);
    assert.strictEqual(btcRounded, 75142.5);

    // ETH: tick size 0.05
    const ethRounded = UniversalTradeGuard.roundToTick(2136.37, 0.05);
    assert.strictEqual(ethRounded, 2136.35);

    // DOGE: tick size 0.000001
    const dogeRounded = UniversalTradeGuard.roundToTick(0.07034567, 0.000001);
    assert.strictEqual(dogeRounded, 0.070346);

    // DOGS: tick size 0.00000001
    const dogsRounded = UniversalTradeGuard.roundToTick(0.0000613245, 0.00000001);
    assert.strictEqual(dogsRounded, 0.00006132);
  });

  it('Part 4: Risk per trade stays strictly capped at <= $4.00 USD across high and low contract values', () => {
    // DOGEUSD: contract value = 100, price = $0.0705, 0.60% SL ($0.07008)
    const dogeSize = UniversalTradeGuard.calculateRiskScaledPositionSize({
      entryPrice: 0.0705,
      slPrice: 0.07008,
      contractValue: 100.0,
      accountCapitalUSD: 230.0,
      leverage: 30,
      marginPercent: 0.25,
      maxRiskUSD: 4.00,
    });
    console.log('DOGEUSD size:', dogeSize);
    assert.strictEqual(dogeSize.maxLossUSD <= 4.00, true, `DOGE max loss must be <= $4.00, got $${dogeSize.maxLossUSD}`);
    assert.strictEqual(dogeSize.contracts >= 1, true);

    // BTCUSD: contract value = 0.001, price = $75,000, 0.60% SL ($74,550)
    const btcSize = UniversalTradeGuard.calculateRiskScaledPositionSize({
      entryPrice: 75000,
      slPrice: 74550,
      contractValue: 0.001,
      accountCapitalUSD: 230.0,
      leverage: 30,
      marginPercent: 0.25,
      maxRiskUSD: 4.00,
    });
    console.log('BTCUSD size:', btcSize);
    assert.strictEqual(btcSize.maxLossUSD <= 4.00, true, `BTC max loss must be <= $4.00, got $${btcSize.maxLossUSD}`);
    assert.strictEqual(btcSize.contracts >= 1, true);
  });

  it('Part 5: DeltaAutoTraderEngine.runScanCycle Stage A excludes NVDAXUSD/SNDKBUSD/XAUTUSD/SILVERUSD and keeps pure crypto', async () => {
    process.env.PORT = '3099';
    process.env.DELTA_IS_SIMULATION = 'true';
    process.env.PAPER_TRADING = 'true';
    process.env.DELTA_TRADING_MODE = 'DELTA_TESTNET';
    (UniversalTradeGuard as any).lastProductsFetchTime = 0;

    const scannedSymbols: string[] = [];
    const mockProducts = [
      { id: 27, symbol: 'BTCUSD', contract_type: 'perpetual_futures', tick_size: '0.5', contract_value: '0.001', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      { id: 3136, symbol: 'ETHUSD', contract_type: 'perpetual_futures', tick_size: '0.05', contract_value: '0.01', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      { id: 196, symbol: 'SOLUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '1', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      { id: 201, symbol: 'IMXUSD', contract_type: 'perpetual_futures', tick_size: '0.001', contract_value: '1', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      { id: 202, symbol: 'SOONUSD', contract_type: 'perpetual_futures', tick_size: '0.001', contract_value: '1', state: 'live', trading_status: 'operational', product_specs: { top_tag: '', tags: [] } },
      { id: 888, symbol: 'SILVERUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '0.1', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['metal'] } },
      { id: 889, symbol: 'NVDAXUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '0.1', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['xStock'] } },
      { id: 890, symbol: 'SNDKBUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '0.1', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['xStock'] } },
      { id: 891, symbol: 'XAUTUSD', contract_type: 'perpetual_futures', tick_size: '0.1', contract_value: '0.001', state: 'live', trading_status: 'operational', product_specs: { top_tag: 'tradfi', tags: ['metal'] } },
    ];
    // Stage A /v2/tickers intentionally omits product_specs to test symbol + cached blocklist filtering
    const mockTickers = [
      { symbol: 'NVDAXUSD', contract_type: 'perpetual_futures', turnover_usd: '99999999', quotes: { best_bid: '185.00', best_ask: '185.05' } },
      { symbol: 'SNDKBUSD', contract_type: 'perpetual_futures', turnover_usd: '88888888', quotes: { best_bid: '40.00', best_ask: '40.02' } },
      { symbol: 'XAUTUSD', contract_type: 'perpetual_futures', turnover_usd: '77777777', quotes: { best_bid: '2800.0', best_ask: '2801.0' } },
      { symbol: 'SILVERUSD', contract_type: 'perpetual_futures', turnover_usd: '66666666', quotes: { best_bid: '52.67', best_ask: '52.69' } },
      { symbol: 'QQQXUSD', contract_type: 'perpetual_futures', turnover_usd: '55555555', quotes: { best_bid: '500.0', best_ask: '500.1' } },
      { symbol: 'TSLAXUSD', contract_type: 'perpetual_futures', turnover_usd: '44444444', quotes: { best_bid: '300.0', best_ask: '300.1' } },
      { symbol: 'EURUSD', contract_type: 'perpetual_futures', turnover_usd: '33333333', quotes: { best_bid: '1.0800', best_ask: '1.0801' } },
      { symbol: 'BTCUSD', contract_type: 'perpetual_futures', turnover_usd: '50000000', quotes: { best_bid: '75000', best_ask: '75010' } },
      { symbol: 'ETHUSD', contract_type: 'perpetual_futures', turnover_usd: '40000000', quotes: { best_bid: '2500.00', best_ask: '2500.50' } },
      { symbol: 'SOLUSD', contract_type: 'perpetual_futures', turnover_usd: '30000000', quotes: { best_bid: '150.00', best_ask: '150.05' } },
      { symbol: 'IMXUSD', contract_type: 'perpetual_futures', turnover_usd: '20000000', quotes: { best_bid: '1.500', best_ask: '1.501' } },
      { symbol: 'SOONUSD', contract_type: 'perpetual_futures', turnover_usd: '10000000', quotes: { best_bid: '0.500', best_ask: '0.501' } },
    ];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('/v2/products')) {
        return new Response(JSON.stringify({ success: true, result: mockProducts }), { status: 200 });
      }
      if (u.includes('/v2/tickers')) {
        return new Response(JSON.stringify({ success: true, result: mockTickers }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }) as any;

    const engine = new DeltaAutoTraderEngine(3099);
    (engine as any).engineStartTime = 0; // Bypass startup grace period
    DeltaAutoTraderEngine.isAt15mBoundaryWindow = () => true;
    (engine as any).fetchCandles = async (sym: string, tf: string) => {
      if (tf === '15m') scannedSymbols.push(sym);
      return []; // Short-circuit before order execution
    };

    await engine.runScanCycle();

    for (const banned of ['NVDAXUSD', 'SNDKBUSD', 'XAUTUSD', 'SILVERUSD', 'QQQXUSD', 'TSLAXUSD', 'EURUSD']) {
      assert.strictEqual(scannedSymbols.includes(banned), false, `Scanner must NEVER fetch/scan banned asset ${banned}`);
    }
    for (const expectedCrypto of ['BTCUSD', 'ETHUSD', 'SOLUSD', 'IMXUSD', 'SOONUSD']) {
      assert.strictEqual(scannedSymbols.includes(expectedCrypto), true, `Scanner MUST include pure crypto asset ${expectedCrypto}`);
    }
  });

});
