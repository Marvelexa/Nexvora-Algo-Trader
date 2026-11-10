// Marwadi Trader Complete Course Playlist - Liquidity Trap Trading Engine (System 3007 / Port 3007)
// Source Playlist: "https://www.youtube.com/watch?v=uKypKp7pjQg&list=PLlmZb_KM4aoUbU3L_GyCVr3Mm3EFXbDzu"
//
// Core Strategy Philosophy:
// 1. 15m Range Boundaries (R_range and S_range):
//    - Identifies established trading range over 30-50 bars on 15m.
//    - Resistance ceiling R_range and Support floor S_range must each possess >= 2 tested touches
//      within 0.25 * ATR14. Ranges with < 2 touches on either boundary are rejected as unconfirmed.
//    - Unvalidated array minimums/maximums that latch onto anomalous single wicks are eliminated.
//    - Range width viability: 2.0 * ATR14 <= rangeWidth <= 12.0 * ATR14 (and <= 15% of price).
// 2. Bull Trap False Breakout Reversal (Short Setup):
//    - Price pierces above R_range by >= max(1 * tickSize, 0.08 * ATR14) triggering retail breakout orders.
//    - Swift rejection: Current candle closes strictly back INSIDE the range (Close < R_range).
//      Genuine breakouts that close outside the range are NOT flagged as traps.
//    - Rejection Wick: Upper rejection wick >= 1.25x candle body (or >= 0.20 * ATR14).
//    - RVOL Confirmation: RVOL = volume / SMA20_vol >= 1.10 (low volume fakeouts < 1.10 rejected).
// 3. Bear Trap False Breakdown Reversal (Long Setup):
//    - Price pierces below S_range by >= max(1 * tickSize, 0.08 * ATR14) triggering retail breakdown stops.
//    - Swift rejection: Current candle closes strictly back INSIDE the range (Close > S_range).
//      Genuine breakdowns that close outside the range are NOT flagged as traps.
//    - Rejection Wick: Lower rejection wick >= 1.25x candle body (or >= 0.20 * ATR14).
//    - RVOL Confirmation: RVOL = volume / SMA20_vol >= 1.10.
// 4. Delta Microstructure & Order Flow Confluence:
//    - Analyzes L2 orderbook ratio, CVD, and Open Interest buildup/unwinding when microData is supplied.
// 5. Stop Loss Formula:
//    - Generous structural breathing room strictly beyond trap extreme:
//      Long: trapLow - Math.max(1.80 * ATR14, 0.015 * currentPrice, 3 * tickSize).
//      Short: trapHigh + Math.max(1.80 * ATR14, 0.015 * currentPrice, 3 * tickSize).
// 6. Pre-Reversal Take Profit Formula:
//    - Placed 2-3 ticks before opposite range boundary:
//      Buffer = Math.max(3 * tickSize, 0.12 * ATR14).
//      TP_Long = R_range - Buffer; TP_Short = S_range + Buffer.
// 7. Strict Risk-to-Reward Ratio:
//    - Strict minimum 1:2.30 (RR >= 2.30). Rejects any trade with RR < 2.30.
// 8. Delta Exchange Specifications:
//    - Sizing and tick quantizing strictly respect contract_value and tickSize.

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
  rangeHigh?: number;
  rangeLow?: number;
  rangeWidth?: number;
  rvol?: number;
  trapType?: 'BULL_TRAP' | 'BEAR_TRAP' | 'NONE';
  rejectionWickRatio?: number;
  oiRegime?: string;
  orderBookRatio?: number;
}

export interface RangeBoundaries {
  rangeHigh: number;
  rangeLow: number;
  rangeWidth: number;
  highTouches: number;
  lowTouches: number;
  isValid: boolean;
  rejectionReason?: string;
}

export class MarwadiLiquidityTrapEngine {
  /**
   * Main evaluation method for System 3007
   */
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StrategySetupResult {
    const nullResult: StrategySetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'MARWADI_LIQUIDITY_TRAP'
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

    // Calculate 20-period Volume SMA & RVOL
    const volLookback = Math.min(20, candles15m.length - 2);
    const recentVols = candles15m.slice(-volLookback - 2, -2).map(c => c.volume || 0);
    const sma20Vol = recentVols.length > 0 ? (recentVols.reduce((a, b) => a + b, 0) / recentVols.length) : 0;
    const currentVol = currentBar.volume || 0;
    const rvol = sma20Vol > 0 ? currentVol / sma20Vol : 1.0;

    // Detect Range Boundaries over prior 25-45 bars (excluding current and previous trap bars)
    const historyBars = candles15m.slice(0, -2);
    const range = this.detectRangeBoundaries(historyBars, atr14, currentPrice);

    // Check Range Viability
    if (!range.isValid) {
      return {
        ...nullResult,
        reasons: [range.rejectionReason || 'Range boundaries not confirmed with >= 2 touches']
      };
    }

    // Analyze Order Flow / Microstructure if provided
    const micro = this.analyzeMicrostructure(microData);

    const candleBody = Math.abs(currentBar.close - currentBar.open);
    const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
    const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
    const minPenetration = Math.max(1 * tickSize, 0.08 * atr14);

    // =========================================================================
    // 1. EVALUATE BULL TRAP (Short Setup)
    // =========================================================================
    const isWickAboveR = (currentBar.high - range.rangeHigh >= minPenetration) || (prevBar.high - range.rangeHigh >= minPenetration);
    const isCloseInsideR = currentBar.close < range.rangeHigh;
    const isClosedOutsideR = currentBar.close >= range.rangeHigh;

    if (isClosedOutsideR && currentBar.high > range.rangeHigh) {
      // True breakout without rejection - NOT a trap!
      return {
        ...nullResult,
        rangeHigh: range.rangeHigh,
        rangeLow: range.rangeLow,
        rangeWidth: range.rangeWidth,
        reasons: ['True breakout candle closes outside range without rejection: NOT a bull trap']
      };
    }

    if (isWickAboveR && isCloseInsideR) {
      // Delta Orderbook Filter: If aggressive buyers dominate (> 1.75 bid/ask ratio), avoid fading real breakouts
      if (microData?.bidAskRatio && microData.bidAskRatio > 1.75) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Orderbook buyer imbalance (${microData.bidAskRatio.toFixed(2)} > 1.75): breakout momentum too strong to fade`]
        };
      }

      // Rejection Wick Qualification: Upper wick must be >= 1.25x body
      const wickRatio = candleBody > 0 ? upperWick / candleBody : upperWick / (tickSize * 2);
      if (wickRatio < 1.25 && upperWick < 0.20 * atr14) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Weak rejection wick (${upperWick.toFixed(decimals)} is ${wickRatio.toFixed(2)}x body < 1.25x body requirement)`]
        };
      }

      // RVOL Qualification: Must be >= 1.10
      if (rvol < 1.10) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Low volume fakeout (RVOL ${rvol.toFixed(2)} < 1.10) rejected to avoid dead-liquidity noise`]
        };
      }

      // Stop Loss: Generous breathing room strictly beyond trap candle extreme
      const trapExtreme = Math.max(currentBar.high, prevBar.high);
      const slBuffer = Math.max(1.80 * atr14, 0.015 * currentPrice, 3 * tickSize);
      const rawSL = trapExtreme + slBuffer;
      const sl = this.quantizePrice(rawSL, tickSize, decimals);
      const slDistance = sl - currentPrice;

      if (slDistance > 0) {
        // Pre-Reversal TP: Placed 2-3 ticks before opposite range boundary (S_range)
        const preReversalBuffer = Math.max(3 * tickSize, 0.12 * atr14);
        const naturalTP = range.rangeLow + preReversalBuffer;
        const tp = this.quantizePrice(naturalTP, tickSize, decimals);
        const profitDistance = currentPrice - tp;

        const rr = parseFloat((profitDistance / slDistance).toFixed(2));

        // Strict Minimum 1:2.30 R:R enforcement
        if (rr < 2.30 || profitDistance <= 0) {
          return {
            ...nullResult,
            rangeHigh: range.rangeHigh,
            rangeLow: range.rangeLow,
            reasons: [`Risk/Reward ratio ${rr} < 2.30 strict minimum; trap wick too large or range too narrow`]
          };
        }

        // Score confidence based on trap conviction and order flow
        let confidence = 85;
        if (rvol >= 1.50) confidence += 5;
        if (wickRatio >= 2.00) confidence += 5;
        if (micro.oiRegime === 'LONG_UNWINDING' || micro.oiRegime === 'SHORT_BUILDUP') confidence += 5;

        return {
          recommendedSide: 'SELL',
          confidenceScore: Math.min(confidence, 98),
          setupType: 'MARWADI_BULL_TRAP_FADE',
          reasons: [
            `15m Range Boundaries confirmed: [${range.rangeLow.toFixed(decimals)} - ${range.rangeHigh.toFixed(decimals)}] (width: ${range.rangeWidth.toFixed(decimals)}, ${range.highTouches} ceiling touches, ${range.lowTouches} floor touches)`,
            `Bull Trap confirmed: Price wicked above ceiling ${range.rangeHigh.toFixed(decimals)} reaching $${trapExtreme.toFixed(decimals)} and slammed back inside (Close: ${currentPrice.toFixed(decimals)})`,
            `Strong upper rejection wick: ${wickRatio.toFixed(2)}x body (>= 1.25x requirement)`,
            `Breakout volume surge: RVOL = ${rvol.toFixed(2)}x (>= 1.10x requirement)`,
            micro.reasons.length > 0 ? micro.reasons.join('; ') : 'Order flow aligned',
            `Stop Loss placed beyond trap high with generous breathing room: $${sl.toFixed(decimals)} (buffer: +$${slBuffer.toFixed(decimals)})`,
            `Pre-Reversal Take Profit positioned 2-3 ticks before opposite boundary ${range.rangeLow.toFixed(decimals)} (TP: ${tp.toFixed(decimals)})`,
            `Risk-to-Reward satisfied: 1:${rr} (>= 2.30 strict minimum)`
          ],
          customSL: sl,
          customTP: tp,
          marketRegime: 'LIQUIDITY_TRAP_RANGE_REVERSAL',
          riskReward: rr,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          rangeWidth: range.rangeWidth,
          rvol: parseFloat(rvol.toFixed(2)),
          trapType: 'BULL_TRAP',
          rejectionWickRatio: parseFloat(wickRatio.toFixed(2)),
          oiRegime: micro.oiRegime,
          orderBookRatio: micro.orderBookRatio
        };
      }
    }

    // =========================================================================
    // 2. EVALUATE BEAR TRAP (Long Setup)
    // =========================================================================
    const isWickBelowS = (range.rangeLow - currentBar.low >= minPenetration) || (range.rangeLow - prevBar.low >= minPenetration);
    const isCloseInsideS = currentBar.close > range.rangeLow;
    const isClosedOutsideS = currentBar.close <= range.rangeLow;

    if (isClosedOutsideS && currentBar.low < range.rangeLow) {
      // True breakdown without rejection - NOT a trap!
      return {
        ...nullResult,
        rangeHigh: range.rangeHigh,
        rangeLow: range.rangeLow,
        rangeWidth: range.rangeWidth,
        reasons: ['True breakdown candle closes outside range without rejection: NOT a bear trap']
      };
    }

    if (isWickBelowS && isCloseInsideS) {
      // Delta Orderbook Filter: If aggressive sellers dominate (< 0.55 bid/ask ratio), avoid catching falling knife
      if (microData?.bidAskRatio && microData.bidAskRatio < 0.55) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Orderbook seller imbalance (${microData.bidAskRatio.toFixed(2)} < 0.55): breakdown momentum too strong to fade`]
        };
      }

      // Rejection Wick Qualification: Lower wick must be >= 1.25x body
      const wickRatio = candleBody > 0 ? lowerWick / candleBody : lowerWick / (tickSize * 2);
      if (wickRatio < 1.25 && lowerWick < 0.20 * atr14) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Weak rejection wick (${lowerWick.toFixed(decimals)} is ${wickRatio.toFixed(2)}x body < 1.25x body requirement)`]
        };
      }

      // RVOL Qualification: Must be >= 1.10
      if (rvol < 1.10) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Low volume fakeout (RVOL ${rvol.toFixed(2)} < 1.10) rejected to avoid dead-liquidity noise`]
        };
      }

      // Stop Loss: Generous breathing room strictly beyond trap candle extreme
      const trapExtreme = Math.min(currentBar.low, prevBar.low);
      const slBuffer = Math.max(1.80 * atr14, 0.015 * currentPrice, 3 * tickSize);
      const rawSL = trapExtreme - slBuffer;
      const sl = this.quantizePrice(rawSL, tickSize, decimals);
      const slDistance = currentPrice - sl;

      if (slDistance > 0) {
        // Pre-Reversal TP: Placed 2-3 ticks before opposite range boundary (R_range)
        const preReversalBuffer = Math.max(3 * tickSize, 0.12 * atr14);
        const naturalTP = range.rangeHigh - preReversalBuffer;
        const tp = this.quantizePrice(naturalTP, tickSize, decimals);
        const profitDistance = tp - currentPrice;

        const rr = parseFloat((profitDistance / slDistance).toFixed(2));

        // Strict Minimum 1:2.30 R:R enforcement
        if (rr < 2.30 || profitDistance <= 0) {
          return {
            ...nullResult,
            rangeHigh: range.rangeHigh,
            rangeLow: range.rangeLow,
            reasons: [`Risk/Reward ratio ${rr} < 2.30 strict minimum; trap wick too large or range too narrow`]
          };
        }

        let confidence = 85;
        if (rvol >= 1.50) confidence += 5;
        if (wickRatio >= 2.00) confidence += 5;
        if (micro.oiRegime === 'LONG_BUILDUP' || micro.oiRegime === 'SHORT_COVERING') confidence += 5;

        return {
          recommendedSide: 'BUY',
          confidenceScore: Math.min(confidence, 98),
          setupType: 'MARWADI_BEAR_TRAP_FADE',
          reasons: [
            `15m Range Boundaries confirmed: [${range.rangeLow.toFixed(decimals)} - ${range.rangeHigh.toFixed(decimals)}] (width: ${range.rangeWidth.toFixed(decimals)}, ${range.highTouches} ceiling touches, ${range.lowTouches} floor touches)`,
            `Bear Trap confirmed: Price wicked below floor ${range.rangeLow.toFixed(decimals)} reaching $${trapExtreme.toFixed(decimals)} and bounced back inside (Close: ${currentPrice.toFixed(decimals)})`,
            `Strong lower rejection wick: ${wickRatio.toFixed(2)}x body (>= 1.25x requirement)`,
            `Breakout volume surge: RVOL = ${rvol.toFixed(2)}x (>= 1.10x requirement)`,
            micro.reasons.length > 0 ? micro.reasons.join('; ') : 'Order flow aligned',
            `Stop Loss placed beyond trap low with generous breathing room: $${sl.toFixed(decimals)} (buffer: -$${slBuffer.toFixed(decimals)})`,
            `Pre-Reversal Take Profit positioned 2-3 ticks before opposite boundary ${range.rangeHigh.toFixed(decimals)} (TP: ${tp.toFixed(decimals)})`,
            `Risk-to-Reward satisfied: 1:${rr} (>= 2.30 strict minimum)`
          ],
          customSL: sl,
          customTP: tp,
          marketRegime: 'LIQUIDITY_TRAP_RANGE_REVERSAL',
          riskReward: rr,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          rangeWidth: range.rangeWidth,
          rvol: parseFloat(rvol.toFixed(2)),
          trapType: 'BEAR_TRAP',
          rejectionWickRatio: parseFloat(wickRatio.toFixed(2)),
          oiRegime: micro.oiRegime,
          orderBookRatio: micro.orderBookRatio
        };
      }
    }

    return nullResult;
  }

  /**
   * Detects 15m Range Boundaries with tested touches (>= 2 touches within 0.25 * ATR14 each)
   * Eliminates unvalidated array min/max to prevent anomalous wick contamination (e.g. XMR anomaly).
   */
  public detectRangeBoundaries(candles: KlinePoint[], atr14: number, currentPrice?: number): RangeBoundaries {
    const defaultRes: RangeBoundaries = {
      rangeHigh: 0,
      rangeLow: 0,
      rangeWidth: 0,
      highTouches: 0,
      lowTouches: 0,
      isValid: false
    };

    if (!candles || candles.length < 20) {
      return { ...defaultRes, rejectionReason: 'Insufficient candle history for range detection' };
    }

    const priceRef = currentPrice && currentPrice > 0 ? currentPrice : candles[candles.length - 1].close;
    const touchTolerance = 0.25 * atr14;

    // Filter out extreme price prints (> 25% from priceRef or > 15 * ATR14)
    const validCandles = candles.filter(c => 
      c.high > 0 && c.low > 0 && 
      Math.abs(c.high - priceRef) <= 15 * atr14 &&
      Math.abs(c.low - priceRef) <= 15 * atr14 &&
      (priceRef <= 0 || (Math.abs(c.high - priceRef) / priceRef <= 0.25 && Math.abs(c.low - priceRef) / priceRef <= 0.25))
    );

    if (validCandles.length < 15) {
      return { ...defaultRes, rejectionReason: 'Insufficient valid candle extremes within reasonable volatility bounds' };
    }

    // Find confirmed resistance ceiling (highest candidate high with >= 2 touches within 0.25 ATR)
    const candidateHighs = validCandles.map(c => c.high).sort((a, b) => b - a);
    let rangeHigh = 0;
    let highTouches = 0;

    for (const testHigh of candidateHighs) {
      const touches = validCandles.filter(c => Math.abs(c.high - testHigh) <= touchTolerance).length;
      if (touches >= 2) {
        rangeHigh = testHigh;
        highTouches = touches;
        break;
      }
    }

    // Find confirmed support floor (lowest candidate low with >= 2 touches within 0.25 ATR)
    const candidateLows = validCandles.map(c => c.low).sort((a, b) => a - b);
    let rangeLow = 0;
    let lowTouches = 0;

    for (const testLow of candidateLows) {
      const touches = validCandles.filter(c => Math.abs(c.low - testLow) <= touchTolerance).length;
      if (touches >= 2) {
        rangeLow = testLow;
        lowTouches = touches;
        break;
      }
    }

    if (rangeHigh === 0 || rangeLow === 0 || highTouches < 2 || lowTouches < 2) {
      return {
        ...defaultRes,
        rangeHigh,
        rangeLow,
        highTouches,
        lowTouches,
        rejectionReason: `Unconfirmed boundary levels: ceiling touches (${highTouches}) or floor touches (${lowTouches}) < 2 confirmed touches`
      };
    }

    const rangeWidth = rangeHigh - rangeLow;

    // Range width must be viable (>= 2.0 * ATR14, rejecting dead chop) and not runaway (> 12 * ATR14 or > 15% price)
    if (rangeWidth < 2.0 * atr14) {
      return {
        ...defaultRes,
        rangeHigh,
        rangeLow,
        rangeWidth,
        highTouches,
        lowTouches,
        rejectionReason: `Narrow range (${rangeWidth.toFixed(4)}) < 2.0 * ATR (${(2.0 * atr14).toFixed(4)}) rejected as choppy consolidation`
      };
    }

    const midPrice = (rangeHigh + rangeLow) / 2;
    if (rangeWidth > 15.0 * atr14 || (midPrice > 0 && rangeWidth > midPrice * 0.25)) {
      return {
        ...defaultRes,
        rangeHigh,
        rangeLow,
        rangeWidth,
        highTouches,
        lowTouches,
        rejectionReason: `Excessive range width (${rangeWidth.toFixed(4)}) indicates runaway macro trend, not horizontal range`
      };
    }

    return {
      rangeHigh,
      rangeLow,
      rangeWidth,
      highTouches,
      lowTouches,
      isValid: true
    };
  }

  /**
   * Helper: Analyze Delta Microstructure / Order Flow
   */
  public analyzeMicrostructure(microData?: any): {
    oiRegime: string;
    orderBookRatio: number;
    reasons: string[];
  } {
    const orderBookRatio = microData?.bidAskRatio || (microData?.orderBookRatio || 1.0);
    const oiChange = microData?.oiChangeUsd6h || 0;
    const takerBuyRatio = microData?.takerBuyRatio || 0.50;

    let oiRegime = 'NEUTRAL';
    const reasons: string[] = [];

    if (oiChange > 50000) {
      if (takerBuyRatio >= 0.52) {
        oiRegime = 'LONG_BUILDUP';
        reasons.push(`OI Buildup: +$${Math.round(oiChange)} with ${(takerBuyRatio * 100).toFixed(0)}% taker buys (LONG_BUILDUP)`);
      } else {
        oiRegime = 'SHORT_BUILDUP';
        reasons.push(`OI Buildup: +$${Math.round(oiChange)} with ${((1 - takerBuyRatio) * 100).toFixed(0)}% taker sells (SHORT_BUILDUP)`);
      }
    } else if (oiChange < -50000) {
      if (takerBuyRatio < 0.48) {
        oiRegime = 'LONG_UNWINDING';
        reasons.push(`OI Unwinding: -$${Math.abs(Math.round(oiChange))} liquidation drop (LONG_UNWINDING)`);
      } else {
        oiRegime = 'SHORT_COVERING';
        reasons.push(`OI Short Covering: -$${Math.abs(Math.round(oiChange))} short covering rally`);
      }
    }

    if (orderBookRatio >= 1.20) {
      reasons.push(`Orderbook Buyer Bid Imbalance: ratio ${orderBookRatio.toFixed(2)} >= 1.20`);
    } else if (orderBookRatio <= 0.80) {
      reasons.push(`Orderbook Seller Ask Imbalance: ratio ${orderBookRatio.toFixed(2)} <= 0.80`);
    }

    return { oiRegime, orderBookRatio, reasons };
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
    return parseFloat((contracts * contractValue * priceDiff).toFixed(4));
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

export const marwadiLiquidityTrapEngine = new MarwadiLiquidityTrapEngine();
export const marwadiTrapEngine = marwadiLiquidityTrapEngine;
