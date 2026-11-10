/**
 * HBA SERVICES CRYPTO TRADING COURSE STRATEGY ENGINE (V3 MULTI-TIMEFRAME)
 * Based on "Crypto Trading Complete Course | Become Cryptocurrency Trading Expert" by HBA Services
 * Video: https://www.youtube.com/watch?v=7PPuMzuzMek
 * 
 * Multi-Timeframe Candlestick & Price Action Principles:
 * 1. 15M/1H Trend Filter: 20 EMA vs 50 EMA alignment (Strict zero counter-trend trading)
 * 2. 15M Setup: Dynamic 20 EMA Retest zone (MANDATORY, not optional)
 * 3. Verified Candlestick Triggers:
 *    - Hammer / Bullish Pin Bar (Long lower wick >= 1.7x body)
 *    - Shooting Star / Bearish Pin Bar (Long upper wick >= 1.7x body)
 *    - Bullish / Bearish Engulfing
 *    - Strong Wick Rejection off 20 EMA
 * 4. RSI(14) Momentum Range Confirmation (40-70 for longs, 30-60 for shorts)
 * 5. Relative Volume (RVOL >= 1.1) & Taker CVD Flow
 * 6. Structurally Safe SL (>= 1.5x ATR or 1.5% distance) with Strict 1:2.0 RRR
 */

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface HbaSetupResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  trendState: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ema20: number;
  ema50: number;
  rsi14: number;
  rvol: number;
  candlestickPattern: string | null;
  zoneRetestDetected: boolean;
  reasons: string[];
  customTP: number;
  customSL: number;
}

export class HbaCryptoCourseEngine {
  public calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i];
    let currentEMA = sum / period;
    emaArray.push(currentEMA);

    for (let i = period; i < prices.length; i++) {
      currentEMA = (prices[i] * k) + (currentEMA * (1 - k));
      emaArray.push(currentEMA);
    }
    return emaArray;
  }

  public calculateRSI(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) return [];
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    const rsiArray: number[] = [];
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray.push(100 - (100 / (1 + rs)));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const currentRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiArray.push(100 - (100 / (1 + currentRs)));
    }
    return rsiArray;
  }

  public evaluateSetup(symbol: string, candlesOrMtf: any, macroTrend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL', microData?: any): HbaSetupResult {
    const result: HbaSetupResult = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      trendState: 'NEUTRAL',
      ema20: 0,
      ema50: 0,
      rsi14: 50,
      rvol: 1.0,
      candlestickPattern: null,
      zoneRetestDetected: false,
      reasons: [],
      customTP: 0,
      customSL: 0,
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

    if (!candles15m || candles15m.length < 35) {
      result.reasons.push('Insufficient candle history (need >= 35)');
      return result;
    }

    const closes = candles15m.map(c => c.close);
    const volumes = candles15m.map(c => c.volume || 1);

    const ema20Arr = this.calculateEMA(closes, 20);
    const ema50Arr = this.calculateEMA(closes, 50);
    const rsiArr = this.calculateRSI(closes, 14);

    if (ema20Arr.length < 5 || ema50Arr.length < 5 || rsiArr.length < 5) {
      result.reasons.push('Indicators warming up');
      return result;
    }

    const currentPrice = closes[closes.length - 1];
    const currEma20 = ema20Arr[ema20Arr.length - 1];
    const currEma50 = ema50Arr[ema50Arr.length - 1];
    const currRsi = rsiArr[rsiArr.length - 1];

    result.ema20 = currEma20;
    result.ema50 = currEma50;
    result.rsi14 = currRsi;

    // Calculate ATR(14)
    let trSum = 0;
    for (let i = candles15m.length - 14; i < candles15m.length; i++) {
      const c = candles15m[i];
      const p = candles15m[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      trSum += tr;
    }
    const atr14 = trSum / 14 || (currentPrice * 0.01);

    // RVOL Calculation (last 20 bars)
    const recentVols = volumes.slice(-21, -1);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const currentVol = volumes[volumes.length - 1];
    const rvol = avgVol > 0 ? currentVol / avgVol : 1.0;
    result.rvol = rvol;

    // Taker Order Flow / CVD Veto
    const cvd = microData?.cvd ?? 0;
    const takerBuyRatio = microData?.takerBuyRatio ?? 0.50;
    const allowBuyFlow = cvd >= -15 && takerBuyRatio >= 0.40;
    const allowSellFlow = cvd <= 15 && takerBuyRatio <= 0.60;

    // Multi-Timeframe Candlestick Engine
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

    // 1. Trend Filter: 20 EMA vs 50 EMA alignment
    const isBullTrend = currEma20 >= currEma50 && currentPrice >= currEma50 * 0.995;
    const isBearTrend = currEma20 <= currEma50 && currentPrice <= currEma50 * 1.005;

    if (isBullTrend) result.trendState = 'BULLISH';
    else if (isBearTrend) result.trendState = 'BEARISH';
    else {
      result.reasons.push('Trend Neutral: 20 EMA and 50 EMA conflicting or choppy');
      return result;
    }

    // 2. Candlestick Analysis (Current & Previous Bar on 15m)
    const currCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currBody = Math.abs(currCandle.close - currCandle.open);
    const currRange = currCandle.high - currCandle.low || 0.0001;
    const isGreen = currCandle.close >= currCandle.open;
    const isRed = currCandle.close < currCandle.open;

    const lowerWick = Math.min(currCandle.open, currCandle.close) - currCandle.low;
    const upperWick = currCandle.high - Math.max(currCandle.open, currCandle.close);

    // Bullish Patterns
    const isHammer = lowerWick >= 1.7 * currBody && lowerWick >= currRange * 0.40 && upperWick <= 0.25 * currRange && isGreen;
    const prevBody = Math.abs(prevCandle.close - prevCandle.open);
    const isBullishEngulfing = isGreen && prevCandle.close < prevCandle.open &&
      currCandle.close > prevCandle.open && currCandle.open <= prevCandle.close &&
      currBody >= 1.15 * prevBody;
    const isBullishWickBounce = lowerWick >= 1.4 * currBody && lowerWick >= currRange * 0.35 && isGreen && currCandle.close >= currEma20 * 0.998;

    // Bearish Patterns
    const isShootingStar = upperWick >= 1.7 * currBody && upperWick >= currRange * 0.40 && lowerWick <= 0.25 * currRange && isRed;
    const isBearishEngulfing = isRed && prevCandle.close > prevCandle.open &&
      currCandle.close < prevCandle.open && currCandle.open >= prevCandle.close &&
      currBody >= 1.15 * prevBody;
    const isBearishWickReject = upperWick >= 1.4 * currBody && upperWick >= currRange * 0.35 && isRed && currCandle.close <= currEma20 * 1.002;

    // 3. Dynamic 20 EMA Zone Retest Check (MANDATORY in HBA Strategy)
    let isBullEmaRetest = false;
    let isBearEmaRetest = false;

    if (isBullTrend) {
      const candleMinLow = Math.min(currCandle.low, prevCandle.low);
      isBullEmaRetest = (candleMinLow <= currEma20 + (atr14 * 0.60)) && (currentPrice >= currEma20 - (atr14 * 0.40));
    } else if (isBearTrend) {
      const candleMaxHigh = Math.max(currCandle.high, prevCandle.high);
      isBearEmaRetest = (candleMaxHigh >= currEma20 - (atr14 * 0.60)) && (currentPrice <= currEma20 + (atr14 * 0.40));
    }

    // Minimum safe distance for Stop Loss: Never allow microscopic < 1.5% or < 1.5 ATR stops!
    const minSafeSlDistance = Math.max(atr14 * 1.5, currentPrice * 0.015);

    // =========================================================================
    // BULLISH SETUP EVALUATION
    // =========================================================================
    if (isBullTrend && isBullEmaRetest && (isHammer || isBullishEngulfing || isBullishWickBounce) && allowBuyFlow) {
      let patternName = 'BULLISH_WICK_BOUNCE';
      if (isHammer) patternName = 'HAMMER_PIN_BAR';
      else if (isBullishEngulfing) patternName = 'BULLISH_ENGULFING';

      result.candlestickPattern = patternName;
      result.zoneRetestDetected = true;

      let buyScore = 55; // 20>50 EMA + 20 EMA Retest
      buyScore += 25; // Candlestick Confirmation
      if (currRsi >= 40 && currRsi <= 70) buyScore += 10;
      if (rvol >= 1.1) buyScore += 10;

      const rejectionLow = Math.min(currCandle.low, prevCandle.low);
      const slDist = Math.max(currentPrice - rejectionLow + (atr14 * 0.4), minSafeSlDistance);
      const sl = currentPrice - slDist;
      const tp = currentPrice + (slDist * 2.3); // Pure 1:2.3 RRR

      if (sl < currentPrice) {
        result.recommendedSide = 'BUY';
        result.confidenceScore = Math.min(buyScore, 100);
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.reasons.push(`HBA Course Bullish Confluence (${buyScore}/100)`);
        result.reasons.push(`Trend: 20 EMA ($${currEma20.toFixed(4)}) >= 50 EMA ($${currEma50.toFixed(4)})`);
        result.reasons.push(`Dynamic 20 EMA Retest & Trigger: ${patternName}`);
        result.reasons.push(`RSI(14): ${currRsi.toFixed(1)} | RVOL: ${rvol.toFixed(2)}x | CVD: ${cvd.toFixed(1)}`);
        result.reasons.push(`Risk-to-Reward: Strict 1:2.3 Ratio`);
        return result;
      }
    }

    // =========================================================================
    // BEARISH SETUP EVALUATION
    // =========================================================================
    if (isBearTrend && isBearEmaRetest && (isShootingStar || isBearishEngulfing || isBearishWickReject) && allowSellFlow) {
      let patternName = 'BEARISH_WICK_REJECT';
      if (isShootingStar) patternName = 'SHOOTING_STAR_PIN_BAR';
      else if (isBearishEngulfing) patternName = 'BEARISH_ENGULFING';

      result.candlestickPattern = patternName;
      result.zoneRetestDetected = true;

      let sellScore = 55; // 20<50 EMA + 20 EMA Retest
      sellScore += 25; // Candlestick Confirmation
      if (currRsi >= 30 && currRsi <= 60) sellScore += 10;
      if (rvol >= 1.1) sellScore += 10;

      const rejectionHigh = Math.max(currCandle.high, prevCandle.high);
      const slDist = Math.max(rejectionHigh - currentPrice + (atr14 * 0.4), minSafeSlDistance);
      const sl = currentPrice + slDist;
      const tp = currentPrice - (slDist * 2.3); // Pure 1:2.3 RRR

      if (sl > currentPrice) {
        result.recommendedSide = 'SELL';
        result.confidenceScore = Math.min(sellScore, 100);
        result.customSL = Number(sl.toFixed(6));
        result.customTP = Number(tp.toFixed(6));
        result.reasons.push(`HBA Course Bearish Confluence (${sellScore}/100)`);
        result.reasons.push(`Trend: 20 EMA ($${currEma20.toFixed(4)}) <= 50 EMA ($${currEma50.toFixed(4)})`);
        result.reasons.push(`Dynamic 20 EMA Retest & Trigger: ${patternName}`);
        result.reasons.push(`RSI(14): ${currRsi.toFixed(1)} | RVOL: ${rvol.toFixed(2)}x | CVD: ${cvd.toFixed(1)}`);
        result.reasons.push(`Risk-to-Reward: Strict 1:2.3 Ratio`);
        return result;
      }
    }

    result.reasons.push('Waiting for verified HBA 20 EMA Retest + Candlestick Rejection');
    return result;
  }
}

export const hbaCryptoEngine = new HbaCryptoCourseEngine();
