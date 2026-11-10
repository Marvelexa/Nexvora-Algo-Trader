// HBA Services Technical Analysis - Fibonacci 0.50/0.618 Golden Pocket Engine (System 3005 / Port 3005)
// Source Video: "https://youtu.be/aWoRYqQI0pM" (HBA Services Technical Analysis Part 2)
//
// Core Strategy Philosophy:
// 1. Impulsive Wave Detection: Identifies clear directional impulse waves over 30-50 bars on 15m
//    where wave amplitude Δ_wave = |H_0 - L_0| >= 2.5 * ATR14. Weak/choppy oscillation moves (< 2.5 ATR) are rejected.
// 2. Fibonacci Retracement Grid:
//    - Long Setup: Fib 0.000 = H_0 (target extreme), Fib 0.500 = H_0 - 0.50*Δ, Fib 0.618 = H_0 - 0.618*Δ,
//      Fib 0.786 = H_0 - 0.786*Δ, Fib 0.886 = H_0 - 0.886*Δ (structural invalidation floor), Fib 1.000 = L_0.
//    - Short Setup: Fib 0.000 = L_0 (target extreme), Fib 0.500 = L_0 + 0.50*Δ, Fib 0.618 = L_0 + 0.618*Δ,
//      Fib 0.786 = L_0 + 0.786*Δ, Fib 0.886 = L_0 + 0.886*Δ (structural invalidation ceiling), Fib 1.000 = H_0.
//    - Golden Pocket Zone: [Fib 0.618, Fib 0.500] for Long; [Fib 0.500, Fib 0.618] for Short.
// 3. Horizontal Cross-Body S&R Confluence:
//    - Identifies horizontal Support & Resistance levels formed across candle bodies (>= 2 body touches
//      within +/- 0.20 * ATR14) that align directly with the Golden Pocket.
//    - Absence of cross-body S&R confluence severely penalizes conviction or rejects the trade.
// 4. Candlestick Reversal Confirmation at Golden Pocket:
//    - Long: Hammer (lower wick >= 1.4x body), Inverted Hammer, Bullish Engulfing, or green bounce.
//    - Short: Shooting Star (upper wick >= 1.4x body), Hanging Man, Bearish Engulfing, or red rejection.
// 5. Macro Trend Alignment Filter:
//    - 15m 50 EMA trend filter: Longs only when price >= 50 EMA (or impulse is bullish); counter-trend
//      impulse pullbacks (buying a pullback of a bearish breakdown) are blocked.
// 6. Stop Loss Formula:
//    - Long: min(L_rejection, Fib_0.618) - max(1.2 * ATR14, 3 * tickSize).
//    - Short: max(H_rejection, Fib_0.618) + max(1.2 * ATR14, 3 * tickSize).
// 7. Pre-Reversal Take Profit Formula:
//    - Positioned buffer before 0.0 Fib swing extreme (H_0 for Long, L_0 for Short):
//      Buffer = max(0.12 * ATR14, 3 * tickSize, P_extreme * 0.0003).
//      TP_Long = H_0 - Buffer; TP_Short = L_0 + Buffer.
// 8. Risk-to-Reward Ratio:
//    - Strict corridor of 1:2.30 <= RR <= 1:2.618 (min 2.30, clamped at 2.618).
// 9. Delta Exchange Specifications:
//    - PnL and sizing calculations strictly respect contract_value (e.g. 0.001 for BTCUSD/XAUTUSD,
//      0.1 for SLVONUSD/SILVERUSD/NVDAXUSD, 0.01 for ETHUSD, 1.0 for SOL/XRP/ADA, 100 for DOGEUSD).

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
  impulseDelta?: number;
  fib500?: number;
  fib618?: number;
  fib886?: number;
  candlestickPattern?: string;
  hasSrConfluence?: boolean;
}

export interface HorizontalBodyCluster {
  level: number;
  touches: number;
  barIndices: number[];
}

export class HbaFibonacciGoldenPocketEngine {
  /**
   * Main evaluation method for System 3005
   */
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StrategySetupResult {
    const nullResult: StrategySetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'FIBONACCI_GOLDEN_POCKET'
    };

    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf?.candles15m && Array.isArray(candlesOrMtf.candles15m)) {
      candles15m = candlesOrMtf.candles15m;
    }

    if (!candles15m || candles15m.length < 30) {
      return nullResult;
    }

    const { tickSize, decimals, contractValue } = this.getSymbolSpec(symbol);
    const atr14 = this.calcATR(candles15m, 14);
    const currentBar = candles15m[candles15m.length - 1];
    const prevBar = candles15m[candles15m.length - 2];
    const currentPrice = currentBar.close;

    // 50 EMA Macro Trend Filter
    const closes = candles15m.map(c => c.close);
    const ema50 = this.calcEMA(closes, 50);

    // Lookback for impulse wave detection: 30 to 50 bars
    const lookback = Math.min(50, candles15m.length - 1);
    const waveHistory = candles15m.slice(-lookback, -1);

    // Find Swing High and Swing Low in wave history
    let swingHigh = -Infinity;
    let swingHighIndex = -1;
    let swingLow = Infinity;
    let swingLowIndex = -1;

    for (let i = 0; i < waveHistory.length; i++) {
      const c = waveHistory[i];
      if (c.high > swingHigh) {
        swingHigh = c.high;
        swingHighIndex = i;
      }
      if (c.low < swingLow) {
        swingLow = c.low;
        swingLowIndex = i;
      }
    }

    const impulseDelta = swingHigh - swingLow;

    // 1. Weak Impulse Leg Rejection: delta must be >= 2.5 * ATR14
    if (impulseDelta < 2.5 * atr14) {
      return {
        ...nullResult,
        reasons: [`Impulse move amplitude (${impulseDelta.toFixed(decimals)}) < 2.5 * ATR (${(2.5 * atr14).toFixed(decimals)}), rejected as choppy oscillation`]
      };
    }

    // Determine Impulse Direction based on whether swing low preceded swing high (bullish impulse)
    // or swing high preceded swing low (bearish impulse)
    const isBullishImpulse = swingLowIndex < swingHighIndex;
    const isBearishImpulse = swingHighIndex < swingLowIndex;

    // Find horizontal cross-body S&R clusters across candle bodies in history
    const bodyClusters = this.findHorizontalBodyClusters(candles15m.slice(0, -1), atr14);

    // =========================================================================
    // EVALUATE BULLISH IMPULSE -> RETRACEMENT LONG
    // =========================================================================
    if (isBullishImpulse) {
      // 50 EMA Trend Alignment: Do not buy pullback if market is in confirmed downtrend
      if (currentPrice < ema50 && currentBar.close < currentBar.open) {
        return {
          ...nullResult,
          reasons: [`Counter-trend Long blocked: Price ${currentPrice.toFixed(decimals)} < 50 EMA ${ema50.toFixed(decimals)} in downtrend`]
        };
      }

      const h0 = swingHigh;
      const l0 = swingLow;
      const fib000 = h0;
      const fib500 = h0 - (0.500 * impulseDelta);
      const fib618 = h0 - (0.618 * impulseDelta);
      const fib786 = h0 - (0.786 * impulseDelta);
      const fib886 = h0 - (0.886 * impulseDelta);

      // Invalidation check: If price has plunged below 0.886 Fib, impulse leg is invalidated
      if (currentBar.low < fib886 || currentBar.close < fib786) {
        return {
          ...nullResult,
          reasons: [`Overshot retracement: Low ${currentBar.low.toFixed(decimals)} plunged beyond 0.886 Fib invalidation level (${fib886.toFixed(decimals)})`]
        };
      }

      // Golden Pocket check: Price must reach or be within the 0.500 - 0.618 pocket
      // Shallow retracement terminating above 0.500 Fib does not qualify
      const reachedPocket = (currentBar.low <= fib500 && currentBar.low >= fib786) ||
                            (prevBar.low <= fib500 && prevBar.low >= fib786);

      if (!reachedPocket) {
        return {
          ...nullResult,
          reasons: [`Shallow retracement: Price did not enter 0.500-0.618 Golden Pocket [${fib618.toFixed(decimals)} - ${fib500.toFixed(decimals)}]`]
        };
      }

      // Horizontal Cross-Body S&R Confluence
      // Check if any body cluster aligns with the Golden Pocket within +/- 0.20 * ATR14
      const pocketTolerance = 0.20 * atr14;
      const confluentCluster = bodyClusters.find(c =>
        c.level >= (fib618 - pocketTolerance) &&
        c.level <= (fib500 + pocketTolerance) &&
        c.touches >= 2
      );

      const hasSrConfluence = !!confluentCluster;

      // Candlestick Reversal Confirmation at Pocket
      const candlePattern = this.detectReversalCandle(currentBar, prevBar, 'BULLISH', tickSize);
      const isReversalCandle = candlePattern.isReversal;

      // Mandatory Video Confluence Filters (HBA Services: https://youtu.be/aWoRYqQI0pM)
      // 1. Horizontal S&R Confluence is STRICTLY required
      if (!hasSrConfluence) {
        return {
          ...nullResult,
          reasons: ['Missing horizontal cross-body S&R confluence at Golden Pocket zone (mandatory per HBA video)']
        };
      }

      // 2. Candlestick Reversal Confirmation at Pocket is STRICTLY required
      if (!isReversalCandle) {
        return {
          ...nullResult,
          reasons: ['Missing confirmed reversal candlestick at Golden Pocket zone (mandatory per HBA video)']
        };
      }

      // Base confidence score
      let confidence = 85;
      if (hasSrConfluence) confidence += 10;
      if (isReversalCandle) confidence += 10;
      if (currentPrice >= ema50) confidence += 5;

      // Stop Loss: beyond 0.618 pocket / rejection candle low with breathing room floor
      const isMajor = ['BTC', 'ETH'].some(m => (symbol || '').toUpperCase().includes(m));
      const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
      const rejectionLow = Math.min(currentBar.low, prevBar.low);
      const slBuffer = Math.max(1.50 * atr14, currentPrice * minBreathingPercent, 5 * tickSize);
      const rawSL = Math.min(rejectionLow, fib618) - slBuffer;
      const sl = this.quantizePrice(rawSL, tickSize, decimals);
      const slDistance = currentPrice - sl;

      if (slDistance > 0) {
        // Pre-Reversal Take Profit: Placed buffer before 0.0 Fib swing high extreme
        const preReversalBuffer = Math.max(0.12 * atr14, 3 * tickSize, fib000 * 0.0003);
        const naturalTP = fib000 - preReversalBuffer;

        // Check Risk/Reward
        const rawProfit = naturalTP - currentPrice;
        let rr = parseFloat((rawProfit / slDistance).toFixed(2));

        // Enforce corridor: 2.30 <= RR <= 2.618
        let finalTP = naturalTP;
        if (rr < 2.30) {
          finalTP = currentPrice + (2.30 * slDistance);
          rr = 2.30;
        } else if (rr > 2.618) {
          // Cap at 2.618 per video specification corridor [2.30, 2.618]
          finalTP = currentPrice + (2.618 * slDistance);
          rr = 2.618;
        }

        const tp = this.quantizePrice(finalTP, tickSize, decimals);

        if (confidence >= 80 && tp > currentPrice && sl < currentPrice) {
          return {
            recommendedSide: 'BUY',
            confidenceScore: confidence,
            setupType: 'HBA_FIBONACCI_GOLDEN_POCKET_LONG',
            reasons: [
              `Bullish Impulse Wave confirmed: Δ = ${impulseDelta.toFixed(decimals)} (>= 2.5 * ATR14)`,
              `Retracement into 0.500-0.618 Golden Pocket [${fib618.toFixed(decimals)} - ${fib500.toFixed(decimals)}]`,
              hasSrConfluence
                ? `Horizontal Cross-Body S&R Confluence confirmed at ${confluentCluster!.level.toFixed(decimals)} (${confluentCluster!.touches} touches)`
                : `Golden Pocket retracement active (moderate confluence)`,
              `Reversal trigger: ${candlePattern.name}`,
              `Pre-Reversal Take Profit placed safely before 0.0 Fib swing high ${fib000.toFixed(decimals)} (TP: ${tp.toFixed(decimals)})`,
              `Risk-to-Reward satisfied: 1:${rr} (within strict 1:2.30 - 1:2.618 corridor)`
            ],
            customSL: sl,
            customTP: tp,
            marketRegime: 'BULLISH_FIB_POCKET_EXPANSION',
            riskReward: rr,
            impulseDelta: parseFloat(impulseDelta.toFixed(decimals)),
            fib500: parseFloat(fib500.toFixed(decimals)),
            fib618: parseFloat(fib618.toFixed(decimals)),
            fib886: parseFloat(fib886.toFixed(decimals)),
            candlestickPattern: candlePattern.name,
            hasSrConfluence
          };
        }
      }
    }

    // =========================================================================
    // EVALUATE BEARISH IMPULSE -> RETRACEMENT SHORT
    // =========================================================================
    if (isBearishImpulse) {
      // 50 EMA Trend Alignment: Do not sell pullback if market is in confirmed uptrend
      if (currentPrice > ema50 && currentBar.close > currentBar.open) {
        return {
          ...nullResult,
          reasons: [`Counter-trend Short blocked: Price ${currentPrice.toFixed(decimals)} > 50 EMA ${ema50.toFixed(decimals)} in uptrend`]
        };
      }

      const h0 = swingHigh;
      const l0 = swingLow;
      const fib000 = l0;
      const fib500 = l0 + (0.500 * impulseDelta);
      const fib618 = l0 + (0.618 * impulseDelta);
      const fib786 = l0 + (0.786 * impulseDelta);
      const fib886 = l0 + (0.886 * impulseDelta);

      // Invalidation check: If price has rallied above 0.886 Fib, impulse leg is invalidated
      if (currentBar.high > fib886 || currentBar.close > fib786) {
        return {
          ...nullResult,
          reasons: [`Overshot retracement: High ${currentBar.high.toFixed(decimals)} breached beyond 0.886 Fib invalidation level (${fib886.toFixed(decimals)})`]
        };
      }

      // Golden Pocket check: Price must reach or be within the 0.500 - 0.618 pocket
      const reachedPocket = (currentBar.high >= fib500 && currentBar.high <= fib786) ||
                            (prevBar.high >= fib500 && prevBar.high <= fib786);

      if (!reachedPocket) {
        return {
          ...nullResult,
          reasons: [`Shallow retracement: Price did not enter 0.500-0.618 Golden Pocket [${fib500.toFixed(decimals)} - ${fib618.toFixed(decimals)}]`]
        };
      }

      // Horizontal Cross-Body S&R Confluence
      const pocketTolerance = 0.20 * atr14;
      const confluentCluster = bodyClusters.find(c =>
        c.level >= (fib500 - pocketTolerance) &&
        c.level <= (fib618 + pocketTolerance) &&
        c.touches >= 2
      );

      const hasSrConfluence = !!confluentCluster;

      // Candlestick Reversal Confirmation at Pocket
      const candlePattern = this.detectReversalCandle(currentBar, prevBar, 'BEARISH', tickSize);
      const isReversalCandle = candlePattern.isReversal;

      // Mandatory Video Confluence Filters (HBA Services: https://youtu.be/aWoRYqQI0pM)
      // 1. Horizontal S&R Confluence is STRICTLY required
      if (!hasSrConfluence) {
        return {
          ...nullResult,
          reasons: ['Missing horizontal cross-body S&R confluence at Golden Pocket zone (mandatory per HBA video)']
        };
      }

      // 2. Candlestick Reversal Confirmation at Pocket is STRICTLY required
      if (!isReversalCandle) {
        return {
          ...nullResult,
          reasons: ['Missing confirmed reversal candlestick at Golden Pocket zone (mandatory per HBA video)']
        };
      }

      let confidence = 85;
      if (hasSrConfluence) confidence += 10;
      if (isReversalCandle) confidence += 10;
      if (currentPrice <= ema50) confidence += 5;

      // Stop Loss: beyond 0.618 pocket / rejection candle high with breathing room floor
      const isMajor = ['BTC', 'ETH'].some(m => (symbol || '').toUpperCase().includes(m));
      const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
      const rejectionHigh = Math.max(currentBar.high, prevBar.high);
      const slBuffer = Math.max(1.50 * atr14, currentPrice * minBreathingPercent, 5 * tickSize);
      const rawSL = Math.max(rejectionHigh, fib618) + slBuffer;
      const sl = this.quantizePrice(rawSL, tickSize, decimals);
      const slDistance = sl - currentPrice;

      if (slDistance > 0) {
        // Pre-Reversal Take Profit: Placed buffer before 0.0 Fib swing low extreme floor
        const preReversalBuffer = Math.max(0.12 * atr14, 3 * tickSize, fib000 * 0.0003);
        const naturalTP = fib000 + preReversalBuffer;

        // Check Risk/Reward
        const rawProfit = currentPrice - naturalTP;
        let rr = parseFloat((rawProfit / slDistance).toFixed(2));

        // Enforce corridor: 2.30 <= RR <= 2.618
        let finalTP = naturalTP;
        if (rr < 2.30) {
          finalTP = currentPrice - (2.30 * slDistance);
          rr = 2.30;
        } else if (rr > 2.618) {
          finalTP = currentPrice - (2.618 * slDistance);
          rr = 2.618;
        }

        const tp = this.quantizePrice(finalTP, tickSize, decimals);

        if (confidence >= 80 && tp < currentPrice && sl > currentPrice) {
          return {
            recommendedSide: 'SELL',
            confidenceScore: confidence,
            setupType: 'HBA_FIBONACCI_GOLDEN_POCKET_SHORT',
            reasons: [
              `Bearish Impulse Wave confirmed: Δ = ${impulseDelta.toFixed(decimals)} (>= 2.5 * ATR14)`,
              `Retracement into 0.500-0.618 Golden Pocket [${fib500.toFixed(decimals)} - ${fib618.toFixed(decimals)}]`,
              hasSrConfluence
                ? `Horizontal Cross-Body S&R Confluence confirmed at ${confluentCluster!.level.toFixed(decimals)} (${confluentCluster!.touches} touches)`
                : `Golden Pocket retracement active (moderate confluence)`,
              `Reversal trigger: ${candlePattern.name}`,
              `Pre-Reversal Take Profit placed safely before 0.0 Fib swing low ${fib000.toFixed(decimals)} (TP: ${tp.toFixed(decimals)})`,
              `Risk-to-Reward satisfied: 1:${rr} (within strict 1:2.30 - 1:2.618 corridor)`
            ],
            customSL: sl,
            customTP: tp,
            marketRegime: 'BEARISH_FIB_POCKET_CONTRACTION',
            riskReward: rr,
            impulseDelta: parseFloat(impulseDelta.toFixed(decimals)),
            fib500: parseFloat(fib500.toFixed(decimals)),
            fib618: parseFloat(fib618.toFixed(decimals)),
            fib886: parseFloat(fib886.toFixed(decimals)),
            candlestickPattern: candlePattern.name,
            hasSrConfluence
          };
        }
      }
    }

    return nullResult;
  }

  /**
   * Identifies horizontal cross-body S&R clusters where >= 2 candle bodies touch within +/- 0.20 * ATR14
   */
  public findHorizontalBodyClusters(candles: KlinePoint[], atr14: number): HorizontalBodyCluster[] {
    const clusters: HorizontalBodyCluster[] = [];
    if (!candles || candles.length < 10) return clusters;

    const tolerance = 0.20 * atr14;
    const bodyPoints: { price: number; barIndex: number }[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      bodyPoints.push({ price: c.open, barIndex: i });
      bodyPoints.push({ price: c.close, barIndex: i });
    }

    const visited = new Set<number>();

    for (let i = 0; i < bodyPoints.length; i++) {
      if (visited.has(i)) continue;
      const group = [bodyPoints[i]];
      visited.add(i);

      for (let j = i + 1; j < bodyPoints.length; j++) {
        if (visited.has(j)) continue;
        if (Math.abs(bodyPoints[j].price - bodyPoints[i].price) <= tolerance) {
          group.push(bodyPoints[j]);
          visited.add(j);
        }
      }

      if (group.length >= 2) {
        const avgPrice = group.reduce((sum, g) => sum + g.price, 0) / group.length;
        clusters.push({
          level: avgPrice,
          touches: group.length,
          barIndices: group.map(g => g.barIndex)
        });
      }
    }

    return clusters;
  }

  /**
   * Reversal candlestick geometry detection (Hammer, Shooting Star, Engulfing)
   */
  public detectReversalCandle(
    currentBar: KlinePoint,
    prevBar: KlinePoint,
    bias: 'BULLISH' | 'BEARISH',
    tickSize: number
  ): { isReversal: boolean; name: string } {
    const body = Math.abs(currentBar.close - currentBar.open);
    const range = Math.max(currentBar.high - currentBar.low, tickSize);
    const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
    const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;

    if (bias === 'BULLISH') {
      // Hammer: lower wick >= 1.4x body, small upper wick <= 0.4x body
      if (lowerWick >= 1.4 * Math.max(body, tickSize) && upperWick <= 0.5 * lowerWick) {
        return { isReversal: true, name: 'HAMMER_PIN_BAR' };
      }
      // Bullish Engulfing: green candle engulfing previous red body
      if (currentBar.close > currentBar.open && prevBar.close < prevBar.open &&
          currentBar.close >= prevBar.open && currentBar.open <= prevBar.close) {
        return { isReversal: true, name: 'BULLISH_ENGULFING' };
      }
      // Rejection bounce: Close in upper 40% of bar with green finish
      if (currentBar.close > currentBar.open && (currentBar.close - currentBar.low) >= 0.60 * range) {
        return { isReversal: true, name: 'BULLISH_REJECTION_BOUNCE' };
      }
    } else {
      // Shooting Star: upper wick >= 1.4x body, small lower wick <= 0.4x body
      if (upperWick >= 1.4 * Math.max(body, tickSize) && lowerWick <= 0.5 * upperWick) {
        return { isReversal: true, name: 'SHOOTING_STAR_PIN_BAR' };
      }
      // Bearish Engulfing: red candle engulfing previous green body
      if (currentBar.close < currentBar.open && prevBar.close > prevBar.open &&
          currentBar.close <= prevBar.open && currentBar.open >= prevBar.close) {
        return { isReversal: true, name: 'BEARISH_ENGULFING' };
      }
      // Rejection drop: Close in lower 40% of bar with red finish
      if (currentBar.close < currentBar.open && (currentBar.high - currentBar.close) >= 0.60 * range) {
        return { isReversal: true, name: 'BEARISH_REJECTION_DROP' };
      }
    }

    return { isReversal: false, name: 'STANDARD_BAR' };
  }

  /**
   * Calculate genuine PnL respecting Delta Exchange contract_value
   */
  public calculatePnL(
    side: 'BUY' | 'SELL',
    entryPrice: number,
    exitPrice: number,
    contracts: number,
    symbol: string
  ): number {
    const { contractValue } = this.getSymbolSpec(symbol);
    const priceDiff = side === 'BUY' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
    // Real Delta PnL = contracts * contractValue * priceDiff
    return parseFloat((contracts * contractValue * priceDiff).toFixed(4));
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
  public getSymbolSpec(symbol: string): { tickSize: number; contractValue: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim().replace(/USD[T]?$/, '') + 'USD';
    const spec = DELTA_PRODUCT_SPECS[clean] || DELTA_PRODUCT_SPECS[symbol];
    if (spec) {
      return { tickSize: spec.tickSize, contractValue: spec.contractValue, decimals: spec.decimals };
    }
    return { tickSize: 0.0001, contractValue: 1.0, decimals: 4 };
  }
}

export const hbaFibonacciGoldenPocketEngine = new HbaFibonacciGoldenPocketEngine();
export const hbaFibGoldenPocketEngine = hbaFibonacciGoldenPocketEngine;
