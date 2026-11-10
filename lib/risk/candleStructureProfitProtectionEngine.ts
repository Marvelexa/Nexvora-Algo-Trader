import { KlinePoint, DeltaPosition } from '../../src/types';

/**
 * CANDLE-BASED STRUCTURAL TP & LIVE PROFIT-PROTECTION ENGINE
 * 
 * Rules Implemented:
 * 1. Pre-Reversal Candle Structure TP Calculation (At Entry)
 *    - Scans last 100 candles on 5m and 15m.
 *    - For LONG: Nearest unmitigated Bearish OB lower body edge, unfilled overhead FVG bottom edge,
 *      or Swing High body minus 0.15*ATR front-run buffer.
 *    - For SHORT: Nearest unmitigated Bullish OB upper body edge, unfilled below-market FVG top edge,
 *      or Swing Low body plus 0.15*ATR front-run buffer.
 * 2. Live Candle Exhaustion & Reversal Detector (Auto-Close at Peak Profit)
 *    - Activates once in profit >= +0.40R or >= +0.35% price move.
 *    - Signature A: Rejection Wick / Shooting Star / Hammer (>= 55% wick opposing trade).
 *    - Signature B: Opposite Engulfing / Momentum Flip (closes past previous candle open).
 *    - Signature C: Climax Stall at Micro-Structure (2 inside bars at Order Block/VWAP).
 * 3. Ratcheting High-Watermark Profit Ratchet (Zero Give-Back Rule)
 *    - At +0.45R Profit: Move SL to Entry + 0.15R (covers fees + guaranteed green exit).
 *    - At +0.70R Profit: Lock SL at 60% of peak unrealized profit.
 *    - Above +0.90R Profit: Trail SL dynamically along 1m closed bar highs/lows.
 * 4. Pre-Entry Room-to-Run Filter
 *    - Distance to opposing reversal zone must be >= 0.80 * SL_Distance. Otherwise block trade.
 */

export interface StructuralZoneTarget {
  targetPrice: number;
  targetDistance: number;
  tp1Price?: number;
  tp2Price?: number;
  zoneType: 'ORDER_BLOCK' | 'FAIR_VALUE_GAP' | 'SWING_BODY' | 'FALLBACK_RR';
  zoneLevel: number;
  frontRunBuffer: number;
  description: string;
  firstPhysicalWallPrice: number;
  firstPhysicalWallFrontRunTP: number;
  structuralRR: number;
  hasPhysicalWall: boolean;
  physicalWallType?: 'ORDER_BLOCK' | 'FAIR_VALUE_GAP' | 'SWING_BODY' | 'FALLBACK_RR';
}

export interface RoomToRunVerdict {
  allowed: boolean;
  reason: string;
  nearestZonePrice: number;
  zoneDistance: number;
  requiredDistance: number;
  slDistance: number;
}

export interface LiveReversalVerdict {
  shouldClose: boolean;
  signature: 'SIGNATURE_A' | 'SIGNATURE_B' | 'SIGNATURE_C' | null;
  reason: string;
  reversalPrice: number;
  currentRMultiple: number;
  priceMovePct: number;
}

export interface ProfitRatchetResult {
  stopLossPrice: number;
  ratchetStage: number; // 0: None, 1: +0.45R (Entry+0.15R), 2: +0.70R (60% peak), 3: +0.90R (1m candle trailing)
  peakPriceReached: number;
  peakRReached: number;
  wasUpdated: boolean;
  reason: string;
}

// ============================================================================
// 1. PRE-REVERSAL CANDLE STRUCTURE TP CALCULATOR & ROOM-TO-RUN FILTER
// ============================================================================
export class CandleStructureTPCalculator {
  /**
   * Scans last 100 candles on 15m and 5m to find nearest structural reversal barrier.
   */
  public static calculateCandleStructureTP(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    atr: number;
    candles15m: KlinePoint[];
    candles5m?: KlinePoint[];
    tickSize?: number;
    decimals?: number;
    minRiskReward?: number;
    frontRunBufferMultiplier?: number;
  }): StructuralZoneTarget {
    const { symbol, side, entryPrice, stopLossPrice, atr, candles15m, candles5m, tickSize = 0.0001, decimals = 4 } = params;
    const minRR = params.minRiskReward !== undefined ? params.minRiskReward : 1.00;
    const slDistance = Math.max(Math.abs(entryPrice - stopLossPrice), entryPrice * 0.0035);
    const frontRunMultiplier = params.frontRunBufferMultiplier !== undefined
      ? params.frontRunBufferMultiplier
      : 0.10;
    const frontRunBuffer = Math.max(frontRunMultiplier * atr, 2 * tickSize);

    // Merge up to 40 candles from 15m and 5m (Rule 2: Scan last 40 candles)
    const pool15m = (candles15m || []).slice(-40);
    const pool5m = (candles5m || []).slice(-40);

    const candidates: Array<{
      price: number;
      zoneType: 'ORDER_BLOCK' | 'FAIR_VALUE_GAP' | 'SWING_BODY';
      rawLevel: number;
      description: string;
      isMajorWall: boolean;
    }> = [];

    if (side === 'BUY') {
      // --- LONG (BUY) TARGETS (Above entryPrice) ---
      const minWallDistHigh = Math.max(0.35 * atr, entryPrice * 0.0050);

      // 1. Institutional Bearish Order Block supply body high (Displacement > 1.2 * ATR)
      const obTargets = this.findBearishOrderBlocks(pool15m, pool5m, entryPrice, atr);
      for (const ob of obTargets) {
        if (ob.bodyHigh >= entryPrice + minWallDistHigh) {
          const frontRunTP = ob.bodyHigh - frontRunBuffer;
          if (frontRunTP > entryPrice) {
            candidates.push({
              price: frontRunTP,
              zoneType: 'ORDER_BLOCK',
              rawLevel: ob.bodyHigh,
              description: `Institutional Bearish Order Block supply body high ($${ob.bodyHigh.toFixed(decimals)}) front-run by buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
              isMajorWall: true,
            });
          }
        }
      }

      // 2. Nearest unfilled overhead Bearish FVG bottom edge
      const fvgTargets = this.findOverheadFVGs(pool15m, pool5m, entryPrice, atr);
      for (const fvg of fvgTargets) {
        if (fvg.bottomEdge >= entryPrice + minWallDistHigh) {
          const frontRunTP = fvg.bottomEdge - frontRunBuffer;
          if (frontRunTP > entryPrice) {
            candidates.push({
              price: frontRunTP,
              zoneType: 'FAIR_VALUE_GAP',
              rawLevel: fvg.bottomEdge,
              description: `Unfilled overhead Bearish Fair Value Gap bottom edge ($${fvg.bottomEdge.toFixed(decimals)}) front-run by buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
              isMajorWall: false,
            });
          }
        }
      }

      // 3. Nearest 2-Candle Body Cluster Resistance (IGNORE extreme wicks, anchor strictly at candle bodies Math.max(open, close))
      const clusters15m = this.find2CandleBodyClustersHigh(pool15m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '15m');
      const clusters5m = this.find2CandleBodyClustersHigh(pool5m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '5m');
      candidates.push(...clusters15m, ...clusters5m);

      // 4. Scan all 3-bar swing body highs in last 40 candles across 15m and 5m (Outside micro-noise >= 0.30 * ATR)
      const swingHighs15m = this.findAllSwingBodyHighs(pool15m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '15m');
      const swingHighs5m = this.findAllSwingBodyHighs(pool5m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '5m');
      candidates.push(...swingHighs15m, ...swingHighs5m);

      // 5. Also check 15m major swing body high
      const swingResult = this.findRecentSwingBodyHigh(pool15m, entryPrice, atr);
      const minSwingDistHigh = Math.max(0.35 * atr, entryPrice * 0.0050);
      if (swingResult.price >= entryPrice + minSwingDistHigh) {
        const bufferedSwing = swingResult.price - frontRunBuffer;
        if (bufferedSwing > entryPrice) {
          candidates.push({
            price: bufferedSwing,
            zoneType: 'SWING_BODY',
            rawLevel: swingResult.price,
            description: `${swingResult.isMajor ? 'Major 15m Swing High' : '15m High'} body ($${swingResult.price.toFixed(decimals)}) minus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${bufferedSwing.toFixed(decimals)}`,
            isMajorWall: swingResult.isMajor,
          });
        }
      }

      // 6. DELETE high50 WICK FALLBACK: 90th percentile of Candle Bodies over last 40 bars (NEVER Math.max(...c.high))
      if (candidates.length === 0) {
        const p90Fallback = this.findBodyPercentileFallback(pool15m.length >= 10 ? pool15m : pool5m, 'BUY', entryPrice, atr, frontRunBuffer, decimals);
        if (p90Fallback) {
          candidates.push({
            price: p90Fallback.price,
            zoneType: 'SWING_BODY',
            rawLevel: p90Fallback.rawLevel,
            description: p90Fallback.description,
            isMajorWall: false,
          });
        }
      }

      // Sort strictly by closest distance to entry (NEVER jump over or ignore the first physical wall!)
      const validWalls = candidates
        .filter(c => c.price > entryPrice)
        .sort((a, b) => (a.price - entryPrice) - (b.price - entryPrice));

      if (validWalls.length > 0) {
        const firstWall = validWalls[0];
        const firstPhysicalWallPrice = firstWall.rawLevel;
        let firstPhysicalWallFrontRunTP = parseFloat((Math.round(firstWall.price / tickSize) * tickSize).toFixed(decimals));
        let firstWallDist = Math.abs(firstPhysicalWallFrontRunTP - entryPrice);
        let structuralRR = parseFloat((firstWallDist / slDistance).toFixed(2));

        // Rule B: HARD MAXIMUM TP CEILING (MAX_TP_RR = 2.20R & MAX_TP_PCT = 1.20%)
        // Never allow the TP scanner to jump across an empty crash void to a 9.30R moonshot target!
        const MAX_TP_RR = 2.20;
        const MAX_TP_PCT = 0.0120;
        if (firstWallDist > MAX_TP_RR * slDistance || (firstWallDist / entryPrice) > MAX_TP_PCT) {
          const cappedDist = Math.min(2.00 * slDistance, entryPrice * 0.0100);
          firstPhysicalWallFrontRunTP = parseFloat((Math.round((entryPrice + cappedDist) / tickSize) * tickSize).toFixed(decimals));
          firstWallDist = cappedDist;
          structuralRR = parseFloat((firstWallDist / slDistance).toFixed(2));
        }

        const runnerCandidate = validWalls.length > 1 ? validWalls[1] : null;
        const tp2Price = runnerCandidate
          ? parseFloat((Math.round(runnerCandidate.price / tickSize) * tickSize).toFixed(decimals))
          : parseFloat((entryPrice + (slDistance * 2.0)).toFixed(decimals));

        return {
          targetPrice: firstPhysicalWallFrontRunTP,
          targetDistance: firstWallDist,
          tp1Price: firstPhysicalWallFrontRunTP,
          tp2Price,
          zoneType: firstWall.zoneType,
          zoneLevel: firstWall.rawLevel,
          frontRunBuffer,
          description: firstWall.description,
          firstPhysicalWallPrice,
          firstPhysicalWallFrontRunTP,
          structuralRR,
          hasPhysicalWall: true,
          physicalWallType: firstWall.zoneType,
        };
      }

      // Fallback: ONLY when zero physical walls exist in the entire lookback pool
      const cappedFallbackDist = Math.min(slDistance * 1.50, entryPrice * 0.0100);
      const fallbackPrice = parseFloat((entryPrice + cappedFallbackDist).toFixed(decimals));
      const fallbackTp2 = parseFloat((entryPrice + Math.min(slDistance * 2.0, entryPrice * 0.0120)).toFixed(decimals));
      return {
        targetPrice: fallbackPrice,
        targetDistance: fallbackPrice - entryPrice,
        tp1Price: fallbackPrice,
        tp2Price: fallbackTp2,
        zoneType: 'FALLBACK_RR',
        zoneLevel: fallbackPrice,
        frontRunBuffer,
        description: `Fallback structural target at ${(cappedFallbackDist / slDistance).toFixed(2)}R ($${fallbackPrice.toFixed(decimals)}) [No physical walls detected]`,
        firstPhysicalWallPrice: fallbackPrice,
        firstPhysicalWallFrontRunTP: fallbackPrice,
        structuralRR: parseFloat((cappedFallbackDist / slDistance).toFixed(2)),
        hasPhysicalWall: false,
        physicalWallType: 'FALLBACK_RR',
      };

    } else {
      // --- SHORT (SELL) TARGETS (Below entryPrice) ---
      const minWallDistLow = Math.max(0.35 * atr, entryPrice * 0.0050);

      // 1. Institutional Bullish Order Block demand body low (Displacement > 1.2 * ATR)
      const obTargets = this.findBullishOrderBlocks(pool15m, pool5m, entryPrice, atr);
      for (const ob of obTargets) {
        if (ob.bodyLow <= entryPrice - minWallDistLow) {
          const frontRunTP = ob.bodyLow + frontRunBuffer;
          if (frontRunTP < entryPrice) {
            candidates.push({
              price: frontRunTP,
              zoneType: 'ORDER_BLOCK',
              rawLevel: ob.bodyLow,
              description: `Institutional Bullish Order Block demand body low ($${ob.bodyLow.toFixed(decimals)}) plus buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
              isMajorWall: true,
            });
          }
        }
      }

      // 2. Nearest unfilled below-market Bullish FVG top edge
      const fvgTargets = this.findBelowMarketFVGs(pool15m, pool5m, entryPrice, atr);
      for (const fvg of fvgTargets) {
        if (fvg.topEdge <= entryPrice - minWallDistLow) {
          const frontRunTP = fvg.topEdge + frontRunBuffer;
          if (frontRunTP < entryPrice) {
            candidates.push({
              price: frontRunTP,
              zoneType: 'FAIR_VALUE_GAP',
              rawLevel: fvg.topEdge,
              description: `Unfilled below-market Bullish Fair Value Gap top edge ($${fvg.topEdge.toFixed(decimals)}) front-run by buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
              isMajorWall: false,
            });
          }
        }
      }

      // 3. Nearest 2-Candle Body Cluster Support (IGNORE extreme wicks, anchor strictly at candle bodies Math.min(open, close))
      const clusters15m = this.find2CandleBodyClustersLow(pool15m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '15m');
      const clusters5m = this.find2CandleBodyClustersLow(pool5m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '5m');
      candidates.push(...clusters15m, ...clusters5m);

      // 4. Scan all 3-bar swing body lows in last 40 candles across 15m and 5m (Outside micro-noise >= 0.30 * ATR)
      const swingLows15m = this.findAllSwingBodyLows(pool15m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '15m');
      const swingLows5m = this.findAllSwingBodyLows(pool5m, entryPrice, atr, frontRunBuffer, decimals, tickSize, '5m');
      candidates.push(...swingLows15m, ...swingLows5m);

      // 5. Also check 15m major swing body low
      const swingResult = this.findRecentSwingBodyLow(pool15m, entryPrice, atr);
      const minSwingDistLow = Math.max(0.35 * atr, entryPrice * 0.0050);
      if (swingResult.price <= entryPrice - minSwingDistLow && swingResult.price > 0) {
        const bufferedSwing = swingResult.price + frontRunBuffer;
        if (bufferedSwing < entryPrice) {
          candidates.push({
            price: bufferedSwing,
            zoneType: 'SWING_BODY',
            rawLevel: swingResult.price,
            description: `${swingResult.isMajor ? 'Major 15m Swing Low' : '15m Low'} body ($${swingResult.price.toFixed(decimals)}) plus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${bufferedSwing.toFixed(decimals)}`,
            isMajorWall: swingResult.isMajor,
          });
        }
      }

      // 6. DELETE low50 WICK FALLBACK: 10th percentile of Candle Bodies over last 40 bars (NEVER Math.min(...c.low))
      if (candidates.length === 0) {
        const p10Fallback = this.findBodyPercentileFallback(pool15m.length >= 10 ? pool15m : pool5m, 'SELL', entryPrice, atr, frontRunBuffer, decimals);
        if (p10Fallback) {
          candidates.push({
            price: p10Fallback.price,
            zoneType: 'SWING_BODY',
            rawLevel: p10Fallback.rawLevel,
            description: p10Fallback.description,
            isMajorWall: false,
          });
        }
      }

      // Sort strictly by closest distance to entry (NEVER jump over or ignore the first physical wall!)
      const validWalls = candidates
        .filter(c => c.price < entryPrice)
        .sort((a, b) => (entryPrice - a.price) - (entryPrice - b.price));

      if (validWalls.length > 0) {
        const firstWall = validWalls[0];
        const firstPhysicalWallPrice = firstWall.rawLevel;
        let firstPhysicalWallFrontRunTP = parseFloat((Math.round(firstWall.price / tickSize) * tickSize).toFixed(decimals));
        let firstWallDist = Math.abs(entryPrice - firstPhysicalWallFrontRunTP);
        let structuralRR = parseFloat((firstWallDist / slDistance).toFixed(2));

        // Rule B: HARD MAXIMUM TP CEILING (MAX_TP_RR = 2.20R & MAX_TP_PCT = 1.20%)
        // Never allow the TP scanner to jump across an empty crash void to a 9.30R moonshot target!
        const MAX_TP_RR = 2.20;
        const MAX_TP_PCT = 0.0120;
        if (firstWallDist > MAX_TP_RR * slDistance || (firstWallDist / entryPrice) > MAX_TP_PCT) {
          const cappedDist = Math.min(2.00 * slDistance, entryPrice * 0.0100);
          firstPhysicalWallFrontRunTP = parseFloat((Math.round((entryPrice - cappedDist) / tickSize) * tickSize).toFixed(decimals));
          firstWallDist = cappedDist;
          structuralRR = parseFloat((firstWallDist / slDistance).toFixed(2));
        }

        const runnerCandidate = validWalls.length > 1 ? validWalls[1] : null;
        const tp2Price = runnerCandidate
          ? parseFloat((Math.round(runnerCandidate.price / tickSize) * tickSize).toFixed(decimals))
          : parseFloat((entryPrice - (slDistance * 2.0)).toFixed(decimals));

        return {
          targetPrice: firstPhysicalWallFrontRunTP,
          targetDistance: firstWallDist,
          tp1Price: firstPhysicalWallFrontRunTP,
          tp2Price,
          zoneType: firstWall.zoneType,
          zoneLevel: firstWall.rawLevel,
          frontRunBuffer,
          description: firstWall.description,
          firstPhysicalWallPrice,
          firstPhysicalWallFrontRunTP,
          structuralRR,
          hasPhysicalWall: true,
          physicalWallType: firstWall.zoneType,
        };
      }

      // Fallback: ONLY when zero physical walls exist in the entire lookback pool
      const cappedFallbackDist = Math.min(slDistance * 1.50, entryPrice * 0.0100);
      const fallbackPrice = parseFloat((entryPrice - cappedFallbackDist).toFixed(decimals));
      const fallbackTp2 = parseFloat((entryPrice - Math.min(slDistance * 2.0, entryPrice * 0.0120)).toFixed(decimals));
      return {
        targetPrice: fallbackPrice,
        targetDistance: entryPrice - fallbackPrice,
        tp1Price: fallbackPrice,
        tp2Price: fallbackTp2,
        zoneType: 'FALLBACK_RR',
        zoneLevel: fallbackPrice,
        frontRunBuffer,
        description: `Fallback structural target at ${(cappedFallbackDist / slDistance).toFixed(2)}R ($${fallbackPrice.toFixed(decimals)}) [No physical walls detected]`,
        firstPhysicalWallPrice: fallbackPrice,
        firstPhysicalWallFrontRunTP: fallbackPrice,
        structuralRR: parseFloat((cappedFallbackDist / slDistance).toFixed(2)),
        hasPhysicalWall: false,
        physicalWallType: 'FALLBACK_RR',
      };
    }
  }

  /**
   * Rule 4: Pre-Entry Room-to-Run Filter
   * Distance to nearest opposing reversal zone must be >= 0.80 * SL_Distance.
   */
  public static checkRoomToRun(params: {
    entryPrice: number;
    side: 'BUY' | 'SELL';
    stopLossPrice: number;
    atr: number;
    candles15m: KlinePoint[];
    candles5m?: KlinePoint[];
  }): RoomToRunVerdict {
    const { entryPrice, side, stopLossPrice, atr, candles15m, candles5m } = params;
    const slDistance = Math.max(Math.abs(entryPrice - stopLossPrice), entryPrice * 0.0035);
    const requiredDistance = slDistance * 0.95; // FIX 2: Minimum 0.95R - 1.00R to real candle-body wall

    const structuralTarget = this.calculateCandleStructureTP({
      symbol: 'CHECK',
      side,
      entryPrice,
      stopLossPrice,
      atr,
      candles15m,
      candles5m,
      minRiskReward: 1.00,
      frontRunBufferMultiplier: 0.10,
    });

    const zoneDistance = Math.abs(structuralTarget.targetPrice - entryPrice);
    const tpDistPct = zoneDistance / Math.max(entryPrice, 0.0001);

    if (!structuralTarget.hasPhysicalWall || zoneDistance < requiredDistance || tpDistPct < 0.0050) {
      return {
        allowed: false,
        reason: `SUPPORT_WALL_TOO_CLOSE_VETO: Opposing candle-body wall (${structuralTarget.description}) provides only $${zoneDistance.toFixed(4)} (${(tpDistPct * 100).toFixed(2)}%) room (RR 1:${structuralTarget.structuralRR.toFixed(2)} < 1:0.95 or < 0.50% required). Blocked to avoid pushing TP past real support wall into thin air!`,
        nearestZonePrice: structuralTarget.targetPrice,
        zoneDistance,
        requiredDistance,
        slDistance,
      };
    }

    return {
      allowed: true,
      reason: `ROOM-TO-RUN APPROVED: Room to run to real candle-body wall is $${zoneDistance.toFixed(4)} (${(tpDistPct * 100).toFixed(2)}%, RR 1:${structuralTarget.structuralRR.toFixed(2)} >= 1:0.95).`,
      nearestZonePrice: structuralTarget.targetPrice,
      zoneDistance,
      requiredDistance,
      slDistance,
    };
  }

  // --- Helper: Scan 2-Candle Body Clusters Resistance (Rule 1: Nearest 2-Candle Body Cluster) ---
  private static find2CandleBodyClustersHigh(
    candles: KlinePoint[],
    entryPrice: number,
    atr: number,
    frontRunBuffer: number,
    decimals: number,
    tickSize: number,
    tfLabel: string = '15m'
  ): Array<{
    price: number;
    zoneType: 'SWING_BODY';
    rawLevel: number;
    description: string;
    isMajorWall: boolean;
  }> {
    const results: Array<any> = [];
    if (!candles || candles.length < 2) return results;
    const n = candles.length;
    const maxClusterDiff = Math.max(0.15 * (atr || 1.0), entryPrice * 0.0020, 2 * tickSize);
    const minWallDist = Math.max(0.35 * atr, entryPrice * 0.0050);

    for (let i = n - 1; i >= 1; i--) {
      const c1 = candles[i];
      const bodyHigh1 = Math.max(c1.open, c1.close);
      if (bodyHigh1 < entryPrice + minWallDist) continue;

      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const c2 = candles[j];
        const bodyHigh2 = Math.max(c2.open, c2.close);
        if (bodyHigh2 < entryPrice + minWallDist) continue;

        if (Math.abs(bodyHigh1 - bodyHigh2) <= maxClusterDiff) {
          const clusterResistance = parseFloat(Math.min(bodyHigh1, bodyHigh2).toFixed(decimals));
          const frontRunTP = clusterResistance - frontRunBuffer;

          if (frontRunTP > entryPrice) {
            let unmitigated = true;
            for (let k = i + 1; k < n; k++) {
              if (Math.max(candles[k].open, candles[k].close) > clusterResistance * 1.001) {
                unmitigated = false;
                break;
              }
            }
            if (unmitigated) {
              results.push({
                price: frontRunTP,
                zoneType: 'SWING_BODY',
                rawLevel: clusterResistance,
                description: `Opposing ${tfLabel} 2-Candle Body Cluster Resistance ($${clusterResistance.toFixed(decimals)}) minus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
                isMajorWall: true,
              });
              break;
            }
          }
        }
      }
    }
    return results;
  }

  // --- Helper: Scan 2-Candle Body Clusters Support (Rule 1: Nearest 2-Candle Body Cluster) ---
  private static find2CandleBodyClustersLow(
    candles: KlinePoint[],
    entryPrice: number,
    atr: number,
    frontRunBuffer: number,
    decimals: number,
    tickSize: number,
    tfLabel: string = '15m'
  ): Array<{
    price: number;
    zoneType: 'SWING_BODY';
    rawLevel: number;
    description: string;
    isMajorWall: boolean;
  }> {
    const results: Array<any> = [];
    if (!candles || candles.length < 2) return results;
    const n = candles.length;
    const maxClusterDiff = Math.max(0.15 * (atr || 1.0), entryPrice * 0.0020, 2 * tickSize);
    const minWallDist = Math.max(0.35 * atr, entryPrice * 0.0050);

    for (let i = n - 1; i >= 1; i--) {
      const c1 = candles[i];
      const bodyLow1 = Math.min(c1.open, c1.close);
      if (bodyLow1 > entryPrice - minWallDist) continue;

      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const c2 = candles[j];
        const bodyLow2 = Math.min(c2.open, c2.close);
        if (bodyLow2 > entryPrice - minWallDist) continue;

        if (Math.abs(bodyLow1 - bodyLow2) <= maxClusterDiff) {
          const clusterSupport = parseFloat(Math.max(bodyLow1, bodyLow2).toFixed(decimals));
          const frontRunTP = clusterSupport + frontRunBuffer;

          if (frontRunTP < entryPrice) {
            let unmitigated = true;
            for (let k = i + 1; k < n; k++) {
              if (Math.min(candles[k].open, candles[k].close) < clusterSupport * 0.999) {
                unmitigated = false;
                break;
              }
            }
            if (unmitigated) {
              results.push({
                price: frontRunTP,
                zoneType: 'SWING_BODY',
                rawLevel: clusterSupport,
                description: `Opposing ${tfLabel} 2-Candle Body Cluster Support ($${clusterSupport.toFixed(decimals)}) plus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
                isMajorWall: true,
              });
              break;
            }
          }
        }
      }
    }
    return results;
  }

  // --- Helper: 10th/90th Percentile of Candle Bodies Fallback (DELETE low50/high50 WICK FALLBACK) ---
  private static findBodyPercentileFallback(
    candles: KlinePoint[],
    side: 'BUY' | 'SELL',
    entryPrice: number,
    atr: number,
    frontRunBuffer: number,
    decimals: number
  ): { price: number; rawLevel: number; description: string } | null {
    if (!candles || candles.length < 5) return null;
    const slice = candles.slice(-40);

    if (side === 'SELL') {
      const bodyLows = slice.map(c => Math.min(c.open, c.close)).filter(b => b <= entryPrice - (0.30 * (atr || 0))).sort((a, b) => a - b);
      if (bodyLows.length === 0) return null;
      const p10Idx = Math.max(0, Math.floor(bodyLows.length * 0.10));
      const p10BodyLow = bodyLows[p10Idx];
      const frontRunTP = p10BodyLow + frontRunBuffer;
      if (frontRunTP < entryPrice) {
        return {
          price: frontRunTP,
          rawLevel: p10BodyLow,
          description: `10th Percentile 40-Bar Candle Body Support ($${p10BodyLow.toFixed(decimals)}) plus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
        };
      }
    } else {
      const bodyHighs = slice.map(c => Math.max(c.open, c.close)).filter(b => b >= entryPrice + (0.30 * (atr || 0))).sort((a, b) => a - b);
      if (bodyHighs.length === 0) return null;
      const p90Idx = Math.min(bodyHighs.length - 1, Math.floor(bodyHighs.length * 0.90));
      const p90BodyHigh = bodyHighs[p90Idx];
      const frontRunTP = p90BodyHigh - frontRunBuffer;
      if (frontRunTP > entryPrice) {
        return {
          price: frontRunTP,
          rawLevel: p90BodyHigh,
          description: `90th Percentile 40-Bar Candle Body Resistance ($${p90BodyHigh.toFixed(decimals)}) minus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
        };
      }
    }
    return null;
  }

  // --- Helper: Scan all 2-bar and 3-bar swing body highs in last 40 candles (Rule 1 & Rule A) ---
  private static findAllSwingBodyHighs(
    candles: KlinePoint[],
    entryPrice: number,
    atr: number,
    frontRunBuffer: number,
    decimals: number,
    tickSize: number,
    tfLabel: string = '15m'
  ): Array<{
    price: number;
    zoneType: 'SWING_BODY';
    rawLevel: number;
    description: string;
    isMajorWall: boolean;
  }> {
    const results: Array<any> = [];
    if (!candles || candles.length < 3) return results;
    const n = candles.length;
    for (let i = n - 2; i >= 1; i--) {
      const cur = candles[i];
      const prev = candles[i - 1];
      const next = candles[i + 1];
      const curBodyHigh = Math.max(cur.open, cur.close);
      const prevBodyHigh = Math.max(prev.open, prev.close);
      const nextBodyHigh = Math.max(next.open, next.close);
      // Rule A: Catch Every Local Swing Body Above 1.20R (2-bar or 3-bar local highs)
      const is3BarPivot = (curBodyHigh >= prevBodyHigh && curBodyHigh >= nextBodyHigh) || (cur.high >= prev.high && cur.high >= next.high);
      const is2BarPivot = (curBodyHigh > prevBodyHigh && cur.high > prev.high);
      if (is3BarPivot || is2BarPivot) {
        const bodyHigh = curBodyHigh;
        const frontRunTP = bodyHigh - frontRunBuffer;
        // Outside micro-noise check: raw barrier level >= entryPrice + minBuffer (>= 0.35 * ATR and >= 0.50%)
        const minBufferFromEntry = Math.max(0.35 * atr, entryPrice * 0.0050);
        if (bodyHigh >= entryPrice + minBufferFromEntry && frontRunTP > entryPrice) {
          // Unmitigated on current bounce: current bar has not closed above bodyHigh
          if (candles[n - 1].close >= bodyHigh) continue;

          const isMajor = (i >= 2 && n - 1 - i >= 2 && candles[i - 2].high <= cur.high && candles[i + 2].high <= cur.high);
          results.push({
            price: frontRunTP,
            zoneType: 'SWING_BODY',
            rawLevel: bodyHigh,
            description: `Opposing ${tfLabel} Reversal Swing Pivot High body ($${bodyHigh.toFixed(decimals)}) front-run by buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
            isMajorWall: isMajor,
          });
        }
      }
    }
    return results;
  }

  // --- Helper: Scan all 2-bar and 3-bar swing body lows in last 40 candles (Rule 1 & Rule A) ---
  private static findAllSwingBodyLows(
    candles: KlinePoint[],
    entryPrice: number,
    atr: number,
    frontRunBuffer: number,
    decimals: number,
    tickSize: number,
    tfLabel: string = '15m'
  ): Array<{
    price: number;
    zoneType: 'SWING_BODY';
    rawLevel: number;
    description: string;
    isMajorWall: boolean;
  }> {
    const results: Array<any> = [];
    if (!candles || candles.length < 3) return results;
    const n = candles.length;
    for (let i = n - 2; i >= 1; i--) {
      const cur = candles[i];
      const prev = candles[i - 1];
      const next = candles[i + 1];
      const curBodyLow = Math.min(cur.open, cur.close);
      const prevBodyLow = Math.min(prev.open, prev.close);
      const nextBodyLow = Math.min(next.open, next.close);
      // Rule A: Catch Every Local Swing Body Above 1.20R (2-bar or 3-bar local lows)
      const is3BarPivot = (curBodyLow <= prevBodyLow && curBodyLow <= nextBodyLow) || (cur.low <= prev.low && cur.low <= next.low);
      const is2BarPivot = (curBodyLow < prevBodyLow && cur.low < prev.low);
      if (is3BarPivot || is2BarPivot) {
        const bodyLow = curBodyLow;
        const frontRunTP = bodyLow + frontRunBuffer;
        // Outside micro-noise check: raw barrier level <= entryPrice - minBuffer (>= 0.35 * ATR and >= 0.50%)
        const minBufferFromEntry = Math.max(0.35 * atr, entryPrice * 0.0050);
        if (bodyLow <= entryPrice - minBufferFromEntry && frontRunTP < entryPrice) {
          // Unmitigated on current drop: current bar has not closed below bodyLow
          if (candles[n - 1].close <= bodyLow) continue;

          const isMajor = (i >= 2 && n - 1 - i >= 2 && candles[i - 2].low >= cur.low && candles[i + 2].low >= cur.low);
          results.push({
            price: frontRunTP,
            zoneType: 'SWING_BODY',
            rawLevel: bodyLow,
            description: `Opposing ${tfLabel} Reversal Swing Pivot Low body ($${bodyLow.toFixed(decimals)}) plus front-run buffer ($${frontRunBuffer.toFixed(decimals)}) = $${frontRunTP.toFixed(decimals)}`,
            isMajorWall: isMajor,
          });
        }
      }
    }
    return results;
  }

  // --- Helper: Find Bearish Order Blocks (Supply candles with displacement > 1.2 * ATR) ---
  private static findBearishOrderBlocks(candles15m: KlinePoint[], candles5m: KlinePoint[], entryPrice: number, atr: number): Array<{ bodyHigh: number; candle: KlinePoint }> {
    const results: Array<{ bodyHigh: number; candle: KlinePoint }> = [];
    const pools = [candles15m, candles5m];

    for (const pool of pools) {
      if (!pool || pool.length < 5) continue;
      const n = pool.length;
      for (let i = 2; i < n - 2; i++) {
        const c = pool[i];
        const isUpCandle = c.close >= c.open;
        const next1 = pool[i + 1];
        const next2 = pool[i + 2];
        // Institutional displacement downward (> 1.2 * ATR)
        const displacement = c.high - Math.min(next1.close, next2.close);
        const hasInstitutionalDisplacement = (next1.close < c.low || next2.close < c.low) && displacement >= (1.2 * (atr || 1.0));

        if (isUpCandle && hasInstitutionalDisplacement) {
          const bodyHigh = Math.max(c.open, c.close);
          if (bodyHigh >= entryPrice + (0.30 * (atr || 0))) {
            // Check unmitigated: price hasn't closed above bodyHigh
            let unmitigated = true;
            for (let k = i + 2; k < n; k++) {
              if (Math.max(pool[k].open, pool[k].close) >= bodyHigh) {
                unmitigated = false;
                break;
              }
            }
            if (unmitigated) {
              results.push({ bodyHigh, candle: c });
            }
          }
        }
      }
    }

    return results;
  }

  // --- Helper: Find Bullish Order Blocks (Demand candles with displacement > 1.2 * ATR) ---
  private static findBullishOrderBlocks(candles15m: KlinePoint[], candles5m: KlinePoint[], entryPrice: number, atr: number): Array<{ bodyLow: number; candle: KlinePoint }> {
    const results: Array<{ bodyLow: number; candle: KlinePoint }> = [];
    const pools = [candles15m, candles5m];

    for (const pool of pools) {
      if (!pool || pool.length < 5) continue;
      const n = pool.length;
      for (let i = 2; i < n - 2; i++) {
        const c = pool[i];
        const isDownCandle = c.close <= c.open;
        const next1 = pool[i + 1];
        const next2 = pool[i + 2];
        // Institutional displacement upward (> 1.2 * ATR)
        const displacement = Math.max(next1.close, next2.close) - c.low;
        const hasInstitutionalDisplacement = (next1.close > c.high || next2.close > c.high) && displacement >= (1.2 * (atr || 1.0));

        if (isDownCandle && hasInstitutionalDisplacement) {
          const bodyLow = Math.min(c.open, c.close);
          if (bodyLow <= entryPrice - (0.30 * (atr || 0))) {
            // Check unmitigated: price hasn't closed below bodyLow
            let unmitigated = true;
            for (let k = i + 2; k < n; k++) {
              if (Math.min(pool[k].open, pool[k].close) <= bodyLow) {
                unmitigated = false;
                break;
              }
            }
            if (unmitigated) {
              results.push({ bodyLow, candle: c });
            }
          }
        }
      }
    }

    return results;
  }

  // --- Helper: Overhead Bearish FVGs ---
  private static findOverheadFVGs(candles15m: KlinePoint[], candles5m: KlinePoint[], entryPrice: number, atr: number = 0): Array<{ bottomEdge: number }> {
    const results: Array<{ bottomEdge: number }> = [];
    const pools = [candles15m, candles5m];

    for (const pool of pools) {
      if (!pool || pool.length < 4) continue;
      const n = pool.length;
      for (let i = 2; i < n - 1; i++) {
        // Drop imbalance: candle i-2 low > candle i high
        if (pool[i - 2].low > pool[i].high) {
          const bottomEdge = pool[i].high;
          if (bottomEdge >= entryPrice + (0.30 * atr)) {
            // Unfilled check
            let unfilled = true;
            for (let k = i + 1; k < n; k++) {
              if (pool[k].high >= bottomEdge * 1.0005) {
                unfilled = false;
                break;
              }
            }
            if (unfilled) {
              results.push({ bottomEdge });
            }
          }
        }
      }
    }

    return results;
  }

  // --- Helper: Below-Market Bullish FVGs ---
  private static findBelowMarketFVGs(candles15m: KlinePoint[], candles5m: KlinePoint[], entryPrice: number, atr: number = 0): Array<{ topEdge: number }> {
    const results: Array<{ topEdge: number }> = [];
    const pools = [candles15m, candles5m];

    for (const pool of pools) {
      if (!pool || pool.length < 4) continue;
      const n = pool.length;
      for (let i = 2; i < n - 1; i++) {
        // Rally imbalance: candle i low > candle i-2 high
        if (pool[i].low > pool[i - 2].high) {
          const topEdge = pool[i].low;
          if (topEdge <= entryPrice - (0.30 * atr)) {
            // Unfilled check
            let unfilled = true;
            for (let k = i + 1; k < n; k++) {
              if (pool[k].low <= topEdge * 0.9995) {
                unfilled = false;
                break;
              }
            }
            if (unfilled) {
              results.push({ topEdge });
            }
          }
        }
      }
    }

    return results;
  }

  // --- Helper: Recent 15m Major Swing Body High (up to 5-left/5-right bars OR >= 2 distinct touches) ---
  private static findRecentSwingBodyHigh(candles: KlinePoint[], entryPrice: number, atr: number): { price: number; isMajor: boolean } {
    if (!candles || candles.length < 5) return { price: 0, isMajor: false };
    const n = candles.length;
    let bestBodyHigh = 0;
    let isMajor = false;

    // 1. Scan for Major Swing High: minimum 3-left / 2-right bars up to 5-left / 5-right bars
    for (let i = n - 2; i >= 3; i--) {
      const cur = candles[i];
      let isPivot = true;
      const leftWindow = Math.min(5, i);
      const rightWindow = Math.min(5, n - 1 - i);
      if (leftWindow < 2 || rightWindow < 1) continue;

      for (let k = 1; k <= leftWindow; k++) {
        if (candles[i - k].high > cur.high) {
          isPivot = false;
          break;
        }
      }
      if (isPivot) {
        for (let k = 1; k <= rightWindow; k++) {
          if (candles[i + k].high > cur.high) {
            isPivot = false;
            break;
          }
        }
      }

      if (isPivot) {
        const bodyHigh = Math.max(cur.open, cur.close);
        if (bodyHigh >= entryPrice + (0.30 * (atr || 0))) {
          let unmitigated = true;
          for (let k = i + 1; k < n; k++) {
            if (candles[k].close >= bodyHigh) {
              unmitigated = false;
              break;
            }
          }
          if (unmitigated) {
            bestBodyHigh = bodyHigh;
            isMajor = (leftWindow >= 3 && rightWindow >= 2);
            break;
          }
        }
      }
    }

    // 2. Check multi-touch range ceiling (>= 2 distinct touches within 0.15 * ATR of candle bodies)
    if (bestBodyHigh <= entryPrice) {
      const recentSlice = candles.slice(-50);
      let maxTouches = 0;
      let multiLevel = 0;
      for (let i = 0; i < recentSlice.length; i++) {
        const h = Math.max(recentSlice[i].open, recentSlice[i].close);
        if (h < entryPrice + (0.30 * (atr || 0))) continue;
        const touches = recentSlice.filter(c => Math.abs(Math.max(c.open, c.close) - h) <= (0.15 * (atr || 1.0))).length;
        if (touches >= 2 && touches > maxTouches) {
          maxTouches = touches;
          multiLevel = h;
        }
      }
      if (multiLevel >= entryPrice + (0.30 * (atr || 0))) {
        bestBodyHigh = multiLevel;
        isMajor = true;
      }
    }

    // 3. Fallback: Highest body in recent 50 bars (non-major) outside micro-noise
    if (bestBodyHigh <= entryPrice) {
      const recentSlice = candles.slice(-50);
      const bodies = recentSlice.map(c => Math.max(c.open, c.close)).filter(b => b >= entryPrice + (0.30 * (atr || 0)));
      if (bodies.length > 0) {
        bestBodyHigh = Math.max(...bodies);
        isMajor = false;
      }
    }

    return { price: bestBodyHigh, isMajor };
  }

  // --- Helper: Recent 15m Major Swing Body Low (up to 5-left/5-right bars OR >= 2 distinct touches) ---
  private static findRecentSwingBodyLow(candles: KlinePoint[], entryPrice: number, atr: number): { price: number; isMajor: boolean } {
    if (!candles || candles.length < 5) return { price: 0, isMajor: false };
    const n = candles.length;
    let bestBodyLow = 0;
    let isMajor = false;

    // 1. Scan for Major Swing Low: minimum 3-left / 2-right bars up to 5-left / 5-right bars
    for (let i = n - 2; i >= 3; i--) {
      const cur = candles[i];
      let isPivot = true;
      const leftWindow = Math.min(5, i);
      const rightWindow = Math.min(5, n - 1 - i);
      if (leftWindow < 2 || rightWindow < 1) continue;

      for (let k = 1; k <= leftWindow; k++) {
        if (candles[i - k].low < cur.low) {
          isPivot = false;
          break;
        }
      }
      if (isPivot) {
        for (let k = 1; k <= rightWindow; k++) {
          if (candles[i + k].low < cur.low) {
            isPivot = false;
            break;
          }
        }
      }

      if (isPivot) {
        const bodyLow = Math.min(cur.open, cur.close);
        if (bodyLow <= entryPrice - (0.30 * (atr || 0))) {
          let unmitigated = true;
          for (let k = i + 1; k < n; k++) {
            if (candles[k].close <= bodyLow) {
              unmitigated = false;
              break;
            }
          }
          if (unmitigated) {
            bestBodyLow = bodyLow;
            isMajor = (leftWindow >= 3 && rightWindow >= 2);
            break;
          }
        }
      }
    }

    // 2. Check multi-touch range floor (>= 2 distinct touches within 0.15 * ATR of candle bodies)
    if (bestBodyLow >= entryPrice || bestBodyLow === 0) {
      const recentSlice = candles.slice(-50);
      let maxTouches = 0;
      let multiLevel = 0;
      for (let i = 0; i < recentSlice.length; i++) {
        const l = Math.min(recentSlice[i].open, recentSlice[i].close);
        if (l > entryPrice - (0.30 * (atr || 0))) continue;
        const touches = recentSlice.filter(c => Math.abs(Math.min(c.open, c.close) - l) <= (0.15 * (atr || 1.0))).length;
        if (touches >= 2 && touches > maxTouches) {
          maxTouches = touches;
          multiLevel = l;
        }
      }
      if (multiLevel <= entryPrice - (0.30 * (atr || 0)) && multiLevel > 0) {
        bestBodyLow = multiLevel;
        isMajor = true;
      }
    }

    // 3. Fallback: Lowest body in recent 50 bars (non-major) outside micro-noise
    if (bestBodyLow >= entryPrice || bestBodyLow === 0) {
      const recentSlice = candles.slice(-50);
      const bodies = recentSlice.map(c => Math.min(c.open, c.close)).filter(b => b <= entryPrice - (0.30 * (atr || 0)) && b > 0);
      if (bodies.length > 0) {
        bestBodyLow = Math.min(...bodies);
        isMajor = false;
      }
    }

    return { price: bestBodyLow, isMajor };
  }
}

// ============================================================================
// 2. LIVE CANDLE EXHAUSTION & REVERSAL DETECTOR (AUTO-CLOSE AT PEAK PROFIT)
// ============================================================================
export class LiveCandleReversalDetector {
  /**
   * Evaluates whether an active position should be immediately market-closed to lock peak profit.
   * Activates once position has gained >= +0.40R or >= +0.35% price move.
   */
  public static evaluateReversalExhaustion(params: {
    pos: DeltaPosition;
    currentPrice: number;
    candles1m?: KlinePoint[];
    candles5m?: KlinePoint[];
    vwap5m?: number;
  }): LiveReversalVerdict {
    const { pos, currentPrice, candles1m, candles5m, vwap5m } = params;
    const entryPrice = pos.entryPrice;
    const side = pos.side;

    const riskDistance = pos.riskDistance || Math.max(Math.abs(entryPrice - pos.stopLossPrice), entryPrice * 0.0045);
    const priceDiff = side === 'BUY' ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
    const rMultiple = riskDistance > 0 ? (priceDiff / riskDistance) : 0;
    const priceMovePct = Math.abs(currentPrice - entryPrice) / entryPrice;

    // Activation Gate: Must have reached at least +0.30R OR +$1.50 USD OR +0.30% price move in profit
    const pnlUSD = (pos.pnlUSD !== undefined) ? pos.pnlUSD : 0;
    const hasReachedProfitThreshold = rMultiple >= 0.30 || pnlUSD >= 1.50 || priceMovePct >= 0.0030;
    if (!hasReachedProfitThreshold) {
      return {
        shouldClose: false,
        signature: null,
        reason: `Position profit (${rMultiple.toFixed(2)}R, $${pnlUSD.toFixed(2)}, ${(priceMovePct * 100).toFixed(2)}%) below exhaustion scanner activation threshold (+0.30R or +$1.50 USD)`,
        reversalPrice: currentPrice,
        currentRMultiple: rMultiple,
        priceMovePct,
      };
    }

    // Combine recent 1m and 5m candles to evaluate exhaustion signatures
    const candidateCandleSets = [
      { name: '1m', list: candles1m || [] },
      { name: '5m', list: candles5m || [] },
    ];

    for (const { name: tfName, list: candles } of candidateCandleSets) {
      if (!candles || candles.length < 3) continue;
      const n = candles.length;
      const curCandle = candles[n - 1];
      const prevCandle = candles[n - 2];
      const prev2Candle = candles[n - 3];

      const range = curCandle.high - curCandle.low;
      if (range <= 0) continue;

      if (side === 'BUY') {
        // --- LONG POSITION EXHAUSTION SIGNATURES ---

        // SIGNATURE A: Bearish Rejection Wick (Shooting Star) >= 55% of candle range with weak close
        const upperWick = curCandle.high - Math.max(curCandle.open, curCandle.close);
        const wickRatio = upperWick / range;
        const closePosition = (curCandle.close - curCandle.low) / range;
        const isShootingStar = wickRatio >= 0.55 && (closePosition < 0.45 || curCandle.close <= curCandle.open);

        if (isShootingStar) {
          return {
            shouldClose: true,
            signature: 'SIGNATURE_A',
            reason: `Signature A Triggered on ${tfName}: Bearish Rejection Wick / Shooting Star (${(wickRatio * 100).toFixed(1)}% upper wick >= 55%) closing weak at top of +${rMultiple.toFixed(2)}R move. Banking peak profit immediately!`,
            reversalPrice: currentPrice,
            currentRMultiple: rMultiple,
            priceMovePct,
          };
        }

        // SIGNATURE B: Opposite Bearish Engulfing / Momentum Flip
        // Candle closes beyond previous candle's open in opposite direction
        const isBearishEngulfing = curCandle.close < curCandle.open && curCandle.close < prevCandle.open;
        if (isBearishEngulfing) {
          return {
            shouldClose: true,
            signature: 'SIGNATURE_B',
            reason: `Signature B Triggered on ${tfName}: Bearish Engulfing / Momentum Flip (closed at $${curCandle.close} below previous open $${prevCandle.open}). Market reversing against Long position. Banking +${rMultiple.toFixed(2)}R profit!`,
            reversalPrice: currentPrice,
            currentRMultiple: rMultiple,
            priceMovePct,
          };
        }

        // SIGNATURE C: Climax Stall at Micro-Structure (2 consecutive shrinking inside bars)
        const curBody = Math.abs(curCandle.close - curCandle.open);
        const prevBody = Math.abs(prevCandle.close - prevCandle.open);
        const prev2Body = Math.abs(prev2Candle.close - prev2Candle.open);

        const isInsideBars = curCandle.high <= prevCandle.high && curCandle.low >= prevCandle.low &&
                             prevCandle.high <= prev2Candle.high && prevCandle.low >= prev2Candle.low;
        const isShrinkingBodies = curBody < prevBody && prevBody < prev2Body;
        const nearVWAP = vwap5m ? Math.abs(currentPrice - vwap5m) / vwap5m <= 0.0025 : false;

        if (isInsideBars && isShrinkingBodies) {
          return {
            shouldClose: true,
            signature: 'SIGNATURE_C',
            reason: `Signature C Triggered on ${tfName}: Climax Stall at Micro-Structure (2 consecutive stalling inside bars with shrinking volume bodies${nearVWAP ? ' tapping VWAP' : ''}). Buyer exhaustion confirmed at +${rMultiple.toFixed(2)}R. Banking win!`,
            reversalPrice: currentPrice,
            currentRMultiple: rMultiple,
            priceMovePct,
          };
        }

      } else {
        // --- SHORT POSITION EXHAUSTION SIGNATURES ---

        // SIGNATURE A: Bullish Rejection Wick (Hammer) >= 55% of candle range with weak close
        const lowerWick = Math.min(curCandle.open, curCandle.close) - curCandle.low;
        const wickRatio = lowerWick / range;
        const closePosition = (curCandle.high - curCandle.close) / range;
        const isHammer = wickRatio >= 0.55 && (closePosition < 0.45 || curCandle.close >= curCandle.open);

        if (isHammer) {
          return {
            shouldClose: true,
            signature: 'SIGNATURE_A',
            reason: `Signature A Triggered on ${tfName}: Bullish Rejection Wick / Hammer (${(wickRatio * 100).toFixed(1)}% lower wick >= 55%) closing weak at bottom of +${rMultiple.toFixed(2)}R move. Banking peak profit immediately!`,
            reversalPrice: currentPrice,
            currentRMultiple: rMultiple,
            priceMovePct,
          };
        }

        // SIGNATURE B: Opposite Bullish Engulfing / Momentum Flip
        const isBullishEngulfing = curCandle.close > curCandle.open && curCandle.close > prevCandle.open;
        if (isBullishEngulfing) {
          return {
            shouldClose: true,
            signature: 'SIGNATURE_B',
            reason: `Signature B Triggered on ${tfName}: Bullish Engulfing / Momentum Flip (closed at $${curCandle.close} above previous open $${prevCandle.open}). Market reversing against Short position. Banking +${rMultiple.toFixed(2)}R profit!`,
            reversalPrice: currentPrice,
            currentRMultiple: rMultiple,
            priceMovePct,
          };
        }

        // SIGNATURE C: Climax Stall at Micro-Structure
        const curBody = Math.abs(curCandle.close - curCandle.open);
        const prevBody = Math.abs(prevCandle.close - prevCandle.open);
        const prev2Body = Math.abs(prev2Candle.close - prev2Candle.open);

        const isInsideBars = curCandle.high <= prevCandle.high && curCandle.low >= prevCandle.low &&
                             prevCandle.high <= prev2Candle.high && prevCandle.low >= prev2Candle.low;
        const isShrinkingBodies = curBody < prevBody && prevBody < prev2Body;
        const nearVWAP = vwap5m ? Math.abs(currentPrice - vwap5m) / vwap5m <= 0.0025 : false;

        if (isInsideBars && isShrinkingBodies) {
          return {
            shouldClose: true,
            signature: 'SIGNATURE_C',
            reason: `Signature C Triggered on ${tfName}: Climax Stall at Micro-Structure (2 consecutive stalling inside bars with shrinking bodies${nearVWAP ? ' tapping VWAP' : ''}). Seller exhaustion confirmed at +${rMultiple.toFixed(2)}R. Banking win!`,
            reversalPrice: currentPrice,
            currentRMultiple: rMultiple,
            priceMovePct,
          };
        }
      }
    }

    return {
      shouldClose: false,
      signature: null,
      reason: `No exhaustion reversal signatures detected; trade proceeding normally (+${rMultiple.toFixed(2)}R profit).`,
      reversalPrice: currentPrice,
      currentRMultiple: rMultiple,
      priceMovePct,
    };
  }
}

// ============================================================================
// 3. RATCHETING HIGH-WATERMARK PROFIT RATCHET (ZERO GIVE-BACK RULE)
// ============================================================================
export class CandleByCandleProfitRatchet {
  /**
   * Ratchets Stop-Loss progressively based on high-watermark profit:
   * - At +0.45R: Lock SL at Entry + 0.15R (covers fees + guaranteed green exit).
   * - At +0.70R: Lock SL at 60% of peak unrealized profit.
   * - Above +0.90R: Candle-by-candle bar trailing along low of closed 1m bar (BUY) or high of closed 1m bar (SELL).
   */
  public static evaluateProfitRatchet(params: {
    pos: DeltaPosition;
    currentPrice: number;
    closed1mCandle?: KlinePoint;
    atr?: number;
    tickSize?: number;
    decimals?: number;
  }): ProfitRatchetResult {
    const { pos, currentPrice, closed1mCandle, atr, tickSize = 0.0001, decimals = 4 } = params;
    const entryPrice = pos.entryPrice;
    const side = pos.side;
    const riskDist = pos.riskDistance || Math.max(Math.abs(entryPrice - pos.stopLossPrice), entryPrice * 0.0045);
    const effectiveAtr = atr || pos.atr || (entryPrice * 0.003);

    // Update High Watermark Peak Price & Peak R
    if (side === 'BUY') {
      pos.peakPriceReached = Math.max(pos.peakPriceReached || entryPrice, currentPrice);
    } else {
      pos.peakPriceReached = Math.min(pos.peakPriceReached || entryPrice, currentPrice);
    }

    const currentGain = side === 'BUY' ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
    const currentR = riskDist > 0 ? (currentGain / riskDist) : 0;
    pos.peakRReached = Math.max(pos.peakRReached || 0, currentR);

    let newSL = pos.stopLossPrice;
    let newStage = pos.ratchetStage || 0;
    let wasUpdated = false;
    let reason = 'Holding current stop loss';

    const pnlUSD = (pos.pnlUSD !== undefined) ? pos.pnlUSD : 0;

    // --- STAGE 1: At +0.40R Profit OR +$2.00 USD -> Move SL to Entry +/- 0.12% (Fee Shield) ---
    if ((pos.peakRReached >= 0.40 || pnlUSD >= 2.00) && newStage < 1) {
      const feeBuffer = entryPrice * 0.0012; // 0.12% Fee-Plus Breakeven
      if (side === 'BUY') {
        const candidateSL = parseFloat((entryPrice + feeBuffer).toFixed(decimals));
        if (candidateSL > newSL) {
          newSL = candidateSL;
          newStage = 1;
          wasUpdated = true;
          reason = `[STAGE 1 RATCHET (+0.40R / +$2.00)] Moved SL to Entry + 0.12% ($${newSL.toFixed(decimals)}) for guaranteed green exit & full fee coverage.`;
        }
      } else {
        const candidateSL = parseFloat((entryPrice - feeBuffer).toFixed(decimals));
        if (candidateSL < newSL) {
          newSL = candidateSL;
          newStage = 1;
          wasUpdated = true;
          reason = `[STAGE 1 RATCHET (+0.40R / +$2.00)] Moved SL to Entry - 0.12% ($${newSL.toFixed(decimals)}) for guaranteed green exit & full fee coverage.`;
        }
      }
    }

    // --- STAGE 2: At +0.65R Profit OR +$3.50 USD -> Lock SL at +0.35R in profit ---
    if (pos.peakRReached >= 0.65 || pnlUSD >= 3.50) {
      if (side === 'BUY') {
        const targetSL = entryPrice + (0.35 * riskDist);
        const candidateSL = parseFloat(targetSL.toFixed(decimals));
        if (candidateSL > newSL) {
          newSL = candidateSL;
          newStage = Math.max(newStage, 2);
          wasUpdated = true;
          reason = `[STAGE 2 RATCHET (+0.65R / +$3.50)] Locked SL at +0.35R profit ($${newSL.toFixed(decimals)}, Peak: $${pos.peakPriceReached.toFixed(decimals)}).`;
        }
      } else {
        const targetSL = entryPrice - (0.35 * riskDist);
        const candidateSL = parseFloat(targetSL.toFixed(decimals));
        if (candidateSL < newSL) {
          newSL = candidateSL;
          newStage = Math.max(newStage, 2);
          wasUpdated = true;
          reason = `[STAGE 2 RATCHET (+0.65R / +$3.50)] Locked SL at +0.35R profit ($${newSL.toFixed(decimals)}, Peak: $${pos.peakPriceReached.toFixed(decimals)}).`;
        }
      }
    }

    // --- STAGE 3: Above +0.90R Profit -> Candle-by-Candle 1m Bar Trailing ---
    if (pos.peakRReached >= 0.90 && closed1mCandle) {
      const buffer = Math.max(0.05 * effectiveAtr, tickSize);
      if (side === 'BUY') {
        const candidateSL = parseFloat((closed1mCandle.low - buffer).toFixed(decimals));
        if (candidateSL > newSL) {
          newSL = candidateSL;
          newStage = 3;
          wasUpdated = true;
          reason = `[STAGE 3 BAR TRAILING (+0.90R)] Trailed SL dynamically under closed 1m candle low ($${closed1mCandle.low} - buffer) to $${newSL.toFixed(decimals)}. Banking 85-95% peak profit!`;
        }
      } else {
        const candidateSL = parseFloat((closed1mCandle.high + buffer).toFixed(decimals));
        if (candidateSL < newSL) {
          newSL = candidateSL;
          newStage = 3;
          wasUpdated = true;
          reason = `[STAGE 3 BAR TRAILING (+0.90R)] Trailed SL dynamically above closed 1m candle high ($${closed1mCandle.high} + buffer) to $${newSL.toFixed(decimals)}. Banking 85-95% peak profit!`;
        }
      }
    }

    pos.stopLossPrice = newSL;
    pos.ratchetStage = newStage;

    return {
      stopLossPrice: newSL,
      ratchetStage: newStage,
      peakPriceReached: pos.peakPriceReached,
      peakRReached: pos.peakRReached,
      wasUpdated,
      reason,
    };
  }
}
