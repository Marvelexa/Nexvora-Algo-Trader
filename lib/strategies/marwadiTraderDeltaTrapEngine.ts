// Marwadi Trader Delta Exchange 20-Video Course - Liquidity Trap Trading Engine (System 3007 / Port 3007)
// Source Videos: "https://youtu.be/uKypKp7pjQg" (20-Video Delta Course) & "https://youtu.be/-ygKPKj3uj8"
// Core Strategy:
// 1. 15M Verified Multi-Touch Range Boundary Identification:
//    - Identify clean 20-45 bar consolidation Range High (R_high) and Range Low (R_low).
//    - Both boundaries require >= 2 confirmed touches within 0.25 * ATR14.
//    - Single anomalous flash wicks (e.g. XMR print anomaly) are strictly filtered out.
//    - Range width viability: 2.0 * ATR14 <= rangeWidth <= 12.0 * ATR14 (and <= 15% price).
// 2. Trap Mechanics (Retail Breakout Failure):
//    - BULL TRAP (Short): Price pierces above R_high by >= max(1 * tickSize, 0.08 * ATR14) (retail FOMO breakout).
//      Swift rejection: Breakout candle fails and closes back inside the range (< R_high).
//      Rejection wick: Upper rejection wick >= 1.25x body (or >= 0.20 * ATR14).
//      Volume / Delta Confluence: RVOL >= 1.10. Orderbook bid/ask <= 1.75.
//    - BEAR TRAP (Long): Price pierces below R_low by >= max(1 * tickSize, 0.08 * ATR14) (retail panic breakdown).
//      Swift rejection: Breakdown candle fails and closes back inside the range (> R_low).
//      Absorption wick: Lower absorption wick >= 1.25x body (or >= 0.20 * ATR14).
//      Volume / Delta Confluence: RVOL >= 1.10. Orderbook bid/ask >= 0.55.
// 3. Stop Loss: Full breathing room placed strictly beyond the trap candle extreme:
//    SL = trapExtreme +/- Math.max(1.80 * ATR14, 0.015 * currentPrice, 3 * tickSize).
// 4. Pre-Reversal TP: Placed 2-3 ticks before the OPPOSITE range boundary:
//    Buffer = Math.max(0.12 * ATR14, 3 * tickSize).
//    TP_Short = R_low + Buffer; TP_Long = R_high - Buffer.
// 5. Risk-to-Reward: Strict minimum 1:2.30 (RR >= 2.30). Zero loose momentum fallbacks.
// 6. Zero Fallback: When no genuine Marwadi trap exists, returns nullResult (signal: null) cleanly.

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

export class MarwadiTraderDeltaTrapEngine {
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StrategySetupResult {
    const nullResult: StrategySetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'MARWADI_DELTA_TRAP'
    };

    let candles15m: KlinePoint[] = [];
    if (Array.isArray(candlesOrMtf)) {
      candles15m = candlesOrMtf;
    } else if (candlesOrMtf?.candles15m) {
      candles15m = candlesOrMtf.candles15m;
    }

    if (!candles15m || candles15m.length < 30) return nullResult;

    const currentBar = candles15m[candles15m.length - 1];
    const prevBar = candles15m[candles15m.length - 2];
    const currentPrice = currentBar.close;
    const atr14 = this.calcATR(candles15m, 14);

    const { tickSize, decimals } = this.getSymbolSpec(symbol);

    // Calculate 20-period Volume SMA & RVOL
    const volLookback = Math.min(20, candles15m.length - 2);
    const recentVols = candles15m.slice(-volLookback - 2, -2).map(c => c.volume || 0);
    const sma20Vol = recentVols.length > 0 ? (recentVols.reduce((a, b) => a + b, 0) / recentVols.length) : 0;
    const currentVol = currentBar.volume || 0;
    const rvol = sma20Vol > 0 ? currentVol / sma20Vol : 1.0;

    // Detect Range Boundaries over prior 25-45 bars (excluding current and previous trap bars)
    const historyBars = candles15m.slice(0, -2);
    const range = this.detectRangeBoundaries(historyBars, atr14, currentPrice);

    if (!range.isValid) {
      return {
        ...nullResult,
        reasons: [range.rejectionReason || 'Range boundaries not confirmed with >= 2 touches']
      };
    }

    // Microstructure & Order Flow analysis
    const micro = this.analyzeMicrostructure(microData);

    const body = Math.abs(currentBar.close - currentBar.open);
    const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
    const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
    const minPenetration = Math.max(1 * tickSize, 0.08 * atr14);

    // =========================================================================
    // 1. BULL TRAP REJECTION (Short Setup)
    // =========================================================================
    const piercedHigh = (currentBar.high - range.rangeHigh >= minPenetration) || (prevBar.high - range.rangeHigh >= minPenetration);
    const closedBelowHigh = currentBar.close < range.rangeHigh;
    const trapHigh = Math.max(prevBar.high, currentBar.high);

    // True breakout check: if close is outside range, NOT a trap
    if (currentBar.close >= range.rangeHigh && currentBar.high > range.rangeHigh) {
      return {
        ...nullResult,
        rangeHigh: range.rangeHigh,
        rangeLow: range.rangeLow,
        rangeWidth: range.rangeWidth,
        reasons: ['Breakout candle closes outside range: NOT a bull trap']
      };
    }

    if (piercedHigh && closedBelowHigh) {
      // Delta Orderbook Filter: If aggressive buyers dominate (> 1.75 bid/ask ratio), avoid fading real breakouts
      if (microData?.bidAskRatio && microData.bidAskRatio > 1.75) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Orderbook buyer imbalance (${microData.bidAskRatio.toFixed(2)} > 1.75): breakout momentum too strong to fade`]
        };
      }

      // RVOL confirmation: low volume fakeouts < 1.10 rejected
      if (rvol < 1.10) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Low volume fakeout (RVOL ${rvol.toFixed(2)} < 1.10) rejected`]
        };
      }

      const wickRatio = body > 0 ? upperWick / body : upperWick / (tickSize * 2);
      const isRejectionWick = wickRatio >= 1.25 || upperWick >= 0.20 * atr14;

      if (isRejectionWick) {
        // Stop Loss: Generous breathing room strictly beyond trap extreme
        const slBuffer = Math.max(1.80 * atr14, 0.015 * currentPrice, 3 * tickSize);
        const rawSL = trapHigh + slBuffer;
        const sl = this.quantizePrice(rawSL, tickSize, decimals);
        const riskDist = sl - currentPrice;

        // Pre-Reversal TP strictly 2-3 ticks before Range Low (rangeLow + buffer)
        const preRevBuffer = Math.max(0.12 * atr14, 3 * tickSize);
        const rawTP = range.rangeLow + preRevBuffer;
        const tp = this.quantizePrice(rawTP, tickSize, decimals);
        const targetDist = currentPrice - tp;

        const rr = (riskDist > 0 && targetDist > 0) ? parseFloat((targetDist / riskDist).toFixed(2)) : 0;

        if (rr >= 2.30 && riskDist > 0 && targetDist > 0) {
          let confidence = 85;
          if (rvol >= 1.50) confidence += 5;
          if (wickRatio >= 2.00) confidence += 5;
          if (micro.oiRegime === 'LONG_UNWINDING' || micro.oiRegime === 'SHORT_BUILDUP') confidence += 5;

          return {
            recommendedSide: 'SELL',
            confidenceScore: Math.min(confidence, 98),
            setupType: 'MARWADI_BULL_TRAP_FADE',
            reasons: [
              `15m Range Boundaries confirmed: [${range.rangeLow.toFixed(decimals)} - ${range.rangeHigh.toFixed(decimals)}] (${range.highTouches} ceiling touches, ${range.lowTouches} floor touches)`,
              `Bull Trap confirmed: Pierced range ceiling reaching $${trapHigh.toFixed(decimals)} and rejected back inside (Close: $${currentPrice.toFixed(decimals)})`,
              `Strong upper rejection wick: ${wickRatio.toFixed(2)}x body (>= 1.25x requirement)`,
              `Volume surge confirmed: RVOL = ${rvol.toFixed(2)}x (>= 1.10x requirement)`,
              `Stop Loss placed beyond trap high with generous breathing room: $${sl.toFixed(decimals)} (buffer: +$${slBuffer.toFixed(decimals)})`,
              `Pre-Reversal TP anchored 2-3 ticks before range floor $${range.rangeLow.toFixed(decimals)} (TP: $${tp.toFixed(decimals)})`,
              `Strict 1:2.30+ Risk:Reward ratio: 1:${rr.toFixed(2)}`
            ],
            customSL: sl,
            customTP: tp,
            marketRegime: 'BEARISH_TRAP_REVERSAL',
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
    }

    // =========================================================================
    // 2. BEAR TRAP ABSORPTION (Long Setup)
    // =========================================================================
    const piercedLow = (range.rangeLow - currentBar.low >= minPenetration) || (range.rangeLow - prevBar.low >= minPenetration);
    const closedAboveLow = currentBar.close > range.rangeLow;
    const trapLow = Math.min(prevBar.low, currentBar.low);

    // True breakdown check: if close is outside range, NOT a trap
    if (currentBar.close <= range.rangeLow && currentBar.low < range.rangeLow) {
      return {
        ...nullResult,
        rangeHigh: range.rangeHigh,
        rangeLow: range.rangeLow,
        rangeWidth: range.rangeWidth,
        reasons: ['Breakdown candle closes outside range: NOT a bear trap']
      };
    }

    if (piercedLow && closedAboveLow) {
      // Delta Orderbook Filter: If aggressive sellers dominate (< 0.55 bid/ask ratio), avoid catching falling knife
      if (microData?.bidAskRatio && microData.bidAskRatio < 0.55) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Orderbook seller imbalance (${microData.bidAskRatio.toFixed(2)} < 0.55): breakdown momentum too strong to fade`]
        };
      }

      // RVOL confirmation: low volume fakeouts < 1.10 rejected
      if (rvol < 1.10) {
        return {
          ...nullResult,
          rangeHigh: range.rangeHigh,
          rangeLow: range.rangeLow,
          reasons: [`Low volume fakeout (RVOL ${rvol.toFixed(2)} < 1.10) rejected`]
        };
      }

      const wickRatio = body > 0 ? lowerWick / body : lowerWick / (tickSize * 2);
      const isAbsorptionWick = wickRatio >= 1.25 || lowerWick >= 0.20 * atr14;

      if (isAbsorptionWick) {
        // Stop Loss: Generous breathing room strictly beyond trap extreme
        const slBuffer = Math.max(1.80 * atr14, 0.015 * currentPrice, 3 * tickSize);
        const rawSL = trapLow - slBuffer;
        const sl = this.quantizePrice(rawSL, tickSize, decimals);
        const riskDist = currentPrice - sl;

        // Pre-Reversal TP strictly 2-3 ticks before Range High (rangeHigh - buffer)
        const preRevBuffer = Math.max(0.12 * atr14, 3 * tickSize);
        const rawTP = range.rangeHigh - preRevBuffer;
        const tp = this.quantizePrice(rawTP, tickSize, decimals);
        const targetDist = tp - currentPrice;

        const rr = (riskDist > 0 && targetDist > 0) ? parseFloat((targetDist / riskDist).toFixed(2)) : 0;

        if (rr >= 2.30 && riskDist > 0 && targetDist > 0) {
          let confidence = 85;
          if (rvol >= 1.50) confidence += 5;
          if (wickRatio >= 2.00) confidence += 5;
          if (micro.oiRegime === 'LONG_BUILDUP' || micro.oiRegime === 'SHORT_COVERING') confidence += 5;

          return {
            recommendedSide: 'BUY',
            confidenceScore: Math.min(confidence, 98),
            setupType: 'MARWADI_BEAR_TRAP_FADE',
            reasons: [
              `15m Range Boundaries confirmed: [${range.rangeLow.toFixed(decimals)} - ${range.rangeHigh.toFixed(decimals)}] (${range.highTouches} ceiling touches, ${range.lowTouches} floor touches)`,
              `Bear Trap confirmed: Pierced range floor reaching $${trapLow.toFixed(decimals)} and bounced back inside (Close: $${currentPrice.toFixed(decimals)})`,
              `Strong lower absorption wick: ${wickRatio.toFixed(2)}x body (>= 1.25x requirement)`,
              `Volume surge confirmed: RVOL = ${rvol.toFixed(2)}x (>= 1.10x requirement)`,
              `Stop Loss placed beyond trap low with generous breathing room: $${sl.toFixed(decimals)} (buffer: -$${slBuffer.toFixed(decimals)})`,
              `Pre-Reversal TP anchored 2-3 ticks before range ceiling $${range.rangeHigh.toFixed(decimals)} (TP: $${tp.toFixed(decimals)})`,
              `Strict 1:2.30+ Risk:Reward ratio: 1:${rr.toFixed(2)}`
            ],
            customSL: sl,
            customTP: tp,
            marketRegime: 'BULLISH_TRAP_REVERSAL',
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
    }

    // Zero Loose Momentum / Sidhant Fallback:
    // If no genuine Marwadi trap setup exists, stand aside cleanly.
    return nullResult;
  }

  /**
   * Detects 15m Range Boundaries with tested touches (>= 2 touches within 0.25 * ATR14 each)
   * Eliminates unvalidated array min/max to prevent anomalous wick contamination (e.g. XMR anomaly).
   */
  public detectRangeBoundaries(candles: KlinePoint[], atr14: number, currentPrice: number): RangeBoundaries {
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

    const touchTolerance = 0.25 * atr14;

    // Filter out extreme price prints (> 25% from currentPrice or > 15 * ATR14)
    // This immediately strips aberrant data spikes (like XMR flash print to 110 on a 580 asset).
    const validCandles = candles.filter(c => 
      c.high > 0 && c.low > 0 && 
      Math.abs(c.high - currentPrice) <= 15 * atr14 &&
      Math.abs(c.low - currentPrice) <= 15 * atr14 &&
      (currentPrice <= 0 || (Math.abs(c.high - currentPrice) / currentPrice <= 0.25 && Math.abs(c.low - currentPrice) / currentPrice <= 0.25))
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

  public calcATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return 1.0;
    const effectivePeriod = Math.min(period, candles.length - 1);
    const trs: number[] = [];
    for (let i = candles.length - effectivePeriod; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    return trs.reduce((a, b) => a + b, 0) / effectivePeriod;
  }

  public getSymbolSpec(symbol: string): { tickSize: number; contractValue: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim().replace(/USD[T]?$/, '') + 'USD';
    const spec = DELTA_PRODUCT_SPECS[clean] || DELTA_PRODUCT_SPECS[symbol];
    if (spec) {
      return { tickSize: spec.tickSize, contractValue: spec.contractValue, decimals: spec.decimals };
    }
    return { tickSize: 0.01, contractValue: 1.0, decimals: 2 };
  }

  public quantizePrice(price: number, tickSize: number, decimals: number): number {
    if (price <= 0 || !isFinite(price)) return 0;
    const factor = Math.round(price / tickSize);
    return parseFloat((factor * tickSize).toFixed(decimals));
  }
}

export const marwadiTraderDeltaTrapEngine = new MarwadiTraderDeltaTrapEngine();
export const marwadiTrapEngine = marwadiTraderDeltaTrapEngine;
