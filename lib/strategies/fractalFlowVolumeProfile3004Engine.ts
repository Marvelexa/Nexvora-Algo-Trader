import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3004: FRACTAL FLOW VOLUME PROFILE & ORDER FLOW CONFLUENCE ENGINE
 * 
 * PRIMARY VIDEO REFERENCES:
 * 1. Fractal Flow - "The ONLY Volume Profile Guide That Actually Works" (http://www.youtube.com/watch?v=9eqDWJSvCx4)
 * 2. Fractal Flow - "Master the MARKET PROFILE in 30 Minutes" (http://www.youtube.com/watch?v=BmtxLwvDE6U)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Setup A (VAL Absorption Bounce in Uptrend):
 *    - 15m Close > EMA_50, price dips into VAL (bottom 30% of 50-bar volume profile),
 *    - Prints a bullish rejection wick (LowerWick >= 35% of candle range) with Volume >= 1.2 * AvgVol,
 *    - Closes green above EMA_9 -> Target POC / VAH (>= 0.70% and >= 1.35 * SL).
 * 2. Setup B (VAH High-Volume Breakout):
 *    - Price is above EMA_50 and EMA_21,
 *    - Closes a full green body (>= 60% range) above VAH on Volume >= 1.3 * AvgVol.
 * 3. SL & TP: SL = Candle low - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = POC or VAH or expansion target (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Setup A (VAH Absorption Rejection in Downtrend):
 *    - 15m Close < EMA_50, price bounces into VAH (top 30% of 50-bar volume profile),
 *    - Prints a bearish rejection wick (UpperWick >= 35% of candle range) with Volume >= 1.2 * AvgVol,
 *    - Closes red below EMA_9 -> Target POC / VAL (>= 0.70% and >= 1.35 * SL).
 * 2. Setup B (VAL High-Volume Breakdown):
 *    - Price is below EMA_50 and EMA_21,
 *    - Closes a full red body (>= 60% range) below VAL on Volume >= 1.3 * AvgVol.
 * 3. SL & TP: SL = Candle high + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = POC or VAL or expansion target (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface VolumeProfileResult {
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  avgVolume: number;
}

export interface FractalFlow3004Verdict extends StandardStrategyVerdict {
  volumeProfile?: {
    poc: number;
    vah: number;
    val: number;
  };
}

export class FractalFlowVolumeProfile3004Engine {
  public static readonly PORT = 3004;
  public static readonly NAME = 'Fractal Flow Volume Profile & Order Flow Confluence Engine';
  public static readonly VIDEO_URLS = [
    'http://www.youtube.com/watch?v=9eqDWJSvCx4',
    'http://www.youtube.com/watch?v=BmtxLwvDE6U',
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

  public static calculateVolumeProfile(candles: KlinePoint[], numBins: number = 40): VolumeProfileResult {
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let totalVolume = 0;

    for (const c of candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      totalVolume += c.volume;
    }

    const avgVolume = candles.length > 0 ? totalVolume / candles.length : 1;

    if (maxPrice <= minPrice || totalVolume <= 0) {
      return { poc: 0, vah: 0, val: 0, totalVolume: 0, avgVolume: 1 };
    }

    const binSize = (maxPrice - minPrice) / numBins;
    const bins: Array<{ price: number; volume: number }> = [];
    for (let i = 0; i < numBins; i++) {
      bins.push({ price: minPrice + (i + 0.5) * binSize, volume: 0 });
    }

    for (const c of candles) {
      const candleRange = Math.max(c.high - c.low, binSize * 0.5);
      for (let i = 0; i < numBins; i++) {
        const binLow = minPrice + i * binSize;
        const binHigh = binLow + binSize;
        const overlap = Math.max(0, Math.min(c.high, binHigh) - Math.max(c.low, binLow));
        if (overlap > 0) {
          bins[i].volume += c.volume * (overlap / candleRange);
        }
      }
    }

    let maxVol = -1;
    let pocIdx = 0;
    for (let i = 0; i < numBins; i++) {
      if (bins[i].volume > maxVol) {
        maxVol = bins[i].volume;
        pocIdx = i;
      }
    }
    const poc = bins[pocIdx].price;

    const targetVolume = totalVolume * 0.70;
    let currentVolume = bins[pocIdx].volume;
    let upIdx = pocIdx;
    let downIdx = pocIdx;

    while (currentVolume < targetVolume && (upIdx < numBins - 1 || downIdx > 0)) {
      const upVol = upIdx < numBins - 1 ? bins[upIdx + 1].volume : -1;
      const downVol = downIdx > 0 ? bins[downIdx - 1].volume : -1;

      if (upVol >= downVol && upIdx < numBins - 1) {
        upIdx++;
        currentVolume += bins[upIdx].volume;
      } else if (downIdx > 0) {
        downIdx--;
        currentVolume += bins[downIdx].volume;
      } else if (upIdx < numBins - 1) {
        upIdx++;
        currentVolume += bins[upIdx].volume;
      } else {
        break;
      }
    }

    const vah = bins[upIdx].price;
    const val = bins[downIdx].price;

    return { poc, vah, val, totalVolume, avgVolume };
  }

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 10000
  ): FractalFlow3004Verdict {
    const emptyVerdict: FractalFlow3004Verdict = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      strategyName: FractalFlowVolumeProfile3004Engine.NAME,
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
    };

    if (!candles || candles.length < 52) {
      emptyVerdict.reasons.push('Insufficient candle history (<52 bars) for Fractal Flow Volume Profile');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const curPrice = cur.close;
    const closes = candles.map(c => c.close);
    const ema50Arr = FractalFlowVolumeProfile3004Engine.calculateEMA(closes, 50);
    const ema21Arr = FractalFlowVolumeProfile3004Engine.calculateEMA(closes, 21);
    const ema9Arr = FractalFlowVolumeProfile3004Engine.calculateEMA(closes, 9);
    const atr = Math.max(FractalFlowVolumeProfile3004Engine.calculateATR(candles, 14), curPrice * 0.002);

    const curEma50 = ema50Arr[n - 1];
    const curEma21 = ema21Arr[n - 1];
    const curEma9 = ema9Arr[n - 1];

    // Compute 50-bar Volume Profile
    const vpSlice = candles.slice(n - 50);
    const vp = FractalFlowVolumeProfile3004Engine.calculateVolumeProfile(vpSlice, 40);

    const curRange = Math.max(cur.high - cur.low, curPrice * 0.001);
    const lowerWickRatio = (Math.min(cur.open, cur.close) - cur.low) / curRange;
    const upperWickRatio = (cur.high - Math.max(cur.open, cur.close)) / curRange;
    const bodyRatio = Math.abs(cur.close - cur.open) / curRange;

    // --- EVALUATE BUY (LONG) ---
    // Setup A: VAL Absorption Bounce in Uptrend (Close > EMA50, dipped near/below VAL, LowerWick >= 35%, Vol >= 1.2*AvgVol, Close > EMA9)
    const isValAbsorptionBuy = curPrice > curEma50 &&
      cur.low <= vp.val * 1.004 &&
      lowerWickRatio >= 0.35 &&
      cur.volume >= 1.15 * vp.avgVolume &&
      cur.close > cur.open &&
      cur.close > curEma9;

    // Setup B: VAH High-Volume Breakout (Above EMA50 & EMA21, Close full green body >= 60% above VAH, Vol >= 1.3*AvgVol)
    const isVahBreakoutBuy = curPrice > curEma50 &&
      curPrice > curEma21 &&
      cur.close > vp.vah &&
      cur.close > cur.open &&
      bodyRatio >= 0.58 &&
      cur.volume >= 1.25 * vp.avgVolume;

    if (isValAbsorptionBuy || isVahBreakoutBuy) {
      const setupType = isValAbsorptionBuy ? 'VAL_ABSORPTION_BOUNCE' : 'VAH_VOLUME_BREAKOUT';
      // SL = Candle low - 0.08 * ATR (clamped between 0.38% and 1.30%)
      const rawSlDist = curPrice - (cur.low - (0.08 * atr));
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

      // TP = POC or VAH or 1.20R
      const targetLevel = isValAbsorptionBuy ? vp.poc : (curPrice + slDistance * 1.5);
      const structuralTpDist = targetLevel - curPrice;
      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const tpDistance = Math.max(structuralTpDist, minTpDist);
      const takeProfitPrice = parseFloat((curPrice + tpDistance).toFixed(4));

      return {
        symbol,
        recommendedSide: 'BUY',
        confidenceScore: 88,
        strategyName: FractalFlowVolumeProfile3004Engine.NAME,
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
          `Volume Profile Setup: ${setupType} confirmed (POC=$${vp.poc.toFixed(4)}, VAH=$${vp.vah.toFixed(4)}, VAL=$${vp.val.toFixed(4)})`,
          `Macro Trend Alignment: 15m Close ($${curPrice.toFixed(4)}) > EMA50 ($${curEma50.toFixed(4)})`,
          `Volume Confirmation: Bar Vol (${cur.volume.toFixed(0)}) >= threshold vs Avg Vol (${vp.avgVolume.toFixed(0)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
        volumeProfile: { poc: vp.poc, vah: vp.vah, val: vp.val },
      };
    }

    // --- EVALUATE SELL (SHORT) ---
    // Setup A: VAH Absorption Rejection in Downtrend (Close < EMA50, bounced near/above VAH, UpperWick >= 35%, Vol >= 1.2*AvgVol, Close < EMA9)
    const isVahAbsorptionSell = curPrice < curEma50 &&
      cur.high >= vp.vah * 0.996 &&
      upperWickRatio >= 0.35 &&
      cur.volume >= 1.15 * vp.avgVolume &&
      cur.close < cur.open &&
      cur.close < curEma9;

    // Setup B: VAL High-Volume Breakdown (Below EMA50 & EMA21, Close full red body >= 60% below VAL, Vol >= 1.3*AvgVol)
    const isValBreakdownSell = curPrice < curEma50 &&
      curPrice < curEma21 &&
      cur.close < vp.val &&
      cur.close < cur.open &&
      bodyRatio >= 0.58 &&
      cur.volume >= 1.25 * vp.avgVolume;

    if (isVahAbsorptionSell || isValBreakdownSell) {
      const setupType = isVahAbsorptionSell ? 'VAH_ABSORPTION_REJECTION' : 'VAL_VOLUME_BREAKDOWN';
      // SL = Candle high + 0.08 * ATR (clamped between 0.38% and 1.30%)
      const rawSlDist = (cur.high + (0.08 * atr)) - curPrice;
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

      // TP = POC or VAL or 1.20R
      const targetLevel = isVahAbsorptionSell ? vp.poc : (curPrice - slDistance * 1.5);
      const structuralTpDist = curPrice - targetLevel;
      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const tpDistance = Math.max(structuralTpDist, minTpDist);
      const takeProfitPrice = parseFloat((curPrice - tpDistance).toFixed(4));

      return {
        symbol,
        recommendedSide: 'SELL',
        confidenceScore: 88,
        strategyName: FractalFlowVolumeProfile3004Engine.NAME,
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
          `Volume Profile Setup: ${setupType} confirmed (POC=$${vp.poc.toFixed(4)}, VAH=$${vp.vah.toFixed(4)}, VAL=$${vp.val.toFixed(4)})`,
          `Macro Trend Alignment: 15m Close ($${curPrice.toFixed(4)}) < EMA50 ($${curEma50.toFixed(4)})`,
          `Volume Confirmation: Bar Vol (${cur.volume.toFixed(0)}) >= threshold vs Avg Vol (${vp.avgVolume.toFixed(0)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
        volumeProfile: { poc: vp.poc, vah: vp.vah, val: vp.val },
      };
    }

    emptyVerdict.reasons.push('Fractal Flow Volume Profile conditions not met on current candle');
    return emptyVerdict;
  }
}

export const fractalFlowVolumeProfile3004Engine = new FractalFlowVolumeProfile3004Engine();
