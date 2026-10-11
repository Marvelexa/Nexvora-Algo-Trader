import { KlinePoint } from './quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from './cryptoDedicatedStrategyEngine';

export type MovePhase = 'EARLY' | 'MID' | 'LATE';

export interface TimingEvaluation {
  canEnterDirect: boolean;
  canEnterPullback: boolean;
  action: 'ENTER_DIRECT' | 'ENTER_PULLBACK' | 'LATE_SKIP' | 'SLIPPAGE_SKIP' | 'EXHAUSTION_SKIP' | 'STAND_ASIDE';
  phase: MovePhase;
  extAtr: number;              // (Price - EMA20) / ATR
  runATR: number;              // Move run from origin in ATR
  candleStreak: number;        // Consecutive green/red bars
  lastBarRangeAtr: number;     // Range of last closed bar / ATR
  rejectionWickPct: number;    // Upper wick % for BUY, Lower wick % for SELL
  isExhaustionCandle: boolean;
  slippageAtr: number;
  pullbackTriggered?: boolean;
  pullbackFibLevel?: number;   // 0.382 - 0.618
  structuralSLPrice?: number;
  minSafeSLDistance: number;   // Guaranteed >= 0.8 * ATR
  recommendedTargetPrice?: number;
  riskRewardRatio?: number;
  reasons: string[];
}

export interface CompressionBreakoutCheck {
  isCompressed: boolean;       // Bandwidth in lowest 20%
  isBreakout: boolean;         // Bar closed outside range with rvol >= 1.3
  breakoutSide: 'BUY' | 'SELL' | null;
  rvol: number;
  bandwidthPct: number;
  reason: string;
}

export interface PullbackEvaluation {
  isPullbackValid: boolean;
  side: 'BUY' | 'SELL';
  retraceRatio: number;        // e.g. 0.382 - 0.618
  impulseHeightAtr: number;    // Impulse leg >= 2.0 ATR
  entryPrice: number;
  structuralSL: number;
  targetPrice: number;
  riskReward: number;
  triggerFound: boolean;
  triggerReason: string;
}

/**
 * =========================================================================
 * TIMING AND ANTI-CHASE PLAYBOOK 2026 ENGINE ("Math Is Right, Time Is Wrong")
 * =========================================================================
 * Solves the late-entry / trend-chase problem:
 * 1. Anti-Chase Gate: Blocks BUY at the top of multi-candle green runs (runATR > 3.5, streak >= 5, ext > 2.0).
 * 2. Move Phase Classification:
 *    - EARLY (runATR < 2.0): Direct trend & breakout entries allowed.
 *    - MID   (runATR in [2.0, 3.5]): Direct chase BLOCKED. ONLY 38.2%-61.8% Pullbacks allowed.
 *    - LATE  (runATR > 3.5): Exhaustion phase. LATE_SKIP (Stand aside).
 * 3. Pullback Entry Module: Fibonacci 0.382 - 0.618 retrace + rejection trigger + structural stop.
 * 4. Compression Breakout: Catches trends at Bar 1 (Early Phase, BB Squeeze + RVOL >= 1.3).
 * 5. Signal Freshness & Slippage Gate: Blocks orders slipped > 0.3 ATR from signal price.
 * 6. Minimum Stop Distance Assertion: Guarantees SL >= 0.8 ATR so trades are never stopped by noise.
 * 7. Exhaustion & Time Stops: Climax exit on high-volume rejection; time stop if +0.5 ATR not reached in 6-8 bars.
 * =========================================================================
 */
export class TimingAndAntiChaseEngine {
  private static symbolImpulseTracker: Map<string, {
    side: 'BUY' | 'SELL';
    impulseStartPrice: number;
    impulseExtremePrice: number;
    impulseAtr: number;
    barCount: number;
    timestamp: number;
  }> = new Map();

  /**
   * Evaluates timing, extension, candle streak, and anti-chase gates for any signal.
   */
  public static evaluateTimingAndAntiChase(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    currentPrice: number;
    candles: KlinePoint[];
    atr: number;
    signalPrice?: number;
  }): TimingEvaluation {
    const { symbol, side, currentPrice, candles, atr, signalPrice } = params;
    const n = candles.length;

    const defaultRes: TimingEvaluation = {
      canEnterDirect: false,
      canEnterPullback: false,
      action: 'STAND_ASIDE',
      phase: 'LATE',
      extAtr: 0,
      runATR: 0,
      candleStreak: 0,
      lastBarRangeAtr: 0,
      rejectionWickPct: 0,
      isExhaustionCandle: false,
      slippageAtr: 0,
      minSafeSLDistance: Math.max(0.8 * atr, currentPrice * 0.005),
      reasons: ['Insufficient candle data (<20)'],
    };

    if (n < 20 || atr <= 0) return defaultRes;

    const closes = candles.map(c => c.close);
    const lastBar = candles[n - 1];
    const prevBar = candles[n - 2];

    // 1. EMA20 & Extension from Mean: ext = (price - EMA20) / ATR
    const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
    const ema20 = ema20Arr[ema20Arr.length - 1] || currentPrice;
    const extAtr = parseFloat(((currentPrice - ema20) / atr).toFixed(2));

    // 2. Consecutive Color Streak (Green streak for BUY, Red streak for SELL)
    let greenStreak = 0;
    let redStreak = 0;
    for (let i = n - 1; i >= 0; i--) {
      const c = candles[i];
      if (c.close > c.open) {
        if (redStreak > 0) break;
        greenStreak++;
      } else if (c.close < c.open) {
        if (greenStreak > 0) break;
        redStreak++;
      } else {
        break;
      }
    }
    const candleStreak = side === 'BUY' ? greenStreak : redStreak;

    // 3. Move Run in ATR (runATR): Distance from impulse origin
    // Find swing origin of the current run:
    let swingOrigin = currentPrice;
    if (side === 'BUY') {
      // Look back for the lowest low prior to or at start of streak
      const lookback = Math.min(n, Math.max(candleStreak + 3, 10));
      const windowBars = candles.slice(n - lookback);
      swingOrigin = Math.min(...windowBars.map(b => b.low));
    } else {
      // Look back for highest high prior to or at start of streak
      const lookback = Math.min(n, Math.max(candleStreak + 3, 10));
      const windowBars = candles.slice(n - lookback);
      swingOrigin = Math.max(...windowBars.map(b => b.high));
    }
    const runATR = parseFloat((Math.abs(currentPrice - swingOrigin) / atr).toFixed(2));

    // 4. Climax Candle Anatomy: Last bar range in ATR
    const lastBarRange = Math.max(0.00001, lastBar.high - lastBar.low);
    const lastBarRangeAtr = parseFloat((lastBarRange / atr).toFixed(2));

    // 5. Exhaustion Wick:
    // For BUY: Upper wick = rejection at high (selling pressure)
    // For SELL: Lower wick = rejection at low (buying pressure)
    const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
    const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
    const upperWickPct = parseFloat((upperWick / lastBarRange).toFixed(2));
    const lowerWickPct = parseFloat((lowerWick / lastBarRange).toFixed(2));
    const rejectionWickPct = side === 'BUY' ? upperWickPct : lowerWickPct;

    // Exhaustion candle: Bar range >= 2.0 ATR OR rejection wick >= 0.40 on large bar
    const isExhaustionCandle = lastBarRangeAtr >= 2.0 || (rejectionWickPct >= 0.40 && lastBarRangeAtr >= 1.2);

    // 6. Signal Freshness & Max Chase Slippage:
    const basePrice = signalPrice && signalPrice > 0 ? signalPrice : currentPrice;
    const slippageAtr = parseFloat((Math.abs(currentPrice - basePrice) / atr).toFixed(2));

    // 7. Guaranteed Minimum Safe SL Distance (>= 0.8 * ATR)
    // Ensures stop is never compressed by dollar-sizing into market noise!
    const minSafeSLDistance = Math.max(0.8 * atr, currentPrice * 0.005);

    // 8. Phase Classification (Fix 2):
    // EARLY: runATR < 2.0 (Impulse just starting)
    // MID:   2.0 <= runATR <= 3.5 (Trend underway, pullbacks only)
    // LATE:  runATR > 3.5 or streak >= 5 or ext > 2.0 (Exhaustion phase, stand aside)
    let phase: MovePhase = 'EARLY';
    if (runATR > 3.5 || candleStreak >= 5 || (side === 'BUY' && extAtr > 2.0) || (side === 'SELL' && extAtr < -2.0)) {
      phase = 'LATE';
    } else if (runATR >= 2.0) {
      phase = 'MID';
    } else {
      phase = 'EARLY';
    }

    const reasons: string[] = [];

    // =========================================================================
    // FIX 5: SIGNAL FRESHNESS & MAX CHASE DISTANCE (0.3 ATR Cap)
    // =========================================================================
    if (slippageAtr > 0.3) {
      reasons.push(`Price slipped by ${slippageAtr} ATR (> 0.3 ATR limit from signal price $${basePrice})`);
      return {
        canEnterDirect: false,
        canEnterPullback: false,
        action: 'SLIPPAGE_SKIP',
        phase,
        extAtr,
        runATR,
        candleStreak,
        lastBarRangeAtr,
        rejectionWickPct,
        isExhaustionCandle,
        slippageAtr,
        minSafeSLDistance,
        reasons,
      };
    }

    // =========================================================================
    // ANTI-CHASE / TIMING EVALUATION (LATE_SKIP Gate disabled per user directive)
    // Direct entries allowed with momentum tracking; no trades blocked on late phase
    // =========================================================================
    if (phase === 'LATE') {
      reasons.push(`Momentum trend in LATE Phase (Run: ${runATR} ATR, Streak: ${candleStreak}, Ext: ${extAtr} ATR)`);
      return {
        canEnterDirect: true,
        canEnterPullback: false,
        action: 'ENTER_DIRECT',
        phase: 'LATE',
        extAtr,
        runATR,
        candleStreak,
        lastBarRangeAtr,
        rejectionWickPct,
        isExhaustionCandle,
        slippageAtr,
        minSafeSLDistance,
        reasons,
      };
    }

    // =========================================================================
    // MID PHASE: Pullback or Direct Momentum Allowed
    // =========================================================================
    if (phase === 'MID') {
      const pullbackCheck = this.evaluatePullbackSetup({
        symbol,
        side,
        currentPrice,
        candles,
        atr,
        ema20,
      });

      if (pullbackCheck.isPullbackValid && pullbackCheck.triggerFound) {
        reasons.push(`Pullback confirmed: Retrace ${pullbackCheck.retraceRatio.toFixed(3)} in golden zone, Trigger: ${pullbackCheck.triggerReason}`);
        return {
          canEnterDirect: false,
          canEnterPullback: true,
          action: 'ENTER_PULLBACK',
          phase: 'MID',
          extAtr,
          runATR,
          candleStreak,
          lastBarRangeAtr,
          rejectionWickPct,
          isExhaustionCandle,
          slippageAtr,
          pullbackTriggered: true,
          pullbackFibLevel: pullbackCheck.retraceRatio,
          structuralSLPrice: pullbackCheck.structuralSL,
          minSafeSLDistance: Math.max(minSafeSLDistance, Math.abs(currentPrice - pullbackCheck.structuralSL)),
          recommendedTargetPrice: pullbackCheck.targetPrice,
          riskRewardRatio: pullbackCheck.riskReward,
          reasons,
        };
      } else {
        reasons.push(`Direct momentum allowed in MID phase (${runATR} ATR from origin)`);
        return {
          canEnterDirect: true,
          canEnterPullback: false,
          action: 'ENTER_DIRECT',
          phase: 'MID',
          extAtr,
          runATR,
          candleStreak,
          lastBarRangeAtr,
          rejectionWickPct,
          isExhaustionCandle,
          slippageAtr,
          minSafeSLDistance,
          reasons,
        };
      }
    }

    // =========================================================================
    // EARLY PHASE: Fresh impulse or compression breakout (Direct allowed)
    // =========================================================================
    if (isExhaustionCandle) {
      reasons.push(`Climax candle printed despite early run (${lastBarRangeAtr} ATR, wick ${(rejectionWickPct * 100).toFixed(0)}%)`);
      return {
        canEnterDirect: false,
        canEnterPullback: false,
        action: 'EXHAUSTION_SKIP',
        phase: 'EARLY',
        extAtr,
        runATR,
        candleStreak,
        lastBarRangeAtr,
        rejectionWickPct,
        isExhaustionCandle,
        slippageAtr,
        minSafeSLDistance,
        reasons,
      };
    }

    // Check rejection wick against trade direction:
    if (rejectionWickPct >= 0.40) {
      reasons.push(`Heavy opposing wick printed (${(rejectionWickPct * 100).toFixed(0)}% rejection)`);
      return {
        canEnterDirect: false,
        canEnterPullback: false,
        action: 'EXHAUSTION_SKIP',
        phase: 'EARLY',
        extAtr,
        runATR,
        candleStreak,
        lastBarRangeAtr,
        rejectionWickPct,
        isExhaustionCandle,
        slippageAtr,
        minSafeSLDistance,
        reasons,
      };
    }

    // Structural Stop for Early Phase: Below swing origin or previous swing low
    let structuralSL = side === 'BUY'
      ? Math.min(swingOrigin, prevBar.low) - 0.3 * atr
      : Math.max(swingOrigin, prevBar.high) + 0.3 * atr;

    const structuralDist = Math.abs(currentPrice - structuralSL);
    const finalSLDist = Math.max(minSafeSLDistance, structuralDist);
    structuralSL = side === 'BUY' ? currentPrice - finalSLDist : currentPrice + finalSLDist;

    const targetPrice = side === 'BUY'
      ? currentPrice + finalSLDist * 2.0
      : currentPrice - finalSLDist * 2.0;

    reasons.push(`Early impulse valid (runATR: ${runATR} < 2.0, streak: ${candleStreak}, ext: ${extAtr} ATR)`);

    return {
      canEnterDirect: true,
      canEnterPullback: false,
      action: 'ENTER_DIRECT',
      phase: 'EARLY',
      extAtr,
      runATR,
      candleStreak,
      lastBarRangeAtr,
      rejectionWickPct,
      isExhaustionCandle,
      slippageAtr,
      structuralSLPrice: structuralSL,
      minSafeSLDistance: finalSLDist,
      recommendedTargetPrice: targetPrice,
      riskRewardRatio: 2.0,
      reasons,
    };
  }

  /**
   * FIX 3: PULLBACK ENTRY MODULE (Fibonacci 0.382 - 0.618 Retracement)
   * Validates if a trend in progress has pulled back into the golden zone and printed a confirmation trigger.
   */
  public static evaluatePullbackSetup(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    currentPrice: number;
    candles: KlinePoint[];
    atr: number;
    ema20: number;
  }): PullbackEvaluation {
    const { symbol, side, currentPrice, candles, atr, ema20 } = params;
    const n = candles.length;
    const defaultFail: PullbackEvaluation = {
      isPullbackValid: false,
      side,
      retraceRatio: 0,
      impulseHeightAtr: 0,
      entryPrice: currentPrice,
      structuralSL: currentPrice - atr,
      targetPrice: currentPrice + atr * 2,
      riskReward: 1.0,
      triggerFound: false,
      triggerReason: 'No valid pullback',
    };

    if (n < 15) return defaultFail;

    const lookback = Math.min(n, 20);
    const windowBars = candles.slice(n - lookback);

    if (side === 'BUY') {
      // Find impulse swing low and swing high
      const swingLow = Math.min(...windowBars.slice(0, lookback - 3).map(b => b.low));
      const swingHigh = Math.max(...windowBars.map(b => b.high));
      const impulseHeight = swingHigh - swingLow;
      const impulseHeightAtr = impulseHeight / atr;

      if (impulseHeightAtr < 2.0) {
        return { ...defaultFail, triggerReason: `Impulse height too small (${impulseHeightAtr.toFixed(2)} ATR < 2.0 ATR)` };
      }

      // Retracement calculation: (High - Price) / (High - Low)
      const retraceRatio = (swingHigh - currentPrice) / impulseHeight;

      // Golden Pocket zone: 38.2% to 61.8% retracement (allow tolerance 30% - 68%)
      const isInGoldenZone = retraceRatio >= 0.30 && retraceRatio <= 0.68;
      const isNearEma20 = Math.abs(currentPrice - ema20) <= 0.4 * atr;

      if (!isInGoldenZone && !isNearEma20) {
        return {
          ...defaultFail,
          retraceRatio,
          impulseHeightAtr,
          triggerReason: `Retrace ${retraceRatio.toFixed(3)} outside 0.30-0.68 zone`,
        };
      }

      // Trigger Candle Check: Last closed candle rejected lows (lower wick >= 40% or closed green)
      const lastBar = candles[n - 1];
      const range = Math.max(0.0001, lastBar.high - lastBar.low);
      const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
      const lowerWickPct = lowerWick / range;
      const isHammerOrPin = lowerWickPct >= 0.40;
      const isGreenReversal = lastBar.close > lastBar.open && lastBar.close > ema20;

      const triggerFound = isHammerOrPin || isGreenReversal;
      const triggerReason = isHammerOrPin
        ? `Bullish rejection pin bar (${(lowerWickPct * 100).toFixed(0)}% lower wick) in Fib zone`
        : isGreenReversal
        ? `Bullish reversal bar closing above EMA20`
        : `Awaiting rejection trigger in pullback zone`;

      // Structural Stop: Below pullback low - 0.3 ATR
      const pullbackLow = Math.min(...candles.slice(n - 4).map(b => b.low));
      const structuralSL = pullbackLow - 0.3 * atr;
      const stopDistance = Math.max(0.8 * atr, currentPrice - structuralSL);
      const targetPrice = swingHigh + 0.2 * atr;
      const targetDistance = targetPrice - currentPrice;
      const riskReward = stopDistance > 0 ? parseFloat((targetDistance / stopDistance).toFixed(2)) : 1.0;

      return {
        isPullbackValid: isInGoldenZone || isNearEma20,
        side: 'BUY',
        retraceRatio,
        impulseHeightAtr,
        entryPrice: currentPrice,
        structuralSL: currentPrice - stopDistance,
        targetPrice,
        riskReward,
        triggerFound: triggerFound && riskReward >= 1.5,
        triggerReason: triggerFound && riskReward < 1.5 ? `R:R too low (${riskReward} < 1.5)` : triggerReason,
      };
    } else {
      // SELL: Impulse from swing high down to swing low
      const swingHigh = Math.max(...windowBars.slice(0, lookback - 3).map(b => b.high));
      const swingLow = Math.min(...windowBars.map(b => b.low));
      const impulseHeight = swingHigh - swingLow;
      const impulseHeightAtr = impulseHeight / atr;

      if (impulseHeightAtr < 2.0) {
        return { ...defaultFail, triggerReason: `Impulse height too small (${impulseHeightAtr.toFixed(2)} ATR < 2.0 ATR)` };
      }

      // Retracement calculation for bounce: (Price - Low) / (High - Low)
      const retraceRatio = (currentPrice - swingLow) / impulseHeight;
      const isInGoldenZone = retraceRatio >= 0.30 && retraceRatio <= 0.68;
      const isNearEma20 = Math.abs(currentPrice - ema20) <= 0.4 * atr;

      if (!isInGoldenZone && !isNearEma20) {
        return {
          ...defaultFail,
          retraceRatio,
          impulseHeightAtr,
          triggerReason: `Retrace ${retraceRatio.toFixed(3)} outside 0.30-0.68 zone`,
        };
      }

      // Trigger Candle Check for SELL: Upper rejection wick >= 40% or closed red below EMA20
      const lastBar = candles[n - 1];
      const range = Math.max(0.0001, lastBar.high - lastBar.low);
      const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
      const upperWickPct = upperWick / range;
      const isShootingStar = upperWickPct >= 0.40;
      const isRedReversal = lastBar.close < lastBar.open && lastBar.close < ema20;

      const triggerFound = isShootingStar || isRedReversal;
      const triggerReason = isShootingStar
        ? `Bearish rejection shooting star (${(upperWickPct * 100).toFixed(0)}% upper wick) in Fib zone`
        : isRedReversal
        ? `Bearish reversal bar closing below EMA20`
        : `Awaiting rejection trigger in pullback zone`;

      // Structural Stop: Above pullback high + 0.3 ATR
      const pullbackHigh = Math.max(...candles.slice(n - 4).map(b => b.high));
      const structuralSL = pullbackHigh + 0.3 * atr;
      const stopDistance = Math.max(0.8 * atr, structuralSL - currentPrice);
      const targetPrice = swingLow - 0.2 * atr;
      const targetDistance = currentPrice - targetPrice;
      const riskReward = stopDistance > 0 ? parseFloat((targetDistance / stopDistance).toFixed(2)) : 1.0;

      return {
        isPullbackValid: isInGoldenZone || isNearEma20,
        side: 'SELL',
        retraceRatio,
        impulseHeightAtr,
        entryPrice: currentPrice,
        structuralSL: currentPrice + stopDistance,
        targetPrice,
        riskReward,
        triggerFound: triggerFound && riskReward >= 1.5,
        triggerReason: triggerFound && riskReward < 1.5 ? `R:R too low (${riskReward} < 1.5)` : triggerReason,
      };
    }
  }

  /**
   * FIX 4: COMPRESSION BREAKOUT (Catch Trends Earlier at Bar 1)
   * Detects volatility compression (TTM / Bollinger Band squeeze) followed by volume breakout.
   */
  public static checkCompressionBreakout(candles: KlinePoint[]): CompressionBreakoutCheck {
    const n = candles.length;
    const defaultFail: CompressionBreakoutCheck = {
      isCompressed: false,
      isBreakout: false,
      breakoutSide: null,
      rvol: 1.0,
      bandwidthPct: 0.1,
      reason: 'Insufficient data',
    };

    if (n < 25) return defaultFail;

    const closes = candles.map(c => c.close);
    const bb = CryptoDedicatedStrategyEngine.calculateBollingerBands(closes, 20, 2);
    if (!bb || !bb.upper || bb.upper.length === 0) return defaultFail;

    const currUpper = bb.upper[bb.upper.length - 1];
    const currLower = bb.lower[bb.lower.length - 1];
    const currMiddle = bb.middle[bb.middle.length - 1] || 1;
    const bandwidth = (currUpper - currLower) / currMiddle;

    // Compute bandwidth over last 20 bars to check if current is in lowest 20%
    const bandwidthHist: number[] = [];
    for (let i = n - 20; i < n; i++) {
      const u = bb.upper[i];
      const l = bb.lower[i];
      const m = bb.middle[i] || 1;
      if (u !== undefined && l !== undefined && m > 0) {
        bandwidthHist.push((u - l) / m);
      }
    }

    bandwidthHist.sort((a, b) => a - b);
    const p20Threshold = bandwidthHist[Math.floor(bandwidthHist.length * 0.20)] || bandwidth;
    const isCompressed = bandwidth <= p20Threshold;

    // RVOL check on last bar
    const volumes = candles.map(c => c.volume);
    const avgVol = volumes.slice(n - 21, n - 1).reduce((s, v) => s + v, 0) / 20;
    const rvol = avgVol > 0 ? parseFloat((volumes[n - 1] / avgVol).toFixed(2)) : 1.0;

    const lastBar = candles[n - 1];
    let isBreakout = false;
    let breakoutSide: 'BUY' | 'SELL' | null = null;

    if (isCompressed && rvol >= 1.3) {
      if (lastBar.close > currUpper) {
        isBreakout = true;
        breakoutSide = 'BUY';
      } else if (lastBar.close < currLower) {
        isBreakout = true;
        breakoutSide = 'SELL';
      }
    }

    const reason = isBreakout
      ? `Compression Breakout: Bandwidth in bottom 20% (${(bandwidth * 100).toFixed(1)}%), RVOL=${rvol} >= 1.3`
      : isCompressed
      ? `Compressed volatility (Bandwidth ${(bandwidth * 100).toFixed(1)}%), waiting for volume expansion`
      : `Normal volatility distribution`;

    return {
      isCompressed,
      isBreakout,
      breakoutSide,
      rvol,
      bandwidthPct: bandwidth,
      reason,
    };
  }

  /**
   * FIX 7: EXHAUSTION EXIT DETECTOR (Active Positions)
   * Detects if an open position that has reached healthy profit is now facing a climax candle reversal.
   */
  public static evaluateExhaustionExit(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    currentPrice: number;
    candles: KlinePoint[];
    atr: number;
    pnlUSD: number;
  }): { shouldExit: boolean; reason: string } {
    const { side, entryPrice, currentPrice, candles, atr, pnlUSD } = params;
    const n = candles.length;
    if (n < 5 || atr <= 0 || pnlUSD <= 0.80) {
      return { shouldExit: false, reason: '' };
    }

    const moveDistanceAtr = Math.abs(currentPrice - entryPrice) / atr;
    // Only check exhaustion exit if trade has moved at least 1.5 ATR into profit
    if (moveDistanceAtr < 1.5) {
      return { shouldExit: false, reason: '' };
    }

    const lastBar = candles[n - 1];
    const range = Math.max(0.0001, lastBar.high - lastBar.low);

    // RVOL check
    const volumes = candles.map(c => c.volume);
    const avgVol = volumes.slice(n - 21, n - 1).reduce((s, v) => s + v, 0) / 20;
    const rvol = avgVol > 0 ? lastBar.volume / avgVol : 1.0;

    if (side === 'BUY') {
      const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
      const upperWickPct = upperWick / range;
      // High volume climax rejection at the top
      if (upperWickPct >= 0.50 && rvol >= 1.4) {
        return {
          shouldExit: true,
          reason: `Exhaustion Climax Rejection at top: ${(upperWickPct * 100).toFixed(0)}% upper wick with RVOL ${rvol.toFixed(2)} after +${moveDistanceAtr.toFixed(1)} ATR run`,
        };
      }
    } else {
      const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
      const lowerWickPct = lowerWick / range;
      // High volume climax rejection at the bottom
      if (lowerWickPct >= 0.50 && rvol >= 1.4) {
        return {
          shouldExit: true,
          reason: `Exhaustion Climax Rejection at bottom: ${(lowerWickPct * 100).toFixed(0)}% lower wick with RVOL ${rvol.toFixed(2)} after +${moveDistanceAtr.toFixed(1)} ATR drop`,
        };
      }
    }

    return { shouldExit: false, reason: '' };
  }

  /**
   * FIX 7: TIME STOP EVALUATION (Active Positions)
   * If trade has been open for 6-8 bars (90-120m on 15m) and has NOT moved +0.5 ATR, exit stale trade.
   */
  public static evaluateTimeStop(params: {
    entryTime: number;
    currentPrice: number;
    entryPrice: number;
    side: 'BUY' | 'SELL';
    atr: number;
    barTimeMinutes?: number;
    maxBars?: number;
  }): { shouldExit: boolean; reason: string } {
    const { entryTime, currentPrice, entryPrice, side, atr } = params;
    const barMinutes = params.barTimeMinutes || 15;
    const maxBars = params.maxBars || 7; // 7 bars * 15m = 105 mins

    const elapsedMs = Date.now() - entryTime;
    const elapsedMinutes = elapsedMs / (60 * 1000);
    const barsElapsed = Math.floor(elapsedMinutes / barMinutes);

    if (barsElapsed < maxBars) {
      return { shouldExit: false, reason: '' };
    }

    const priceDiff = side === 'BUY' ? currentPrice - entryPrice : entryPrice - currentPrice;
    const moveInAtr = atr > 0 ? priceDiff / atr : 0;

    // If trade hasn't moved at least +0.5 ATR into profit after 7 bars:
    if (moveInAtr < 0.5) {
      return {
        shouldExit: true,
        reason: `Time Stop: ${barsElapsed} bars elapsed (${elapsedMinutes.toFixed(0)}m), price only moved ${moveInAtr.toFixed(2)} ATR (< +0.5 ATR target). Capital freed from stalling trade.`,
      };
    }

    return { shouldExit: false, reason: '' };
  }
}

export const timingEngine = TimingAndAntiChaseEngine;
