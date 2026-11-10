import { KlinePoint } from '../../src/types';

/**
 * ============================================================================
 * THE TRADING CHANNEL (STEVEN HART) - 3 SIGNS TREND REVERSAL ENGINE
 * Based on: "3 Signs That Tell You Exactly When The Trend Is OVER...(Reversal Trading Strategy)"
 * Video: https://youtu.be/VYjFoksdH5c
 * 
 * THE 3 CORE SIGNS:
 * - SIGN 1: Price reaches a Major Level of Structure on Higher Timeframe (tested ≥2 times).
 * - SIGN 2: RSI Overbought (>70) / Oversold (<30) OR Regular RSI Divergence.
 * - SIGN 3: Reversal Confirmation Pattern (Engulfing, Pin Bar, or Double Top/Bottom).
 * ============================================================================
 */

export interface TradingChannelVerdict {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'BEARISH_3_SIGNS_REVERSAL' | 'BULLISH_3_SIGNS_REVERSAL' | 'NONE';
  entryPrice: number;
  sign1Confirmed: boolean;
  sign2Confirmed: boolean;
  sign3Confirmed: boolean;
  customSL?: number;
  customTP?: number;
  reasons: string[];
}

export class TradingChannel3SignsEngine {
  private calculateRSI(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) return new Array(closes.length).fill(50);
    const rsiValues: number[] = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiValues.push(100 - (100 / (1 + rs)));
    }

    const pad = new Array(closes.length - rsiValues.length).fill(50);
    return [...pad, ...rsiValues];
  }

  private calculateATR(candles: KlinePoint[], period: number = 14): number {
    if (candles.length < 2) return 1.0;
    let sum = 0;
    const len = Math.min(period, candles.length - 1);
    for (let i = candles.length - len; i < candles.length; i++) {
      const prev = candles[i - 1];
      const cur = candles[i];
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      );
      sum += tr;
    }
    return sum / len;
  }

  public evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    microData?: any
  ): TradingChannelVerdict {
    if (!candles || candles.length < 30) {
      return {
        symbol,
        recommendedSide: null,
        confidenceScore: 0,
        setupType: 'NONE',
        entryPrice: 0,
        sign1Confirmed: false,
        sign2Confirmed: false,
        sign3Confirmed: false,
        reasons: ['Insufficient candle history (<30 bars) for 3-Signs analysis'],
      };
    }

    const closes = candles.map(c => c.close);
    const rsiArr = this.calculateRSI(closes, 14);
    const atr = this.calculateATR(candles, 14);

    const lastBar = candles[candles.length - 1];
    const prevBar = candles[candles.length - 2];
    const priorBars = candles.slice(-40, -3);

    const currentRSI = rsiArr[rsiArr.length - 1] || 50;
    const prevRSI = rsiArr[rsiArr.length - 2] || 50;
    const currentPrice = lastBar.close;

    // -------------------------------------------------------------
    // SIGN 1: Major Level of Structure on Higher Time Frame (HTF)
    // -------------------------------------------------------------
    // Detect major swing resistance (at least 3 touches within 0.35 * ATR across 40 bars)
    let majorResistance = 0;
    let majorSupport = Infinity;
    const highs = priorBars.map(c => c.high);
    const lows = priorBars.map(c => c.low);

    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);

    const touchesHigh = highs.filter(h => Math.abs(h - maxHigh) <= 0.35 * atr).length;
    const touchesLow = lows.filter(l => Math.abs(l - minLow) <= 0.35 * atr).length;

    if (touchesHigh >= 2) majorResistance = maxHigh;
    if (touchesLow >= 2) majorSupport = minLow;

    const isAtResistance = majorResistance > 0 && Math.abs(lastBar.high - majorResistance) <= 0.45 * atr;
    const isAtSupport = majorSupport < Infinity && Math.abs(lastBar.low - majorSupport) <= 0.45 * atr;

    // -------------------------------------------------------------
    // SIGN 2: RSI Exhaustion & Regular RSI Divergence (Steven Hart Core Rule)
    // In trending conditions, raw RSI is a trap. Divergence or extreme exhaustion + curl is required.
    // -------------------------------------------------------------
    // Bearish Divergence: Price higher high, RSI lower high across the last 15 bars
    const recentBars = candles.slice(-20);
    let isBearishDivergence = false;
    let isBullishDivergence = false;

    // Search for prior swing peak
    let priorPeakPrice = 0;
    let priorPeakRsi = 0;
    for (let i = 0; i < recentBars.length - 3; i++) {
      const b = recentBars[i];
      const r = rsiArr[candles.length - 20 + i] || 50;
      if (b.high > priorPeakPrice) {
        priorPeakPrice = b.high;
        priorPeakRsi = r;
      }
    }

    if (priorPeakPrice > 0 && lastBar.high >= priorPeakPrice && currentRSI < (priorPeakRsi - 2.5)) {
      isBearishDivergence = true;
    }

    // Bullish Divergence: Price lower low, RSI higher low across the last 15 bars
    let priorTroughPrice = Infinity;
    let priorTroughRsi = 100;
    for (let i = 0; i < recentBars.length - 3; i++) {
      const b = recentBars[i];
      const r = rsiArr[candles.length - 20 + i] || 50;
      if (b.low < priorTroughPrice) {
        priorTroughPrice = b.low;
        priorTroughRsi = r;
      }
    }

    if (priorTroughPrice < Infinity && lastBar.low <= priorTroughPrice && currentRSI > (priorTroughRsi + 2.5)) {
      isBullishDivergence = true;
    }

    // Anti-Trap Rule: In strong trends, MANDATE Divergence. Only in ranging can extreme RSI (>74/<26) trigger.
    const isRSIOverbought = isBearishDivergence || (currentRSI >= 74 && currentRSI < prevRSI);
    const isRSIOversold = isBullishDivergence || (currentRSI <= 26 && currentRSI > prevRSI);

    // -------------------------------------------------------------
    // SIGN 3: Decisive Reversal Candlestick (Steven Hart Clean Patterns)
    // Eliminates weak single-pip red closes: requires true Engulfing or Shooting Star / Hammer Pin Bar
    // -------------------------------------------------------------
    const lastRange = lastBar.high - lastBar.low;
    const lastBody = Math.abs(lastBar.close - lastBar.open);
    const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
    const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;

    // Bearish Engulfing: previous candle green, current candle red, engulfs previous body with significant size
    const isBearishEngulfing = prevBar.close > prevBar.open &&
      lastBar.close < lastBar.open &&
      lastBar.close <= prevBar.open &&
      lastBar.open >= prevBar.close &&
      lastBody >= 0.40 * atr;

    // Shooting Star: upper wick >= 2.0x body, lower wick small, closes red or near bottom
    const isShootingStar = upperWick >= (1.8 * Math.max(lastBody, 0.1 * atr)) &&
      lowerWick <= (0.25 * (lastRange || 1)) &&
      lastBar.close <= lastBar.low + 0.40 * (lastRange || 1) &&
      lastBar.close < lastBar.open;

    const isBearishPattern = isBearishEngulfing || isShootingStar;

    // Bullish Engulfing: previous candle red, current candle green, engulfs previous body
    const isBullishEngulfing = prevBar.close < prevBar.open &&
      lastBar.close > lastBar.open &&
      lastBar.close >= prevBar.open &&
      lastBar.open <= prevBar.close &&
      lastBody >= 0.40 * atr;

    // Hammer: lower wick >= 2.0x body, upper wick small, closes green or near top
    const isHammer = lowerWick >= (1.8 * Math.max(lastBody, 0.1 * atr)) &&
      upperWick <= (0.25 * (lastRange || 1)) &&
      lastBar.close >= lastBar.high - 0.40 * (lastRange || 1) &&
      lastBar.close > lastBar.open;

    const isBullishPattern = isBullishEngulfing || isHammer;

    const reasons: string[] = [];
    let recommendedSide: 'BUY' | 'SELL' | null = null;
    let confidenceScore = 0;
    let setupType: 'BEARISH_3_SIGNS_REVERSAL' | 'BULLISH_3_SIGNS_REVERSAL' | 'NONE' = 'NONE';
    let customSL: number | undefined;
    let customTP: number | undefined;

    // Check Bearish 3 Signs
    if (isAtResistance && isRSIOverbought && isBearishPattern) {
      recommendedSide = 'SELL';
      setupType = 'BEARISH_3_SIGNS_REVERSAL';
      confidenceScore = 90;
      if (isBearishDivergence) confidenceScore += 6;

      reasons.push(
        `[The Trading Channel] Sign 1: Major HTF Resistance ($${majorResistance.toFixed(2)}) reached with ${touchesHigh} touches.`,
        `[The Trading Channel] Sign 2: RSI Exhaustion/Divergence confirmed (RSI: ${currentRSI.toFixed(1)}${isBearishDivergence ? ' - Regular Bearish Divergence' : ' - Extreme Overbought Curl'}).`,
        `[The Trading Channel] Sign 3: Decisive Reversal Candlestick confirmed (${isBearishEngulfing ? 'Bearish Engulfing' : 'Shooting Star Pin Bar'}).`,
        `[The Trading Channel Anti-Trap] Passed momentum trap shield: Decisive rejection confirmed at major structure.`
      );

      customSL = parseFloat((Math.max(lastBar.high, majorResistance) + 0.35 * atr).toFixed(4));
      const lossDist = Math.abs(customSL - currentPrice);
      const minTargetDist = lossDist * 2.30;
      // Pre-reversal target: placed just BEFORE support turnaround level (Rule 6) with strictly >= 2.30 RR (Rule 5)
      const preReversalSupport = (majorSupport < Infinity ? majorSupport : minLow) + (0.10 * atr);
      const naturalDist = currentPrice - preReversalSupport;
      const targetDist = naturalDist >= minTargetDist ? naturalDist : minTargetDist;
      customTP = parseFloat((currentPrice - targetDist).toFixed(4));
    }

    // Check Bullish 3 Signs
    if (isAtSupport && isRSIOversold && isBullishPattern) {
      recommendedSide = 'BUY';
      setupType = 'BULLISH_3_SIGNS_REVERSAL';
      confidenceScore = 90;
      if (isBullishDivergence) confidenceScore += 6;

      reasons.push(
        `[The Trading Channel] Sign 1: Major HTF Support ($${majorSupport.toFixed(2)}) reached with ${touchesLow} touches.`,
        `[The Trading Channel] Sign 2: RSI Exhaustion/Divergence confirmed (RSI: ${currentRSI.toFixed(1)}${isBullishDivergence ? ' - Regular Bullish Divergence' : ' - Extreme Oversold Curl'}).`,
        `[The Trading Channel] Sign 3: Decisive Reversal Candlestick confirmed (${isBullishEngulfing ? 'Bullish Engulfing' : 'Hammer Pin Bar'}).`,
        `[The Trading Channel Anti-Trap] Passed momentum trap shield: Decisive bounce confirmed at major structure.`
      );

      customSL = parseFloat((Math.min(lastBar.low, majorSupport) - 0.35 * atr).toFixed(4));
      const lossDist = Math.abs(currentPrice - customSL);
      const minTargetDist = lossDist * 2.30;
      // Pre-reversal target: placed just BEFORE resistance turnaround level (Rule 6) with strictly >= 2.30 RR (Rule 5)
      const preReversalResistance = (majorResistance > 0 ? majorResistance : maxHigh) - (0.10 * atr);
      const naturalDist = preReversalResistance - currentPrice;
      const targetDist = naturalDist >= minTargetDist ? naturalDist : minTargetDist;
      customTP = parseFloat((currentPrice + targetDist).toFixed(4));
    }

    return {
      symbol,
      recommendedSide,
      confidenceScore: Math.min(100, confidenceScore),
      setupType,
      entryPrice: currentPrice,
      sign1Confirmed: Boolean(isAtResistance || isAtSupport),
      sign2Confirmed: Boolean(isRSIOverbought || isRSIOversold),
      sign3Confirmed: Boolean(isBearishPattern || isBullishPattern),
      customSL,
      customTP,
      reasons,
    };
  }
}

export const tradingChannelEngine = new TradingChannel3SignsEngine();
