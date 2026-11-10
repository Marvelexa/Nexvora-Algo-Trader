// HBA Services Technical Analysis - Candlestick Reversals & Trendline Engine (System 3004 / Port 3004)
// Source Video: "https://youtu.be/aWoRYqQI0pM" (HBA Services Technical Analysis Part 1)
// Core Strategy:
// 1. Candlestick Reversal Geometry:
//    - Single-bar reversals: Hammer, Inverted Hammer (at Support), Shooting Star, Hanging Man (at Resistance)
//      * Rejection wick >= 2.0x body
//      * Small body <= 35% of total candle range
//      * Counter-wick <= 30% of body
//    - Multi-candle reversals:
//      * Bullish Engulfing (prior red bar, current green bar completely engulfing prior body with expansion)
//      * Bearish Engulfing (prior green bar, current red bar completely engulfing prior body with expansion)
//      * Morning Star (3-bar bullish reversal sequence at Support)
//      * Evening Star (3-bar bearish reversal sequence at Resistance)
// 2. Trendline Breakout & Retest:
//    - Body-to-Body and Wick-to-Wick linear trendlines: T(t) = m*t + c
//    - Minimum 2 distinct touches separated by >= 8 bars
//    - Decisive candle close beyond trendline (close > tlAtBreakout + 0.10 * ATR for Long, close < tlAtBreakout - 0.10 * ATR for Short)
//    - Retest bounce/rejection within 1-5 bars confirmed by recognized candlestick reversal geometry (Hammer, Engulfing, or Rejection Wick >= 1.5x body)
// 3. Generous SL Breathing Room:
//    - Long: min(currentBar.low, nearestSupport, tlRetestLow) - Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012)
//    - Short: max(currentBar.high, nearestResistance, tlRetestHigh) + Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012)
//    - Guarantee minimum 1.2% / 1.50 ATR distance to prevent noise stop-outs
// 4. Pre-Reversal TP:
//    - Long: Target nearest preceding swing high above entry (minus 3 ticks / 0.15 ATR buffer), NOT the 45-bar extreme max
//    - Short: Target nearest preceding swing low below entry (plus 3 ticks / 0.15 ATR buffer), NOT the 45-bar extreme min
// 5. Risk/Reward: Strict minimum 1:2.30 RR (rr >= 2.30); removed artificial 2.50 upper cap; zero loose fallbacks.

import { KlinePoint } from '../../src/types';
import { DELTA_PRODUCT_SPECS } from '../deltaExchangeEngine';

export interface StrategySetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
  riskReward?: number;
  patternName?: string;
  trendlineType?: string;
}

export interface Trendline {
  slope: number;
  intercept: number;
  t1: number;
  t2: number;
  p1: number;
  p2: number;
  type: 'ASCENDING' | 'DESCENDING';
  basis: 'WICK' | 'BODY';
}

export class HbaCandlestickTrendlineEngine {
  /**
   * Main evaluation method for System 3004
   */
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StrategySetupResult {
    const nullResult: StrategySetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'CANDLESTICK_TRENDLINE'
    };

    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf?.candles15m) {
      candles15m = candlesOrMtf.candles15m;
    }

    if (!candles15m || candles15m.length < 30) return nullResult;

    const currentBar = candles15m[candles15m.length - 1];
    const prevBar = candles15m[candles15m.length - 2];
    const prev2Bar = candles15m.length >= 3 ? candles15m[candles15m.length - 3] : undefined;
    const currentPrice = currentBar.close;
    const atr14 = this.calcATR(candles15m, 14);

    const { tickSize, decimals } = this.getSymbolSpec(symbol);
    const spread = 2 * tickSize;

    // Identify Support & Resistance levels from prior swing points
    const historyBars = candles15m.slice(0, -1);
    const { supports, resistances, priorSwingHigh, priorSwingLow } = this.findLevelsAndSwings(historyBars, atr14, currentPrice, tickSize);

    const nearestSupport = this.findNearestLevel(currentBar.low, supports, atr14 * 0.25);
    const nearestResistance = this.findNearestLevel(currentBar.high, resistances, atr14 * 0.25);

    // =========================================================================
    // 1. EVALUATE CANDLESTICK REVERSAL GEOMETRY (Setup A)
    // =========================================================================
    const candleGeometry = this.analyzeCandleGeometry(currentBar, tickSize, prevBar, prev2Bar);

    // Long Reversal Candlestick: Hammer, Inverted Hammer, Bullish Engulfing, or Morning Star at Support
    if (
      candleGeometry.isHammer ||
      candleGeometry.isInvertedHammer ||
      candleGeometry.isBullishEngulfing ||
      candleGeometry.isMorningStar
    ) {
      const patternAnchorLow = (candleGeometry.isMorningStar && prev2Bar)
        ? Math.min(currentBar.low, prevBar.low, prev2Bar.low)
        : candleGeometry.isBullishEngulfing
        ? Math.min(currentBar.low, prevBar.low)
        : currentBar.low;

      const patternSupport = this.findNearestLevel(patternAnchorLow, supports, atr14 * 0.25) ?? nearestSupport;
      if (patternSupport !== null) {
        const patternName = candleGeometry.isHammer
          ? 'HAMMER'
          : candleGeometry.isInvertedHammer
          ? 'INVERTED_HAMMER'
          : candleGeometry.isBullishEngulfing
          ? 'BULLISH_ENGULFING'
          : 'MORNING_STAR';

        // Generous SL breathing room: min(currentBar.low, patternSupport) - Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012)
        const anchor = Math.min(patternAnchorLow, patternSupport);
        const slBuffer = Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012);
        const rawSL = anchor - slBuffer;
        let sl = this.quantizePrice(rawSL, tickSize, decimals);
        let riskDist = currentPrice - sl;
        const minRiskDist = Math.max(1.50 * atr14, currentPrice * 0.012, 3.5 * spread);
        if (riskDist < minRiskDist) {
          riskDist = minRiskDist;
          sl = this.quantizePrice(currentPrice - riskDist, tickSize, decimals);
          riskDist = currentPrice - sl;
        }

        if (riskDist > 0) {
          // Pre-Reversal TP: Placed strictly BEFORE nearest preceding swing high!
          if (priorSwingHigh > currentPrice) {
            const targetSwingHigh = priorSwingHigh;
            const preRevBuffer = 3 * tickSize;
            const rawTP = targetSwingHigh - preRevBuffer;
            const tp = this.quantizePrice(rawTP, tickSize, decimals);

            const profitDist = tp - currentPrice;
            const rr = parseFloat((profitDist / riskDist).toFixed(2));

            // Enforce strict 1:2.30+ Risk:Reward (Zero-Squeeze Rule; no artificial 2.50 upper cap)
            if (rr >= 2.30) {
              return {
                recommendedSide: 'BUY',
                confidenceScore: 89,
                setupType: 'HBA_CANDLESTICK_SUPPORT_REVERSAL',
                reasons: [
                  `Bullish ${patternName} detected at Support level ${patternSupport.toFixed(decimals)}`,
                  `Candlestick reversal geometry verified at identified support level`,
                  `Generous Stop Loss breathing room enforced (SL: ${sl.toFixed(decimals)}, buffer: ${slBuffer.toFixed(decimals)} >= 1.50 ATR / 1.2%)`,
                  `Pre-Reversal Take Profit positioned before preceding swing high (${targetSwingHigh.toFixed(decimals)} - 3 ticks = ${tp.toFixed(decimals)})`,
                  `Risk-to-Reward verified within strict 1:2.30+ Risk:Reward: 1:${rr.toFixed(2)}`
                ],
                customSL: sl,
                customTP: tp,
                marketRegime: 'SUPPORT_CANDLESTICK_REVERSAL',
                riskReward: rr,
                patternName
              };
            }
          }
        }
      }
    }

    // Short Reversal Candlestick: Shooting Star, Hanging Man, Bearish Engulfing, or Evening Star at Resistance
    if (
      candleGeometry.isShootingStar ||
      candleGeometry.isHangingMan ||
      candleGeometry.isBearishEngulfing ||
      candleGeometry.isEveningStar
    ) {
      const patternAnchorHigh = (candleGeometry.isEveningStar && prev2Bar)
        ? Math.max(currentBar.high, prevBar.high, prev2Bar.high)
        : candleGeometry.isBearishEngulfing
        ? Math.max(currentBar.high, prevBar.high)
        : currentBar.high;

      const patternResistance = this.findNearestLevel(patternAnchorHigh, resistances, atr14 * 0.25) ?? nearestResistance;
      if (patternResistance !== null) {
        const patternName = candleGeometry.isShootingStar
          ? 'SHOOTING_STAR'
          : candleGeometry.isHangingMan
          ? 'HANGING_MAN'
          : candleGeometry.isBearishEngulfing
          ? 'BEARISH_ENGULFING'
          : 'EVENING_STAR';

        // Generous SL breathing room: max(currentBar.high, patternResistance) + Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012)
        const anchor = Math.max(patternAnchorHigh, patternResistance);
        const slBuffer = Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012);
        const rawSL = anchor + slBuffer;
        let sl = this.quantizePrice(rawSL, tickSize, decimals);
        let riskDist = sl - currentPrice;
        const minRiskDist = Math.max(1.50 * atr14, currentPrice * 0.012, 3.5 * spread);
        if (riskDist < minRiskDist) {
          riskDist = minRiskDist;
          sl = this.quantizePrice(currentPrice + riskDist, tickSize, decimals);
          riskDist = sl - currentPrice;
        }

        if (riskDist > 0) {
          // Pre-Reversal TP: Placed strictly BEFORE nearest preceding swing low!
          if (priorSwingLow > 0 && priorSwingLow < currentPrice) {
            const targetSwingLow = priorSwingLow;
            const preRevBuffer = 3 * tickSize;
            const rawTP = targetSwingLow + preRevBuffer;
            const tp = this.quantizePrice(rawTP, tickSize, decimals);

            const profitDist = currentPrice - tp;
            const rr = parseFloat((profitDist / riskDist).toFixed(2));

            // Enforce strict 1:2.30+ Risk:Reward (Zero-Squeeze Rule; no artificial 2.50 upper cap)
            if (rr >= 2.30) {
              return {
                recommendedSide: 'SELL',
                confidenceScore: 89,
                setupType: 'HBA_CANDLESTICK_RESISTANCE_REVERSAL',
                reasons: [
                  `Bearish ${patternName} detected at Resistance level ${patternResistance.toFixed(decimals)}`,
                  `Candlestick reversal geometry verified at identified resistance level`,
                  `Generous Stop Loss breathing room enforced (SL: ${sl.toFixed(decimals)}, buffer: ${slBuffer.toFixed(decimals)} >= 1.50 ATR / 1.2%)`,
                  `Pre-Reversal Take Profit positioned before preceding swing low (${targetSwingLow.toFixed(decimals)} + 3 ticks = ${tp.toFixed(decimals)})`,
                  `Risk-to-Reward verified within strict 1:2.30+ Risk:Reward: 1:${rr.toFixed(2)}`
                ],
                customSL: sl,
                customTP: tp,
                marketRegime: 'RESISTANCE_CANDLESTICK_REVERSAL',
                riskReward: rr,
                patternName
              };
            }
          }
        }
      }
    }

    // =========================================================================
    // 2. EVALUATE TRENDLINE BREAKOUT & RETEST (Setup B)
    // =========================================================================
    const trendlines = this.constructTrendlines(candles15m);

    // Look for Descending Trendline breakout + retest bounce (Long Setup)
    for (const tl of trendlines.descending) {
      const retest = this.checkTrendlineRetest(candles15m, tl, 'BULLISH', atr14, candleGeometry);
      if (retest.confirmed) {
        // Stop Loss: min(currentBar.low, nearestSupport, tlRetestLow) - buffer
        const anchor = Math.min(
          currentBar.low,
          nearestSupport !== null ? nearestSupport : currentBar.low,
          retest.retestSwingLow
        );
        const slBuffer = Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012);
        const rawSL = anchor - slBuffer;
        let sl = this.quantizePrice(rawSL, tickSize, decimals);
        let riskDist = currentPrice - sl;
        const minRiskDist = Math.max(1.50 * atr14, currentPrice * 0.012, 3.5 * spread);
        if (riskDist < minRiskDist) {
          riskDist = minRiskDist;
          sl = this.quantizePrice(currentPrice - riskDist, tickSize, decimals);
          riskDist = currentPrice - sl;
        }

        if (riskDist > 0) {
          if (priorSwingHigh <= currentPrice) continue;
          const targetSwingHigh = priorSwingHigh;
          const preRevBuffer = 3 * tickSize;
          const rawTP = targetSwingHigh - preRevBuffer;
          const tp = this.quantizePrice(rawTP, tickSize, decimals);

          const profitDist = tp - currentPrice;
          const rr = parseFloat((profitDist / riskDist).toFixed(2));

          if (rr >= 2.30) {
            return {
              recommendedSide: 'BUY',
              confidenceScore: 87,
              setupType: 'HBA_DESCENDING_TRENDLINE_RETEST_BOUNCE',
              reasons: [
                `Descending Trendline (${tl.basis}-to-${tl.basis}) Breakout & Retest confirmed`,
                `Retest touch occurred within ${retest.barsSinceBreakout} bars (<= 5 bars window)`,
                `Retest bounce confirmed by recognized candlestick reversal geometry`,
                `Generous Stop Loss breathing room enforced (SL: ${sl.toFixed(decimals)}, distance: ${riskDist.toFixed(decimals)} >= 1.50 ATR / 1.2%)`,
                `Pre-Reversal Take Profit positioned before preceding swing high (${targetSwingHigh.toFixed(decimals)} - 3 ticks = ${tp.toFixed(decimals)})`,
                `Risk-to-Reward verified within strict 1:2.30+ Risk:Reward: 1:${rr.toFixed(2)}`
              ],
              customSL: sl,
              customTP: tp,
              marketRegime: 'TRENDLINE_BREAKOUT_RETEST_BULL',
              riskReward: rr,
              trendlineType: `DESCENDING_${tl.basis}`
            };
          }
        }
      }
    }

    // Look for Ascending Trendline breakdown + retest rejection (Short Setup)
    for (const tl of trendlines.ascending) {
      const retest = this.checkTrendlineRetest(candles15m, tl, 'BEARISH', atr14, candleGeometry);
      if (retest.confirmed) {
        // Stop Loss: max(currentBar.high, nearestResistance, tlRetestHigh) + buffer
        const anchor = Math.max(
          currentBar.high,
          nearestResistance !== null ? nearestResistance : currentBar.high,
          retest.retestSwingHigh
        );
        const slBuffer = Math.max(1.50 * atr14, 3.5 * spread, currentPrice * 0.012);
        const rawSL = anchor + slBuffer;
        let sl = this.quantizePrice(rawSL, tickSize, decimals);
        let riskDist = sl - currentPrice;
        const minRiskDist = Math.max(1.50 * atr14, currentPrice * 0.012, 3.5 * spread);
        if (riskDist < minRiskDist) {
          riskDist = minRiskDist;
          sl = this.quantizePrice(currentPrice + riskDist, tickSize, decimals);
          riskDist = sl - currentPrice;
        }

        if (riskDist > 0) {
          if (priorSwingLow >= currentPrice || priorSwingLow <= 0) continue;
          const targetSwingLow = priorSwingLow;
          const preRevBuffer = 3 * tickSize;
          const rawTP = targetSwingLow + preRevBuffer;
          const tp = this.quantizePrice(rawTP, tickSize, decimals);

          const profitDist = currentPrice - tp;
          const rr = parseFloat((profitDist / riskDist).toFixed(2));

          if (rr >= 2.30) {
            return {
              recommendedSide: 'SELL',
              confidenceScore: 87,
              setupType: 'HBA_ASCENDING_TRENDLINE_RETEST_REJECTION',
              reasons: [
                `Ascending Trendline (${tl.basis}-to-${tl.basis}) Breakdown & Retest confirmed`,
                `Retest touch occurred within ${retest.barsSinceBreakout} bars (<= 5 bars window)`,
                `Retest rejection confirmed by recognized candlestick reversal geometry`,
                `Generous Stop Loss breathing room enforced (SL: ${sl.toFixed(decimals)}, distance: ${riskDist.toFixed(decimals)} >= 1.50 ATR / 1.2%)`,
                `Pre-Reversal Take Profit positioned before preceding swing low (${targetSwingLow.toFixed(decimals)} + 3 ticks = ${tp.toFixed(decimals)})`,
                `Risk-to-Reward verified within strict 1:2.30+ Risk:Reward: 1:${rr.toFixed(2)}`
              ],
              customSL: sl,
              customTP: tp,
              marketRegime: 'TRENDLINE_BREAKDOWN_RETEST_BEAR',
              riskReward: rr,
              trendlineType: `ASCENDING_${tl.basis}`
            };
          }
        }
      }
    }

    return nullResult;
  }

  /**
   * Candlestick Geometry Analyzer
   * Checks strict proportions:
   * - Rejection wick >= 2.0x body
   * - Body <= 35% of total candle range
   * - Counter-wick <= 30% of body
   * - Multi-candle: Bullish/Bearish Engulfing, Morning/Evening Star
   */
  public analyzeCandleGeometry(
    c: KlinePoint,
    tickSize: number,
    prevBar?: KlinePoint,
    prev2Bar?: KlinePoint
  ) {
    const range = Math.max(c.high - c.low, tickSize);
    const body = Math.abs(c.close - c.open);
    const bodyRatio = body / range;

    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    const lowerWickToBody = body > 0 ? lowerWick / body : (lowerWick / tickSize);
    const upperWickToBody = body > 0 ? upperWick / body : (upperWick / tickSize);

    const isSmallBody = bodyRatio <= 0.35;
    const maxCounterWick = 0.30 * Math.max(body, tickSize);

    // Hammer: Long lower wick >= 2x body, tiny upper wick <= 30% body
    const isHammer = isSmallBody && lowerWickToBody >= 2.0 && upperWick <= maxCounterWick;

    // Inverted Hammer: Long upper wick >= 2x body, tiny lower wick <= 30% body
    const isInvertedHammer = isSmallBody && upperWickToBody >= 2.0 && lowerWick <= maxCounterWick;

    // Shooting Star: Long upper wick >= 2x body, tiny lower wick <= 30% body
    const isShootingStar = isSmallBody && upperWickToBody >= 2.0 && lowerWick <= maxCounterWick;

    // Hanging Man: Long lower wick >= 2x body, tiny upper wick <= 30% body
    const isHangingMan = isSmallBody && lowerWickToBody >= 2.0 && upperWick <= maxCounterWick;

    // Multi-candle Reversals:
    let isBullishEngulfing = false;
    let isBearishEngulfing = false;
    let isMorningStar = false;
    let isEveningStar = false;

    if (prevBar) {
      const prevBody = Math.abs(prevBar.close - prevBar.open);
      const isPrevRed = prevBar.close < prevBar.open;
      const isPrevGreen = prevBar.close > prevBar.open;
      const isCurrGreen = c.close > c.open;
      const isCurrRed = c.close < c.open;

      // Bullish Engulfing: Prior bar red, current bar green completely engulfing prior body with expansion
      if (isPrevRed && isCurrGreen && body > prevBody) {
        if (c.open <= prevBar.close + (0.10 * tickSize) && c.close >= prevBar.open - (0.10 * tickSize)) {
          isBullishEngulfing = true;
        }
      }

      // Bearish Engulfing: Prior bar green, current bar red completely engulfing prior body with expansion
      if (isPrevGreen && isCurrRed && body > prevBody) {
        if (c.open >= prevBar.close - (0.10 * tickSize) && c.close <= prevBar.open + (0.10 * tickSize)) {
          isBearishEngulfing = true;
        }
      }

      // Morning Star & Evening Star (3-bar sequence)
      if (prev2Bar) {
        const prev2Body = Math.abs(prev2Bar.close - prev2Bar.open);
        const prev2Range = Math.max(prev2Bar.high - prev2Bar.low, tickSize);

        // Morning Star: Bar 1 strong red, Bar 2 small body at low, Bar 3 strong green closing into Bar 1 body
        if (
          prev2Bar.close < prev2Bar.open &&
          prev2Body >= 0.40 * prev2Range &&
          prevBody <= 0.45 * prev2Body &&
          isCurrGreen &&
          c.close >= prev2Bar.close + (0.50 * prev2Body)
        ) {
          isMorningStar = true;
        }

        // Evening Star: Bar 1 strong green, Bar 2 small body at high, Bar 3 strong red closing into Bar 1 body
        if (
          prev2Bar.close > prev2Bar.open &&
          prev2Body >= 0.40 * prev2Range &&
          prevBody <= 0.45 * prev2Body &&
          isCurrRed &&
          c.close <= prev2Bar.close - (0.50 * prev2Body)
        ) {
          isEveningStar = true;
        }
      }
    }

    const rejectionWickRatio = (isHammer || isHangingMan) ? lowerWickToBody : upperWickToBody;
    const counterWick = (isHammer || isHangingMan) ? upperWick : lowerWick;
    const counterWickRatio = body > 0 ? counterWick / body : 0;

    return {
      body,
      range,
      bodyRatio,
      upperWick,
      lowerWick,
      isHammer,
      isInvertedHammer,
      isShootingStar,
      isHangingMan,
      isBullishEngulfing,
      isBearishEngulfing,
      isMorningStar,
      isEveningStar,
      rejectionWickRatio,
      counterWickRatio
    };
  }

  /**
   * Construct Body-to-Body and Wick-to-Wick Linear Trendlines
   * Minimum 2 distinct touches separated by >= 8 bars
   */
  public constructTrendlines(candles: KlinePoint[]): { descending: Trendline[]; ascending: Trendline[] } {
    const lookback = Math.min(45, candles.length);
    const startIdx = candles.length - lookback;
    const endIdx = candles.length - 2;

    const swingHighsWick: { t: number; p: number }[] = [];
    const swingHighsBody: { t: number; p: number }[] = [];
    const swingLowsWick: { t: number; p: number }[] = [];
    const swingLowsBody: { t: number; p: number }[] = [];

    for (let i = startIdx + 1; i <= endIdx - 1; i++) {
      const c = candles[i];
      const prev = candles[i - 1];
      const next = candles[i + 1];

      if (c.high >= prev.high && c.high >= next.high) {
        swingHighsWick.push({ t: i, p: c.high });
        swingHighsBody.push({ t: i, p: Math.max(c.open, c.close) });
      }
      if (c.low <= prev.low && c.low <= next.low) {
        swingLowsWick.push({ t: i, p: c.low });
        swingLowsBody.push({ t: i, p: Math.min(c.open, c.close) });
      }
    }

    const atr14 = this.calcATR(candles, 14);
    const descending: Trendline[] = [];
    const ascending: Trendline[] = [];

    // Build Descending Trendlines (Connecting Lower Highs separated by >= 8 bars)
    const buildDescending = (pivots: { t: number; p: number }[], basis: 'WICK' | 'BODY') => {
      for (let i = 0; i < pivots.length - 1; i++) {
        for (let j = i + 1; j < pivots.length; j++) {
          const p1 = pivots[i];
          const p2 = pivots[j];
          if (p2.t - p1.t >= 8 && p2.p < p1.p && (p1.p - p2.p) >= 0.5 * atr14) {
            const slope = (p2.p - p1.p) / (p2.t - p1.t);
            const intercept = p1.p - (slope * p1.t);
            let valid = true;
            for (let k = p1.t + 1; k < p2.t; k++) {
              const tl_k = (slope * k) + intercept;
              if (candles[k].high > tl_k + (0.15 * atr14)) {
                valid = false;
                break;
              }
            }
            if (valid) {
              descending.push({ slope, intercept, t1: p1.t, t2: p2.t, p1: p1.p, p2: p2.p, type: 'DESCENDING', basis });
            }
          }
        }
      }
    };

    // Build Ascending Trendlines (Connecting Higher Lows separated by >= 8 bars)
    const buildAscending = (pivots: { t: number; p: number }[], basis: 'WICK' | 'BODY') => {
      for (let i = 0; i < pivots.length - 1; i++) {
        for (let j = i + 1; j < pivots.length; j++) {
          const p1 = pivots[i];
          const p2 = pivots[j];
          if (p2.t - p1.t >= 8 && p2.p > p1.p && (p2.p - p1.p) >= 0.5 * atr14) {
            const slope = (p2.p - p1.p) / (p2.t - p1.t);
            const intercept = p1.p - (slope * p1.t);
            let valid = true;
            for (let k = p1.t + 1; k < p2.t; k++) {
              const tl_k = (slope * k) + intercept;
              if (candles[k].low < tl_k - (0.15 * atr14)) {
                valid = false;
                break;
              }
            }
            if (valid) {
              ascending.push({ slope, intercept, t1: p1.t, t2: p2.t, p1: p1.p, p2: p2.p, type: 'ASCENDING', basis });
            }
          }
        }
      }
    };

    buildDescending(swingHighsWick, 'WICK');
    buildDescending(swingHighsBody, 'BODY');
    buildAscending(swingLowsWick, 'WICK');
    buildAscending(swingLowsBody, 'BODY');

    return { descending, ascending };
  }

  /**
   * Check for breakout and subsequent retest bounce/rejection within 1-5 bars
   * Confirmed by recognized candlestick reversal geometry (Hammer, Engulfing, or Rejection Wick >= 1.5x body)
   */
  public checkTrendlineRetest(
    candles: KlinePoint[],
    tl: Trendline,
    side: 'BULLISH' | 'BEARISH',
    atr14: number,
    candleGeom?: any
  ) {
    const currentIdx = candles.length - 1;
    const currentBar = candles[currentIdx];

    // Search for breakout bar tb within 1 to 5 bars before current bar
    const minBreakoutBar = Math.max(tl.t2 + 1, currentIdx - 5);
    const maxBreakoutBar = currentIdx - 1;

    for (let tb = minBreakoutBar; tb <= maxBreakoutBar; tb++) {
      // Trendline must remain unbroken prior to tb
      let priorBroken = false;
      for (let k = tl.t2 + 1; k < tb; k++) {
        const tl_k = (tl.slope * k) + tl.intercept;
        if (side === 'BULLISH' && candles[k].close > tl_k + (0.10 * atr14)) { priorBroken = true; break; }
        if (side === 'BEARISH' && candles[k].close < tl_k - (0.10 * atr14)) { priorBroken = true; break; }
      }
      if (priorBroken) continue;

      const breakoutBar = candles[tb];
      const tlAtBreakout = (tl.slope * tb) + tl.intercept;

      // Decisive candle close beyond trendline (close > tlAtBreakout + 0.10 * ATR for Long, close < tlAtBreakout - 0.10 * ATR for Short)
      const isBreakout = side === 'BULLISH'
        ? breakoutBar.close > tlAtBreakout + (0.10 * atr14) && breakoutBar.open <= tlAtBreakout + (0.30 * atr14)
        : breakoutBar.close < tlAtBreakout - (0.10 * atr14) && breakoutBar.open >= tlAtBreakout - (0.30 * atr14);

      if (isBreakout) {
        // Now check if current bar retested the trendline
        const tlAtCurrent = (tl.slope * currentIdx) + tl.intercept;
        const barsSince = currentIdx - tb;

        if (side === 'BULLISH') {
          // Bullish Retest: Price dips to within 0.20 ATR of trendline and bounces
          const touchDistance = Math.abs(currentBar.low - tlAtCurrent);
          const reachedZone = touchDistance <= (0.25 * atr14) || currentBar.low <= tlAtCurrent + (0.15 * atr14);
          const body = Math.max(1e-6, Math.abs(currentBar.close - currentBar.open));
          const rejectionWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
          const geomValid = candleGeom?.isHammer || candleGeom?.isBullishEngulfing || rejectionWick >= 1.5 * body;
          const confirmedBounce = currentBar.close >= tlAtCurrent && geomValid;

          if (reachedZone && confirmedBounce) {
            const retestSwingLow = Math.min(currentBar.low, candles[tb].low, tlAtCurrent);
            return {
              confirmed: true,
              barsSinceBreakout: barsSince,
              touchDistance,
              retestSwingLow,
              retestSwingHigh: currentBar.high
            };
          }
        } else {
          // Bearish Retest: Price rallies to within 0.20 ATR of trendline and rejects
          const touchDistance = Math.abs(currentBar.high - tlAtCurrent);
          const reachedZone = touchDistance <= (0.25 * atr14) || currentBar.high >= tlAtCurrent - (0.15 * atr14);
          const body = Math.max(1e-6, Math.abs(currentBar.close - currentBar.open));
          const rejectionWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
          const geomValid = candleGeom?.isShootingStar || candleGeom?.isBearishEngulfing || rejectionWick >= 1.5 * body;
          const confirmedRejection = currentBar.close <= tlAtCurrent && geomValid;

          if (reachedZone && confirmedRejection) {
            const retestSwingHigh = Math.max(currentBar.high, candles[tb].high, tlAtCurrent);
            return {
              confirmed: true,
              barsSinceBreakout: barsSince,
              touchDistance,
              retestSwingLow: currentBar.low,
              retestSwingHigh
            };
          }
        }
      }
    }

    return { confirmed: false, barsSinceBreakout: 0, touchDistance: 999, retestSwingLow: 0, retestSwingHigh: 0 };
  }

  /**
   * Helper: Identify Support and Resistance levels and immediate nearest opposing swing pivots
   */
  private findLevelsAndSwings(
    candles: KlinePoint[],
    atr14: number,
    currentPrice?: number,
    tickSize: number = 0.0001
  ) {
    const supports: number[] = [];
    const resistances: number[] = [];

    const lookback = Math.min(45, candles.length);
    const recentBars = candles.slice(-lookback);

    for (let i = 2; i < recentBars.length - 2; i++) {
      const c = recentBars[i];
      const prev1 = recentBars[i - 1];
      const prev2 = recentBars[i - 2];
      const next1 = recentBars[i + 1];
      const next2 = recentBars[i + 2];

      if (c.high > prev1.high && c.high > next1.high && c.high >= prev2.high && c.high >= next2.high) {
        resistances.push(c.high);
      }
      if (c.low < prev1.low && c.low < next1.low && c.low <= prev2.low && c.low <= next2.low) {
        supports.push(c.low);
      }
    }

    const highs = recentBars.map(c => c.high);
    const lows = recentBars.map(c => c.low);

    let priorSwingHigh = 0;
    let priorSwingLow = 0;

    if (currentPrice !== undefined) {
      // Pre-reversal TP: target nearest preceding swing high above entry (minus buffer), NOT the 45-bar extreme max
      const resAbove = resistances.filter(r => r > currentPrice + (3 * tickSize));
      if (resAbove.length > 0) {
        priorSwingHigh = Math.min(...resAbove);
      } else {
        const highsAbove = highs.filter(h => h > currentPrice + (3 * tickSize));
        priorSwingHigh = highsAbove.length > 0 ? Math.min(...highsAbove) : (highs.length > 0 ? Math.max(...highs) : 0);
      }

      // Pre-reversal TP: target nearest preceding swing low below entry (plus buffer), NOT the 45-bar extreme min
      const supBelow = supports.filter(s => s < currentPrice - (3 * tickSize));
      if (supBelow.length > 0) {
        priorSwingLow = Math.max(...supBelow);
      } else {
        const lowsBelow = lows.filter(l => l < currentPrice - (3 * tickSize));
        priorSwingLow = lowsBelow.length > 0 ? Math.max(...lowsBelow) : (lows.length > 0 ? Math.min(...lows) : 0);
      }
    } else {
      priorSwingHigh = resistances.length > 0 ? Math.max(...resistances) : (highs.length > 0 ? Math.max(...highs) : 0);
      priorSwingLow = supports.length > 0 ? Math.min(...supports) : (lows.length > 0 ? Math.min(...lows) : 0);
    }

    return { supports, resistances, priorSwingHigh, priorSwingLow };
  }

  /**
   * Helper: Find nearest level within tolerance
   */
  private findNearestLevel(price: number, levels: number[], tolerance: number): number | null {
    let nearest: number | null = null;
    let minDiff = Infinity;

    for (const lvl of levels) {
      const diff = Math.abs(price - lvl);
      if (diff <= tolerance && diff < minDiff) {
        minDiff = diff;
        nearest = lvl;
      }
    }
    return nearest;
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
   * Helper: Quantize price to exchange tickSize and decimals
   */
  public quantizePrice(price: number, tickSize: number, decimals: number): number {
    if (price <= 0 || !isFinite(price)) return 0;
    const factor = Math.round(price / tickSize);
    return parseFloat((factor * tickSize).toFixed(decimals));
  }

  /**
   * Helper: Retrieve symbol specifications from DELTA_PRODUCT_SPECS
   */
  private getSymbolSpec(symbol: string): { tickSize: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim().replace(/USD[T]?$/, '') + 'USD';
    const spec = DELTA_PRODUCT_SPECS[clean] || DELTA_PRODUCT_SPECS[symbol];
    if (spec) return { tickSize: spec.tickSize, decimals: spec.decimals };
    return { tickSize: 0.0001, decimals: 4 };
  }
}

export const hbaCandlestickTrendlineEngine = new HbaCandlestickTrendlineEngine();
export const hbaTrendlineEngine = hbaCandlestickTrendlineEngine;
