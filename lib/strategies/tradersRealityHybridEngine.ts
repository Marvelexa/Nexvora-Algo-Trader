// Traders Reality Hybrid System Engine (System 20)
// YouTube: https://www.youtube.com/@TradersReality (Market Maker Volume & Sessions)
// Core Focus: PVSRA Vector Candles (Green/Red/Violet/Blue), Asian Session Range Traps & MM Volume Absorption
// Rule: Never buy in a downtrend under 50 EMA; Climax bottom requires genuine lower wick absorption.

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

export class TradersRealityHybridEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'RANGING' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 35) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currentPrice = currentCandle.close;

    // 50 EMA (Dragon / Market Maker Baseline)
    const closes = candles15m.map(c => c.close);
    const ema50 = this.calcEMA(closes, 50);

    // Calculate Volume Moving Average (14-period)
    const volumes = candles15m.slice(-15, -1).map(c => c.volume || 1);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
    const currentVol = currentCandle.volume || 1;
    const prevVol = prevCandle.volume || 1;
    const rvol = currentVol / (avgVol || 1);
    const atr = this.calcATR(candles15m, 14);

    // Candle anatomy
    const prevRange = prevCandle.high - prevCandle.low;
    if (prevRange <= 0) return res;
    const prevLowerWick = Math.min(prevCandle.open, prevCandle.close) - prevCandle.low;
    const prevUpperWick = prevCandle.high - Math.max(prevCandle.open, prevCandle.close);

    // PVSRA Vector Definitions:
    // Green Vector: Bullish candle with Vol >= 180% avg (MM buying injection)
    // Red Vector: Bearish candle with Vol >= 180% avg (MM selling injection)
    // Climax Vector (Violet/Blue): Vol >= 200% avg with true wick rejection (Absorption)
    const isBullishVector = prevCandle.close > prevCandle.open && prevVol >= avgVol * 1.8;
    const isBearishVector = prevCandle.close < prevCandle.open && prevVol >= avgVol * 1.8;
    const isClimaxBottom = (prevLowerWick / prevRange) >= 0.45 && prevVol >= avgVol * 1.9 && currentCandle.close > prevCandle.close;
    const isClimaxTop = (prevUpperWick / prevRange) >= 0.45 && prevVol >= avgVol * 1.9 && currentCandle.close < prevCandle.close;

    // BUY Setup: True Climax Absorption OR Bullish Vector above/reclaiming 50 EMA Dragon
    if ((isClimaxBottom && currentPrice >= prevCandle.low + atr * 0.5) || 
        (isBullishVector && currentCandle.close > prevCandle.high && currentPrice >= ema50 * 0.995)) {
      const sl = Math.min(prevCandle.low, currentCandle.low) - atr * 0.8;
      const tp = currentPrice + (currentPrice - sl) * 2.2;
      return {
        recommendedSide: 'BUY',
        confidenceScore: 90,
        setupType: isClimaxBottom ? 'PVSRA_CLIMAX_BOTTOM_ABSORPTION' : 'PVSRA_GREEN_VECTOR_EXPANSION',
        reasons: ['PVSRA Vector Volume Spike', 'Market Maker Absorption Confirmed', 'Above/Reclaiming 50 EMA Dragon', 'RVOL ' + rvol.toFixed(1) + 'x'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'VECTOR_ACCUMULATION'
      };
    }

    // SELL Setup: True Climax Distribution OR Bearish Vector below/losing 50 EMA Dragon
    if ((isClimaxTop && currentPrice <= prevCandle.high - atr * 0.5) || 
        (isBearishVector && currentCandle.close < prevCandle.low && currentPrice <= ema50 * 1.005)) {
      const sl = Math.max(prevCandle.high, currentCandle.high) + atr * 0.8;
      const tp = currentPrice - (sl - currentPrice) * 2.2;
      return {
        recommendedSide: 'SELL',
        confidenceScore: 90,
        setupType: isClimaxTop ? 'PVSRA_CLIMAX_TOP_DISTRIBUTION' : 'PVSRA_RED_VECTOR_EXPANSION',
        reasons: ['PVSRA Vector Volume Spike', 'Market Maker Distribution Confirmed', 'Below/Losing 50 EMA Dragon', 'RVOL ' + rvol.toFixed(1) + 'x'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'VECTOR_DISTRIBUTION'
      };
    }

    return res;
  }

  private calcEMA(prices: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
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

export const tradersRealityEngine = new TradersRealityHybridEngine();
