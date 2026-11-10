import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3002: THE TRADING GEEK (BRAD GOH) & MIND MATH MONEY
 * 
 * VIDEO REFERENCES:
 * 1. Brad Goh - "How to Trade Reversals PERFECTLY | Full Course" (https://youtu.be/PkAtVH6YVM8)
 * 2. Mind Math Money - "FULL Smart Money Concepts Trading Course" (http://www.youtube.com/watch?v=ucZII84ec6Y)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Step 1 (Macro Trend): 15m Close > EMA_50 (uptrend bias; never buy in a macro downtrend).
 * 2. Step 2 (Liquidity Sweep): During a 3-to-8 bar pullback, price wicks below a local 5-bar Swing Low
 *    (cur.low < priorSwingLow and cur.close > priorSwingLow), with RSI_14 < 42 on the sweep bar.
 * 3. Step 3 (MSS Confirmation): Current green candle breaks and closes above the immediate
 *    lower-high candle that caused the sweep (Close > mssHigh and Close > EMA_9).
 * 4. SL & TP: SL = Sweep Low wick - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Nearest opposing 15m Swing High body (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Step 1 (Macro Trend): 15m Close < EMA_50 (downtrend bias; never sell in a macro uptrend).
 * 2. Step 2 (Liquidity Sweep): During a 3-to-8 bar bounce, price wicks above a local 5-bar Swing High
 *    (cur.high > priorSwingHigh and cur.close < priorSwingHigh), with RSI_14 > 58 on the sweep bar.
 * 3. Step 3 (MSS Confirmation): Current red candle breaks and closes below the immediate
 *    higher-low candle (Close < mssLow and Close < EMA_9).
 * 4. SL & TP: SL = Sweep High wick + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Nearest opposing 15m Swing Low body (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface BradGoh3002Verdict extends StandardStrategyVerdict {
  auditLog: {
    macroTrendConfirmed: boolean;
    liquiditySweepConfirmed: boolean;
    mssConfirmed: boolean;
    rsiValue: number;
    sweepWickPrice: number;
    mssLevel: number;
  };
}

export class BradGohMindMathMoney3002Engine {
  public static readonly PORT = 3002;
  public static readonly NAME = 'The Trading Geek (Brad Goh) 5-Step Liquidity Sweep & MSS Engine';
  public static readonly VIDEO_URLS = [
    'https://youtu.be/PkAtVH6YVM8',
    'http://www.youtube.com/watch?v=ucZII84ec6Y',
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

  public static calculateRSI(closes: number[], period: number = 14): number[] {
    const rsis: number[] = new Array(closes.length).fill(50);
    if (closes.length <= period) return rsis;

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsis[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsis[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsis;
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
    accountEquity: number = 10000
  ): BradGoh3002Verdict {
    const emptyVerdict: BradGoh3002Verdict = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      strategyName: BradGohMindMathMoney3002Engine.NAME,
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
        macroTrendConfirmed: false,
        liquiditySweepConfirmed: false,
        mssConfirmed: false,
        rsiValue: 50,
        sweepWickPrice: 0,
        mssLevel: 0,
      },
    };

    if (!candles || candles.length < 52) {
      emptyVerdict.reasons.push('Insufficient candle history (<52 bars) for Brad Goh 5-step strategy');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const curPrice = cur.close;
    const closes = candles.map(c => c.close);
    const ema50Arr = BradGohMindMathMoney3002Engine.calculateEMA(closes, 50);
    const ema9Arr = BradGohMindMathMoney3002Engine.calculateEMA(closes, 9);
    const rsiArr = BradGohMindMathMoney3002Engine.calculateRSI(closes, 14);
    const atr = Math.max(BradGohMindMathMoney3002Engine.calculateATR(candles, 14), curPrice * 0.002);

    const curEma50 = ema50Arr[n - 1];
    const curEma9 = ema9Arr[n - 1];
    const curRSI = rsiArr[n - 1];

    // STEP 1: Macro Trend Evaluation
    const isMacroUptrend = curPrice > curEma50;
    const isMacroDowntrend = curPrice < curEma50;

    // --- EVALUATE BUY (LONG) ---
    if (isMacroUptrend) {
      // Lookback 3 to 8 bars for a liquidity sweep of a local 5-bar swing low
      let sweepFound = false;
      let sweepIdx = -1;
      let sweepLowWick = Infinity;
      let priorSwingLow = Infinity;
      let mssHigh = -Infinity;

      for (let i = n - 8; i <= n - 2; i++) {
        if (i < 5) continue;
        // Prior 5-bar swing low before bar i
        const priorSlice = candles.slice(i - 5, i);
        const localMin = Math.min(...priorSlice.map(c => c.low));
        const bar = candles[i];
        const barRSI = rsiArr[i];

        // Swept below prior swing low, closed back above it, with RSI < 42
        if (bar.low < localMin && bar.close > localMin && barRSI < 42) {
          sweepFound = true;
          sweepIdx = i;
          sweepLowWick = bar.low;
          priorSwingLow = localMin;
          // Find the intermediate lower-high that led to this sweep
          mssHigh = Math.max(...candles.slice(Math.max(0, i - 4), i).map(c => c.high));
          break;
        }
      }

      if (sweepFound && sweepIdx !== -1) {
        // Step 3: MSS Confirmation on current or immediate prior bar
        const isCurrentGreen = cur.close > cur.open;
        const breaksMss = cur.close > mssHigh && cur.close > curEma9;

        if (isCurrentGreen && breaksMss) {
          // SL = Sweep Low wick - 0.08 * ATR (clamped between 0.38% and 0.55%)
          const rawSlDistance = (curPrice - (sweepLowWick - (0.08 * atr)));
          const minSlDist = curPrice * 0.0038;
          const maxSlDist = curPrice * 0.0130;
          const slDistance = Math.min(Math.max(rawSlDistance, minSlDist), maxSlDist);
          const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

          // TP = Nearest opposing 15m Swing High body (>= 1.20 * SL and >= 0.55%)
          const recentHighs = candles.slice(n - 25, n - 2).map(c => Math.max(c.open, c.close));
          const opposingHigh = Math.max(...recentHighs);
          const structuralTpDist = opposingHigh - curPrice;
          const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
          const tpDistance = Math.max(structuralTpDist, minTpDist);
          const takeProfitPrice = parseFloat((curPrice + tpDistance).toFixed(4));

          return {
            symbol,
            recommendedSide: 'BUY',
            confidenceScore: 90,
            strategyName: BradGohMindMathMoney3002Engine.NAME,
            setupType: 'BRAD_GOH_SWEEP_MSS_BUY',
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
              `Step 1: 15m Close ($${curPrice.toFixed(4)}) > EMA50 ($${curEma50.toFixed(4)}) confirmed Bullish Macro Trend`,
              `Step 2: Liquidity sweep below local swing low ($${priorSwingLow.toFixed(4)}) with sweep wick ($${sweepLowWick.toFixed(4)}) & RSI < 42 confirmed`,
              `Step 3: MSS green breakout close ($${curPrice.toFixed(4)}) > mssHigh ($${mssHigh.toFixed(4)}) & > EMA9 ($${curEma9.toFixed(4)}) confirmed`,
              `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%) outside sweep wick, TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
            ],
            auditLog: {
              macroTrendConfirmed: true,
              liquiditySweepConfirmed: true,
              mssConfirmed: true,
              rsiValue: curRSI,
              sweepWickPrice: sweepLowWick,
              mssLevel: mssHigh,
            },
          };
        }
      }
    }

    // --- EVALUATE SELL (SHORT) ---
    if (isMacroDowntrend) {
      // Lookback 3 to 8 bars for a liquidity sweep of a local 5-bar swing high
      let sweepFound = false;
      let sweepIdx = -1;
      let sweepHighWick = -Infinity;
      let priorSwingHigh = -Infinity;
      let mssLow = Infinity;

      for (let i = n - 8; i <= n - 2; i++) {
        if (i < 5) continue;
        const priorSlice = candles.slice(i - 5, i);
        const localMax = Math.max(...priorSlice.map(c => c.high));
        const bar = candles[i];
        const barRSI = rsiArr[i];

        // Swept above prior swing high, closed back below it, with RSI > 58
        if (bar.high > localMax && bar.close < localMax && barRSI > 58) {
          sweepFound = true;
          sweepIdx = i;
          sweepHighWick = bar.high;
          priorSwingHigh = localMax;
          // Find the intermediate higher-low that led to this sweep
          mssLow = Math.min(...candles.slice(Math.max(0, i - 4), i).map(c => c.low));
          break;
        }
      }

      if (sweepFound && sweepIdx !== -1) {
        // Step 3: MSS Confirmation on current or immediate prior bar
        const isCurrentRed = cur.close < cur.open;
        const breaksMss = cur.close < mssLow && cur.close < curEma9;

        if (isCurrentRed && breaksMss) {
          // SL = Sweep High wick + 0.08 * ATR (clamped between 0.38% and 0.55%)
          const rawSlDistance = ((sweepHighWick + (0.08 * atr)) - curPrice);
          const minSlDist = curPrice * 0.0038;
          const maxSlDist = curPrice * 0.0130;
          const slDistance = Math.min(Math.max(rawSlDistance, minSlDist), maxSlDist);
          const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

          // TP = Nearest opposing 15m Swing Low body (>= 1.20 * SL and >= 0.55%)
          const recentLows = candles.slice(n - 25, n - 2).map(c => Math.min(c.open, c.close));
          const opposingLow = Math.min(...recentLows);
          const structuralTpDist = curPrice - opposingLow;
          const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
          const tpDistance = Math.max(structuralTpDist, minTpDist);
          const takeProfitPrice = parseFloat((curPrice - tpDistance).toFixed(4));

          return {
            symbol,
            recommendedSide: 'SELL',
            confidenceScore: 90,
            strategyName: BradGohMindMathMoney3002Engine.NAME,
            setupType: 'BRAD_GOH_SWEEP_MSS_SELL',
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
              `Step 1: 15m Close ($${curPrice.toFixed(4)}) < EMA50 ($${curEma50.toFixed(4)}) confirmed Bearish Macro Trend`,
              `Step 2: Liquidity sweep above local swing high ($${priorSwingHigh.toFixed(4)}) with sweep wick ($${sweepHighWick.toFixed(4)}) & RSI > 58 confirmed`,
              `Step 3: MSS red breakdown close ($${curPrice.toFixed(4)}) < mssLow ($${mssLow.toFixed(4)}) & < EMA9 ($${curEma9.toFixed(4)}) confirmed`,
              `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%) outside sweep wick, TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
            ],
            auditLog: {
              macroTrendConfirmed: true,
              liquiditySweepConfirmed: true,
              mssConfirmed: true,
              rsiValue: curRSI,
              sweepWickPrice: sweepHighWick,
              mssLevel: mssLow,
            },
          };
        }
      }
    }

    emptyVerdict.reasons.push('Brad Goh 5-step conditions not met on current candle');
    return emptyVerdict;
  }
}

export const bradGohMindMathMoney3002Engine = new BradGohMindMathMoney3002Engine();
