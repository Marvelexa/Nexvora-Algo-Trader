// MoneyZG Cryptocurrency Trading Masterclass Engine
// Video: https://youtu.be/2ByOXdddmDM ("Complete Crypto Trading Course: Beginner to Advanced")
// Multi-Timeframe Candlestick & Price Action Analysis (4H, 1H, 15M, 5M)
// Core Setup: 4H/1H 20/50/200 EMA Ribbon + 15M Value Zone Pullback + 15M/5M Candlestick Rejection + Strict 1:2 RRR

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface MoneyZgSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'VALUE_ZONE_PULLBACK_LONG' | 'VALUE_ZONE_PULLBACK_SHORT' | 'EMA_CROSS_MOMENTUM_LONG' | 'EMA_CROSS_MOMENTUM_SHORT' | 'MTF_CANDLE_TRIGGER_BUY' | 'MTF_CANDLE_TRIGGER_SELL' | 'NONE';
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class MoneyZgCryptoEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): MoneyZgSetupResult {
    const result: MoneyZgSetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'TRENDING'
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

    // 1. Calculate 20 EMA and 50 EMA on 15m
    const closes15m = candles15m.map(c => c.close);
    const ema20 = this.calcEMA(closes15m, 20);
    const ema50 = this.calcEMA(closes15m, 50);

    // 2. RSI(14) & ATR(14)
    const rsi = this.calcRSI(closes15m, 14);
    const atr = this.calcATR(candles15m, 14);

    // 3. CVD / Microstructure
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

    // -------------------------------------------------------------
    // SETUP A: MONEYZG VALUE ZONE PULLBACK (LONG)
    // -------------------------------------------------------------
    const isMacroUptrend = mtfResult ? (mtfResult.trend1h === 'BULLISH' || mtfResult.trend4h === 'BULLISH') : (ema20 > ema50 && currentPrice >= ema50);
    // Price dipped into the 20-50 EMA ribbon (Value Zone)
    const touchedValueZoneLong = currentCandle.low <= ema20 * 1.002 && currentCandle.low >= ema50 * 0.998;
    const hasRejectionWickLong = (Math.min(currentCandle.open, currentCandle.close) - currentCandle.low) >= (currentCandle.high - currentCandle.low) * 0.35;
    const has5mBullTrigger = mtfResult?.patterns5m.some(p => p.side === 'BUY') || mtfResult?.patterns15m.some(p => p.side === 'BUY');

    if (isMacroUptrend && (touchedValueZoneLong || has5mBullTrigger) && (hasRejectionWickLong || currentCandle.close > currentCandle.open) && allowBuyFlow && rsi >= 40 && rsi <= 72) {
      const sl = Math.min(currentCandle.low, ema50) - (atr * 0.3);
      const risk = currentPrice - sl;

      if (risk > 0 && sl < currentPrice) {
        const tp = currentPrice + (risk * 2.0); // Strict 1:2 RRR per MoneyZG
        result.recommendedSide = 'BUY';
        result.confidenceScore = 91;
        result.setupType = touchedValueZoneLong ? 'VALUE_ZONE_PULLBACK_LONG' : 'MTF_CANDLE_TRIGGER_BUY';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BULLISH_TRENDING';
        result.reasons.push(`MoneyZG ${result.setupType} confirmed with MTF candlestick alignment`);
        if (mtfResult) result.reasons.push(`4H:${mtfResult.trend4h} | 1H:${mtfResult.trend1h} | 15M:${mtfResult.trend15m} | 5M:${mtfResult.trend5m}`);
        result.reasons.push(`RSI(14): ${rsi.toFixed(1)} | CVD: ${cvd.toFixed(1)}`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // SETUP B: MONEYZG VALUE ZONE PULLBACK (SHORT)
    // -------------------------------------------------------------
    const isMacroDowntrend = mtfResult ? (mtfResult.trend1h === 'BEARISH' || mtfResult.trend4h === 'BEARISH') : (ema20 < ema50 && currentPrice <= ema50);
    const touchedValueZoneShort = currentCandle.high >= ema20 * 0.998 && currentCandle.high <= ema50 * 1.002;
    const hasRejectionWickShort = (currentCandle.high - Math.max(currentCandle.open, currentCandle.close)) >= (currentCandle.high - currentCandle.low) * 0.35;
    const has5mBearTrigger = mtfResult?.patterns5m.some(p => p.side === 'SELL') || mtfResult?.patterns15m.some(p => p.side === 'SELL');

    if (isMacroDowntrend && (touchedValueZoneShort || has5mBearTrigger) && (hasRejectionWickShort || currentCandle.close < currentCandle.open) && allowSellFlow && rsi >= 28 && rsi <= 60) {
      const sl = Math.max(currentCandle.high, ema50) + (atr * 0.3);
      const risk = sl - currentPrice;

      if (risk > 0 && sl > currentPrice) {
        const tp = currentPrice - (risk * 2.0); // Strict 1:2 RRR per MoneyZG
        result.recommendedSide = 'SELL';
        result.confidenceScore = 91;
        result.setupType = touchedValueZoneShort ? 'VALUE_ZONE_PULLBACK_SHORT' : 'MTF_CANDLE_TRIGGER_SELL';
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.marketRegime = 'BEARISH_TRENDING';
        result.reasons.push(`MoneyZG ${result.setupType} confirmed with MTF candlestick alignment`);
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

export const moneyZgEngine = new MoneyZgCryptoEngine();
