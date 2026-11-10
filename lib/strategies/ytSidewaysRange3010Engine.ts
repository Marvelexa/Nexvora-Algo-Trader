import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict, StandardStrategyEngine, createEmptyStandardVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3010: TRADE PRIME SIDEWAYS RANGE BOUNDARY FADE ENGINE
 * 
 * PRIMARY VIDEO REFERENCE:
 * Trade Prime - "Best Strategies to Trade in a Sideways Market" (https://www.youtube.com/watch?v=OhXnH8FnTzc)
 * 
 * EXACT ISOLATED RULES:
 * STRICT REGIME LOCK:
 * - ONLY active when 15m ADX_14 < 22 (true sideways consolidation).
 * - If ADX_14 >= 22 (trending market), Port 3010 MUST NOT fade the range!
 * 
 * WHEN TO BUY (LONG):
 * 1. ADX_14 < 22 (Sideways regime) AND Close >= EMA_50 * 0.992 (not in a macro crash).
 * 2. Price is in the Bottom 30% Discount Zone (RangePos_30bars <= 0.30),
 *    sweeps the range low wick, and closes a green reversal candle (Close > EMA_9).
 * 3. Target: Top 70%–85% of the sideways range (>= 0.70% move and >= 1.35 * SL).
 * 4. SL: Sweep low wick - 0.08 * ATR (clamped 0.38%–0.55%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. ADX_14 < 22 (Sideways regime) AND Close <= EMA_50 * 1.008 (not in a macro pump).
 * 2. Price is in the Top 70% Premium Zone (RangePos_30bars >= 0.70),
 *    sweeps the range high wick, and closes a red rejection candle (Close < EMA_9).
 * 3. Target: Bottom 15%–30% of the sideways range (>= 0.70% move and >= 1.35 * SL).
 * 4. SL: Sweep high wick + 0.08 * ATR (clamped 0.38%–0.55%).
 * ============================================================================
 */

export interface YtSidewaysRange3010Verdict extends StandardStrategyVerdict {
  customSL?: number;
  customTP?: number;
}

export class YtSidewaysRange3010Engine implements StandardStrategyEngine {
  public static readonly PORT = 3010;
  public static readonly STRATEGY_NAME = 'YT_SIDEWAYS_RANGE_ENGINE';
  public static readonly MIN_SL_DISTANCE_PCT = 0.0038;

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

  public static calculateADX(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < period * 2) return 15;
    let plusDM = 0;
    let minusDM = 0;
    let trSum = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
      const cur = candles[i];
      const prev = candles[i - 1];
      const upMove = cur.high - prev.high;
      const downMove = prev.low - cur.low;

      if (upMove > downMove && upMove > 0) plusDM += upMove;
      if (downMove > upMove && downMove > 0) minusDM += downMove;

      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      );
      trSum += tr;
    }

    if (trSum === 0) return 15;
    const plusDI = (plusDM / trSum) * 100;
    const minusDI = (minusDM / trSum) * 100;
    const diSum = plusDI + minusDI;
    if (diSum === 0) return 15;
    const dx = (Math.abs(plusDI - minusDI) / diSum) * 100;
    return dx;
  }

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtSidewaysRange3010Verdict {
    return YtSidewaysRange3010Engine.evaluateSetup(symbol, candles, accountEquity, microData);
  }

  public static evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtSidewaysRange3010Verdict {
    const curPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
    const emptyVerdict: YtSidewaysRange3010Verdict = {
      ...createEmptyStandardVerdict(symbol, this.STRATEGY_NAME, curPrice),
      customSL: 0,
      customTP: 0,
    };

    if (!candles || candles.length < 40) {
      emptyVerdict.reasons.push('Insufficient candle history (<40 bars) for Sideways Range Engine');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const closes = candles.map(c => c.close);
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema9Arr = this.calculateEMA(closes, 9);
    const atr = Math.max(this.calculateATR(candles, 14), curPrice * 0.002);
    const adx = this.calculateADX(candles, 14);

    const curEma50 = ema50Arr[n - 1];
    const curEma9 = ema9Arr[n - 1];

    // 1. STRICT REGIME LOCK: ONLY active when 15m ADX_14 < 22
    if (adx >= 22) {
      emptyVerdict.reasons.push(`STRICT REGIME LOCK: Market is trending (ADX: ${adx.toFixed(1)} >= 22). Sideways Range Fade is disabled in trending markets.`);
      return emptyVerdict;
    }

    // 2. 30-bar box range mapping
    const boxSlice = candles.slice(n - 30);
    const boxHigh = Math.max(...boxSlice.map(c => c.high));
    const boxLow = Math.min(...boxSlice.map(c => c.low));
    const boxSpan = boxHigh - boxLow;

    if (boxSpan <= 0) {
      emptyVerdict.reasons.push('Invalid flat sideways box range');
      return emptyVerdict;
    }

    const rangePos30 = (curPrice - boxLow) / boxSpan;

    // --- EVALUATE BUY (LONG) ---
    // Price in Bottom 30% Discount (rangePos <= 0.30), Close >= EMA50 * 0.992, sweeps low wick, closes green above EMA9
    const isDiscountZone = rangePos30 <= 0.30 && curPrice >= curEma50 * 0.992;
    const isSweepReversalBuy = cur.low <= boxLow * 1.002 && cur.close > cur.open && cur.close > curEma9;

    if (isDiscountZone && isSweepReversalBuy) {
      const rawSlDist = curPrice - (cur.low - (0.08 * atr));
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

      // Target: Top 75%–85% of sideways range
      const targetHigh = boxLow + (boxSpan * 0.80);
      const structuralTpDist = targetHigh - curPrice;
      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const tpDistance = Math.max(structuralTpDist, minTpDist);
      const takeProfitPrice = parseFloat((curPrice + tpDistance).toFixed(4));

      return {
        symbol,
        recommendedSide: 'BUY',
        confidenceScore: 88,
        strategyName: YtSidewaysRange3010Engine.STRATEGY_NAME,
        setupType: 'SIDEWAYS_RANGE_BOTTOM_FADE_BUY',
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
          `Regime Lock PASS: ADX (${adx.toFixed(1)}) < 22 confirmed Sideways Consolidation`,
          `Range Position PASS: Price in Bottom 30% Discount (${(rangePos30 * 100).toFixed(1)}%) of 30-bar box [$${boxLow.toFixed(4)} - $${boxHigh.toFixed(4)}]`,
          `Sweep Reversal PASS: Swept range low ($${cur.low.toFixed(4)}) and closed green above EMA9 ($${curEma9.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    // --- EVALUATE SELL (SHORT) ---
    // Price in Top 70% Premium (rangePos >= 0.70), Close <= EMA50 * 1.008, sweeps high wick, closes red below EMA9
    const isPremiumZone = rangePos30 >= 0.70 && curPrice <= curEma50 * 1.008;
    const isSweepRejectionSell = cur.high >= boxHigh * 0.998 && cur.close < cur.open && cur.close < curEma9;

    if (isPremiumZone && isSweepRejectionSell) {
      const rawSlDist = (cur.high + (0.08 * atr)) - curPrice;
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

      // Target: Bottom 20%–25% of sideways range
      const targetLow = boxLow + (boxSpan * 0.20);
      const structuralTpDist = curPrice - targetLow;
      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const tpDistance = Math.max(structuralTpDist, minTpDist);
      const takeProfitPrice = parseFloat((curPrice - tpDistance).toFixed(4));

      return {
        symbol,
        recommendedSide: 'SELL',
        confidenceScore: 88,
        strategyName: YtSidewaysRange3010Engine.STRATEGY_NAME,
        setupType: 'SIDEWAYS_RANGE_TOP_FADE_SELL',
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
          `Regime Lock PASS: ADX (${adx.toFixed(1)}) < 22 confirmed Sideways Consolidation`,
          `Range Position PASS: Price in Top 70% Premium (${(rangePos30 * 100).toFixed(1)}%) of 30-bar box [$${boxLow.toFixed(4)} - $${boxHigh.toFixed(4)}]`,
          `Sweep Rejection PASS: Swept range high ($${cur.high.toFixed(4)}) and closed red below EMA9 ($${curEma9.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    emptyVerdict.reasons.push('Trade Prime Sideways Range conditions not met on current candle');
    return emptyVerdict;
  }
}

export const ytSidewaysRange3010Engine = new YtSidewaysRange3010Engine();
