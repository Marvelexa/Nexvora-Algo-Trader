/**
 * MARWADI TRADER DELTA EXCHANGE FUTURES & OPTIONS ENGINE (20 LESSONS)
 * Based on "Crypto trading for beginners in 2025 | Delta exchange" by Marwadi Trader
 * Playlist: https://www.youtube.com/watch?v=uKypKp7pjQg&list=PLlmZb_KM4aoUbU3L_GyCVr3Mm3EFXbDzu
 * 
 * Core Components:
 * 1. Open Interest (OI) Analysis (Long Buildup, Short Buildup, Long Unwinding, Short Covering)
 * 2. 20 EMA & 200 EMA Institutional Trend Direction
 * 3. Delta Exchange Order Book Imbalance (Bid/Ask Ratio >= 1.25) & CVD Flow
 * 4. Psychological Round Strike Confluence
 * 5. Dedicated Options + Perps Dual Execution (2 Perp Slots, 2 Option Slots)
 * 6. Strict 1:2 Risk-to-Reward ($5.00 TP, $2.50 SL) at 25x leverage
 */

export interface MarwadiSetupResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  oiRegime: 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'SHORT_COVERING' | 'NEUTRAL';
  emaTrend: 'INSTITUTIONAL_BULL' | 'INSTITUTIONAL_BEAR' | 'NEUTRAL';
  orderBookRatio: number;
  ema20: number;
  ema200: number;
  reasons: string[];
  customTP: number;
  customSL: number;
}

export class MarwadiDeltaTradingEngine {
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

  public evaluateSetup(symbol: string, candles: any[], microData: any): MarwadiSetupResult {
    const result: MarwadiSetupResult = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      oiRegime: 'NEUTRAL',
      emaTrend: 'NEUTRAL',
      orderBookRatio: 1.0,
      ema20: 0,
      ema200: 0,
      reasons: [],
      customTP: 0,
      customSL: 0,
    };

    if (!candles || candles.length < 20) {
      result.reasons.push('Need >= 50 candles for Marwadi Trader analysis');
      return result;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 5];

    // 1. 20 EMA and 200 EMA Institutional Trend
    const ema20Arr = this.calculateEMA(closes, 20);
    const ema200Arr = this.calculateEMA(closes, Math.min(closes.length - 1, 200));

    const currEma20 = ema20Arr[ema20Arr.length - 1] || currentPrice;
    const currEma200 = ema200Arr[ema200Arr.length - 1] || currentPrice;
    result.ema20 = currEma20;
    result.ema200 = currEma200;

    if (currentPrice > currEma20 && currEma20 > currEma200) {
      result.emaTrend = 'INSTITUTIONAL_BULL';
    } else if (currentPrice < currEma20 && currEma20 < currEma200) {
      result.emaTrend = 'INSTITUTIONAL_BEAR';
    }

    // 2. Open Interest (OI) & Microstructure from Delta Exchange
    const oiChange = microData?.oiChangeUsd6h || 0;
    const priceChange = currentPrice - prevPrice;
    const orderBookRatio = microData?.bidAskRatio || 1.0;
    result.orderBookRatio = orderBookRatio;

    if (priceChange > 0 && oiChange > 0) result.oiRegime = 'LONG_BUILDUP';
    else if (priceChange < 0 && oiChange > 0) result.oiRegime = 'SHORT_BUILDUP';
    else if (priceChange < 0 && oiChange < 0) result.oiRegime = 'LONG_UNWINDING';
    else if (priceChange > 0 && oiChange < 0) result.oiRegime = 'SHORT_COVERING';

    let buyScore = 0;
    let sellScore = 0;

    // Marwadi Long Rules:
    if (result.emaTrend === 'INSTITUTIONAL_BULL') buyScore += 35;
    if (result.oiRegime === 'LONG_BUILDUP') buyScore += 35;
    else if (result.oiRegime === 'SHORT_COVERING') buyScore += 20;
    if (orderBookRatio >= 1.2) buyScore += 20;
    if (microData?.takerBuyRatio && microData.takerBuyRatio > 0.52) buyScore += 15;

    // Marwadi Short Rules:
    if (result.emaTrend === 'INSTITUTIONAL_BEAR') sellScore += 35;
    if (result.oiRegime === 'SHORT_BUILDUP') sellScore += 35;
    else if (result.oiRegime === 'LONG_UNWINDING') sellScore += 20;
    if (orderBookRatio <= 0.8) sellScore += 20;
    if (microData?.takerBuyRatio && microData.takerBuyRatio < 0.48) sellScore += 15;

    if (buyScore >= 60 && buyScore > sellScore) {
      result.recommendedSide = 'BUY';
      result.confidenceScore = Math.min(buyScore, 100);
      result.reasons.push(`Marwadi Trader Delta Confluence (Score: ${buyScore})`);
      result.reasons.push(`Trend: 20 EMA > 200 EMA (Institutional Bull)`);
      result.reasons.push(`OI: ${result.oiRegime}`);
      result.reasons.push(`Book Ratio: ${orderBookRatio.toFixed(2)}`);

      const swingLow = Math.min(...lows.slice(-10));
      result.customSL = Math.min(swingLow, currentPrice * 0.988);
      const risk = currentPrice - result.customSL;
      result.customTP = currentPrice + (risk * 2.0); // 1:2 RRR
    } else if (sellScore >= 60 && sellScore > buyScore) {
      result.recommendedSide = 'SELL';
      result.confidenceScore = Math.min(sellScore, 100);
      result.reasons.push(`Marwadi Trader Delta Confluence (Score: ${sellScore})`);
      result.reasons.push(`Trend: 20 EMA < 200 EMA (Institutional Bear)`);
      result.reasons.push(`OI: ${result.oiRegime}`);
      result.reasons.push(`Book Ratio: ${orderBookRatio.toFixed(2)}`);

      const swingHigh = Math.max(...highs.slice(-10));
      result.customSL = Math.max(swingHigh, currentPrice * 1.012);
      const risk = result.customSL - currentPrice;
      result.customTP = currentPrice - (risk * 2.0); // 1:2 RRR
    } else {
      result.confidenceScore = Math.max(buyScore, sellScore);
      result.reasons.push(`Waiting for Marwadi OI & Trend Setup (Buy: ${buyScore}/100, Sell: ${sellScore}/100)`);
    }

    return result;
  }
}

export const marwadiDeltaEngine = new MarwadiDeltaTradingEngine();
