import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict, StandardStrategyEngine, createEmptyStandardVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3009: THE SECRET MINDSET 200 EMA + ZERO-LAG MACD ENGINE
 * 
 * PRIMARY VIDEO REFERENCE:
 * The Secret Mindset - "Best MACD Trading Strategy: 200 EMA + Zero-Lag MACD"
 * (http://www.youtube.com/watch?v=S2HaCa0b-bY)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Strict 200 EMA Macro Trend: Price is strictly above 15m EMA_200 AND EMA_50
 *    (Close > EMA_200 and Close > EMA_50). Zero SELL signals allowed above EMA_200!
 * 2. Zero-Lag MACD Crossover: MACD line crosses upward above the Signal line
 *    (or histogram flips from red to green) while candle closes green above EMA_21.
 * 3. SL & TP: SL = Swing low wick - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Expansion target (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Strict 200 EMA Macro Trend: Price is strictly below 15m EMA_200 AND EMA_50
 *    (Close < EMA_200 and Close < EMA_50). Zero BUY signals allowed below EMA_200!
 * 2. Zero-Lag MACD Crossover: MACD line crosses downward below the Signal line
 *    (or histogram flips from green to red) while candle closes red below EMA_21.
 * 3. SL & TP: SL = Swing high wick + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Expansion target (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface YtSecretMacd3009Verdict extends StandardStrategyVerdict {
  customSL?: number;
  customTP?: number;
}

export class YtSecretMacd3009Engine implements StandardStrategyEngine {
  public static readonly PORT = 3009;
  public static readonly STRATEGY_NAME = 'YT_SECRET_MACD_ENGINE';
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

  public static calculateZeroLagMACD(
    closes: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { macd: number[]; signal: number[]; hist: number[] } {
    const emaFast1 = this.calculateEMA(closes, fastPeriod);
    const emaFast2 = this.calculateEMA(emaFast1, fastPeriod);
    const zeroLagFast = emaFast1.map((v, i) => 2 * v - emaFast2[i]);

    const emaSlow1 = this.calculateEMA(closes, slowPeriod);
    const emaSlow2 = this.calculateEMA(emaSlow1, slowPeriod);
    const zeroLagSlow = emaSlow1.map((v, i) => 2 * v - emaSlow2[i]);

    const macd = zeroLagFast.map((v, i) => v - zeroLagSlow[i]);
    const signal1 = this.calculateEMA(macd, signalPeriod);
    const signal2 = this.calculateEMA(signal1, signalPeriod);
    const zeroLagSignal = signal1.map((v, i) => 2 * v - signal2[i]);
    const hist = macd.map((v, i) => v - zeroLagSignal[i]);

    return { macd, signal: zeroLagSignal, hist };
  }

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtSecretMacd3009Verdict {
    return YtSecretMacd3009Engine.evaluateSetup(symbol, candles, accountEquity, microData);
  }

  public static evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 1000,
    microData?: any
  ): YtSecretMacd3009Verdict {
    const curPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
    const emptyVerdict: YtSecretMacd3009Verdict = {
      ...createEmptyStandardVerdict(symbol, this.STRATEGY_NAME, curPrice),
      customSL: 0,
      customTP: 0,
    };

    if (!candles || candles.length < 52) {
      emptyVerdict.reasons.push('Insufficient candle history (<52 bars) for Secret MACD');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const closes = candles.map(c => c.close);
    const ema200Arr = this.calculateEMA(closes, Math.min(200, closes.length));
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema21Arr = this.calculateEMA(closes, 21);
    const atr = Math.max(this.calculateATR(candles, 14), curPrice * 0.002);

    const { macd, signal, hist } = this.calculateZeroLagMACD(closes, 12, 26, 9);

    const curEma200 = ema200Arr[n - 1];
    const curEma50 = ema50Arr[n - 1];
    const curEma21 = ema21Arr[n - 1];
    const curMacd = macd[n - 1];
    const prevMacd = macd[n - 2];
    const curSig = signal[n - 1];
    const prevSig = signal[n - 2];
    const curHist = hist[n - 1];
    const prevHist = hist[n - 2];

    // --- EVALUATE BUY (LONG) ---
    // 1. Price is strictly above 15m EMA_200 AND EMA_50. (Zero SELL signals allowed above EMA200!)
    const isBullMacro = curPrice > curEma200 && curPrice > curEma50;
    // 2. Zero-Lag MACD crosses upward above Signal line OR hist flips red -> green while candle closes green above EMA21
    const isMacdBullCross = (prevMacd <= prevSig && curMacd > curSig) || (prevHist <= 0 && curHist > 0);
    const isGreenCloseAboveEma21 = cur.close > cur.open && cur.close > curEma21;

    if (isBullMacro && isMacdBullCross && isGreenCloseAboveEma21) {
      // Find local swing low over last 10 bars
      const localSlice = candles.slice(n - 10, n);
      const localLow = Math.min(...localSlice.map(c => c.low));

      const rawSlDist = curPrice - (localLow - (0.08 * atr));
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const takeProfitPrice = parseFloat((curPrice + minTpDist).toFixed(4));

      return {
        symbol,
        recommendedSide: 'BUY',
        confidenceScore: 90,
        strategyName: YtSecretMacd3009Engine.STRATEGY_NAME,
        setupType: 'SECRET_MACD_200EMA_BULL_CROSS',
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
          `Macro Trend PASS: Price ($${curPrice.toFixed(4)}) > EMA200 ($${curEma200.toFixed(4)}) & > EMA50 ($${curEma50.toFixed(4)})`,
          `Zero-Lag MACD Cross PASS: MACD (${curMacd.toFixed(4)}) crossed above Signal (${curSig.toFixed(4)})`,
          `Trigger PASS: Green candle closed above EMA21 ($${curEma21.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(minTpDist/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    // --- EVALUATE SELL (SHORT) ---
    // 1. Price is strictly below 15m EMA_200 AND EMA_50. (Zero BUY signals allowed below EMA200!)
    const isBearMacro = curPrice < curEma200 && curPrice < curEma50;
    // 2. Zero-Lag MACD crosses downward below Signal line OR hist flips green -> red while candle closes red below EMA21
    const isMacdBearCross = (prevMacd >= prevSig && curMacd < curSig) || (prevHist >= 0 && curHist < 0);
    const isRedCloseBelowEma21 = cur.close < cur.open && cur.close < curEma21;

    if (isBearMacro && isMacdBearCross && isRedCloseBelowEma21) {
      // Find local swing high over last 10 bars
      const localSlice = candles.slice(n - 10, n);
      const localHigh = Math.max(...localSlice.map(c => c.high));

      const rawSlDist = (localHigh + (0.08 * atr)) - curPrice;
      const minSlDist = curPrice * 0.0038;
      const maxSlDist = curPrice * 0.0130;
      const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
      const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

      const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
      const takeProfitPrice = parseFloat((curPrice - minTpDist).toFixed(4));

      return {
        symbol,
        recommendedSide: 'SELL',
        confidenceScore: 90,
        strategyName: YtSecretMacd3009Engine.STRATEGY_NAME,
        setupType: 'SECRET_MACD_200EMA_BEAR_CROSS',
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
          `Macro Trend PASS: Price ($${curPrice.toFixed(4)}) < EMA200 ($${curEma200.toFixed(4)}) & < EMA50 ($${curEma50.toFixed(4)})`,
          `Zero-Lag MACD Cross PASS: MACD (${curMacd.toFixed(4)}) crossed below Signal (${curSig.toFixed(4)})`,
          `Trigger PASS: Red candle closed below EMA21 ($${curEma21.toFixed(4)})`,
          `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(minTpDist/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
        ],
      };
    }

    emptyVerdict.reasons.push('Secret MACD 200 EMA conditions not met on current candle');
    return emptyVerdict;
  }
}

export const ytSecretMacd3009Engine = new YtSecretMacd3009Engine();
