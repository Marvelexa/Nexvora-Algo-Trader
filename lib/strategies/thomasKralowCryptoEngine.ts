// Thomas Kralow Institutional Cryptocurrency Trading Course Engine
// Video: https://youtu.be/vH2o7fA286Y ("Complete Cryptocurrency Trading Course")
// Multi-Timeframe Candlestick & Institutional Price Action (4H, 1H, 15M, 5M)
// Core Setup: 4H/1H Liquidity Sweeps (BSL/SSL) + 1H/15M Market Structure Shift (MSS) + 15M/5M FVG Mitigation Rejection + Strict 1:2.2 RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface KralowSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'LIQUIDITY_SWEEP_RECLAIM_LONG' | 'LIQUIDITY_SWEEP_REJECT_SHORT' | 'FVG_MITIGATION_REVERSAL_LONG' | 'FVG_MITIGATION_REVERSAL_SHORT' | 'CONSOLIDATION_BREAK_RETEST_LONG' | 'CONSOLIDATION_BREAK_RETEST_SHORT' | 'NONE';
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class ThomasKralowCryptoEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): KralowSetupResult {
    const result: KralowSetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'CONSOLIDATION'
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

    if (!candles15m || candles15m.length < 30) return result;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const prev2Candle = candles15m[candles15m.length - 3];
    const currentPrice = currentCandle.close;

    // 1. Calculate ATR
    const atr = this.calcATR(candles15m, 14);

    // 2. CVD & Microstructure
    const cvd = microData?.cvd ?? 0;
    const takerBuyRatio = microData?.takerBuyRatio ?? 0.50;
    const allowBuyFlow = cvd >= -15 && takerBuyRatio >= 0.40;
    const allowSellFlow = cvd <= 15 && takerBuyRatio <= 0.60;

    // 3. Multi-Timeframe Candlestick Engine
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

    // 4. Consolidation Range High / Low (1H or 15m)
    const rangeCandles = candles15m.slice(-25, -2);
    let rangeHigh = Math.max(...rangeCandles.map(c => c.high));
    let rangeLow = Math.min(...rangeCandles.map(c => c.low));
    if (mtfResult && mtfResult.keyLevels1h.resistance > 0) {
      rangeHigh = mtfResult.keyLevels1h.resistance;
      rangeLow = mtfResult.keyLevels1h.support;
    }
    const rangeSpan = rangeHigh - rangeLow;
    if (rangeSpan <= atr * 0.5) return result;

    // 5. 3-Candle Fair Value Gap (FVG) Detection
    // Bullish FVG: prev2.high < current.low
    const isBullishFvg = prev2Candle && (currentCandle.low - prev2Candle.high) >= atr * 0.2;
    // Bearish FVG: prev2.low > current.high
    const isBearishFvg = prev2Candle && (prev2Candle.low - currentCandle.high) >= atr * 0.2;

    // -------------------------------------------------------------
    // SETUP A: INSTITUTIONAL LIQUIDITY SWEEP & RECLAIM (LONG)
    // -------------------------------------------------------------
    const sweptRangeLow = (prevCandle.low < rangeLow || currentCandle.low < rangeLow);
    const reclaimedRangeLow = currentCandle.close > rangeLow && currentCandle.close > currentCandle.open;
    const hasBullishWick = (Math.min(currentCandle.open, currentCandle.close) - currentCandle.low) >= (currentCandle.high - currentCandle.low) * 0.40;
    const has5mReclaimTrigger = mtfResult?.patterns5m.some(p => p.side === 'BUY');

    if (sweptRangeLow && (reclaimedRangeLow || has5mReclaimTrigger) && (hasBullishWick || isBullishFvg) && allowBuyFlow) {
      const sweepExtreme = Math.min(prevCandle.low, currentCandle.low);
      const sl = sweepExtreme - (atr * 0.3);
      const risk = currentPrice - sl;

      if (risk > 0 && sl < currentPrice) {
        const tp = currentPrice + (risk * 2.2); // Strict 1:2.2 RRR per Thomas Kralow!
        result.recommendedSide = 'BUY';
        result.confidenceScore = 93;
        result.setupType = isBullishFvg ? 'FVG_MITIGATION_REVERSAL_LONG' : 'LIQUIDITY_SWEEP_RECLAIM_LONG';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'INSTITUTIONAL_SPRING_ACCUMULATION';
        result.reasons.push(`Thomas Kralow Institutional Liquidity Sweep below $${rangeLow.toFixed(4)} with MTF reclaim`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`CVD: ${cvd.toFixed(1)} | TakerBuyRatio: ${(takerBuyRatio * 100).toFixed(0)}%`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP B: INSTITUTIONAL LIQUIDITY SWEEP & REJECTION (SHORT)
    // -------------------------------------------------------------
    const sweptRangeHigh = (prevCandle.high > rangeHigh || currentCandle.high > rangeHigh);
    const rejectedRangeHigh = currentCandle.close < rangeHigh && currentCandle.close < currentCandle.open;
    const hasBearishWick = (currentCandle.high - Math.max(currentCandle.open, currentCandle.close)) >= (currentCandle.high - currentCandle.low) * 0.40;
    const has5mRejectTrigger = mtfResult?.patterns5m.some(p => p.side === 'SELL');

    if (sweptRangeHigh && (rejectedRangeHigh || has5mRejectTrigger) && (hasBearishWick || isBearishFvg) && allowSellFlow) {
      const sweepExtreme = Math.max(prevCandle.high, currentCandle.high);
      const sl = sweepExtreme + (atr * 0.3);
      const risk = sl - currentPrice;

      if (risk > 0 && sl > currentPrice) {
        const tp = currentPrice - (risk * 2.2); // Strict 1:2.2 RRR per Thomas Kralow!
        result.recommendedSide = 'SELL';
        result.confidenceScore = 93;
        result.setupType = isBearishFvg ? 'FVG_MITIGATION_REVERSAL_SHORT' : 'LIQUIDITY_SWEEP_REJECT_SHORT';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'INSTITUTIONAL_UPTHRUST_DISTRIBUTION';
        result.reasons.push(`Thomas Kralow Institutional Liquidity Sweep above $${rangeHigh.toFixed(4)} with MTF rejection`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`CVD: ${cvd.toFixed(1)} | TakerBuyRatio: ${(takerBuyRatio * 100).toFixed(0)}%`);
        return result;
      }
    }

    return result;
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

export const thomasKralowEngine = new ThomasKralowCryptoEngine();
