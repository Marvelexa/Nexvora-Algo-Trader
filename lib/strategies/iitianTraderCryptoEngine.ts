// IITian Trader (Saurabh Maurya) Crypto Trading Course Engine
// Video: https://youtu.be/VsMZL5BErnk ("सिर्फ 1 Video में सीखो Crypto Trading")
// Multi-Timeframe Candlestick & Price Action Analysis (4H, 1H, 15M, 5M)
// Core Setup: 4H/1H Market Structure & S&R Zones + 15M Breakout/Retest + 5M Precision Candlestick Trigger + Strict 1:2.2 RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface IITianSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'BREAKOUT_RETEST_LONG' | 'BREAKDOWN_RETEST_SHORT' | 'S_R_BOUNCE_LONG' | 'S_R_REJECTION_SHORT' | 'MTF_CANDLE_TRIGGER_BUY' | 'MTF_CANDLE_TRIGGER_SELL' | 'NONE';
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class IITianTraderCryptoEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): IITianSetupResult {
    const result: IITianSetupResult = {
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

    if (!candles15m || candles15m.length < 30) {
      return result;
    }

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const prev2Candle = candles15m[candles15m.length - 3];
    const currentPrice = currentCandle.close;

    // 1. Calculate 20 EMA, 50 EMA on 15m
    const closes15m = candles15m.map(c => c.close);
    const ema20 = this.calcEMA(closes15m, 20);
    const ema50 = this.calcEMA(closes15m, 50);

    // 2. Relative Volume & ATR
    const volumes = candles15m.slice(-21, -1).map(c => c.volume || 1);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
    const currentVol = currentCandle.volume || 1;
    const rvol = currentVol / (avgVol || 1);
    const atr = this.calcATR(candles15m, 14);

    // 3. Taker CVD / Microstructure
    const cvd = microData?.cvd ?? 0;
    const takerBuyRatio = microData?.takerBuyRatio ?? 0.50;
    const allowBuyFlow = cvd >= -15 && takerBuyRatio >= 0.40;
    const allowSellFlow = cvd <= 15 && takerBuyRatio <= 0.60;

    // 4. Run Cross-Timeframe Candlestick & S&R Analysis (4H, 1H, 15M, 5M)
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

    // 5. Identify 25-period Key Resistance & Support (or from 1H/4H if available)
    const lookback = candles15m.slice(-25, -2);
    let swingHigh = Math.max(...lookback.map(c => c.high));
    let swingLow = Math.min(...lookback.map(c => c.low));
    if (mtfResult && mtfResult.keyLevels1h.resistance > 0) {
      swingHigh = mtfResult.keyLevels1h.resistance;
      swingLow = mtfResult.keyLevels1h.support;
    }

    // -------------------------------------------------------------
    // SETUP A: BULLISH BREAKOUT & RETEST + CANDLESTICK TRIGGER
    // -------------------------------------------------------------
    const isUptrend = (mtfResult ? (mtfResult.trend1h === 'BULLISH' || mtfResult.trend4h === 'BULLISH') : (currentPrice > ema50 && ema20 >= ema50));
    const brokeAboveResistance = prevCandle.close > swingHigh || prev2Candle.close > swingHigh;
    const isRetestingSupport = Math.abs(currentCandle.low - swingHigh) <= atr * 0.8 || (currentCandle.low <= swingHigh && currentCandle.close > swingHigh);
    const isBullishRejection = currentCandle.close > currentCandle.open && (currentCandle.close - currentCandle.low) > (currentCandle.high - currentCandle.low) * 0.45;

    // Trigger on 5m or 15m candle pattern
    const hasBullishPattern = mtfResult?.patterns5m.some(p => p.side === 'BUY') || mtfResult?.patterns15m.some(p => p.side === 'BUY') || isBullishRejection;

    if (isUptrend && brokeAboveResistance && isRetestingSupport && hasBullishPattern && allowBuyFlow) {
      const rawSl = Math.min(currentCandle.low, swingHigh) - (atr * 0.35);
      const sl = Math.max(currentPrice * 0.982, rawSl); // Capped at 1.8% max distance for 25x leverage
      const risk = currentPrice - sl;
      if (risk > 0 && sl < currentPrice) {
        const tp = currentPrice + (risk * 2.2); // Strict 1:2.2 RRR as taught by IITian Trader
        result.recommendedSide = 'BUY';
        result.confidenceScore = 92;
        result.setupType = 'BREAKOUT_RETEST_LONG';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BULLISH_EXPANSION';
        result.reasons.push(`Resistance Breakout at $${swingHigh.toFixed(4)} confirmed with multi-timeframe retest rejection`);
        result.reasons.push(`4H/1H Trend Aligned: ${mtfResult?.trend1h || 'BULLISH'}`);
        result.reasons.push(`RVOL: ${rvol.toFixed(2)}x | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP B: BEARISH BREAKDOWN & RETEST + CANDLESTICK TRIGGER
    // -------------------------------------------------------------
    const isDowntrend = (mtfResult ? (mtfResult.trend1h === 'BEARISH' || mtfResult.trend4h === 'BEARISH') : (currentPrice < ema50 && ema20 <= ema50));
    const brokeBelowSupport = prevCandle.close < swingLow || prev2Candle.close < swingLow;
    const isRetestingResistance = Math.abs(currentCandle.high - swingLow) <= atr * 0.8 || (currentCandle.high >= swingLow && currentCandle.close < swingLow);
    const isBearishRejection = currentCandle.close < currentCandle.open && (currentCandle.high - currentCandle.close) > (currentCandle.high - currentCandle.low) * 0.45;

    const hasBearishPattern = mtfResult?.patterns5m.some(p => p.side === 'SELL') || mtfResult?.patterns15m.some(p => p.side === 'SELL') || isBearishRejection;

    if (isDowntrend && brokeBelowSupport && isRetestingResistance && hasBearishPattern && allowSellFlow) {
      const rawSl = Math.max(currentCandle.high, swingLow) + (atr * 0.35);
      const sl = Math.min(currentPrice * 1.018, rawSl); // Capped at 1.8% max distance for 25x leverage
      const risk = sl - currentPrice;
      if (risk > 0 && sl > currentPrice) {
        const tp = currentPrice - (risk * 2.2); // Strict 1:2.2 RRR
        result.recommendedSide = 'SELL';
        result.confidenceScore = 92;
        result.setupType = 'BREAKDOWN_RETEST_SHORT';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BEARISH_EXPANSION';
        result.reasons.push(`Support Breakdown at $${swingLow.toFixed(4)} confirmed with multi-timeframe retest rejection`);
        result.reasons.push(`4H/1H Trend Aligned: ${mtfResult?.trend1h || 'BEARISH'}`);
        result.reasons.push(`RVOL: ${rvol.toFixed(2)}x | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP C: DIRECT MULTI-TIMEFRAME CANDLESTICK CONFLUENCE (5M Trigger + 15M/1H Trend)
    // -------------------------------------------------------------
    if (mtfResult && mtfResult.recommendedSide && mtfResult.confidenceScore >= 75 && mtfResult.triggerPattern) {
      if (mtfResult.recommendedSide === 'BUY' && allowBuyFlow && !isDowntrend) {
        const sl = Math.min(...candles15m.slice(-3).map(c => c.low)) - (atr * 0.3);
        const risk = currentPrice - sl;
        if (risk > 0 && sl < currentPrice) {
          result.recommendedSide = 'BUY';
          result.confidenceScore = mtfResult.confidenceScore;
          result.setupType = 'MTF_CANDLE_TRIGGER_BUY';
          result.customSL = Number(sl.toFixed(6));
          result.customTP = Number((currentPrice + risk * 2.2).toFixed(6));
          result.marketRegime = 'MTF_PRICE_ACTION_EXPANSION';
          result.reasons.push(`IITian Trader MTF Candlestick Trigger: ${mtfResult.triggerPattern.name} (4H:${mtfResult.trend4h}, 1H:${mtfResult.trend1h}, 15M:${mtfResult.trend15m}, 5M:${mtfResult.trend5m})`);
          return result;
        }
      } else if (mtfResult.recommendedSide === 'SELL' && allowSellFlow && !isUptrend) {
        const sl = Math.max(...candles15m.slice(-3).map(c => c.high)) + (atr * 0.3);
        const risk = sl - currentPrice;
        if (risk > 0 && sl > currentPrice) {
          result.recommendedSide = 'SELL';
          result.confidenceScore = mtfResult.confidenceScore;
          result.setupType = 'MTF_CANDLE_TRIGGER_SELL';
          result.customSL = Number(sl.toFixed(6));
          result.customTP = Number((currentPrice - risk * 2.2).toFixed(6));
          result.marketRegime = 'MTF_PRICE_ACTION_EXPANSION';
          result.reasons.push(`IITian Trader MTF Candlestick Trigger: ${mtfResult.triggerPattern.name} (4H:${mtfResult.trend4h}, 1H:${mtfResult.trend1h}, 15M:${mtfResult.trend15m}, 5M:${mtfResult.trend5m})`);
          return result;
        }
      }
    }

    return result;
  }

  private calcEMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
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

export const iitianTraderEngine = new IITianTraderCryptoEngine();
