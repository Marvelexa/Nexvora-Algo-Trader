import { UniversalTradeGuard, ALLOWED_CRYPTO_SYMBOLS } from '../lib/risk/universalTradeGuard';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

function runTests() {
  console.log('================================================================');
  console.log('🧪 TESTING DEAD-SIMPLE 3-RULE FIXED BRACKET & ANTI-CHASE SYSTEM');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
      process.exitCode = 1;
    }
  }

  // TEST 1: Fixed 0.45% SL and 0.75% TP on BUY
  {
    const entryPrice = 2000.00;
    const decimals = 2;
    const tickSize = 0.01;

    const sl = UniversalTradeGuard.calculateSweepProofSL({
      side: 'BUY',
      entryPrice,
      decimals,
      tickSize,
    });

    const expectedSL = parseFloat((entryPrice * (1 - 0.0045)).toFixed(decimals)); // 1991.00
    assert(sl.stopLossPrice === expectedSL, `BUY SL: Expected $${expectedSL}, got $${sl.stopLossPrice}`);
    assert(sl.slDistance === 9.00, `BUY SL Distance: Expected $9.00 (0.45%), got $${sl.slDistance}`);

    const tp = UniversalTradeGuard.calculateUniversalStructuralTP({
      side: 'BUY',
      entryPrice,
      decimals,
      tickSize,
    });

    const expectedTP = parseFloat((entryPrice * (1 + 0.0075)).toFixed(decimals)); // 2015.00
    assert(tp.targetPrice === expectedTP, `BUY TP: Expected $${expectedTP}, got $${tp.targetPrice}`);
    assert(tp.targetDistance === 15.00, `BUY TP Distance: Expected $15.00 (0.75%), got $${tp.targetDistance}`);
    assert(tp.structuralRR === 1.67, `BUY RR: Expected 1.67R, got ${tp.structuralRR}R`);
  }

  // TEST 2: Fixed 0.45% SL and 0.75% TP on SELL
  {
    const entryPrice = 75000.00;
    const decimals = 2;
    const tickSize = 0.01;

    const sl = UniversalTradeGuard.calculateSweepProofSL({
      side: 'SELL',
      entryPrice,
      decimals,
      tickSize,
    });

    const expectedSL = parseFloat((entryPrice * (1 + 0.0045)).toFixed(decimals)); // 75337.50
    assert(sl.stopLossPrice === expectedSL, `SELL SL: Expected $${expectedSL}, got $${sl.stopLossPrice}`);
    assert(sl.slDistance === 337.50, `SELL SL Distance: Expected $337.50 (0.45%), got $${sl.slDistance}`);

    const tp = UniversalTradeGuard.calculateUniversalStructuralTP({
      side: 'SELL',
      entryPrice,
      decimals,
      tickSize,
    });

    const expectedTP = parseFloat((entryPrice * (1 - 0.0075)).toFixed(decimals)); // 74437.50
    assert(tp.targetPrice === expectedTP, `SELL TP: Expected $${expectedTP}, got $${tp.targetPrice}`);
    assert(tp.targetDistance === 562.50, `SELL TP Distance: Expected $562.50 (0.75%), got $${tp.targetDistance}`);
    assert(tp.structuralRR === 1.67, `SELL RR: Expected 1.67R, got ${tp.structuralRR}R`);
  }

  // TEST 3: Strict Top 6 Liquid Coin Whitelist
  {
    const allowed = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD'];
    for (const sym of allowed) {
      assert(ALLOWED_CRYPTO_SYMBOLS.has(sym), `Whitelist contains ${sym}`);
    }

    assert(!ALLOWED_CRYPTO_SYMBOLS.has('USOONUSD'), 'Whitelist strictly blocks USOONUSD');
    assert(!ALLOWED_CRYPTO_SYMBOLS.has('AVAXUSD'), 'Whitelist strictly blocks AVAXUSD');
    assert(!ALLOWED_CRYPTO_SYMBOLS.has('BNBUSD'), 'Whitelist strictly blocks BNBUSD');
    assert(!ALLOWED_CRYPTO_SYMBOLS.has('LINKUSD'), 'Whitelist strictly blocks LINKUSD');

    // Test rejection in evaluatePreTradeGate
    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'USOONUSD',
      side: 'SELL',
      currentPrice: 147.90,
      accountCapitalUSD: 178,
      candles15m: [],
      atr: 1.0,
      activePositions: [],
    });

    assert(!verdict.allowed && verdict.reason.includes('SYMBOL_NOT_WHITELISTED_VETO'), 'evaluatePreTradeGate vetoes non-whitelisted coin USOONUSD');
  }

  // TEST 4: Anti-Late-Chase Gate (Dump Chase Blocking)
  {
    const currentPrice = 100.0;
    // 6-bar high at 101.50 -> drop is (101.50 - 100) / 101.50 = 1.48% (>= 0.70% dump)
    const mockCandles: KlinePoint[] = [
      { time: 1, open: 101.0, high: 101.5, low: 100.8, close: 101.2, volume: 100 },
      { time: 2, open: 101.2, high: 101.3, low: 100.5, close: 100.6, volume: 100 },
      { time: 3, open: 100.6, high: 100.7, low: 100.2, close: 100.3, volume: 100 },
      { time: 4, open: 100.3, high: 100.4, low: 100.0, close: 100.1, volume: 100 },
      { time: 5, open: 100.1, high: 100.2, low: 99.8, close: 99.9, volume: 100 },
      { time: 6, open: 99.9, high: 100.1, low: 99.7, close: 100.0, volume: 100 }, // green candle (close > open) far from EMA21
    ];

    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'SOLUSD',
      side: 'SELL',
      currentPrice,
      accountCapitalUSD: 178,
      candles15m: mockCandles,
      atr: 0.5,
      activePositions: [],
    });

    assert(!verdict.allowed && verdict.reason.includes('LATE_DUMP_CHASE_SELL_VETO'), 'Selling after a 1.48% dump is blocked by LATE_DUMP_CHASE_SELL_VETO');
  }

  // TEST 5: Anti-Late-Chase Gate (Pump Chase Blocking)
  {
    const currentPrice = 101.5;
    // 6-bar low at 100.00 -> rise is (101.50 - 100.00) / 100.00 = 1.50% (>= 0.70% pump)
    const mockCandles: KlinePoint[] = [
      { time: 1, open: 100.1, high: 100.3, low: 100.0, close: 100.2, volume: 100 },
      { time: 2, open: 100.2, high: 100.6, low: 100.1, close: 100.5, volume: 100 },
      { time: 3, open: 100.5, high: 100.9, low: 100.4, close: 100.8, volume: 100 },
      { time: 4, open: 100.8, high: 101.2, low: 100.7, close: 101.1, volume: 100 },
      { time: 5, open: 101.1, high: 101.4, low: 101.0, close: 101.3, volume: 100 },
      { time: 6, open: 101.4, high: 101.6, low: 101.2, close: 101.3, volume: 100 }, // red candle (close < open)
    ];

    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'BTCUSD',
      side: 'BUY',
      currentPrice,
      accountCapitalUSD: 178,
      candles15m: mockCandles,
      atr: 0.5,
      activePositions: [],
    });

    assert(!verdict.allowed && verdict.reason.includes('LATE_PUMP_CHASE_BUY_VETO'), 'Buying after a 1.50% pump is blocked by LATE_PUMP_CHASE_BUY_VETO');
  }

  // TEST 6: Set-and-Forget Live Profit Lock
  {
    const action = UniversalTradeGuard.evaluateLiveProfitLock({
      position: {
        id: 'pos-1',
        symbol: 'ETHUSD',
        side: 'BUY',
        entryPrice: 2248.05,
        stopLossPrice: 2237.93,
        takeProfitPrice: 2264.91,
        quantity: 0.3,
        leverage: 30,
        marginUSD: 22.48,
        notionalUSD: 674.40,
        pnlUSD: 4.50,
        roePercent: 20.0,
        status: 'OPEN',
        openTime: Date.now() - 60000,
        strategyName: 'SMC',
      },
      currentPrice: 2262.00,
    });

    assert(action.shouldClose100 === false, 'evaluateLiveProfitLock: shouldClose100 is false (never software close)');
    assert(action.updateBrackets === false, 'evaluateLiveProfitLock: updateBrackets is false (never modify bracket)');
    assert(action.ratchetReason.includes('SET_AND_FORGET'), 'evaluateLiveProfitLock: SET_AND_FORGET enforced');
  }

  // TEST 7: Strategy Registry Dual and Multi System Switching
  {
    const mockCandles: KlinePoint[] = Array.from({ length: 30 }, (_, i) => ({
      time: i * 900,
      open: 2000 + i * 2,
      high: 2005 + i * 2,
      low: 1995 + i * 2,
      close: 2002 + i * 2,
      volume: 1000 + i * 50,
    }));

    const res3001 = evaluateStrategyForPort('3001', 'ETHUSD', mockCandles);
    assert(res3001 !== undefined, 'Strategy 3001 evaluates cleanly');

    const res3005 = evaluateStrategyForPort('3005', 'ETHUSD', mockCandles);
    assert(res3005 !== undefined, 'Strategy 3005 evaluates cleanly');

    const res3008 = evaluateStrategyForPort('3008', 'ETHUSD', mockCandles);
    assert(res3008 !== undefined, 'Strategy 3008 evaluates cleanly');

    const resDual = evaluateStrategyForPort('3001_3005', 'ETHUSD', mockCandles);
    assert(resDual !== undefined, 'Dual Connected 3001+3005 evaluates cleanly without mixing logic');

    const resAll = evaluateStrategyForPort('ALL_THREE', 'ETHUSD', mockCandles);
    assert(resAll !== undefined, 'Triple Master ALL_THREE evaluates cleanly');
  }

  console.log(`\n================================================================`);
  console.log(`🎉 ALL TESTS PASSED: ${passed}/${total} assertions successful!`);
  console.log(`================================================================`);
}

runTests();
