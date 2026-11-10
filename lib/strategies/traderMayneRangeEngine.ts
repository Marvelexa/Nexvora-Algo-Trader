// Trader Mayne Range Trading & Order Blocks Engine (System 21)
// YouTube: https://www.youtube.com/@Tradermayne (Range Deviations, Order Blocks & Midpoint EQ Targets)
// Core Focus: Range High/Low Deviations, Equilibrium (EQ 50%) Target, 4H/1H Order Blocks & 1:2.5+ RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface SetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class TraderMayneRangeEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'RANGE' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 30) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currentPrice = currentCandle.close;
    const atr = this.calcATR(candles15m, 14);

    // Identify Range High (RH), Range Low (RL), Equilibrium (EQ)
    const lookback = candles15m.slice(-35, -2);
    const rangeHigh = Math.max(...lookback.map(c => c.high));
    const rangeLow = Math.min(...lookback.map(c => c.low));
    const eq = (rangeHigh + rangeLow) / 2;

    // Setup 1: Range Low Deviation (False breakdown below RL, reclaim inside)
    const deviatedBelowRL = prevCandle.low < rangeLow && prevCandle.close <= rangeLow * 1.002;
    const reclaimedInsideRL = currentCandle.close > rangeLow && currentCandle.close > currentCandle.open;
    if (deviatedBelowRL && reclaimedInsideRL) {
      const sl = prevCandle.low - atr * 0.5;
      const tp = eq + (rangeHigh - eq) * 0.5; // Target EQ and upper range
      return {
        recommendedSide: 'BUY',
        confidenceScore: 90,
        setupType: 'MAYNE_RANGE_LOW_DEVIATION',
        reasons: ['Range Low Deviation Trapped Early Sellers', 'Reclaimed Inside Range', 'Targeting Range Equilibrium (EQ)'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'RANGE_DEVIATION_BULLISH'
      };
    }

    // Setup 2: Range High Deviation (False breakout above RH, reclaim back inside)
    const deviatedAboveRH = prevCandle.high > rangeHigh && prevCandle.close >= rangeHigh * 0.998;
    const reclaimedInsideRH = currentCandle.close < rangeHigh && currentCandle.close < currentCandle.open;
    if (deviatedAboveRH && reclaimedInsideRH) {
      const sl = prevCandle.high + atr * 0.5;
      const tp = eq - (eq - rangeLow) * 0.5; // Target EQ and lower range
      return {
        recommendedSide: 'SELL',
        confidenceScore: 90,
        setupType: 'MAYNE_RANGE_HIGH_DEVIATION',
        reasons: ['Range High Deviation Trapped Breakout Buyers', 'Reclaimed Back Inside Range', 'Targeting Range Equilibrium (EQ)'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'RANGE_DEVIATION_BEARISH'
      };
    }

    return res;
  }

  private calcATR(candles: KlinePoint[], period: number = 14): number {
    if (candles.length < period + 1) return (candles[candles.length - 1]?.close || 1) * 0.015;
    const trs: number[] = [];
    for (let i = candles.length - period; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return trs.reduce((a, b) => a + b, 0) / period;
  }
}

export const traderMayneEngine = new TraderMayneRangeEngine();
