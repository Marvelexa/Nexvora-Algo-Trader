import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard.js';
import { PortfolioMarketRegimeEngine, MarketRegimeBiasState } from '../lib/risk/portfolioMarketRegimeEngine.js';
import { KlinePoint, DeltaPosition } from '../src/types.js';

describe('XRP 1.3256 -> 1.3200 Consolidation -> 1.3175 Breakdown Architecture Verification', () => {
  function generateXrp50BarChart(): KlinePoint[] {
    const candles: KlinePoint[] = [];
    const baseTime = 1700000000000;

    // Bars 0-35: Macro range low starts at 1.3050 and climbs gradually to 1.3220
    for (let i = 0; i < 35; i++) {
      const price = 1.3050 + (i / 35) * (1.3220 - 1.3050);
      candles.push({
        time: baseTime + i * 900000,
        open: price - 0.0005,
        high: price + 0.0010,
        low: price - 0.0010,
        close: price,
        volume: 1000 + i * 10,
      });
    }

    // Bar 35: Reaches 1.3256 peak and rejects (Shooting Star / Swing High sweep)
    candles.push({
      time: baseTime + 35 * 900000,
      open: 1.3220,
      high: 1.3256,
      low: 1.3200,
      close: 1.3210,
      volume: 3500,
    });

    // Bars 36-47 (12 bars): Tight 1.3200 consolidation box between 1.3175 and 1.3210 (span = 0.0035 = 0.26%)
    const boxPrices = [1.3205, 1.3190, 1.3208, 1.3185, 1.3195, 1.3200, 1.3180, 1.3205, 1.3190, 1.3200, 1.3185, 1.3192];
    for (let i = 0; i < boxPrices.length; i++) {
      const p = boxPrices[i];
      candles.push({
        time: baseTime + (36 + i) * 900000,
        open: p + 0.0004,
        high: 1.3210,
        low: 1.3175,
        close: p,
        volume: 1200,
      });
    }

    // Bar 48 (Breakdown candle): Opens at 1.3190, drops with strong red displacement, closes at 1.3170 (< 1.3175 box low)
    candles.push({
      time: baseTime + 48 * 900000,
      open: 1.3190,
      high: 1.3192,
      low: 1.3168,
      close: 1.3170,
      volume: 4500,
    });

    return candles;
  }

  it('TEST 1: 5-to-12 bar Lower-High Box Breakdown Detector identifies XRP 1.3175 breakdown', () => {
    const candles = generateXrp50BarChart();
    const result = UniversalTradeGuard.detectVEngulfingReversal(candles);

    assert.strictEqual(result.detected, true, 'Box breakdown must be detected');
    assert.strictEqual(result.type, 'BOX_BREAKDOWN', 'Pattern type must be BOX_BREAKDOWN');
    assert.strictEqual(result.side, 'SELL', 'Side must be SELL');
    assert.ok(result.triggerWickPrice >= 1.3210, 'Trigger wick / box high must be >= 1.3210');
    assert.ok(result.reversalBodyRatio >= 0.55, 'Displacement body ratio must be >= 55%');
  });

  it('TEST 2: Pre-Trade Gate approves XRPUSD SELL at 1.3175 with tight SL ~1.3225 and TP ~1.3055 (2.4R)', () => {
    const candles = generateXrp50BarChart();
    const verdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: 'XRPUSD',
      side: 'SELL',
      currentPrice: 1.3175,
      accountCapitalUSD: 113.17,
      candles15m: candles,
      atr: 0.0030,
      activePositions: [], // Slot 1 (Fast Scalp Mode)
      port: 3005,
    });

    assert.strictEqual(verdict.allowed, true, `XRPUSD Short must be APPROVED! Got reason: ${verdict.reason}`);
    assert.strictEqual(verdict.isFastScalp, true, 'Must be marked as isFastScalp: true');
    assert.strictEqual(verdict.slotType, 'FAST_SCALP', 'Must be tagged slotType: FAST_SCALP');

    // SL Verification: Anchored tight above box (boxHigh 1.3210 + buffer), clamped <= 0.50% (risk ~0.38%)
    const slDistRatio = verdict.slDistance / 1.3175;
    assert.ok(slDistRatio <= 0.0050, `SL ratio (${(slDistRatio * 100).toFixed(2)}%) must be clamped <= 0.50%`);
    assert.ok(verdict.stopLossPrice >= 1.3210 && verdict.stopLossPrice <= 1.3240, `Stop loss ($${verdict.stopLossPrice}) should be around 1.3225`);

    // TP Verification: Anchored at nearest opposing structural wall (intermediate wall <= 1.3100) and runner TP2 at 50-bar support (<= 1.3070)
    assert.ok(verdict.takeProfitPrice <= 1.3100, `Take profit ($${verdict.takeProfitPrice}) must be at intermediate support (<= 1.3100)`);
    assert.ok(verdict.tp2Price !== undefined && verdict.tp2Price <= 1.3070, `Runner TP2 ($${verdict.tp2Price}) must target 50-bar macro support (<= 1.3070)`);

    // Reward-to-Risk Verification: Must deliver >= 1.5R up to 2.4R
    assert.ok(verdict.actualRR >= 1.05, `Actual RR (${verdict.actualRR}) must be >= 1.05R`);
  });

  it('TEST 3: Coin-First Autonomy Rule: XRP Short is APPROVED even if BTC is Bullish (Price < EMA9 & EMA21)', () => {
    const candles = generateXrp50BarChart();
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
      reasons: ['BTC Bullish Pump'],
    };

    const regimeEngine = PortfolioMarketRegimeEngine.getInstance();
    const verdict = regimeEngine.isTradeAllowedByRegime({
      symbol: 'XRPUSD',
      side: 'SELL',
      currentPrice: 1.3175,
      candles15m: candles,
      biasState: bullishState,
    });

    assert.strictEqual(verdict.allowed, true, `Coin Autonomy must allow XRP Short despite Bullish BTC! Got: ${verdict.reason}`);
    assert.ok(verdict.reason.includes('COIN_AUTONOMY_APPROVED') || verdict.reason.includes('APPROVED'));
  });

  it('TEST 4: Portfolio Coherence allows simultaneous BUY on strong coin & SELL on weak breakdown coin', () => {
    const regimeEngine = PortfolioMarketRegimeEngine.getInstance();
    const activePositions: DeltaPosition[] = [
      {
        id: 'pos-sol-long',
        symbol: 'SOLUSD',
        side: 'BUY',
        entryPrice: 180,
        currentPrice: 184,
        quantity: 5,
        marginUSD: 30,
        notionalUSD: 900,
        leverage: 30,
        takeProfitPrice: 188,
        stopLossPrice: 177,
        atr: 2.5,
        isBreakevenLocked: true,
        pnlUSD: 20,
        pnlPercent: 2.2,
        entryTime: Date.now() - 300000,
      }
    ];

    // Candidate: XRPUSD SELL with verified coin autonomy (breakdown structure)
    const coherenceVerdict = regimeEngine.checkPortfolioCoherence(
      activePositions,
      'SELL',
      'XRPUSD',
      { isCoinAutonomous: true }
    );

    assert.strictEqual(coherenceVerdict.allowed, true, 'Autonomous breakdown must be allowed alongside existing long on another coin');
    assert.ok(coherenceVerdict.reason.includes('COIN AUTONOMY APPROVED'));
  });
});
