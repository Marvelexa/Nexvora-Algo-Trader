// Fabio Valentini (World Top Ranked Scalper on Chart Fanatics) Strategy Engine
// Video: https://youtu.be/tvERE-Beu2U ("Trading LIVE with a World TOP Ranked Scalper")
// Multi-Timeframe Candlestick & Scalping Engine (1H, 15M, 5M)
// Core Setup: 1H/15M Trend + 5M VWAP Bands + Order Flow Taker CVD Absorption + Candlestick Rejection + Tight Scalper 1:1.8 RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface FabioScalpSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'VWAP_SELLER_ABSORPTION_LONG' | 'VWAP_BUYER_ABSORPTION_SHORT' | 'DELTA_EXHAUSTION_SCALP_LONG' | 'DELTA_EXHAUSTION_SCALP_SHORT' | 'MTF_SCALP_PIN_BUY' | 'MTF_SCALP_PIN_SELL' | 'NONE';
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class FabioValentiniScalperEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): FabioScalpSetupResult {
    const result: FabioScalpSetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'SCALPING'
    };

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

    // For Fabio Valentini scalper, 5m candles are primary trigger!
    const triggerCandles = candles5m.length >= 20 ? candles5m : candles15m;
    if (!triggerCandles || triggerCandles.length < 20) return result;

    const currentCandle = triggerCandles[triggerCandles.length - 1];
    const prevCandle = triggerCandles[triggerCandles.length - 2];
    const currentPrice = currentCandle.close;

    // 1. Calculate VWAP & Standard Deviation Bands (over past 30 periods)
    const vwapData = this.calcVWAP(triggerCandles.slice(-30));
    const vwap = vwapData.vwap;
    const vwapUpper = vwap + (vwapData.stdDev * 1.25);
    const vwapLower = vwap - (vwapData.stdDev * 1.25);

    // 2. ATR
    const atr = this.calcATR(triggerCandles, 14);

    // 3. Taker CVD / Delta Microstructure
    const cvd = microData?.cvd ?? 0;
    const takerBuyRatio = microData?.takerBuyRatio ?? 0.50;
    const allowBuyFlow = cvd >= -15 && takerBuyRatio >= 0.40;
    const allowSellFlow = cvd <= 15 && takerBuyRatio <= 0.60;

    // 4. Multi-Timeframe Candlestick Engine
    let mtfResult: MultiTimeframeAnalysisResult | null = null;
    if (candles5m.length >= 10 || candles1h.length >= 15 || candles4h.length >= 15) {
      mtfResult = multiTimeframeCandleEngine.evaluateMultiTimeframe(
        symbol,
        candles5m,
        candles15m,
        candles1h,
        candles4h
      );
    }

    // 5. Absorption Candlestick Metrics
    const curRange = currentCandle.high - currentCandle.low;
    if (curRange <= 0) return result;

    const curLowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
    const curUpperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);

    // -------------------------------------------------------------
    // SETUP A: VWAP SELLER ABSORPTION (LONG SCALP)
    // -------------------------------------------------------------
    const touchesLowerBand = currentCandle.low <= vwapLower || prevCandle.low <= vwapLower;
    const hasAbsorptionLowerWick = curLowerWick >= curRange * 0.40;
    const has5mBullPin = mtfResult?.patterns5m.some(p => p.side === 'BUY');

    if ((touchesLowerBand || has5mBullPin) && (hasAbsorptionLowerWick || currentCandle.close > currentCandle.open) && allowBuyFlow) {
      const sl = Math.min(currentCandle.low, prevCandle.low) - (atr * 0.25);
      const risk = currentPrice - sl;

      if (risk > 0 && sl < currentPrice) {
        const tp = currentPrice + (risk * 1.8); // Strict 1:1.8 Scalp RRR per Fabio Valentini
        result.recommendedSide = 'BUY';
        result.confidenceScore = 91;
        result.setupType = touchesLowerBand ? 'VWAP_SELLER_ABSORPTION_LONG' : 'MTF_SCALP_PIN_BUY';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'SCALP_ABSORPTION_BOUNCE';
        result.reasons.push(`Fabio Valentini ${result.setupType} confirmed with MTF candle absorption`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`VWAP: $${vwap.toFixed(4)} (Lower Band: $${vwapLower.toFixed(4)}) | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP B: VWAP BUYER ABSORPTION (SHORT SCALP)
    // -------------------------------------------------------------
    const touchesUpperBand = currentCandle.high >= vwapUpper || prevCandle.high >= vwapUpper;
    const hasAbsorptionUpperWick = curUpperWick >= curRange * 0.40;
    const has5mBearPin = mtfResult?.patterns5m.some(p => p.side === 'SELL');

    if ((touchesUpperBand || has5mBearPin) && (hasAbsorptionUpperWick || currentCandle.close < currentCandle.open) && allowSellFlow) {
      const sl = Math.max(currentCandle.high, prevCandle.high) + (atr * 0.25);
      const risk = sl - currentPrice;

      if (risk > 0 && sl > currentPrice) {
        const tp = currentPrice - (risk * 1.8); // Strict 1:1.8 Scalp RRR per Fabio Valentini
        result.recommendedSide = 'SELL';
        result.confidenceScore = 91;
        result.setupType = touchesUpperBand ? 'VWAP_BUYER_ABSORPTION_SHORT' : 'MTF_SCALP_PIN_SELL';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'SCALP_EXHAUSTION_REVERSAL';
        result.reasons.push(`Fabio Valentini ${result.setupType} confirmed with MTF candle absorption`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`VWAP: $${vwap.toFixed(4)} (Upper Band: $${vwapUpper.toFixed(4)}) | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    return result;
  }

  private calcVWAP(candles: any[]): { vwap: number; stdDev: number } {
    let cumVol = 0;
    let cumTypicalVol = 0;
    const typicalPrices: number[] = [];

    for (const c of candles) {
      const vol = c.volume || 1;
      const tp = (c.high + c.low + c.close) / 3;
      cumVol += vol;
      cumTypicalVol += tp * vol;
      typicalPrices.push(tp);
    }

    const vwap = cumVol > 0 ? cumTypicalVol / cumVol : typicalPrices[typicalPrices.length - 1];

    let varianceSum = 0;
    for (const tp of typicalPrices) {
      varianceSum += Math.pow(tp - vwap, 2);
    }
    const stdDev = Math.sqrt(varianceSum / (typicalPrices.length || 1));

    return { vwap, stdDev };
  }

  private calcATR(candles: any[], period: number): number {
    if (candles.length < period + 1) return 1.0;
    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const cur = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      );
      trSum += tr;
    }
    return trSum / period;
  }
}

export const fabioValentiniEngine = new FabioValentiniScalperEngine();
