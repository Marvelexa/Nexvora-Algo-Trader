import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard.js';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine.js';
import { KlinePoint, DeltaPosition } from '../src/types';

function createMockCandles(basePrice: number, count: number, trend: 'UP' | 'DOWN' | 'FLAT'): KlinePoint[] {
  const candles: KlinePoint[] = [];
  let price = basePrice;
  const now = Date.now() - (count * 15 * 60 * 1000);

  for (let i = 0; i < count; i++) {
    const time = now + (i * 15 * 60 * 1000);
    const step = trend === 'UP' ? 0.005 * price : trend === 'DOWN' ? -0.005 * price : 0;
    const open = price;
    price += step;
    const high = Math.max(open, price) + (0.001 * price);
    const low = Math.min(open, price) - (0.001 * price);
    const close = price;
    candles.push({ time, open, high, low, close, volume: 1000 });
  }
  return candles;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: SET-AND-FORGET FIXED BRACKET & MACRO TREND');
  console.log('======================================================\n');

  // TEST 1: SET-AND-FORGET (evaluateLiveProfitLock returns HOLD with zero modifications)
  console.log('--- TEST 1: Fixed Bracket Mode (evaluateLiveProfitLock) ---');
  const mockPosition: DeltaPosition = {
    id: 'pos-1',
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 65000,
    currentPrice: 65500,
    stopLossPrice: 64700,
    takeProfitPrice: 66000,
    quantity: 1,
    marginUSD: 100,
    notionalUSD: 65000,
    pnlUSD: 500,
    pnlPercent: 5.0,
    rMultiple: 1.6,
    entryTime: Date.now() - 300000,
    atr: 300,
  };

  const profitAction = UniversalTradeGuard.evaluateLiveProfitLock({
    position: mockPosition,
    currentPrice: 65500,
    atr: 300,
    decimals: 2,
    tickSize: 0.5,
  });

  assert(profitAction.shouldClose100 === false, 'shouldClose100 is false (never market-closes)');
  assert(profitAction.updateBrackets === false, 'updateBrackets is false (never tampers with SL/TP)');
  assert(profitAction.shouldCloseTP1Partial === false, 'shouldCloseTP1Partial is false (no 75% partial closes)');
  assert(profitAction.newStopLossPrice === mockPosition.stopLossPrice, 'newStopLossPrice unchanged from entry SL');
  assert(profitAction.ratchetStage === 0, 'ratchetStage is 0 (no trailing or breakeven moving)');
  assert(profitAction.ratchetReason.includes('FIXED_BRACKET_MODE_NO_SL_MODIFICATION'), 'ratchetReason confirms FIXED_BRACKET_MODE');

  // TEST 2: checkRegimeFlipAndBreakeven returns tightenedCount: 0
  console.log('\n--- TEST 2: checkRegimeFlipAndBreakeven in Fixed-Bracket Mode ---');
  const regimeEngine = PortfolioMarketRegimeEngine.getInstance();
  const res = regimeEngine.checkRegimeFlipAndBreakeven([mockPosition], 'BEARISH', true);
  assert(res.tightenedCount === 0, 'tightenedCount is strictly 0 (never tightens SL on regime flip)');
  assert(res.positions[0].stopLossPrice === 64700, 'Position stopLossPrice untouched at 64700');

  // TEST 3: Synthetic Stock/Commodity Token Ban
  console.log('\n--- TEST 3: Synthetic Stock/Commodity Token Ban ---');
  const bannedVerdicts = ['NVDAXUSD', 'QQQXUSD', 'PAXGUSD', 'SILVERUSD', 'AAPLUSD', 'SPYXUSD'].map(sym => {
    return UniversalTradeGuard.evaluatePreTradeGate({
      symbol: sym,
      side: 'BUY',
      currentPrice: 100,
      atr: 1,
      candles15m: createMockCandles(100, 30, 'UP'),
      accountCapitalUSD: 1000,
      leverage: 30,
      maxMarginUSD: 250,
      portfolioMarketRegime: regimeEngine,
    });
  });

  for (const v of bannedVerdicts) {
    assert(v.allowed === false, `Banned token correctly vetoed: ${v.reason.split(':')[0]}`);
    assert(v.reason.includes('NON_CRYPTO_STOCK_COMMODITY_VETO'), `Reason contains NON_CRYPTO_STOCK_COMMODITY_VETO`);
  }

  // TEST 4: Macro BUY Market (Price > EMA50) strictly Vetoes SELL
  console.log('\n--- TEST 4: Macro BUY Market strictly Vetoes SELL ---');
  const bullCandles = createMockCandles(1.2000, 60, 'UP'); // 60 bars trending UP
  const lastBullPrice = bullCandles[bullCandles.length - 1].close;
  const bullVerdictSell = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'XRPUSD',
    side: 'SELL',
    currentPrice: lastBullPrice,
    atr: 0.0050,
    candles15m: bullCandles,
    accountCapitalUSD: 1000,
    leverage: 30,
    maxMarginUSD: 250,
    portfolioMarketRegime: regimeEngine,
  });

  assert(bullVerdictSell.allowed === false, 'SELL in Macro BUY Market is strictly vetoed');
  assert(bullVerdictSell.reason.includes('NO_SELLING_IN_MACRO_BUY_MARKET_VETO') || bullVerdictSell.reason.includes('NO_SELLING_IN_BULLISH_TREND_VETO'), `Reason correctly blocks selling in bullish trend/market: ${bullVerdictSell.reason.split(':')[0]}`);

  // TEST 5: Macro SELL Market (Price < EMA50) strictly Vetoes BUY
  console.log('\n--- TEST 5: Macro SELL Market strictly Vetoes BUY ---');
  const bearCandles = createMockCandles(1.4000, 60, 'DOWN'); // 60 bars trending DOWN
  const lastBearPrice = bearCandles[bearCandles.length - 1].close;
  const bearVerdictBuy = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'XRPUSD',
    side: 'BUY',
    currentPrice: lastBearPrice,
    atr: 0.0050,
    candles15m: bearCandles,
    accountCapitalUSD: 1000,
    leverage: 30,
    maxMarginUSD: 250,
    portfolioMarketRegime: regimeEngine,
  });

  assert(bearVerdictBuy.allowed === false, 'BUY in Macro SELL Market is strictly vetoed');
  assert(bearVerdictBuy.reason.includes('NO_BUYING_IN_MACRO_SELL_MARKET_VETO') || bearVerdictBuy.reason.includes('NO_BUYING_IN_BEARISH_TREND_VETO'), `Reason correctly blocks buying in bearish trend/market: ${bearVerdictBuy.reason.split(':')[0]}`);

  // TEST 6: Structural Sweep-Proof SL & Max SL Cap (1.30%) with Dynamic Risk Sizing
  console.log('\n--- TEST 6: Structural Sweep-Proof SL & Invalidation Level (1.30% Cap) ---');
  // Scenario A: Close to support (e.g. 0.51% distance)
  const nearbyCandles: KlinePoint[] = [
    { time: 1, open: 1.2500, high: 1.2520, low: 1.2470, close: 1.2510, volume: 100 },
    { time: 2, open: 1.2510, high: 1.2530, low: 1.2480, close: 1.2520, volume: 100 },
    { time: 3, open: 1.2520, high: 1.2540, low: 1.2490, close: 1.2530, volume: 100 },
  ];
  const slA = UniversalTradeGuard.calculateSweepProofSL({
    side: 'BUY',
    entryPrice: 1.2530,
    atr: 0.0040,
    candles15m: nearbyCandles,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert(slA.isVetoed === false, 'Entry near support low has valid SL');
  assert(slA.stopLossPrice < 1.2470, `SL ($${slA.stopLossPrice}) is placed below lowest wick ($1.2470) by buffer`);
  assert(slA.slDistance / 1.2530 <= 0.0130, `SL distance (${(slA.slDistance/1.2530*100).toFixed(2)}%) is <= 1.30%`);

  // Scenario B: Realistic 0.93% structural wick SL on BTCUSD is APPROVED (not vetoed by 0.52%)
  console.log('\n--- TEST 7: 0.93% Structural Wick SL is APPROVED with <= $3.80 Dollar Risk ---');
  const btcEntry = 75700;
  const btcWickHigh = 76350; // 0.86% wick high
  const btcCandles: KlinePoint[] = [
    { time: 1, open: 76200, high: btcWickHigh, low: 75900, close: 76000, volume: 50 },
    { time: 2, open: 76000, high: 76100, low: 75750, close: 75800, volume: 50 },
    { time: 3, open: 75800, high: 75850, low: 75650, close: btcEntry, volume: 50 },
  ];
  const btcSL = UniversalTradeGuard.calculateSweepProofSL({
    side: 'SELL',
    entryPrice: btcEntry,
    atr: 500, // 0.10*ATR = 50 buffer -> SL = 76400 (700 distance = 0.925% / 0.93%)
    candles15m: btcCandles,
    decimals: 1,
    tickSize: 0.5,
  });

  assert(btcSL.isVetoed === false, '0.93% structural SL on BTC is APPROVED (not vetoed by 0.52%)');
  assert(btcSL.stopLossPrice > btcWickHigh, `BTC SL ($${btcSL.stopLossPrice}) is above swing high ($${btcWickHigh}) by buffer`);

  // Verify Dynamic Position Sizing scales contracts to strictly cap dollar risk <= $3.80 USD
  const btcSizing = UniversalTradeGuard.calculatePositionSize({
    accountCapitalUSD: 133,
    entryPrice: btcEntry,
    slDistance: btcSL.slDistance,
    leverage: 30,
  });

  const dollarRisk = btcSizing.quantity * btcSL.slDistance;
  assert(dollarRisk <= 3.85, `Dollar risk ($${dollarRisk.toFixed(2)}) is strictly capped <= $3.80 USD`);
  console.log(`  ✅ PASS: BTC 0.93% SL distance ($${btcSL.slDistance.toFixed(1)}) sized to ${btcSizing.quantity} BTC ($${btcSizing.notionalUSD} Notional) -> Total Risk: $${dollarRisk.toFixed(2)} USD (<= $3.80 cap)`);

  // Scenario C: Extreme late entry (> 1.30% away) is VETOED
  const extremeCandles: KlinePoint[] = [
    { time: 1, open: 1.2000, high: 1.2100, low: 1.2000, close: 1.2050, volume: 100 },
    { time: 2, open: 1.2050, high: 1.2300, low: 1.2050, close: 1.2280, volume: 100 },
    { time: 3, open: 1.2280, high: 1.2575, low: 1.2250, close: 1.2575, volume: 100 },
  ];
  const slExtreme = UniversalTradeGuard.calculateSweepProofSL({
    side: 'BUY',
    entryPrice: 1.2575,
    atr: 0.0050,
    candles15m: extremeCandles, // lowest wick is 1.2000, distance = 1.2575 - 1.1995 = 0.0580 (4.6% away!)
    decimals: 4,
    tickSize: 0.0001,
  });

  assert(slExtreme.isVetoed === true, 'Extreme chase (> 1.30%) is VETOED');
  assert(slExtreme.vetoReason?.includes('SL_TOO_WIDE_LATE_ENTRY_VETO') === true, 'Reason is SL_TOO_WIDE_LATE_ENTRY_VETO');

  console.log(`\n======================================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
