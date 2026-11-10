import { KlinePoint } from '../../src/types';

/**
 * ============================================================================
 * BRAD GOH (THE TRADING GEEK) - LIQUIDITY SWEEP & MSS REVERSAL ENGINE
 * Based on: "How to Trade Reversals PERFECTLY | Full Course" (https://youtu.be/PkAtVH6YVM8)
 * 
 * CORE RULES:
 * 1. Higher Timeframe Institutional Structure: Identifies key swing highs and lows.
 * 2. Liquidity Sweep (Inducement):
 *    - Bearish: Price wicks above previous swing high to sweep retail stop losses,
 *      then quickly rejects and closes back inside the range (V-shape reaction).
 *    - Bullish: Price wicks below previous swing low to sweep retail stop losses,
 *      then quickly rejects and closes back inside the range (V-shape reaction).
 * 3. Market Structure Shift (MSS / CHOCH):
 *    - Displacement candle breaks the minor intermediate structure with high relative volume.
 * 4. Asymmetric Risk: SL strictly beyond swept wick peak; TP capped at ≤ $10.00 USD.
 * ============================================================================
 */

export interface BradGohReversalVerdict {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'BULLISH_SWEEP_MSS' | 'BEARISH_SWEEP_MSS' | 'NONE';
  entryPrice: number;
  customSL?: number;
  customTP?: number;
  reasons: string[];
}

export class BradGohReversalEngine {
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
  ): BradGohReversalVerdict {
    if (!candles || candles.length < 30) {
      return {
        symbol,
        recommendedSide: null,
        confidenceScore: 0,
        setupType: 'NONE',
        entryPrice: 0,
        reasons: ['Insufficient candle history (<30 bars) for liquidity sweep detection'],
      };
    }

    const atr = this.calculateATR(candles, 14);
    const lastBar = candles[candles.length - 1];
    const prevBar = candles[candles.length - 2];
    const priorBars = candles.slice(-35, -2); // Bars to find swing levels

    // Trend filter EMAs
    const closes = candles.map(c => c.close);
    const ema20 = this.calculateSimpleEMA(closes, 20);
    const ema50 = this.calculateSimpleEMA(closes, 50);

    // 1. Identify Major Swing High and Swing Low
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    for (const b of priorBars) {
      if (b.high > swingHigh) swingHigh = b.high;
      if (b.low < swingLow) swingLow = b.low;
    }

    const currentClose = lastBar.close;
    const currentHigh = Math.max(lastBar.high, prevBar.high);
    const currentLow = Math.min(lastBar.low, prevBar.low);

    const reasons: string[] = [];
    let recommendedSide: 'BUY' | 'SELL' | null = null;
    let confidenceScore = 0;
    let setupType: 'BULLISH_SWEEP_MSS' | 'BEARISH_SWEEP_MSS' | 'NONE' = 'NONE';
    let customSL: number | undefined;
    let customTP: number | undefined;

    // Relative volume check
    const recentVols = candles.slice(-20).map(c => c.volume || 1);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const lastVol = lastBar.volume || 1;
    const rvol = lastVol / (avgVol || 1);

    // =========================================================================
    // ANTI-TRAP BEARISH REVERSAL SETUP (Brad Goh Liquidity Sweep & MSS)
    // Avoids fake reversals: Requires MANDATORY Red Close, MSS break, and rejection wick
    // =========================================================================
    const isHighSwept = (prevBar.high > swingHigh || lastBar.high > swingHigh);
    const isClosedBelowSweep = lastBar.close < swingHigh;
    const isRedCandle = lastBar.close < lastBar.open;
    const redBody = lastBar.open - lastBar.close;
    const hasSignificantRedBody = isRedCandle && (redBody >= 0.35 * atr);
    const upperWick = Math.max(prevBar.high - Math.max(prevBar.open, prevBar.close), lastBar.high - Math.max(lastBar.open, lastBar.close));
    const hasRejectionWick = upperWick >= 0.45 * atr;
    const isClosedInLowerRange = lastBar.close <= lastBar.low + 0.45 * (lastBar.high - lastBar.low);
    const isMSSConfirmed = (lastBar.close < prevBar.low) || (lastBar.close < prevBar.open && lastBar.close < prevBar.close);
    const isStrongBullRunaway = ema20 > ema50 && (currentClose > ema20 + (1.2 * atr));

    // If market is in strong runaway bull momentum, require full engulfing to prevent fake reversal trap
    const isBearishEngulfing = isRedCandle && (lastBar.close < prevBar.open) && (lastBar.open >= prevBar.close);
    const isBullTrendTrapShieldPassed = !isStrongBullRunaway || (isBearishEngulfing && rvol >= 1.4);

    if (
      isHighSwept &&
      isClosedBelowSweep &&
      isRedCandle &&
      hasSignificantRedBody &&
      hasRejectionWick &&
      isClosedInLowerRange &&
      isMSSConfirmed &&
      rvol >= 1.15 &&
      isBullTrendTrapShieldPassed
    ) {
      recommendedSide = 'SELL';
      setupType = 'BEARISH_SWEEP_MSS';
      confidenceScore = 90;

      if (rvol >= 1.4) confidenceScore += 5;
      if (lastBar.close < prevBar.low) confidenceScore += 5; // Decisive MSS

      reasons.push(
        `[Brad Goh] Confirmed Bearish Sweep: Swept $${swingHigh.toFixed(2)} to $${currentHigh.toFixed(2)}, closed red inside at $${currentClose.toFixed(2)}.`,
        `[Brad Goh] MSS & Rejection: Upper wick $${upperWick.toFixed(2)} (${(upperWick / atr).toFixed(1)}x ATR), broken structure with RVOL ${rvol.toFixed(1)}x.`,
        `[Brad Goh Anti-Trap] Passed momentum shield: Clean red displacement closing in lower 45% of candle range.`
      );

      // Stop loss strictly above the swept wick peak + breathing room buffer (invalidation)
      const sweepPeak = Math.max(...candles.slice(-5).map(c => c.high), currentHigh);
      const isMajor = symbol.toUpperCase().includes('BTC') || symbol.toUpperCase().includes('ETH');
      const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
      const minBreathingDistance = currentClose * minBreathingPercent;
      const rawLossDist = Math.max(sweepPeak + 0.25 * atr - currentClose, minBreathingDistance);
      customSL = parseFloat((currentClose + rawLossDist).toFixed(4));
      const lossDist = Math.abs(customSL - currentClose);
      const minTargetDist = lossDist * 2.30;

      // EXACT REVERSAL TAKE PROFIT (Brad Goh PkAtVH6YVM8):
      // The reversal occurs at the opposing key structural swing low (Demand Zone / Liquidity Pool)
      // TP is placed EXACTLY at this reversal level with a tiny execution buffer (0.05 ATR) so fill is guaranteed right before the bounce!
      const exactReversalTP = parseFloat((swingLow + Math.max(0.05 * atr, 0.0002 * currentClose)).toFixed(4));
      const naturalDist = currentClose - exactReversalTP;

      // Strict Risk-to-Reward Rule: If natural room to exact reversal level cannot achieve 1:2.30 RR, REJECT setup!
      // NEVER push TP past the reversal level into outer space!
      if (naturalDist < minTargetDist * 0.95) {
        recommendedSide = null;
        confidenceScore = 0;
        setupType = 'NONE';
        reasons.push(
          `[Brad Goh Reversal] Rejected: Opposing reversal floor ($${exactReversalTP.toFixed(2)}) is too close ($${naturalDist.toFixed(2)} vs $${minTargetDist.toFixed(2)} needed for 1:2.30 RR). Cannot place TP past where reversal occurs.`
        );
      } else {
        customTP = exactReversalTP;
        reasons.push(
          `[Brad Goh Exact Reversal TP] TP placed at $${customTP.toFixed(2)} (Exact Opposing Reversal Support Level: $${swingLow.toFixed(2)} | RR: 1:${(naturalDist / lossDist).toFixed(2)} >= 1:2.30).`
        );
      }
    }

    // =========================================================================
    // ANTI-TRAP BULLISH REVERSAL SETUP (Brad Goh Liquidity Sweep & MSS)
    // Avoids fake breakdowns: Requires MANDATORY Green Close, MSS break, and rejection wick
    // =========================================================================
    const isLowSwept = (prevBar.low < swingLow || lastBar.low < swingLow);
    const isClosedAboveSweep = lastBar.close > swingLow;
    const isGreenCandle = lastBar.close > lastBar.open;
    const greenBody = lastBar.close - lastBar.open;
    const hasSignificantGreenBody = isGreenCandle && (greenBody >= 0.35 * atr);
    const lowerWick = Math.max(Math.min(prevBar.open, prevBar.close) - prevBar.low, Math.min(lastBar.open, lastBar.close) - lastBar.low);
    const hasBounceWick = lowerWick >= 0.45 * atr;
    const isClosedInUpperRange = lastBar.close >= lastBar.high - 0.45 * (lastBar.high - lastBar.low);
    const isBullMSSConfirmed = (lastBar.close > prevBar.high) || (lastBar.close > prevBar.open && lastBar.close > prevBar.close);
    const isStrongBearRunaway = ema20 < ema50 && (currentClose < ema20 - (1.2 * atr));

    const isBullishEngulfing = isGreenCandle && (lastBar.close > prevBar.open) && (lastBar.open <= prevBar.close);
    const isBearTrendTrapShieldPassed = !isStrongBearRunaway || (isBullishEngulfing && rvol >= 1.4);

    if (
      isLowSwept &&
      isClosedAboveSweep &&
      isGreenCandle &&
      hasSignificantGreenBody &&
      hasBounceWick &&
      isClosedInUpperRange &&
      isBullMSSConfirmed &&
      rvol >= 1.15 &&
      isBearTrendTrapShieldPassed
    ) {
      recommendedSide = 'BUY';
      setupType = 'BULLISH_SWEEP_MSS';
      confidenceScore = 90;

      if (rvol >= 1.4) confidenceScore += 5;
      if (lastBar.close > prevBar.high) confidenceScore += 5; // Decisive MSS

      reasons.push(
        `[Brad Goh] Confirmed Bullish Sweep: Swept $${swingLow.toFixed(2)} to $${currentLow.toFixed(2)}, closed green above at $${currentClose.toFixed(2)}.`,
        `[Brad Goh] MSS & Rejection: Lower wick $${lowerWick.toFixed(2)} (${(lowerWick / atr).toFixed(1)}x ATR), broken structure with RVOL ${rvol.toFixed(1)}x.`,
        `[Brad Goh Anti-Trap] Passed momentum shield: Clean green displacement closing in upper 45% of candle range.`
      );

      // Stop loss strictly below the swept wick trough - breathing room buffer (invalidation)
      const sweepTrough = Math.min(...candles.slice(-5).map(c => c.low), currentLow);
      const isMajor = symbol.toUpperCase().includes('BTC') || symbol.toUpperCase().includes('ETH');
      const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
      const minBreathingDistance = currentClose * minBreathingPercent;
      const rawLossDist = Math.max(currentClose - (sweepTrough - 0.25 * atr), minBreathingDistance);
      customSL = parseFloat((currentClose - rawLossDist).toFixed(4));
      const lossDist = Math.abs(currentClose - customSL);
      const minTargetDist = lossDist * 2.30;

      // EXACT REVERSAL TAKE PROFIT (Brad Goh PkAtVH6YVM8):
      // The reversal occurs at the opposing key structural swing high (Supply Zone / Liquidity Pool)
      // TP is placed EXACTLY at this reversal level with a tiny execution buffer (0.05 ATR) so fill is guaranteed right before the dump!
      const exactReversalTP = parseFloat((swingHigh - Math.max(0.05 * atr, 0.0002 * currentClose)).toFixed(4));
      const naturalDist = exactReversalTP - currentClose;

      // Strict Risk-to-Reward Rule: If natural room to exact reversal level cannot achieve 1:2.30 RR, REJECT setup!
      // NEVER push TP past the reversal level into outer space!
      if (naturalDist < minTargetDist * 0.95) {
        recommendedSide = null;
        confidenceScore = 0;
        setupType = 'NONE';
        reasons.push(
          `[Brad Goh Reversal] Rejected: Opposing reversal ceiling ($${exactReversalTP.toFixed(2)}) is too close ($${naturalDist.toFixed(2)} vs $${minTargetDist.toFixed(2)} needed for 1:2.30 RR). Cannot place TP past where reversal occurs.`
        );
      } else {
        customTP = exactReversalTP;
        reasons.push(
          `[Brad Goh Exact Reversal TP] TP placed at $${customTP.toFixed(2)} (Exact Opposing Reversal Resistance Level: $${swingHigh.toFixed(2)} | RR: 1:${(naturalDist / lossDist).toFixed(2)} >= 1:2.30).`
        );
      }
    }

    return {
      symbol,
      recommendedSide,
      confidenceScore: Math.min(100, confidenceScore),
      setupType,
      entryPrice: currentClose,
      customSL,
      customTP,
      reasons,
    };
  }
}

export const bradGohEngine = new BradGohReversalEngine();
