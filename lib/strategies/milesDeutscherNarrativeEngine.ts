// Miles Deutscher Narrative Rotations & Whale Flow Engine (System 27)
// YouTube: https://www.youtube.com/@MilesDeutscherFinance (Narrative Rotations, On-Chain Tools & Smart Money)
// Core Focus: Narrative Strength Outperformance, Whale Taker Aggression (CVD & Taker Ratio), Volume Breakouts

import { KlinePoint } from './multiTimeframeCandleAnalysis';

export interface SetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class MilesDeutscherNarrativeEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'NARRATIVE' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 30) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currentPrice = currentCandle.close;
    const atr = this.calcATR(candles15m, 14);

    // Calculate Volume and RVOL
    const volumes = candles15m.slice(-21, -1).map(c => c.volume || 1);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / 20;
    const currentVol = currentCandle.volume || 1;
    const rvol = currentVol / (avgVol || 1);

    // Microstructure Whale Aggression
    const cvd = microData?.cvd ?? 0;
    const takerBuyRatio = microData?.takerBuyRatio ?? 0.50;

    // Recent range breakout
    const lookback = candles15m.slice(-25, -2);
    const rangeHigh = Math.max(...lookback.map(c => c.high));
    const rangeLow = Math.min(...lookback.map(c => c.low));

    const isBreakoutHigh = (currentPrice > rangeHigh || prevCandle.close > rangeHigh) && currentCandle.close > currentCandle.open;
    const isWhaleAggression = takerBuyRatio >= 0.54 || cvd >= 15 || rvol >= 1.5;

    // Setup 1: Narrative Outperformer Momentum Long (Requires Breakout AND Whale Flow/Volume Confirmation)
    if (isBreakoutHigh && isWhaleAggression && rvol >= 1.15) {
      const sl = rangeHigh - atr * 1.1;
      const tp = currentPrice + (currentPrice - sl) * 2.5;
      return {
        recommendedSide: 'BUY',
        confidenceScore: 92,
        setupType: 'MILES_NARRATIVE_BREAKOUT_LONG',
        reasons: ['Narrative Leader Breaking Consolidation High', 'Whale Taker Flow Confirmed (RVOL ' + rvol.toFixed(1) + 'x)', 'Strong Relative Momentum'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'NARRATIVE_EXPANSION'
      };
    }

    // Setup 2: Narrative Exhaustion Breakdown Short
    const isBreakdownLow = (currentPrice < rangeLow || prevCandle.close < rangeLow) && currentCandle.close < currentCandle.open;
    const isWhaleDistribution = takerBuyRatio <= 0.46 || cvd <= -15 || rvol >= 1.5;
    if (isBreakdownLow && isWhaleDistribution && rvol >= 1.15) {
      const sl = rangeLow + atr * 1.1;
      const tp = currentPrice - (sl - currentPrice) * 2.5;
      return {
        recommendedSide: 'SELL',
        confidenceScore: 90,
        setupType: 'MILES_NARRATIVE_EXHAUSTION_SHORT',
        reasons: ['Narrative Exhaustion Breakdown Below Support', 'Whale Taker Sell Pressure (RVOL ' + rvol.toFixed(1) + 'x)', 'Capital Rotation Outflow'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'NARRATIVE_EXHAUSTION'
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

export const milesDeutscherEngine = new MilesDeutscherNarrativeEngine();
