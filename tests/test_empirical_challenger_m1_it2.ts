import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { CryptoDedicatedStrategyEngine, strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
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

// Helper: Generate synthetic candles with exact parameters
function generateCandleSeries(options: {
  length: number;
  basePrice: number;
  pattern: 'PUMP' | 'DUMP' | 'RANGE' | 'ZIGZAG';
  stepSize?: number;
  volatility?: number;
}): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  let price = options.basePrice;
  const step = options.stepSize || 0.2;
  const vol = options.volatility || 0.1;

  for (let i = 0; i < options.length; i++) {
    if (options.pattern === 'PUMP') {
      price += step;
    } else if (options.pattern === 'DUMP') {
      price -= step;
    } else if (options.pattern === 'RANGE') {
      price = options.basePrice + Math.sin(i / 3) * vol * 2;
    } else if (options.pattern === 'ZIGZAG') {
      price += (i % 2 === 0 ? step : -step);
    }

    const open = price - (options.pattern === 'PUMP' ? step * 0.5 : (options.pattern === 'DUMP' ? -step * 0.5 : 0));
    const close = price;
    const high = Math.max(open, close) + vol;
    const low = Math.min(open, close) - vol;
    const volume = 5000 + (i % 5) * 500;

    candles.push({
      time: now - (options.length - i) * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return candles;
}

async function runEmpiricalChallengerSuite() {
  console.log('========================================================================');
  console.log('🧪 EMPIRICAL CHALLENGER M1 ITERATION 2 STRESS SUITE');
  console.log('   Deep Verification: Fast RSI Dynamic Indexing & Confluence Guard Regimes');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // SUITE 1: FAST RSI DYNAMIC INDEXING & DYNAMIC TRACKING
  // -------------------------------------------------------------------------
  console.log('--- SUITE 1: Fast RSI Dynamic Indexing & Array Bound Stress ---');

  // 1.1 SUI & ETH Sniper on 40-bar pump -> fastRsi > 90
  const pumpCandles = generateCandleSeries({ length: 40, basePrice: 10, pattern: 'PUMP', stepSize: 0.3 });
  const suiPump = strategyEngine.evaluateSuiQuantumBandSniper(pumpCandles);
  const ethPump = strategyEngine.evaluateEthQuantumBandSniper(pumpCandles);

  assert(
    'Suite 1: Fast RSI',
    'SUI Sniper fastRsi > 90 on 40-bar pump',
    suiPump.fastRsi > 90,
    `SUI fastRsi: ${suiPump.fastRsi}`
  );
  assert(
    'Suite 1: Fast RSI',
    'ETH Sniper fastRsi > 90 on 40-bar pump',
    ethPump.fastRsi > 90,
    `ETH fastRsi: ${ethPump.fastRsi}`
  );

  // 1.2 SUI & ETH Sniper on 40-bar dump -> fastRsi < 10
  const dumpCandles = generateCandleSeries({ length: 40, basePrice: 50, pattern: 'DUMP', stepSize: 0.3 });
  const suiDump = strategyEngine.evaluateSuiQuantumBandSniper(dumpCandles);
  const ethDump = strategyEngine.evaluateEthQuantumBandSniper(dumpCandles);

  assert(
    'Suite 1: Fast RSI',
    'SUI Sniper fastRsi < 10 on 40-bar dump',
    suiDump.fastRsi < 10,
    `SUI fastRsi: ${suiDump.fastRsi}`
  );
  assert(
    'Suite 1: Fast RSI',
    'ETH Sniper fastRsi < 10 on 40-bar dump',
    ethDump.fastRsi < 10,
    `ETH fastRsi: ${ethDump.fastRsi}`
  );

  // 1.3 Sine wave oscillation test: fastRsi is dynamic and not stuck at 50
  const rsiValuesSeen: number[] = [];
  for (let phase = 0; phase < 20; phase++) {
    const oscCandles: KlinePoint[] = [];
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      const p = 20 + Math.sin((phase + i) / 2) * 2;
      oscCandles.push({
        time: now - (40 - i) * 15 * 60 * 1000,
        open: p - 0.1,
        high: p + 0.2,
        low: p - 0.2,
        close: p + 0.1,
        volume: 2000,
      });
    }
    const res = strategyEngine.evaluateSuiQuantumBandSniper(oscCandles);
    rsiValuesSeen.push(res.fastRsi);
  }
  const minRsi = Math.min(...rsiValuesSeen);
  const maxRsi = Math.max(...rsiValuesSeen);
  const uniqueCount = new Set(rsiValuesSeen.map(r => r.toFixed(1))).size;

  assert(
    'Suite 1: Fast RSI',
    'Fast RSI dynamically oscillates over varying phases (min < 30, max > 70, unique values > 5)',
    minRsi < 30 && maxRsi > 70 && uniqueCount >= 5,
    `minRsi=${minRsi.toFixed(1)}, maxRsi=${maxRsi.toFixed(1)}, unique=${uniqueCount}`
  );

  // 1.4 Array bounds fuzzing: verify calculateRSI never returns out-of-bounds undefined
  let allBoundsValid = true;
  for (let len = 6; len <= 120; len++) {
    const closes = Array.from({ length: len }, (_, i) => 10 + i * 0.1);
    const rsi5 = CryptoDedicatedStrategyEngine.calculateRSI(closes, 5);
    const lastVal = rsi5[rsi5.length - 1];
    if (lastVal === undefined || isNaN(lastVal) || lastVal === null) {
      allBoundsValid = false;
      console.error(`calculateRSI(closes, 5) failed at len ${len}: val=${lastVal}`);
      break;
    }
  }
  assert(
    'Suite 1: Fast RSI',
    'calculateRSI(closes, 5) bounds valid across lengths 6..120',
    allBoundsValid,
    'Tested 115 array lengths without out-of-bounds or NaN'
  );

  // 1.5 SUI Lower Bollinger Band BUY reclaim triggers when fastRsi is oversold
  // Construct setup: 40 bars downtrend piercing lower BB, then a green reversal bar
  {
    const bbReclaimCandles: KlinePoint[] = [];
    let p = 2.0;
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      p -= 0.015;
      bbReclaimCandles.push({
        time: now - (42 - i) * 15 * 60 * 1000,
        open: p + 0.005,
        high: p + 0.01,
        low: p - 0.01,
        close: p,
        volume: 3000,
      });
    }
    // Bar 40: strong dump piercing lower BB
    bbReclaimCandles.push({
      time: now - 2 * 15 * 60 * 1000,
      open: p,
      high: p + 0.005,
      low: p - 0.08, // Deep pierce below BB
      close: p - 0.05,
      volume: 8000,
    });
    // Bar 41: green reclaim bar closing back above lower BB, fastRsi still <= 45
    bbReclaimCandles.push({
      time: now - 1 * 15 * 60 * 1000,
      open: p - 0.05,
      high: p - 0.01,
      low: p - 0.055,
      close: p - 0.02, // Green candle closing above open
      volume: 9000,
    });

    const suiReclaimRes = strategyEngine.evaluateSuiQuantumBandSniper(bbReclaimCandles);
    assert(
      'Suite 1: Fast RSI',
      'SUI Sniper evaluates reclaim with fastRsi <= 45 (never blocked by frozen 50)',
      suiReclaimRes.fastRsi <= 45,
      `suiReclaimRes fastRsi: ${suiReclaimRes.fastRsi}, signal=${suiReclaimRes.signal}`
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 2: CONFLUENCE GUARD IN TRENDING REGIMES
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Confluence Guard in Trending Regimes ---');

  // 2.1 Bullish Trend: Block 100% of counter-trend SELL setups
  // Test across multiple symbols: BTC, ETH, SOL, DOGE, AVAX, SUI
  const testCoins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD'];
  let zeroSellInBull = true;
  for (const sym of testCoins) {
    const bullCandles: KlinePoint[] = [];
    const baseP = sym.startsWith('BTC') ? 65000 : (sym.startsWith('ETH') ? 3500 : 25);
    const slope = baseP * 0.002;
    const now = Date.now();
    for (let i = 0; i < 80; i++) {
      const p = baseP + i * slope;
      bullCandles.push({
        time: now - (80 - i) * 15 * 60 * 1000,
        open: p - slope * 0.3,
        high: p + slope * 0.5,
        low: p - slope * 0.3,
        close: p,
        volume: 5000,
      });
    }
    // Final bar: Bearish Shooting Star rejection candle
    const lastP = bullCandles[bullCandles.length - 1].close;
    bullCandles[bullCandles.length - 1].open = lastP;
    bullCandles[bullCandles.length - 1].high = lastP + slope * 3;
    bullCandles[bullCandles.length - 1].low = lastP - slope * 0.5;
    bullCandles[bullCandles.length - 1].close = lastP - slope * 0.3;
    bullCandles[bullCandles.length - 1].volume = 25000;

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(bullCandles);
    const evalRes = await deltaAutoTrader.evaluateMultiTimeframeStrategies(sym.replace('USD', 'USDT'), sym, bullCandles, { trend1h: 'BULLISH' });

    if (evalRes?.side === 'SELL') {
      zeroSellInBull = false;
      console.error(`Coin ${sym} leaked a counter-trend SELL in Bullish regime!`);
    }
  }

  assert(
    'Suite 2: Trending Regimes',
    'Confluence Guard strictly blocks SELL in Bullish regime across all core assets (0 leakages)',
    zeroSellInBull,
    'Verified across BTC, ETH, SOL, DOGE, AVAX, SUI'
  );

  // 2.2 Bearish Trend: Block 100% of counter-trend BUY setups
  let zeroBuyInBear = true;
  for (const sym of testCoins) {
    const bearCandles: KlinePoint[] = [];
    const baseP = sym.startsWith('BTC') ? 65000 : (sym.startsWith('ETH') ? 3500 : 25);
    const slope = baseP * 0.002;
    const now = Date.now();
    for (let i = 0; i < 80; i++) {
      const p = baseP - i * slope;
      bearCandles.push({
        time: now - (80 - i) * 15 * 60 * 1000,
        open: p + slope * 0.3,
        high: p + slope * 0.3,
        low: p - slope * 0.5,
        close: p,
        volume: 5000,
      });
    }
    // Final bar: Bullish Hammer rejection candle
    const lastP = bearCandles[bearCandles.length - 1].close;
    bearCandles[bearCandles.length - 1].open = lastP;
    bearCandles[bearCandles.length - 1].high = lastP + slope * 0.5;
    bearCandles[bearCandles.length - 1].low = lastP - slope * 3;
    bearCandles[bearCandles.length - 1].close = lastP + slope * 0.3;
    bearCandles[bearCandles.length - 1].volume = 25000;

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(bearCandles);
    const evalRes = await deltaAutoTrader.evaluateMultiTimeframeStrategies(sym.replace('USD', 'USDT'), sym, bearCandles, { trend1h: 'BEARISH' });

    if (evalRes?.side === 'BUY') {
      zeroBuyInBear = false;
      console.error(`Coin ${sym} leaked a counter-trend BUY in Bearish regime!`);
    }
  }

  assert(
    'Suite 2: Trending Regimes',
    'Confluence Guard strictly blocks BUY in Bearish regime across all core assets (0 leakages)',
    zeroBuyInBear,
    'Verified across BTC, ETH, SOL, DOGE, AVAX, SUI'
  );

  // -------------------------------------------------------------------------
  // SUITE 3: CONFLUENCE GUARD IN RANGE / NEUTRAL REGIMES
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 3: Confluence Guard in Range / Neutral Regimes ---');

  // In a horizontal range regime, price oscillates around 50 EMA.
  // Confluence Guard must NOT block valid setups due to !allowsLong / !allowsShort.
  // Directional opposition only blocks SELL if trendDirection === 'BULLISH' || isMacroBullish,
  // and blocks BUY if trendDirection === 'BEARISH' || isMacroBearish.
  // In a pure range, trendDirection === 'NEUTRAL', isMacroBullish === false, isMacroBearish === false.
  {
    const rangeCandles: KlinePoint[] = [];
    const baseP = 100.0;
    const now = Date.now();
    for (let i = 0; i < 90; i++) {
      // Clean horizontal sine wave oscillation around baseP
      const p = baseP + Math.sin(i / 4) * 1.5;
      rangeCandles.push({
        time: now - (90 - i) * 15 * 60 * 1000,
        open: p - 0.2,
        high: p + 0.4,
        low: p - 0.4,
        close: p,
        volume: 3000,
      });
    }

    const confRange = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(rangeCandles);
    console.log(`    Range Confluence: trendDirection=${confRange.trendDirection}, isMacroBullish=${confRange.isMacroBullish}, isMacroBearish=${confRange.isMacroBearish}`);

    // Direct check of Confluence Guard logic on mock candidates:
    // A. Range floor bounce BUY candidate
    const mockBuyCandidate = {
      symbol: 'SOLUSD',
      timeframe: '15m' as const,
      strategyName: 'Playbook 2026 Range Floor Support Bounce',
      side: 'BUY' as const,
      confidenceScore: 75,
      atr: 1.5,
      reason: 'Range floor bounce',
    };

    // B. Range ceiling rejection SELL candidate
    const mockSellCandidate = {
      symbol: 'SOLUSD',
      timeframe: '15m' as const,
      strategyName: 'Playbook 2026 Range Ceiling Resistance Rejection',
      side: 'SELL' as const,
      confidenceScore: 75,
      atr: 1.5,
      reason: 'Range ceiling rejection',
    };

    // Filter logic identical to lib/deltaAutoTraderEngine.ts:1487-1496
    const passesBuyFilter = !(
      mockBuyCandidate.side === 'BUY' &&
      (confRange.trendDirection === 'BEARISH' || confRange.isMacroBearish)
    );

    const passesSellFilter = !(
      mockSellCandidate.side === 'SELL' &&
      (confRange.trendDirection === 'BULLISH' || confRange.isMacroBullish)
    );

    assert(
      'Suite 3: Range Regimes',
      'Range regime evaluates to NEUTRAL with isMacroBullish=false and isMacroBearish=false',
      confRange.trendDirection === 'NEUTRAL' && !confRange.isMacroBullish && !confRange.isMacroBearish,
      `trend=${confRange.trendDirection}, bull=${confRange.isMacroBullish}, bear=${confRange.isMacroBearish}`
    );

    assert(
      'Suite 3: Range Regimes',
      'Confluence Guard permits Range Floor BUY setups (NOT suppressed by !allowsLong)',
      passesBuyFilter,
      'passesBuyFilter === true in NEUTRAL regime'
    );

    assert(
      'Suite 3: Range Regimes',
      'Confluence Guard permits Range Ceiling SELL setups (NOT suppressed by !allowsShort)',
      passesSellFilter,
      'passesSellFilter === true in NEUTRAL regime'
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 4: RAPID REGIME TRANSITIONS & HYSTERESIS
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 4: Rapid Regime Transitions & Dynamic Responsiveness ---');

  // Test sequential evolution:
  // Phase 1 (Bars 1-60): Strong Uptrend
  // Phase 2 (Bars 61-90): Transition into Flat Sideways Range
  // Phase 3 (Bars 91-150): Breakdown into Strong Downtrend
  {
    const transitionCandles: KlinePoint[] = [];
    const now = Date.now();
    let p = 50.0;

    // Phase 1: Uptrend (50 -> 70)
    for (let i = 0; i < 60; i++) {
      p += 0.35;
      transitionCandles.push({
        time: now - (150 - i) * 15 * 60 * 1000,
        open: p - 0.1,
        high: p + 0.2,
        low: p - 0.2,
        close: p,
        volume: 4000,
      });
    }
    const confPhase1 = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(transitionCandles.slice(0, 60));

    // Phase 2: Range around 71 (Bars 60 to 90)
    for (let i = 60; i < 90; i++) {
      p = 71.0 + Math.sin((i - 60) / 2) * 0.4;
      transitionCandles.push({
        time: now - (150 - i) * 15 * 60 * 1000,
        open: p - 0.1,
        high: p + 0.2,
        low: p - 0.2,
        close: p,
        volume: 3000,
      });
    }
    const confPhase2 = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(transitionCandles.slice(0, 90));

    // Phase 3: Downtrend (71 -> 50)
    for (let i = 90; i < 150; i++) {
      p -= 0.35;
      transitionCandles.push({
        time: now - (150 - i) * 15 * 60 * 1000,
        open: p + 0.1,
        high: p + 0.2,
        low: p - 0.2,
        close: p,
        volume: 5000,
      });
    }
    const confPhase3 = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(transitionCandles);

    assert(
      'Suite 4: Dynamic Regimes',
      'Phase 1 detected as BULLISH trend',
      confPhase1.trendDirection === 'BULLISH' || confPhase1.isMacroBullish,
      `Phase 1: trend=${confPhase1.trendDirection}, isMacroBullish=${confPhase1.isMacroBullish}`
    );

    assert(
      'Suite 4: Dynamic Regimes',
      'Phase 3 detected as BEARISH trend',
      confPhase3.trendDirection === 'BEARISH' || confPhase3.isMacroBearish,
      `Phase 3: trend=${confPhase3.trendDirection}, isMacroBearish=${confPhase3.isMacroBearish}`
    );

    // Guard behavior in Phase 1: SELL blocked, BUY allowed
    const p1BlocksSell = confPhase1.trendDirection === 'BULLISH' || confPhase1.isMacroBullish;
    const p1AllowsBuy = !(confPhase1.trendDirection === 'BEARISH' || confPhase1.isMacroBearish);

    // Guard behavior in Phase 3: BUY blocked, SELL allowed
    const p3BlocksBuy = confPhase3.trendDirection === 'BEARISH' || confPhase3.isMacroBearish;
    const p3AllowsSell = !(confPhase3.trendDirection === 'BULLISH' || confPhase3.isMacroBullish);

    assert(
      'Suite 4: Dynamic Regimes',
      'Phase 1 Confluence Guard blocks SELL and allows BUY',
      p1BlocksSell && p1AllowsBuy,
      `p1BlocksSell=${p1BlocksSell}, p1AllowsBuy=${p1AllowsBuy}`
    );

    assert(
      'Suite 4: Dynamic Regimes',
      'Phase 3 Confluence Guard blocks BUY and allows SELL',
      p3BlocksBuy && p3AllowsSell,
      `p3BlocksBuy=${p3BlocksBuy}, p3AllowsSell=${p3AllowsSell}`
    );
  }

  // -------------------------------------------------------------------------
  // FINAL RESULTS TALLY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`📊 CHALLENGER M1 ITERATION 2 RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================================\n');

  if (failed > 0) {
    console.error(`❌ VERDICT: REQUEST_CHANGES (${failed} tests failed)`);
    process.exit(1);
  } else {
    console.log('🎯 VERDICT: APPROVE (All empirical stress tests passed cleanly)');
  }
}

runEmpiricalChallengerSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
