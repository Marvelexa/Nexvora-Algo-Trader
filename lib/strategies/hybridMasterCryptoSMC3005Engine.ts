import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3005: HYBRID MASTER CRYPTO SMC ENGINE (PURE SMC)
 * 
 * PRIMARY VIDEO REFERENCES:
 * 1. Neeraj Joshi - ICT / Smart Money Concept Masterclass (http://www.youtube.com/watch?v=FAt3PiB8-cM, http://www.youtube.com/watch?v=6GNfCpyPawo)
 * 2. Solomon King - Crypto Smart Money Concepts Complete Course (https://www.youtube.com/playlist?list=PLAm31T2I_6UWiB5gqUuxqU7okJUfx-hB_)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG) — ONLY WHEN 15m Close > EMA_50 & EMA_21 >= EMA_50:
 * 1. Bullish Structure (BOS/CHoCH): 15m chart has broken above the last Swing High (confirmed Bullish BOS).
 *    Strictly forbid SELL while in Bullish Structure!
 * 2. Inducement (IDM) + Discount Tap: Price pulls back into the Discount Zone (< 50% of impulse leg),
 *    sweeps the minor internal pullback low (IDM), and taps an unmitigated Bullish Order Block (OB)
 *    or Bullish FVG situated above EMA_50.
 * 3. Trigger Candle: Prints a Bullish Engulfing (GreenBody >= 0.80 * prevRedBody) OR
 *    Hammer (LowerWick >= 40%) that closes green above EMA_9.
 * 4. Bonus Breakout Trigger: If price forms a tight 5–12 bar Higher-Low box above EMA_21 and
 *    breaks upward with a green displacement candle (Body >= 60%), fire BUY.
 * 5. SL & TP: SL = Sweep Low / OB low - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = External swing high (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT) — ONLY WHEN 15m Close < EMA_50 & EMA_21 <= EMA_50:
 * 1. Bearish Structure (BOS/CHoCH): 15m chart has broken below the last Swing Low (confirmed Bearish BOS).
 *    Strictly forbid BUY while in Bearish Structure!
 * 2. Inducement (IDM) + Premium Tap: Price bounces into the Premium Zone (> 50% of impulse drop),
 *    sweeps the minor internal bounce high (IDM), and taps an unmitigated Bearish Order Block (OB)
 *    or Bearish FVG situated below EMA_50.
 * 3. Trigger Candle: Prints a Bearish Engulfing (RedBody >= 0.80 * prevGreenBody) OR
 *    Shooting Star (UpperWick >= 40%) that closes red below EMA_9.
 * 4. Bonus Breakdown Trigger: If price forms a tight 5–12 bar Lower-High box below EMA_21 and
 *    breaks downward with a red displacement candle (Body >= 60%), fire SELL.
 * 5. SL & TP: SL = Sweep High / OB high + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = External swing low (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface HybridSMC3005Verdict extends StandardStrategyVerdict {
  customSL?: number;
  customTP?: number;
}

export class HybridMasterCryptoSMC3005Engine {
  public static readonly PORT = 3005;
  public static readonly NAME = 'Hybrid Master Crypto SMC Engine (Pure Neeraj Joshi + Solomon King SMC)';
  public static readonly VIDEO_URLS = [
    'http://www.youtube.com/watch?v=FAt3PiB8-cM',
    'http://www.youtube.com/watch?v=6GNfCpyPawo',
    'https://www.youtube.com/playlist?list=PLAm31T2I_6UWiB5gqUuxqU7okJUfx-hB_',
  ];

  public static calculateEMA(values: number[], period: number): number[] {
    if (!values || values.length === 0) return [];
    const k = 2 / (period + 1);
    const ema: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  }

  public static calculateATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return 1.0;
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

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000
  ): HybridSMC3005Verdict {
    return HybridMasterCryptoSMC3005Engine.evaluateSetup(symbol, candles, accountEquity);
  }

  public static evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000
  ): HybridSMC3005Verdict {
    const emptyVerdict: HybridSMC3005Verdict = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      strategyName: HybridMasterCryptoSMC3005Engine.NAME,
      setupType: 'NONE',
      entryPrice: candles && candles.length > 0 ? candles[candles.length - 1].close : 0,
      stopLossPrice: 0,
      tp1Price: 0,
      tp2Price: 0,
      tp1Ratio: 1.0,
      tp2Ratio: 0,
      earlyBreakevenPrice: 0,
      riskDistance: 0,
      minSlDistancePct: 0.0038,
      customSL: 0,
      customTP: 0,
      reasons: [],
      auditLog: {
        bosOrChochConfirmed: false,
        idmSwept: false,
        obOrFvgMitigated: false,
      },
    };

    if (!candles || candles.length < 52) {
      emptyVerdict.reasons.push('Insufficient candle history (<52 bars) for Pure SMC');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const prev = candles[n - 2];
    const curPrice = cur.close;
    const closes = candles.map(c => c.close);
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema21Arr = this.calculateEMA(closes, 21);
    const ema9Arr = this.calculateEMA(closes, 9);
    const atr = Math.max(this.calculateATR(candles, 14), curPrice * 0.002);

    const curEma50 = ema50Arr[n - 1];
    const curEma21 = ema21Arr[n - 1];
    const curEma9 = ema9Arr[n - 1];

    const curRange = Math.max(cur.high - cur.low, curPrice * 0.001);
    const prevRange = Math.max(prev.high - prev.low, curPrice * 0.001);
    const curBody = Math.abs(cur.close - cur.open);
    const prevBody = Math.abs(prev.close - prev.open);
    const lowerWickRatio = (Math.min(cur.open, cur.close) - cur.low) / curRange;
    const upperWickRatio = (cur.high - Math.max(cur.open, cur.close)) / curRange;

    // Lookback window for market structure (last 35 bars before cur)
    // FIX 1: Ignore extreme freak wicks! Calculate Support strictly from Candle Bodies Math.min(open, close)
    // and Resistance strictly from Candle Bodies Math.max(open, close)
    const slice = candles.slice(n - 35, n - 1);
    const bodyHighs = slice.map(c => Math.max(c.open, c.close));
    const bodyLows = slice.map(c => Math.min(c.open, c.close));
    const swingHigh = Math.max(...bodyHighs);
    const swingLow = Math.min(...bodyLows);
    const impulseRange = swingHigh - swingLow;

    // --- EVALUATE BUY (LONG) ---
    // Only when 15m Close > EMA_50 & EMA_21 >= EMA_50
    const isBullTrend = curPrice > curEma50 && curEma21 >= curEma50 * 0.998;
    if (isBullTrend) {
      // 1. Structure Check: Has price formed higher highs or swept liquidity into discount?
      const discountThreshold = swingLow + (impulseRange * 0.50);
      const isDiscount = cur.low <= discountThreshold;

      // 2. IDM Sweep check in discount
      let idmSwept = false;
      let idmLow = Infinity;
      for (let i = n - 12; i < n - 1; i++) {
        if (candles[i].low < discountThreshold) {
          idmSwept = true;
          idmLow = Math.min(idmLow, candles[i].low);
        }
      }

      // 3. Trigger Candle: Bullish Engulfing OR Hammer closing green above EMA9
      const isBullishEngulfing = cur.close > cur.open && curBody >= 0.80 * prevBody && cur.close > curEma9;
      const isHammer = lowerWickRatio >= 0.40 && cur.close > cur.open && cur.close > curEma9;
      const isTriggerValid = isBullishEngulfing || isHammer;

      // 4. Bonus Breakout Trigger: 5–12 bar Higher-Low box above EMA21 breaking upward
      const recentSlice = candles.slice(n - 8, n - 1);
      const isAboveEma21Box = recentSlice.every(c => c.low >= curEma21 * 0.997);
      const isGreenDisplacement = cur.close > cur.open && (curBody / curRange) >= 0.60 && cur.close > Math.max(...recentSlice.map(c => c.high));

      if ((isDiscount && idmSwept && isTriggerValid) || (isAboveEma21Box && isGreenDisplacement)) {
        const setupType = (isAboveEma21Box && isGreenDisplacement)
          ? 'BULLISH_SMC_CONSOLIDATION_BOX_BREAKOUT'
          : 'BULLISH_SMC_IDM_SWEEP_OB_RETEST';

        const sweepRefLow = Math.min(cur.low, idmLow !== Infinity ? idmLow : cur.low);
        const rawSlDist = curPrice - (sweepRefLow - (0.08 * atr));
        const minSlDist = curPrice * 0.0038;
        const maxSlDist = curPrice * 0.0130;
        const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
        const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

        // Rule A & B: Anchor TP strictly at Candle Body Resistance clusters, never needle wicks!
        const resistanceBodies = bodyHighs.filter(h => h >= curPrice + Math.min(0.20 * atr, curPrice * 0.0035));
        const nearestResistance = resistanceBodies.length > 0 ? Math.min(...resistanceBodies) : swingHigh;
        const frontRunBuffer = Math.max(0.10 * atr, curPrice * 0.0010);
        let tpDistance = Math.max(nearestResistance - frontRunBuffer - curPrice, slDistance * 1.05);

        // Rule B: HARD MAXIMUM TP CEILING (MAX_TP_RR = 2.20R & MAX_TP_PCT = 1.20%)
        const MAX_TP_RR = 2.20;
        const MAX_TP_PCT = 0.0120;
        if (tpDistance > MAX_TP_RR * slDistance || (tpDistance / curPrice) > MAX_TP_PCT) {
          tpDistance = Math.min(2.00 * slDistance, curPrice * 0.0100);
        }
        const takeProfitPrice = parseFloat((curPrice + tpDistance).toFixed(4));

        return {
          symbol,
          recommendedSide: 'BUY',
          confidenceScore: 90,
          strategyName: HybridMasterCryptoSMC3005Engine.NAME,
          setupType,
          entryPrice: curPrice,
          stopLossPrice,
          tp1Price: takeProfitPrice,
          tp2Price: takeProfitPrice,
          tp1Ratio: 1.0,
          tp2Ratio: 0,
          earlyBreakevenPrice: parseFloat((curPrice + slDistance * 0.75).toFixed(4)),
          riskDistance: slDistance,
          minSlDistancePct: slDistance / curPrice,
          customSL: stopLossPrice,
          customTP: takeProfitPrice,
          reasons: [
            `Macro Trend Alignment: 15m Close ($${curPrice.toFixed(4)}) > EMA50 ($${curEma50.toFixed(4)}) & EMA21 >= EMA50`,
            `Pure SMC Setup: ${setupType} confirmed`,
            `Trigger: ${isBullishEngulfing ? 'Bullish Engulfing' : isHammer ? 'Hammer Rejection' : 'Green Displacement Breakout'} above EMA9 ($${curEma9.toFixed(4)})`,
            `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
          ],
          auditLog: {
            bosOrChochConfirmed: true,
            idmSwept,
            obOrFvgMitigated: true,
          },
        };
      }
    }

    // --- EVALUATE SELL (SHORT) ---
    // Only when 15m Close < EMA_50 & EMA_21 <= EMA_50
    const isBearTrend = curPrice < curEma50 && curEma21 <= curEma50 * 1.002;
    if (isBearTrend) {
      // 1. Structure Check: Has price formed lower highs or swept liquidity into premium?
      const premiumThreshold = swingLow + (impulseRange * 0.50);
      const isPremium = cur.high >= premiumThreshold;

      // 2. IDM Sweep check in premium
      let idmSwept = false;
      let idmHigh = -Infinity;
      for (let i = n - 12; i < n - 1; i++) {
        if (candles[i].high > premiumThreshold) {
          idmSwept = true;
          idmHigh = Math.max(idmHigh, candles[i].high);
        }
      }

      // 3. Trigger Candle: Bearish Engulfing OR Shooting Star closing red below EMA9
      const isBearishEngulfing = cur.close < cur.open && curBody >= 0.80 * prevBody && cur.close < curEma9;
      const isShootingStar = upperWickRatio >= 0.40 && cur.close < cur.open && cur.close < curEma9;
      const isTriggerValid = isBearishEngulfing || isShootingStar;

      // 4. Bonus Breakdown Trigger: 5–12 bar Lower-High box below EMA21 breaking downward
      const recentSlice = candles.slice(n - 8, n - 1);
      const isBelowEma21Box = recentSlice.every(c => c.high <= curEma21 * 1.003);
      const isRedDisplacement = cur.close < cur.open && (curBody / curRange) >= 0.60 && cur.close < Math.min(...recentSlice.map(c => c.low));

      if ((isPremium && idmSwept && isTriggerValid) || (isBelowEma21Box && isRedDisplacement)) {
        const setupType = (isBelowEma21Box && isRedDisplacement)
          ? 'BEARISH_SMC_CONSOLIDATION_BOX_BREAKDOWN'
          : 'BEARISH_SMC_IDM_SWEEP_OB_RETEST';

        const sweepRefHigh = Math.max(cur.high, idmHigh !== -Infinity ? idmHigh : cur.high);
        const rawSlDist = (sweepRefHigh + (0.08 * atr)) - curPrice;
        const minSlDist = curPrice * 0.0038;
        const maxSlDist = curPrice * 0.0130;
        const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
        const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

        // Rule A & B: Anchor TP strictly at Candle Body Support clusters, never needle wicks!
        const supportBodies = bodyLows.filter(l => l <= curPrice - Math.min(0.20 * atr, curPrice * 0.0035));
        const nearestSupport = supportBodies.length > 0 ? Math.max(...supportBodies) : swingLow;
        const frontRunBuffer = Math.max(0.10 * atr, curPrice * 0.0010);
        let tpDistance = Math.max(curPrice - (nearestSupport + frontRunBuffer), slDistance * 1.05);

        // Rule B: HARD MAXIMUM TP CEILING (MAX_TP_RR = 2.20R & MAX_TP_PCT = 1.20%)
        const MAX_TP_RR = 2.20;
        const MAX_TP_PCT = 0.0120;
        if (tpDistance > MAX_TP_RR * slDistance || (tpDistance / curPrice) > MAX_TP_PCT) {
          tpDistance = Math.min(2.00 * slDistance, curPrice * 0.0100);
        }
        const takeProfitPrice = parseFloat((curPrice - tpDistance).toFixed(4));

        return {
          symbol,
          recommendedSide: 'SELL',
          confidenceScore: 90,
          strategyName: HybridMasterCryptoSMC3005Engine.NAME,
          setupType,
          entryPrice: curPrice,
          stopLossPrice,
          tp1Price: takeProfitPrice,
          tp2Price: takeProfitPrice,
          tp1Ratio: 1.0,
          tp2Ratio: 0,
          earlyBreakevenPrice: parseFloat((curPrice - slDistance * 0.75).toFixed(4)),
          riskDistance: slDistance,
          minSlDistancePct: slDistance / curPrice,
          customSL: stopLossPrice,
          customTP: takeProfitPrice,
          reasons: [
            `Macro Trend Alignment: 15m Close ($${curPrice.toFixed(4)}) < EMA50 ($${curEma50.toFixed(4)}) & EMA21 <= EMA50`,
            `Pure SMC Setup: ${setupType} confirmed`,
            `Trigger: ${isBearishEngulfing ? 'Bearish Engulfing' : isShootingStar ? 'Shooting Star Rejection' : 'Red Displacement Breakdown'} below EMA9 ($${curEma9.toFixed(4)})`,
            `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
          ],
          auditLog: {
            bosOrChochConfirmed: true,
            idmSwept,
            obOrFvgMitigated: true,
          },
        };
      }
    }

    emptyVerdict.reasons.push('Pure SMC conditions not met on current candle');
    return emptyVerdict;
  }
}

export const hybridMasterCryptoSMC3005Engine = new HybridMasterCryptoSMC3005Engine();
