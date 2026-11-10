// VirtualBacon Altcoin Valuation & Fibonacci Golden Pocket Engine (System 24)
// YouTube: https://www.youtube.com/@VirtualBacon (Altcoin Valuation Math & 0.618 Fib Retracements)
// Core Focus: Fib Golden Pocket (0.5 - 0.618 - 0.65), Leading Narrative Rotations & Strict 1:2.4 RRR

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

export class VirtualBaconAltcoinHunterEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'FIBONACCI' };
    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) candles15m = candlesOrMtf;
    else if (candlesOrMtf?.candles15m) candles15m = candlesOrMtf.candles15m;
    if (!candles15m || candles15m.length < 35) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currentPrice = currentCandle.close;
    const atr = this.calcATR(candles15m, 14);

    const closes = candles15m.map(c => c.close);
    const ema21 = this.calcEMA(closes, 21);
    const ema50 = this.calcEMA(closes, 50);

    // Calculate Swing Wave for Fib Retracement
    const lookback = candles15m.slice(-30);
    const swingHigh = Math.max(...lookback.map(c => c.high));
    const swingLow = Math.min(...lookback.map(c => c.low));
    const waveRange = swingHigh - swingLow;

    if (waveRange <= 0) return res;

    // -----------------------------------------------------------------
    // SETUP 1: BULLISH FIBONACCI GOLDEN POCKET LONG
    // In an uptrend or base (EMA 21 >= EMA 50), price pulls back into 0.50 - 0.65 Fib
    // -----------------------------------------------------------------
    const fib50Long = swingHigh - waveRange * 0.50;
    const fib618Long = swingHigh - waveRange * 0.618;
    const fib65Long = swingHigh - waveRange * 0.65;

    const inGoldenPocketLong = currentPrice >= fib65Long && currentPrice <= fib50Long;
    const candleRange = currentCandle.high - currentCandle.low;
    const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
    const hasRejectionWickLong = candleRange > 0 && (lowerWick / candleRange) >= 0.40;

    if (inGoldenPocketLong && hasRejectionWickLong && currentCandle.close > currentCandle.open && ema21 >= ema50 * 0.995) {
      const sl = fib65Long - atr * 0.8;
      const tp = swingHigh + waveRange * 0.27; // Fib -0.27 extension target
      return {
        recommendedSide: 'BUY',
        confidenceScore: 91,
        setupType: 'BACON_FIB_GOLDEN_POCKET_LONG',
        reasons: ['Retracement in 0.5-0.618 Golden Pocket Zone', 'Bullish Candlestick Wick Rejection', 'Uptrend Structure (EMA 21>=50)', 'Targeting -0.27 Fib Extension ($' + tp.toFixed(4) + ')'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'GOLDEN_POCKET_ACCUMULATION'
      };
    }

    // -----------------------------------------------------------------
    // SETUP 2: BEARISH FIBONACCI GOLDEN POCKET SHORT (Full Symmetrical Strategy)
    // In a downtrend (EMA 21 < EMA 50), price rallies into 0.50 - 0.65 Fib retracement and rejects
    // -----------------------------------------------------------------
    const fib50Short = swingLow + waveRange * 0.50;
    const fib618Short = swingLow + waveRange * 0.618;
    const fib65Short = swingLow + waveRange * 0.65;

    const inGoldenPocketShort = currentPrice >= fib50Short && currentPrice <= fib65Short;
    const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
    const hasRejectionWickShort = candleRange > 0 && (upperWick / candleRange) >= 0.40;

    if (inGoldenPocketShort && hasRejectionWickShort && currentCandle.close < currentCandle.open && ema21 <= ema50 * 1.005) {
      const sl = fib65Short + atr * 0.8;
      const tp = swingLow - waveRange * 0.27; // Fib -0.27 extension target to the downside
      return {
        recommendedSide: 'SELL',
        confidenceScore: 91,
        setupType: 'BACON_FIB_GOLDEN_POCKET_SHORT',
        reasons: ['Bearish Relief Rally into 0.5-0.618 Golden Pocket Zone', 'Bearish Upper Wick Rejection', 'Downtrend Structure (EMA 21<50)', 'Targeting -0.27 Fib Downside Extension ($' + tp.toFixed(4) + ')'],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'GOLDEN_POCKET_DISTRIBUTION'
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
}

export const virtualBaconHunterEngine = new VirtualBaconAltcoinHunterEngine();
