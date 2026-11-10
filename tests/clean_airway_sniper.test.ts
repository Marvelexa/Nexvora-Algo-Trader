import assert from 'node:assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { CandleStructureTPCalculator } from '../lib/risk/candleStructureProfitProtectionEngine';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint, DeltaPosition } from '../src/types';

console.log('🧪 Starting Clean Airway Sniper Unit & Integration Tests (R1, R2, R3, R4)...');

// Helper to construct synthetic candles
function createMockCandles(count: number, basePrice: number, step: number = 0): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < count; i++) {
    const p = basePrice + (i * step);
    candles.push({
      time: baseTime + (i * 900000),
      open: p,
      high: p + 0.0010,
      low: p - 0.0010,
      close: p + 0.0002,
      volume: 1000,
    });
  }
  return candles;
}

let passCount = 0;

// ============================================================================
// TEST 1: R2 Rule A Veto - Poor R:R Veto on ADAUSD (+3.91 safe wall vs -4.12 SL)
// ============================================================================
{
  console.log('\n--- TEST 1: Rule A Veto (Poor R:R setup strictly vetoed without wall bypass) ---');
  const entryPrice = 0.5000;
  const slPrice = 0.49588;       // SL_Distance = 0.00412 ($4.12 per 1000 contracts)
  const firstWallTP = 0.50391;   // Safe_TP_Distance = 0.00391 ($3.91 per 1000 contracts)
  const slDistance = entryPrice - slPrice;
  const safeTpDistance = firstWallTP - entryPrice;

  // Rule A check: Safe_TP_Distance ($3.91) < 1.35 * SL_Distance ($5.56)
  const gateRes = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'ADAUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
  });

  assert.strictEqual(gateRes.allowed, false, 'Poor R:R setup must be strictly vetoed');
  assert.strictEqual(gateRes.reasonCode, 'WALL_TOO_CLOSE_BAD_RR_VETO');
  assert(gateRes.reason.includes('WALL_TOO_CLOSE_BAD_RR_VETO'), `Expected WALL_TOO_CLOSE_BAD_RR_VETO, got: ${gateRes.reason}`);
  assert.strictEqual(gateRes.actualRR, 0.95, 'Actual RR must be 0.95 (3.91 / 4.12)');
  console.log('✅ PASS: ADAUSD Poor R:R vetoed with WALL_TOO_CLOSE_BAD_RR_VETO (no wall bypass, RR 1:0.95 < 1:1.35)');
  passCount++;
}

// ============================================================================
// TEST 2: R2 Clean Setup Approval (-$3.20 SL vs +$6.00 Safe Wall Airway)
// ============================================================================
{
  console.log('\n--- TEST 2: Clean Setup Approval (-$3.20 SL vs +$6.00 Safe Wall Airway) ---');
  const entryPrice = 0.7000;
  const slDistance = 0.0032;     // $3.20 per 1000 qty (0.457% of entry <= 0.55%)
  const safeTpDistance = 0.0060; // $6.00 per 1000 qty (0.857% of entry >= 0.65%)
  const firstWallTP = entryPrice + safeTpDistance;

  const gateRes = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'ADAUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
  });

  assert.strictEqual(gateRes.allowed, true, 'Clean setup must be approved');
  assert.strictEqual(gateRes.reasonCode, 'CLEAN_AIRWAY_APPROVED');
  assert.strictEqual(gateRes.actualRR, 1.88, 'Expected R:R of 1.88 (6.00 / 3.20)');
  console.log('✅ PASS: Clean setup approved with R:R 1:1.88 >= 1:1.35 and 0.86% pocket >= 0.65%');
  passCount++;
}

// ============================================================================
// TEST 3: R2 Rule B Veto - Minimum Fee-Beating Profit Pocket (< 0.65%)
// ============================================================================
{
  console.log('\n--- TEST 3: Rule B Veto (Profit Pocket Too Small for Fees < 0.65%) ---');
  const entryPrice = 1.0000;
  const slDistance = 0.0020;     // 0.20% SL (tight)
  const safeTpDistance = 0.0040; // 0.40% TP (2.0 RR, but only 0.40% distance < 0.65% fee floor)
  const firstWallTP = entryPrice + safeTpDistance;

  const gateRes = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'ADAUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
  });

  assert.strictEqual(gateRes.allowed, false, 'Profit pocket < 0.65% must be vetoed');
  assert.strictEqual(gateRes.reasonCode, 'PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO');
  assert(gateRes.reason.includes('PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO'));
  console.log('✅ PASS: Safe wall at 0.40% vetoed with PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO');
  passCount++;
}

// ============================================================================
// TEST 4: R2 Rule C Veto - Tight Entry SL Exceeded (> 0.55%)
// ============================================================================
{
  console.log('\n--- TEST 4: Rule C Veto (Late Entry Wide SL > 0.55%) ---');
  const entryPrice = 1.0000;
  const slDistance = 0.0075;     // 0.75% SL (> 0.55% maximum tight SL)
  const safeTpDistance = 0.0150; // 1.50% TP (2.0 RR)
  const firstWallTP = entryPrice + safeTpDistance;

  const gateRes = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'ADAUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
  });

  assert.strictEqual(gateRes.allowed, false, 'Wide SL > 0.55% must be vetoed');
  assert.strictEqual(gateRes.reasonCode, 'LATE_ENTRY_WIDE_SL_VETO');
  assert(gateRes.reason.includes('LATE_ENTRY_WIDE_SL_VETO'));
  console.log('✅ PASS: Late entry with 0.75% SL vetoed with LATE_ENTRY_WIDE_SL_VETO');
  passCount++;
}

// ============================================================================
// TEST 5: R1 First Physical Wall Anchoring (0.12*ATR buffer, No Wall Skipping)
// ============================================================================
{
  console.log('\n--- TEST 5: R1 First Physical Wall Anchoring (No Wall Skipping) ---');
  const baseTime = 1700000000000;
  const candles: KlinePoint[] = [];
  for (let i = 0; i < 35; i++) {
    candles.push({
      time: baseTime + i * 900000,
      open: 100.0,
      high: 100.2,
      low: 99.8,
      close: 100.0,
      volume: 1000,
    });
  }

  // First opposing wall (unmitigated 3-bar swing body high) at index 25:
  // Body High = 101.00 (distance = 1.00 >= 0.30 * 1.0 = 0.30 ATR)
  candles[24] = { time: baseTime + 24 * 900000, open: 100.1, high: 100.4, low: 99.9, close: 100.3, volume: 1000 };
  candles[25] = { time: baseTime + 25 * 900000, open: 100.6, high: 101.2, low: 100.4, close: 101.0, volume: 1500 };
  candles[26] = { time: baseTime + 26 * 900000, open: 100.8, high: 100.9, low: 100.2, close: 100.4, volume: 1000 };

  // Second wall further away at index 10: Body High = 103.00
  candles[9]  = { time: baseTime + 9 * 900000, open: 101.0, high: 101.5, low: 100.8, close: 101.2, volume: 1000 };
  candles[10] = { time: baseTime + 10 * 900000, open: 102.5, high: 103.4, low: 102.0, close: 103.0, volume: 2000 };
  candles[11] = { time: baseTime + 11 * 900000, open: 102.8, high: 102.9, low: 101.5, close: 101.8, volume: 1000 };

  const atr = 1.0;
  const entryPrice = 100.0;
  const slPrice = 99.50; // SL distance = 0.50

  const tpTarget = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candles,
    tickSize: 0.01,
    decimals: 2,
    minRiskReward: 1.35,
    frontRunBufferMultiplier: 0.12,
  });

  // Expected front-run buffer: 0.12 * 1.0 = 0.12
  // Nearest physical wall is Order Block supply boundary at 100.60
  // Expected TP1: 100.60 - 0.12 = 100.48 (strictly anchoring at first wall, NOT jumping to 103.00!)
  assert.strictEqual(tpTarget.hasPhysicalWall, true, 'Must identify physical wall');
  assert.strictEqual(tpTarget.firstPhysicalWallPrice, 100.60, 'Must anchor at the first wall (100.60), not second wall (103.00)');
  assert.strictEqual(tpTarget.firstPhysicalWallFrontRunTP, 100.48, 'TP1 must be 100.48 (100.60 - 0.12*ATR buffer)');
  assert.strictEqual(tpTarget.targetPrice, 100.48, 'Target price must equal firstPhysicalWallFrontRunTP');
  assert.ok(tpTarget.targetPrice < 102.0, 'Must NEVER jump over the first wall to target the second wall');
  console.log(`✅ PASS: TP1 strictly anchored at first physical wall ($${tpTarget.targetPrice}) with 0.12*ATR buffer without skipping`);
  passCount++;
}

// ============================================================================
// TEST 6: R3 Mid-Way Reversal Shield (Tier 1 Fee Breakeven at +$2.00 / +0.25%)
// ============================================================================
{
  console.log('\n--- TEST 6: R3 Tier 1 Fee Breakeven Lock at +$2.00 / +0.25% Move ---');
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 99.50,
    initialStopLossPrice: 99.50,
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 102.0,
    tp1Price: 102.0,
    tp1Hit: false,
    pnlUSD: 2.60, // +$2.60 USD profit (0.26% move)
    ratchetStage: 0,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 100.26, // +0.26% move
    atr: 1.0,
    decimals: 2,
    tickSize: 0.01,
  });

  // Expected: Moves SL to entryPrice + 0.12% fee buffer = 100.12
  assert.strictEqual(action.updateBrackets, true, 'Must update brackets');
  assert.strictEqual(action.newStopLossPrice, 100.12, 'SL must move to Entry + 0.12% ($100.12)');
  assert.strictEqual(action.ratchetStage, 1, 'Ratchet stage must advance to 1');
  assert(action.ratchetReason.includes('TIER 1 FEE-PLUS BREAKEVEN'));
  console.log(`✅ PASS: Tier 1 Fee Breakeven locked SL at $${action.newStopLossPrice} at +0.26% move`);
  passCount++;
}

// ============================================================================
// TEST 7: R3 Mid-Way Reversal Shield (100% Exit on 5m Opposite Close at 65% TP1)
// ============================================================================
{
  console.log('\n--- TEST 7: R3 Mid-Way Reversal Shield: 100% Exit on Reversal at 65% TP1 ---');
  const position: DeltaPosition = {
    symbol: 'ADAUSD',
    side: 'BUY',
    entryPrice: 0.5000,
    stopLossPrice: 0.5006, // already at BE+fee
    initialStopLossPrice: 0.4968,
    atr: 0.0020,
    quantity: 10000,
    leverage: 30,
    takeProfitPrice: 0.5100, // TP1 distance = 0.0100
    tp1Price: 0.5100,
    tp1Hit: false,
    pnlUSD: 6.80, // Progress to TP1 = 0.0068 / 0.0100 = 68% (>= 65%)
    ratchetStage: 1,
  };

  // 5m candle prints an opposite color body close (red candle: close < open)
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 0.5060, high: 0.5070, low: 0.5055, close: 0.5068, volume: 5000 },
    { time: 2000, open: 0.5070, high: 0.5072, low: 0.5062, close: 0.5064, volume: 6000 }, // Red candle
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 0.5068, // 68% progress to TP1
    candles5m,
    atr: 0.0020,
    decimals: 4,
    tickSize: 0.0001,
  });

  assert.strictEqual(action.shouldClose100, true, 'Must trigger 100% market close on mid-way reversal');
  assert(action.closeReason.includes('MID-WAY REVERSAL SHIELD'), `Expected MID-WAY REVERSAL SHIELD, got: ${action.closeReason}`);
  console.log('✅ PASS: Mid-way opposite candle close triggered 100% market close at 68% progress to TP1');
  passCount++;
}

// ============================================================================
// TEST 8: R3 TP1 Wall Momentum Check (Normal Momentum Banks 75% at Wall)
// ============================================================================
{
  console.log('\n--- TEST 8: R3 TP1 Wall: Normal Momentum Banks 75% at Wall ---');
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.50,
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 101.50,
    tp1Price: 101.50,
    tp1Hit: false,
    pnlUSD: 15.0,
    ratchetStage: 1,
  };

  // Normal momentum candle (body = 0.40 < 1.2 * atr = 1.20)
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 101.0, high: 101.3, low: 100.9, close: 101.2, volume: 1000 },
    { time: 2000, open: 101.1, high: 101.55, low: 101.0, close: 101.50, volume: 1000 },
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 101.50, // Reached TP1 wall
    candles5m,
    atr: 1.0,
    decimals: 2,
    tickSize: 0.01,
  });

  assert.strictEqual(action.shouldCloseTP1Partial, true, 'Must execute 75% partial cash bank');
  assert.strictEqual(action.tp1CloseRatio, 0.75, 'Close ratio must be 75%');
  assert.ok(Math.abs(action.newStopLossPrice - 100.175) <= 0.01, `Runner SL must lock at +0.35R (~$100.18), got ${action.newStopLossPrice}`);
  assert(action.ratchetReason.includes('75% AT TP1 WALL'));
  console.log('✅ PASS: TP1 Wall with normal momentum executes 75% partial cash bank and locks runner SL at +0.35R');
  passCount++;
}

// ============================================================================
// TEST 9: R3 TP1 Wall Momentum Check (Explosive Breakout Holds Runner & Trails SL)
// ============================================================================
{
  console.log('\n--- TEST 9: R3 TP1 Wall: Explosive Breakout Holds Runner & Trails SL ---');
  const position: DeltaPosition = {
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 100.12,
    initialStopLossPrice: 99.50,
    atr: 1.0,
    quantity: 10,
    leverage: 30,
    takeProfitPrice: 101.50,
    tp1Price: 101.50,
    tp1Hit: false,
    pnlUSD: 16.0,
    ratchetStage: 1,
  };

  // Explosive breakout bar: body = 1.40 >= 1.2 * atr (1.20), volume = 3000 >= 1.3 * avg (1000)
  const candles5m: KlinePoint[] = [
    { time: 1000, open: 100.0, high: 100.5, low: 99.8, close: 100.2, volume: 1000 },
    { time: 2000, open: 100.2, high: 101.7, low: 100.1, close: 101.60, volume: 3000 }, // Body = 1.40
  ];

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 101.55, // Blasted past TP1
    candles5m,
    atr: 1.0,
    decimals: 2,
    tickSize: 0.01,
  });

  assert.strictEqual(action.shouldCloseTP1Partial, false, 'Must HOLD runner on explosive breakout');
  assert.strictEqual(action.tp1CloseRatio, 0, 'No partial close on explosive breakout');
  assert(action.newStopLossPrice >= 101.30, `SL must trail behind broken wall ($101.30), got ${action.newStopLossPrice}`);
  assert(action.ratchetReason.includes('EXPLOSIVE WALL BREAKOUT'));
  console.log(`✅ PASS: Explosive breakout held runner and trailed SL behind broken wall ($${action.newStopLossPrice})`);
  passCount++;
}

// ============================================================================
// TEST 10: Port 3001 Strict Isolation vs Ports 3002-3010 Clean Airway Gate
// ============================================================================
{
  console.log('\n--- TEST 10: Port 3001 Isolation vs Ports 3002-3010 Enforcement ---');
  // Gentle downtrend with entry at 99.0 (premium), BEARISH regime
  const candles = createMockCandles(60, 100, -0.05);
  // Below-market demand floor at index 15 (low = 90.0, establishes 50-bar range)
  candles[15] = { time: 1000 + 15 * 900, open: 91.5, high: 92.2, low: 90.0, close: 92.0, volume: 1000 };
  candles[16] = { time: 1000 + 16 * 900, open: 92.0, high: 96.5, low: 92.0, close: 96.0, volume: 1000 };

  // Overhead supply at 103 (high = 103.5)
  candles[30] = { time: 1000 + 30 * 900, open: 103.0, high: 103.5, low: 102.0, close: 102.5, volume: 1000 };
  candles[31] = { time: 1000 + 31 * 900, open: 102.0, high: 102.2, low: 98.5, close: 99.0, volume: 1000 };
  candles[32] = { time: 1000 + 32 * 900, open: 99.0, high: 99.1, low: 98.0, close: 98.0, volume: 1000 };

  // Opposing unmitigated 3-bar swing low support barrier at 98.40 (distance = 0.60)
  // Front-run TP = 98.40 + 0.18 = 98.58 (Safe_TP_Distance = 99.0 - 98.58 = 0.42)
  candles[44] = { time: 1000 + 44 * 900, open: 98.7, high: 98.9, low: 98.5, close: 98.6, volume: 1000 };
  candles[45] = { time: 1000 + 45 * 900, open: 98.5, high: 98.6, low: 98.2, close: 98.4, volume: 2000 };
  candles[46] = { time: 1000 + 46 * 900, open: 98.5, high: 99.1, low: 98.5, close: 98.9, volume: 1000 };

  // Rejection bar at premium 99.0 (high wick 99.4 -> SL = 99.55 -> SL_Distance = 0.55)
  // Safe_TP_Distance (0.42) < 1.35 * SL_Distance (0.7425) -> Rule A must veto on cluster ports!
  candles[candles.length - 1] = {
    time: 1000 + 59 * 900,
    open: 99.2,
    high: 99.4,
    low: 98.8,
    close: 99.0,
    volume: 1000,
  };

  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('BEARISH');

  // Calling with port: 3005 (Cluster port, Sniper mode slots 3 & 4 with activePositions >= 2) -> MUST VETO WITH Clean Airway Gate
  const verdictCluster = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 99.0,
    accountCapitalUSD: 193.0,
    candles15m: candles,
    atr: 1.5,
    activePositions: [{ id: 'pos1' } as any, { id: 'pos2' } as any],
    port: 3005, // Ports 3002-3010 enforce Clean Airway
  });

  assert.strictEqual(verdictCluster.allowed, false, 'Cluster port 3005 must enforce Clean Airway gate');
  assert(
    verdictCluster.reason.includes('LATE_ENTRY_WIDE_SL_VETO') || verdictCluster.reason.includes('WALL_TOO_CLOSE_BAD_RR_VETO'),
    `Expected Clean Airway veto on port 3005, got: ${verdictCluster.reason}`
  );
  console.log(`✅ PASS: Port 3005 strictly enforced Clean Airway gate (vetoed: ${verdictCluster.reason.split(':')[0]})`);

  // Calling with port: 3001 -> MUST REMAIN UNTOUCHED (Clean Airway gate bypassed for port 3001)
  const verdictPort3001 = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 99.0,
    accountCapitalUSD: 193.0,
    candles15m: candles,
    atr: 1.5,
    activePositions: [],
    port: 3001, // Port 3001 is completely untouched
  });

  // Verify port 3001 does NOT receive Clean Airway veto reasons:
  assert(!verdictPort3001.reason.includes('LATE_ENTRY_WIDE_SL_VETO'), 'Port 3001 must not trigger Clean Airway Rule C');
  assert(!verdictPort3001.reason.includes('PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO'), 'Port 3001 must not trigger Clean Airway Rule B');
  console.log('✅ PASS: Port 3001 is strictly bypassed and untouched by Clean Airway rules');
  passCount++;
}

console.log('\n========================================');
console.log(`🎉 ALL ${passCount}/${passCount} CLEAN AIRWAY SNIPER TESTS PASSED WITH 100% COMPLIANCE!`);
console.log('========================================\n');
