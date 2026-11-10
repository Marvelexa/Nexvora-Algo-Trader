import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  evaluateStrategyForPort, 
  KlinePoint 
} from '../lib/strategies/strategyRegistry';
import { 
  UniversalTradeGuard, 
  ALLOWED_CRYPTO_SYMBOLS, 
  ActivePositionInfo 
} from '../lib/risk/universalTradeGuard';

// Helper to generate synthetic 15m candles with realistic volatility (0.4% - 0.7% range)
function generateCandles(count: number, basePrice: number, trend: 'BULL' | 'BEAR' | 'SIDEWAYS'): KlinePoint[] {
  const candles: KlinePoint[] = [];
  const baseTime = Date.now() - count * 15 * 60 * 1000;
  let p = basePrice;
  const spread = basePrice * 0.0035;

  for (let i = 0; i < count; i++) {
    let delta = 0;
    if (trend === 'BULL') delta = (i % 3 === 0 ? -spread * 0.4 : spread * 0.8);
    else if (trend === 'BEAR') delta = (i % 3 === 0 ? spread * 0.4 : -spread * 0.8);
    else delta = (i % 2 === 0 ? spread * 0.5 : -spread * 0.5);

    p += delta;
    candles.push({
      time: baseTime + i * 15 * 60 * 1000,
      open: p - (delta > 0 ? spread * 0.3 : -spread * 0.3),
      high: p + spread * 0.5,
      low: p - spread * 0.5,
      close: p,
      volume: 500,
    });
  }
  return candles;
}

describe('Master YouTube Strategy & UniversalTradeGuard Integration Suite', () => {

  it('Part 1: Pure YouTube Video Strategies evaluate on closed candles', () => {
    const candles = generateCandles(60, 50000, 'BULL');

    // Test ports 3002, 3003, 3004, 3005, 3008, 3010
    const ports = [3002, 3003, 3004, 3005, 3008, 3010];
    for (const port of ports) {
      const res = evaluateStrategyForPort({
        port,
        symbol: 'BTCUSD',
        candles15m: candles,
      });

      assert.ok(res, `Port ${port} should return a valid signal object`);
      assert.ok(['BUY', 'SELL', 'WAIT'].includes(res.action), `Port ${port} action must be BUY, SELL, or WAIT`);
      assert.ok(typeof res.strategyName === 'string', `Port ${port} must provide strategyName`);
      console.log(`Verified Port ${port} (${res.strategyName}) -> Action: ${res.action}, Reason: ${res.reason}`);
    }
  });

  it('Part 2: UniversalTradeGuard enforces Top 10 Whitelist', () => {
    const candles = generateCandles(60, 50000, 'BULL');

    // Allowed symbol BTCUSD
    const btcCheck = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: 50000,
      candles15m: candles,
      contractValue: 0.001,
    });
    assert.strictEqual(btcCheck.approved, true, 'BTCUSD must be approved');

    // Forbidden symbol LUNA
    const badCheck = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'LUNAUSD',
      side: 'BUY',
      entryPrice: 1.0,
      candles15m: candles,
      contractValue: 1.0,
    });
    assert.strictEqual(badCheck.approved, false, 'LUNAUSD must be rejected');
    assert.ok(badCheck.vetoReason?.includes('SYMBOL_NOT_WHITELISTED_VETO'), 'Must cite WHITELIST VETO');
  });

  it('Part 3: UniversalTradeGuard enforces Closed-Candle Deduplication Lock', () => {
    const candles = generateCandles(60, 50000, 'BULL');
    UniversalTradeGuard.resetCandleDeduplication('ETHUSD');

    // First trade on ETHUSD
    const firstCheck = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'ETHUSD',
      side: 'BUY',
      entryPrice: 2500,
      candles15m: candles,
      contractValue: 0.01,
    });
    assert.strictEqual(firstCheck.approved, true, 'First trade on candle must be approved');

    // Immediate second trade on same candle -> MUST BE REJECTED
    const dupCheck = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'ETHUSD',
      side: 'BUY',
      entryPrice: 2500,
      candles15m: candles,
      contractValue: 0.01,
    });
    assert.strictEqual(dupCheck.approved, false, 'Duplicate trade on same candle must be blocked');
    assert.ok(dupCheck.vetoReason?.includes('SAME_CANDLE_CHURN_VETO'), 'Must cite SAME_CANDLE_CHURN_VETO');
  });

  it('Part 4: Global Leader Lock prevents Longing Altcoins when BTC/ETH are Selling', () => {
    const candles = generateCandles(60, 1.20, 'BULL');
    UniversalTradeGuard.resetCandleDeduplication('XRPUSD');

    // Active position: ETHUSD SELL
    const activePositions: ActivePositionInfo[] = [
      {
        symbol: 'ETHUSD',
        side: 'SELL',
        entryPrice: 2500,
        unrealizedPnL: 5.0,
      },
    ];

    // Attempt to open XRPUSD BUY while ETHUSD is in active SELL position
    const vetoedLong = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'XRPUSD',
      side: 'BUY',
      entryPrice: 1.20,
      candles15m: candles,
      contractValue: 1.0,
      activePositions,
    });

    assert.strictEqual(vetoedLong.approved, false, 'Must block XRPUSD BUY when ETH is SELLING');
    assert.ok(vetoedLong.vetoReason?.includes('PORTFOLIO_CONFLICT_VETO') || vetoedLong.vetoReason?.includes('MARKET_LEADER'), 'Must cite direction veto');
  });

  it('Part 5: 25% Capital Margin Position Sizing fixes 1-lot issue and deploys 25% margin', () => {
    const candles = generateCandles(60, 2231.45, 'BEAR');
    UniversalTradeGuard.resetCandleDeduplication('ETHUSD');

    // Test ETHUSD with 25% margin on $178.57 account (₹15,000 INR)
    const result = UniversalTradeGuard.validateAndBuildBracket({
      symbol: 'ETHUSD',
      side: 'SELL',
      entryPrice: 2231.45,
      candles15m: candles,
      contractValue: 0.01,
      accountCapitalUSD: 178.57,
      leverage: 30,
      marginPercent: 0.25,
    });

    assert.strictEqual(result.approved, true);
    // 25% of $178.57 = $44.64 margin @ 30x = $1,339.20 notional / (2231.45 * 0.01) = 60 lots!
    assert.strictEqual(result.contracts >= 30, true, `ETH contracts (${result.contracts}) must be >= 30 lots (25% margin), never 1 lot!`);
    assert.ok(result.riskRewardRatio >= 1.25, `Risk-Reward ratio (${result.riskRewardRatio}) must be >= 1.25`);
    assert.ok(result.slPrice > result.entryPrice, 'SL must be above entry for SELL');
    assert.ok(result.tpPrice < result.entryPrice, 'TP must be below entry for SELL');
    console.log(`ETHUSD 25% Margin Sizing -> Contracts: ${result.contracts} lots, ExpectedReward: +$${result.expectedRewardUSD} USD, RR: 1:${result.riskRewardRatio}`);
  });

  it('Part 6: UniversalTradeGuard.canSoftwareClosePosition forbids closing when PnL < 0', () => {
    // Loss condition (-$2.50) -> MUST BE FORBIDDEN
    const blocked = UniversalTradeGuard.canSoftwareClosePosition(-2.50);
    assert.strictEqual(blocked, false, 'Must forbid closing at a loss');

    // Profit condition (+$1.80) -> ALLOWED
    const allowed = UniversalTradeGuard.canSoftwareClosePosition(1.80);
    assert.strictEqual(allowed, true, 'Must allow closing in profit');
  });

});
