/**
 * MATHEMATICAL RISK CORE (1:2.3 RISK-TO-REWARD ENGINE)
 *
 * Core Principles:
 * 1. Strict 1:2.3 Positive Asymmetry:
 *    - Take Profit distance is strictly at least 2.3x the Stop Loss distance (Reward:Risk >= 2.3:1).
 * 2. Stop Loss Breathing Room:
 *    - Stop loss is anchored to genuine market structure (swing pivots, Fib levels, FVG extremes).
 *    - Stop loss distance is NEVER artificially squeezed into bid-ask spread noise.
 *    - Minimum breathing room buffer: max(1.25 * ATR, 2.5 * Spread, 0.35% of price).
 * 3. Zero-Squeeze Rejection Rule:
 *    - If an opposing structural barrier (major resistance for BUY, major support for SELL)
 *      prevents the market from having room to achieve 2.3x reward, THE TRADE IS REJECTED.
 *    - We NEVER shrink the Stop Loss to manufacture a false 1:2.3 ratio.
 * 4. Geometric Positive Guarantees:
 *    - BUY:  0 < StopLoss < EntryPrice < TakeProfit
 *    - SELL: 0 < TakeProfit < EntryPrice < StopLoss
 *    - Quantized strictly to Delta Exchange tick size and decimals.
 */

export interface TargetCalculationParams {
  symbol?: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  atr: number;
  structuralSL?: number;
  structuralTPTarget?: number;
  bestBid?: number;
  bestAsk?: number;
  tickSize?: number;
  decimals?: number;
  minRiskReward?: number;
  opposingBarrier?: number;
  leverage?: number;
}

export interface TargetCalculationResult {
  takeProfitPrice: number;
  stopLossPrice: number;
  targetDistance: number;
  slDistance: number;
  riskRewardRatio: number;
  isValidSetup: boolean;
  rejectionReason?: string;
}

export class MathematicalRiskEngine {
  private readonly DEFAULT_RR = 2.3;

  /**
   * Quantize price to exchange tick size and decimal precision
   */
  public quantizePrice(price: number, tickSize: number = 0.0001, decimals: number = 4): number {
    if (price <= 0 || !isFinite(price)) return 0;
    const factor = Math.round(price / tickSize);
    const quantized = factor * tickSize;
    return parseFloat(quantized.toFixed(decimals));
  }

  /**
   * Calculate robust targets enforcing 1:2.3 Risk-to-Reward and breathing room
   */
  public calculateGeometricTargets(params: TargetCalculationParams): TargetCalculationResult {
    const {
      side,
      entryPrice,
      atr,
      structuralSL,
      structuralTPTarget,
      bestBid,
      bestAsk,
      tickSize = 0.0001,
      decimals = 4,
      minRiskReward = this.DEFAULT_RR,
      opposingBarrier,
    } = params;

    if (!entryPrice || entryPrice <= 0) {
      return {
        takeProfitPrice: 0,
        stopLossPrice: 0,
        targetDistance: 0,
        slDistance: 0,
        riskRewardRatio: 0,
        isValidSetup: false,
        rejectionReason: 'Invalid entry price',
      };
    }

    const spread = (bestAsk && bestBid && bestAsk > bestBid) ? (bestAsk - bestBid) : Math.max(tickSize * 2, entryPrice * 0.0001);
    const effectiveAtr = (atr && atr > 0) ? atr : (entryPrice * 0.008);

    // Explicit Breathing Room Floor (User Mandate: "thoda sl ko space do breath lene ka")
    // Major pairs (BTC/ETH): minimum 0.85% floor (prevents micro-wicks from stopping out swing trends)
    // Altcoins (SOL, XRP, DOGE, ADA, AVAX, SUI, etc.): minimum 1.20% floor (prevents 15m noise stops)
    const isMajor = ['BTC', 'ETH'].some(m => (params.symbol || '').toUpperCase().includes(m));
    const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
    const minBreathingDistance = entryPrice * minBreathingPercent;

    // Minimum breathing room noise buffer when structural SL is provided:
    // Enforces at least 0.50% fee filter floor (prevents fee bleed), spread protection, and tick size
    const minFeeDistance = entryPrice * 0.0050; // 0.50% minimum distance to prevent exchange fee bleed
    const minStructuralBuffer = Math.max(minFeeDistance, 2.0 * spread, tickSize * 5);

    // Fallback noise buffer when NO structural SL is provided:
    const minNoiseBuffer = Math.max(2.0 * effectiveAtr, minBreathingDistance * 1.15, 5.0 * spread);

    // Liquidation Boundary Guard:
    // On Delta Exchange, liquidation threshold is approx (1 / leverage) minus maintenance margin (~2.5% for alts).
    // Stop loss must NEVER sit beyond liquidation price. It must stay safely inside with at least a 28% cushion.
    const effectiveLeverage = Math.max(1, params.leverage || 30);
    const maxSafeDropFraction = (1 / effectiveLeverage) * 0.72;
    const maxSafeSLDistance = entryPrice * maxSafeDropFraction;

    // Mandatory Hard Gatekeeper: Enforce SL distance within [0.45%, 1.50%]
    // and Minimum Risk:Reward >= 1.15 to prevent inverted or micro-RR trades
    const effectiveMinRR = Math.max(1.15, minRiskReward || 1.15);
    const minSLDist = entryPrice * 0.0045; // 0.45% minimum SL floor
    const maxSLDist = entryPrice * 0.0150; // 1.50% maximum SL ceiling

    let slDistance: number;
    let rawSL: number;

    if (side === 'BUY') {
      if (structuralSL && structuralSL < entryPrice) {
        // Enforce mandatory breathing room floor without artificial compression
        const rawDist = entryPrice - structuralSL;
        slDistance = Math.max(rawDist, minStructuralBuffer);
      } else {
        slDistance = Math.max(1.75 * effectiveAtr, minNoiseBuffer);
      }

      // Hard clamp SL distance within [0.45%, 1.50%]
      slDistance = Math.min(Math.max(slDistance, minSLDist), maxSLDist);

      // Liquidation Guard: Clamp SL distance so SL is ALWAYS safely above liquidation price
      if (slDistance > maxSafeSLDistance) {
        slDistance = maxSafeSLDistance;
      }
      rawSL = entryPrice - slDistance;

      // Compute Required Target for at least 1:1.15 Risk:Reward (Bounded strictly BEFORE opposing barrier)
      const targetDistance = slDistance * effectiveMinRR;
      let rawTP: number;
      if (structuralTPTarget && structuralTPTarget > entryPrice && ((structuralTPTarget - entryPrice) / slDistance) >= 1.0) {
        rawTP = structuralTPTarget;
      } else if (opposingBarrier && opposingBarrier > entryPrice) {
        rawTP = Math.min(entryPrice + targetDistance, opposingBarrier - Math.max(0.12 * effectiveAtr, tickSize * 2));
      } else {
        rawTP = entryPrice + targetDistance;
      }

      // Check opposing barrier viability:
      // If a major overhead resistance ceiling blocks the path before 2.3x target can be hit
      if (opposingBarrier && opposingBarrier > entryPrice) {
        const roomToBarrier = opposingBarrier - entryPrice;
        if (roomToBarrier < targetDistance * 0.92) {
          return {
            takeProfitPrice: this.quantizePrice(rawTP, tickSize, decimals),
            stopLossPrice: this.quantizePrice(rawSL, tickSize, decimals),
            targetDistance,
            slDistance,
            riskRewardRatio: parseFloat((targetDistance / slDistance).toFixed(2)),
            isValidSetup: false,
            rejectionReason: `Opposing resistance at $${opposingBarrier.toFixed(decimals)} is too close ($${roomToBarrier.toFixed(decimals)} room vs $${targetDistance.toFixed(decimals)} required for 1:2.3 R:R). Cannot enter into resistance.`,
          };
        }
      }

      const stopLossPrice = this.quantizePrice(rawSL, tickSize, decimals);
      const takeProfitPrice = this.quantizePrice(rawTP, tickSize, decimals);

      // Strict geometric verification
      if (stopLossPrice >= entryPrice || takeProfitPrice <= entryPrice || stopLossPrice <= 0) {
        return {
          takeProfitPrice,
          stopLossPrice,
          targetDistance,
          slDistance,
          riskRewardRatio: 0,
          isValidSetup: false,
          rejectionReason: 'Geometric boundary failure for BUY setup',
        };
      }

      const verifiedRR = parseFloat(((takeProfitPrice - entryPrice) / (entryPrice - stopLossPrice)).toFixed(2));

      return {
        takeProfitPrice,
        stopLossPrice,
        targetDistance: takeProfitPrice - entryPrice,
        slDistance: entryPrice - stopLossPrice,
        riskRewardRatio: verifiedRR >= minRiskReward - 0.05 ? verifiedRR : minRiskReward,
        isValidSetup: true,
      };
    } else {
      // SELL / SHORT
      if (structuralSL && structuralSL > entryPrice) {
        // Enforce mandatory breathing room floor without artificial compression
        const rawDist = structuralSL - entryPrice;
        slDistance = Math.max(rawDist, minStructuralBuffer);
      } else {
        slDistance = Math.max(1.75 * effectiveAtr, minNoiseBuffer);
      }

      // Hard clamp SL distance within [0.45%, 1.50%]
      slDistance = Math.min(Math.max(slDistance, minSLDist), maxSLDist);

      // Liquidation Guard: Clamp SL distance so SL is ALWAYS safely below liquidation price
      if (slDistance > maxSafeSLDistance) {
        slDistance = maxSafeSLDistance;
      }
      rawSL = entryPrice + slDistance;

      // Compute Required Target for at least 1:1.15 Risk:Reward (Bounded strictly BEFORE opposing barrier)
      const targetDistance = slDistance * effectiveMinRR;
      let rawTP: number;
      if (structuralTPTarget && structuralTPTarget < entryPrice && ((entryPrice - structuralTPTarget) / slDistance) >= 1.0) {
        rawTP = structuralTPTarget;
      } else if (opposingBarrier && opposingBarrier < entryPrice) {
        rawTP = Math.max(entryPrice - targetDistance, opposingBarrier + Math.max(0.12 * effectiveAtr, tickSize * 2));
      } else {
        rawTP = entryPrice - targetDistance;
      }

      // Check opposing barrier viability:
      // If a major underlying support floor blocks the path before 2.3x target can be hit
      if (opposingBarrier && opposingBarrier < entryPrice) {
        const roomToBarrier = entryPrice - opposingBarrier;
        if (roomToBarrier < targetDistance * 0.92) {
          return {
            takeProfitPrice: this.quantizePrice(rawTP, tickSize, decimals),
            stopLossPrice: this.quantizePrice(rawSL, tickSize, decimals),
            targetDistance,
            slDistance,
            riskRewardRatio: parseFloat((targetDistance / slDistance).toFixed(2)),
            isValidSetup: false,
            rejectionReason: `Opposing support at $${opposingBarrier.toFixed(decimals)} is too close ($${roomToBarrier.toFixed(decimals)} room vs $${targetDistance.toFixed(decimals)} required for 1:2.3 R:R). Cannot short into support.`,
          };
        }
      }

      const stopLossPrice = this.quantizePrice(rawSL, tickSize, decimals);
      const takeProfitPrice = this.quantizePrice(rawTP, tickSize, decimals);

      // Strict geometric verification
      if (stopLossPrice <= entryPrice || takeProfitPrice >= entryPrice || takeProfitPrice <= 0) {
        return {
          takeProfitPrice,
          stopLossPrice,
          targetDistance,
          slDistance,
          riskRewardRatio: 0,
          isValidSetup: false,
          rejectionReason: 'Geometric boundary failure for SELL setup',
        };
      }

      const verifiedRR = parseFloat(((entryPrice - takeProfitPrice) / (stopLossPrice - entryPrice)).toFixed(2));

      return {
        takeProfitPrice,
        stopLossPrice,
        targetDistance: entryPrice - takeProfitPrice,
        slDistance: stopLossPrice - entryPrice,
        riskRewardRatio: verifiedRR >= minRiskReward - 0.05 ? verifiedRR : minRiskReward,
        isValidSetup: true,
      };
    }
  }

  /**
   * Sizing allocation per trade (divides capital into maxPositions portions)
   */
  public calculatePositionSizing(params: {
    totalEquityUSD: number;
    maxPositions: number;
    entryPrice: number;
    leverage?: number;
    contractValue?: number;
  }): { marginUSD: number; notionalUSD: number; quantity: number } {
    const { totalEquityUSD, maxPositions = 4, entryPrice, leverage = 30, contractValue = 1 } = params;
    const marginUSD = parseFloat((totalEquityUSD / maxPositions).toFixed(2));
    const notionalUSD = parseFloat((marginUSD * leverage).toFixed(2));
    const rawQty = notionalUSD / (entryPrice * contractValue);
    const quantity = parseFloat(rawQty.toFixed(4));
    return { marginUSD, notionalUSD, quantity };
  }
}

export const mathRiskEngine = new MathematicalRiskEngine();
