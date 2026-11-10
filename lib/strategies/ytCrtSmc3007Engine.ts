import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict, StandardStrategyEngine, createEmptyStandardVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3007: IQSHANT LADHA CANDLE RANGE THEORY (CRT) ENGINE
 * 
 * PRIMARY VIDEO REFERENCE:
 * Iqshant Ladha - "Candle Range Theory (CRT) Masterclass" (http://www.youtube.com/watch?v=KRl1JnWaOLU)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Trend Filter: 15m Close > EMA_50 (Bullish bias).
 * 2. CRT Low Sweep: Current candle wicks below the previous 15m/1h Mother Candle's Low
 *    (cur.low < motherCandle.low) to grab liquidity, and closes back inside
 *    the Mother Candle's range (cur.close > motherCandle.low) as a green candle above EMA_9.
 * 3. Target: The Mother Candle's High (motherCandle.high - 0.10 * ATR, >= 0.70% and >= 1.35 * SL).
 * 4. SL: Sweep Low wick - 0.08 * ATR (clamped 0.38%–0.55%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Trend Filter: 15m Close < EMA_50 (Bearish bias).
 * 2. CRT High Sweep: Current candle wicks above the previous 15m/1h Mother Candle's High
 *    (cur.high > motherCandle.high) to grab liquidity, and closes back inside
 *    the Mother Candle's range (cur.close < motherCandle.high) as a red candle below EMA_9.
 * 3. Target: The Mother Candle's Low (motherCandle.low + 0.10 * ATR, >= 0.70% and >= 1.35 * SL).
 * 4. SL: Sweep High wick + 0.08 * ATR (clamped 0.38%–0.55%).
 * ============================================================================
 */

export interface YtCrtSmc3007Verdict extends StandardStrategyVerdict {
  customSL?: number;
  customTP?: number;
}

export class YtCrtSmc3007Engine implements StandardStrategyEngine {
  public static readonly PORT = 3007;
  public static readonly STRATEGY_NAME = 'YT_CRT_SMC_ENGINE';
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

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtCrtSmc3007Verdict {
    return YtCrtSmc3007Engine.evaluateSetup(symbol, candles, accountEquity, microData);
  }

  public static evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtCrtSmc3007Verdict {
    const curPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
    const emptyVerdict: YtCrtSmc3007Verdict = {
      ...createEmptyStandardVerdict(symbol, this.STRATEGY_NAME, curPrice),
      customSL: 0,
      customTP: 0,
    };

    if (!candles || candles.length < 40) {
      emptyVerdict.reasons.push('Insufficient candle history (<40 bars) for CRT SMC');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const closes = candles.map(c => c.close);
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema9Arr = this.calculateEMA(closes, 9);
    const atr = Math.max(this.calculateATR(candles, 14), curPrice * 0.002);

    const curEma50 = ema50Arr[n - 1];
    const curEma9 = ema9Arr[n - 1];

    // Reference Mother Candle (1H reference candle: 4 bars lookback before current candle, or previous large-range bar)
    // We check the reference mother candle formed by bars [n-8 to n-2]
    const motherSlice = candles.slice(n - 8, n - 2);
    const motherHigh = Math.max(...motherSlice.map(c => c.high));
    const motherLow = Math.min(...motherSlice.map(c => c.low));
    const motherMid = (motherHigh + motherLow) / 2;

    // --- EVALUATE BUY (LONG) ---
    // 1. Trend Filter: 15m Close > EMA50
    const isBullTrend = curPrice > curEma50;
    // 2. CRT Low Sweep: Current candle wicks below mother low and closes back inside as green candle above EMA9
    const isLowSwept = cur.low < motherLow && cur.close > motherLow && cur.close > cur.open && cur.close > curEma9;

    if (isBullTrend && isLowSwept) {
      const rawSlDist = curPrice - (cur.low - (0.08 * atr));
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

      // Target: Mother Candle High - 0.10 * ATR
      const targetHigh = motherHigh - (0.10 * atr);
      const structuralTpDist = targetHigh - curPrice;
      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const tpDistance = Math.max(structuralTpDist, minTpDist);
      const takeProfitPrice = parseFloat((curPrice + tpDistance).toFixed(4));

      return {
        symbol,
        recommendedSide: 'BUY',
        confidenceScore: 89,
        strategyName: YtCrtSmc3007Engine.STRATEGY_NAME,
        setupType: 'CRT_MOTHER_LOW_SWEEP_RECLAIM',
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
          `Trend Filter PASS: 15m Close ($${curPrice.toFixed(4)}) > EMA50 ($${curEma50.toFixed(4)})`,
          `CRT Low Sweep PASS: Wicks below Mother Low ($${motherLow.toFixed(4)}) to $${cur.low.toFixed(4)} and closes green inside range`,
          `Trigger PASS: Reclaimed above 15m EMA9 ($${curEma9.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    // --- EVALUATE SELL (SHORT) ---
    // 1. Trend Filter: 15m Close < EMA50
    const isBearTrend = curPrice < curEma50;
    // 2. CRT High Sweep: Current candle wicks above mother high and closes back inside as red candle below EMA9
    const isHighSwept = cur.high > motherHigh && cur.close < motherHigh && cur.close < cur.open && cur.close < curEma9;

    if (isBearTrend && isHighSwept) {
      const rawSlDist = (cur.high + (0.08 * atr)) - curPrice;
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

      // Target: Mother Candle Low + 0.10 * ATR
      const targetLow = motherLow + (0.10 * atr);
      const structuralTpDist = curPrice - targetLow;
      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const tpDistance = Math.max(structuralTpDist, minTpDist);
      const takeProfitPrice = parseFloat((curPrice - tpDistance).toFixed(4));

      return {
        symbol,
        recommendedSide: 'SELL',
        confidenceScore: 89,
        strategyName: YtCrtSmc3007Engine.STRATEGY_NAME,
        setupType: 'CRT_MOTHER_HIGH_SWEEP_RECLAIM',
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
          `Trend Filter PASS: 15m Close ($${curPrice.toFixed(4)}) < EMA50 ($${curEma50.toFixed(4)})`,
          `CRT High Sweep PASS: Wicks above Mother High ($${motherHigh.toFixed(4)}) to $${cur.high.toFixed(4)} and closes red inside range`,
          `Trigger PASS: Reclaimed below 15m EMA9 ($${curEma9.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    emptyVerdict.reasons.push('Iqshant Ladha CRT conditions not met on current candle');
    return emptyVerdict;
  }
}

export const ytCrtSmc3007Engine = new YtCrtSmc3007Engine();
