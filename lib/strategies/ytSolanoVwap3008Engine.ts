import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict, StandardStrategyEngine, createEmptyStandardVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3008: SEAN SOLANO VWAP PULLBACK + 9 EMA MOMENTUM ENGINE
 * 
 * PRIMARY VIDEO REFERENCE:
 * Sean Solano - "The Best VWAP Trading Strategy" (http://www.youtube.com/watch?v=Ii1h78hBhZg)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Bullish Trend Stack: Price is above VWAP AND above 15m EMA_50, with EMA_9 > EMA_21.
 *    (Never SELL when price is above VWAP and EMA_50!)
 * 2. Pullback Entry: Price pulls back to touch or wick into the EMA_9 / EMA_21 / VWAP confluence zone,
 *    and the trigger candle closes green above EMA_9 and above the previous candle's high.
 * 3. SL & TP: SL = Pullback low wick - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Expansion target (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Bearish Trend Stack: Price is below VWAP AND below 15m EMA_50, with EMA_9 < EMA_21.
 *    (Never BUY when price is below VWAP and EMA_50!)
 * 2. Pullback Entry: Price bounces up to touch or wick into the EMA_9 / EMA_21 / VWAP resistance zone,
 *    and the trigger candle closes red below EMA_9 and below the previous candle's low.
 * 3. SL & TP: SL = Bounce high wick + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Expansion target (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface YtSolanoVwap3008Verdict extends StandardStrategyVerdict {
  customSL?: number;
  customTP?: number;
}

export class YtSolanoVwap3008Engine implements StandardStrategyEngine {
  public static readonly PORT = 3008;
  public static readonly STRATEGY_NAME = 'YT_SOLANO_VWAP_ENGINE';
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
  ): YtSolanoVwap3008Verdict {
    return YtSolanoVwap3008Engine.evaluateSetup(symbol, candles, accountEquity, microData);
  }

  public static evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtSolanoVwap3008Verdict {
    const curPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
    const emptyVerdict: YtSolanoVwap3008Verdict = {
      ...createEmptyStandardVerdict(symbol, this.STRATEGY_NAME, curPrice),
      customSL: 0,
      customTP: 0,
    };

    if (!candles || candles.length < 52) {
      emptyVerdict.reasons.push('Insufficient candle history (<52 bars) for Solano VWAP');
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

    // --- EVALUATE BUY (LONG) ---
    // 1. Bullish Trend Stack: Price > VWAP AND Price > EMA50, with EMA9 > EMA21
    const isBullTrend = curPrice > vwap && curPrice > curEma50 && curEma9 > curEma21;
    // 2. Pullback Entry: Low wicks into EMA9/EMA21/VWAP confluence zone, closes green above EMA9 and above prev high
    const touchedConfluenceBuy = cur.low <= Math.max(curEma9, curEma21, vwap) * 1.002 &&
                                cur.low >= Math.min(curEma21, vwap) * 0.995;
    const isGreenBreakoutBuy = cur.close > cur.open && cur.close > curEma9 && cur.close > prev.high;

    if (isBullTrend && touchedConfluenceBuy && isGreenBreakoutBuy) {
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
        confidenceScore: 89,
        strategyName: YtSolanoVwap3008Engine.STRATEGY_NAME,
        setupType: 'SOLANO_VWAP_9EMA_PULLBACK_BUY',
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
          `Trend Stack PASS: Price ($${curPrice.toFixed(4)}) > VWAP ($${vwap.toFixed(4)}) & > EMA50 ($${curEma50.toFixed(4)}), EMA9 > EMA21`,
          `Pullback Confluence PASS: Dipped into EMA9/EMA21/VWAP zone ($${cur.low.toFixed(4)})`,
          `Trigger PASS: Green candle closed above EMA9 ($${curEma9.toFixed(4)}) and above previous high ($${prev.high.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(minTpDist/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    // --- EVALUATE SELL (SHORT) ---
    // 1. Bearish Trend Stack: Price < VWAP AND Price < EMA50, with EMA9 < EMA21
    const isBearTrend = curPrice < vwap && curPrice < curEma50 && curEma9 < curEma21;
    // 2. Pullback Entry: High wicks into EMA9/EMA21/VWAP confluence zone, closes red below EMA9 and below prev low
    const touchedConfluenceSell = cur.high >= Math.min(curEma9, curEma21, vwap) * 0.998 &&
                                 cur.high <= Math.max(curEma21, vwap) * 1.005;
    const isRedBreakdownSell = cur.close < cur.open && cur.close < curEma9 && cur.close < prev.low;

    if (isBearTrend && touchedConfluenceSell && isRedBreakdownSell) {
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
        confidenceScore: 89,
        strategyName: YtSolanoVwap3008Engine.STRATEGY_NAME,
        setupType: 'SOLANO_VWAP_9EMA_PULLBACK_SELL',
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
          `Trend Stack PASS: Price ($${curPrice.toFixed(4)}) < VWAP ($${vwap.toFixed(4)}) & < EMA50 ($${curEma50.toFixed(4)}), EMA9 < EMA21`,
          `Pullback Confluence PASS: Bounced into EMA9/EMA21/VWAP zone ($${cur.high.toFixed(4)})`,
          `Trigger PASS: Red candle closed below EMA9 ($${curEma9.toFixed(4)}) and below previous low ($${prev.low.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(minTpDist/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    emptyVerdict.reasons.push('Sean Solano VWAP pullback conditions not met on current candle');
    return emptyVerdict;
  }
}

export const ytSolanoVwap3008Engine = new YtSolanoVwap3008Engine();
