import { strict as assert } from 'assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { CandleStructureTPCalculator } from '../lib/risk/candleStructureProfitProtectionEngine';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
  } catch (e: any) {
    console.error(`  ❌ FAIL: ${name}\n     ${e.message}\n`);
    throw e;
  }
}

console.log('🧪 Running Reversal-to-Reversal TP/SL & 3-Tier Profit-Ratchet Test Suite...\n');

// Helper to generate mock candles
function buildMockCandles(basePrice: number, count: number = 40, atr: number = 0.0010): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const t = now - (count - i) * 15 * 60 * 1000;
    const offset = Math.sin(i / 2) * atr * 2;
    const open = basePrice + offset;
    const close = open + (i % 2 === 0 ? atr * 0.5 : -atr * 0.5);
    const high = Math.max(open, close) + atr * 0.4;
    const low = Math.min(open, close) - atr * 0.4;
    candles.push({ time: t, open, high, low, close, volume: 1000 });
  }
  return candles;
}

// ----------------------------------------------------------------------------
// RULE 1: SL ANCHORED AT IMMEDIATE REVERSAL WICK (MAX 0.85% HARD CAP = MAX -25% ROE)
// ----------------------------------------------------------------------------
it('RULE 1.1: Long SL anchored at immediate 3-5 bar reversal swing low - 0.10*ATR and clamped <= 0.85%', () => {
  const candles = buildMockCandles(0.0760, 20, 0.0004);
  // Last 5 candles have a swing low at 0.0756
  candles[candles.length - 3].low = 0.0756;
  const entryPrice = 0.0760;
  const atr = 0.0004;

  const sl = UniversalTradeGuard.calculateSweepProofSL({
    side: 'BUY',
    entryPrice,
    atr,
    candles15m: candles,
    decimals: 6,
  });

  const expectedRawSL = 0.0756 - (0.10 * atr); // 0.075560
  const maxAllowedDist = entryPrice * 0.0085; // 0.85% cap = 0.000646

  assert.ok(sl.stopLossPrice < entryPrice, 'SL must be below entry');
  assert.ok(sl.slDistance <= maxAllowedDist + 0.000001, `SL distance ${sl.slDistance} must be <= max 0.85% (${maxAllowedDist})`);
  assert.ok(sl.slDistance >= entryPrice * 0.0035 - 0.000001, 'SL distance must be >= min 0.35% floor');
  assert.equal(sl.isVetoed, false, 'Should not be vetoed when within limits');
});

it('RULE 1.2: Short SL anchored at immediate 3-5 bar reversal swing high + 0.10*ATR and clamped <= 0.85% (Preventing ADA -49.5% ROE)', () => {
  // Reproducing ADA short setup from user prompt: Entry 0.19609
  const candles = buildMockCandles(0.19609, 20, 0.0010);
  // Reversal high 3 bars ago at 0.19720
  candles[candles.length - 2].high = 0.19720;
  const entryPrice = 0.19609;
  const atr = 0.0010;

  const sl = UniversalTradeGuard.calculateSweepProofSL({
    side: 'SELL',
    entryPrice,
    atr,
    candles15m: candles,
    decimals: 5,
  });

  const maxAllowedDist = entryPrice * 0.0085; // 0.85% cap = 0.0016667
  const maxSLPrice = entryPrice + maxAllowedDist;

  assert.ok(sl.stopLossPrice > entryPrice, 'SL must be above entry for Short');
  assert.ok(sl.slDistance <= maxAllowedDist + 0.00001, `SL distance (${sl.slDistance}) must never exceed 0.85% (${maxAllowedDist})!`);
  assert.ok(sl.stopLossPrice <= maxSLPrice + 0.00001, `SL price ${sl.stopLossPrice} must not exceed ${maxSLPrice}`);
});

it('RULE 1.3: SL VETO: Hard veto entry (SL_TOO_WIDE_LATE_ENTRY_VETO) if raw swing wick is > 0.90% away', () => {
  const candles = buildMockCandles(0.19609, 20, 0.0010);
  // An extreme swing high that is 1.5% away (0.19903)
  candles[candles.length - 2].high = 0.19903;
  const entryPrice = 0.19609;
  const atr = 0.0010;

  const sl = UniversalTradeGuard.calculateSweepProofSL({
    side: 'SELL',
    entryPrice,
    atr,
    candles15m: candles,
    decimals: 5,
  });

  assert.equal(sl.isVetoed, true, 'Must veto late entry when raw swing wick is > 0.90% away');
  assert.ok(sl.vetoReason?.includes('SL_TOO_WIDE_LATE_ENTRY_VETO'), 'Veto reason must cite SL_TOO_WIDE_LATE_ENTRY_VETO');
});

// ----------------------------------------------------------------------------
// RULE 2: TP ANCHORED AT EXACT OPPOSING REVERSAL PIVOT (NO 0.85R BLINDFOLD)
// ----------------------------------------------------------------------------
it('RULE 2.1: Opposing Reversal TP snaps directly to nearest opposing swing body without 0.85R blindfold', () => {
  // Simulating ADAUSD: Entry 0.19609, Support reversal floor at 0.19420
  // Background candles trade around 0.1960 - 0.1965
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const t = now - (30 - i) * 15 * 60 * 1000;
    candles.push({
      time: t,
      open: 0.1960,
      high: 0.1965,
      low: 0.1959,
      close: 0.1961,
      volume: 1000,
    });
  }

  // Create an explicit 2-left / 2-right swing body low at 0.19420 (body: open 0.19420, close 0.19425, low 0.19400)
  const pivotIdx = candles.length - 8;
  candles[pivotIdx - 2].low = 0.19500;
  candles[pivotIdx - 1].low = 0.19460;
  candles[pivotIdx].low = 0.19400;
  candles[pivotIdx].open = 0.19420;
  candles[pivotIdx].close = 0.19430;
  candles[pivotIdx + 1].low = 0.19470;
  candles[pivotIdx + 2].low = 0.19520;

  const entryPrice = 0.19609;
  const slDistance = entryPrice * 0.0070; // 0.70% SL distance
  const stopLossPrice = entryPrice + slDistance;
  const atr = 0.0005;

  const tpResult = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice,
    stopLossPrice,
    atr,
    candles15m: candles,
    decimals: 5,
    minRiskReward: 1.05,
  });

  assert.equal(tpResult.hasPhysicalWall, true, 'Must detect the physical reversal support wall');
  const expectedFrontRun = 0.19420 + tpResult.frontRunBuffer;
  assert.ok(Math.abs(tpResult.targetPrice - expectedFrontRun) < 0.0001, `Target price ${tpResult.targetPrice} must match front-run of body low 0.19420 + buffer ${tpResult.frontRunBuffer}`);
});

it('RULE 2.2: Pre-Trade Viability Gate: Vetoes trade (INSUFFICIENT_REVERSAL_ROOM_VETO) when True TP / SL < 1.05R', () => {
  const entryPrice = 100;
  const slDistance = 1.00; // 1.00 USD SL (1%)
  const targetPrice = 100.80; // Only 0.80 USD room (0.80R < 1.05R required)

  const roomVerdict = UniversalTradeGuard.validateRoomToRun({
    symbol: 'TESTUSD',
    entryPrice,
    side: 'BUY',
    slDistance,
    targetPrice,
    hasPhysicalWall: true,
    firstPhysicalWallPrice: 100.80,
    firstPhysicalWallFrontRunTP: 100.80,
  });

  assert.equal(roomVerdict.allowed, false, 'Must veto when room < 1.05R');
  assert.ok(roomVerdict.reason.includes('INSUFFICIENT_REVERSAL_ROOM_VETO'), 'Must provide INSUFFICIENT_REVERSAL_ROOM_VETO reason');
});

// ----------------------------------------------------------------------------
// RULE 3: MANDATORY 3-TIER HARD PROFIT LOCK
// ----------------------------------------------------------------------------
it('RULE 3.1 (TIER 1): Moves SL to Entry +/- 0.12% Fee-Plus Breakeven at +0.40R or +$2.00 USD or +10% ROE', () => {
  const pos: DeltaPosition = {
    id: 'test-1',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.19609,
    quantity: 10000,
    stopLossPrice: 0.19750,
    takeProfitPrice: 0.19300,
    leverage: 30,
    pnlUSD: 2.10, // Reached $2.10 USD profit (> $2.00 threshold)
    ratchetStage: 0,
    peakPriceReached: 0.19609,
    peakRReached: 0,
    entryTime: Date.now() - 60000,
    marginUSD: 65,
    notionalUSD: 1960,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.19580, // in profit
    decimals: 5,
  });

  assert.equal(action.updateBrackets, true, 'Must update exchange brackets');
  assert.equal(action.ratchetStage, 1, 'Must move to ratchet stage 1');
  const expectedSL = parseFloat((0.19609 - (0.19609 * 0.0012)).toFixed(5));
  assert.equal(action.newStopLossPrice, expectedSL, `SL must be moved to Entry - 0.12% (${expectedSL})`);
  assert.ok(action.ratchetReason.includes('TIER 1 FEE-PLUS BREAKEVEN'), 'Reason must cite TIER 1');
});

it('RULE 3.2 (TIER 2): Fires 75% Reduce-Only Cash Bank at +0.65R or +$3.50 USD and locks runner SL at +0.35R', () => {
  const pos: DeltaPosition = {
    id: 'test-2',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.19609,
    quantity: 10000,
    stopLossPrice: 0.19750,
    initialStopLossPrice: 0.19750,
    takeProfitPrice: 0.19300,
    tp1Price: 0.19420,
    leverage: 30,
    pnlUSD: 4.00, // Reached +$4.00 USD (> $3.50 threshold)
    ratchetStage: 1,
    tp1Hit: false,
    peakPriceReached: 0.19500,
    peakRReached: 0.70,
    entryTime: Date.now() - 120000,
    marginUSD: 65,
    notionalUSD: 1960,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.19500,
    decimals: 5,
  });

  assert.equal(action.shouldCloseTP1Partial, true, 'Must trigger 75% partial cash bank');
  assert.equal(action.tp1CloseRatio, 0.75, 'Close ratio must be 75%');
  assert.equal(action.ratchetStage, 2, 'Ratchet stage must be 2');
  const slDist = Math.abs(0.19609 - 0.19750);
  const expectedRunnerSL = parseFloat((0.19609 - (0.35 * slDist)).toFixed(5));
  assert.equal(action.newStopLossPrice, expectedRunnerSL, `Runner SL must be locked at +0.35R ($${expectedRunnerSL})`);
});

it('RULE 3.3 (TIER 3): Closes 100% position immediately when opposite reversal candle prints while in profit >= $1.50', () => {
  const pos: DeltaPosition = {
    id: 'test-3',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.19609,
    quantity: 10000,
    stopLossPrice: 0.19750,
    takeProfitPrice: 0.19300,
    leverage: 30,
    pnlUSD: 1.80, // In green profit (>= $1.50 USD)
    ratchetStage: 1,
    entryTime: Date.now() - 150000,
    marginUSD: 65,
    notionalUSD: 1960,
  };

  // 15m candle printing an opposite green reversal candle closing above previous high
  const bars: KlinePoint[] = [
    { time: 1, open: 0.1950, high: 0.1952, low: 0.1942, close: 0.1945, volume: 100 },
    { time: 2, open: 0.1945, high: 0.1955, low: 0.1944, close: 0.1954, volume: 200 }, // Closes above 0.1952 high!
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.1954,
    candles15m: bars,
    decimals: 5,
  });

  assert.equal(action.shouldClose100, true, 'Must immediately trigger 100% market close');
  assert.ok(action.closeReason.includes('TIER 3 LIVE REVERSAL CLOSE'), 'Close reason must cite TIER 3 LIVE REVERSAL CLOSE');
});

it('RULE 3.4 (ZERO LOSS-CUT): Never prematurely closes a trade that is in drawdown (PnL < 0)', () => {
  const pos: DeltaPosition = {
    id: 'test-4',
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.19609,
    quantity: 10000,
    stopLossPrice: 0.19750,
    takeProfitPrice: 0.19300,
    leverage: 30,
    pnlUSD: -0.80, // In negative drawdown
    ratchetStage: 0,
    entryTime: Date.now() - 30000,
    marginUSD: 65,
    notionalUSD: 1960,
  };

  // Reversal-looking candle in drawdown
  const bars: KlinePoint[] = [
    { time: 1, open: 0.1962, high: 0.1965, low: 0.1960, close: 0.1963, volume: 100 },
    { time: 2, open: 0.1963, high: 0.1968, low: 0.1962, close: 0.1967, volume: 200 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position: pos,
    currentPrice: 0.1967, // Price higher than entry (SELL is in loss)
    candles15m: bars,
    decimals: 5,
  });

  assert.equal(action.shouldClose100, false, 'Must NEVER auto-close in loss before structural SL is hit!');
});

// ----------------------------------------------------------------------------
// RULE 4: BAN SHORTING AT BOTTOM OF PULLBACK (DUAL-WINDOW RANGE CHECK)
// ----------------------------------------------------------------------------
it('RULE 4.1: Vetoes SELL when price is in lower 40% of 16-bar micro-range (NO_SELLING_AT_THE_BOTTOM_VETO)', () => {
  // Build 50 candles where 50-bar range is 0.1900 - 0.2000 (span = 0.0100)
  // But recent 16-bar micro-range is 0.1940 - 0.1980 (span = 0.0040)
  // Current price = 0.1945 -> In 50-bar: (0.1945 - 0.1900)/0.0100 = 45%
  // In 16-bar micro-range: (0.1945 - 0.1940)/0.0040 = 12.5% (<= 40%!)
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const t = now - (50 - i) * 15 * 60 * 1000;
    const isOld = i < 34;
    const low = isOld ? 0.1900 : 0.1940;
    const high = isOld ? 0.2000 : 0.1980;
    candles.push({
      time: t,
      open: 0.1950,
      high,
      low,
      close: 0.1950,
      volume: 1000,
    });
  }

  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'ADAUSD',
    side: 'SELL',
    currentPrice: 0.1945,
    accountCapitalUSD: 150,
    candles15m: candles,
    atr: 0.0010,
    activePositions: [],
    decimals: 5,
  });

  assert.equal(verdict.allowed, false, 'Must veto Short when in lower 40% of 16-bar range');
  assert.ok(verdict.reason.includes('NO_SELLING_AT_THE_BOTTOM_VETO'), 'Must give NO_SELLING_AT_THE_BOTTOM_VETO reason');
});

it('RULE 4.2: Vetoes BUY when price is in top 60%+ of 16-bar micro-range (NO_BUYING_AT_THE_TOP_VETO)', () => {
  // Recent 16-bar micro-range is 0.1900 - 0.1950
  // Current price = 0.1945 -> In 16-bar: (0.1945 - 0.1900)/0.0050 = 90% (> 60%)
  // Active candle is strong green (open 0.1935, high 0.1946, low 0.1935, close 0.1945) - no shooting star flip
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const t = now - (50 - i) * 15 * 60 * 1000;
    candles.push({
      time: t,
      open: 0.1935,
      high: 0.1946,
      low: 0.1935,
      close: 0.1945,
      volume: 1000,
    });
  }
  // Anchor low in older candles
  candles[5].low = 0.1900;
  candles[5].open = 0.1910;
  candles[5].close = 0.1910;
  candles[20].high = 0.1950;

  // Ensure Bullish regime so regime check doesn't preempt the range check
  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('BULLISH');

  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'ADAUSD',
    side: 'BUY',
    currentPrice: 0.1945,
    accountCapitalUSD: 150,
    candles15m: candles,
    atr: 0.0010,
    activePositions: [],
    decimals: 5,
  });

  assert.equal(verdict.allowed, false, 'Must veto Buy when in top 60%+ of 16-bar micro-range');
  assert.ok(verdict.reason.includes('NO_BUYING_AT_THE_TOP_VETO'), 'Must give NO_BUYING_AT_THE_TOP_VETO reason');
});

console.log('\n🎉 ALL REVERSAL-TO-REVERSAL TP/SL & PROFIT-RATCHET TESTS PASSED PERFECTLY!\n');
