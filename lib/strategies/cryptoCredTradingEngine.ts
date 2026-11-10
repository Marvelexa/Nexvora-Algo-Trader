// Crypto Cred Pure Price Action & Market Structure Engine (System 18)
// YouTube: https://www.youtube.com/@CryptoCred (19-Part Technical Analysis Complete Course)
// Core Focus: Horizontal S/R, Multi-Timeframe Structure (4H/1H/15M/5M), Candlestick Invalidation & Strict 1:2.2+ RRR

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

export class CryptoCredTradingEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'SIDEWAYS' };
    let candles15m: KlinePoint[] = [];
    let candles5m: KlinePoint[] = [];
    let candles1h: KlinePoint[] = [];
    let candles4h: KlinePoint[] = [];

    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf && typeof candlesOrMtf === 'object') {
      candles15m = candlesOrMtf.candles15m || [];
      candles5m = candlesOrMtf.candles5m || [];
      candles1h = candlesOrMtf.candles1h || [];
      candles4h = candlesOrMtf.candles4h || [];
    }

    if (!candles15m || candles15m.length < 30) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currentPrice = currentCandle.close;

    // MTF Candlestick & S/R Analysis
    let mtfResult: MultiTimeframeAnalysisResult | null = null;
    if (candles5m.length >= 10 || candles1h.length >= 15 || candles4h.length >= 15) {
      mtfResult = multiTimeframeCandleEngine.evaluateMultiTimeframe(symbol, candles5m, candles15m, candles1h, candles4h);
    }

    const lookback = candles15m.slice(-30, -1);
    let sLevel = Math.min(...lookback.map(c => c.low));
    let rLevel = Math.max(...lookback.map(c => c.high));
    if (mtfResult && mtfResult.keyLevels1h.support > 0) {
      sLevel = mtfResult.keyLevels1h.support;
      rLevel = mtfResult.keyLevels1h.resistance;
    }

    const atr = this.calcATR(candles15m, 14);

    // Crypto Cred Setup 1: Horizontal Support Bounce with Pin/Engulfing confirmation
    const isTestingSupport = Math.abs(currentPrice - sLevel) <= atr * 0.85 || (currentCandle.low <= sLevel && currentCandle.close >= sLevel);
    const hasBullishPattern = mtfResult?.patterns15m.some(p => p.side === 'BUY') || mtfResult?.patterns5m.some(p => p.side === 'BUY');
    if (isTestingSupport && hasBullishPattern && currentCandle.close > currentCandle.open) {
      const sl = sLevel - atr * 1.1;
      const tp = currentPrice + (currentPrice - sl) * 2.2;
      return {
        recommendedSide: 'BUY',
        confidenceScore: 88,
        setupType: 'CRED_HORIZONTAL_SUPPORT_BOUNCE',
        reasons: ['Horizontal Support Floor tested', 'Bullish Candlestick Confirmation', 'Defined Invalidation Level'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'BULLISH_REVERSAL'
      };
    }

    // Crypto Cred Setup 2: Horizontal Resistance Rejection with Pin/Engulfing confirmation
    const isTestingResistance = Math.abs(currentPrice - rLevel) <= atr * 0.85 || (currentCandle.high >= rLevel && currentCandle.close <= rLevel);
    const hasBearishPattern = mtfResult?.patterns15m.some(p => p.side === 'SELL') || mtfResult?.patterns5m.some(p => p.side === 'SELL');
    if (isTestingResistance && hasBearishPattern && currentCandle.close < currentCandle.open) {
      const sl = rLevel + atr * 1.1;
      const tp = currentPrice - (sl - currentPrice) * 2.2;
      return {
        recommendedSide: 'SELL',
        confidenceScore: 88,
        setupType: 'CRED_HORIZONTAL_RESISTANCE_REJECTION',
        reasons: ['Horizontal Resistance Ceiling tested', 'Bearish Candlestick Confirmation', 'Defined Invalidation Level'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'BEARISH_REVERSAL'
      };
    }

    // Crypto Cred Setup 3: Multi-Timeframe Trend Continuation
    if (mtfResult && mtfResult.confidenceScore >= 75 && mtfResult.recommendedSide) {
      const isBuy = mtfResult.recommendedSide === 'BUY';
      const slDist = atr * 1.5;
      const sl = isBuy ? currentPrice - slDist : currentPrice + slDist;
      const tp = isBuy ? currentPrice + (slDist * 2.3) : currentPrice - (slDist * 2.3);
      return {
        recommendedSide: isBuy ? 'BUY' : 'SELL',
        confidenceScore: mtfResult.confidenceScore,
        setupType: 'CRED_MTF_STRUCTURE_CONTINUATION',
        reasons: mtfResult.reasons || [],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: isBuy ? 'UPTREND' : 'DOWNTREND'
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

export const cryptoCredEngine = new CryptoCredTradingEngine();
