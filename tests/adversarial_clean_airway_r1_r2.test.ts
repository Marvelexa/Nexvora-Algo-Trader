import assert from 'node:assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { CandleStructureTPCalculator } from '../lib/risk/candleStructureProfitProtectionEngine';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';
import { KlinePoint } from '../src/types';

console.log('🧪 Starting Adversarial Empirical Stress Suite for R1 and R2...');

let passCount = 0;
let totalTests = 0;

function runCheck(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
    passCount++;
  } catch (err: any) {
    console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
    console.error(err);
    throw err;
  }
}

// Helper to construct synthetic base candle series
function createFlatCandles(count: number, basePrice: number): KlinePoint[] {
  const baseTime = 1700000000000;
  const candles: KlinePoint[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      time: baseTime + i * 900000,
      open: basePrice,
      high: basePrice + 0.05,
      low: basePrice - 0.05,
      close: basePrice,
      volume: 1000,
    });
  }
  return candles;
}

// ============================================================================
// SUITE 1: EXACT R:R BOUNDARY ADVERSARIAL STRESS (1.349R vs 1.350R vs 1.351R)
// ============================================================================
console.log('\n--- SUITE 1: Exact R:R Boundary Tests (Rule A) ---');

// 1.1: 1.349R must veto with WALL_TOO_CLOSE_BAD_RR_VETO in validateCleanAirwayGate
runCheck('Rule A: 1.349R boundary must veto with WALL_TOO_CLOSE_BAD_RR_VETO', () => {
  const entryPrice = 1000.0;
  const slDistance = 5.0; // 0.50% SL (valid <= 0.55%)
  // 1.349 * 5.0 = 6.745
  const safeTpDistance = 6.745; // tpRatio = 6.745 / 1000 = 0.6745% (valid >= 0.65%)
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 3,
  });

  assert.strictEqual(res.allowed, false, '1.349R must be vetoed');
  assert.strictEqual(res.reasonCode, 'WALL_TOO_CLOSE_BAD_RR_VETO');
  assert(res.reason.includes('WALL_TOO_CLOSE_BAD_RR_VETO'), `Expected WALL_TOO_CLOSE_BAD_RR_VETO in reason, got: ${res.reason}`);
  assert.strictEqual(res.actualRR, 1.35, 'Actual RR rounded to 2 decimals is 1.35 but raw safeTpDistance < 1.35 * slDistance');
});

// 1.2: 1.350R boundary must pass Rule A without veto
runCheck('Rule A: Exactly 1.350R boundary must pass Clean Airway Gate', () => {
  const entryPrice = 1000.0;
  const slDistance = 5.0; // 0.50% SL (<= 0.55%)
  // Exactly 1.350 * 5.0 = 6.75
  const safeTpDistance = 6.75; // tpRatio = 6.75 / 1000 = 0.675% (>= 0.65%)
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 3,
  });

  assert.strictEqual(res.allowed, true, '1.350R must be allowed');
  assert.strictEqual(res.reasonCode, 'CLEAN_AIRWAY_APPROVED');
  assert.strictEqual(res.actualRR, 1.35);
});

// 1.3: 1.351R boundary must pass Clean Airway Gate
runCheck('Rule A: 1.351R boundary must pass Clean Airway Gate', () => {
  const entryPrice = 1000.0;
  const slDistance = 5.0;
  // 1.351 * 5.0 = 6.755
  const safeTpDistance = 6.755;
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'BTCUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 3,
  });

  assert.strictEqual(res.allowed, true, '1.351R must be allowed');
  assert.strictEqual(res.reasonCode, 'CLEAN_AIRWAY_APPROVED');
  assert.strictEqual(res.actualRR, 1.35);
});

// 1.4: validateRoomToRun at 1.349R vs 1.350R
runCheck('validateRoomToRun: 1.349R vetoes, 1.350R passes', () => {
  const entryPrice = 1000.0;
  const slDistance = 5.0; // requiredRoom = 5.0 * 1.35 = 6.75

  // 1.349R room (availableRoom = 6.745 < 6.75):
  const roomVeto = UniversalTradeGuard.validateRoomToRun({
    symbol: 'ETHUSD',
    entryPrice,
    side: 'BUY',
    slDistance,
    targetPrice: 1006.745,
    firstPhysicalWallPrice: 1007.945,
    firstPhysicalWallFrontRunTP: 1006.745,
    hasPhysicalWall: true,
  });
  assert.strictEqual(roomVeto.allowed, false, 'Available room 1.349R < 1.35R must veto');
  assert(roomVeto.reason.includes('WALL_TOO_CLOSE_BAD_RR_VETO'));

  // 1.350R room (availableRoom = 6.750 >= 6.75):
  const roomPass = UniversalTradeGuard.validateRoomToRun({
    symbol: 'ETHUSD',
    entryPrice,
    side: 'BUY',
    slDistance,
    targetPrice: 1006.750,
    firstPhysicalWallPrice: 1007.950,
    firstPhysicalWallFrontRunTP: 1006.750,
    hasPhysicalWall: true,
  });
  assert.strictEqual(roomPass.allowed, true, 'Available room 1.350R >= 1.35R must pass');
  assert(roomPass.reason.includes('ROOM-TO-RUN APPROVED'));
});

// 1.5: PortfolioMarketRegimeEngine pre-trade check at 1.349R vs 1.350R
runCheck('PortfolioMarketRegimeEngine: 1.349R vetoes, 1.350R passes pre-entry', () => {
  const entryPrice = 1000.0;
  const slPrice = 995.0; // clampedSLDist = 5.0, required = 6.75

  // 1.349R (tpDistance = 6.745, actualRR = 1.349):
  const regimeVeto = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'ETHUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: slPrice,
    takeProfitPrice: 1006.745,
    reversalLevel: 1007.945,
    isPostFill: false,
    atr: 10.0,
  });
  assert.strictEqual(regimeVeto.valid, false, '1.349R in regime engine must be invalid pre-entry');
  assert(regimeVeto.reason?.includes('WALL_TOO_CLOSE_BAD_RR_VETO'));

  // 1.350R (tpDistance = 6.750, actualRR = 1.350):
  const regimePass = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'ETHUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: slPrice,
    takeProfitPrice: 1006.750,
    reversalLevel: 1007.950,
    isPostFill: false,
    atr: 10.0,
  });
  assert.strictEqual(regimePass.valid, true, '1.350R in regime engine must be valid pre-entry');
});

// ============================================================================
// SUITE 2: PROFIT POCKET BOUNDARY ADVERSARIAL STRESS (0.00649 vs 0.00650 vs 0.00651)
// ============================================================================
console.log('\n--- SUITE 2: Profit Pocket Boundary Tests (Rule B) ---');

// 2.1: Exactly 0.00649 profit pocket must veto with PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO
runCheck('Rule B: 0.00649 profit pocket must veto with PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO', () => {
  const entryPrice = 1000.0;
  const slDistance = 2.0; // 0.20% SL (<= 0.55%, passes Rule C)
  // safeTpDistance / 1000.0 = 0.00649 -> 6.49 USD
  const safeTpDistance = 6.49;
  // RR = 6.49 / 2.0 = 3.245 >= 1.35 (passes Rule A)
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'SOLUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 2,
  });

  assert.strictEqual(res.allowed, false, '0.00649 profit pocket must be vetoed');
  assert.strictEqual(res.reasonCode, 'PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO');
  assert(res.reason.includes('PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO'), `Expected PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO, got: ${res.reason}`);
});

// 2.2: Exactly 0.00650 profit pocket must pass Rule B
runCheck('Rule B: Exactly 0.00650 profit pocket must pass Clean Airway Gate', () => {
  const entryPrice = 1000.0;
  const slDistance = 2.0;
  // safeTpDistance / 1000.0 = 0.00650 -> 6.50 USD
  const safeTpDistance = 6.50;
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'SOLUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 2,
  });

  assert.strictEqual(res.allowed, true, '0.00650 profit pocket must be allowed');
  assert.strictEqual(res.reasonCode, 'CLEAN_AIRWAY_APPROVED');
});

// 2.3: 0.00651 profit pocket must pass Clean Airway Gate
runCheck('Rule B: 0.00651 profit pocket must pass Clean Airway Gate', () => {
  const entryPrice = 1000.0;
  const slDistance = 2.0;
  const safeTpDistance = 6.51;
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'SOLUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 2,
  });

  assert.strictEqual(res.allowed, true, '0.00651 profit pocket must be allowed');
  assert.strictEqual(res.reasonCode, 'CLEAN_AIRWAY_APPROVED');
});

// ============================================================================
// SUITE 3: LATE ENTRY SL BOUNDARY ADVERSARIAL STRESS (0.00551 vs 0.00550 vs 0.00549)
// ============================================================================
console.log('\n--- SUITE 3: Late Entry SL Boundary Tests (Rule C) ---');

// 3.1: Exactly 0.00551 SL ratio must veto with LATE_ENTRY_WIDE_SL_VETO
runCheck('Rule C: 0.00551 SL ratio must veto with LATE_ENTRY_WIDE_SL_VETO', () => {
  const entryPrice = 1000.0;
  // slDistance / 1000.0 = 0.00551 -> 5.51 USD
  const slDistance = 5.51;
  // safeTpDistance = 10.0 (tpRatio = 1.0% >= 0.65%, RR = 10.0 / 5.51 = 1.815 >= 1.35)
  const safeTpDistance = 10.0;
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'AVAXUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 2,
  });

  assert.strictEqual(res.allowed, false, '0.00551 SL ratio must be vetoed');
  assert.strictEqual(res.reasonCode, 'LATE_ENTRY_WIDE_SL_VETO');
  assert(res.reason.includes('LATE_ENTRY_WIDE_SL_VETO'), `Expected LATE_ENTRY_WIDE_SL_VETO, got: ${res.reason}`);
});

// 3.2: Exactly 0.00550 SL ratio must pass Rule C
runCheck('Rule C: Exactly 0.00550 SL ratio must pass Clean Airway Gate', () => {
  const entryPrice = 1000.0;
  // slDistance / 1000.0 = 0.00550 -> 5.50 USD
  const slDistance = 5.50;
  const safeTpDistance = 10.0;
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'AVAXUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 2,
  });

  assert.strictEqual(res.allowed, true, '0.00550 SL ratio must be allowed');
  assert.strictEqual(res.reasonCode, 'CLEAN_AIRWAY_APPROVED');
});

// 3.3: 0.00549 SL ratio must pass Clean Airway Gate
runCheck('Rule C: 0.00549 SL ratio must pass Clean Airway Gate', () => {
  const entryPrice = 1000.0;
  const slDistance = 5.49;
  const safeTpDistance = 10.0;
  const firstWallTP = entryPrice + safeTpDistance;

  const res = UniversalTradeGuard.validateCleanAirwayGate({
    symbol: 'AVAXUSD',
    entryPrice,
    slDistance,
    safeTpDistance,
    firstPhysicalWallFrontRunTP: firstWallTP,
    decimals: 2,
  });

  assert.strictEqual(res.allowed, true, '0.00549 SL ratio must be allowed');
  assert.strictEqual(res.reasonCode, 'CLEAN_AIRWAY_APPROVED');
});

// ============================================================================
// SUITE 4: MULTI-WALL SETUP ADVERSARIAL STRESS (BUY & SELL)
// Prove TP1 anchors strictly at the first wall and never skips to subsequent walls
// ============================================================================
console.log('\n--- SUITE 4: Multi-Wall Setup (No Skipping Walls) ---');

// 4.1: BUY multi-wall setup with 3 opposing reversal walls at 101.00, 102.50, and 104.00
runCheck('R1 Multi-Wall BUY: TP1 anchors at nearest wall (101.00) with 0.12*ATR buffer, never skips to 102.50 or 104.00', () => {
  const baseTime = 1700000000000;
  const candles = createFlatCandles(35, 100.0);
  const atr = 1.0;
  const entryPrice = 100.0;
  const slPrice = 99.50; // SL distance = 0.50

  // Wall 1: at index 28, 3-bar swing body high at 101.00 (distance = 1.00 >= 0.30*ATR)
  candles[27] = { time: baseTime + 27 * 900000, open: 100.2, high: 100.5, low: 100.1, close: 100.4, volume: 1000 };
  candles[28] = { time: baseTime + 28 * 900000, open: 100.5, high: 101.2, low: 100.4, close: 101.0, volume: 1500 };
  candles[29] = { time: baseTime + 29 * 900000, open: 100.8, high: 100.9, low: 100.4, close: 100.6, volume: 1000 };
  candles[30] = { time: baseTime + 30 * 900000, open: 100.5, high: 100.7, low: 100.3, close: 100.5, volume: 1000 };
  candles[31] = { time: baseTime + 31 * 900000, open: 100.4, high: 100.5, low: 100.1, close: 100.2, volume: 1000 };

  // Wall 2: at index 18, 3-bar swing body high at 102.50 (distance = 2.50)
  candles[17] = { time: baseTime + 17 * 900000, open: 101.5, high: 101.9, low: 101.2, close: 101.8, volume: 1000 };
  candles[18] = { time: baseTime + 18 * 900000, open: 102.0, high: 102.8, low: 101.8, close: 102.5, volume: 1800 };
  candles[19] = { time: baseTime + 19 * 900000, open: 102.2, high: 102.3, low: 101.7, close: 102.0, volume: 1000 };
  candles[20] = { time: baseTime + 20 * 900000, open: 101.8, high: 102.1, low: 101.5, close: 101.9, volume: 1000 };

  // Wall 3: at index 8, 3-bar swing body high at 104.00 (distance = 4.00)
  candles[7] = { time: baseTime + 7 * 900000, open: 103.0, high: 103.5, low: 102.8, close: 103.3, volume: 1000 };
  candles[8] = { time: baseTime + 8 * 900000, open: 103.5, high: 104.5, low: 103.0, close: 104.0, volume: 2200 };
  candles[9] = { time: baseTime + 9 * 900000, open: 103.7, high: 103.8, low: 103.2, close: 103.4, volume: 1000 };
  candles[10] = { time: baseTime + 10 * 900000, open: 103.2, high: 103.5, low: 102.8, close: 103.0, volume: 1000 };

  const target = CandleStructureTPCalculator.calculateCandleStructureTP({
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

  // Expected frontRunBuffer = 0.12 * 1.0 = 0.12
  // Wall 1 raw level = 101.00 -> Front-run TP = 101.00 - 0.12 = 100.88
  // Wall 2 raw level = 102.50 -> Front-run TP = 102.50 - 0.12 = 102.38
  // Wall 3 raw level = 104.00 -> Front-run TP = 104.00 - 0.12 = 103.88
  assert.strictEqual(target.hasPhysicalWall, true, 'Must identify physical wall');
  assert.strictEqual(target.firstPhysicalWallPrice, 101.00, 'firstPhysicalWallPrice must be Wall 1 ($101.00)');
  assert.strictEqual(target.firstPhysicalWallFrontRunTP, 100.88, 'TP1 must be $100.88');
  assert.strictEqual(target.targetPrice, 100.88, 'Target price must equal TP1 ($100.88)');
  assert.strictEqual(target.tp1Price, 100.88, 'tp1Price must equal $100.88');

  // PROVE NO SKIPPING: Must NOT target Wall 2 ($102.38) or Wall 3 ($103.88) as TP1
  assert.notStrictEqual(target.targetPrice, 102.38, 'Must not skip Wall 1 to target Wall 2 ($102.38)');
  assert.notStrictEqual(target.targetPrice, 103.88, 'Must not skip Wall 1 to target Wall 3 ($103.88)');
  assert.notStrictEqual(target.firstPhysicalWallFrontRunTP, 102.38, 'TP1 must not skip to Wall 2');
  assert.notStrictEqual(target.firstPhysicalWallFrontRunTP, 103.88, 'TP1 must not skip to Wall 3');
  assert.ok(target.targetPrice < 101.50, 'Target price must remain strictly anchored at first wall');
});

// 4.2: SELL multi-wall setup with 3 opposing reversal walls below market at 99.00, 97.50, and 95.50
runCheck('R1 Multi-Wall SELL: TP1 anchors at nearest wall (99.00) with 0.12*ATR buffer, never skips to 97.50 or 95.50', () => {
  const baseTime = 1700000000000;
  const candles = createFlatCandles(35, 100.0);
  const atr = 1.0;
  const entryPrice = 100.0;
  const slPrice = 100.50; // SL distance = 0.50

  // Wall 1: at index 28, 3-bar swing body low at 99.00 (distance = 1.00 >= 0.30*ATR)
  candles[27] = { time: baseTime + 27 * 900000, open: 99.8, high: 99.9, low: 99.5, close: 99.6, volume: 1000 };
  candles[28] = { time: baseTime + 28 * 900000, open: 99.5, high: 99.6, low: 98.8, close: 99.0, volume: 1500 };
  candles[29] = { time: baseTime + 29 * 900000, open: 99.2, high: 99.5, low: 99.1, close: 99.4, volume: 1000 };
  candles[30] = { time: baseTime + 30 * 900000, open: 99.4, high: 99.6, low: 99.2, close: 99.5, volume: 1000 };
  candles[31] = { time: baseTime + 31 * 900000, open: 99.5, high: 99.7, low: 99.4, close: 99.6, volume: 1000 };

  // Wall 2: at index 18, 3-bar swing body low at 97.50 (distance = 2.50)
  candles[17] = { time: baseTime + 17 * 900000, open: 98.3, high: 98.5, low: 98.0, close: 98.2, volume: 1000 };
  candles[18] = { time: baseTime + 18 * 900000, open: 98.0, high: 98.2, low: 97.2, close: 97.5, volume: 1800 };
  candles[19] = { time: baseTime + 19 * 900000, open: 97.8, high: 98.2, low: 97.7, close: 98.0, volume: 1000 };
  candles[20] = { time: baseTime + 20 * 900000, open: 98.0, high: 98.4, low: 97.8, close: 98.1, volume: 1000 };

  // Wall 3: at index 8, 3-bar swing body low at 95.50 (distance = 4.50)
  candles[7] = { time: baseTime + 7 * 900000, open: 96.3, high: 96.5, low: 96.0, close: 96.2, volume: 1000 };
  candles[8] = { time: baseTime + 8 * 900000, open: 96.0, high: 96.3, low: 95.0, close: 95.5, volume: 2200 };
  candles[9] = { time: baseTime + 9 * 900000, open: 95.8, high: 96.2, low: 95.7, close: 96.0, volume: 1000 };
  candles[10] = { time: baseTime + 10 * 900000, open: 96.0, high: 96.5, low: 95.8, close: 96.2, volume: 1000 };

  const target = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candles,
    tickSize: 0.01,
    decimals: 2,
    minRiskReward: 1.35,
    frontRunBufferMultiplier: 0.12,
  });

  // Expected frontRunBuffer = 0.12 * 1.0 = 0.12
  // Wall 1 raw level = 99.00 -> Front-run TP = 99.00 + 0.12 = 99.12
  // Wall 2 raw level = 97.50 -> Front-run TP = 97.50 + 0.12 = 97.62
  // Wall 3 raw level = 95.50 -> Front-run TP = 95.50 + 0.12 = 95.62
  assert.strictEqual(target.hasPhysicalWall, true, 'Must identify physical wall');
  assert.strictEqual(target.firstPhysicalWallPrice, 99.00, 'firstPhysicalWallPrice must be Wall 1 ($99.00)');
  assert.strictEqual(target.firstPhysicalWallFrontRunTP, 99.12, 'TP1 must be $99.12');
  assert.strictEqual(target.targetPrice, 99.12, 'Target price must equal TP1 ($99.12)');
  assert.strictEqual(target.tp1Price, 99.12, 'tp1Price must equal $99.12');

  // PROVE NO SKIPPING: Must NOT target Wall 2 ($97.62) or Wall 3 ($95.62) as TP1
  assert.notStrictEqual(target.targetPrice, 97.62, 'Must not skip Wall 1 to target Wall 2 ($97.62)');
  assert.notStrictEqual(target.targetPrice, 95.62, 'Must not skip Wall 1 to target Wall 3 ($95.62)');
  assert.notStrictEqual(target.firstPhysicalWallFrontRunTP, 97.62, 'TP1 must not skip to Wall 2');
  assert.notStrictEqual(target.firstPhysicalWallFrontRunTP, 95.62, 'TP1 must not skip to Wall 3');
  assert.ok(target.targetPrice > 98.50, 'Target price must remain strictly anchored at first wall');
});

// ============================================================================
// SUITE 5: MICRO-NOISE FILTER ADVERSARIAL STRESS (< 0.30*ATR vs >= 0.30*ATR)
// ============================================================================
console.log('\n--- SUITE 5: Micro-Noise Filter Tests (< 0.30*ATR vs >= 0.30*ATR) ---');

// 5.1: Barrier closer than 0.30*ATR is ignored as micro-noise (BUY side)
runCheck('R1 Micro-noise BUY: Barrier at 100.25 (< 0.30*ATR with ATR=1.0) is ignored; Wall at 101.00 anchors TP1', () => {
  const baseTime = 1700000000000;
  const candles = createFlatCandles(35, 100.0);
  const atr = 1.0;
  const entryPrice = 100.0;
  const slPrice = 99.50;

  // Pivot A: micro-noise at index 30, body high = 100.25 (distance = 0.25 < 0.30*1.0)
  candles[29] = { time: baseTime + 29 * 900000, open: 100.0, high: 100.2, low: 99.9, close: 100.1, volume: 1000 };
  candles[30] = { time: baseTime + 30 * 900000, open: 100.1, high: 100.28, low: 100.0, close: 100.25, volume: 1000 };
  candles[31] = { time: baseTime + 31 * 900000, open: 100.2, high: 100.22, low: 99.95, close: 100.05, volume: 1000 };

  // Pivot B: real physical wall at index 15, body high = 101.00 (distance = 1.00 >= 0.30*1.0)
  candles[14] = { time: baseTime + 14 * 900000, open: 100.2, high: 100.5, low: 100.1, close: 100.4, volume: 1000 };
  candles[15] = { time: baseTime + 15 * 900000, open: 100.5, high: 101.2, low: 100.4, close: 101.0, volume: 1500 };
  candles[16] = { time: baseTime + 16 * 900000, open: 100.8, high: 100.9, low: 100.4, close: 100.6, volume: 1000 };
  candles[17] = { time: baseTime + 17 * 900000, open: 100.5, high: 100.7, low: 100.3, close: 100.5, volume: 1000 };

  const target = CandleStructureTPCalculator.calculateCandleStructureTP({
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

  // Micro-noise at 100.25 MUST be ignored
  assert.notStrictEqual(target.firstPhysicalWallPrice, 100.25, '100.25 must be ignored as micro-noise');
  // First valid physical wall must be 101.00
  assert.strictEqual(target.firstPhysicalWallPrice, 101.00, 'Real wall at 101.00 must be chosen');
  assert.strictEqual(target.firstPhysicalWallFrontRunTP, 100.88, 'TP1 must be 100.88 (101.00 - 0.12*1.0)');
});

// 5.2: Boundary check: Barrier at exactly 100.299 (< 0.30*ATR) vs 100.300 (>= 0.30*ATR)
runCheck('R1 Micro-noise BUY: 100.299 (< 0.30*ATR) ignored, 100.300 (>= 0.30*ATR) anchors with 0.12*ATR buffer', () => {
  const baseTime = 1700000000000;
  const atr = 1.0;
  const entryPrice = 100.0;
  const slPrice = 99.50;

  // Case 1: body high = 100.299 (distance = 0.299 < 0.30 * 1.0)
  const candlesNoise = createFlatCandles(35, 100.0);
  candlesNoise[29] = { time: baseTime + 29 * 900000, open: 100.0, high: 100.2, low: 99.9, close: 100.1, volume: 1000 };
  candlesNoise[30] = { time: baseTime + 30 * 900000, open: 100.1, high: 100.32, low: 100.0, close: 100.299, volume: 1000 };
  candlesNoise[31] = { time: baseTime + 31 * 900000, open: 100.2, high: 100.25, low: 99.9, close: 100.0, volume: 1000 };

  const targetNoise = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candlesNoise,
    tickSize: 0.001,
    decimals: 3,
    minRiskReward: 1.35,
    frontRunBufferMultiplier: 0.12,
  });

  // When only micro-noise exists, no valid physical wall should be detected
  assert.strictEqual(targetNoise.hasPhysicalWall, false, 'Barrier at 100.299 must be ignored as micro-noise');

  // Case 2: body high = 100.300 (distance = 0.300 >= 0.30 * 1.0)
  const candlesValid = createFlatCandles(35, 100.0);
  candlesValid[29] = { time: baseTime + 29 * 900000, open: 100.0, high: 100.2, low: 99.9, close: 100.1, volume: 1000 };
  candlesValid[30] = { time: baseTime + 30 * 900000, open: 100.1, high: 100.35, low: 100.0, close: 100.300, volume: 1000 };
  candlesValid[31] = { time: baseTime + 31 * 900000, open: 100.2, high: 100.25, low: 99.9, close: 100.0, volume: 1000 };

  const targetValid = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candlesValid,
    tickSize: 0.001,
    decimals: 3,
    minRiskReward: 1.35,
    frontRunBufferMultiplier: 0.12,
  });

  // Barrier at 100.300 must be acknowledged as a valid physical wall
  assert.strictEqual(targetValid.hasPhysicalWall, true, 'Barrier at 100.300 is >= 0.30*ATR and must be recognized');
  assert.strictEqual(targetValid.firstPhysicalWallPrice, 100.300, 'firstPhysicalWallPrice must be 100.300');
  // Front-run buffer: 0.12 * 1.0 = 0.12 -> 100.300 - 0.12 = 100.180
  assert.strictEqual(targetValid.firstPhysicalWallFrontRunTP, 100.180, 'Front run TP must be 100.180 (100.300 - 0.12*ATR)');
  assert.strictEqual(targetValid.targetPrice, 100.180);
});

// 5.3: SELL side micro-noise filter: 99.701 (< 0.30*ATR) ignored, 99.700 (>= 0.30*ATR) anchors with 0.12*ATR buffer
runCheck('R1 Micro-noise SELL: 99.701 (< 0.30*ATR) ignored, 99.700 (>= 0.30*ATR) anchors with 0.12*ATR buffer', () => {
  const baseTime = 1700000000000;
  const atr = 1.0;
  const entryPrice = 100.0;
  const slPrice = 100.50;

  // Case 1: body low = 99.701 (distance = 0.299 < 0.30 * 1.0)
  const candlesNoise = createFlatCandles(35, 100.0);
  candlesNoise[29] = { time: baseTime + 29 * 900000, open: 100.0, high: 100.1, low: 99.8, close: 99.9, volume: 1000 };
  candlesNoise[30] = { time: baseTime + 30 * 900000, open: 99.9, high: 100.0, low: 99.68, close: 99.701, volume: 1000 };
  candlesNoise[31] = { time: baseTime + 31 * 900000, open: 99.8, high: 100.1, low: 99.75, close: 100.0, volume: 1000 };

  const targetNoise = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candlesNoise,
    tickSize: 0.001,
    decimals: 3,
    minRiskReward: 1.35,
    frontRunBufferMultiplier: 0.12,
  });

  assert.strictEqual(targetNoise.hasPhysicalWall, false, 'Barrier at 99.701 must be ignored as micro-noise');

  // Case 2: body low = 99.700 (distance = 0.300 >= 0.30 * 1.0)
  const candlesValid = createFlatCandles(35, 100.0);
  candlesValid[29] = { time: baseTime + 29 * 900000, open: 100.0, high: 100.1, low: 99.8, close: 99.9, volume: 1000 };
  candlesValid[30] = { time: baseTime + 30 * 900000, open: 99.9, high: 100.0, low: 99.65, close: 99.700, volume: 1000 };
  candlesValid[31] = { time: baseTime + 31 * 900000, open: 99.8, high: 100.1, low: 99.75, close: 100.0, volume: 1000 };

  const targetValid = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'SOLUSD',
    side: 'SELL',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candlesValid,
    tickSize: 0.001,
    decimals: 3,
    minRiskReward: 1.35,
    frontRunBufferMultiplier: 0.12,
  });

  assert.strictEqual(targetValid.hasPhysicalWall, true, 'Barrier at 99.700 is >= 0.30*ATR and must be recognized');
  assert.strictEqual(targetValid.firstPhysicalWallPrice, 99.700);
  // Front-run buffer: 0.12 * 1.0 = 0.12 -> 99.700 + 0.12 = 99.820
  assert.strictEqual(targetValid.firstPhysicalWallFrontRunTP, 99.820, 'Front run TP must be 99.820 (99.700 + 0.12*ATR)');
  assert.strictEqual(targetValid.targetPrice, 99.820);
});

// ============================================================================
// SUITE 6: ADVERSARIAL PRE-TRADE GATE PIPELINE INTEGRATION (PORTS 3002 TO 3010)
// ============================================================================
console.log('\n--- SUITE 6: Pre-Trade Gate Integration across Ports ---');

// 6.1: evaluatePreTradeGate on Port 3005 with 1.349R setup must veto
runCheck('Integration Port 3005: 1.349R setup must be vetoed by evaluatePreTradeGate', () => {
  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('BEARISH');

  // Downtrend candles with entry at 99.0, premium area in BEARISH regime
  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < 60; i++) {
    const p = 100 - (i * 0.05);
    candles.push({
      time: baseTime + i * 900000,
      open: p,
      high: p + 0.10,
      low: p - 0.10,
      close: p - 0.02,
      volume: 1000,
    });
  }

  // Range extremes:
  candles[15] = { time: baseTime + 15 * 900000, open: 91.5, high: 92.2, low: 91.0, close: 92.0, volume: 1000 };
  candles[16] = { time: baseTime + 16 * 900000, open: 92.0, high: 96.5, low: 92.0, close: 96.0, volume: 1000 };
  candles[30] = { time: baseTime + 30 * 900000, open: 103.0, high: 103.5, low: 102.0, close: 102.5, volume: 1000 };

  // Opposing unmitigated swing low at 98.40 (distance = 0.60, Safe_TP_Distance = 0.42 after 0.18 buffer)
  candles[44] = { time: baseTime + 44 * 900000, open: 98.7, high: 98.9, low: 98.5, close: 98.6, volume: 1000 };
  candles[45] = { time: baseTime + 45 * 900000, open: 98.5, high: 98.6, low: 98.2, close: 98.4, volume: 2000 };
  candles[46] = { time: baseTime + 46 * 900000, open: 98.5, high: 99.1, low: 98.5, close: 98.9, volume: 1000 };

  // Rejection bar at premium 99.0
  candles[candles.length - 1] = {
    time: baseTime + 59 * 900000,
    open: 99.2,
    high: 99.4,
    low: 98.8,
    close: 99.0,
    volume: 1000,
  };

  const verdict = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 99.0,
    accountCapitalUSD: 1000,
    candles15m: candles,
    atr: 1.5,
    port: 3005,
    leverage: 20,
    maxMarginUSD: 100,
  });

  assert.strictEqual(verdict.allowed, false, 'Port 3005 must veto setup');
  assert(
    verdict.reason.includes('WALL_TOO_CLOSE_BAD_RR_VETO') ||
    verdict.reason.includes('LATE_ENTRY_WIDE_SL_VETO') ||
    verdict.reason.includes('INSUFFICIENT_REVERSAL_ROOM_VETO'),
    `Expected Clean Airway veto, got: ${verdict.reason}`
  );
});

// 6.2: Port 3001 must bypass Clean Airway Gate (Isolation Contract)
runCheck('Integration Port 3001: Must bypass Clean Airway Gate even if SL is wide', () => {
  PortfolioMarketRegimeEngine.getInstance().setImmediateRegimeFlip('BEARISH');

  const candles: KlinePoint[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < 60; i++) {
    const p = 100 - (i * 0.05);
    candles.push({
      time: baseTime + i * 900000,
      open: p,
      high: p + 0.10,
      low: p - 0.10,
      close: p - 0.02,
      volume: 1000,
    });
  }

  candles[15] = { time: baseTime + 15 * 900000, open: 91.5, high: 92.2, low: 91.0, close: 92.0, volume: 1000 };
  candles[16] = { time: baseTime + 16 * 900000, open: 92.0, high: 96.5, low: 92.0, close: 96.0, volume: 1000 };
  candles[30] = { time: baseTime + 30 * 900000, open: 103.0, high: 103.5, low: 102.0, close: 102.5, volume: 1000 };
  candles[44] = { time: baseTime + 44 * 900000, open: 98.7, high: 98.9, low: 98.5, close: 98.6, volume: 1000 };
  candles[45] = { time: baseTime + 45 * 900000, open: 98.5, high: 98.6, low: 98.2, close: 98.4, volume: 2000 };
  candles[46] = { time: baseTime + 46 * 900000, open: 98.5, high: 99.1, low: 98.5, close: 98.9, volume: 1000 };
  candles[candles.length - 1] = {
    time: baseTime + 59 * 900000,
    open: 99.2,
    high: 99.4,
    low: 98.8,
    close: 99.0,
    volume: 1000,
  };

  const verdict3001 = UniversalTradeGuard.evaluatePreTradeGate({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 99.0,
    accountCapitalUSD: 1000,
    candles15m: candles,
    atr: 1.5,
    port: 3001,
    leverage: 20,
    maxMarginUSD: 100,
  });

  // Verify port 3001 does NOT receive Clean Airway veto reasons:
  assert(!verdict3001.reason.includes('LATE_ENTRY_WIDE_SL_VETO'), 'Port 3001 must not trigger Clean Airway Rule C');
  assert(!verdict3001.reason.includes('PROFIT_POCKET_TOO_SMALL_FOR_FEES_VETO'), 'Port 3001 must not trigger Clean Airway Rule B');
});

console.log('\n========================================');
console.log(`🎉 ALL ${passCount}/${totalTests} ADVERSARIAL STRESS TESTS PASSED EMPIRICALLY!`);
console.log('========================================');
