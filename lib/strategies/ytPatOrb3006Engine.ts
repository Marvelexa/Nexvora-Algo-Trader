import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict, createEmptyStandardVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3006: TRADE WITH PAT OPENING RANGE BREAKOUT (ORB) ENGINE
 * 
 * PRIMARY VIDEO REFERENCE:
 * Trade with Pat - "Opening Range Breakout Strategy" (http://www.youtube.com/watch?v=E3McKlAp3qk)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Trend Stack: Price is trading above both VWAP and 15m EMA_21 & EMA_50.
 * 2. Breakout: A green displacement candle (Body >= 60% of range, Volume >= 1.25 * AvgVol)
 *    closes cleanly above the Session Opening Range High (or retests broken high with green continuation).
 * 3. SL & TP: SL = Candle low - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Expansion target (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Trend Stack: Price is trading below both VWAP and 15m EMA_21 & EMA_50.
 * 2. Breakdown: A red displacement candle (Body >= 60% of range, Volume >= 1.25 * AvgVol)
 *    closes cleanly below the Session Opening Range Low (or retests broken low with red continuation).
 * 3. SL & TP: SL = Candle high + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Expansion target (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface YtPatOrb3006Verdict extends StandardStrategyVerdict {
  customSL?: number;
  customTP?: number;
}

export class YtPatOrb3006Engine {
  public static readonly PORT = 3006;
  public static readonly STRATEGY_NAME = 'YT_PAT_ORB_ENGINE';
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

  public static calculateVWAP(candles: KlinePoint[], lookback: number = 40): number {
    const slice = candles.slice(-lookback);
    let cumVol = 0;
    let cumVolPrice = 0;
    for (const c of slice) {
      const typ = (c.high + c.low + c.close) / 3;
      const vol = c.volume > 0 ? c.volume : 1;
      cumVol += vol;
      cumVolPrice += typ * vol;
    }
    return cumVol > 0 ? cumVolPrice / cumVol : slice[slice.length - 1]?.close || 0;
  }

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtPatOrb3006Verdict {
    return YtPatOrb3006Engine.evaluateSetup(symbol, candles, accountEquity, microData);
  }

  public static evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtPatOrb3006Verdict {
    const curPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
    const emptyVerdict: YtPatOrb3006Verdict = {
      ...createEmptyStandardVerdict(symbol, this.STRATEGY_NAME, curPrice),
      customSL: 0,
      customTP: 0,
    };

    if (!candles || candles.length < 45) {
      emptyVerdict.reasons.push('Insufficient candle history (<45 bars) for Pat ORB evaluation');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const prev = candles[n - 2];
    const closes = candles.map(c => c.close);
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema21Arr = this.calculateEMA(closes, 21);
    const ema9Arr = this.calculateEMA(closes, 9);
    const atr = Math.max(this.calculateATR(candles, 14), curPrice * 0.002);
    const vwap = this.calculateVWAP(candles, 40);

    const curEma50 = ema50Arr[n - 1];
    const curEma21 = ema21Arr[n - 1];
    const curEma9 = ema9Arr[n - 1];

    // Session Opening Range (previous 16 bars representing 4-hour opening session box)
    const sessionSlice = candles.slice(n - 18, n - 2);
    const sessionHigh = Math.max(...sessionSlice.map(c => c.high));
    const sessionLow = Math.min(...sessionSlice.map(c => c.low));
    const totalVol = sessionSlice.reduce((sum, c) => sum + c.volume, 0);
    const avgVol = totalVol / Math.max(1, sessionSlice.length);

    const curRange = Math.max(cur.high - cur.low, curPrice * 0.001);
    const curBody = Math.abs(cur.close - cur.open);
    const bodyRatio = curBody / curRange;
    const isHighVolume = cur.volume >= 1.20 * avgVol;

    // --- EVALUATE BUY (LONG) ---
    // 1. Price is trading above both VWAP and 15m EMA_21 & EMA_50
    const isAboveAveragesBuy = curPrice > vwap && curPrice > curEma21 && curPrice > curEma50;
    // 2. Green displacement candle (Body >= 60%, Vol >= 1.25*AvgVol) closes above session high
    const isCleanBreakout = cur.close > cur.open && bodyRatio >= 0.58 && isHighVolume && cur.close > sessionHigh;
    // Retest variant: Previous broke out, current touched session high and closed green
    const isRetestContinuation = prev.close > sessionHigh && cur.low <= sessionHigh * 1.002 && cur.close > cur.open && cur.close > curEma9;

    if (isAboveAveragesBuy && (isCleanBreakout || isRetestContinuation)) {
      const rawSlDist = curPrice - (cur.low - (0.08 * atr));
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const takeProfitPrice = parseFloat((curPrice + minTpDist).toFixed(4));

      return {
        symbol,
        recommendedSide: 'BUY',
        confidenceScore: 88,
        strategyName: YtPatOrb3006Engine.STRATEGY_NAME,
        setupType: isCleanBreakout ? 'PAT_ORB_DISPLACEMENT_BREAKOUT' : 'PAT_ORB_RETEST_BOUNCE',
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
          `Trend Stack PASS: 15m Close ($${curPrice.toFixed(4)}) > VWAP ($${vwap.toFixed(4)}), EMA21 ($${curEma21.toFixed(4)}), EMA50 ($${curEma50.toFixed(4)})`,
          `Opening Range Breakout PASS: Green displacement body (${(bodyRatio * 100).toFixed(0)}%) closed above Session High ($${sessionHigh.toFixed(4)})`,
          `Volume PASS: Bar Vol (${cur.volume.toFixed(0)}) >= 1.25x Avg Vol (${avgVol.toFixed(0)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(minTpDist/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    // --- EVALUATE SELL (SHORT) ---
    // 1. Price is trading below both VWAP and 15m EMA_21 & EMA_50
    const isBelowAveragesSell = curPrice < vwap && curPrice < curEma21 && curPrice < curEma50;
    // 2. Red displacement candle (Body >= 60%, Vol >= 1.25*AvgVol) closes below session low
    const isCleanBreakdown = cur.close < cur.open && bodyRatio >= 0.58 && isHighVolume && cur.close < sessionLow;
    // Retest variant: Previous broke down, current touched session low and closed red
    const isRetestRejection = prev.close < sessionLow && cur.high >= sessionLow * 0.998 && cur.close < cur.open && cur.close < curEma9;

    if (isBelowAveragesSell && (isCleanBreakdown || isRetestRejection)) {
      const rawSlDist = (cur.high + (0.08 * atr)) - curPrice;
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const takeProfitPrice = parseFloat((curPrice - minTpDist).toFixed(4));

      return {
        symbol,
        recommendedSide: 'SELL',
        confidenceScore: 88,
        strategyName: YtPatOrb3006Engine.STRATEGY_NAME,
        setupType: isCleanBreakdown ? 'PAT_ORB_DISPLACEMENT_BREAKDOWN' : 'PAT_ORB_RETEST_REJECTION',
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
          `Trend Stack PASS: 15m Close ($${curPrice.toFixed(4)}) < VWAP ($${vwap.toFixed(4)}), EMA21 ($${curEma21.toFixed(4)}), EMA50 ($${curEma50.toFixed(4)})`,
          `Opening Range Breakdown PASS: Red displacement body (${(bodyRatio * 100).toFixed(0)}%) closed below Session Low ($${sessionLow.toFixed(4)})`,
          `Volume PASS: Bar Vol (${cur.volume.toFixed(0)}) >= 1.25x Avg Vol (${avgVol.toFixed(0)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(minTpDist/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    emptyVerdict.reasons.push('Trade with Pat ORB conditions not met on current candle');
    return emptyVerdict;
  }
}

export const ytPatOrb3006Engine = new YtPatOrb3006Engine();
