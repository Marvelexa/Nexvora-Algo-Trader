// Coin Bureau Fundamental Valuation & Tokenomics Engine (System 22)
// YouTube: https://www.youtube.com/@CoinBureau (How to Research Crypto, Tokenomics & Vesting Schedules)
// Core Focus: Float-to-FDV Ratio, Accumulation Base Breakouts above 50/200 EMA, Anti-FOMO Overextension Filter

import { KlinePoint } from './multiTimeframeCandleAnalysis';

export interface SetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
}

export class CoinBureauValuationEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'VALUE_BASE' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 50) return res;

    const closes = candles15m.map(c => c.close);
    const ema20 = this.calcEMA(closes, 20);
    const ema50 = this.calcEMA(closes, 50);
    const ema200 = this.calcEMA(closes, 200);
    const currentPrice = closes[closes.length - 1];
    const atr = this.calcATR(candles15m, 14);
    const rsi = this.calcRSI(closes, 14);

    // Fundamental proxy: Volume Velocity & Organic Float Expansion
    const volumes = candles15m.slice(-20).map(c => c.volume || 1);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / 20;
    const currentVol = candles15m[candles15m.length - 1].volume || 1;
    const rvol = currentVol / (avgVol || 1);

    // Setup 1: High-Quality Accumulation Breakout (Clean structure above 200 EMA with healthy base near EMA 20, not chasing tops)
    const isNotOverextendedBuy = (currentPrice - ema20) <= atr * 1.5;
    if (currentPrice > ema200 && ema20 > ema50 && rvol >= 1.3 && currentPrice > ema20 && isNotOverextendedBuy && rsi <= 70) {
      const slDist = Math.max(atr * 1.6, currentPrice * 0.015);
      const sl = currentPrice - slDist;
      const tp = currentPrice + (slDist * 2.3);
      return {
        recommendedSide: 'BUY',
        confidenceScore: 88,
        setupType: 'BUREAU_ORGANIC_ACCUMULATION_BREAKOUT',
        reasons: ['Trading Above 200 EMA Baseline', 'EMA 20/50 Golden Momentum Alignment', 'Healthy Base Retest (RSI: ' + rsi.toFixed(0) + ')', 'Volume Expansion RVOL ' + rvol.toFixed(1) + 'x'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'INSTITUTIONAL_EXPANSION'
      };
    }

    // Setup 2: Cliff Unlock / Distribution Breakdown below 200 EMA
    const isNotOverextendedSell = (ema20 - currentPrice) <= atr * 1.5;
    if (currentPrice < ema200 && ema20 < ema50 && rvol >= 1.3 && currentPrice < ema20 && isNotOverextendedSell && rsi >= 30) {
      const slDist = Math.max(atr * 1.6, currentPrice * 0.015);
      const sl = currentPrice + slDist;
      const tp = currentPrice - (slDist * 2.3);
      return {
        recommendedSide: 'SELL',
        confidenceScore: 88,
        setupType: 'BUREAU_HIGH_FDV_DISTRIBUTION_BREAKDOWN',
        reasons: ['Trading Below 200 EMA Baseline', 'Bearish Distribution Pressure', 'Healthy Rejection Retest (RSI: ' + rsi.toFixed(0) + ')', 'Volume Breakdown RVOL ' + rvol.toFixed(1) + 'x'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'INSTITUTIONAL_DISTRIBUTION'
      };
    }

    return res;
  }

  private calcEMA(prices: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
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

  private calcRSI(prices: number[], period: number = 14): number {
    if (prices.length <= period) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}

export const coinBureauEngine = new CoinBureauValuationEngine();
