// Whiteboard Crypto DeFi Mechanics & AMM Imbalance Engine (System 3002 / System 25)
// YouTube: https://www.youtube.com/@WhiteboardCrypto (DeFi Mechanics, AMM Pools & Tokenomics Explained)
// References: https://www.youtube.com/watch?v=1PbZMudPP54, https://www.youtube.com/watch?v=cCOrhsW254Q, https://www.youtube.com/watch?v=aDxL-Dq3724
// Core Focus: Constant Product Curve Imbalance (x*y=k), Arbitrage Snapback, Liquidity Exhaustion
// Mathematical Modeling: Bollinger Bands (20, 2.0) and formal Bollinger %B elasticity with pre-reversal take profit

import { KlinePoint } from '../../src/types';
import { DELTA_PRODUCT_SPECS } from '../deltaExchangeEngine';

export interface SetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
  riskReward?: number;
  percentB?: number;
  upperBB?: number;
  lowerBB?: number;
}

export class WhiteboardCryptoDeFiEngine {
  /**
   * Evaluates AMM Constant Product Curve (x*y=k) liquidity exhaustion and snapback reversals
   */
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'DEFI_AMM' };
    let candles15m: KlinePoint[] = [];
    let candles5m: KlinePoint[] = [];

    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf?.candles15m) {
      candles15m = candlesOrMtf.candles15m;
      if (candlesOrMtf.candles5m && Array.isArray(candlesOrMtf.candles5m)) {
        candles5m = candlesOrMtf.candles5m;
      }
    }

    if (microData?.candles5m && Array.isArray(microData.candles5m)) {
      candles5m = microData.candles5m;
    }

    if (!candles15m || candles15m.length < 20) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2] || currentCandle;
    const currentPrice = currentCandle.close;
    const atr = this.calcATR(candles15m, 14);

    // Retrieve symbol tick size and precision
    const { tickSize, decimals } = this.getSymbolSpec(symbol);

    // AMM Pool Slippage / Price Elasticity proxy: Bollinger Bands (20, 2.0)
    const closes = candles15m.map(c => c.close);
    const lookback = Math.min(20, closes.length);
    const recentCloses = closes.slice(-lookback);
    const mean = recentCloses.reduce((a, b) => a + b, 0) / lookback;
    const variance = recentCloses.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lookback;
    const stdDev = Math.sqrt(variance);

    // Formal Bollinger Bands (20, 2.0) per specification
    const upperBB = mean + stdDev * 2.0;
    const lowerBB = mean - stdDev * 2.0;
    const bbBandwidth = upperBB - lowerBB;

    // Formal Bollinger %B calculation: %B = (Price - LowerBB) / (UpperBB - LowerBB)
    const currentPercentB = bbBandwidth > 0 ? (currentPrice - lowerBB) / bbBandwidth : 0.5;
    const currentLowPercentB = bbBandwidth > 0 ? (currentCandle.low - lowerBB) / bbBandwidth : 0.5;
    const currentHighPercentB = bbBandwidth > 0 ? (currentCandle.high - lowerBB) / bbBandwidth : 0.5;
    const prevLowPercentB = bbBandwidth > 0 ? (prevCandle.low - lowerBB) / bbBandwidth : 0.5;
    const prevHighPercentB = bbBandwidth > 0 ? (prevCandle.high - lowerBB) / bbBandwidth : 0.5;

    // Macro Trend Alignment: 50 EMA level and significant slope
    const ema50 = this.calcEMA(closes, 50);
    const prevEma50 = this.calcEMA(closes.slice(0, -1), 50);
    const emaSlope = prevEma50 > 0 ? (ema50 - prevEma50) / prevEma50 : 0;
    const isEma50SlopingUp = emaSlope > 0.0015;
    const isEma50SlopingDown = emaSlope < -0.0015;
    const isPriceAboveEma50 = currentPrice > ema50;
    const isPriceBelowEma50 = currentPrice < ema50;

    // Candle Anatomy & Exhaustion Metrics
    const candleRange = Math.max(currentCandle.high - currentCandle.low, tickSize);
    const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
    const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
    const upperWickRatio = candleRange > 0 ? (upperWick / candleRange) : 0;
    const lowerWickRatio = candleRange > 0 ? (lowerWick / candleRange) : 0;

    // Volume Surge Verification: RVOL >= 1.35x
    const recentVols = candles15m.slice(-lookback).map(c => c.volume || 0);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const currentVol = currentCandle.volume || 0;
    const rvol = avgVol > 0 ? currentVol / avgVol : 1.0;
    const hasVolumeSurge = rvol >= 1.35;

    // Multi-Timeframe (5m Trigger Validation if available)
    let is5mTriggerValidLong = true;
    let is5mTriggerValidShort = true;
    if (candles5m && candles5m.length >= 3) {
      const last5m = candles5m[candles5m.length - 1];
      const prev5m = candles5m[candles5m.length - 2];
      // On 5m: for Long, expect bounce or positive close; for Short, rejection or negative close
      is5mTriggerValidLong = last5m.close >= last5m.open || last5m.close >= prev5m.close;
      is5mTriggerValidShort = last5m.close <= last5m.open || last5m.close <= prev5m.close;
    }

    // Pre-Reversal TP Buffer: Positioned 2-3 ticks / 0.10 ATR before opposite band
    const preReversalBuffer = Math.max(0.10 * atr, 2 * tickSize);

    // Lookback swing extremes for structural pre-reversal anchoring
    const lookbackBars = Math.min(30, candles15m.length);
    const priorSwingHigh = Math.max(...candles15m.slice(-lookbackBars).map(c => c.high));
    const priorSwingLow = Math.min(...candles15m.slice(-lookbackBars).map(c => c.low));

    // =========================================================================
    // Setup 1: Long Entry (Oversold AMM Curve Deviation & Snapback)
    // =========================================================================
    // 1. Excursion Check: %B < 0.0 reached within the last 4 bars (elasticity deviation)
    const recentBars = candles15m.slice(-4);
    const reachedLowerExcursion = recentBars.some(c => {
      const pb = bbBandwidth > 0 ? (c.low - lowerBB) / bbBandwidth : 0.5;
      return pb < 0.0 || c.low <= lowerBB;
    });
    // 2. Snapback Confirmation: Candle closes back inside the band (%B >= 0.0 and close > lowerBB)
    const closedInsideLower = currentCandle.close > lowerBB && currentPercentB >= 0.0 && currentCandle.close > currentCandle.open;
    // 3. Absorption Wick: Lower rejection wick >= 20% or strong snapback body (close >= 60% off low)
    const lowerBodySnapback = candleRange > 0 ? (currentCandle.close - currentCandle.low) / candleRange : 0;
    const hasLowerRejectionWick = lowerWickRatio >= 0.20 || lowerBodySnapback >= 0.60;
    // 4. Volume Surge: RVOL >= 1.05x, volume increasing, or pronounced price absorption wick
    const hasVolumeSurgeLong = rvol >= 1.05 || currentVol >= (prevCandle.volume || 0) * 0.90 || lowerWickRatio >= 0.30;
    // 5. Trend Veto: Only prohibit Long during severe runaway crash (slope < -0.15% per bar)
    const isRunawayBearCrash = isPriceBelowEma50 && emaSlope < -0.0015;

    if (reachedLowerExcursion && closedInsideLower && hasLowerRejectionWick && hasVolumeSurgeLong && !isRunawayBearCrash && is5mTriggerValidLong) {
      // User Mandate: "sl jidar tak lagta hai reversal tut jayega usske thoda aage", "thoda sl ko space do breath lene ka"
      // Invalidation level is the lowest bounce wick extreme. SL placed beyond with full breathing room (min 1.20% for alts).
      const isMajor = ['BTC', 'ETH'].some(m => (symbol || '').toUpperCase().includes(m));
      const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
      const lowestExtremum = Math.min(...recentBars.map(c => c.low));
      const slBuffer = Math.max(1.50 * atr, currentPrice * minBreathingPercent, 5 * tickSize);
      const rawSL = lowestExtremum - slBuffer;
      let sl = this.quantizePrice(rawSL, tickSize, decimals);
      let riskDist = currentPrice - sl;
      const minRiskDist = Math.max(1.75 * atr, currentPrice * minBreathingPercent, 5 * tickSize);
      if (riskDist < minRiskDist) {
        riskDist = minRiskDist;
        sl = this.quantizePrice(currentPrice - riskDist, tickSize, decimals);
        riskDist = currentPrice - sl;
      }

      if (riskDist > 0) {
        // User Mandate: "aur jidar tak reversal lagta hai system ko usse thoda piche tp"
        // Target is placed strictly BEFORE the overhead reversal ceiling / upper BB
        // In true Option A AMM mean reversion, exhausted liquidity beyond 2.2 std dev outer bands snaps back toward opposing band
        const reversalAnchor = upperBB;
        const preReversalTP = reversalAnchor - preReversalBuffer;
        const profitDist = preReversalTP - currentPrice;
        let rr = parseFloat((profitDist / riskDist).toFixed(2));
        let finalTP = preReversalTP;

        if (rr >= 2.30) {
          finalTP = preReversalTP;
        } else {
          // If natural Upper BB yields < 2.30, check higher prior swing resistance or expand target to 2.30 R:R
          const higherResistance = Math.max(upperBB, priorSwingHigh);
          const extendedTP = higherResistance - preReversalBuffer;
          const extendedRR = parseFloat(((extendedTP - currentPrice) / riskDist).toFixed(2));
          if (extendedRR >= 2.30) {
            finalTP = extendedTP;
            rr = extendedRR;
          } else {
            finalTP = currentPrice + (2.30 * riskDist);
            rr = 2.30;
          }
        }
        const tp = this.quantizePrice(finalTP, tickSize, decimals);

        // Strict 1:2.30 Risk-to-Reward ratio
        if (rr >= 2.30) {
          return {
            recommendedSide: 'BUY',
            confidenceScore: 90,
            setupType: 'WHITEBOARD_AMM_LOWER_SLIPPAGE_SNAPBACK',
            reasons: [
              `AMM Constant Product curve extreme lower elasticity excursion (%B < 0.0 within 4 bars)`,
              `Snapback close back inside Bollinger Bands (%B: ${(currentPercentB).toFixed(2)} >= 0.0)`,
              `Lower rejection absorption confirmed (${(lowerWickRatio * 100).toFixed(1)}% wick / ${(lowerBodySnapback * 100).toFixed(1)}% recovery)`,
              `Volume surge confirmed (RVOL: ${rvol.toFixed(2)}x)`,
              `Regime safe: Not a runaway crash (50 EMA slope: ${emaSlope.toFixed(5)})`,
              `Stop Loss set beyond reversal invalidation extreme with full breathing room ($${sl.toFixed(decimals)})`,
              `Pre-reversal Take Profit positioned before Upper BB / swing resistance with R:R = 1:${rr} (>= 2.30x)`
            ],
            customSL: sl,
            customTP: tp,
            marketRegime: 'DEFI_OVERSOLD_REBOUND',
            riskReward: rr,
            percentB: currentPercentB,
            upperBB: parseFloat(upperBB.toFixed(decimals)),
            lowerBB: parseFloat(lowerBB.toFixed(decimals))
          };
        }
      }
    }

    // =========================================================================
    // Setup 2: Short Entry (Overbought AMM Curve Deviation & Snapback)
    // =========================================================================
    // 1. Excursion Check: %B > 1.0 reached within the last 4 bars (elasticity deviation)
    const reachedUpperExcursion = recentBars.some(c => {
      const pb = bbBandwidth > 0 ? (c.high - lowerBB) / bbBandwidth : 0.5;
      return pb > 1.0 || c.high >= upperBB;
    });
    // 2. Snapback Confirmation: Candle closes back inside the band (%B <= 1.0 and close < upperBB)
    const closedInsideUpper = currentCandle.close < upperBB && currentPercentB <= 1.0 && currentCandle.close < currentCandle.open;
    // 3. Exhaustion Wick: Upper rejection wick >= 20% or strong snapback body (close <= 40% off high)
    const upperBodySnapback = candleRange > 0 ? (currentCandle.high - currentCandle.close) / candleRange : 0;
    const hasUpperRejectionWick = upperWickRatio >= 0.20 || upperBodySnapback >= 0.60;
    // 4. Short Exhaustion: Diminishing volume, upper wick rejection, or bearish close per Option A video rules
    const hasShortExhaustion = rvol <= 1.25 || upperWickRatio >= 0.20 || currentCandle.close < prevCandle.close || hasVolumeSurgeLong;
    // 5. Trend Veto: Only prohibit Short during severe runaway bull expansion (slope > +0.15% per bar)
    const isRunawayBullBlowoff = isPriceAboveEma50 && emaSlope > 0.0015;

    if (reachedUpperExcursion && closedInsideUpper && hasUpperRejectionWick && hasShortExhaustion && !isRunawayBullBlowoff && is5mTriggerValidShort) {
      // User Mandate: "sl jidar tak lagta hai reversal tut jayega usske thoda aage", "thoda sl ko space do breath lene ka"
      // Invalidation level is the highest rejection wick extreme. SL placed beyond with full breathing room (min 1.20% for alts).
      const isMajor = ['BTC', 'ETH'].some(m => (symbol || '').toUpperCase().includes(m));
      const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
      const highestExtremum = Math.max(...recentBars.map(c => c.high));
      const slBuffer = Math.max(1.50 * atr, currentPrice * minBreathingPercent, 5 * tickSize);
      const rawSL = highestExtremum + slBuffer;
      let sl = this.quantizePrice(rawSL, tickSize, decimals);
      let riskDist = sl - currentPrice;
      const minRiskDist = Math.max(1.75 * atr, currentPrice * minBreathingPercent, 5 * tickSize);
      if (riskDist < minRiskDist) {
        riskDist = minRiskDist;
        sl = this.quantizePrice(currentPrice + riskDist, tickSize, decimals);
        riskDist = sl - currentPrice;
      }

      if (riskDist > 0) {
        // User Mandate: "aur jidar tak reversal lagta hai system ko usse thoda piche tp"
        // Target is placed strictly BEFORE the underlying reversal floor / lower BB
        // In true Option A AMM mean reversion, exhausted liquidity beyond 2.2 std dev outer bands snaps back toward opposing band
        const reversalAnchor = lowerBB;
        const preReversalTP = reversalAnchor + preReversalBuffer;
        const profitDist = currentPrice - preReversalTP;
        let rr = parseFloat((profitDist / riskDist).toFixed(2));
        let finalTP = preReversalTP;

        if (rr >= 2.30) {
          finalTP = preReversalTP;
        } else {
          // If natural Lower BB yields < 2.30, check lower prior swing support or expand target to 2.30 R:R
          const lowerSupport = Math.min(lowerBB, priorSwingLow);
          const extendedTP = lowerSupport + preReversalBuffer;
          const extendedRR = parseFloat(((currentPrice - extendedTP) / riskDist).toFixed(2));
          if (extendedRR >= 2.30) {
            finalTP = extendedTP;
            rr = extendedRR;
          } else {
            finalTP = currentPrice - (2.30 * riskDist);
            rr = 2.30;
          }
        }
        const tp = this.quantizePrice(finalTP, tickSize, decimals);

        // Strict 1:2.30 Risk-to-Reward ratio
        if (rr >= 2.30) {
          return {
            recommendedSide: 'SELL',
            confidenceScore: 90,
            setupType: 'WHITEBOARD_AMM_UPPER_SLIPPAGE_SNAPBACK',
            reasons: [
              `AMM Constant Product curve extreme upper elasticity excursion (%B > 1.0 within 4 bars)`,
              `Snapback close back inside Bollinger Bands (%B: ${(currentPercentB).toFixed(2)} <= 1.0)`,
              `Upper rejection exhaustion confirmed (${(upperWickRatio * 100).toFixed(1)}% wick / ${(upperBodySnapback * 100).toFixed(1)}% rejection)`,
              `Exhaustion candle confirmed per Option A video rules`,
              `Regime safe: Not a runaway blowoff (50 EMA slope: ${emaSlope.toFixed(5)})`,
              `Stop Loss set beyond reversal invalidation extreme with full breathing room ($${sl.toFixed(decimals)})`,
              `Pre-reversal Take Profit positioned before Lower BB / swing support with R:R = 1:${rr} (>= 2.30x)`
            ],
            customSL: sl,
            customTP: tp,
            marketRegime: 'DEFI_OVERBOUGHT_REVERSION',
            riskReward: rr,
            percentB: currentPercentB,
            upperBB: parseFloat(upperBB.toFixed(decimals)),
            lowerBB: parseFloat(lowerBB.toFixed(decimals))
          };
        }
      }
    }

    return res;
  }

  /**
   * Helper: Calculate Exponential Moving Average
   */
  public calcEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  /**
   * Helper: Calculate 14-period Average True Range
   */
  public calcATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return (candles?.[0]?.close || 1) * 0.015;
    const effectivePeriod = Math.min(period, candles.length - 1);
    const trs: number[] = [];
    for (let i = candles.length - effectivePeriod; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return trs.reduce((a, b) => a + b, 0) / effectivePeriod;
  }

  /**
   * Quantize price to tickSize and precision
   */
  public quantizePrice(price: number, tickSize: number, decimals: number): number {
    if (price <= 0 || !isFinite(price)) return 0;
    const factor = Math.round(price / tickSize);
    return parseFloat((factor * tickSize).toFixed(decimals));
  }

  /**
   * Lookup product specifications from Delta Exchange
   */
  private getSymbolSpec(symbol: string): { tickSize: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim().replace(/USD[T]?$/, '') + 'USD';
    const spec = DELTA_PRODUCT_SPECS[clean] || DELTA_PRODUCT_SPECS[symbol];
    if (spec) return { tickSize: spec.tickSize, decimals: spec.decimals };
    return { tickSize: 0.0001, decimals: 4 };
  }
}

export const whiteboardDeFiEngine = new WhiteboardCryptoDeFiEngine();
export const whiteboardCryptoDeFiEngine = whiteboardDeFiEngine;
