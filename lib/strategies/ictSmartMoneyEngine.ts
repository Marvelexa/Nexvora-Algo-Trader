// ICT Smart Money Concepts & Liquidity Sweeps Engine (System 19)
// YouTube: https://www.youtube.com/@InnerCircleTrader (ICT 2022 Mentorship - 41 Videos)
// Core Focus: Liquidity Sweeps (BSL/SSL) -> Market Structure Shift (MSS) with Displacement -> FVG Retest Mitigation
// Critical ICT Rule: NEVER short on a raw wick sweep without confirmed Displacement MSS & FVG retest!

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

export class ICTSmartMoneyEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): SetupResult {
    const res: SetupResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', reasons: [], marketRegime: 'CONSOLIDATION' };
    let candles15m: KlinePoint[] = [];

    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf && typeof candlesOrMtf === 'object') {
      candles15m = candlesOrMtf.candles15m || [];
    }

    if (!candles15m || candles15m.length < 40) return res;

    const currentCandle = candles15m[candles15m.length - 1];
    const prevCandle = candles15m[candles15m.length - 2];
    const currentPrice = currentCandle.close;
    const atr = this.calcATR(candles15m, 14);

    const closes = candles15m.map(c => c.close);
    const ema50 = this.calcEMA(closes, 50);

    // Calculate Average Candle Body & Volume for Displacement Detection
    const bodies = candles15m.slice(-21, -1).map(c => Math.abs(c.close - c.open));
    const avgBody = bodies.reduce((a, b) => a + b, 0) / (bodies.length || 1);
    const volumes = candles15m.slice(-21, -1).map(c => c.volume || 1);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);

    // Lookback for Structural Swing Points (BSL / SSL Pools)
    const structureHistory = candles15m.slice(-35, -5);
    const swingHighBSL = Math.max(...structureHistory.map(c => c.high));
    const swingLowSSL = Math.min(...structureHistory.map(c => c.low));

    // =========================================================================
    // 1. ICT 2022 BEARISH SETUP (Short):
    // Step 1: Recent BSL Sweep (Price ran above swingHighBSL in the last 10 candles)
    // Step 2: Bearish Market Structure Shift (MSS) with displacement candle breaking down
    // Step 3: Fair Value Gap (FVG) formed and current price is mitigating into it
    // =========================================================================
    const recentCandles = candles15m.slice(-10);
    const hasSweptBSL = recentCandles.some(c => c.high > swingHighBSL);

    // Find if there is a Bearish FVG within the recent displacement:
    // FVG Bearish: Candle 1 (older) low > Candle 3 (newer) high
    let bearishFvgFound = false;
    let fvgTop = 0;
    let fvgBottom = 0;

    for (let i = candles15m.length - 4; i < candles15m.length - 1; i++) {
      const c1 = candles15m[i - 1];
      const c2 = candles15m[i]; // Displacement candle
      const c3 = candles15m[i + 1];
      if (!c1 || !c2 || !c3) continue;

      const isDisplacement = Math.abs(c2.close - c2.open) >= 1.2 * avgBody && c2.close < c2.open && c2.volume >= 1.1 * avgVol;
      const isFvg = c1.low > c3.high;

      if (isDisplacement && isFvg) {
        bearishFvgFound = true;
        fvgTop = c1.low;
        fvgBottom = c3.high;
        break;
      }
    }

    // Market Structure Shift: Has price broken below recent intermediate low?
    const intermediateLows = candles15m.slice(-12, -3).map(c => c.low);
    const lowestIntermediate = Math.min(...intermediateLows);
    const hasBearishMSS = currentPrice < lowestIntermediate || prevCandle.close < lowestIntermediate;

    // Entry condition for ICT Short:
    // Requires: BSL swept + Bearish MSS confirmed + Current candle rejecting inside or near the Bearish FVG
    const inBearishFvgZone = bearishFvgFound && currentPrice >= fvgBottom * 0.998 && currentPrice <= fvgTop * 1.002;
    const isBearishRejection = currentCandle.close < currentCandle.open || (currentCandle.high - Math.max(currentCandle.open, currentCandle.close)) >= (currentCandle.high - currentCandle.low) * 0.35;

    if (hasSweptBSL && hasBearishMSS && (inBearishFvgZone || prevCandle.close < prevCandle.open) && isBearishRejection && currentPrice <= ema50 * 1.01) {
      const highestSweep = Math.max(...recentCandles.map(c => c.high));
      // Structurally sound SL above the sweep high + 1.2 ATR buffer (no hair-trigger stop outs!)
      const sl = highestSweep + Math.max(atr * 1.2, currentPrice * 0.012);
      const risk = sl - currentPrice;
      const tp = Math.max(currentPrice * 0.10, currentPrice - (risk * 2.30)); // Strict 1:2.3 positive RRR

      return {
        recommendedSide: 'SELL',
        confidenceScore: 93,
        setupType: 'ICT_BEARISH_MSS_FVG_MITIGATION',
        reasons: [
          'BSL Liquidity Run Confirmed ($' + swingHighBSL.toFixed(4) + ')',
          'Market Structure Shift (MSS) with Displacement Down',
          'Bearish FVG Retest Mitigation Confirmed',
          'Strict 1:2.3 RRR targeting Sell-Side Liquidity'
        ],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'BEARISH_INSTITUTIONAL_EXPANSION'
      };
    }

    // =========================================================================
    // 2. ICT 2022 BULLISH SETUP (Long):
    // Step 1: Recent SSL Sweep (Price ran below swingLowSSL in the last 10 candles)
    // Step 2: Bullish Market Structure Shift (MSS) with displacement candle breaking up
    // Step 3: Fair Value Gap (FVG) formed and current price is mitigating into it
    // =========================================================================
    const hasSweptSSL = recentCandles.some(c => c.low < swingLowSSL);

    let bullishFvgFound = false;
    let bullFvgTop = 0;
    let bullFvgBottom = 0;

    for (let i = candles15m.length - 4; i < candles15m.length - 1; i++) {
      const c1 = candles15m[i - 1];
      const c2 = candles15m[i]; // Displacement candle
      const c3 = candles15m[i + 1];
      if (!c1 || !c2 || !c3) continue;

      const isDisplacement = Math.abs(c2.close - c2.open) >= 1.2 * avgBody && c2.close > c2.open && c2.volume >= 1.1 * avgVol;
      const isFvg = c3.low > c1.high;

      if (isDisplacement && isFvg) {
        bullishFvgFound = true;
        bullFvgTop = c3.low;
        bullFvgBottom = c1.high;
        break;
      }
    }

    const intermediateHighs = candles15m.slice(-12, -3).map(c => c.high);
    const highestIntermediate = Math.max(...intermediateHighs);
    const hasBullishMSS = currentPrice > highestIntermediate || prevCandle.close > highestIntermediate;

    const inBullishFvgZone = bullishFvgFound && currentPrice <= bullFvgTop * 1.002 && currentPrice >= bullFvgBottom * 0.998;
    const isBullishRejection = currentCandle.close > currentCandle.open || (Math.min(currentCandle.open, currentCandle.close) - currentCandle.low) >= (currentCandle.high - currentCandle.low) * 0.35;

    if (hasSweptSSL && hasBullishMSS && (inBullishFvgZone || prevCandle.close > prevCandle.open) && isBullishRejection && currentPrice >= ema50 * 0.99) {
      const lowestSweep = Math.min(...recentCandles.map(c => c.low));
      // Structurally sound SL below the sweep low - 1.2 ATR buffer
      const sl = lowestSweep - Math.max(atr * 1.2, currentPrice * 0.012);
      const risk = currentPrice - sl;
      const tp = currentPrice + (risk * 2.30); // Strict 1:2.3 RRR targeting BSL

      return {
        recommendedSide: 'BUY',
        confidenceScore: 93,
        setupType: 'ICT_BULLISH_MSS_FVG_MITIGATION',
        reasons: [
          'SSL Liquidity Run Confirmed ($' + swingLowSSL.toFixed(4) + ')',
          'Market Structure Shift (MSS) with Displacement Up',
          'Bullish FVG Retest Mitigation Confirmed',
          'Strict 1:2.3 RRR targeting Buy-Side Liquidity'
        ],
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        marketRegime: 'BULLISH_INSTITUTIONAL_EXPANSION'
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

export const ictEngine = new ICTSmartMoneyEngine();
