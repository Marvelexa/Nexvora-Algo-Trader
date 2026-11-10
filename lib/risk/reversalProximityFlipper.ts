import { KlinePoint, DeltaPosition } from '../../src/types';

/**
 * ============================================================================
 * REVERSAL PROXIMITY POLARITY FLIPPER (ULTA EXECUTION MODULE)
 * Reference: http://www.youtube.com/watch?v=Skn0eSmryO8
 * External Range Liquidity Sweep Reversal Strategy
 * 
 * Rules:
 * 1. Detect Major Range Extremes: 15m Major_Support_Low and Major_Resistance_High (50-80 bars)
 * 2. Bottom Support Reversal (Ulta Buy):
 *    - If an engine signals SELL at bottom 15% range or within 0.40*ATR of Support,
 *      and price sweeps support without a confirmed Liquidity Run breakout:
 *      FLIP SELL -> BUY off the liquidity sweep wick with tight SL and 50% equilibrium TP!
 * 3. Top Resistance Reversal (Ulta Sell):
 *    - If an engine signals BUY at top 85-100% range or within 0.40*ATR of Resistance,
 *      and price sweeps resistance without a breakout:
 *      FLIP BUY -> SELL off the rejection wick with tight SL and 50% equilibrium TP!
 * 4. Liquidity Run Rule: Only allow continuation if a full-bodied candle closes
 *    cleanly outside the range with an overlapping FVG.
 * 5. Mid-Trade Auto-Flip: Auto-close open trades hitting opposing reversal zones
 *    and flip direction if sweep + rejection confirms.
 * ============================================================================
 */

export interface ReversalProximityVerdict {
  isFlipped: boolean;
  originalSide: 'BUY' | 'SELL';
  executedSide: 'BUY' | 'SELL';
  flipReason: string;
  isLiquidityRunBreakout: boolean;
  majorSupportLow: number;
  majorResistanceHigh: number;
  totalRange: number;
  rangePositionPct: number;
  equilibrium50: number;
  sweepWickPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  slDistance: number;
  tpDistance: number;
  actualRR: number;
  reversalTag: string;
}

export interface LiveMidTradeFlipVerdict {
  shouldCloseCurrent: boolean;
  shouldAutoReverse: boolean;
  reverseSide: 'BUY' | 'SELL' | null;
  reason: string;
  reversalSL: number;
  reversalTP: number;
}

export class ReversalProximityFlipper {
  public static readonly PROXIMITY_ATR_FACTOR = 0.40;
  public static readonly SWEEP_BUFFER_ATR = 0.20;
  public static readonly FRONT_RUN_ATR = 0.15;
  public static readonly MIN_REJECTION_WICK_RATIO = 0.35; // 35% wick of total candle range
  public static readonly MIN_FEE_FLOOR_PCT = 0.0045; // 0.45% minimum fee shield

  /**
   * EMERGENCY MANDATE: SIGNAL INVERSION IS PERMANENTLY DISABLED!
   * Each port (3002 to 3010) must execute 100% faithful to its own video rule.
   * If an engine outputs BUY, side MUST remain BUY. If SELL, side MUST remain SELL.
   * NEVER invert a strategy signal!
   */
  public static evaluateProximityFlip(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    currentPrice: number;
    atr: number;
    candles15m: KlinePoint[];
    candles5m?: KlinePoint[];
    decimals?: number;
    tickSize?: number;
  }): ReversalProximityVerdict {
    const {
      symbol,
      side: originalSide,
      currentPrice,
      atr,
      decimals = 4,
    } = params;

    let defaultSL = originalSide === 'BUY' ? currentPrice - (1.5 * atr) : currentPrice + (1.5 * atr);
    let defaultTP = originalSide === 'BUY' ? currentPrice + (2.0 * atr) : currentPrice - (2.0 * atr);
    return {
      isFlipped: false,
      originalSide,
      executedSide: originalSide,
      flipReason: 'Signal flipping permanently disabled. Direct strategy execution enforced.',
      isLiquidityRunBreakout: false,
      majorSupportLow: currentPrice - (2 * atr),
      majorResistanceHigh: currentPrice + (2 * atr),
      totalRange: 4 * atr,
      rangePositionPct: 0.50,
      equilibrium50: currentPrice,
      sweepWickPrice: currentPrice,
      stopLossPrice: parseFloat(defaultSL.toFixed(decimals)),
      tp1Price: parseFloat(defaultTP.toFixed(decimals)),
      tp2Price: parseFloat(defaultTP.toFixed(decimals)),
      slDistance: Math.abs(currentPrice - defaultSL),
      tpDistance: Math.abs(defaultTP - currentPrice),
      actualRR: 1.33,
      reversalTag: 'DIRECT_EXECUTION',
    };
  }

  public static evaluateMidTradeAutoFlip(params: {
    position: DeltaPosition;
    currentPrice: number;
    atr: number;
    candles15m: KlinePoint[];
    candles1m?: KlinePoint[];
    decimals?: number;
    minHoldSeconds?: number;
    minFeeFloorUSD?: number;
  }): LiveMidTradeFlipVerdict {
    return {
      shouldCloseCurrent: false,
      shouldAutoReverse: false,
      reverseSide: null,
      reason: 'Mid-trade reversing permanently disabled. Letting bracket SL/TP manage exits.',
      reversalSL: 0,
      reversalTP: 0,
    };
  }

  private static evaluateProximityFlipLegacy(params: any): any {
    const {
      symbol,
      side: originalSide,
      currentPrice,
      atr,
      candles15m,
      candles5m,
      decimals = 4,
      tickSize = 0.0001,
    } = params;

    const lookback = Math.min(80, (candles15m || []).length);
    const slice = (candles15m || []).slice(-lookback);

    // Default neutral verdict (no flip)
    let defaultSL = originalSide === 'BUY' ? currentPrice - (1.5 * atr) : currentPrice + (1.5 * atr);
    let defaultTP = originalSide === 'BUY' ? currentPrice + (2.0 * atr) : currentPrice - (2.0 * atr);
    const emptyVerdict: ReversalProximityVerdict = {
      isFlipped: false,
      originalSide,
      executedSide: originalSide,
      flipReason: 'Within normal internal range; executing direct strategy direction.',
      isLiquidityRunBreakout: false,
      majorSupportLow: currentPrice - (2 * atr),
      majorResistanceHigh: currentPrice + (2 * atr),
      totalRange: 4 * atr,
      rangePositionPct: 0.50,
      equilibrium50: currentPrice,
      sweepWickPrice: currentPrice,
      stopLossPrice: parseFloat(defaultSL.toFixed(decimals)),
      tp1Price: parseFloat(defaultTP.toFixed(decimals)),
      tp2Price: parseFloat(defaultTP.toFixed(decimals)),
      slDistance: Math.abs(currentPrice - defaultSL),
      tpDistance: Math.abs(defaultTP - currentPrice),
      actualRR: 1.33,
      reversalTag: 'DIRECT_EXECUTION',
    };

    if (!slice || slice.length < 20) {
      return emptyVerdict;
    }

    // 1. Map Major External Range Liquidity Extremes from Historical Candles
    // Exclude the last 2 candles (current live candle & immediate testing bar) so the breakout/sweep
    // is measured against the established range boundaries.
    let majorSupportLow = Infinity;
    let majorResistanceHigh = -Infinity;
    const historyEndIdx = Math.max(1, slice.length - 2);
    for (let i = 0; i < historyEndIdx; i++) {
      const c = slice[i];
      if (c.low < majorSupportLow) majorSupportLow = c.low;
      if (c.high > majorResistanceHigh) majorResistanceHigh = c.high;
    }

    const totalRange = majorResistanceHigh - majorSupportLow;
    if (totalRange <= 0) return emptyVerdict;

    const rangePositionPct = (currentPrice - majorSupportLow) / totalRange;
    const equilibrium50 = parseFloat((majorSupportLow + (totalRange * 0.50)).toFixed(decimals));

    const curCandle = slice[slice.length - 1];
    const prevCandle = slice.length >= 2 ? slice[slice.length - 2] : curCandle;
    const curSpan = Math.max(curCandle.high - curCandle.low, curCandle.close * 0.0005);
    const curLowerWick = Math.min(curCandle.open, curCandle.close) - curCandle.low;
    const curUpperWick = curCandle.high - Math.max(curCandle.open, curCandle.close);
    const lowerWickRatio = curLowerWick / curSpan;
    const upperWickRatio = curUpperWick / curSpan;

    // ------------------------------------------------------------------------
    // CASE A: BOTTOM SUPPORT REVERSAL (FLIP SELL -> BUY)
    // ------------------------------------------------------------------------
    const distToSupport = currentPrice - majorSupportLow;
    const isAtBottomSupport = rangePositionPct <= 0.15 || distToSupport <= (this.PROXIMITY_ATR_FACTOR * atr);

    if (isAtBottomSupport) {
      // RULE 3: Liquidity Run Continuation Check
      // Only permit Short if strong full-bodied candle closed cleanly below support with an FVG
      const prevSpan = Math.max(prevCandle.high - prevCandle.low, prevCandle.close * 0.0005);
      const hasBreakoutClose = (
        (curCandle.close < majorSupportLow * 0.998 && Math.abs(curCandle.close - curCandle.open) >= 0.40 * curSpan) ||
        (prevCandle.close < majorSupportLow * 0.998 && Math.abs(prevCandle.close - prevCandle.open) >= 0.40 * prevSpan)
      );
      const hasDropFVG = slice.length >= 3 && (
        slice[slice.length - 3].low > curCandle.high ||
        (slice.length >= 4 && slice[slice.length - 4].low > prevCandle.high)
      );
      const isConfirmedLiquidityRun = hasBreakoutClose && hasDropFVG;

      if (isConfirmedLiquidityRun) {
        return {
          ...emptyVerdict,
          isLiquidityRunBreakout: true,
          majorSupportLow,
          majorResistanceHigh,
          totalRange,
          rangePositionPct,
          equilibrium50,
          flipReason: `Confirmed Liquidity Run below $${majorSupportLow.toFixed(decimals)} with FVG. Short continuation approved.`,
        };
      }

      // Sweep & Rejection Check (Video Rule [00:08:19]):
      // Price tapped/swept into support, but failed to break down with displacement
      const sweptSupport = curCandle.low <= (majorSupportLow * 1.002) || prevCandle.low <= (majorSupportLow * 1.002);
      // BAN BLIND TOUCHES: Require genuine lower wick rejection (>=35%) OR confirmed green candle close (Close > Open)
      const hasBullishRejection = (lowerWickRatio >= this.MIN_REJECTION_WICK_RATIO) || (curCandle.close > curCandle.open);

      if ((sweptSupport || isAtBottomSupport) && hasBullishRejection) {
        // FLIP TO BUY / LONG!
        const isFlipped = originalSide === 'SELL';
        const lowestSweepWick = Math.min(curCandle.low, prevCandle.low, majorSupportLow);
        const buffer = Math.max(this.SWEEP_BUFFER_ATR * atr, 2 * tickSize);
        let rawSL = lowestSweepWick - buffer;
        const minSLDistance = currentPrice * this.MIN_FEE_FLOOR_PCT;
        const actualSLDistance = Math.max(currentPrice - rawSL, minSLDistance);
        const stopLossPrice = parseFloat((currentPrice - actualSLDistance).toFixed(decimals));

        // High R:R Targets: TP1 at 50% equilibrium, TP2 at upper swing body
        const frontRunBuffer = Math.max(this.FRONT_RUN_ATR * atr, 2 * tickSize);
        const tp1Price = equilibrium50;
        const tp2Price = parseFloat((majorResistanceHigh - frontRunBuffer).toFixed(decimals));

        const slDistance = currentPrice - stopLossPrice;
        const tpDistance = Math.abs(tp1Price - currentPrice);
        const actualRR = parseFloat((tpDistance / Math.max(slDistance, 0.0001)).toFixed(2));

        return {
          isFlipped,
          originalSide,
          executedSide: 'BUY',
          flipReason: isFlipped
            ? `REVERSAL PROXIMITY FLIP (Video [00:08:19]): Price at bottom Support ($${majorSupportLow.toFixed(decimals)}, ${(rangePositionPct * 100).toFixed(1)}% of range). Swept support liquidity with lower wick (${(lowerWickRatio * 100).toFixed(0)}%). Inverted SELL -> BUY with tight sweep SL.`
            : `SUPPORT LIQUIDITY BOUNCE (Video [00:08:19]): Price at bottom Support ($${majorSupportLow.toFixed(decimals)}). Confirmed bullish rejection (lower wick ${(lowerWickRatio * 100).toFixed(0)}%). Executing BUY with tight sweep SL.`,
          isLiquidityRunBreakout: false,
          majorSupportLow,
          majorResistanceHigh,
          totalRange,
          rangePositionPct,
          equilibrium50,
          sweepWickPrice: lowestSweepWick,
          stopLossPrice,
          tp1Price,
          tp2Price,
          slDistance,
          tpDistance,
          actualRR: Math.max(actualRR, 1.15),
          reversalTag: isFlipped ? 'ULTA_SUPPORT_SWEEP_BUY' : 'DIRECT_SUPPORT_BOUNCE_BUY',
        };
      }
    }

    // ------------------------------------------------------------------------
    // CASE B: TOP RESISTANCE REVERSAL (FLIP BUY -> SELL)
    // ------------------------------------------------------------------------
    const distToResistance = majorResistanceHigh - currentPrice;
    const isAtTopResistance = rangePositionPct >= 0.85 || distToResistance <= (this.PROXIMITY_ATR_FACTOR * atr);

    if (isAtTopResistance) {
      // RULE 3: Liquidity Run Continuation Check
      const prevSpan = Math.max(prevCandle.high - prevCandle.low, prevCandle.close * 0.0005);
      const hasBreakoutClose = (
        (curCandle.close > majorResistanceHigh * 1.002 && Math.abs(curCandle.close - curCandle.open) >= 0.40 * curSpan) ||
        (prevCandle.close > majorResistanceHigh * 1.002 && Math.abs(prevCandle.close - prevCandle.open) >= 0.40 * prevSpan)
      );
      const hasRallyFVG = slice.length >= 3 && (
        curCandle.low > slice[slice.length - 3].high ||
        (slice.length >= 4 && prevCandle.low > slice[slice.length - 4].high)
      );
      const isConfirmedLiquidityRun = hasBreakoutClose && hasRallyFVG;

      if (isConfirmedLiquidityRun) {
        return {
          ...emptyVerdict,
          isLiquidityRunBreakout: true,
          majorSupportLow,
          majorResistanceHigh,
          totalRange,
          rangePositionPct,
          equilibrium50,
          flipReason: `Confirmed Liquidity Run above $${majorResistanceHigh.toFixed(decimals)} with FVG. Long breakout approved.`,
        };
      }

      // Sweep & Rejection Check:
      // Price tapped/swept into resistance, but failed to displace higher
      const sweptResistance = curCandle.high >= (majorResistanceHigh * 0.998) || prevCandle.high >= (majorResistanceHigh * 0.998);
      // BAN BLIND TOUCHES: Require genuine upper wick rejection (>=35%) OR confirmed red candle close (Close < Open)
      const hasBearishRejection = (upperWickRatio >= this.MIN_REJECTION_WICK_RATIO) || (curCandle.close < curCandle.open);

      if ((sweptResistance || isAtTopResistance) && hasBearishRejection) {
        // FLIP TO SELL / SHORT!
        const isFlipped = originalSide === 'BUY';
        const highestSweepWick = Math.max(curCandle.high, prevCandle.high, majorResistanceHigh);
        const buffer = Math.max(this.SWEEP_BUFFER_ATR * atr, 2 * tickSize);
        let rawSL = highestSweepWick + buffer;
        const minSLDistance = currentPrice * this.MIN_FEE_FLOOR_PCT;
        const actualSLDistance = Math.max(rawSL - currentPrice, minSLDistance);
        const stopLossPrice = parseFloat((currentPrice + actualSLDistance).toFixed(decimals));

        // High R:R Targets: TP1 at 50% equilibrium, TP2 at lower swing body
        const frontRunBuffer = Math.max(this.FRONT_RUN_ATR * atr, 2 * tickSize);
        const tp1Price = equilibrium50;
        const tp2Price = parseFloat((majorSupportLow + frontRunBuffer).toFixed(decimals));

        const slDistance = stopLossPrice - currentPrice;
        const tpDistance = Math.abs(currentPrice - tp1Price);
        const actualRR = parseFloat((tpDistance / Math.max(slDistance, 0.0001)).toFixed(2));

        return {
          isFlipped,
          originalSide,
          executedSide: 'SELL',
          flipReason: isFlipped
            ? `REVERSAL PROXIMITY FLIP (Video [00:07:18]): Price at top Resistance ($${majorResistanceHigh.toFixed(decimals)}, ${(rangePositionPct * 100).toFixed(1)}% of range). Swept resistance liquidity with upper wick (${(upperWickRatio * 100).toFixed(0)}%). Inverted BUY -> SELL with tight sweep SL.`
            : `RESISTANCE LIQUIDITY FADE (Video [00:07:18]): Price at top Resistance ($${majorResistanceHigh.toFixed(decimals)}). Confirmed bearish rejection (upper wick ${(upperWickRatio * 100).toFixed(0)}%). Executing SELL with tight sweep SL.`,
          isLiquidityRunBreakout: false,
          majorSupportLow,
          majorResistanceHigh,
          totalRange,
          rangePositionPct,
          equilibrium50,
          sweepWickPrice: highestSweepWick,
          stopLossPrice,
          tp1Price,
          tp2Price,
          slDistance,
          tpDistance,
          actualRR: Math.max(actualRR, 1.15),
          reversalTag: isFlipped ? 'ULTA_RESISTANCE_SWEEP_SELL' : 'DIRECT_RESISTANCE_FADE_SELL',
        };
      }
    }

    return {
      ...emptyVerdict,
      majorSupportLow,
      majorResistanceHigh,
      totalRange,
      rangePositionPct,
      equilibrium50,
    };
  }

}

export const reversalProximityFlipper = new ReversalProximityFlipper();
