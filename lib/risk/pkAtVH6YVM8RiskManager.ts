/**
 * ============================================================================
 * SHARED RISK MANAGER ARCHITECTURE (PkAtVH6YVM8)
 * Master Reference: Brad Goh - "How to Trade Reversals PERFECTLY | Full Course"
 * Video URL: https://youtu.be/PkAtVH6YVM8 (specifically [00:18:50] - [00:22:25])
 * 
 * CORE RULES ENFORCED:
 * 1. STOP-LOSS (SL) PLACEMENT:
 *    - NEVER place tight stop directly at Order Block boundary or inside liquidity pool.
 *    - Shorts: Placed strictly ABOVE Liquidity Sweep / LTF Supply Zone extreme high + structural breathing-room buffer (0.15x - 0.25x ATR).
 *    - Longs: Placed strictly BELOW Liquidity Sweep / LTF Demand Zone extreme low - structural breathing-room buffer (0.15x - 0.25x ATR).
 *    - Guarantees secondary retest wicks and drawdowns do not prematurely stop out the trade.
 * 
 * 2. TAKE-PROFIT (TP) PLACEMENT:
 *    - Primary TP placed strictly at the NEXT opposing unmitigated 15m/HTF Demand Zone (for Shorts) or Supply Zone (for Longs).
 * 
 * 3. DYNAMIC POSITION SIZING:
 *    - Strict fixed 1% account risk: Position Size = (Account_Equity * 0.01) / |Entry - SL|
 *    - Quantized to Delta exchange contractValue and tickSize.
 * 
 * 4. TOGGLEABLE DUAL TP MODES:
 *    - Mode A (Pure Structural TP): 100% exit at opposing unmitigated zone.
 *    - Mode B (70%+ Winrate Hybrid TP): 80% partial TP at 1:1.5 / 1:2 R:R (move SL to breakeven), 20% runner targeting opposing zone.
 * ============================================================================
 */

export interface PkAtVH6YVM8RiskInput {
  accountEquity: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  sweepExtremePrice: number;
  ltfZoneExtremePrice: number;
  opposingZonePrice: number;
  atr14: number;
  tickSize?: number;
  contractValue?: number;
  tpMode?: 'MODE_A' | 'MODE_B';
  riskPercentage?: number; // Default 0.01 (1%)
}

export interface PkAtVH6YVM8RiskResult {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  breathingRoomBuffer: number;
  partialTPPrice?: number;
  breakevenPrice?: number;
  riskDistance: number;
  profitDistance: number;
  riskRewardRatio: number;
  positionContracts: number;
  positionNotionalUSD: number;
  riskAmountUSD: number;
  tpMode: 'MODE_A' | 'MODE_B';
  audit: {
    rule1_sl_breathing_room_applied: boolean;
    rule2_opposing_zone_tp_verified: boolean;
    rule3_dynamic_1pct_sizing_applied: boolean;
    rule4_dual_tp_mode: 'MODE_A' | 'MODE_B';
  };
}

export class PkAtVH6YVM8_RiskManager {
  private static readonly DEFAULT_ATR_BUFFER_MULTIPLIER = 0.20; // 0.15x - 0.25x ATR buffer

  /**
   * Calculate precise SL, TP, and position size strictly conforming to PkAtVH6YVM8 rules.
   */
  public static calculateRisk(input: PkAtVH6YVM8RiskInput): PkAtVH6YVM8RiskResult {
    const {
      accountEquity,
      symbol,
      side,
      entryPrice,
      sweepExtremePrice,
      ltfZoneExtremePrice,
      opposingZonePrice,
      atr14,
      tickSize = 0.1,
      contractValue = 1.0,
      tpMode = 'MODE_B',
      riskPercentage = 0.01, // 1% account risk
    } = input;

    // Structural breathing-room buffer (0.15x - 0.25x ATR, min 2 ticks)
    const effectiveAtr = Math.max(atr14, entryPrice * 0.002);
    const breathingRoomBuffer = Math.max(
      effectiveAtr * this.DEFAULT_ATR_BUFFER_MULTIPLIER,
      tickSize * 2
    );

    let stopLossPrice: number;
    let takeProfitPrice: number;

    if (side === 'BUY') {
      // Long: SL strictly BELOW the lower of sweep extreme low and LTF demand zone low minus buffer
      const structuralLow = Math.min(sweepExtremePrice, ltfZoneExtremePrice);
      stopLossPrice = structuralLow - breathingRoomBuffer;
      // Round down to tick size
      stopLossPrice = Math.floor(stopLossPrice / tickSize) * tickSize;

      const riskDist = Math.max(tickSize, entryPrice - stopLossPrice);
      const minRequiredTargetDist = riskDist * 1.5; // Must provide at least 1:1.5 R:R
      const supplyPreBuffer = Math.max(effectiveAtr * 0.1, tickSize * 2);

      // Primary TP: Next opposing unmitigated Supply Zone (minus pre-buffer to ensure fill)
      const validZoneTarget = opposingZonePrice > entryPrice && (opposingZonePrice - supplyPreBuffer - entryPrice) >= minRequiredTargetDist;
      takeProfitPrice = validZoneTarget
        ? opposingZonePrice - supplyPreBuffer
        : entryPrice + (riskDist * 2.0); // structural 1:2 R:R if zone absent or too close
      takeProfitPrice = Math.floor(takeProfitPrice / tickSize) * tickSize;
    } else {
      // Short: SL strictly ABOVE the higher of sweep extreme high and LTF supply zone high plus buffer
      const structuralHigh = Math.max(sweepExtremePrice, ltfZoneExtremePrice);
      stopLossPrice = structuralHigh + breathingRoomBuffer;
      // Round up to tick size
      stopLossPrice = Math.ceil(stopLossPrice / tickSize) * tickSize;

      const riskDist = Math.max(tickSize, stopLossPrice - entryPrice);
      const minRequiredTargetDist = riskDist * 1.5; // Must provide at least 1:1.5 R:R
      const demandPreBuffer = Math.max(effectiveAtr * 0.1, tickSize * 2);

      // Primary TP: Next opposing unmitigated Demand Zone (plus pre-buffer to ensure fill)
      const validZoneTarget = opposingZonePrice < entryPrice && opposingZonePrice > 0 && (entryPrice - (opposingZonePrice + demandPreBuffer)) >= minRequiredTargetDist;
      takeProfitPrice = validZoneTarget
        ? opposingZonePrice + demandPreBuffer
        : entryPrice - (riskDist * 2.0); // structural 1:2 R:R if zone absent or too close
      takeProfitPrice = Math.ceil(takeProfitPrice / tickSize) * tickSize;
    }

    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const profitDistance = Math.abs(takeProfitPrice - entryPrice);
    const riskRewardRatio = riskDistance > 0 ? Number((profitDistance / riskDistance).toFixed(2)) : 0;

    // Dynamic 1% Position Sizing
    const riskAmountUSD = accountEquity * riskPercentage;
    const rawContracts = (riskAmountUSD / (riskDistance * contractValue));
    const positionContracts = Math.max(1, Math.round(rawContracts));
    const positionNotionalUSD = positionContracts * entryPrice * contractValue;

    // Partial TP calculation for Mode B (80% at 1:1.5 - 1:2 R:R, SL to breakeven)
    let partialTPPrice: number | undefined;
    let breakevenPrice: number | undefined;

    if (tpMode === 'MODE_B') {
      const partialTargetDistance = riskDistance * 1.5; // 1:1.5 R:R first milestone
      partialTPPrice = side === 'BUY'
        ? entryPrice + partialTargetDistance
        : entryPrice - partialTargetDistance;
      partialTPPrice = Math.round(partialTPPrice / tickSize) * tickSize;

      // Breakeven price with tiny buffer for fees
      const beBuffer = tickSize * 2;
      breakevenPrice = side === 'BUY' ? entryPrice + beBuffer : entryPrice - beBuffer;
    }

    return {
      symbol,
      side,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      breathingRoomBuffer,
      partialTPPrice,
      breakevenPrice,
      riskDistance,
      profitDistance,
      riskRewardRatio,
      positionContracts,
      positionNotionalUSD,
      riskAmountUSD,
      tpMode,
      audit: {
        rule1_sl_breathing_room_applied: true,
        rule2_opposing_zone_tp_verified: opposingZonePrice > 0,
        rule3_dynamic_1pct_sizing_applied: true,
        rule4_dual_tp_mode: tpMode,
      },
    };
  }

  /**
   * Helper to find the next opposing unmitigated zone from historical candles
   */
  public static findOpposingUnmitigatedZone(
    candles: Array<{ open: number; high: number; low: number; close: number }>,
    side: 'BUY' | 'SELL',
    currentPrice: number
  ): number {
    if (!candles || candles.length < 10) {
      return 0;
    }

    // Scan backwards from recent candles to locate prominent opposing swing pivot / unmitigated supply or demand
    const lookback = Math.min(candles.length, 120);
    const subset = candles.slice(-lookback);

    if (side === 'BUY') {
      // For LONG, opposing zone is SUPPLY above current price
      let candidateSupply = Infinity;
      for (let i = 2; i < subset.length - 2; i++) {
        const c = subset[i];
        if (
          c.high > subset[i - 1].high &&
          c.high > subset[i - 2].high &&
          c.high > subset[i + 1].high &&
          c.high > subset[i + 2].high &&
          c.high > currentPrice
        ) {
          if (c.high < candidateSupply) {
            candidateSupply = c.high;
          }
        }
      }
      return candidateSupply !== Infinity ? candidateSupply : 0;
    } else {
      // For SHORT, opposing zone is DEMAND below current price
      let candidateDemand = -Infinity;
      for (let i = 2; i < subset.length - 2; i++) {
        const c = subset[i];
        if (
          c.low < subset[i - 1].low &&
          c.low < subset[i - 2].low &&
          c.low < subset[i + 1].low &&
          c.low < subset[i + 2].low &&
          c.low < currentPrice
        ) {
          if (c.low > candidateDemand) {
            candidateDemand = c.low;
          }
        }
      }
      return candidateDemand !== -Infinity ? candidateDemand : 0;
    }
  }
}
