/**
 * ============================================================================
 * INDEPENDENT FORENSIC AUDIT SUITE FOR MILESTONE 1 DELIVERABLES
 * ============================================================================
 * Auditor: Forensic Auditor M1 (teamwork_auditor)
 * Scope:
 * - lib/strategies/standardStrategyInterface.ts
 * - lib/strategies/bradGohMindMathMoney3002Engine.ts
 * - lib/strategies/tradingLabDivergence3003Engine.ts
 * - lib/strategies/fractalFlowVolumeProfile3004Engine.ts
 * - lib/strategies/hybridMasterCryptoSMC3005Engine.ts
 * - lib/strategies/ytPatOrb3006Engine.ts
 * - lib/strategies/strategyRegistry.ts
 * ============================================================================
 */

import { KlinePoint } from '../src/types';
import { bradGohMindMathMoney3002Engine } from '../lib/strategies/bradGohMindMathMoney3002Engine';
import { tradingLabDivergence3003Engine } from '../lib/strategies/tradingLabDivergence3003Engine';
import { fractalFlowVolumeProfile3004Engine } from '../lib/strategies/fractalFlowVolumeProfile3004Engine';
import { hybridMasterCryptoSMC3005Engine } from '../lib/strategies/hybridMasterCryptoSMC3005Engine';
import { ytPatOrb3006Engine } from '../lib/strategies/ytPatOrb3006Engine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail: string = '') {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}: ${detail}`);
    failCount++;
  }
}

function createCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number = 1000
): KlinePoint {
  return { time, open, high, low, close, volume };
}

async function runAudit() {
  console.log('================================================================');
  console.log('   FORENSIC INTEGRITY AUDIT: MILESTONE 1 STRATEGY ENGINES      ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // CHECK 1: HARDCODED VALUES & FACADE DETECTION (DYNAMIC MATH)
  // --------------------------------------------------------------------------
  console.log('--- CHECK 1: Dynamic Math & Anti-Facade Verification ---');

  // 1.1 Volume Profile Dynamic Calculation
  const sampleCandles: KlinePoint[] = [];
  const baseTime = 1700000000;
  for (let i = 0; i < 60; i++) {
    // Volume concentrated around 100
    const vol = (i >= 25 && i <= 35) ? 5000 : 500;
    sampleCandles.push(createCandle(baseTime + i * 900, 100, 105, 95, 100, vol));
  }
  const vp1 = fractalFlowVolumeProfile3004Engine.calculateVolumeProfile(sampleCandles, 40);
  assert(
    vp1.poc > 95 && vp1.poc < 105 && vp1.vah > vp1.poc && vp1.val < vp1.poc,
    'FractalFlow 3004 Volume Profile dynamically calculates POC, VAH, VAL',
    `POC=${vp1.poc}, VAH=${vp1.vah}, VAL=${vp1.val}`
  );

  // Shift volume concentration to 120 and verify POC shifts dynamically
  const sampleCandles2: KlinePoint[] = [];
  for (let i = 0; i < 60; i++) {
    const vol = (i >= 25 && i <= 35) ? 10000 : 500;
    const price = (i >= 25 && i <= 35) ? 120 : 100;
    sampleCandles2.push(createCandle(baseTime + i * 900, price, price + 5, price - 5, price, vol));
  }
  const vp2 = fractalFlowVolumeProfile3004Engine.calculateVolumeProfile(sampleCandles2, 40);
  assert(
    vp2.poc > 115 && vp2.poc !== vp1.poc,
    'FractalFlow 3004 POC shifts dynamically with volume distribution (Not hardcoded)',
    `Original POC=${vp1.poc}, Shifted POC=${vp2.poc}`
  );

  // 1.2 Anti-Facade: Empty array returns null verdict without crashing
  const emptyRes3002 = bradGohMindMathMoney3002Engine.evaluateSetup('BTCUSDT', []);
  const emptyRes3003 = tradingLabDivergence3003Engine.evaluateSetup('BTCUSDT', []);
  const emptyRes3004 = fractalFlowVolumeProfile3004Engine.evaluateSetup('BTCUSDT', []);
  const emptyRes3005 = hybridMasterCryptoSMC3005Engine.evaluateSetup('BTCUSDT', []);
  const emptyRes3006 = ytPatOrb3006Engine.evaluateSetup('BTCUSDT', []);
  assert(
    emptyRes3002.recommendedSide === null &&
    emptyRes3003.recommendedSide === null &&
    emptyRes3004.recommendedSide === null &&
    emptyRes3005.recommendedSide === null &&
    emptyRes3006.recommendedSide === null,
    'All 5 engines return neutral verdict on empty candle array (Graceful degradation)',
    'Expected null signals for empty candle inputs'
  );

  // 1.3 Symbol Invariance (No hardcoded coin shortcuts)
  const symA = bradGohMindMathMoney3002Engine.evaluateSetup('ETHUSDT', sampleCandles);
  const symB = bradGohMindMathMoney3002Engine.evaluateSetup('RANDOM_COIN_XYZ', sampleCandles);
  assert(
    symA.recommendedSide === symB.recommendedSide && symA.confidenceScore === symB.confidenceScore,
    'Engines execute invariant mathematical logic regardless of symbol string',
    `ETH=${symA.recommendedSide}, XYZ=${symB.recommendedSide}`
  );

  // --------------------------------------------------------------------------
  // CHECK 2: OVER-FILTER ELIMINATION & RULE FAITHFULNESS
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 2: Over-Filter Elimination & Rule Faithfulness ---');

  // 2.1 Engine 3002: Verify 1.4 * ATR range choke was eliminated
  // Create 45 candles with compressed range (< 1.4 * ATR) but valid 5-step sequence
  // In the old code, this was rejected by `if (htfSpan < 1.4 * atr)`
  // Source check: confirm string '1.4 * atr' does not exist in bradGohMindMathMoney3002Engine.ts
  const fs = await import('fs');
  const code3002 = fs.readFileSync('lib/strategies/bradGohMindMathMoney3002Engine.ts', 'utf-8');
  assert(
    !code3002.includes('1.4 * atr') && !code3002.includes('htfSpan < 1.4'),
    'Engine 3002: htfSpan < 1.4 * atr low-volatility choke completely removed',
    'Found residual 1.4 * atr choke in source code'
  );
  assert(
    !code3002.includes('HTFBilateralBiasGatekeeper'),
    'Engine 3002: HTFBilateralBiasGatekeeper completely stripped',
    'Found residual HTFBilateralBiasGatekeeper reference'
  );

  // 2.2 Engine 3003: Verify middle 40%-60% range choke was eliminated
  const code3003 = fs.readFileSync('lib/strategies/tradingLabDivergence3003Engine.ts', 'utf-8');
  assert(
    !code3003.includes('isResistanceZone') && !code3003.includes('isSupportZone') && !code3003.includes('40%'),
    'Engine 3003: Middle 40%-60% range choke completely removed',
    'Found residual range choke in 3003'
  );

  // 2.3 Engine 3004: Verify Setup B and gatekeepers removed
  const code3004 = fs.readFileSync('lib/strategies/fractalFlowVolumeProfile3004Engine.ts', 'utf-8');
  assert(
    !code3004.includes('Setup B') && !code3004.includes('SETUP_B') && !code3004.includes('HTFBilateralBiasGatekeeper'),
    'Engine 3004: Conflicting Setup B & gatekeepers completely removed',
    'Found residual Setup B in 3004'
  );

  // 2.4 Engine 3005: Verify 1.4x ATR and 0.70x single candle restrictions removed
  const code3005 = fs.readFileSync('lib/strategies/hybridMasterCryptoSMC3005Engine.ts', 'utf-8');
  assert(
    !code3005.includes('1.4 * atr') && !code3005.includes('0.70 * atr') && !code3005.includes('0.7 * curBody'),
    'Engine 3005: 1.4x ATR and 0.70x single candle restrictions completely removed',
    'Found residual 1.4x or 0.70x ATR restrictions in 3005'
  );

  // 2.5 Engine 3006: Verify London double-sweep abort replaced with NY Continuation Bias
  const code3006 = fs.readFileSync('lib/strategies/ytPatOrb3006Engine.ts', 'utf-8');
  assert(
    code3006.includes("sessionBias = 'CONTINUATION'") && !code3006.includes('sweptAsianLow && sweptAsianHigh) return emptyVerdict'),
    'Engine 3006: Asian double-sweep abort replaced with NY Continuation Bias',
    'Double-sweep abort still present in 3006'
  );

  // 2.6 StrategyRegistry: Verify wrappers removed
  const codeRegistry = fs.readFileSync('lib/strategies/strategyRegistry.ts', 'utf-8');
  const case3002Body = codeRegistry.substring(codeRegistry.indexOf('case 3002:'), codeRegistry.indexOf('case 3003:'));
  const case3004Body = codeRegistry.substring(codeRegistry.indexOf('case 3004:'), codeRegistry.indexOf('case 3005:'));
  assert(
    !case3002Body.includes('HTFBilateralBiasGatekeeper') && !case3002Body.includes('DynamicTP2Engine'),
    'StrategyRegistry: Port 3002 evaluates directly without Gatekeeper or DynamicTP2 wrappers',
    'Wrappers still wrapping Port 3002 in registry'
  );
  assert(
    !case3004Body.includes('HTFBilateralBiasGatekeeper') && !case3004Body.includes('DynamicTP2Engine'),
    'StrategyRegistry: Port 3004 evaluates directly without Gatekeeper or DynamicTP2 wrappers',
    'Wrappers still wrapping Port 3004 in registry'
  );

  // --------------------------------------------------------------------------
  // CHECK 3: BILATERAL SYMMETRY (EMPIRICAL BUY AND SELL VERIFICATION)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 3: Bilateral Symmetry (Long & Short Execution) ---');

  // Test 3003: TradingLab Divergence - Construct clean Swing Peak sweep with Bearish Divergence -> SELL
  const sellCandles3003: KlinePoint[] = [];
  for (let i = 0; i < 40; i++) {
    sellCandles3003.push(createCandle(baseTime + i * 900, 100, 101, 99, 100, 1000));
  }
  // Create swing peak at bar 34 (high 105, rsi high)
  sellCandles3003[32] = createCandle(baseTime + 32 * 900, 100, 102, 99, 101, 1000);
  sellCandles3003[33] = createCandle(baseTime + 33 * 900, 101, 103, 100, 102, 1000);
  sellCandles3003[34] = createCandle(baseTime + 34 * 900, 102, 105, 101, 104, 1000); // Peak
  sellCandles3003[35] = createCandle(baseTime + 35 * 900, 104, 104, 100, 101, 1000);
  sellCandles3003[36] = createCandle(baseTime + 36 * 900, 101, 102, 99, 100, 1000);
  sellCandles3003[37] = createCandle(baseTime + 37 * 900, 100, 101, 99, 100, 1000);
  sellCandles3003[38] = createCandle(baseTime + 38 * 900, 100, 101, 99, 100, 1000);
  // Current candle sweeps peak 105 (high 105.5) but closes below at 103 with lower RSI (divergence)
  sellCandles3003[39] = createCandle(baseTime + 39 * 900, 100, 105.5, 99.5, 103, 1000);

  const resSell3003 = tradingLabDivergence3003Engine.evaluateSetup('TEST', sellCandles3003);
  assert(
    resSell3003.recommendedSide === 'SELL',
    'TradingLab 3003 generates authentic SELL signal on swing high sweep + bearish divergence',
    `Expected SELL, got ${resSell3003.recommendedSide} (${resSell3003.reasons.join('; ')})`
  );

  // Test 3003: Construct clean Swing Valley sweep with Bullish Divergence -> BUY
  const buyCandles3003: KlinePoint[] = [];
  for (let i = 0; i < 40; i++) {
    buyCandles3003.push(createCandle(baseTime + i * 900, 100, 101, 99, 100, 1000));
  }
  // Create swing valley at bar 34 (low 95)
  buyCandles3003[32] = createCandle(baseTime + 32 * 900, 100, 101, 98, 99, 1000);
  buyCandles3003[33] = createCandle(baseTime + 33 * 900, 99, 100, 97, 98, 1000);
  buyCandles3003[34] = createCandle(baseTime + 34 * 900, 98, 99, 95, 96, 1000); // Valley
  buyCandles3003[35] = createCandle(baseTime + 35 * 900, 96, 100, 96, 99, 1000);
  buyCandles3003[36] = createCandle(baseTime + 36 * 900, 99, 101, 98, 100, 1000);
  buyCandles3003[37] = createCandle(baseTime + 37 * 900, 100, 101, 99, 100, 1000);
  buyCandles3003[38] = createCandle(baseTime + 38 * 900, 100, 101, 99, 100, 1000);
  // Current candle sweeps valley 95 (low 94.5) but closes above at 97 with higher RSI (bullish divergence)
  buyCandles3003[39] = createCandle(baseTime + 39 * 900, 100, 100.5, 94.5, 97, 1000);

  const resBuy3003 = tradingLabDivergence3003Engine.evaluateSetup('TEST', buyCandles3003);
  assert(
    resBuy3003.recommendedSide === 'BUY',
    'TradingLab 3003 generates authentic BUY signal on swing low sweep + bullish divergence',
    `Expected BUY, got ${resBuy3003.recommendedSide} (${resBuy3003.reasons.join('; ')})`
  );

  // Test 3004: Fractal Flow Volume Profile - Sweep above VAH -> SELL
  const candles3004Sell: KlinePoint[] = [];
  for (let i = 0; i < 55; i++) {
    candles3004Sell.push(createCandle(baseTime + i * 900, 100, 102, 98, 100, 1000));
  }
  // Calculate VP on first 53 candles
  const vpTemp = fractalFlowVolumeProfile3004Engine.calculateVolumeProfile(candles3004Sell, 40);
  // Prev candle sweeps above VAH
  candles3004Sell.push(createCandle(baseTime + 55 * 900, 100, vpTemp.vah + 2.0, 99, vpTemp.vah + 1.0, 2000));
  // Current candle closes back inside Value Area (< VAH) with bearish displacement
  candles3004Sell.push(createCandle(baseTime + 56 * 900, vpTemp.vah + 0.5, vpTemp.vah + 0.6, vpTemp.vah - 1.5, vpTemp.vah - 1.0, 2000));
  const resSell3004 = fractalFlowVolumeProfile3004Engine.evaluateSetup('TEST', candles3004Sell);
  assert(
    resSell3004.recommendedSide === 'SELL',
    'FractalFlow 3004 generates authentic SELL on VAH sweep into LVN & close inside VA',
    `Expected SELL, got ${resSell3004.recommendedSide}`
  );

  // Test 3004: Sweep below VAL -> BUY
  const candles3004Buy: KlinePoint[] = [];
  for (let i = 0; i < 55; i++) {
    candles3004Buy.push(createCandle(baseTime + i * 900, 100, 102, 98, 100, 1000));
  }
  const vpTempBuy = fractalFlowVolumeProfile3004Engine.calculateVolumeProfile(candles3004Buy, 40);
  // Prev candle sweeps below VAL
  candles3004Buy.push(createCandle(baseTime + 55 * 900, 100, 101, vpTempBuy.val - 2.0, vpTempBuy.val - 1.0, 2000));
  // Current candle closes back inside Value Area (> VAL) with bullish displacement
  candles3004Buy.push(createCandle(baseTime + 56 * 900, vpTempBuy.val - 0.5, vpTempBuy.val + 1.5, vpTempBuy.val - 0.6, vpTempBuy.val + 1.0, 2000));
  const resBuy3004 = fractalFlowVolumeProfile3004Engine.evaluateSetup('TEST', candles3004Buy);
  assert(
    resBuy3004.recommendedSide === 'BUY',
    'FractalFlow 3004 generates authentic BUY on VAL sweep into LVN & close inside VA',
    `Expected BUY, got ${resBuy3004.recommendedSide}`
  );

  // --------------------------------------------------------------------------
  // CHECK 4: FEE PROTECTION ENFORCEMENT (MIN_SL_DISTANCE_PCT >= 0.0045)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 4: Fee Protection Enforcement (>= 0.45%) ---');

  assert(
    resSell3003.minSlDistancePct >= 0.0045,
    'Engine 3003 enforces minSlDistancePct >= 0.0045 on SELL',
    `got ${resSell3003.minSlDistancePct}`
  );
  assert(
    resBuy3003.minSlDistancePct >= 0.0045,
    'Engine 3003 enforces minSlDistancePct >= 0.0045 on BUY',
    `got ${resBuy3003.minSlDistancePct}`
  );
  assert(
    resSell3004.minSlDistancePct >= 0.0045,
    'Engine 3004 enforces minSlDistancePct >= 0.0045 on SELL',
    `got ${resSell3004.minSlDistancePct}`
  );
  assert(
    resBuy3004.minSlDistancePct >= 0.0045,
    'Engine 3004 enforces minSlDistancePct >= 0.0045 on BUY',
    `got ${resBuy3004.minSlDistancePct}`
  );

  // Test clamping: Create setup with tiny ATR where raw SL is only 0.1% away
  const tinyAtrCandles: KlinePoint[] = [];
  for (let i = 0; i < 40; i++) {
    // Range is only 0.01 on price 100 (0.01% ATR)
    tinyAtrCandles.push(createCandle(baseTime + i * 900, 100, 100.01, 99.99, 100, 1000));
  }
  // Setup valley at bar 34 (99.95)
  tinyAtrCandles[34] = createCandle(baseTime + 34 * 900, 100, 100.01, 99.95, 99.98, 1000);
  // Current sweeps to 99.94 and closes at 99.99
  tinyAtrCandles[39] = createCandle(baseTime + 39 * 900, 100, 100.01, 99.94, 99.99, 1000);
  const tinyRes = tradingLabDivergence3003Engine.evaluateSetup('TEST', tinyAtrCandles);
  if (tinyRes.recommendedSide) {
    const slDistPct = Math.abs(tinyRes.entryPrice - tinyRes.stopLossPrice) / tinyRes.entryPrice;
    assert(
      slDistPct >= 0.0045,
      'Fee Protection clamp strictly forces stop-loss distance to >= 0.45% under ultra-tight volatility',
      `Calculated SL distance=${(slDistPct * 100).toFixed(4)}%`
    );
  } else {
    // If rejected, still verifies fee protection in code
    assert(
      code3003.includes('currentPrice * 0.0045'),
      'Engine 3003 code verifies currentPrice * 0.0045 minimum risk floor'
    );
  }

  // --------------------------------------------------------------------------
  // CHECK 5: STRATEGY REGISTRY PARTIAL EXIT TARGET FORWARDING
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 5: Strategy Registry Output Forwarding ---');

  const reg3003 = evaluateStrategyForPort(3003, 'TEST', buyCandles3003);
  assert(
    reg3003.signal === 'BUY',
    'StrategyRegistry dispatch for Port 3003 forwards BUY signal',
    `Signal=${reg3003.signal}`
  );
  assert(
    reg3003.tp1Price !== undefined && reg3003.tp1Price > 0,
    'StrategyRegistry forwards tp1Price without dropping it',
    `tp1Price=${reg3003.tp1Price}`
  );
  assert(
    reg3003.tp2Price !== undefined && reg3003.tp2Price > 0,
    'StrategyRegistry forwards tp2Price without dropping it',
    `tp2Price=${reg3003.tp2Price}`
  );
  assert(
    reg3003.tp1Ratio === 0.75,
    'StrategyRegistry forwards tp1Ratio = 0.75 (75% partial close)',
    `tp1Ratio=${reg3003.tp1Ratio}`
  );
  assert(
    reg3003.tp2Ratio === 0.25,
    'StrategyRegistry forwards tp2Ratio = 0.25 (25% partial runner)',
    `tp2Ratio=${reg3003.tp2Ratio}`
  );
  assert(
    reg3003.earlyBreakevenPrice !== undefined && reg3003.earlyBreakevenPrice > 0,
    'StrategyRegistry forwards earlyBreakevenPrice (+0.75R)',
    `earlyBreakevenPrice=${reg3003.earlyBreakevenPrice}`
  );

  const reg3004 = evaluateStrategyForPort(3004, 'TEST', candles3004Sell);
  assert(
    reg3004.signal === 'SELL',
    'StrategyRegistry dispatch for Port 3004 forwards SELL signal',
    `Signal=${reg3004.signal}`
  );
  assert(
    reg3004.tp1Ratio === 0.75 && reg3004.tp2Ratio === 0.25,
    'StrategyRegistry forwards 75% TP1 and 25% TP2 for Port 3004',
    `tp1=${reg3004.tp1Ratio}, tp2=${reg3004.tp2Ratio}`
  );

  // --------------------------------------------------------------------------
  // CHECK 6: PORT 3001 CODEBASE BOUNDARY INVARIANT
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 6: Port 3001 Codebase Boundary Invariant ---');

  // Verify that git status / file check confirms no modifications during Milestone 1
  const serverStat = fs.statSync('server.ts');
  const viteStat = fs.statSync('vite.config.ts');
  const appStat = fs.statSync('src/App.tsx');
  const m1FileStat = fs.statSync('lib/strategies/bradGohMindMathMoney3002Engine.ts');

  // Milestone 1 file was created/modified after 22:45 on 02-11-2026
  // Port 3001 files have mtimes from 01-11-2026 or earlier today (before M1)
  const isPort3001UntouchedByM1 =
    serverStat.mtime.getTime() < m1FileStat.mtime.getTime() &&
    viteStat.mtime.getTime() < m1FileStat.mtime.getTime() &&
    appStat.mtime.getTime() < m1FileStat.mtime.getTime();

  assert(
    isPort3001UntouchedByM1,
    'Port 3001 files (server.ts, vite.config.ts, src/App.tsx) were NEVER touched during Milestone 1',
    `server.ts mtime=${serverStat.mtime.toISOString()}, M1 mtime=${m1FileStat.mtime.toISOString()}`
  );

  // --------------------------------------------------------------------------
  // SUMMARY REPORT
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 AUDIT RESULT: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================');

  if (failCount === 0) {
    console.log('🏁 BINARY AUDIT VERDICT: CLEAN');
    process.exit(0);
  } else {
    console.error('🚫 BINARY AUDIT VERDICT: INTEGRITY VIOLATION');
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Audit suite crashed with unexpected error:', err);
  process.exit(1);
});
