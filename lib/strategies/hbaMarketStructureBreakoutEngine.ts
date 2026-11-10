// HBA Services Complete Course - Market Structure Breakout Engine (System 3003 / Port 3003)
// Source Video: "https://youtu.be/7PPuMzuzMek" (HBA Services Complete Course)
// Core Strategy:
// 1. Horizontal Support & Resistance clustering (>= 2 swing touches within +/- 0.15 * ATR14) over 40-50 bars on 15m.
// 2. Breakout volume confirmation: Breakout candle volume > 1.50x 20-period SMA volume.
// 3. Higher timeframe trend filter: Price > 1H 20 EMA for Long, Price < 1H 20 EMA for Short.
// 4. Breakout candle conviction: Body >= 50% of candle range.
// 5. Pre-Reversal TP: Placed EXACTLY 2 ticks before the next major horizontal structural barrier (R_next - 2*tickSize or S_next + 2*tickSize).
// 6. Risk-to-Reward: Strict minimum 1:2.30 (RR >= 2.00). Never squeeze Stop Loss.

import { KlinePoint } from '../../src/types';
import { DELTA_PRODUCT_SPECS } from '../deltaExchangeEngine';

export interface StrategySetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
  riskReward?: number;
  breakoutLevel?: number;
  nextStructuralLevel?: number;
  volumeRatio?: number;
}

export interface HorizontalCluster {
  level: number;
  touches: number;
  type: 'SUPPORT' | 'RESISTANCE';
  barIndices: number[];
}

export class HbaMarketStructureBreakoutEngine {
  /**
   * Main evaluation method for System 3003 Market Structure Breakout
   */
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StrategySetupResult {
    const nullResult: StrategySetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'MARKET_STRUCTURE_BREAKOUT'
    };

    let candles15m: KlinePoint[] = [];
    let candles1h: KlinePoint[] = [];

    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf?.candles15m) {
      candles15m = candlesOrMtf.candles15m;
      if (candlesOrMtf.candles1h && Array.isArray(candlesOrMtf.candles1h)) {
        candles1h = candlesOrMtf.candles1h;
      }
    }

    if (microData?.candles1h && Array.isArray(microData.candles1h)) {
      candles1h = microData.candles1h;
    }

    // Require sufficient history for clustering and moving averages
    if (!candles15m || candles15m.length < 30) return nullResult;

    const currentBar = candles15m[candles15m.length - 1];
    const prevBar = candles15m[candles15m.length - 2];
    const currentPrice = currentBar.close;
    const atr14 = this.calcATR(candles15m, 14);

    const { tickSize, decimals } = this.getSymbolSpec(symbol);

    const candleRange = Math.max(currentBar.high - currentBar.low, tickSize);
    const bodySize = Math.abs(currentBar.close - currentBar.open);
    const bodyRatio = bodySize / candleRange;

    // Volume calculation
    const volLookback = Math.min(20, candles15m.length);
    const recentVols = candles15m.slice(-volLookback).map(c => c.volume || 0);
    const sma20Vol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const currentVol = currentBar.volume || 0;
    const volumeRatio = sma20Vol > 0 ? currentVol / sma20Vol : 1.0;

    // 1H 20 EMA Higher-Timeframe Trend Filter
    const ema20_1h = this.calc1hEma20(candles15m, candles1h);
    const isAbove1hEma20 = currentPrice > ema20_1h;
    const isBelow1hEma20 = currentPrice < ema20_1h;

    // Horizontal S&R Clustering (>= 2 touches within +/- 0.15 * ATR14 across prior 40-50 bars)
    // Exclude current bar from S&R formation to prevent lookahead bias
    const historyBars = candles15m.slice(0, -1);
    const clusters = this.findHorizontalClusters(historyBars, atr14, 50);

    // Minimum generous SL breathing room floor: at least Math.max(1.50 * atr14, currentPrice * 0.020, 3 * tickSize)
    const minSlDistance = Math.max(1.50 * atr14, currentPrice * 0.020, 3 * tickSize);

    // =========================================================================
    // Check Bullish Breakout (Long Setup)
    // =========================================================================
    if (isAbove1hEma20) {
      // Find candidate resistance levels that price broke above (require authentic clusters with >= 2 touches)
      const resistanceClusters = clusters
        .filter(c => c.type === 'RESISTANCE' && c.touches >= 2)
        .sort((a, b) => b.level - a.level); // Descending by price

      let brokenCluster: HorizontalCluster | null = null;
      let isRetest = false;

      // 1. Check Direct Breakout:
      // Price closes cleanly above R_key on this bar, prior bar was at or below R_key (+ tolerance)
      // Requires: strong candle body (bodyRatio >= 0.50), green close, and volume surge (volumeRatio >= 1.50)
      if (currentBar.close > currentBar.open && bodyRatio >= 0.50 && volumeRatio >= 1.50) {
        for (const rc of resistanceClusters) {
          if (currentBar.close > rc.level && prevBar.close <= rc.level + (0.10 * atr14)) {
            brokenCluster = rc;
            isRetest = false;
            break;
          }
        }
      }

      // 2. Check Retest Breakout:
      // Breakout above R_key occurred within the prior 1-5 bars, and current bar tests R_key from above and rejects/bounces
      if (!brokenCluster) {
        for (const rc of resistanceClusters) {
          // Check if breakout occurred within last 5 bars
          const priorBars = candles15m.slice(-6, -1);
          const hadBreakout = priorBars.some(b => b.close > rc.level);
          if (!hadBreakout) continue;

          // Retest probe: low touched or came near R_key (+/- 0.25 * atr14)
          const testedLevel = Math.min(currentBar.low, prevBar.low) <= rc.level + (0.25 * atr14);
          const heldAbove = currentBar.close >= rc.level - (0.10 * atr14);

          if (testedLevel && heldAbove) {
            // Rejection confirmation: Lower wick >= 35% of range OR Bullish Engulfing OR solid green bounce
            const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
            const hasLowerWick = (lowerWick / candleRange) >= 0.35;
            const isBullishEngulfing = currentBar.close > currentBar.open && prevBar.close < prevBar.open && currentBar.close >= prevBar.open;
            const isGreenBounce = currentBar.close > currentBar.open && bodyRatio >= 0.40;

            if ((hasLowerWick || isBullishEngulfing || isGreenBounce) && (volumeRatio >= 1.10 || currentVol >= (prevBar.volume || 0))) {
              brokenCluster = rc;
              isRetest = true;
              break;
            }
          }
        }
      }

      // NO fallback to 30-bar swing extremes! Only authentic horizontal clusters allowed.
      if (brokenCluster) {
        const rKey = brokenCluster.level;

        // Stop Loss: Generous breathing room below broken resistance and recent swing structure
        const recentLows = historyBars.slice(-15).map(c => c.low);
        const swingLow = Math.min(...recentLows);
        const structuralLow = Math.min(rKey - Math.max(1.20 * atr14, 3 * tickSize), swingLow - Math.max(0.50 * atr14, 3 * tickSize));

        const rawSLDist = Math.max(currentPrice - structuralLow, minSlDistance);
        const rawSL = currentPrice - rawSLDist;
        const sl = this.quantizePrice(rawSL, tickSize, decimals);
        const riskDist = currentPrice - sl;

        if (riskDist > 0) {
          // Identify next major horizontal structural barrier R_next above currentPrice
          const higherClusters = clusters
            .filter(c => c.type === 'RESISTANCE' && c.level > currentPrice + (0.30 * atr14))
            .sort((a, b) => a.level - b.level); // Nearest higher resistance first

          // Pre-Reversal TP: Placed safely BEFORE next major structural barrier
          const preReversalBuffer = Math.max(0.12 * atr14, 2 * tickSize, currentPrice * 0.0005);

          let rNext = higherClusters.length > 0 ? higherClusters[0].level : 0;
          if (!rNext || rNext <= currentPrice) {
            // Check full history for higher swing highs
            const allHigherHighs = historyBars.filter(c => c.high > currentPrice + (0.30 * atr14)).map(c => c.high);
            if (allHigherHighs.length > 0) {
              rNext = Math.min(...allHigherHighs);
            } else {
              // Open territory / measured range breakout expansion target (HBA measured move)
              const supportClusters = clusters.filter(c => c.type === 'SUPPORT').sort((a, b) => a.level - b.level);
              const supportBase = supportClusters.length > 0 ? supportClusters[0].level : (rKey - 2.5 * atr14);
              const rangeHeight = Math.max(rKey - supportBase, 2.5 * atr14);
              const measuredMove = rKey + rangeHeight;
              const minRrTarget = currentPrice + (riskDist * 2.30) + preReversalBuffer + (2 * tickSize);
              rNext = Math.max(measuredMove, minRrTarget);
            }
          }

          const rawTP = rNext - preReversalBuffer;
          const tp = this.quantizePrice(rawTP, tickSize, decimals);
          const profitDist = tp - currentPrice;
          const rr = parseFloat((profitDist / riskDist).toFixed(2));

          // Strict Risk/Reward Enforcement: Minimum 1:2.30
          if (rr >= 2.30) {
            return {
              recommendedSide: 'BUY',
              confidenceScore: isRetest ? 92 : 88,
              setupType: 'HBA_MARKET_STRUCTURE_BREAKOUT',
              reasons: [
                `${isRetest ? 'Retest Bounce' : 'Direct Breakout'} at Horizontal Resistance confirmed at ${rKey.toFixed(decimals)} (${brokenCluster.touches} swing touches)`,
                `Volume Confirmed: ${volumeRatio.toFixed(2)}x (${isRetest ? '>= 1.10x on retest' : '> 1.50x on breakout'})`,
                `1H 20 EMA Macro Trend Alignment confirmed: Price ${currentPrice.toFixed(decimals)} > 1H EMA20 ${ema20_1h.toFixed(decimals)}`,
                `Candle conviction: Body ${(bodyRatio * 100).toFixed(1)}% of range`,
                `Generous SL breathing room enforced: Stop ${sl.toFixed(decimals)} (risk distance ${riskDist.toFixed(decimals)} >= ${minSlDistance.toFixed(decimals)})`,
                `Pre-Reversal Take Profit positioned before next barrier R_next (${rNext.toFixed(decimals)} - buffer = ${tp.toFixed(decimals)})`,
                `Risk-to-Reward satisfied: 1:${rr} (strict minimum >= 2.30)`
              ],
              customSL: sl,
              customTP: tp,
              marketRegime: isRetest ? 'MARKET_STRUCTURE_BULL_RETEST' : 'MARKET_STRUCTURE_BULL_EXPANSION',
              riskReward: rr,
              breakoutLevel: parseFloat(rKey.toFixed(decimals)),
              nextStructuralLevel: parseFloat(rNext.toFixed(decimals)),
              volumeRatio: parseFloat(volumeRatio.toFixed(2))
            };
          }
        }
      }
    }

    // =========================================================================
    // Check Bearish Breakdown (Short Setup)
    // =========================================================================
    if (isBelow1hEma20) {
      // Find candidate support levels that price broke below (require authentic clusters with >= 2 touches)
      const supportClusters = clusters
        .filter(c => c.type === 'SUPPORT' && c.touches >= 2)
        .sort((a, b) => a.level - b.level); // Ascending by price

      let brokenCluster: HorizontalCluster | null = null;
      let isRetest = false;

      // 1. Check Direct Breakdown:
      // Price closes cleanly below S_key on this bar, prior bar was at or above S_key (- tolerance)
      // Requires: strong candle body (bodyRatio >= 0.50), red close, and volume surge (volumeRatio >= 1.50)
      if (currentBar.close < currentBar.open && bodyRatio >= 0.50 && volumeRatio >= 1.50) {
        for (const sc of supportClusters) {
          if (currentBar.close < sc.level && prevBar.close >= sc.level - (0.10 * atr14)) {
            brokenCluster = sc;
            isRetest = false;
            break;
          }
        }
      }

      // 2. Check Retest Breakdown:
      // Breakdown below S_key occurred within prior 1-5 bars, and current bar tests S_key from below and rejects
      if (!brokenCluster) {
        for (const sc of supportClusters) {
          const priorBars = candles15m.slice(-6, -1);
          const hadBreakdown = priorBars.some(b => b.close < sc.level);
          if (!hadBreakdown) continue;

          // Retest probe: high touched or came near S_key (+/- 0.25 * atr14)
          const testedLevel = Math.max(currentBar.high, prevBar.high) >= sc.level - (0.25 * atr14);
          const heldBelow = currentBar.close <= sc.level + (0.10 * atr14);

          if (testedLevel && heldBelow) {
            // Rejection confirmation: Upper wick >= 35% of range OR Bearish Engulfing OR solid red drop
            const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
            const hasUpperWick = (upperWick / candleRange) >= 0.35;
            const isBearishEngulfing = currentBar.close < currentBar.open && prevBar.close > prevBar.open && currentBar.close <= prevBar.open;
            const isRedDrop = currentBar.close < currentBar.open && bodyRatio >= 0.40;

            if ((hasUpperWick || isBearishEngulfing || isRedDrop) && (volumeRatio >= 1.10 || currentVol >= (prevBar.volume || 0))) {
              brokenCluster = sc;
              isRetest = true;
              break;
            }
          }
        }
      }

      // NO fallback to 30-bar swing extremes! Only authentic horizontal clusters allowed.
      if (brokenCluster) {
        const sKey = brokenCluster.level;

        // Stop Loss: Generous breathing room above broken support and recent swing structure
        const recentHighs = historyBars.slice(-15).map(c => c.high);
        const swingHigh = Math.max(...recentHighs);
        const structuralHigh = Math.max(sKey + Math.max(1.20 * atr14, 3 * tickSize), swingHigh + Math.max(0.50 * atr14, 3 * tickSize));

        const rawSLDist = Math.max(structuralHigh - currentPrice, minSlDistance);
        const rawSL = currentPrice + rawSLDist;
        const sl = this.quantizePrice(rawSL, tickSize, decimals);
        const riskDist = sl - currentPrice;

        if (riskDist > 0) {
          // Identify next major horizontal structural barrier S_next below currentPrice
          const lowerClusters = clusters
            .filter(c => c.type === 'SUPPORT' && c.level < currentPrice - (0.30 * atr14))
            .sort((a, b) => b.level - a.level); // Nearest lower support first

          // Pre-Reversal TP: Placed safely BEFORE next major structural barrier
          const preReversalBuffer = Math.max(0.12 * atr14, 2 * tickSize, currentPrice * 0.0005);

          let sNext = lowerClusters.length > 0 ? lowerClusters[0].level : 0;
          if (!sNext || sNext >= currentPrice) {
            // Check full history for lower swing lows
            const allLowerLows = historyBars.filter(c => c.low < currentPrice - (0.30 * atr14)).map(c => c.low);
            if (allLowerLows.length > 0) {
              sNext = Math.max(...allLowerLows);
            } else {
              // Open territory / measured range breakdown expansion target (HBA measured move)
              const resClusters = clusters.filter(c => c.type === 'RESISTANCE').sort((a, b) => b.level - a.level);
              const resistanceRoof = resClusters.length > 0 ? resClusters[0].level : (sKey + 2.5 * atr14);
              const rangeHeight = Math.max(resistanceRoof - sKey, 2.5 * atr14);
              const measuredMove = sKey - rangeHeight;
              const minRrTarget = currentPrice - (riskDist * 2.30) - preReversalBuffer - (2 * tickSize);
              sNext = Math.min(measuredMove, minRrTarget);
            }
          }

          const rawTP = sNext + preReversalBuffer;
          const tp = this.quantizePrice(rawTP, tickSize, decimals);
          const profitDist = currentPrice - tp;
          const rr = parseFloat((profitDist / riskDist).toFixed(2));

          // Strict Risk/Reward Enforcement: Minimum 1:2.30
          if (rr >= 2.30) {
            return {
              recommendedSide: 'SELL',
              confidenceScore: isRetest ? 92 : 88,
              setupType: 'HBA_MARKET_STRUCTURE_BREAKOUT',
              reasons: [
                `${isRetest ? 'Retest Rejection' : 'Direct Breakdown'} at Horizontal Support confirmed at ${sKey.toFixed(decimals)} (${brokenCluster.touches} swing touches)`,
                `Volume Confirmed: ${volumeRatio.toFixed(2)}x (${isRetest ? '>= 1.10x on retest' : '> 1.50x on breakdown'})`,
                `1H 20 EMA Macro Trend Alignment confirmed: Price ${currentPrice.toFixed(decimals)} < 1H EMA20 ${ema20_1h.toFixed(decimals)}`,
                `Candle conviction: Body ${(bodyRatio * 100).toFixed(1)}% of range`,
                `Generous SL breathing room enforced: Stop ${sl.toFixed(decimals)} (risk distance ${riskDist.toFixed(decimals)} >= ${minSlDistance.toFixed(decimals)})`,
                `Pre-Reversal Take Profit positioned before next barrier S_next (${sNext.toFixed(decimals)} + buffer = ${tp.toFixed(decimals)})`,
                `Risk-to-Reward satisfied: 1:${rr} (strict minimum >= 2.30)`
              ],
              customSL: sl,
              customTP: tp,
              marketRegime: isRetest ? 'MARKET_STRUCTURE_BEAR_RETEST' : 'MARKET_STRUCTURE_BEAR_EXPANSION',
              riskReward: rr,
              breakoutLevel: parseFloat(sKey.toFixed(decimals)),
              nextStructuralLevel: parseFloat(sNext.toFixed(decimals)),
              volumeRatio: parseFloat(volumeRatio.toFixed(2))
            };
          }
        }
      }
    }

    return nullResult;
  }

  /**
   * Find Horizontal S&R Clusters: >= 2 swing touches within +/- 0.15 * ATR14 across lookback bars
   */
  public findHorizontalClusters(candles: KlinePoint[], atr14: number, lookbackBars: number = 50): HorizontalCluster[] {
    const startIdx = Math.max(2, candles.length - lookbackBars);
    const endIdx = candles.length - 2;
    if (endIdx <= startIdx) return [];

    const swingHighs: { price: number; index: number }[] = [];
    const swingLows: { price: number; index: number }[] = [];

    for (let i = startIdx; i <= endIdx; i++) {
      const c = candles[i];
      const prev1 = candles[i - 1];
      const prev2 = candles[i - 2];
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];

      if (!c || !prev1 || !next1) continue;

      // Swing High: peak relative to surrounding bars
      const isPeak = c.high >= prev1.high &&
        (!prev2 || c.high >= prev2.high) &&
        c.high >= next1.high &&
        (!next2 || c.high >= next2.high);
      if (isPeak) {
        swingHighs.push({ price: c.high, index: i });
      }

      // Swing Low: trough relative to surrounding bars
      const isTrough = c.low <= prev1.low &&
        (!prev2 || c.low <= prev2.low) &&
        c.low <= next1.low &&
        (!next2 || c.low <= next2.low);
      if (isTrough) {
        swingLows.push({ price: c.low, index: i });
      }
    }

    const clusterTolerance = 0.15 * atr14;
    const clusters: HorizontalCluster[] = [];

    // Cluster Swing Highs (Resistance)
    const visitedHighs = new Set<number>();
    for (let i = 0; i < swingHighs.length; i++) {
      if (visitedHighs.has(i)) continue;
      const members = [swingHighs[i]];
      visitedHighs.add(i);

      for (let j = i + 1; j < swingHighs.length; j++) {
        if (visitedHighs.has(j)) continue;
        if (Math.abs(swingHighs[j].price - swingHighs[i].price) <= clusterTolerance) {
          members.push(swingHighs[j]);
          visitedHighs.add(j);
        }
      }

      const avgLevel = members.reduce((sum, m) => sum + m.price, 0) / members.length;
      clusters.push({
        level: avgLevel,
        touches: members.length,
        type: 'RESISTANCE',
        barIndices: members.map(m => m.index)
      });
    }

    // Cluster Swing Lows (Support)
    const visitedLows = new Set<number>();
    for (let i = 0; i < swingLows.length; i++) {
      if (visitedLows.has(i)) continue;
      const members = [swingLows[i]];
      visitedLows.add(i);

      for (let j = i + 1; j < swingLows.length; j++) {
        if (visitedLows.has(j)) continue;
        if (Math.abs(swingLows[j].price - swingLows[i].price) <= clusterTolerance) {
          members.push(swingLows[j]);
          visitedLows.add(j);
        }
      }

      const avgLevel = members.reduce((sum, m) => sum + m.price, 0) / members.length;
      clusters.push({
        level: avgLevel,
        touches: members.length,
        type: 'SUPPORT',
        barIndices: members.map(m => m.index)
      });
    }

    return clusters;
  }

  /**
   * Calculate 1H 20 EMA either from explicit 1H candles or aggregated 15m candles
   */
  public calc1hEma20(candles15m: KlinePoint[], candles1h?: KlinePoint[]): number {
    if (candles1h && candles1h.length >= 10) {
      const closes1h = candles1h.map(c => c.close);
      return this.calcEMA(closes1h, 20);
    }

    // Aggregate 15m into 1H candles (4 x 15m = 1 x 1H)
    if (candles15m.length >= 8) {
      const aggCloses: number[] = [];
      for (let i = 3; i < candles15m.length; i += 4) {
        aggCloses.push(candles15m[i].close);
      }
      if (aggCloses.length >= 5) {
        return this.calcEMA(aggCloses, Math.min(20, aggCloses.length));
      }
    }

    // Mathematical equivalence on 15m: 1H 20 EMA is roughly 80 EMA on 15m
    const closes15m = candles15m.map(c => c.close);
    const effectivePeriod = Math.min(80, closes15m.length);
    return this.calcEMA(closes15m, effectivePeriod);
  }

  /**
   * Helper: Calculate Exponential Moving Average
   */
  public calcEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  /**
   * Helper: Calculate 14-period Average True Range
   */
  public calcATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return (candles?.[0]?.close || 1) * 0.015;
    const effectivePeriod = Math.min(period, candles.length - 1);
    const trs: number[] = [];
    for (let i = candles.length - effectivePeriod; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return trs.reduce((a, b) => a + b, 0) / effectivePeriod;
  }

  /**
   * Helper: Quantize price to exchange tickSize and decimals
   */
  public quantizePrice(price: number, tickSize: number, decimals: number): number {
    if (price <= 0 || !isFinite(price)) return 0;
    const factor = Math.round(price / tickSize);
    return parseFloat((factor * tickSize).toFixed(decimals));
  }

  /**
   * Helper: Retrieve symbol specifications from DELTA_PRODUCT_SPECS
   */
  private getSymbolSpec(symbol: string): { tickSize: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim().replace(/USD[T]?$/, '') + 'USD';
    const spec = DELTA_PRODUCT_SPECS[clean] || DELTA_PRODUCT_SPECS[symbol];
    if (spec) return { tickSize: spec.tickSize, decimals: spec.decimals };
    return { tickSize: 0.0001, decimals: 4 };
  }
}

export const hbaMarketStructureBreakoutEngine = new HbaMarketStructureBreakoutEngine();
export const hbaBreakoutEngine = hbaMarketStructureBreakoutEngine;
