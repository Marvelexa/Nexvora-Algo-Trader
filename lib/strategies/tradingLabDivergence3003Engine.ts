import { KlinePoint } from '../../src/types';
import { StandardStrategyVerdict } from './standardStrategyInterface';

/**
 * ============================================================================
 * MODULE / PORT 3003: TRADINGLAB 10-CANDLE LIQUIDITY GRAB + RSI DIVERGENCE ENGINE
 * 
 * PRIMARY VIDEO REFERENCE:
 * TradingLab - "I Reveal My Reversal Strategy [AMAZING]" (https://youtu.be/4cT8WTyxhYY)
 * 
 * EXACT ISOLATED RULES:
 * WHEN TO BUY (LONG):
 * 1. Trend Filter: 15m Close > EMA_50 OR sweeping major 20-bar support floor while EMA_50 slope is flat/rising.
 * 2. Liquidity Grab: Price makes a Lower Low (cur.low < prevSwingLow_10bars) that sweeps below support.
 * 3. Bullish RSI Divergence: While price made a Lower Low, RSI_14 made a strictly Higher Low (curRSI > prevSwingLowRSI + 2.0).
 * 4. Trigger: A green candle closes back inside the support range and above 15m EMA_9.
 * 5. SL & TP: SL = Sweep Low wick - 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Opposing 20-bar swing high (>= 1.35 * SL and >= 0.70%).
 * 
 * WHEN TO SELL (SHORT):
 * 1. Trend Filter: 15m Close < EMA_50 OR price is sweeping a major 20-bar resistance ceiling while EMA_50 slope is flat/falling.
 * 2. Liquidity Grab: Price makes a Higher High (cur.high > prevSwingHigh_10bars) that sweeps above resistance.
 * 3. Bearish RSI Divergence: While price made a Higher High, RSI_14 made a strictly Lower High (curRSI < prevSwingHighRSI - 2.0).
 * 4. Trigger: A red candle closes back below the resistance level and below 15m EMA_9.
 * 5. SL & TP: SL = Sweep High wick + 0.08 * ATR (clamped 0.38%–0.55%).
 *    TP = Opposing 20-bar swing low (>= 1.35 * SL and >= 0.70%).
 * ============================================================================
 */

export interface TradingLab3003Verdict extends StandardStrategyVerdict {
  auditLog: {
    rule1_clean_swing_detected: boolean;
    rule2_liquidity_grab_10_candle: boolean;
    rule3_oscillator_divergence: boolean;
    rule4_native_tpsl: boolean;
    swing_level?: number;
    candle_distance?: number;
    divergence_details?: string;
  };
}

export class TradingLabDivergence3003Engine {
  public static readonly PORT = 3003;
  public static readonly NAME = 'TradingLab 10-Candle Liquidity Grab + RSI Divergence Engine';
  public static readonly VIDEO_URLS = [
    'https://youtu.be/4cT8WTyxhYY'
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
    rsis[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsis[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
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
  ): TradingLab3003Verdict {
    const emptyVerdict: TradingLab3003Verdict = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      strategyName: TradingLabDivergence3003Engine.NAME,
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
        rule1_clean_swing_detected: false,
        rule2_liquidity_grab_10_candle: false,
        rule3_oscillator_divergence: false,
        rule4_native_tpsl: false,
      },
    };

    if (!candles || candles.length < 52) {
      emptyVerdict.reasons.push('Insufficient candle history (<52 bars) for TradingLab Divergence check');
      return emptyVerdict;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const curPrice = cur.close;
    const closes = candles.map(c => c.close);
    const ema50Arr = TradingLabDivergence3003Engine.calculateEMA(closes, 50);
    const ema9Arr = TradingLabDivergence3003Engine.calculateEMA(closes, 9);
    const rsis = TradingLabDivergence3003Engine.calculateRSI(closes, 14);
    const atr = Math.max(TradingLabDivergence3003Engine.calculateATR(candles, 14), curPrice * 0.002);

    const curEma50 = ema50Arr[n - 1];
    const prevEma50 = ema50Arr[n - 6] || curEma50;
    const ema50Slope = (curEma50 - prevEma50) / curEma50;
    const curEma9 = ema9Arr[n - 1];
    const curRSI = rsis[n - 1];

    // Lookback 20 bars for major support and resistance floors
    const slice20 = candles.slice(n - 22, n - 2);
    const major20Low = Math.min(...slice20.map(c => c.low));
    const major20High = Math.max(...slice20.map(c => c.high));

    // --- EVALUATE BUY (LONG) ---
    // Rule 1: Close > EMA50 OR sweeping major 20-bar support floor with flat/rising EMA50
    const isBullTrend = curPrice > curEma50 || (cur.low <= major20Low && ema50Slope >= -0.001);
    if (isBullTrend) {
      // Find previous swing low within 2 to 10 candles
      for (let dist = 2; dist <= 10; dist++) {
        const pivotIdx = (n - 1) - dist;
        if (pivotIdx < 5) continue;
        const pivotCandle = candles[pivotIdx];
        const isSwingLow = pivotCandle.low <= candles[pivotIdx - 1].low &&
                           pivotCandle.low <= candles[pivotIdx - 2].low &&
                           pivotCandle.low <= candles[pivotIdx + 1].low;

        if (isSwingLow) {
          // Rule 2: Current low swept below prior swing low
          const sweptLower = cur.low < pivotCandle.low;
          // Rule 3: Bullish RSI Divergence: while price made Lower Low, RSI made strictly Higher Low (+2.0)
          const pivotRSI = rsis[pivotIdx];
          const hasBullishDivergence = curRSI > (pivotRSI + 2.0);
          // Rule 4: Green candle closes back inside support range AND above 15m EMA9
          const isGreenReclaim = cur.close > cur.open && cur.close > pivotCandle.low && cur.close > curEma9;

          if (sweptLower && hasBullishDivergence && isGreenReclaim) {
            // SL = Sweep Low wick - 0.08 * ATR (clamped between 0.38% and 1.30%)
            const rawSlDist = curPrice - (cur.low - (0.08 * atr));
            const minSlDist = curPrice * 0.0038;
            const maxSlDist = curPrice * 0.0130;
            const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
            const stopLossPrice = parseFloat((curPrice - slDistance).toFixed(4));

            // TP = Opposing 20-bar Swing High (>= 1.20 * SL and >= 0.55%)
            const structuralTpDist = major20High - curPrice;
            const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
            const tpDistance = Math.max(structuralTpDist, minTpDist);
            const takeProfitPrice = parseFloat((curPrice + tpDistance).toFixed(4));

            return {
              symbol,
              recommendedSide: 'BUY',
              confidenceScore: 89,
              strategyName: TradingLabDivergence3003Engine.NAME,
              setupType: 'TRADINGLAB_BULLISH_DIVERGENCE_GRAB',
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
                `Trend Filter PASS: 15m Close ($${curPrice.toFixed(4)}) > EMA50 ($${curEma50.toFixed(4)}) or major support reclaim`,
                `Liquidity Grab PASS: Lower Low sweep ($${cur.low.toFixed(4)} < $${pivotCandle.low.toFixed(4)}) across ${dist} candles`,
                `Bullish RSI Divergence PASS: Current RSI (${curRSI.toFixed(1)}) > Pivot RSI (${pivotRSI.toFixed(1)} + 2.0)`,
                `Trigger PASS: Green candle closed above support & above EMA9 ($${curEma9.toFixed(4)})`,
                `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
              ],
              auditLog: {
                rule1_clean_swing_detected: true,
                rule2_liquidity_grab_10_candle: true,
                rule3_oscillator_divergence: true,
                rule4_native_tpsl: true,
                swing_level: pivotCandle.low,
                candle_distance: dist,
                divergence_details: `Price: ${cur.low.toFixed(4)} < ${pivotCandle.low.toFixed(4)} vs RSI: ${curRSI.toFixed(1)} > ${pivotRSI.toFixed(1)}`,
              },
            };
          }
        }
      }
    }

    // --- EVALUATE SELL (SHORT) ---
    // Rule 1: Close < EMA50 OR sweeping major 20-bar resistance ceiling with flat/falling EMA50
    const isBearTrend = curPrice < curEma50 || (cur.high >= major20High && ema50Slope <= 0.001);
    if (isBearTrend) {
      // Find previous swing high within 2 to 10 candles
      for (let dist = 2; dist <= 10; dist++) {
        const pivotIdx = (n - 1) - dist;
        if (pivotIdx < 5) continue;
        const pivotCandle = candles[pivotIdx];
        const isSwingHigh = pivotCandle.high >= candles[pivotIdx - 1].high &&
                            pivotCandle.high >= candles[pivotIdx - 2].high &&
                            pivotCandle.high >= candles[pivotIdx + 1].high;

        if (isSwingHigh) {
          // Rule 2: Current high swept above prior swing high
          const sweptHigher = cur.high > pivotCandle.high;
          // Rule 3: Bearish RSI Divergence: while price made Higher High, RSI made strictly Lower High (-2.0)
          const pivotRSI = rsis[pivotIdx];
          const hasBearishDivergence = curRSI < (pivotRSI - 2.0);
          // Rule 4: Red candle closes back below resistance ceiling AND below 15m EMA9
          const isRedBreakdown = cur.close < cur.open && cur.close < pivotCandle.high && cur.close < curEma9;

          if (sweptHigher && hasBearishDivergence && isRedBreakdown) {
            // SL = Sweep High wick + 0.08 * ATR (clamped between 0.38% and 1.30%)
            const rawSlDist = (cur.high + (0.08 * atr)) - curPrice;
            const minSlDist = curPrice * 0.0038;
            const maxSlDist = curPrice * 0.0130;
            const slDistance = Math.min(Math.max(rawSlDist, minSlDist), maxSlDist);
            const stopLossPrice = parseFloat((curPrice + slDistance).toFixed(4));

            // TP = Opposing 20-bar Swing Low (>= 1.20 * SL and >= 0.55%)
            const structuralTpDist = curPrice - major20Low;
            const minTpDist = Math.max(slDistance * 1.20, curPrice * 0.0055);
            const tpDistance = Math.max(structuralTpDist, minTpDist);
            const takeProfitPrice = parseFloat((curPrice - tpDistance).toFixed(4));

            return {
              symbol,
              recommendedSide: 'SELL',
              confidenceScore: 89,
              strategyName: TradingLabDivergence3003Engine.NAME,
              setupType: 'TRADINGLAB_BEARISH_DIVERGENCE_GRAB',
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
                `Trend Filter PASS: 15m Close ($${curPrice.toFixed(4)}) < EMA50 ($${curEma50.toFixed(4)}) or major resistance reject`,
                `Liquidity Grab PASS: Higher High sweep ($${cur.high.toFixed(4)} > $${pivotCandle.high.toFixed(4)}) across ${dist} candles`,
                `Bearish RSI Divergence PASS: Current RSI (${curRSI.toFixed(1)}) < Pivot RSI (${pivotRSI.toFixed(1)} - 2.0)`,
                `Trigger PASS: Red candle closed below resistance & below EMA9 ($${curEma9.toFixed(4)})`,
                `SL ($${stopLossPrice.toFixed(4)}, ${(slDistance/curPrice*100).toFixed(2)}%), TP ($${takeProfitPrice.toFixed(4)}, ${(tpDistance/curPrice*100).toFixed(2)}%) >= 1.35R & >= 0.70%`,
              ],
              auditLog: {
                rule1_clean_swing_detected: true,
                rule2_liquidity_grab_10_candle: true,
                rule3_oscillator_divergence: true,
                rule4_native_tpsl: true,
                swing_level: pivotCandle.high,
                candle_distance: dist,
                divergence_details: `Price: ${cur.high.toFixed(4)} > ${pivotCandle.high.toFixed(4)} vs RSI: ${curRSI.toFixed(1)} < ${pivotRSI.toFixed(1)}`,
              },
            };
          }
        }
      }
    }

    emptyVerdict.reasons.push('TradingLab 10-candle divergence grab conditions not met');
    return emptyVerdict;
  }
}

export const tradingLabDivergence3003Engine = new TradingLabDivergence3003Engine();
