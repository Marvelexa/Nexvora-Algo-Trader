import assert from 'assert';
import { PortfolioMarketRegimeEngine, portfolioMarketRegime, MarketRegimeBiasState } from '../lib/risk/portfolioMarketRegimeEngine';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { CandleStructureTPCalculator } from '../lib/risk/candleStructureProfitProtectionEngine';
import { KlinePoint } from '../src/types';

console.log('🧪 Starting 3 Critical Architectural Loopholes & Realignment Fixes Tests...\n');

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

function makeSyntheticCandles(count: number, basePrice: number): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    candles.push({
      time: now - (count - i) * 60000 * 15,
      open: basePrice,
      high: basePrice + 0.5,
      low: basePrice - 0.5,
      close: basePrice,
      volume: 1000,
    });
  }
  return candles;
}

// ============================================================================
// FIX 1: ACCURATE TP REALIGNMENT & SL RATIO PRESERVATION
// ============================================================================
console.log('--- FIX 1: Accurate TP Realignment & Post-Fill SL Integrity ---');

it('Short TP must NEVER be pushed below Reversal_Level + 0.10 * ATR', () => {
  // Reversal level at $0.07427 for DOGEUSD Short at $0.07456
  // ATR = 0.0008, 0.10 * ATR = 0.00008
  // Expected TP floor >= 0.07427 + 0.00008 = 0.07435
  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'DOGEUSD',
    side: 'SELL',
    entryPrice: 0.07456,
    stopLossPrice: 0.075455, // SL distance ~ 0.000895 (1.20%)
    takeProfitPrice: 0.073531, // Initially placed below reversal level
    reversalLevel: 0.07427,
    atr: 0.0008,
    isPostFill: true,
    decimals: 6,
  });

  const frontRunFloor = 0.07427 + (0.10 * 0.0008);
  assert.ok(
    result.takeProfitPrice >= frontRunFloor - 0.000001,
    `Short TP ($${result.takeProfitPrice}) must front-run reversal level ($${frontRunFloor}) and never push past it`
  );
  assert.strictEqual(result.valid, true);
});

it('Long TP must NEVER be pushed above Reversal_Level - 0.10 * ATR', () => {
  // Reversal level at $105.0 for Long at $100.0
  // ATR = 2.0, 0.10 * ATR = 0.20
  // Expected TP ceiling <= 105.0 - 0.20 = 104.8
  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'SOLUSD',
    side: 'BUY',
    entryPrice: 100.0,
    stopLossPrice: 99.0, // SL dist = 1.0 (1.0%)
    takeProfitPrice: 106.0, // Erroneously beyond reversal level
    reversalLevel: 105.0,
    atr: 2.0,
    isPostFill: true,
    decimals: 2,
  });

  const frontRunCeiling = 105.0 - (0.10 * 2.0);
  assert.ok(
    result.takeProfitPrice <= frontRunCeiling + 0.01,
    `Long TP ($${result.takeProfitPrice}) must front-run reversal level ($${frontRunCeiling}) and never push past it`
  );
  assert.strictEqual(result.valid, true);
});

it('Pre-Trade Veto: If Reversal Level is too close to allow 1.15R, VETO PRE-TRADE', () => {
  // Entry: 100, SL: 101 (SL dist = 1.0)
  // Required 1.15R TP: 98.85
  // But support reversal barrier is at 99.50 (Front-run floor = 99.50 + 0.1 = 99.60)
  // Trade cannot get 1.15R without breaching the reversal wall!
  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'ETHUSD',
    side: 'SELL',
    entryPrice: 100.0,
    stopLossPrice: 101.0,
    takeProfitPrice: 99.60,
    reversalLevel: 99.50,
    atr: 1.0,
    isPostFill: false, // Pre-trade check!
    decimals: 2,
  });

  assert.strictEqual(result.valid, false, 'Trade must be blocked pre-trade');
  assert.ok(result.reason.includes('ROOM-TO-RUN VETO'), `Reason must specify ROOM-TO-RUN VETO: ${result.reason}`);
});

it('Post-Fill SL Integrity: SL distance is NEVER widened after position sizing', () => {
  // Entry: 0.18679, Initial Sized SL: 0.1879 (SL dist: 0.00111 = 0.594%)
  // Attempting to widen SL to 0.18937 post-fill must be strictly clamped back to initial SL!
  const result = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
    symbol: 'ADAUSD',
    side: 'SELL',
    entryPrice: 0.18679,
    stopLossPrice: 0.18937, // Widened SL attempted
    initialStopLossPrice: 0.1879, // Original structural SL that determined contract size
    takeProfitPrice: 0.1850,
    isPostFill: true,
    decimals: 5,
  });

  assert.strictEqual(result.valid, true);
  assert.ok(
    result.stopLossPrice <= 0.187901,
    `Post-fill SL ($${result.stopLossPrice}) must not widen beyond initial SL ($0.1879)`
  );
  assert.ok(
    result.slDistance <= (0.1879 - 0.18679) + 0.00001,
    `Post-fill SL distance ($${result.slDistance}) must not exceed initial SL distance`
  );
});

// ============================================================================
// FIX 2: TWO-WAY (BUY & SELL) VIDEO RULES & RESISTANCE/SUPPORT ALIGNMENT
// User Mandate: Stop the all-time buy bias! Port 3010, 3008, and 3005 must be
// permitted to Short at Range Tops / Premium Resistance and Long at Discount Support!
// ============================================================================
console.log('\n--- FIX 2: Two-Way Trading & Premium/Discount Alignment (Ports 3005, 3008, 3010) ---');

const bullishState: MarketRegimeBiasState = {
  bias: 'BULLISH',
  timestamp: Date.now(),
  btcPrice: 77500,
  btcVwap15m: 77000,
  btcEma9: 77300,
  btcEma21: 76800,
  btcStructure15m: 'BULLISH',
  btcStructure1h: 'BULLISH',
  btcAdx14: 24,
  breadthPctAboveVwap: 0.80, // Bullish Breadth
  activeBtcPositionSide: null,
  reasons: ['BTC Bullish Confluence'],
};

const bearishState: MarketRegimeBiasState = {
  bias: 'BEARISH',
  timestamp: Date.now(),
  btcPrice: 72000,
  btcVwap15m: 73000,
  btcEma9: 72200,
  btcEma21: 72800,
  btcStructure15m: 'BEARISH',
  btcStructure1h: 'BEARISH',
  btcAdx14: 24,
  breadthPctAboveVwap: 0.15,
  activeBtcPositionSide: null,
  reasons: ['BTC Bearish Confluence'],
};

it('BULLISH REGIME: Port 3010 is ALLOWED to short altcoins at Range High Resistance', () => {
  const check = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'DOGEUSD',
    side: 'SELL',
    currentPrice: 0.07562, // Range Top
    vwap15m: 0.0740,
    isPort3010: true, // Port 3010 range trade
    rangePosition: 0.85, // 85% Premium
    biasState: bullishState,
  });

  assert.strictEqual(check.allowed, true, 'Port 3010 must be allowed to short at Range High even in Bullish regime');
  assert.ok(check.reason.includes('REVERSAL APPROVED'), `Approved reason: ${check.reason}`);
});

it('BULLISH REGIME: Altcoins at Premium Resistance (>= 70%) are ALLOWED to short', () => {
  const check = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'SOLUSD',
    side: 'SELL',
    currentPrice: 94.63, // Top resistance
    vwap15m: 93.50,
    rangePosition: 0.82, // 82% Premium
    biasState: bullishState,
  });

  assert.strictEqual(check.allowed, true, 'Altcoin at Premium resistance must be allowed to short');
  assert.ok(check.reason.includes('BULLISH REGIME EXCEPTION APPROVED'), `Approved reason: ${check.reason}`);
});

it('BEARISH REGIME: Port 3010 is ALLOWED to long altcoins at Range Low Support', () => {
  const check = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'XRPUSD',
    side: 'BUY',
    currentPrice: 1.20, // Range Low
    vwap15m: 1.24,
    isPort3010: true,
    rangePosition: 0.15, // 15% Discount
    biasState: bearishState,
  });

  assert.strictEqual(check.allowed, true, 'Port 3010 must be allowed to long at Range Low even in Bearish regime');
  assert.ok(check.reason.includes('REVERSAL APPROVED'), `Approved reason: ${check.reason}`);
});

it('BEARISH REGIME: Altcoins at Discount Support (<= 30%) are ALLOWED to long', () => {
  const check = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'ADAUSD',
    side: 'BUY',
    currentPrice: 0.185, // Deep Discount
    vwap15m: 0.190,
    rangePosition: 0.20, // 20% Discount
    biasState: bearishState,
  });

  assert.strictEqual(check.allowed, true, 'Altcoin at Discount Support must be allowed to long');
  assert.ok(check.reason.includes('BEARISH REGIME EXCEPTION APPROVED'), `Approved reason: ${check.reason}`);
});

it('NEUTRAL REGIME: Port 3010 range fading is permitted at boundaries', () => {
  const check = portfolioMarketRegime.isTradeAllowedByRegime({
    symbol: 'ETHUSD',
    side: 'SELL',
    currentPrice: 2350,
    vwap15m: 2320,
    isPort3010: true,
    rangePosition: 0.80,
    biasState: {
      ...bullishState,
      bias: 'NEUTRAL',
      btcAdx14: 15,
      breadthPctAboveVwap: 0.50,
    },
  });

  assert.strictEqual(check.allowed, true, 'Port 3010 range trade permitted in Neutral regime');
  assert.ok(check.reason.includes('NEUTRAL REGIME APPROVED'), `Approved reason: ${check.reason}`);
});

// ============================================================================
// FIX 3: CANDLE COLOR ADAPTIVE HARD PRE-DISPATCH VETO
// ============================================================================
console.log('\n--- FIX 3: Candle Color Adaptive Hard Pre-Dispatch Veto ---');

it('Active GREEN candle with small upper wick (< 50%) strictly blocks Short dispatch', () => {
  const candles = makeSyntheticCandles(20, 100);
  // Active bar: Open 100, High 101, Low 99.9, Close 100.8 (Green pump)
  // Span = 1.1, upper wick = 101 - 100.8 = 0.2 (18.1% < 50%)
  candles[candles.length - 1] = {
    time: Date.now(),
    open: 100.0,
    high: 101.0,
    low: 99.9,
    close: 100.8,
    volume: 1500,
  };

  const check = UniversalTradeGuard.validateRejectionAndVelocityBrake({
    symbol: 'DOGEUSD',
    side: 'SELL',
    candles15m: candles,
    atr: 1.0,
  });

  assert.strictEqual(check.allowed, false, 'Must veto selling on active green candle');
  assert.ok(check.reason.includes('CANDLE COLOR'), `Expected CANDLE COLOR in reason: ${check.reason}`);
});

it('Active RED candle with small lower wick (< 50%) strictly blocks Long dispatch', () => {
  const candles = makeSyntheticCandles(20, 100);
  // Active bar: Open 100, High 100.1, Low 99.0, Close 99.2 (Red dump)
  // Span = 1.1, lower wick = 99.2 - 99.0 = 0.2 (18.1% < 50%)
  candles[candles.length - 1] = {
    time: Date.now(),
    open: 100.0,
    high: 100.1,
    low: 99.0,
    close: 99.2,
    volume: 1500,
  };

  const check = UniversalTradeGuard.validateRejectionAndVelocityBrake({
    symbol: 'ADAUSD',
    side: 'BUY',
    candles15m: candles,
    atr: 1.0,
  });

  assert.strictEqual(check.allowed, false, 'Must veto buying on active red candle');
  assert.ok(check.reason.includes('CANDLE COLOR'), `Expected CANDLE COLOR in reason: ${check.reason}`);
});

it('Confirmed Bearish Rejection wick (>= 50%) on active bar ALLOWS Short dispatch', () => {
  const candles = makeSyntheticCandles(20, 100);
  // Active bar: Open 100, High 102.0, Low 99.8, Close 100.4
  // Span = 2.2, upper wick = 102.0 - 100.4 = 1.6 (72.7% >= 50%)
  candles[candles.length - 1] = {
    time: Date.now(),
    open: 100.0,
    high: 102.0,
    low: 99.8,
    close: 100.4,
    volume: 1500,
  };

  const check = UniversalTradeGuard.validateRejectionAndVelocityBrake({
    symbol: 'DOGEUSD',
    side: 'SELL',
    candles15m: candles,
    atr: 1.5,
  });

  assert.strictEqual(check.allowed, true, 'Must allow Short on confirmed rejection pinbar wick >= 50%');
});

it('Confirmed Bullish Rejection wick (>= 50%) on active bar ALLOWS Long dispatch', () => {
  const candles = makeSyntheticCandles(20, 100);
  // Active bar: Open 100, High 100.2, Low 98.0, Close 99.6
  // Span = 2.2, lower wick = 99.6 - 98.0 = 1.6 (72.7% >= 50%)
  candles[candles.length - 1] = {
    time: Date.now(),
    open: 100.0,
    high: 100.2,
    low: 98.0,
    close: 99.6,
    volume: 1500,
  };

  const check = UniversalTradeGuard.validateRejectionAndVelocityBrake({
    symbol: 'ADAUSD',
    side: 'BUY',
    candles15m: candles,
    atr: 1.5,
  });

  assert.strictEqual(check.allowed, true, 'Must allow Long on confirmed hammer rejection wick >= 50%');
});

// ============================================================================
// FIX 4: 25% CAPITAL SIZING PER TRADE SLOT
// ============================================================================
console.log('\n--- FIX 4: 25% Capital Margin Sizing Deployment ---');

it('Deploys 25% of account capital as margin per trade slot', () => {
  const accountCapitalUSD = 165.47;
  const entryPrice = 1.28;
  const slDistance = 0.010; // ~0.78% SL distance
  const leverage = 30;
  const maxMarginUSD = accountCapitalUSD * 0.25; // $41.3675

  const sizing = UniversalTradeGuard.calculatePositionSize({
    accountCapitalUSD,
    entryPrice,
    slDistance,
    leverage,
    maxMarginUSD,
  });

  // Margin must be ~25% of capital ($41.37)
  assert.ok(
    Math.abs(sizing.marginUSD - 41.37) < 0.5,
    `Expected margin ~$41.37 (25% of $165.47), got $${sizing.marginUSD}`
  );
  assert.ok(
    sizing.notionalUSD >= 1200 && sizing.notionalUSD <= 1300,
    `Expected notional ~$1241 @ 30x, got $${sizing.notionalUSD}`
  );
});

// ============================================================================
// FIX 5: PHYSICAL WALL DISCOVERY & REAL-WALL ROOM-TO-RUN VETO
// ============================================================================
console.log('\n--- FIX 5: Physical Wall Discovery & Real-Wall Room-To-Run Veto ---');

it('NEVER discards real Swing High at 0.19116 to invent 0.19408, and strictly VETOES entry via REAL_WALL_ROOM_TO_RUN_VETO', () => {
  const count = 30;
  const entryPrice = 0.19063;
  const slPrice = 0.18778; // SL distance = 0.00285 (1.50%)
  const atr = 0.00114;
  const candles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    candles.push({
      time: now - (count - i) * 60000 * 15,
      open: 0.19000,
      high: 0.19030,
      low: 0.18970,
      close: 0.19000,
      volume: 1000,
    });
  }

  // Place a prominent Swing High at index 25 (closed bar)
  candles[25] = {
    time: Date.now() - 5 * 15 * 60000,
    open: 0.19080,
    high: 0.19150,
    low: 0.19020,
    close: 0.19116, // Swing High Body
    volume: 50000,
  };
  candles[24] = {
    time: Date.now() - 6 * 15 * 60000,
    open: 0.19000,
    high: 0.19050,
    low: 0.18950,
    close: 0.19040,
    volume: 20000,
  };
  candles[26] = {
    time: Date.now() - 4 * 15 * 60000,
    open: 0.19110,
    high: 0.19120,
    low: 0.19010,
    close: 0.19040,
    volume: 30000,
  };

  const target = CandleStructureTPCalculator.calculateCandleStructureTP({
    symbol: 'ADAUSD',
    side: 'BUY',
    entryPrice,
    stopLossPrice: slPrice,
    atr,
    candles15m: candles,
    tickSize: 0.00001,
    decimals: 5,
    minRiskReward: 1.15,
  });

  assert.strictEqual(target.hasPhysicalWall, true, 'Must identify physical wall');
  assert.ok(target.firstPhysicalWallPrice <= 0.19120 && target.firstPhysicalWallPrice >= 0.19110, `Physical wall must be ~0.19116, got ${target.firstPhysicalWallPrice}`);
  assert.ok(target.targetPrice < 0.19200, `Target price must be front-run wall (< 0.19200), NEVER 0.19408! Got ${target.targetPrice}`);
  assert.ok(target.targetPrice !== 0.19408, 'Must NEVER invent 0.19408 empty-air fallback!');
  assert.ok(target.structuralRR < 1.0, `Structural RR must be realistic (< 1.0), got ${target.structuralRR}`);

  const roomCheck = UniversalTradeGuard.validateRoomToRun({
    symbol: 'ADAUSD',
    entryPrice,
    side: 'BUY',
    slDistance: entryPrice - slPrice,
    targetPrice: target.targetPrice,
    firstPhysicalWallPrice: target.firstPhysicalWallPrice,
    firstPhysicalWallFrontRunTP: target.firstPhysicalWallFrontRunTP,
    hasPhysicalWall: target.hasPhysicalWall,
    structuralRR: target.structuralRR,
  });

  assert.strictEqual(roomCheck.allowed, false, 'Must strictly VETO entry because overhead wall sits too close');
  assert.ok(roomCheck.reason.includes('REAL_WALL_ROOM_TO_RUN_VETO'), `Reason must cite REAL_WALL_ROOM_TO_RUN_VETO, got: ${roomCheck.reason}`);
});

it('2-Stage TP1 (75% Wall Bank) triggers when price reaches physical wall', () => {
  const position: any = {
    symbol: 'ADAUSD',
    side: 'BUY',
    entryPrice: 0.19063,
    stopLossPrice: 0.18778,
    initialStopLossPrice: 0.18778,
    atr: 0.00114,
    quantity: 4026,
    tp1Price: 0.19100,
    tp2Price: 0.19500,
    tp1Hit: false,
    pnlUSD: 2.50,
  };

  const action = UniversalTradeGuard.evaluateLiveProfitLock({
    position,
    currentPrice: 0.19110,
    atr: 0.00114,
    decimals: 5,
  });

  assert.strictEqual(action.shouldCloseTP1Partial, true, 'Must trigger 75% partial close at TP1');
  assert.strictEqual(action.tp1CloseRatio, 0.75, 'Must close exactly 75%');
  assert.ok(action.newStopLossPrice >= position.entryPrice, 'SL must move to Breakeven+Fee');
  assert.strictEqual(action.newTakeProfitPrice, 0.19500, 'Remaining 25% runner must target TP2');
});

console.log('\n========================================');
console.log(`Summary: ${passCount} PASSED, ${failCount} FAILED`);
console.log('========================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL 3 ARCHITECTURAL LOOPHOLE & REALIGNMENT TESTS PASSED WITH 100% COMPLIANCE!');
}
