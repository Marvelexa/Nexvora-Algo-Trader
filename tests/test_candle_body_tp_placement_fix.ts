import { KlinePoint, DeltaPosition } from '../src/types';
import { CandleStructureTPCalculator } from '../lib/risk/candleStructureProfitProtectionEngine';
import { UniversalTradeGuard, ALLOWED_CRYPTO_SYMBOLS } from '../lib/risk/universalTradeGuard';

console.log('========================================================================');
console.log('🧪 TEST SUITE: CANDLE-BODY TP PLACEMENT & WHITELIST VERIFICATION');
console.log('========================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
    throw new Error(`Assertion failed: ${testName}`);
  }
}

// ----------------------------------------------------------------------------
// TEST 1: USOONUSD EXACT SIMULATION (Entry 147.90, Freak Wick 145.75, Real Support 146.75)
// ----------------------------------------------------------------------------
console.log('▶ [TEST 1] Simulating Short Entry 147.90 with Freak Wick 145.75 and Real Body Support 146.75...');

// Create 20 candles representing the 15m chart:
// - 4+ candle bodies bottom out at 146.75 - 147.00
// - Candle 10 has a freak needle wick down to 145.75, but its body is at 147.20 - 147.50
const simulated15mCandles: KlinePoint[] = [];
const baseTime = Date.now() - (20 * 15 * 60 * 1000);

for (let i = 0; i < 20; i++) {
  const time = baseTime + (i * 15 * 60 * 1000);
  if (i === 10) {
    // FREAK NEEDLE WICK CANDLE: Low = 145.75, but body is 147.10 - 147.50!
    simulated15mCandles.push({
      time,
      open: 147.50,
      high: 147.80,
      low: 145.75, // Freak needle spike
      close: 147.10,
      volume: 1500,
    });
  } else if (i === 12 || i === 13 || i === 14 || i === 15) {
    // 4 CANDLE BODIES FORMING TRUE SUPPORT FLOOR AT 146.75 - 147.00
    simulated15mCandles.push({
      time,
      open: 147.40,
      high: 147.60,
      low: 146.70, // minor wick
      close: 146.75, // Candle body bottom at 146.75
      volume: 2000,
    });
  } else {
    // Normal oscillation around 147.50 - 148.50
    simulated15mCandles.push({
      time,
      open: 147.80,
      high: 148.20,
      low: 147.30,
      close: 147.90,
      volume: 1000,
    });
  }
}

const entryPrice = 147.90;
const stopLossPrice = 149.00;
const atr = 1.00; // ATR is $1.00 -> 0.10 * ATR buffer is $0.10

// Test CandleStructureTPCalculator directly
const structuralResult = CandleStructureTPCalculator.calculateCandleStructureTP({
  symbol: 'BTCUSD',
  side: 'SELL',
  entryPrice,
  stopLossPrice,
  atr,
  candles15m: simulated15mCandles,
  decimals: 2,
  tickSize: 0.05,
});

console.log(`  📊 Structural TP Result:`, {
  targetPrice: structuralResult.targetPrice,
  rawLevel: structuralResult.zoneLevel,
  description: structuralResult.description,
});

// ASSERTIONS:
// 1. Raw support level must be anchored at the candle body cluster (146.75), NOT at the freak wick (145.75)!
assert(
  structuralResult.zoneLevel >= 146.70 && structuralResult.zoneLevel <= 147.00,
  'Support zone raw level is anchored strictly at Candle Body Support (146.75)',
  `Actual rawLevel: ${structuralResult.zoneLevel}`
);

// 2. TP must be placed at rawLevel + 0.10 * ATR buffer = ~146.85
assert(
  structuralResult.targetPrice >= 146.80 && structuralResult.targetPrice <= 146.90,
  'TP is front-run inside the body zone at ~146.85 (above 146.75 support body)',
  `Actual targetPrice: ${structuralResult.targetPrice}`
);

// 3. TP must NEVER be placed at or below the freak needle wick (145.75)
assert(
  structuralResult.targetPrice > 146.50 && structuralResult.targetPrice !== 145.75,
  'TP is NEVER placed at or near the 145.75 freak needle wick tip',
  `Actual targetPrice: ${structuralResult.targetPrice}`
);

// Test UniversalTradeGuard.calculateUniversalStructuralTP
const universalTpResult = UniversalTradeGuard.calculateUniversalStructuralTP({
  symbol: 'BTCUSD',
  side: 'SELL',
  entryPrice,
  stopLossPrice,
  atr,
  candles15m: simulated15mCandles,
  decimals: 2,
  tickSize: 0.05,
  low50: 145.75, // Even if low50 is passed as 145.75
});

assert(
  universalTpResult.targetPrice >= 146.80 && universalTpResult.targetPrice <= 146.90,
  'UniversalTradeGuard keeps TP at the real candle body support (146.85) without stretching to 145.75',
  `Actual targetPrice: ${universalTpResult.targetPrice}`
);

assert(
  universalTpResult.targetPrice !== 145.75,
  'UniversalTradeGuard NEVER stretches TP past the real support body floor to 145.75',
  `Actual targetPrice: ${universalTpResult.targetPrice}`
);

// ----------------------------------------------------------------------------
// TEST 2: STRICT SYMBOL WHITELIST CHECK (FIX 4)
// ----------------------------------------------------------------------------
console.log('\n▶ [TEST 2] Verifying Strict Whitelist (USOONUSD Blocked, BTC/ETH/SOL Allowed)...');

// 1. USOONUSD must be strictly rejected
const usoonVerdict = UniversalTradeGuard.evaluatePreTradeGate({
  symbol: 'USOONUSD',
  side: 'SELL',
  currentPrice: 147.90,
  accountCapitalUSD: 100,
  candles15m: simulated15mCandles,
  atr: 1.00,
  activePositions: [],
});

assert(
  usoonVerdict.allowed === false,
  'USOONUSD is strictly rejected by UniversalTradeGuard',
  `Allowed: ${usoonVerdict.allowed}, Reason: ${usoonVerdict.reason}`
);

assert(
  usoonVerdict.reason.includes('SYMBOL_NOT_WHITELISTED_VETO'),
  'USOONUSD rejection reason is SYMBOL_NOT_WHITELISTED_VETO',
  `Actual reason: ${usoonVerdict.reason}`
);

// 2. Whitelist contains exact 10 symbols
assert(
  ALLOWED_CRYPTO_SYMBOLS.has('BTCUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('ETHUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('SOLUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('XRPUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('DOGEUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('ADAUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('BNBUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('LINKUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('AVAXUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.has('SUIUSD') &&
  ALLOWED_CRYPTO_SYMBOLS.size === 10,
  'ALLOWED_CRYPTO_SYMBOLS contains exactly the 10 major liquid crypto perpetual symbols'
);

// ----------------------------------------------------------------------------
// TEST 3: AUTO-PROTECT PROFIT LOCK (FIX 3)
// ----------------------------------------------------------------------------
console.log('\n▶ [TEST 3] Verifying Auto-Protect Profit Lock (>= 80% to TP or >= +18% ROE)...');

const mockShortPos: DeltaPosition = {
  id: 'test-short-pos',
  symbol: 'BTCUSD',
  side: 'SELL',
  entryPrice: 147.90,
  currentPrice: 146.60, // 147.90 -> 146.60 (Target was 146.85, so 1.30 move out of 1.05 = >100% of target move)
  takeProfitPrice: 146.85,
  stopLossPrice: 149.00,
  quantity: 10,
  marginUSD: 50,
  notionalUSD: 1479,
  pnlUSD: 13.00, // +$13 profit (+26% ROE)
  leverage: 30,
  atr: 1.00,
};

// Candle with bullish hammer/bounce at support:
const bounce1mCandles: KlinePoint[] = [
  {
    time: Date.now() - 60000,
    open: 146.80,
    high: 146.90,
    low: 146.45, // lower wick: 146.65 - 146.45 = 0.20 out of 0.45 (44%+)
    close: 146.85,
    volume: 500,
  },
  {
    time: Date.now(),
    open: 146.70,
    high: 147.05,
    low: 146.60,
    close: 147.00, // strong green bounce candle
    volume: 800,
  }
];

const autoProtectAction = UniversalTradeGuard.evaluateLiveProfitLock({
  position: mockShortPos,
  currentPrice: 146.70,
  candles1m: bounce1mCandles,
  atr: 1.00,
  decimals: 2,
});

assert(
  autoProtectAction.updateBrackets === true || autoProtectAction.shouldClose100 === true,
  'Auto-Protect triggered when trade reached >= 80% of TP distance with bounce at support',
  `updateBrackets: ${autoProtectAction.updateBrackets}, shouldClose100: ${autoProtectAction.shouldClose100}`
);

if (autoProtectAction.updateBrackets) {
  // If locking SL at +50% profit: 147.90 - (0.50 * (147.90 - 146.85)) = ~147.37
  assert(
    autoProtectAction.newStopLossPrice < 147.90,
    'Auto-protect SL is locked securely into profit (below entry 147.90 for Short)',
    `newStopLossPrice: ${autoProtectAction.newStopLossPrice}`
  );
  assert(
    autoProtectAction.newStopLossPrice <= 147.45,
    'Auto-protect SL locks at least +50% of peak profit ($147.35-$147.40)',
    `newStopLossPrice: ${autoProtectAction.newStopLossPrice}`
  );
}

// Check that tiny +3% ROE move does NOT trigger any SL modification
const tinyGainPos: DeltaPosition = {
  ...mockShortPos,
  currentPrice: 147.75, // only $0.15 gain (14% of TP distance)
  pnlUSD: 1.50, // +3% ROE
};

const tinyGainAction = UniversalTradeGuard.evaluateLiveProfitLock({
  position: tinyGainPos,
  currentPrice: 147.75,
  candles1m: bounce1mCandles,
  atr: 1.00,
  decimals: 2,
});

assert(
  tinyGainAction.updateBrackets === false && tinyGainAction.shouldClose100 === false,
  'Tiny profit moves (+3% ROE) do NOT touch Stop Loss, preserving full breathing room',
  `updateBrackets: ${tinyGainAction.updateBrackets}, shouldClose100: ${tinyGainAction.shouldClose100}`
);

// ----------------------------------------------------------------------------
// TEST 4: BAN ARTIFICIAL TP EXPANSION (FIX 2)
// ----------------------------------------------------------------------------
console.log('\n▶ [TEST 4] Verifying Real Candle-Body Wall Retention (No Artificial Stretching)...');

// Verify checkRoomToRun allows 1.00R when at real support wall
const roomToRunVerdict = CandleStructureTPCalculator.checkRoomToRun({
  entryPrice: 147.90,
  side: 'SELL',
  stopLossPrice: 148.95, // $1.05 SL dist
  atr: 1.00,
  candles15m: simulated15mCandles,
});

assert(
  roomToRunVerdict.allowed === true,
  'Room-to-Run is APPROVED at real candle-body support (1.00R)',
  `Allowed: ${roomToRunVerdict.allowed}, Reason: ${roomToRunVerdict.reason}`
);

console.log('\n========================================================================');
console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
console.log('========================================================================\n');
