// VirtualBacon 7-Year Crypto Trading Strategy Engine
// Video: https://youtu.be/QKdbH4333wc ("7 Years of Crypto Trading Knowledge in 50 Minutes")
// Multi-Timeframe Candlestick & Price Action Analysis (4H, 1H, 15M, 5M)
// Core Setup: 4H/1H 200 EMA + 21 EMA Macro Regime + S/R Flip Retest + 0.5-0.618 Fib Golden Pocket + 5M Rejection Trigger + Strict 1:2.2 RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface VirtualBaconSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'SR_FLIP_RETEST_LONG' | 'SR_FLIP_RETEST_SHORT' | 'EMA21_TREND_RIDE_LONG' | 'EMA21_TREND_RIDE_SHORT' | 'FIB_GOLDEN_POCKET_BOUNCE_LONG' | 'FIB_GOLDEN_POCKET_REJECT_SHORT' | 'NONE';
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class VirtualBaconCryptoEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): VirtualBaconSetupResult {
    const result: VirtualBaconSetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'NEUTRAL'
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
    const currentPrice = currentCandle.close;

    // 1. Calculate 21 EMA and 200 EMA on 15m
    const closes15m = candles15m.map(c => c.close);
    const ema21 = this.calcEMA(closes15m, 21);
    const emaPeriod200 = Math.min(200, closes15m.length - 5);
    const ema200 = this.calcEMA(closes15m, emaPeriod200);

    // 2. ATR & Volume Analysis
    const atr = this.calcATR(candles15m, 14);
    const volumes = candles15m.slice(-21, -1).map(c => c.volume || 1);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
    const currentVol = currentCandle.volume || 1;
    const rvol = currentVol / (avgVol || 1);

    // 3. Taker CVD / Microstructure
    const cvd = microData?.cvd ?? 0;
    const takerBuyRatio = microData?.takerBuyRatio ?? 0.50;
    const allowBuyFlow = cvd >= -15 && takerBuyRatio >= 0.40;
    const allowSellFlow = cvd <= 15 && takerBuyRatio <= 0.60;

    // 4. Multi-Timeframe Candlestick Engine (4H, 1H, 15M, 5M)
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

    // 5. Significant S&R and Fibonacci Retracement
    const history = candles15m.slice(-40, -5);
    const swingHigh = Math.max(...history.map(c => c.high));
    const swingLow = Math.min(...history.map(c => c.low));
    const fibRange = swingHigh - swingLow;
    const fib618 = swingHigh - (fibRange * 0.618);
    const fib500 = swingHigh - (fibRange * 0.500);

    // -------------------------------------------------------------
    // SETUP A: VIRTUALBACON S/R FLIP & FIB RETEST LONG
    // -------------------------------------------------------------
    const isMacroBullish = mtfResult ? (mtfResult.trend1h === 'BULLISH' || mtfResult.trend4h === 'BULLISH') : (currentPrice > ema200 && ema21 >= ema200);
    const brokeAboveFlip = candles15m.slice(-8, -1).some(c => c.close > swingHigh);
    // Crucial: S/R Flip ONLY valid if price previously closed above swingHigh and is now retesting it as support
    const touchesFlipSupport = brokeAboveFlip && (Math.abs(currentCandle.low - swingHigh) <= atr * 0.75 || (currentCandle.low <= swingHigh && currentCandle.close > swingHigh));
    const touchesFibPocketLong = fibRange > atr * 2 && currentCandle.low <= fib500 && currentCandle.low >= fib618 * 0.995 && currentCandle.close >= fib618;
    
    // Candlestick rejection trigger on 15m or 5m
    const hasRejectionTriggerLong = mtfResult?.patterns5m.some(p => p.side === 'BUY') || mtfResult?.patterns15m.some(p => p.side === 'BUY') ||
      (currentCandle.close > currentCandle.open && (currentCandle.close - currentCandle.low) > (currentCandle.high - currentCandle.low) * 0.45);

    if (isMacroBullish && (touchesFlipSupport || touchesFibPocketLong) && hasRejectionTriggerLong && allowBuyFlow) {
      const sl = Math.min(swingHigh, ema21, currentCandle.low, fib618) - (atr * 0.35);
      const risk = currentPrice - sl;

      if (risk > 0 && sl < currentPrice) {
        const tp = currentPrice + (risk * 2.2); // Strict 1:2.2 RRR per VirtualBacon!
        result.recommendedSide = 'BUY';
        result.confidenceScore = 91;
        result.setupType = touchesFibPocketLong ? 'FIB_GOLDEN_POCKET_BOUNCE_LONG' : 'SR_FLIP_RETEST_LONG';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BULLISH_SR_FLIP';
        result.reasons.push(`VirtualBacon ${result.setupType} confirmed with MTF candle rejection`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`Low-volume healthy retest (RVOL: ${rvol.toFixed(2)}x) | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP B: VIRTUALBACON S/R FLIP & FIB RETEST SHORT
    // -------------------------------------------------------------
    const isMacroBearish = mtfResult ? (mtfResult.trend1h === 'BEARISH' || mtfResult.trend4h === 'BEARISH') : (currentPrice < ema200 && ema21 <= ema200);
    const brokeBelowFlip = candles15m.slice(-8, -1).some(c => c.close < swingLow);
    // Crucial: S/R Flip ONLY valid if price previously closed below swingLow and is now retesting it as resistance
    const touchesFlipResistance = brokeBelowFlip && (Math.abs(currentCandle.high - swingLow) <= atr * 0.75 || (currentCandle.high >= swingLow && currentCandle.close < swingLow));
    const touchesFibPocketShort = fibRange > atr * 2 && currentCandle.high >= fib500 && currentCandle.high <= fib618 * 1.005 && currentCandle.close <= fib618;

    const hasRejectionTriggerShort = mtfResult?.patterns5m.some(p => p.side === 'SELL') || mtfResult?.patterns15m.some(p => p.side === 'SELL') ||
      (currentCandle.close < currentCandle.open && (currentCandle.high - currentCandle.close) > (currentCandle.high - currentCandle.low) * 0.45);

    if (isMacroBearish && (touchesFlipResistance || touchesFibPocketShort) && hasRejectionTriggerShort && allowSellFlow) {
      const sl = Math.max(swingLow, ema21, currentCandle.high, fib618) + (atr * 0.35);
      const risk = sl - currentPrice;

      if (risk > 0 && sl > currentPrice) {
        const tp = currentPrice - (risk * 2.2); // Strict 1:2.2 RRR per VirtualBacon!
        result.recommendedSide = 'SELL';
        result.confidenceScore = 91;
        result.setupType = touchesFibPocketShort ? 'FIB_GOLDEN_POCKET_REJECT_SHORT' : 'SR_FLIP_RETEST_SHORT';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BEARISH_SR_FLIP';
        result.reasons.push(`VirtualBacon ${result.setupType} confirmed with MTF candle rejection`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`Low-volume healthy retest (RVOL: ${rvol.toFixed(2)}x) | CVD: ${cvd.toFixed(1)}`);
        return result;
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

export const virtualBaconEngine = new VirtualBaconCryptoEngine();
