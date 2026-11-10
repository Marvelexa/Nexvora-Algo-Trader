// Benjamin Cowen (Into The Cryptoverse) Macro Cycles & Risk Metric Engine (System 23)
// YouTube: https://www.youtube.com/@intothecryptoverse (Macro Cycles, BTC.D & Bull Market Support Band)
// Core Focus: Bull Market Support Band (20 SMA / 21 EMA), Trend Filter (50 EMA) & Dynamic Risk Metric (0.0 to 1.0)

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

export class BenjaminCowenCyclesEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'MACRO_CYCLE' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 50) return res;

    const closes = candles15m.map(c => c.close);
    const ema21 = this.calcEMA(closes, 21);
    const ema50 = this.calcEMA(closes, 50);
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];
    const atr = this.calcATR(candles15m, 14);

    // Bull Market Support Band proxy: Zone between 20 SMA and 21 EMA
    const bmsbUpper = Math.max(sma20, ema21);
    const bmsbLower = Math.min(sma20, ema21);

    // Dynamic Risk Metric (0.0 = Deep Value Accumulation, 1.0 = Euphoric Distribution)
    const lookback = closes.slice(-60);
    const minP = Math.min(...lookback);
    const maxP = Math.max(...lookback);
    const riskMetric = maxP > minP ? (currentPrice - minP) / (maxP - minP) : 0.5;

    // Setup 1: Bull Market Support Band Bounce LONG (Requires Uptrend Context: EMA 21 >= EMA 50)
    const isRetestingBMSB = currentPrice >= bmsbLower && currentPrice <= bmsbUpper * 1.008;
    const isUptrend = ema21 >= ema50;
    if (isRetestingBMSB && isUptrend && riskMetric < 0.50 && currentPrice >= prevPrice) {
      const sl = bmsbLower - atr * 1.2;
      const tp = currentPrice + (currentPrice - sl) * 2.4;
      return {
        recommendedSide: 'BUY',
        confidenceScore: 89,
        setupType: 'COWEN_BULL_MARKET_SUPPORT_BOUNCE',
        reasons: ['Retesting Bull Market Support Band in Uptrend (21>=50 EMA)', 'Risk Metric Favorable (' + riskMetric.toFixed(2) + ')', 'Cycle Expansion In Play'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'CYCLE_VALUE_ACCUMULATION'
      };
    }

    // Setup 2: Bear Market Relief Rally Rejection SHORT (When EMA 21 < EMA 50 and price tests BMSB from below)
    const isBearishRegime = ema21 < ema50;
    const testsBmsbFromBelow = currentPrice >= bmsbLower * 0.995 && currentPrice <= bmsbUpper;
    if (isBearishRegime && testsBmsbFromBelow && currentPrice < prevPrice) {
      const sl = bmsbUpper + atr * 1.2;
      const tp = currentPrice - (sl - currentPrice) * 2.4;
      return {
        recommendedSide: 'SELL',
        confidenceScore: 88,
        setupType: 'COWEN_BEAR_MARKET_BAND_RETEST_SHORT',
        reasons: ['Testing Band from Below in Downtrend (21<50 EMA)', 'Relief Rally Rejection Confirmed', 'Macro Bear Market Continuation'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'CYCLE_DISTRIBUTION'
      };
    }

    // Setup 3: Macro Euphoric Resistance Rejection + High Risk (> 0.80)
    if (riskMetric > 0.80 && currentPrice < prevPrice && currentPrice <= closes[closes.length - 3]) {
      const sl = currentPrice + atr * 1.3;
      const tp = currentPrice - (sl - currentPrice) * 2.4;
      return {
        recommendedSide: 'SELL',
        confidenceScore: 86,
        setupType: 'COWEN_MACRO_OVEREXTENSION_FADE',
        reasons: ['Risk Metric at Euphoric Levels (' + riskMetric.toFixed(2) + ')', 'Momentum Rejection at Upper Log Band', 'Macro Mean-Reversion Expected'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'CYCLE_DISTRIBUTION'
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

export const benjaminCowenEngine = new BenjaminCowenCyclesEngine();
