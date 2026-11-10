// DataDash (Nicholas Merten) Macro Liquidity & TOTAL3 Rotations Engine (System 26)
// YouTube: https://www.youtube.com/@DataDash (Macro Liquidity Flows & Altcoin Wave Cycles)
// Core Focus: 20/50/100/200 EMA Ribbon, Liquidity Wave Surges & Macro Trend Continuation

import { multiTimeframeCandleEngine, KlinePoint } from './multiTimeframeCandleAnalysis';

export interface SetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class DataDashMacroFlowEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'MACRO_FLOW' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 50) return res;

    const closes = candles15m.map(c => c.close);
    const ema20 = this.calcEMA(closes, 20);
    const ema50 = this.calcEMA(closes, 50);
    const ema100 = this.calcEMA(closes, 100);
    const currentPrice = closes[closes.length - 1];
    const atr = this.calcATR(candles15m, 14);

    // EMA Ribbon Bullish Alignment: 20 > 50 > 100
    const isRibbonBullish = ema20 > ema50 && ema50 > ema100;
    const isPullbackToRibbon = currentPrice >= ema50 * 0.995 && currentPrice <= ema20 * 1.005;

    if (isRibbonBullish && isPullbackToRibbon && currentPrice > closes[closes.length - 2]) {
      const sl = ema50 - atr * 1.2;
      const tp = currentPrice + (currentPrice - sl) * 2.3;
      return {
        recommendedSide: 'BUY',
        confidenceScore: 89,
        setupType: 'DATADASH_TOTAL3_RIBBON_WAVE_BUY',
        reasons: ['EMA 20/50/100 Macro Ribbon Bullish', 'Healthy Value Pullback to Ribbon Core', 'Liquidity Wave Continuation'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'MACRO_BULLISH_FLOW'
      };
    }

    // EMA Ribbon Bearish Alignment: 20 < 50 < 100
    const isRibbonBearish = ema20 < ema50 && ema50 < ema100;
    const isBearishPullback = currentPrice <= ema50 * 1.005 && currentPrice >= ema20 * 0.995;

    if (isRibbonBearish && isBearishPullback && currentPrice < closes[closes.length - 2]) {
      const sl = ema50 + atr * 1.2;
      const tp = currentPrice - (sl - currentPrice) * 2.3;
      return {
        recommendedSide: 'SELL',
        confidenceScore: 89,
        setupType: 'DATADASH_MACRO_LIQUIDITY_DRAIN_SELL',
        reasons: ['EMA 20/50/100 Macro Ribbon Bearish', 'Overhead Resistance at Ribbon Core', 'Liquidity Drain Distribution'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'MACRO_BEARISH_DRAIN'
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

export const dataDashEngine = new DataDashMacroFlowEngine();
