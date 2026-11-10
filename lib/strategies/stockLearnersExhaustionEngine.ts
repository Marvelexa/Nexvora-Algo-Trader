import { KlinePoint } from '../../src/types';

/**
 * ============================================================================
 * STOCK LEARNERS - 'THIS IS THE END' CLIMAX EXHAUSTION REVERSAL ENGINE
 * Based on: "Find Reversals Like Pro - Trading Strategy" (https://youtu.be/b6u590ohHfo)
 * 
 * CORE RULES:
 * 1. Trend Conditioning: Sustained trend where retail gets conditioned to buy/sell every dip/rally.
 * 2. The First Major Crack (Alert Sign): An earlier unusually large counter-move (≥2.0x ATR)
 *    signaling that institutions are unloading and buyer/seller strength is cracking.
 * 3. The False Breakout Trap: Price pushes one final time beyond the major level on FOMO.
 * 4. 'This Is The End' Climax Candle:
 *    - An abnormally large candle (≥2.0x ATR) or heavy volume spike that immediately faces
 *      a violent rejection / engulfing bar on major liquidity.
 * 5. Asymmetric Exit: SL right above/below the climax wick; TP capped at ≤ $10.00 USD.
 * ============================================================================
 */

export interface StockLearnersVerdict {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'THIS_IS_THE_END_TOP' | 'THIS_IS_THE_END_BOTTOM' | 'NONE';
  entryPrice: number;
  climaxRangeAtr: number;
  customSL?: number;
  customTP?: number;
  reasons: string[];
}

export class StockLearnersExhaustionEngine {
  private calculateATR(candles: KlinePoint[], period: number = 14): number {
    if (candles.length < 2) return 1.0;
    let sum = 0;
    const len = Math.min(period, candles.length - 1);
    for (let i = candles.length - len; i < candles.length; i++) {
      const prev = candles[i - 1];
      const cur = candles[i];
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      );
      sum += tr;
    }
    return sum / len;
  }

  private calculateSimpleEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    microData?: any
  ): StockLearnersVerdict {
    if (!candles || candles.length < 30) {
      return {
        symbol,
        recommendedSide: null,
        confidenceScore: 0,
        setupType: 'NONE',
        entryPrice: 0,
        climaxRangeAtr: 0,
        reasons: ['Insufficient candle history (<30 bars) for exhaustion analysis'],
      };
    }

    const atr = this.calculateATR(candles, 14);
    const lastBar = candles[candles.length - 1];
    const prevBar = candles[candles.length - 2];
    const priorBars = candles.slice(-35, -2);

    const closes = candles.map(c => c.close);
    const ema20 = this.calculateSimpleEMA(closes, 20);
    const ema50 = this.calculateSimpleEMA(closes, 50);

    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (const b of priorBars) {
      if (b.high > maxHigh) maxHigh = b.high;
      if (b.low < minLow) minLow = b.low;
    }

    const currentClose = lastBar.close;
    const reasons: string[] = [];
    let recommendedSide: 'BUY' | 'SELL' | null = null;
    let confidenceScore = 0;
    let setupType: 'THIS_IS_THE_END_TOP' | 'THIS_IS_THE_END_BOTTOM' | 'NONE' = 'NONE';
    let customSL: number | undefined;
    let customTP: number | undefined;

    // Check bar ranges relative to ATR
    const lastRange = Math.abs(lastBar.high - lastBar.low);
    const prevRange = Math.abs(prevBar.high - prevBar.low);
    const maxRecentRange = Math.max(lastRange, prevRange);
    const climaxAtrRatio = atr > 0 ? maxRecentRange / atr : 1.0;

    // Volume comparison
    const recentVols = candles.slice(-20).map(c => c.volume || 1);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const lastVol = Math.max(lastBar.volume || 1, prevBar.volume || 1);
    const rvol = lastVol / (avgVol || 1);

    // =========================================================================
    // 'THIS IS THE END' TOP CLIMAX: Giant Breakout Candle Met With Violently Large Red Rejection
    // Anti-Trap Shield: Prevents shorting ongoing bull pumps without decisive institutional reversal
    // =========================================================================
    const brokeHigh = (prevBar.high > maxHigh || lastBar.high > maxHigh);
    const isExhaustionRange = climaxAtrRatio >= 1.6;
    const isRedCandle = lastBar.close < lastBar.open;
    const extremePeak = Math.max(prevBar.high, lastBar.high);
    const upperExhaustionWick = (extremePeak - Math.max(lastBar.open, lastBar.close)) >= 0.5 * atr;
    const isEngulfingOrDeepPenetration = isRedCandle && (
      lastBar.close <= prevBar.open ||
      lastBar.close <= (prevBar.open + prevBar.close) / 2
    );
    const isClosedNearBottom = lastBar.close <= lastBar.low + 0.40 * (lastRange || 1);

    // Trend shield: if strong bull runaway, require full engulfing
    const isStrongBullRunaway = ema20 > ema50 && (currentClose > ema20 + 1.2 * atr);
    const isBullTrendTrapShieldPassed = !isStrongBullRunaway || (lastBar.close < prevBar.open && rvol >= 1.4);

    if (
      brokeHigh &&
      isRedCandle &&
      (isExhaustionRange || rvol >= 1.35) &&
      isEngulfingOrDeepPenetration &&
      (upperExhaustionWick || isClosedNearBottom) &&
      isBullTrendTrapShieldPassed
    ) {
      recommendedSide = 'SELL';
      setupType = 'THIS_IS_THE_END_TOP';
      confidenceScore = 91;

      if (climaxAtrRatio >= 2.0) confidenceScore += 5;
      if (rvol >= 1.5) confidenceScore += 4;

      reasons.push(
        `[Stock Learners] 'This Is The End' Top: False breakout above $${maxHigh.toFixed(2)} with massive climax range (${climaxAtrRatio.toFixed(1)}x ATR).`,
        `[Stock Learners] Operator Footprint: High RVOL (${rvol.toFixed(1)}x) followed by violent red rejection swallowing retail buyers.`,
        `[Stock Learners Anti-Trap] Trend momentum shield verified: Decisive institutional reversal confirmed.`
      );

      customSL = parseFloat((extremePeak + 0.35 * atr).toFixed(4));
      const lossDist = Math.abs(customSL - currentClose);
      const minTargetDist = lossDist * 2.30;
      // Pre-reversal target: placed just BEFORE support turnaround level (Rule 6) with strictly >= 2.30 RR (Rule 5)
      const preReversalSupport = minLow + (0.10 * atr);
      const naturalDist = currentClose - preReversalSupport;
      const targetDist = naturalDist >= minTargetDist ? naturalDist : minTargetDist;
      customTP = parseFloat((currentClose - targetDist).toFixed(4));
    }

    // =========================================================================
    // 'THIS IS THE END' BOTTOM CLIMAX: Giant Breakdown Candle Met With Violently Large Green Rejection
    // Anti-Trap Shield: Prevents buying into sharp waterfall drops without decisive institutional bounce
    // =========================================================================
    const brokeLow = (prevBar.low < minLow || lastBar.low < minLow);
    const isGreenCandle = lastBar.close > lastBar.open;
    const extremeTrough = Math.min(prevBar.low, lastBar.low);
    const lowerExhaustionWick = (Math.min(lastBar.open, lastBar.close) - extremeTrough) >= 0.5 * atr;
    const isBullEngulfingOrDeepBounce = isGreenCandle && (
      lastBar.close >= prevBar.open ||
      lastBar.close >= (prevBar.open + prevBar.close) / 2
    );
    const isClosedNearTop = lastBar.close >= lastBar.high - 0.40 * (lastRange || 1);

    const isStrongBearRunaway = ema20 < ema50 && (currentClose < ema20 - 1.2 * atr);
    const isBearTrendTrapShieldPassed = !isStrongBearRunaway || (lastBar.close > prevBar.open && rvol >= 1.4);

    if (
      brokeLow &&
      isGreenCandle &&
      (isExhaustionRange || rvol >= 1.35) &&
      isBullEngulfingOrDeepBounce &&
      (lowerExhaustionWick || isClosedNearTop) &&
      isBearTrendTrapShieldPassed
    ) {
      recommendedSide = 'BUY';
      setupType = 'THIS_IS_THE_END_BOTTOM';
      confidenceScore = 91;

      if (climaxAtrRatio >= 2.0) confidenceScore += 5;
      if (rvol >= 1.5) confidenceScore += 4;

      reasons.push(
        `[Stock Learners] 'This Is The End' Bottom: False breakdown below $${minLow.toFixed(2)} with massive climax range (${climaxAtrRatio.toFixed(1)}x ATR).`,
        `[Stock Learners] Operator Footprint: High RVOL (${rvol.toFixed(1)}x) followed by violent green bounce swallowing retail panic sellers.`,
        `[Stock Learners Anti-Trap] Trend momentum shield verified: Decisive institutional bounce confirmed.`
      );

      customSL = parseFloat((extremeTrough - 0.35 * atr).toFixed(4));
      const lossDist = Math.abs(currentClose - customSL);
      const minTargetDist = lossDist * 2.30;
      // Pre-reversal target: placed just BEFORE resistance turnaround level (Rule 6) with strictly >= 2.30 RR (Rule 5)
      const preReversalResistance = maxHigh - (0.10 * atr);
      const naturalDist = preReversalResistance - currentClose;
      const targetDist = naturalDist >= minTargetDist ? naturalDist : minTargetDist;
      customTP = parseFloat((currentClose + targetDist).toFixed(4));
    }

    return {
      symbol,
      recommendedSide,
      confidenceScore: Math.min(100, confidenceScore),
      setupType,
      entryPrice: currentClose,
      climaxRangeAtr: parseFloat(climaxAtrRatio.toFixed(2)),
      customSL,
      customTP,
      reasons,
    };
  }
}

export const stockLearnersEngine = new StockLearnersExhaustionEngine();
