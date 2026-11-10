// Neeraj Joshi Complete Trading Masterclass Engine (Crypto Delta Edition)
// Video: https://youtu.be/tF_Y29qBjyM ("Master Trading in 6 Hours | Complete Trading Course")
// Multi-Timeframe Candlestick Price Action (4H, 1H, 15M, 5M)
// Core Setup: 4H/1H 200 EMA + 20 EMA Trend + 15M/5M Candlestick Patterns (Hammer, Engulfing, Morning/Evening Star, Marubozu, Tweezers) + Strict 1:2 RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface NeerajSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'BULLISH_ENGULFING' | 'HAMMER_BOUNCE' | 'MORNING_STAR' | 'BEARISH_ENGULFING' | 'SHOOTING_STAR' | 'EVENING_STAR' | 'MARUBOZU_MOMENTUM' | 'TWEEZER_SETUP' | 'PIERCING_DARKCLOUD' | 'NONE';
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class NeerajJoshiTradingEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): NeerajSetupResult {
    const result: NeerajSetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'RANGE'
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

    // 1. Calculate 20 EMA, 50 EMA on 15m
    const closes15m = candles15m.map(c => c.close);
    const ema20 = this.calcEMA(closes15m, 20);
    const ema50 = this.calcEMA(closes15m, 50);

    // 2. RSI(14) & ATR(14)
    const rsi = this.calcRSI(closes15m, 14);
    const atr = this.calcATR(candles15m, 14);

    // 3. Taker CVD / Microstructure
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

    // Determine Macro Trend from 1H 200 EMA / 4H
    let isMacroBullish = currentPrice >= ema50;
    let isMacroBearish = currentPrice <= ema50;
    if (mtfResult) {
      if (mtfResult.ema200_1h > 0) {
        isMacroBullish = currentPrice >= mtfResult.ema200_1h || mtfResult.trend1h === 'BULLISH';
        isMacroBearish = currentPrice <= mtfResult.ema200_1h || mtfResult.trend1h === 'BEARISH';
      }
    }

    // Candlestick Geometry
    const curBody = Math.abs(currentCandle.close - currentCandle.open);
    const curRange = currentCandle.high - currentCandle.low;
    const prevBody = Math.abs(prevCandle.close - prevCandle.open);
    const curUpperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
    const curLowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;

    if (curRange <= 0) return result;

    // -------------------------------------------------------------
    // SETUP A: BULLISH CANDLESTICK PATTERNS (Neeraj Joshi Course)
    // -------------------------------------------------------------
    // 1. Hammer (Lower wick >= 1.8x body)
    const isHammer = curLowerWick >= curBody * 1.8 && curUpperWick <= curBody * 0.5 && curBody > 0;
    // 2. Bullish Engulfing
    const isBullishEngulfing = prevCandle.close < prevCandle.open && 
                               currentCandle.close > currentCandle.open && 
                               currentCandle.close > prevCandle.open && 
                               currentCandle.open <= prevCandle.close;
    // 3. Morning Star
    const isMorningStar = prev2Candle.close < prev2Candle.open &&
                          prevBody < (prev2Candle.high - prev2Candle.low) * 0.35 &&
                          currentCandle.close > currentCandle.open &&
                          currentCandle.close > (prev2Candle.open + prev2Candle.close) / 2;
    // 4. Marubozu / Piercing / Tweezers from MTF
    const hasMtfBullTrigger = mtfResult?.patterns5m.some(p => p.side === 'BUY') || mtfResult?.patterns15m.some(p => p.side === 'BUY');

    if (isMacroBullish && (isHammer || isBullishEngulfing || isMorningStar || hasMtfBullTrigger) && allowBuyFlow && rsi >= 40 && rsi <= 75) {
      let patternType: NeerajSetupResult['setupType'] = 'BULLISH_ENGULFING';
      let patternLow = Math.min(currentCandle.low, prevCandle.low);

      if (isHammer) {
        patternType = 'HAMMER_BOUNCE';
        patternLow = currentCandle.low;
      } else if (isMorningStar) {
        patternType = 'MORNING_STAR';
        patternLow = Math.min(currentCandle.low, prevCandle.low, prev2Candle.low);
      } else if (hasMtfBullTrigger) {
        patternType = 'MARUBOZU_MOMENTUM';
      }

      const sl = patternLow - (atr * 0.25);
      const risk = currentPrice - sl;

      if (risk > 0 && sl < currentPrice) {
        const tp = currentPrice + (risk * 2.0); // Exact 1:2 RRR per Neeraj Joshi course!
        result.recommendedSide = 'BUY';
        result.confidenceScore = 90;
        result.setupType = patternType;
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BULLISH_PRICE_ACTION';
        result.reasons.push(`Neeraj Joshi ${patternType} confirmed on 15M/5M with multi-timeframe trend alignment`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`RSI(14): ${rsi.toFixed(1)} | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP B: BEARISH CANDLESTICK PATTERNS (Neeraj Joshi Course)
    // -------------------------------------------------------------
    // 1. Shooting Star
    const isShootingStar = curUpperWick >= curBody * 1.8 && curLowerWick <= curBody * 0.5 && curBody > 0;
    // 2. Bearish Engulfing
    const isBearishEngulfing = prevCandle.close > prevCandle.open && 
                               currentCandle.close < currentCandle.open && 
                               currentCandle.close < prevCandle.open && 
                               currentCandle.open >= prevCandle.close;
    // 3. Evening Star
    const isEveningStar = prev2Candle.close > prev2Candle.open &&
                          prevBody < (prev2Candle.high - prev2Candle.low) * 0.35 &&
                          currentCandle.close < currentCandle.open &&
                          currentCandle.close < (prev2Candle.open + prev2Candle.close) / 2;
    // 4. Marubozu / Dark Cloud / Tweezers from MTF
    const hasMtfBearTrigger = mtfResult?.patterns5m.some(p => p.side === 'SELL') || mtfResult?.patterns15m.some(p => p.side === 'SELL');

    if (isMacroBearish && (isShootingStar || isBearishEngulfing || isEveningStar || hasMtfBearTrigger) && allowSellFlow && rsi >= 25 && rsi <= 60) {
      let patternType: NeerajSetupResult['setupType'] = 'BEARISH_ENGULFING';
      let patternHigh = Math.max(currentCandle.high, prevCandle.high);

      if (isShootingStar) {
        patternType = 'SHOOTING_STAR';
        patternHigh = currentCandle.high;
      } else if (isEveningStar) {
        patternType = 'EVENING_STAR';
        patternHigh = Math.max(currentCandle.high, prevCandle.high, prev2Candle.high);
      } else if (hasMtfBearTrigger) {
        patternType = 'MARUBOZU_MOMENTUM';
      }

      const sl = patternHigh + (atr * 0.25);
      const risk = sl - currentPrice;

      if (risk > 0 && sl > currentPrice) {
        const tp = currentPrice - (risk * 2.0); // Exact 1:2 RRR per Neeraj Joshi course!
        result.recommendedSide = 'SELL';
        result.confidenceScore = 90;
        result.setupType = patternType;
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BEARISH_PRICE_ACTION';
        result.reasons.push(`Neeraj Joshi ${patternType} confirmed on 15M/5M with multi-timeframe trend alignment`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`RSI(14): ${rsi.toFixed(1)} | CVD: ${cvd.toFixed(1)}`);
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

  private calcRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
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

export const neerajJoshiEngine = new NeerajJoshiTradingEngine();
