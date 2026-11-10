import { KlinePoint } from '../../src/types';
import { fractalFlowVolumeProfile3004Engine } from '../strategies/fractalFlowVolumeProfile3004Engine';

/**
 * ============================================================================
 * DYNAMIC TP2 & BIG-MOVE EXPANSION ENGINE
 * 
 * Strict Implementation of Master Video Frameworks:
 * 1. TTrades: AMD Power of 3 & Standard Deviation Projections (Pcbyc9TdNsU, TCFvsZeYvV8, YESqIoA7Wyg)
 * 2. Arjo: External vs Internal Range Liquidity (ERL <-> IRL) Cycles (igAeuiM_LC4, tQbYKKW28hU)
 * 3. Traders Reality: Vector Candle Volume Expansion Filter (W1bdEUXuZ9I)
 * 4. Brad Goh: Opposing Unmitigated Zone & Breathing-Room SL (PkAtVH6YVM8)
 * ============================================================================
 */

export interface DynamicTP2Input {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  sweepExtremePrice: number;
  mssBreakPrice?: number;
  opposingZonePrice?: number;
  candles: KlinePoint[];
  accountEquity?: number;
  tickSize?: number;
}

export interface DynamicTP2Result {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLossPrice: number;
  breakevenPrice: number;
  earlyBreakevenPrice: number; // +0.75R milestone to activate Breakeven Shield
  breakevenShieldPrice: number; // Entry +/- 0.05R fee protection
  htfRegimeValid: boolean;
  htfRegimeReason: string;
  isBigMoveImminent: boolean;
  bigMoveConditions: {
    rule1A_amdAccumulation: boolean;
    rule1B_vectorSweepVolume: boolean;
    rule1C_cleanLRLRPath: boolean;
  };
  htfAlignment: 'IRL_TO_ERL' | 'ERL_TO_IRL';
  tp2Enabled: boolean;
  tp1Price: number;
  tp2Price?: number;
  tp1AllocationPct: number; // 1.0 (100%) or 0.75 (75%)
  tp2AllocationPct: number; // 0.0 (0%) or 0.25 (25%)
  riskDistance: number;
  rrTP1: number;
  rrTP2?: number;
  manipulationLeg: {
    sweepExtremePrice: number;
    mssBreakPrice: number;
    range: number;
  };
  projections: {
    stdDev1Target: number;
    stdDev2Target: number;
    stdDev25Target: number;
    erlTargetPrice: number;
    equilibriumPrice: number;
    pocPrice?: number;
  };
  reasons: string[];
}

export class DynamicTP2Engine {
  /**
   * Evaluates the complete Dynamic TP1 vs TP2 setup for any incoming trade.
   */
  public static evaluateDynamicExits(input: DynamicTP2Input): DynamicTP2Result {
    const {
      symbol,
      side,
      entryPrice,
      sweepExtremePrice,
      mssBreakPrice,
      opposingZonePrice,
      candles,
      accountEquity = 1000,
      tickSize = 0.1,
    } = input;

    const n = candles.length;
    const atr14 = this.calculateATR(candles, 14);
    const effectiveAtr = Math.max(atr14, entryPrice * 0.002);

    // -------------------------------------------------------------
    // 0. STOP-LOSS WITH BREATHING ROOM (Fix 3: PkAtVH6YVM8 Rule 0.35 - 0.48 * ATR)
    // -------------------------------------------------------------
    const curTime = candles[candles.length - 1]?.time || 0;
    const isSession = this.isInstitutionalSession(curTime);
    const isMajor = symbol.startsWith('BTC') || symbol.startsWith('ETH');
    const slMultiplier = isMajor ? 0.48 : (isSession ? 0.40 : 0.35);
    const slBuffer = Math.max(effectiveAtr * slMultiplier, tickSize * 3);
    let stopLossPrice = side === 'BUY'
      ? sweepExtremePrice - slBuffer
      : sweepExtremePrice + slBuffer;

    if (side === 'BUY') {
      stopLossPrice = Math.floor(stopLossPrice / tickSize) * tickSize;
    } else {
      stopLossPrice = Math.ceil(stopLossPrice / tickSize) * tickSize;
    }

    const riskDistance = Math.max(tickSize, Math.abs(entryPrice - stopLossPrice));
    const beBuffer = Math.max(riskDistance * 0.05, tickSize * 2);
    const breakevenPrice = side === 'BUY' ? entryPrice + beBuffer : entryPrice - beBuffer;

    // Fix 2: Early Breakeven Shield at +0.65R & Breakeven fee buffer
    const earlyBreakevenPrice = side === 'BUY'
      ? entryPrice + (riskDistance * 0.65)
      : entryPrice - (riskDistance * 0.65);
    const breakevenShieldPrice = breakevenPrice;

    // Fix 4: HTF Regime & Displacement Validation
    const htfRegime = this.validateHTFRegimeAndDisplacement(side, candles);

    // -------------------------------------------------------------
    // STEP 1: "BIG MOVE INCOMING" DETECTOR (IS_BIG_MOVE_IMMINENT)
    // -------------------------------------------------------------
    // Rule 1A: TTrades AMD Accumulation Box
    // Prior N candles (12+ bars) in tight volatility compression: ATR(14) < 0.85 * SMA(ATR(14), 50)
    const rule1A_amdAccumulation = this.checkAMDAccumulationCompression(candles);

    // Rule 1B: Traders Reality Vector Manipulation Sweep
    // Sweep candle volume >= 1.5x 20-bar average volume OR London/NY open window
    const rule1B_vectorSweepVolume = this.checkVectorVolumeOrSession(candles);

    // Rule 1C: Low Resistance Liquidity Run (LRLR)
    // Unmitigated LVN / FVG pathway ahead with no opposing 1H/4H order block within first 2.0R
    const vpResult = fractalFlowVolumeProfile3004Engine.calculateVolumeProfile(candles.slice(-60));
    const rule1C_cleanLRLRPath = this.checkLRLRPathway(side, entryPrice, riskDistance, candles, vpResult);

    // Big Move Imminent: AMD Accumulation OR Vector Volume/Session Sweep, with Clean LRLR Pathway ahead
    const isBigMoveImminent = (rule1A_amdAccumulation || rule1B_vectorSweepVolume) && rule1C_cleanLRLRPath;

    // -------------------------------------------------------------
    // STEP 2 & 3: ARJO ERL <-> IRL LIQUIDITY CYCLE
    // -------------------------------------------------------------
    const dealingRange = this.analyzeDealingRange(candles);
    const htfTrend = this.determineHTFTrend(candles);

    // Arjo IRL vs ERL Evaluation:
    // - IRL -> ERL: Trade aligns with HTF trend and swept an internal swing/inducement
    //   inside the dealing range (e.g. discount zone in bull trend, premium in bear trend)
    //   with room to expand toward the major dealing range boundary (ERL High/Low).
    // - ERL -> IRL: Trade is counter to HTF trend OR swept the major external boundary (ERL)
    //   and is only mean-reverting back into the dealing range toward 50% equilibrium / POC.
    let htfAlignment: 'IRL_TO_ERL' | 'ERL_TO_IRL' = 'ERL_TO_IRL';

    if (side === 'BUY') {
      const isExternalBoundary = sweepExtremePrice <= dealingRange.htfLow + (effectiveAtr * 0.15);
      const isInternalSweep = !isExternalBoundary;
      const hasRoomToERL = (dealingRange.htfHigh - entryPrice) >= (riskDistance * 2.0);

      if (htfTrend === 'BULLISH' && isInternalSweep && hasRoomToERL) {
        htfAlignment = 'IRL_TO_ERL';
      } else {
        htfAlignment = 'ERL_TO_IRL';
      }
    } else {
      const isExternalBoundary = sweepExtremePrice >= dealingRange.htfHigh - (effectiveAtr * 0.15);
      const isInternalSweep = !isExternalBoundary;
      const hasRoomToERL = (entryPrice - dealingRange.htfLow) >= (riskDistance * 2.0);

      if (htfTrend === 'BEARISH' && isInternalSweep && hasRoomToERL) {
        htfAlignment = 'IRL_TO_ERL';
      } else {
        htfAlignment = 'ERL_TO_IRL';
      }
    }

    // -------------------------------------------------------------
    // MANIPULATION LEG & TTRADES STANDARD DEVIATION PROJECTIONS
    // -------------------------------------------------------------
    const mssRef = mssBreakPrice || (side === 'BUY'
      ? sweepExtremePrice + (riskDistance * 1.0)
      : sweepExtremePrice - (riskDistance * 1.0));
    const manipulationRange = Math.max(effectiveAtr * 0.6, Math.abs(mssRef - sweepExtremePrice));

    let stdDev1Target: number;
    let stdDev2Target: number;
    let stdDev25Target: number;

    if (side === 'BUY') {
      stdDev1Target = sweepExtremePrice + (1.5 * manipulationRange);
      stdDev2Target = sweepExtremePrice + (2.0 * manipulationRange);
      stdDev25Target = sweepExtremePrice + (2.5 * manipulationRange);
    } else {
      stdDev1Target = sweepExtremePrice - (1.5 * manipulationRange);
      stdDev2Target = sweepExtremePrice - (2.0 * manipulationRange);
      stdDev25Target = sweepExtremePrice - (2.5 * manipulationRange);
    }

    // ERL target pool
    const erlTargetPrice = side === 'BUY' ? dealingRange.htfHigh : dealingRange.htfLow;

    // -------------------------------------------------------------
    // TP2 ELIGIBILITY DECISION
    // -------------------------------------------------------------
    // STEP 2: When NOT to set TP2
    // Trade is Counter-Trend (ERL -> IRL) OR IS_BIG_MOVE_IMMINENT == FALSE
    // -> 100% exit at TP1 (1:1.5 - 1:2 R:R, Equilibrium, or POC)
    // STEP 2 & 3: TP2 Big-Move eligibility strictly requires London/NY Session + IRL->ERL cycle + Big Move criteria
    const tp2Eligible = isSession && htfAlignment === 'IRL_TO_ERL' && isBigMoveImminent;

    const reasons: string[] = [];
    let tp1Price: number;
    let tp2Price: number | undefined;
    let tp1AllocationPct: number;
    let tp2AllocationPct: number;

    // FIX 2: High-Probability TP1 at 1.15R (Internal Liquidity Lock per User Mandate)
    // Set TP1 = 1.15R (or nearest internal FVG/POC between 0.90R and 1.35R)
    const base1RPrice = side === 'BUY'
      ? entryPrice + (riskDistance * 1.15)
      : entryPrice - (riskDistance * 1.15);

    tp1Price = base1RPrice;
    if (side === 'BUY') {
      if (vpResult.poc > entryPrice && vpResult.poc >= entryPrice + (riskDistance * 0.90) && vpResult.poc <= entryPrice + (riskDistance * 1.35)) {
        tp1Price = vpResult.poc;
      }
      tp1Price = Math.floor(tp1Price / tickSize) * tickSize;
    } else {
      if (vpResult.poc < entryPrice && vpResult.poc <= entryPrice - (riskDistance * 0.90) && vpResult.poc >= entryPrice - (riskDistance * 1.35)) {
        tp1Price = vpResult.poc;
      }
      tp1Price = Math.ceil(tp1Price / tickSize) * tickSize;
    }

    if (!tp2Eligible) {
      // 100% Exit at TP1 (1.0R Internal Liquidity)
      tp2AllocationPct = 0.0;
      tp1AllocationPct = 1.0;

      reasons.push(
        htfAlignment === 'ERL_TO_IRL'
          ? 'Arjo Rule: Counter-trend ERL->IRL re-entry into equilibrium (TP2 disabled, 100% exit at 1.0R TP1)'
          : 'Big-Move filter not triggered: Volatility/Volume criteria not met (TP2 disabled, 100% exit at 1.0R TP1)'
      );
    } else {
      // STEP 3: When TO set TP2 (SPLIT 75% TP1 + 25% RUNNER TP2)
      // 75% at TP1 (1.0R / -1.0 StdDev), Move SL to BE, 25% Runner at TP2 (-2.0 to -2.5 StdDev / ERL)
      tp1AllocationPct = 0.75;
      tp2AllocationPct = 0.25;

      if (side === 'BUY') {
        // TP2: Confluence of -2.0 to -2.5 StdDev and ERL / opposing zone
        const zoneRef = opposingZonePrice && opposingZonePrice > entryPrice ? opposingZonePrice : erlTargetPrice;
        tp2Price = Math.min(stdDev25Target, Math.max(stdDev2Target, zoneRef));
        tp2Price = Math.floor(tp2Price / tickSize) * tickSize;
      } else {
        // TP2: Confluence of -2.0 to -2.5 StdDev and ERL / opposing zone
        const zoneRef = opposingZonePrice && opposingZonePrice < entryPrice && opposingZonePrice > 0 ? opposingZonePrice : erlTargetPrice;
        tp2Price = Math.max(stdDev25Target, Math.min(stdDev2Target, zoneRef));
        tp2Price = Math.ceil(tp2Price / tickSize) * tickSize;
      }

      reasons.push('Arjo IRL->ERL Cycle: Swept inducement inside HTF trend (TP2 Runner ENABLED)');
      reasons.push('TTrades AMD Projections: TP1 at 1.0R (75% exit), TP2 at -2.0 to -2.5 StdDev (25% runner)');
      reasons.push('Traders Reality Vector Volume verified: High expansion probability');
    }

    const rrTP1 = Number((Math.abs(tp1Price - entryPrice) / riskDistance).toFixed(2));
    const rrTP2 = tp2Price ? Number((Math.abs(tp2Price - entryPrice) / riskDistance).toFixed(2)) : undefined;

    return {
      symbol,
      side,
      entryPrice,
      stopLossPrice,
      breakevenPrice,
      earlyBreakevenPrice,
      breakevenShieldPrice,
      htfRegimeValid: htfRegime.valid,
      htfRegimeReason: htfRegime.reason,
      isBigMoveImminent,
      bigMoveConditions: {
        rule1A_amdAccumulation,
        rule1B_vectorSweepVolume,
        rule1C_cleanLRLRPath,
      },
      htfAlignment,
      tp2Enabled: tp2Eligible,
      tp1Price,
      tp2Price,
      tp1AllocationPct,
      tp2AllocationPct,
      riskDistance,
      rrTP1,
      rrTP2,
      manipulationLeg: {
        sweepExtremePrice,
        mssBreakPrice: mssRef,
        range: manipulationRange,
      },
      projections: {
        stdDev1Target,
        stdDev2Target,
        stdDev25Target,
        erlTargetPrice,
        equilibriumPrice: dealingRange.equilibrium,
        pocPrice: vpResult.poc,
      },
      reasons,
    };
  }

  /**
   * Rule 1A: TTrades AMD Accumulation Box
   * Prior N candles (12+ bars) in tight volatility compression: ATR(14) < 0.85 * SMA(ATR(14), 50)
   */
  public static checkAMDAccumulationCompression(candles: KlinePoint[]): boolean {
    if (candles.length < 50) return false;

    // Check consolidation compression in the 12 to 24 bars preceding the trigger
    const lookbackBars = Math.min(candles.length - 2, 50);
    const atrSeries: number[] = [];
    for (let i = candles.length - lookbackBars; i < candles.length - 1; i++) {
      const slice = candles.slice(0, i + 1);
      atrSeries.push(this.calculateATR(slice, 14));
    }

    if (atrSeries.length === 0) return false;
    const avgAtr50 = atrSeries.reduce((sum, v) => sum + v, 0) / atrSeries.length;
    
    // Check recent 12-bar consolidation ATR
    const recentAtr12 = atrSeries.slice(-12);
    const minRecentAtr = Math.min(...recentAtr12);
    const currentAtr = atrSeries[atrSeries.length - 1];

    // True if either the recent consolidation had ATR < 0.85 * avgAtr50 or current ATR is compressed
    return minRecentAtr < (0.85 * avgAtr50) || currentAtr < (0.88 * avgAtr50);
  }

  /**
   * Session Timing Window: London Open (07:00 - 10:00 UTC) & New York Open (12:30 - 15:30 UTC)
   */
  public static isInstitutionalSession(timestamp: number): boolean {
    const d = new Date(timestamp);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const timeDec = h + (m / 60);

    // London Open: 07:00 - 10:00 UTC
    const isLondon = timeDec >= 7.0 && timeDec <= 10.0;
    // New York Open: 12:30 - 15:30 UTC
    const isNewYork = timeDec >= 12.5 && timeDec <= 15.5;

    return isLondon || isNewYork;
  }

  /**
   * Rule 1B: Traders Reality Vector Manipulation Sweep
   * Sweep candle volume >= 1.4x 20-bar average volume OR occurs in London/NY Session Open window
   */
  public static checkVectorVolumeOrSession(candles: KlinePoint[]): boolean {
    if (candles.length < 21) return false;

    const prev20Candles = candles.slice(-25, -5);
    const avgVolume20 = prev20Candles.reduce((sum, c) => sum + (c.volume || 1), 0) / Math.max(1, prev20Candles.length);

    // Check last 4 candles for the sweep volume spike (since entry is 1-3 bars after sweep)
    const recent4Candles = candles.slice(-4);
    const hasVolumeSpike = recent4Candles.some(c => (c.volume || 0) >= (1.40 * avgVolume20));

    // Session Open Window check (London Open: 07:00-10:00 UTC, NY Open: 12:30-15:30 UTC)
    const currentCandle = candles[candles.length - 1];
    const isSessionWindow = this.isInstitutionalSession(currentCandle.time);

    return hasVolumeSpike || isSessionWindow;
  }

  /**
   * Rule 1C: Low Resistance Liquidity Run (LRLR)
   * Pathway ahead has clean LVN / FVG pathway with no opposing 1H/4H order block within 2.0R
   */
  public static checkLRLRPathway(
    side: 'BUY' | 'SELL',
    entryPrice: number,
    riskDistance: number,
    candles: KlinePoint[],
    vp: { poc: number; vah: number; val: number }
  ): boolean {
    const target2RPrice = side === 'BUY'
      ? entryPrice + (2.0 * riskDistance)
      : entryPrice - (2.0 * riskDistance);

    // Check if high-volume POC acts as an immediate brick wall within 0.8R
    const distanceToPoc = Math.abs(vp.poc - entryPrice);
    if (distanceToPoc < (0.8 * riskDistance) && vp.poc > 0) {
      if (side === 'BUY' && vp.poc > entryPrice) return false;
      if (side === 'SELL' && vp.poc < entryPrice) return false;
    }

    // Check for heavy opposing wick rejections in recent price action blocking the 2.0R run
    const lookback = Math.min(25, candles.length - 1);
    const recentBars = candles.slice(-lookback - 1, -1);

    let heavyWickCount = 0;
    for (const b of recentBars) {
      if (side === 'BUY' && b.high > entryPrice && b.high < target2RPrice) {
        const body = Math.abs(b.close - b.open);
        const wick = b.high - Math.max(b.close, b.open);
        if (wick > body * 2.0) heavyWickCount++;
      } else if (side === 'SELL' && b.low < entryPrice && b.low > target2RPrice) {
        const body = Math.abs(b.close - b.open);
        const wick = Math.min(b.close, b.open) - b.low;
        if (wick > body * 2.0) heavyWickCount++;
      }
    }

    return heavyWickCount < 2;
  }

  /**
   * Analyzes Macro Dealing Range (High, Low, 50% Equilibrium) over ~100 bars
   */
  public static analyzeDealingRange(candles: KlinePoint[]): {
    htfHigh: number;
    htfLow: number;
    equilibrium: number;
  } {
    const lookback = Math.min(candles.length, 100);
    const subset = candles.slice(-lookback);

    let htfHigh = -Infinity;
    let htfLow = Infinity;
    for (const c of subset) {
      if (c.high > htfHigh) htfHigh = c.high;
      if (c.low < htfLow) htfLow = c.low;
    }

    const equilibrium = (htfHigh + htfLow) / 2;
    return { htfHigh, htfLow, equilibrium };
  }

  /**
   * Determines Higher Timeframe Trend (Bullish / Bearish / Sideways)
   * Using 4H/1H equivalent moving averages (EMA 30 vs EMA 90 on 15m)
   */
  public static determineHTFTrend(candles: KlinePoint[]): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' {
    if (candles.length < 40) return 'SIDEWAYS';

    const closes = candles.map(c => c.close);
    const ema30 = this.calculateEMA(closes, 30);
    const ema90 = this.calculateEMA(closes, 90);

    const curEma30 = ema30[ema30.length - 1];
    const curEma90 = ema90[ema90.length - 1];

    if (curEma30 >= curEma90) return 'BULLISH';
    return 'BEARISH';
  }

  /**
   * UPGRADED: Top-Down Timeframe Refinement (1H/4H Macro Bias) & Session Timing Filter
   * 1. Top-Down 1H/4H Directional Bias dictates allowed trade direction.
   * 2. London Open (07:00 - 10:00 UTC) and NY Open (12:30 - 15:30 UTC) prioritized for execution.
   * 3. 15m executes on clean Liquidity Sweep + MSS displacement + 1.0R TP1 lock.
   */
  public static validateHTFRegimeAndDisplacement(
    side: 'BUY' | 'SELL',
    candles: KlinePoint[]
  ): { valid: boolean; reason: string } {
    if (candles.length < 30) return { valid: true, reason: 'Warmup period' };

    const n = candles.length;
    const curCandle = candles[n - 1];
    const isSession = this.isInstitutionalSession(curCandle.time);

    // Calculate 20-bar average body size & volume
    let sumBody = 0;
    let sumVol = 0;
    const lookback = Math.min(20, n - 2);
    for (let i = n - 1 - lookback; i < n - 1; i++) {
      sumBody += Math.abs(candles[i].close - candles[i].open);
      sumVol += (candles[i].volume || 1);
    }
    const avgBody20 = sumBody / Math.max(1, lookback);
    const avgVol20 = sumVol / Math.max(1, lookback);

    // Impulsive displacement check in recent 3 candles:
    // London/NY Open provides natural institutional volatility expansion (07:00 - 10:00 UTC & 12:30 - 15:30 UTC)
    const recent3 = candles.slice(-3);
    const requiredMult = isSession ? 1.15 : 1.30;
    const hasDisplacement = recent3.some(c => Math.abs(c.close - c.open) >= (requiredMult * avgBody20));
    const hasVolExpansion = recent3.some(c => (c.volume || 0) >= (1.35 * avgVol20));

    // Session Timing Filter: Prioritize institutional expansion during London/NY open.
    // Outside prime session windows, require displacement or volume expansion.
    if (!isSession && !hasDisplacement && !hasVolExpansion) {
      return { valid: false, reason: 'Off-session chop: Outside London/NY session and no displacement or volume spike' };
    }

    // Top-Down Macro Directional Bias (1H / 4H via EMA16 / EMA64 & EMA30 / EMA90 on 15m)
    const closes = candles.map(c => c.close);
    const ema16 = this.calculateEMA(closes, 16); // 1H equivalent
    const ema64 = this.calculateEMA(closes, 64); // 4H equivalent
    const curEma16 = ema16[ema16.length - 1];
    const curEma64 = ema64[ema64.length - 1];

    const ema30 = this.calculateEMA(closes, 30);
    const ema90 = this.calculateEMA(closes, 90);
    const curEma30 = ema30[ema30.length - 1];
    const curEma90 = ema90[ema90.length - 1];

    // Institutional Macro Directional Alignment: Both 1H and 4H vectors must agree
    const isBullishHTF = (curEma16 >= curEma64) && (curEma30 >= curEma90) && (closes[closes.length - 1] >= curEma64 * 0.995);
    const isBearishHTF = (curEma16 < curEma64) && (curEma30 < curEma90) && (closes[closes.length - 1] <= curEma64 * 1.005);

    // 14-period RSI for exhaustion reversals
    const rsi14 = this.calculateRSI(closes, 14);

    if (side === 'BUY') {
      const isTrendAligned = isBullishHTF;
      const isExtremeExhaustion = isBearishHTF && rsi14 < 35;
      if (!isTrendAligned && !isExtremeExhaustion) {
        return { valid: false, reason: 'Counter-trend BUY blocked: 1H/4H HTF is Bearish and RSI is not oversold (<35)' };
      }
      if (!hasDisplacement && !hasVolExpansion) {
        return { valid: false, reason: 'No impulsive displacement candle body (>=1.2x 20-bar avg body)' };
      }
      return {
        valid: true,
        reason: `${isSession ? 'London/NY Session' : 'Volume Expansion'} + 1H/4H ${isTrendAligned ? 'Trend' : 'Divergence'} Confirmed`,
      };
    } else {
      const isTrendAligned = isBearishHTF;
      const isExtremeExhaustion = isBullishHTF && rsi14 > 65;
      if (!isTrendAligned && !isExtremeExhaustion) {
        return { valid: false, reason: 'Counter-trend SELL blocked: 1H/4H HTF is Bullish and RSI is not overbought (>65)' };
      }
      if (!hasDisplacement && !hasVolExpansion) {
        return { valid: false, reason: 'No impulsive displacement candle body (>=1.2x 20-bar avg body)' };
      }
      return {
        valid: true,
        reason: `${isSession ? 'London/NY Session' : 'Volume Expansion'} + 1H/4H ${isTrendAligned ? 'Trend' : 'Divergence'} Confirmed`,
      };
    }
  }

  public static calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  public static calculateATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
      trs.push(tr);
    }
    const recent = trs.slice(-period);
    return recent.reduce((sum, v) => sum + v, 0) / recent.length;
  }

  public static calculateEMA(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    const k = 2 / (period + 1);
    const ema: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  }
}
