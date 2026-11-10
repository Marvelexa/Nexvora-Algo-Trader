import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { CryptoDedicatedStrategyEngine, strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { WhiteboardCryptoDeFiEngine } from '../lib/strategies/whiteboardCryptoDeFiEngine';
import { SidhantWorldChampionEngine } from '../lib/strategies/sidhantWorldChampionEngine';
import { MarketTrapsAndChopEngine } from '../lib/marketTrapsAndChopEngine';
import { strategyRegistry } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../lib/quantMathematicalEngine';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function assert(suite: string, name: string, condition: boolean, details: string) {
  results.push({ suite, name, passed: condition, details });
  if (condition) {
    console.log(`  ✅ [PASS] ${suite} -> ${name}`);
  } else {
    console.error(`  ❌ [FAIL] ${suite} -> ${name}: ${details}`);
  }
}

// Helper: Generate synthetic trend candles
function generateTrendCandles(options: {
  length: number;
  basePrice: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  slope: number;
  volatility: number;
  finalBarPattern?: 'SHOOTING_STAR' | 'HAMMER' | 'ENGULFING_BEAR' | 'ENGULFING_BULL' | 'UPPER_BB_PIERCE';
  finalVolumeMultiplier?: number;
}): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  let price = options.basePrice;

  for (let i = 0; i < options.length; i++) {
    const isLast = i === options.length - 1;
    let step = 0;
    if (options.trend === 'UP') step = options.slope * (1 + 0.1 * Math.sin(i / 5));
    else if (options.trend === 'DOWN') step = -options.slope * (1 + 0.1 * Math.sin(i / 5));
    else step = options.volatility * (Math.sin(i / 3) * 0.5);

    price += step;
    const vol = (10000 + i * 50) * (isLast && options.finalVolumeMultiplier ? options.finalVolumeMultiplier : 1);
    const range = options.volatility;

    let open = price;
    let close = price + (options.trend === 'UP' ? range * 0.4 : (options.trend === 'DOWN' ? -range * 0.4 : 0));
    let high = Math.max(open, close) + range * 0.3;
    let low = Math.min(open, close) - range * 0.3;

    if (isLast && options.finalBarPattern) {
      if (options.finalBarPattern === 'SHOOTING_STAR') {
        open = price;
        close = price - range * 0.3;
        high = price + range * 1.8; // Long upper wick
        low = close - range * 0.1;
      } else if (options.finalBarPattern === 'HAMMER') {
        open = price;
        close = price + range * 0.3;
        high = close + range * 0.1;
        low = price - range * 1.8; // Long lower wick
      } else if (options.finalBarPattern === 'ENGULFING_BEAR') {
        open = price + range * 0.5;
        close = price - range * 1.0;
        high = open + range * 0.2;
        low = close - range * 0.2;
      } else if (options.finalBarPattern === 'ENGULFING_BULL') {
        open = price - range * 0.5;
        close = price + range * 1.0;
        high = close + range * 0.2;
        low = open - range * 0.2;
      } else if (options.finalBarPattern === 'UPPER_BB_PIERCE') {
        open = price + range * 0.2;
        close = price + range * 0.1; // Closes below high
        high = price + range * 2.5; // Massive pierce
        low = price - range * 0.1;
      }
    }

    candles.push({
      time: now - (options.length - i) * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume: vol,
    });
  }
  return candles;
}

async function runAdversarialTests() {
  console.log('===============================================================');
  console.log('   STARTING EMPIRICAL ADVERSARIAL STRESS TEST SUITE (M1)       ');
  console.log('===============================================================\n');

  // -------------------------------------------------------------------------
  // SUITE 1: CONFLUENCE GUARD ADVERSARIAL STRESS (deltaAutoTraderEngine)
  // -------------------------------------------------------------------------
  console.log('--- SUITE 1: Confluence Guard Adversarial Stress Testing ---');

  // Test 1.1: Strong Bullish Uptrend + Severe Bearish Candlestick Pattern (Shooting Star + High Vol)
  // Can a deceptive candlestick pattern trick deltaAutoTrader into a SELL?
  const bullCandlesShootingStar = generateTrendCandles({
    length: 120,
    basePrice: 100,
    trend: 'UP',
    slope: 0.25,
    volatility: 0.5,
    finalBarPattern: 'SHOOTING_STAR',
    finalVolumeMultiplier: 4.5,
  });
  const conf1 = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(bullCandlesShootingStar);
  const res1 = await deltaAutoTrader.evaluateMultiTimeframeStrategies('SOLUSDT', 'SOLUSD', bullCandlesShootingStar, { trend1h: 'BULLISH' });

  assert(
    'Suite 1: Confluence Guard',
    'Reject SELL during Bullish Confluence with Shooting Star',
    res1?.side !== 'SELL',
    `Evaluation returned: ${res1?.side || 'BLOCKED/NULL'} (Trend: ${conf1.trendDirection}, allowsShort: ${conf1.allowsShort})`
  );

  // Test 1.2: Strong Bullish Uptrend + Massive Bearish Engulfing Red Bar
  const bullCandlesEngulf = generateTrendCandles({
    length: 120,
    basePrice: 50,
    trend: 'UP',
    slope: 0.2,
    volatility: 0.4,
    finalBarPattern: 'ENGULFING_BEAR',
    finalVolumeMultiplier: 3.0,
  });
  const conf2 = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(bullCandlesEngulf);
  const res2 = await deltaAutoTrader.evaluateMultiTimeframeStrategies('AVAXUSDT', 'AVAXUSD', bullCandlesEngulf, { trend1h: 'BULLISH' });

  assert(
    'Suite 1: Confluence Guard',
    'Reject SELL during Bullish Confluence with Bearish Engulfing Red Bar',
    res2?.side !== 'SELL',
    `Evaluation returned: ${res2?.side || 'BLOCKED/NULL'} (Trend: ${conf2.trendDirection}, allowsShort: ${conf2.allowsShort})`
  );

  // Test 1.3: Symmetrical Protection: Strong Bearish Downtrend + Massive Hammer / Bull Engulfing
  const bearCandlesHammer = generateTrendCandles({
    length: 120,
    basePrice: 150,
    trend: 'DOWN',
    slope: 0.3,
    volatility: 0.5,
    finalBarPattern: 'HAMMER',
    finalVolumeMultiplier: 4.0,
  });
  const conf3 = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(bearCandlesHammer);
  const res3 = await deltaAutoTrader.evaluateMultiTimeframeStrategies('ETHUSDT', 'ETHUSD', bearCandlesHammer, { trend1h: 'BEARISH' });

  assert(
    'Suite 1: Confluence Guard',
    'Reject BUY during Bearish Confluence with Bullish Hammer',
    res3?.side !== 'BUY',
    `Evaluation returned: ${res3?.side || 'BLOCKED/NULL'} (Trend: ${conf3.trendDirection}, allowsLong: ${conf3.allowsLong})`
  );

  // Test 1.4: Multi-Coin Sweep across all 6 core assets during Bull Run
  const symbols = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD'];
  let allBlockedSellInBull = true;
  for (const sym of symbols) {
    const candles = generateTrendCandles({
      length: 100,
      basePrice: sym.startsWith('BTC') ? 60000 : (sym.startsWith('ETH') ? 3000 : (sym.startsWith('DOGE') ? 0.08 : 20)),
      trend: 'UP',
      slope: sym.startsWith('BTC') ? 50 : (sym.startsWith('ETH') ? 5 : 0.05),
      volatility: sym.startsWith('BTC') ? 100 : (sym.startsWith('ETH') ? 10 : 0.1),
      finalBarPattern: 'SHOOTING_STAR',
      finalVolumeMultiplier: 3.0,
    });
    const cRes = await deltaAutoTrader.evaluateMultiTimeframeStrategies(sym.replace('USD', 'USDT'), sym, candles, { trend1h: 'BULLISH' });
    if (cRes?.side === 'SELL') {
      allBlockedSellInBull = false;
      console.error(`    Coin ${sym} leaked a SELL during Bull trend!`);
    }
  }
  assert(
    'Suite 1: Confluence Guard',
    'Multi-Coin Sweep (BTC, ETH, SOL, DOGE, AVAX, SUI) Zero SELL Leakage in Bull Run',
    allBlockedSellInBull,
    'Verified 6 core symbols under deceptive overbought conditions'
  );

  // -------------------------------------------------------------------------
  // SUITE 2: WHITEBOARD UPPER BB ADVERSARIAL STRESS (whiteboardCryptoDeFiEngine)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Whiteboard Crypto DeFi Upper BB Stress Testing ---');
  const whiteboard = new WhiteboardCryptoDeFiEngine();

  // Test 2.1: Upper BB Touch during EMA 50 Bull Expansion (emaSlope > 0.0015, price > ema50)
  // Should strictly NOT trigger a SELL
  const bullExpansionCandles = generateTrendCandles({
    length: 60,
    basePrice: 100,
    trend: 'UP',
    slope: 0.4, // Steep slope to ensure emaSlope > 0.0015
    volatility: 0.6,
    finalBarPattern: 'UPPER_BB_PIERCE',
    finalVolumeMultiplier: 2.5,
  });
  const wbRes1 = whiteboard.evaluateSetup('SOLUSD', bullExpansionCandles);

  assert(
    'Suite 2: Whiteboard DeFi',
    'Block Upper BB snapback short during EMA 50 Bull Expansion',
    wbRes1.recommendedSide !== 'SELL',
    `Whiteboard result: side=${wbRes1.recommendedSide}, setupType=${wbRes1.setupType}`
  );

  // Test 2.2: Boundary Slope Test: What if slope is below threshold (0.0010, flat/choppy market)?
  // In a flat range, Upper BB touch with rejection wick >= 35% SHOULD be permitted as a mean-reversion snapback
  const flatRangeCandles = generateTrendCandles({
    length: 60,
    basePrice: 100,
    trend: 'SIDEWAYS',
    slope: 0.0,
    volatility: 1.0,
    finalBarPattern: 'SHOOTING_STAR',
    finalVolumeMultiplier: 2.0,
  });
  // Adjust last candle to ensure it pierces Upper BB and rejects with >35% wick
  const closesFlat = flatRangeCandles.map(c => c.close);
  const meanFlat = closesFlat.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const varianceFlat = closesFlat.slice(-20).reduce((a, b) => a + Math.pow(b - meanFlat, 2), 0) / 20;
  const stdDevFlat = Math.sqrt(varianceFlat);
  const upperBBFlat = meanFlat + stdDevFlat * 2.2;
  const lastBarFlat = flatRangeCandles[flatRangeCandles.length - 1];
  lastBarFlat.high = upperBBFlat + 0.5;
  lastBarFlat.open = upperBBFlat - 0.2;
  lastBarFlat.close = upperBBFlat - 0.5; // Closes lower than open and below BB
  lastBarFlat.low = upperBBFlat - 0.6;
  // cRange = 1.1, upperWick = high - open = 0.7 (63% wick!)
  const wbResFlat = whiteboard.evaluateSetup('SOLUSD', flatRangeCandles);
  // In a flat market, mean reversion may trigger if RR >= 2.3, or return null if RR < 2.3, but must not throw or crash
  assert(
    'Suite 2: Whiteboard DeFi',
    'Flat range snapback evaluation executes cleanly without crash',
    wbResFlat !== undefined,
    `Result: side=${wbResFlat.recommendedSide}, RR=${wbResFlat.reasons?.join(' | ') || 'none'}`
  );

  // Test 2.3: Lower BB Touch during Bear Dump (emaSlope < -0.0015, price < ema50)
  // Should strictly NOT trigger a BUY
  const bearDumpCandles = generateTrendCandles({
    length: 60,
    basePrice: 150,
    trend: 'DOWN',
    slope: 0.5,
    volatility: 0.7,
    finalBarPattern: 'HAMMER',
    finalVolumeMultiplier: 3.0,
  });
  const wbResBear = whiteboard.evaluateSetup('SOLUSD', bearDumpCandles);

  assert(
    'Suite 2: Whiteboard DeFi',
    'Block Lower BB snapback long during Bear Dump',
    wbResBear.recommendedSide !== 'BUY',
    `Whiteboard result: side=${wbResBear.recommendedSide}, setupType=${wbResBear.setupType}`
  );

  // -------------------------------------------------------------------------
  // SUITE 3: BOOLEAN TAUTOLOGY & FALLBACK STRESS (cryptoDedicatedStrategyEngine)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 3: Boolean Tautologies & Fallback Stress Testing ---');

  // Test 3.1: AVAX Sniper fastRsi spectrum sweep
  // Verify that when rawBuySignal is false, it NEVER triggers SELL unless a genuine bear signal is present!
  // In the past, (fastRsi <= 60 || fastRsi >= 40) was always true, and (!rawBuySignal) forced a SELL!
  const avaxUptrendCandles = generateTrendCandles({
    length: 80,
    basePrice: 30,
    trend: 'UP',
    slope: 0.15,
    volatility: 0.2,
  });
  const avaxResUptrend = strategyEngine.evaluateAvaxQuantumBandSniper(avaxUptrendCandles);
  assert(
    'Suite 3: Tautologies & Fallbacks',
    'AVAX Sniper in Uptrend does NOT default to SELL when BUY is missing',
    avaxResUptrend.signal !== 'SELL',
    `AVAX signal: ${avaxResUptrend.signal || 'NULL'} (reason: ${avaxResUptrend.reason})`
  );

  // Test 3.2: SUI Sniper fastRsi spectrum sweep
  const suiUptrendCandles = generateTrendCandles({
    length: 80,
    basePrice: 1.5,
    trend: 'UP',
    slope: 0.01,
    volatility: 0.02,
  });
  const suiResUptrend = strategyEngine.evaluateSuiQuantumBandSniper(suiUptrendCandles);
  assert(
    'Suite 3: Tautologies & Fallbacks',
    'SUI Sniper in Uptrend does NOT default to SELL when BUY is missing',
    suiResUptrend.signal !== 'SELL',
    `SUI signal: ${suiResUptrend.signal || 'NULL'} (reason: ${suiResUptrend.reason})`
  );

  // Test 3.3: SOL Sniper trendUp check
  // In an active trendUp, canSell must be strictly false!
  const solUptrendCandles = generateTrendCandles({
    length: 120,
    basePrice: 120,
    trend: 'UP',
    slope: 0.4,
    volatility: 0.5,
    finalBarPattern: 'ENGULFING_BEAR', // Try to bait a sell with a red engulfing bar
  });
  const solResUptrend = strategyEngine.evaluateSolQuantumMomentumSniper(solUptrendCandles);
  assert(
    'Suite 3: Tautologies & Fallbacks',
    'SOL Sniper in Uptrend strictly BLOCKS SELL even on red engulfing bar',
    solResUptrend.signal !== 'SELL',
    `SOL signal: ${solResUptrend.signal || 'NULL'} (reason: ${solResUptrend.reason})`
  );

  // Test 3.4: Symmetrical SOL Sniper trendDown check
  // In an active trendDown, canBuy must be strictly false!
  const solDowntrendCandles = generateTrendCandles({
    length: 120,
    basePrice: 180,
    trend: 'DOWN',
    slope: 0.4,
    volatility: 0.5,
    finalBarPattern: 'ENGULFING_BULL', // Try to bait a buy with a green engulfing bar
  });
  const solResDowntrend = strategyEngine.evaluateSolQuantumMomentumSniper(solDowntrendCandles);
  assert(
    'Suite 3: Tautologies & Fallbacks',
    'SOL Sniper in Downtrend strictly BLOCKS BUY even on green engulfing bar',
    solResDowntrend.signal !== 'BUY',
    `SOL signal: ${solResDowntrend.signal || 'NULL'} (reason: ${solResDowntrend.reason})`
  );

  // Test 3.5: AVAX & SUI fastRsi dynamic indexing verification
  // Feed 40 consecutive green pump bars.
  // In pure upward momentum, 5-period RSI is mathematically 100.
  // AVAX correctly reads rsiList[rsiList.length - 1] = 100.
  // If SUI reads rsiArr[len - 1] (out of bounds index), it falls back to default 50.
  const pumpCandles40: KlinePoint[] = [];
  for (let i = 0; i < 40; i++) {
    pumpCandles40.push({
      time: Date.now() - (40 - i) * 15 * 60 * 1000,
      open: 10 + i * 0.2,
      high: 10 + i * 0.2 + 0.15,
      low: 10 + i * 0.2 - 0.05,
      close: 10 + i * 0.2 + 0.1,
      volume: 5000,
    });
  }
  const avaxPumpRes = strategyEngine.evaluateAvaxQuantumBandSniper(pumpCandles40);
  const suiPumpRes = strategyEngine.evaluateSuiQuantumBandSniper(pumpCandles40);

  assert(
    'Suite 3: Tautologies & Fallbacks',
    'AVAX Sniper fastRsi accurately computes dynamic RSI on pump (> 90)',
    avaxPumpRes.fastRsi > 90,
    `AVAX fastRsi: ${avaxPumpRes.fastRsi}`
  );

  assert(
    'Suite 3: Tautologies & Fallbacks',
    'SUI Sniper fastRsi accurately computes dynamic RSI on pump (> 90) (Detects rsiArr[len-1] bug)',
    suiPumpRes.fastRsi > 90,
    `SUI fastRsi: ${suiPumpRes.fastRsi} (Stuck at default 50 due to off-by-one indexing rsiArr[len-1] vs rsiArr[rsiArr.length-1])`
  );

  // Test 3.6: AVAX Sniper in neutral uptrend without bear cross never defaults to SELL
  let avaxNoFalseSell = true;
  for (const step of [0.05, 0.1, 0.15, 0.2, 0.25]) {
    const sweepCandles = generateTrendCandles({
      length: 80,
      basePrice: 50,
      trend: 'UP',
      slope: step,
      volatility: 0.2,
    });
    const aRes = strategyEngine.evaluateAvaxQuantumBandSniper(sweepCandles);
    if (aRes.signal === 'SELL') {
      avaxNoFalseSell = false;
    }
  }
  assert(
    'Suite 3: Tautologies & Fallbacks',
    'AVAX Sniper in clean uptrend never produces false SELL',
    avaxNoFalseSell,
    'Verified across varying slope gradients'
  );

  // -------------------------------------------------------------------------
  // SUITE 4: SIDHANT GOLDEN POCKET STRUCTURE STRESS (sidhantWorldChampionEngine)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 4: Sidhant Golden Pocket Structure Filter Testing ---');
  const sidhant = new SidhantWorldChampionEngine();

  // Test 4.1: Bull Trend continuation impulse must NEVER trigger Bearish Golden Pocket Reversal
  const sidhantBullCandles = generateTrendCandles({
    length: 80,
    basePrice: 60000,
    trend: 'UP',
    slope: 80,
    volatility: 120,
    finalBarPattern: 'SHOOTING_STAR',
  });
  const sidhantResBull = sidhant.evaluateSetup('BTCUSD', sidhantBullCandles);
  assert(
    'Suite 4: Sidhant Golden Pocket',
    'Reject Bearish Golden Pocket Reversal during Bull Trend (isBullTrend=true)',
    sidhantResBull.recommendedSide !== 'SELL',
    `Sidhant result: side=${sidhantResBull.recommendedSide || 'NULL'}, setup=${sidhantResBull.setupType}`
  );

  // Test 4.2: Symmetrical Bear Trend continuation dump must NEVER trigger Bullish Golden Pocket Reversal
  const sidhantBearCandles = generateTrendCandles({
    length: 80,
    basePrice: 70000,
    trend: 'DOWN',
    slope: 80,
    volatility: 120,
    finalBarPattern: 'HAMMER',
  });
  const sidhantResBear = sidhant.evaluateSetup('BTCUSD', sidhantBearCandles);
  assert(
    'Suite 4: Sidhant Golden Pocket',
    'Reject Bullish Golden Pocket Reversal during Bear Trend (isBearTrend=true)',
    sidhantResBear.recommendedSide !== 'BUY',
    `Sidhant result: side=${sidhantResBear.recommendedSide || 'NULL'}, setup=${sidhantResBear.setupType}`
  );

  // -------------------------------------------------------------------------
  // SUITE 5: MARKET TRAPS PARITY (Trap 7 Parity in marketTrapsAndChopEngine)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 5: Market Traps Trap 7 Parity Testing ---');
  const dummyCandles: KlinePoint[] = [
    { time: Date.now() - 30000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
    { time: Date.now() - 15000, open: 100, high: 102, low: 99, close: 101, volume: 1000 }
  ];

  const trapBuyInDown = MarketTrapsAndChopEngine.evaluateMarketTraps({
    symbol: 'BTCUSD',
    side: 'BUY',
    marketStructure: 'DOWNTREND',
    setupType: 'REGULAR_BUY',
    candles: dummyCandles,
  });
  assert(
    'Suite 5: Trap 7 Parity',
    'Counter-trend BUY in DOWNTREND is blocked by Trap 7',
    trapBuyInDown.isBlockedByTrap === true && trapBuyInDown.trapReason.includes('TRAP 7'),
    `Reason: ${trapBuyInDown.trapReason}`
  );

  const trapSellInUp = MarketTrapsAndChopEngine.evaluateMarketTraps({
    symbol: 'BTCUSD',
    side: 'SELL',
    marketStructure: 'UPTREND',
    setupType: 'REGULAR_SELL',
    candles: dummyCandles,
  });
  assert(
    'Suite 5: Trap 7 Parity',
    'Counter-trend SELL in UPTREND is blocked by Trap 7',
    trapSellInUp.isBlockedByTrap === true && trapSellInUp.trapReason.includes('TRAP 7'),
    `Reason: ${trapSellInUp.trapReason}`
  );

  // Liquidity Sweep exemption must work symmetrically for BOTH BUY and SELL
  const sweepBuyInDown = MarketTrapsAndChopEngine.evaluateMarketTraps({
    symbol: 'BTCUSD',
    side: 'BUY',
    marketStructure: 'DOWNTREND',
    setupType: 'LIQUIDITY_SWEEP_REVERSAL',
    candles: dummyCandles,
  });
  assert(
    'Suite 5: Trap 7 Parity',
    'Liquidity Sweep BUY in DOWNTREND bypasses Trap 7',
    sweepBuyInDown.isBlockedByTrap === false,
    `Sweep BUY blocked=${sweepBuyInDown.isBlockedByTrap}`
  );

  const sweepSellInUp = MarketTrapsAndChopEngine.evaluateMarketTraps({
    symbol: 'BTCUSD',
    side: 'SELL',
    marketStructure: 'UPTREND',
    setupType: 'LIQUIDITY_SWEEP_REVERSAL',
    candles: dummyCandles,
  });
  assert(
    'Suite 5: Trap 7 Parity',
    'Liquidity Sweep SELL in UPTREND bypasses Trap 7',
    sweepSellInUp.isBlockedByTrap === false,
    `Sweep SELL blocked=${sweepSellInUp.isBlockedByTrap}`
  );

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n===============================================================');
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('===============================================================');

  if (failedCount > 0) {
    console.error(`\n❌ ADVERSARIAL CHALLENGE FAILED: ${failedCount} tests failed.`);
    process.exit(1);
  } else {
    console.log('\n🎯 ALL ADVERSARIAL CHALLENGES PASSED CONVINCINGLY.');
    process.exit(0);
  }
}

runAdversarialTests().catch(err => {
  console.error('Test suite crashed with unhandled error:', err);
  process.exit(1);
});
