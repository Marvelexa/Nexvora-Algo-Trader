import assert from 'assert';
import { PortfolioMarketRegimeEngine, portfolioMarketRegime, MarketRegimeBiasState } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

console.log('🧪 Starting Portfolio Market Regime & Hard R:R Gatekeeper Tests...\n');

let passCount = 0;
let failCount = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passCount++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failCount++;
  }
}

// ============================================================================
// FIX 1 & FIX 3: BTC Market Leader Compass & Relative Strength/Weakness
// ============================================================================
console.log('--- FIX 1 & FIX 3: BTC Market Leader Compass & Relative Strength/Weakness ---');

it('BEARISH REGIME: Strictly blocks ALL BUY/LONG trades across all altcoins', () => {
  const bearishState: MarketRegimeBiasState = {
    bias: 'BEARISH',
    timestamp: Date.now(),
    btcPrice: 76900,
    btcVwap15m: 77200,
    btcEma9: 77000,
    btcEma21: 77300,
    btcStructure15m: 'BEARISH',
    btcStructure1h: 'BEARISH',
    btcAdx14: 28,
    breadthPctAboveVwap: 0.20,
    activeBtcPositionSide: 'SELL',
    reasons: ['Active BTC Short'],
  };

  // Attempting to BUY DOGE in a Bearish regime MUST be blocked
  const dogeBuy = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'DOGEUSD',
    side: 'BUY',
    currentPrice: 0.0739,
    vwap15m: 0.0735,
    biasState: bearishState,
  });
  assert.strictEqual(dogeBuy.allowed, false, 'DOGE BUY must be blocked in Bearish regime');
  assert.ok(dogeBuy.reason.includes('BEARISH MARKET REGIME VETO'), 'Reason must specify Bearish veto');

  // Attempting to BUY XRP in a Bearish regime MUST be blocked
  const xrpBuy = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'XRPUSD',
    side: 'BUY',
    currentPrice: 1.24,
    vwap15m: 1.23,
    biasState: bearishState,
  });
  assert.strictEqual(xrpBuy.allowed, false, 'XRP BUY must be blocked in Bearish regime');

  // Attempting to SELL weak DOGE (below VWAP) in Bearish regime MUST be allowed
  const dogeSell = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'DOGEUSD',
    side: 'SELL',
    currentPrice: 0.0730,
    vwap15m: 0.0735, // Price < VWAP (weak altcoin)
    biasState: bearishState,
  });
  assert.strictEqual(dogeSell.allowed, true, 'DOGE SELL below VWAP must be allowed');
  assert.ok(dogeSell.reason.includes('BEARISH REGIME APPROVED'), 'Reason must specify Bearish approval');

  // Attempting to SHORT an altcoin that is pumping way above VWAP (+5.7%) is rejected (Relative Strength filter)
  const strongAltSell = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 185,
    vwap15m: 175,
    biasState: bearishState,
  });
  assert.strictEqual(strongAltSell.allowed, false, 'Pumping coin above VWAP must not be shorted');
  assert.ok(strongAltSell.reason.includes('RELATIVE STRENGTH VETO'), 'Reason must state Relative Strength veto');
});

it('BULLISH REGIME: Strictly blocks ALL SELL/SHORT trades across all altcoins', () => {
  const bullishState: MarketRegimeBiasState = {
    bias: 'BULLISH',
    timestamp: Date.now(),
    btcPrice: 82000,
    btcVwap15m: 81500,
    btcEma9: 81800,
    btcEma21: 81200,
    btcStructure15m: 'BULLISH',
    btcStructure1h: 'BULLISH',
    btcAdx14: 32,
    breadthPctAboveVwap: 0.75,
    activeBtcPositionSide: 'BUY',
    reasons: ['Active BTC Long'],
  };

  // Attempting to SHORT DOGE in a Bullish regime MUST be blocked
  const dogeShort = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'DOGEUSD',
    side: 'SELL',
    currentPrice: 0.074,
    vwap15m: 0.073,
    biasState: bullishState,
  });
  assert.strictEqual(dogeShort.allowed, false, 'DOGE SHORT must be blocked in Bullish regime');
  assert.ok(dogeShort.reason.includes('BULLISH MARKET REGIME VETO'), 'Reason must specify Bullish veto');

  // Attempting to BUY a strong altcoin (above VWAP) in Bullish regime MUST be allowed
  const solBuy = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'SOLUSD',
    side: 'BUY',
    currentPrice: 180,
    vwap15m: 178,
    biasState: bullishState,
  });
  assert.strictEqual(solBuy.allowed, true, 'SOL BUY above VWAP must be allowed');

  // Attempting to BUY a dumping altcoin way below VWAP is rejected (Relative Weakness filter)
  const weakAltBuy = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'ADAUSD',
    side: 'BUY',
    currentPrice: 0.50,
    vwap15m: 0.55,
    biasState: bullishState,
  });
  assert.strictEqual(weakAltBuy.allowed, false, 'Falling knife coin below VWAP must not be bought');
  assert.ok(weakAltBuy.reason.includes('RELATIVE WEAKNESS VETO'), 'Reason must state Relative Weakness veto');
});

it('NEUTRAL REGIME: Allows Port 3010 range trades or >2x volume surge outliers only', () => {
  const neutralState: MarketRegimeBiasState = {
    bias: 'NEUTRAL',
    timestamp: Date.now(),
    btcPrice: 77000,
    btcVwap15m: 77000,
    btcEma9: 77000,
    btcEma21: 77000,
    btcStructure15m: 'RANGING',
    btcStructure1h: 'RANGING',
    btcAdx14: 14,
    breadthPctAboveVwap: 0.50,
    activeBtcPositionSide: null,
    reasons: ['Chop'],
  };

  // Standard trade in neutral regime is blocked
  const normalTrade = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'ETHUSD',
    side: 'BUY',
    currentPrice: 2600,
    vwap15m: 2600,
    volumeRatio: 1.1,
    isPort3010: false,
    biasState: neutralState,
  });
  assert.strictEqual(normalTrade.allowed, false, 'Normal trade in neutral chop must be blocked');

  // Port 3010 range setup is allowed
  const port3010Trade = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'ETHUSD',
    side: 'BUY',
    currentPrice: 2600,
    vwap15m: 2600,
    volumeRatio: 1.0,
    isPort3010: true,
    biasState: neutralState,
  });
  assert.strictEqual(port3010Trade.allowed, true, 'Port 3010 range trade must be allowed');

  // Decoupled volume surge (>2x) is allowed
  const surgeTrade = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'SUIUSD',
    side: 'BUY',
    currentPrice: 2.1,
    vwap15m: 2.1,
    volumeRatio: 2.5,
    isPort3010: false,
    biasState: neutralState,
  });
  assert.strictEqual(surgeTrade.allowed, true, 'Surge trade (>2x vol) must be allowed');
});

// ============================================================================
// FIX 2: Portfolio Directional Coherence Across 4 Concurrent Open Slots
// ============================================================================
console.log('\n--- FIX 2: Portfolio Directional Coherence ---');

it('Blocks BUY candidates when portfolio holds an active BTC SHORT', () => {
  const activePositions: DeltaPosition[] = [
    {
      id: 'pos-1',
      symbol: 'BTCUSD',
      side: 'SELL',
      entryPrice: 76950.5,
      currentPrice: 76930,
      quantity: 0.018,
      marginUSD: 46,
      notionalUSD: 1385,
      leverage: 30,
      takeProfitPrice: 76085.5,
      stopLossPrice: 77702.7,
      initialStopLossPrice: 77702.7,
      atr: 300,
      isBreakevenLocked: false,
      pnlUSD: 0.19,
      pnlPercent: 0.41,
      entryTime: Date.now(),
      strategyName: 'Hybrid Master SMC',
      executionMode: 'DIRECT',
    }
  ];

  // Candidate 1: DOGE BUY -> MUST BE BLOCKED
  const dogeBuy = portfolioMarketRegime.checkPortfolioCoherence(activePositions, 'BUY', 'DOGEUSD');
  assert.strictEqual(dogeBuy.allowed, false);
  assert.ok(dogeBuy.reason.includes('Active BTCUSD position is SELL'));

  // Candidate 2: XRP BUY -> MUST BE BLOCKED
  const xrpBuy = portfolioMarketRegime.checkPortfolioCoherence(activePositions, 'BUY', 'XRPUSD');
  assert.strictEqual(xrpBuy.allowed, false);
  assert.ok(xrpBuy.reason.includes('Active BTCUSD position is SELL'));

  // Candidate 3: ETH SELL -> MUST BE ALLOWED
  const ethSell = portfolioMarketRegime.checkPortfolioCoherence(activePositions, 'SELL', 'ETHUSD');
  assert.strictEqual(ethSell.allowed, true);
});

it('Blocks SELL candidates when portfolio holds active BUY positions', () => {
  const activePositions: DeltaPosition[] = [
    {
      id: 'pos-1',
      symbol: 'SOLUSD',
      side: 'BUY',
      entryPrice: 180,
      currentPrice: 182,
      quantity: 5,
      marginUSD: 30,
      notionalUSD: 900,
      leverage: 30,
      takeProfitPrice: 186,
      stopLossPrice: 177,
      initialStopLossPrice: 177,
      atr: 2.5,
      isBreakevenLocked: false,
      pnlUSD: 10,
      pnlPercent: 1.1,
      entryTime: Date.now(),
      strategyName: 'Solano VWAP',
      executionMode: 'DIRECT',
    }
  ];

  // Candidate: XRP SELL -> MUST BE BLOCKED
  const xrpSell = portfolioMarketRegime.checkPortfolioCoherence(activePositions, 'SELL', 'XRPUSD');
  assert.strictEqual(xrpSell.allowed, false);
  assert.ok(xrpSell.reason.includes('PORTFOLIO COHERENCE VETO'));

  // Candidate: DOGE BUY -> MUST BE ALLOWED
  const dogeBuy = portfolioMarketRegime.checkPortfolioCoherence(activePositions, 'BUY', 'DOGEUSD');
  assert.strictEqual(dogeBuy.allowed, true);
});

it('Regime Flip: Automatically tightens SL to Breakeven on opposing trades', () => {
  const activePositions: DeltaPosition[] = [
    {
      id: 'pos-1',
      symbol: 'DOGEUSD',
      side: 'BUY',
      entryPrice: 0.0739,
      currentPrice: 0.0737,
      quantity: 19000,
      marginUSD: 46,
      notionalUSD: 1400,
      leverage: 30,
      takeProfitPrice: 0.076,
      stopLossPrice: 0.0725,
      initialStopLossPrice: 0.0725,
      atr: 0.0004,
      isBreakevenLocked: false,
      pnlUSD: -3.8,
      pnlPercent: -8.0,
      entryTime: Date.now(),
      strategyName: 'Test',
      executionMode: 'DIRECT',
    }
  ];

  // Market flips to BEARISH
  const res = portfolioMarketRegime.checkRegimeFlipAndBreakeven(activePositions, 'BEARISH');
  assert.strictEqual(res.tightenedCount, 1);
  assert.strictEqual(res.positions[0].isBreakevenLocked, true);
  assert.strictEqual(res.positions[0].stopLossPrice, 0.0739); // Tightened to entry price
});

// ============================================================================
// FIX 4: Hard Gatekeeper for TP/SL Math (Actual_RR >= 1.15 & Clamped SL)
// ============================================================================
console.log('\n--- FIX 4: Hard Gatekeeper for TP/SL Math ---');

it('Fixes inverted R:R on BTCUSD Short: 0.21R TP is auto-corrected to 1.05R', () => {
  // Historical flawed values from user prompt: Entry 76950.5, SL 77702.7, TP 76787.6
  const entryPrice = 76950.5;
  const flawedSL = 77600.0; // SL Dist = 649.5 points (~0.84% of price <= 0.85% cap)
  const flawedTP = 76787.6; // TP Dist = 162.9 points (only 0.25R!)

  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'BTCUSD',
    side: 'SELL',
    entryPrice,
    stopLossPrice: flawedSL,
    takeProfitPrice: flawedTP,
    tickSize: 0.1,
    decimals: 1,
  });

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.wasAdjusted, true);
  assert.ok(result.actualRR >= 1.05, `Actual RR must be >= 1.05, got ${result.actualRR}`);
  assert.ok(result.takeProfitPrice < 76500, 'TP must NOT be the flawed 76787.6');
});

it('Clamps micro SL distance (< 0.35%) up to 0.35% minimum floor', () => {
  const entryPrice = 100.0;
  const microSL = 99.85; // 0.15% SL
  const targetTP = 101.0;

  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: microSL,
    takeProfitPrice: targetTP,
    tickSize: 0.01,
    decimals: 2,
  });

  assert.strictEqual(result.wasAdjusted, true);
  assert.ok(Math.abs(result.slDistance - 0.35) < 0.02, `SL distance should be 0.35, got ${result.slDistance}`);
  assert.ok(Math.abs(result.stopLossPrice - 99.65) < 0.02, `SL should be 99.65, got ${result.stopLossPrice}`);
  assert.ok(result.actualRR >= 1.05, 'Actual RR must be >= 1.05');
});

it('Clamps gigantic SL distance (> 0.85%) down to 0.85% maximum ceiling', () => {
  const entryPrice = 1000.0;
  const hugeSL = 950.0; // 5.0% SL
  const targetTP = 1100.0;

  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'ETHUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: hugeSL,
    takeProfitPrice: targetTP,
    tickSize: 0.1,
    decimals: 1,
  });

  assert.strictEqual(result.wasAdjusted, true);
  assert.ok(Math.abs(result.slDistance - 8.5) < 0.2, `SL distance should be capped at 8.5 (0.85%), got ${result.slDistance}`);
  assert.ok(Math.abs(result.stopLossPrice - 991.5) < 0.2, `SL should be 991.5, got ${result.stopLossPrice}`);
  assert.ok(result.actualRR >= 1.05, 'Actual RR must be >= 1.05');
});

console.log(`\n========================================`);
console.log(`Summary: ${passCount} PASSED, ${failCount} FAILED`);
console.log(`========================================\n`);

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 All Portfolio Market Regime & Gatekeeper tests passed with 100% compliance!');
}
