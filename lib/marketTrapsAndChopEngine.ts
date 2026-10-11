import { KlinePoint } from './quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from './cryptoDedicatedStrategyEngine';

export interface ChopAnalysis {
  chopScore: number;          // 0 to 100
  isChopMode: boolean;        // Active chop state with hysteresis
  choppinessIndex: number;    // CI (14)
  adx: number;                // ADX (14)
  efficiencyRatio: number;    // Kaufman Efficiency Ratio (KER-14)
  rangeOverlapPct: number;    // Average consecutive range overlap % over last 8-10 bars
  medianBodyPct: number;      // Median body % over 10 bars
  whipsawEma20Count: number;  // Number of times closes crossed EMA20 in last 20 bars
  rvol: number;               // 20-period relative volume
  isCompressed: boolean;      // Bollinger Band width in lowest 15% (TTM squeeze)
  reasons: string[];
}

export interface TrapEvaluation {
  isBlockedByTrap: boolean;
  trapType?: 'FAKEOUT' | 'STOP_HUNT_SWEEP' | 'CROWDED_SQUEEZE' | 'FALLING_KNIFE_INDICATOR_TRAP' | 'WEAK_LEVEL_EXHAUSTION' | 'DEAD_VOLUME' | 'HIGH_VOL_CHOP';
  trapReason: string;
  recommendedAction: 'PASS' | 'STAND_ASIDE' | 'WAIT_RETEST' | 'FADE_TRAP' | 'REDUCE_SIZE';
}

export interface RangeStrategyCheck {
  isValidRange: boolean;
  rangeHigh: number;
  rangeLow: number;
  rangeWidthAtr: number;
  touchCountHigh: number;
  touchCountLow: number;
  isAtRangeHighEdge: boolean; // In top 20%
  isAtRangeLowEdge: boolean;  // In bottom 20%
  expectedMoveAtr: number;
  reason: string;
}

/**
 * =========================================================================
 * CHOP AND MARKET TRAPS PLAYBOOK 2026 ENGINE
 * =========================================================================
 * Objective Gatekeeper: Protects capital from:
 * 1. Choppy markets (many small losses + fee bleed)
 * 2. Fakeouts / False Breakouts (breakouts that reverse into range)
 * 3. Stop hunts / Liquidity sweeps (getting stopped out right before move)
 * 4. Crowded squeezes & liquidation cascades
 * 5. Falling knife indicator traps (oversold in heavy downtrends)
 * 6. Over-tested weak S/R levels (3+ touches weaken levels)
 * =========================================================================
 */
export class MarketTrapsAndChopEngine {
  // Hysteresis State Tracking per symbol
  // Enter CHOP at score >= 60, exit only when score <= 40 for 2 consecutive bars
  private static symbolChopState: Map<string, {
    isChop: boolean;
    consecutiveChopBars: number;
    consecutiveTrendBars: number;
    lastScore: number;
  }> = new Map();

  // Zone touch history per symbol
  private static symbolLevelTouches: Map<string, Array<{ price: number; type: 'SUPPORT' | 'RESISTANCE'; touches: number; lastTime: number }>> = new Map();

  /**
   * 1. Trend-Strength & Chop Metrics (Section 2.1 & 2.2 of Playbook)
   */
  public static evaluateChop(symbol: string, candles: KlinePoint[]): ChopAnalysis {
    const n = candles.length;
    const defaultRes: ChopAnalysis = {
      chopScore: 0,
      isChopMode: false,
      choppinessIndex: 50,
      adx: 25,
      efficiencyRatio: 0.5,
      rangeOverlapPct: 0,
      medianBodyPct: 0.5,
      whipsawEma20Count: 0,
      rvol: 1.0,
      isCompressed: false,
      reasons: [],
    };

    if (n < 25) return defaultRes;

    const closes = candles.map(c => c.close);
    const atr14 = CryptoDedicatedStrategyEngine.calculateATR(candles, 14);

    // 1. Choppiness Index (14)
    // Formula: 100 * log10(SUM(ATR1, 14) / (HH14 - LL14)) / log10(14)
    const chopIndex = CryptoDedicatedStrategyEngine.calculateChoppinessIndex(candles, 14);

    // 2. ADX (14)
    const adx = CryptoDedicatedStrategyEngine.calculateADX(candles, 14);

    // 3. Kaufman Efficiency Ratio (KER-14)
    // KER = |Price_t - Price_t-14| / Sum(|Price_i - Price_i-1|)
    const window14 = closes.slice(n - 15);
    const netChange = Math.abs(window14[window14.length - 1] - window14[0]);
    let totalPath = 0;
    for (let i = 1; i < window14.length; i++) {
      totalPath += Math.abs(window14[i] - window14[i - 1]);
    }
    const ker = totalPath > 0 ? parseFloat((netChange / totalPath).toFixed(3)) : 0.5;

    // 4. Consecutive Range Overlap (Last 8-10 candles, Section 2.2)
    // Overlap of bar i range [low_i, high_i] and bar i-1 range [low_{i-1}, high_{i-1}]
    const recentBars = candles.slice(-10);
    let totalOverlapPct = 0;
    let overlapCount = 0;
    for (let i = 1; i < recentBars.length; i++) {
      const b1 = recentBars[i - 1];
      const b2 = recentBars[i];
      const overlapHigh = Math.min(b1.high, b2.high);
      const overlapLow = Math.max(b1.low, b2.low);
      const overlap = Math.max(0, overlapHigh - overlapLow);
      const minRange = Math.max(0.0001, Math.min(b1.high - b1.low, b2.high - b2.low));
      totalOverlapPct += (overlap / minRange);
      overlapCount++;
    }
    const avgOverlapPct = overlapCount > 0 ? (totalOverlapPct / overlapCount) * 100 : 0;

    // 5. Median Body Pct over 10 candles (Section 2.2)
    const bodyPcts = recentBars.map(b => {
      const r = Math.max(0.0001, b.high - b.low);
      return Math.abs(b.close - b.open) / r;
    }).sort((a, b) => a - b);
    const medianBodyPct = bodyPcts[Math.floor(bodyPcts.length / 2)] || 0.5;

    // 6. Whipsaw Count across EMA(20) in last 20 bars (Section 2.2)
    const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
    const last20Bars = candles.slice(-20);
    const last20Ema = ema20Arr.slice(-20);
    let whipsawCount = 0;
    for (let i = 1; i < last20Bars.length; i++) {
      const prevClose = last20Bars[i - 1].close;
      const prevEma = last20Ema[i - 1] || prevClose;
      const currClose = last20Bars[i].close;
      const currEma = last20Ema[i] || currClose;
      const prevAbove = prevClose >= prevEma;
      const currAbove = currClose >= currEma;
      if (prevAbove !== currAbove) whipsawCount++;
    }

    // 7. Relative Volume (20-period)
    const volSma20 = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const lastBar = candles[n - 1];
    const rvol = volSma20 > 0 ? parseFloat((lastBar.volume / volSma20).toFixed(2)) : 1.0;

    // 8. Bollinger Band Compression (Lowest 15% width over 100 bars)
    let isCompressed = false;
    if (n >= 50) {
      const bbWindows: number[] = [];
      const testRange = Math.min(n, 100);
      for (let i = n - testRange; i <= n - 20; i += 5) {
        const slice = closes.slice(i, i + 20);
        const mean = slice.reduce((a, b) => a + b, 0) / 20;
        const std = Math.sqrt(slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / 20);
        bbWindows.push((std * 4) / (mean || 1));
      }
      const currSlice = closes.slice(n - 20);
      const currMean = currSlice.reduce((a, b) => a + b, 0) / 20;
      const currStd = Math.sqrt(currSlice.reduce((acc, v) => acc + Math.pow(v - currMean, 2), 0) / 20);
      const currWidth = (currStd * 4) / (currMean || 1);
      const sortedWidths = [...bbWindows].sort((a, b) => a - b);
      const p15 = sortedWidths[Math.floor(sortedWidths.length * 0.15)] || 0;
      if (currWidth <= p15) isCompressed = true;
    }

    // -------------------------------------------------------------------------
    // CHOP SCORE CALCULATION (Section 2.4, Max 100 Points)
    // -------------------------------------------------------------------------
    let score = 0;
    const reasons: string[] = [];

    // Component 1: CI > 58 (25 pts)
    if (chopIndex >= 61.8) {
      score += 25;
      reasons.push(`Choppiness Index Extreme (${chopIndex.toFixed(1)} > 61.8) (+25)`);
    } else if (chopIndex >= 58.0) {
      score += 18;
      reasons.push(`Choppiness Index Elevated (${chopIndex.toFixed(1)} > 58) (+18)`);
    }

    // Component 2: ADX < 20 (20 pts)
    if (adx < 18.0) {
      score += 20;
      reasons.push(`ADX Weak Trend (${adx.toFixed(1)} < 18) (+20)`);
    } else if (adx < 22.0) {
      score += 12;
      reasons.push(`ADX Soft Trend (${adx.toFixed(1)} < 22) (+12)`);
    }

    // Component 3: KER < 0.3 (20 pts)
    if (ker < 0.25) {
      score += 20;
      reasons.push(`Kaufman Efficiency Very Low (${ker.toFixed(2)} < 0.25) (+20)`);
    } else if (ker < 0.35) {
      score += 12;
      reasons.push(`Kaufman Efficiency Low (${ker.toFixed(2)} < 0.35) (+12)`);
    }

    // Component 4: Price Action Overlap / Whipsaw (20 pts)
    if (avgOverlapPct >= 60.0 || whipsawCount >= 6) {
      score += 20;
      reasons.push(`Price Action Chop (Overlap: ${avgOverlapPct.toFixed(0)}%, Whipsaws: ${whipsawCount}) (+20)`);
    } else if (avgOverlapPct >= 48.0 || whipsawCount >= 4) {
      score += 10;
      reasons.push(`Moderate Candle Overlap (${avgOverlapPct.toFixed(0)}%) (+10)`);
    }

    // Component 5: Low rvol < 0.75 (15 pts)
    if (rvol < 0.70) {
      score += 15;
      reasons.push(`Dead Volume (RVOL: ${rvol.toFixed(2)}x < 0.70) (+15)`);
    } else if (rvol < 0.85) {
      score += 8;
      reasons.push(`Sub-average Volume (RVOL: ${rvol.toFixed(2)}x) (+8)`);
    }

    const chopScore = Math.min(100, Math.round(score));

    // -------------------------------------------------------------------------
    // HYSTERESIS STATE MACHINE (Section 2.5)
    // Enter CHOP mode at score >= 60, exit only when score <= 40
    // -------------------------------------------------------------------------
    let state = this.symbolChopState.get(symbol);
    if (!state) {
      state = {
        isChop: chopScore >= 60,
        consecutiveChopBars: chopScore >= 60 ? 1 : 0,
        consecutiveTrendBars: chopScore < 60 ? 1 : 0,
        lastScore: chopScore,
      };
      this.symbolChopState.set(symbol, state);
    }

    if (!state.isChop) {
      // Currently in TREND mode: requires score >= 60 to enter CHOP
      if (chopScore >= 60) {
        state.consecutiveChopBars++;
        if (state.consecutiveChopBars >= 2) {
          state.isChop = true;
          state.consecutiveTrendBars = 0;
        }
      } else {
        state.consecutiveChopBars = 0;
        state.consecutiveTrendBars++;
      }
    } else {
      // Currently in CHOP mode: requires score <= 40 to leave CHOP
      if (chopScore <= 40) {
        state.consecutiveTrendBars++;
        if (state.consecutiveTrendBars >= 2) {
          state.isChop = false;
          state.consecutiveChopBars = 0;
        }
      } else {
        state.consecutiveTrendBars = 0;
        state.consecutiveChopBars++;
      }
    }
    state.lastScore = chopScore;

    return {
      chopScore,
      isChopMode: state.isChop,
      choppinessIndex: parseFloat(chopIndex.toFixed(1)),
      adx: parseFloat(adx.toFixed(1)),
      efficiencyRatio: ker,
      rangeOverlapPct: parseFloat(avgOverlapPct.toFixed(1)),
      medianBodyPct: parseFloat(medianBodyPct.toFixed(2)),
      whipsawEma20Count: whipsawCount,
      rvol,
      isCompressed,
      reasons,
    };
  }

  /**
   * 2. Range Strategy Feasibility Validator (Section 3 Option B)
   * If in CHOP mode:
   * - Range must have at least 2 touches on each side
   * - Width must be >= 3 * ATR (else fees eat the profit)
   * - Trade only at outer 20% of range with rejection candle
   */
  public static validateRangeStrategy(
    symbol: string,
    candles: KlinePoint[],
    atr14: number
  ): RangeStrategyCheck {
    const n = candles.length;
    const currentPrice = candles[n - 1].close;

    if (n < 30) {
      return {
        isValidRange: false,
        rangeHigh: currentPrice * 1.02,
        rangeLow: currentPrice * 0.98,
        rangeWidthAtr: 1.0,
        touchCountHigh: 0,
        touchCountLow: 0,
        isAtRangeHighEdge: false,
        isAtRangeLowEdge: false,
        expectedMoveAtr: 0,
        reason: 'Insufficient candles for range detection',
      };
    }

    const window30 = candles.slice(-30);
    const highs = window30.map(c => c.high);
    const lows = window30.map(c => c.low);

    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const rangeWidth = rangeHigh - rangeLow;
    const rangeWidthAtr = rangeWidth / (atr14 || 1);

    // Count touches within 0.35 ATR of boundaries
    const zoneBuffer = atr14 * 0.35;
    const touchCountHigh = window30.filter(c => c.high >= rangeHigh - zoneBuffer).length;
    const touchCountLow = window30.filter(c => c.low <= rangeLow + zoneBuffer).length;

    // Outer 20% boundary checks
    const highEdgeThreshold = rangeHigh - (rangeWidth * 0.20);
    const lowEdgeThreshold = rangeLow + (rangeWidth * 0.20);
    const isAtRangeHighEdge = currentPrice >= highEdgeThreshold;
    const isAtRangeLowEdge = currentPrice <= lowEdgeThreshold;

    // Fee reality check: Expected move must be >= 3 * ATR
    const isValidRange = touchCountHigh >= 2 && touchCountLow >= 2 && rangeWidthAtr >= 3.0;

    let reason = '';
    if (!isValidRange) {
      if (rangeWidthAtr < 3.0) {
        reason = `Range width (${rangeWidthAtr.toFixed(1)} ATR) < 3.0 ATR minimum — fees would exceed profit`;
      } else {
        reason = `Insufficient tested boundary touches (High: ${touchCountHigh}/2, Low: ${touchCountLow}/2)`;
      }
    } else {
      reason = `Valid Range Established (${rangeWidthAtr.toFixed(1)} ATR width, High touches: ${touchCountHigh}, Low touches: ${touchCountLow})`;
    }

    return {
      isValidRange,
      rangeHigh: parseFloat(rangeHigh.toFixed(4)),
      rangeLow: parseFloat(rangeLow.toFixed(4)),
      rangeWidthAtr: parseFloat(rangeWidthAtr.toFixed(1)),
      touchCountHigh,
      touchCountLow,
      isAtRangeHighEdge,
      isAtRangeLowEdge,
      expectedMoveAtr: parseFloat((rangeWidthAtr * 0.6).toFixed(1)),
      reason,
    };
  }

  /**
   * 3. Comprehensive Trap Evaluator (Section 4 & 5 of Playbook)
   * Evaluates proposed trade against the 12 Crypto Market Traps:
   * - Trap 1: Fakeout / False Breakout
   * - Trap 2: Liquidity Sweep / Stop Hunt
   * - Trap 4: Crowded Squeeze / Liquidation Cascade
   * - Trap 5: Dead Volume / Low Liquidity Manipulation
   * - Trap 7: Indicator Trap / Falling Knife (Oversold in Downtrend)
   * - Trap 10: Over-tested Weak S/R Level (3+ touches)
   */
  public static evaluateMarketTraps(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    setupType?: string;
    marketStructure: 'UPTREND' | 'DOWNTREND' | 'RANGE';
    candles: KlinePoint[];
    targetLevelPrice?: number;
    levelType?: 'SUPPORT' | 'RESISTANCE';
    microstructure?: {
      fundingRate?: number;
      fundingZScore?: number;
      openInterest?: number;
      oiChange6h?: number;
      obi?: number;
    } | null;
  }): TrapEvaluation {
    const { symbol, side, setupType, marketStructure, candles, targetLevelPrice, levelType, microstructure } = params;
    const n = candles.length;
    const lastBar = candles[n - 1];
    const prevBar = candles[n - 2];
    const currentPrice = lastBar.close;
    const atr = CryptoDedicatedStrategyEngine.calculateATR(candles, 14);

    const barRange = Math.max(0.0001, lastBar.high - lastBar.low);
    const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
    const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
    const closePos = (lastBar.close - lastBar.low) / barRange;

    const volSma20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const rvol = volSma20 > 0 ? lastBar.volume / volSma20 : 1.0;

    // -------------------------------------------------------------------------
    // TRAP 7: INDICATOR TRAP / FALLING KNIFE (Page 5 & 7)
    // "Oversold stays oversold in strong downtrends. No mean-reversion longs!"
    // -------------------------------------------------------------------------
    if (marketStructure === 'DOWNTREND' && side === 'BUY') {
      if (!setupType?.includes('LIQUIDITY_SWEEP')) {
        return {
          isBlockedByTrap: true,
          trapType: 'FALLING_KNIFE_INDICATOR_TRAP',
          trapReason: `[TRAP 7: FALLING KNIFE] Counter-trend BUY in active DOWNTREND. Oversold conditions persist in downtrends.`,
          recommendedAction: 'STAND_ASIDE',
        };
      }
    }

    if (marketStructure === 'UPTREND' && side === 'SELL') {
      const isReversalOrResistance = setupType?.includes('LIQUIDITY_SWEEP') ||
        setupType?.includes('REJECTION_PIN_BAR') ||
        setupType?.includes('ENGULFING_AT_LEVEL') ||
        setupType?.includes('Reversal & Zigzag') ||
        setupType?.includes('Divergence') ||
        setupType?.includes('Breakout') ||
        setupType?.includes('BREAKOUT') ||
        setupType?.includes('Compression') ||
        setupType?.includes('Resistance') ||
        setupType?.includes('Playbook 2026 Engine') ||
        setupType?.includes('Quant Math') ||
        setupType?.includes('Dedicated Indicator') ||
        levelType === 'RESISTANCE' ||
        (upperWick / barRange) >= 0.25 ||
        lastBar.close < lastBar.open;

      if (!isReversalOrResistance) {
        return {
          isBlockedByTrap: true,
          trapType: 'FALLING_KNIFE_INDICATOR_TRAP',
          trapReason: `[TRAP 7: OVERBOUGHT CONTINUATION] Counter-trend SELL in active UPTREND without resistance rejection or reversal trigger. Standing aside.`,
          recommendedAction: 'STAND_ASIDE',
        };
      }
    }

    // -------------------------------------------------------------------------
    // TRAP 1: FAKEOUT / FALSE BREAKOUT (Page 4 & 7)
    // Breakout candle with rvol < 1.0, long wick, or closed back inside within 1-3 bars
    // Defense: Require close beyond level >= 0.15 * ATR plus rvol >= 1.0
    // -------------------------------------------------------------------------
    if (setupType === 'BREAKOUT_RETEST_GO' || setupType?.includes('BREAKOUT')) {
      if (targetLevelPrice && targetLevelPrice > 0) {
        // If targetLevelPrice === lastBar.close, bypass the fakeout penetration check
        if (Math.abs(targetLevelPrice - lastBar.close) < 1e-5) {
          // targetLevelPrice passed was current close, cannot measure penetration relative to close; bypass
        } else {
          const penetration = side === 'BUY'
            ? (lastBar.close - targetLevelPrice)
            : (targetLevelPrice - lastBar.close);

          const minPenetration = 0.15 * atr;
          if (penetration < minPenetration && rvol < 1.0) {
            return {
              isBlockedByTrap: true,
              trapType: 'FAKEOUT',
              trapReason: `[TRAP 1: WEAK BREAKOUT] Close beyond level is only $${penetration.toFixed(4)} (< 0.15 ATR min $${minPenetration.toFixed(4)}). High fakeout risk.`,
              recommendedAction: 'WAIT_RETEST',
            };
          }
        }

        if (rvol < 1.0) {
          return {
            isBlockedByTrap: true,
            trapType: 'FAKEOUT',
            trapReason: `[TRAP 1: LOW VOLUME BREAKOUT] RVOL is only ${rvol.toFixed(2)}x (< 1.0x required). Institutional breakout volume missing.`,
            recommendedAction: 'WAIT_RETEST',
          };
        }

        // Long wick rejecting back towards level
        const rejectionWickRatio = side === 'BUY' ? (upperWick / barRange) : (lowerWick / barRange);
        if (rejectionWickRatio >= 0.40) {
          return {
            isBlockedByTrap: true,
            trapType: 'FAKEOUT',
            trapReason: `[TRAP 1: FAKEOUT EXHAUSTION WICK] Breakout candle has ${(rejectionWickRatio * 100).toFixed(0)}% rejection wick back towards level.`,
            recommendedAction: 'WAIT_RETEST',
          };
        }
      }
    }

    // -------------------------------------------------------------------------
    // TRAP 4: LONG/SHORT SQUEEZE & CROWDED DERIVATIVES (Page 5)
    // Extreme funding + fast-rising OI into a move = crowded cascade trap
    // -------------------------------------------------------------------------
    if (microstructure) {
      const funding = microstructure.fundingRate || 0;
      // High positive funding > 0.15% means longs are crowded; buying is dangerous
      if (side === 'BUY' && funding > 0.15) {
        return {
          isBlockedByTrap: true,
          trapType: 'CROWDED_SQUEEZE',
          trapReason: `[TRAP 4: CROWDED LONG FLUSH] Extreme positive funding (${funding.toFixed(4)}%). Late long entries risk liquidation flush.`,
          recommendedAction: 'STAND_ASIDE',
        };
      }
      // Heavy negative funding < -0.15% means shorts are crowded; shorting is dangerous
      if (side === 'SELL' && funding < -0.15) {
        return {
          isBlockedByTrap: true,
          trapType: 'CROWDED_SQUEEZE',
          trapReason: `[TRAP 4: CROWDED SHORT SQUEEZE] Extreme negative funding (${funding.toFixed(4)}%). Late short entries risk short squeeze snap.`,
          recommendedAction: 'STAND_ASIDE',
        };
      }
    }

    // -------------------------------------------------------------------------
    // TRAP 10: WEAK / OVER-TESTED S/R LEVEL (Page 6 & 7)
    // "Levels tested repeatedly weaken (resting orders get absorbed) and finally break.
    // Score levels by freshness; after 3 to 4 touches, expect a break rather than another bounce."
    // -------------------------------------------------------------------------
    if (targetLevelPrice && targetLevelPrice > 0 && levelType) {
      // Breakouts target broken levels, dynamic pullbacks/indicators follow trends, and indicator signals do not trade static S/R bounces
      const isBreakout = setupType === 'BREAKOUT_RETEST_GO' || setupType?.includes('BREAKOUT') || setupType?.includes('Breakout');
      const isDynamicOrIndicator = setupType?.includes('Dedicated Indicator') ||
                                   setupType?.includes('Strict Math & Indicator Confluence') ||
                                   setupType?.includes('Playbook 2026 Engine') ||
                                   setupType?.includes('Quant Math') ||
                                   setupType?.includes('TREND_PULLBACK') ||
                                   setupType?.includes('REJECTION_PIN_BAR') ||
                                   setupType?.includes('LIQUIDITY_SWEEP') ||
                                   setupType?.includes('ENGULFING_AT_LEVEL') ||
                                   setupType?.includes('Reversal & Zigzag');

      // Trap 10 ONLY evaluates true static horizontal S/R bounce levels per 2026 playbook mandate
      if (!isBreakout && !isDynamicOrIndicator) {
        // Do not count bars touching current close as over-tested level exhaustion unless evaluating a true static horizontal S/R level
        const isCurrentPrice = Math.abs(targetLevelPrice - lastBar.close) < (atr * 0.15);
        if (!isCurrentPrice) {
          const zoneBuffer = atr * 0.35;
          const recent30 = candles.slice(-30);
          let touchCount = 0;
          let inZone = false;
          for (const b of recent30) {
            const isTouch = (levelType === 'SUPPORT' && b.low <= targetLevelPrice + zoneBuffer && b.low >= targetLevelPrice - zoneBuffer) ||
                            (levelType === 'RESISTANCE' && b.high >= targetLevelPrice - zoneBuffer && b.high <= targetLevelPrice + zoneBuffer);
            if (isTouch) {
              if (!inZone) {
                touchCount++;
                inZone = true;
              }
            } else {
              inZone = false;
            }
          }

          if (touchCount >= 4) {
            // Trying to buy support that has been touched 4+ times, or sell resistance touched 4+ times
            if ((levelType === 'SUPPORT' && side === 'BUY') || (levelType === 'RESISTANCE' && side === 'SELL')) {
              return {
                isBlockedByTrap: true,
                trapType: 'WEAK_LEVEL_EXHAUSTION',
                trapReason: `[TRAP 10: OVER-TESTED LEVEL] ${levelType} at $${targetLevelPrice.toFixed(4)} has been tested ${touchCount} times. Resting liquidity absorbed; expect breakdown/breakout.`,
                recommendedAction: 'STAND_ASIDE',
              };
            }
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // TRAP 5: DEAD VOLUME / LOW LIQUIDITY (Page 5 & 7)
    // Thin order book, rvol < 0.35 = easy to manipulate, avoid breakout chasing
    // -------------------------------------------------------------------------
    const isReversalOrPullback = setupType === 'TREND_PULLBACK' ||
      setupType?.includes('Strict Math & Indicator Confluence') ||
      setupType?.includes('Reversal & Zigzag') ||
      setupType?.includes('REJECTION_PIN_BAR') ||
      setupType?.includes('ENGULFING_AT_LEVEL') ||
      setupType?.includes('Resistance') ||
      setupType?.includes('Playbook 2026 Engine');

    const deadVolThreshold = isReversalOrPullback ? 0.30 : 0.45;
    if (rvol < deadVolThreshold) {
      return {
        isBlockedByTrap: true,
        trapType: 'DEAD_VOLUME',
        trapReason: `[TRAP 5: DEAD LIQUIDITY] Extreme low volume (RVOL: ${rvol.toFixed(2)}x < 0.50x avg). Prone to false spikes.`,
        recommendedAction: 'REDUCE_SIZE',
      };
    }
    // -------------------------------------------------------------------------
    // TRAP 8: BLOW-OFF TOP / EXHAUSTION SPIKE TRAP
    // If a recent candle had a violent spike with large rejection wick (>1.3x body or >0.5 ATR),
    // buying pullbacks while price is dumping from the wick is trapped.
    // -------------------------------------------------------------------------
    if (side === 'BUY') {
      const isReversalOrSupportOrBreakout = setupType?.includes('LIQUIDITY_SWEEP') ||
        setupType?.includes('REJECTION_PIN_BAR') ||
        setupType?.includes('ENGULFING_AT_LEVEL') ||
        setupType?.includes('Reversal & Zigzag') ||
        setupType?.includes('CLIMAX') ||
        setupType?.includes('Divergence') ||
        setupType?.includes('Breakout') ||
        setupType?.includes('BREAKOUT') ||
        setupType?.includes('Strict Math & Indicator Confluence') ||
        setupType?.includes('Quant Math') ||
        setupType?.includes('Dedicated Indicator') ||
        setupType?.includes('Playbook 2026 Engine') ||
        levelType === 'SUPPORT' ||
        (lowerWick / barRange) >= 0.25 ||
        lastBar.close > lastBar.open;

      if (!isReversalOrSupportOrBreakout) {
        const recentSlice = candles.slice(Math.max(0, n - 6));
        const maxHigh = Math.max(...recentSlice.map(c => c.high));
        for (const c of recentSlice) {
          const barRange = Math.max(0.000001, c.high - c.low);
          const upperWick = c.high - Math.max(c.open, c.close);
          const body = Math.abs(c.close - c.open);
          if (c.high >= maxHigh * 0.998 && (upperWick / barRange >= 0.40) && upperWick >= atr * 0.5 && barRange >= atr * 0.9) {
            const currentClose = candles[n - 1].close;
            if (currentClose < c.high - atr * 0.4) {
              return {
                isBlockedByTrap: true,
                trapType: 'FAKEOUT',
                trapReason: `[TRAP 8: BLOW-OFF EXHAUSTION SPIKE] Recent pump to $${c.high.toFixed(4)} has ${(upperWick / barRange * 100).toFixed(0)}% rejection upper wick. Waterfall selloff in progress; late buyers are trapped.`,
                recommendedAction: 'STAND_ASIDE',
              };
            }
          }
        }
      }
    } else if (side === 'SELL') {
      const isReversalOrResistanceOrBreakdown = setupType?.includes('LIQUIDITY_SWEEP') ||
        setupType?.includes('REJECTION_PIN_BAR') ||
        setupType?.includes('ENGULFING_AT_LEVEL') ||
        setupType?.includes('Reversal & Zigzag') ||
        setupType?.includes('CLIMAX') ||
        setupType?.includes('Divergence') ||
        setupType?.includes('Breakout') ||
        setupType?.includes('BREAKOUT') ||
        setupType?.includes('BREAKDOWN') ||
        setupType?.includes('Resistance') ||
        setupType?.includes('Strict Math & Indicator Confluence') ||
        setupType?.includes('Playbook 2026 Engine') ||
        setupType?.includes('Quant Math') ||
        setupType?.includes('Dedicated Indicator') ||
        levelType === 'RESISTANCE' ||
        (upperWick / barRange) >= 0.25 ||
        lastBar.close < lastBar.open;

      if (!isReversalOrResistanceOrBreakdown) {
        const recentSlice = candles.slice(Math.max(0, n - 6));
        const minLow = Math.min(...recentSlice.map(c => c.low));
        for (const c of recentSlice) {
          const barRange = Math.max(0.000001, c.high - c.low);
          const lowerWick = Math.min(c.open, c.close) - c.low;
          const body = Math.abs(c.close - c.open);
          if (c.low <= minLow * 1.002 && (lowerWick >= body * 1.3 || lowerWick >= atr * 0.5) && barRange >= atr * 0.9) {
            const currentClose = candles[n - 1].close;
            if (currentClose > c.low + atr * 0.4) {
              return {
                isBlockedByTrap: true,
                trapType: 'FAKEOUT',
                trapReason: `[TRAP 8: CAPITULATION DUMP BOUNCE] Recent dump to $${c.low.toFixed(4)} has ${(lowerWick / barRange * 100).toFixed(0)}% rejection lower wick. Snapback bounce in progress; late sellers are trapped.`,
                recommendedAction: 'STAND_ASIDE',
              };
            }
          }
        }
      }
    }

    return {
      isBlockedByTrap: false,
      trapReason: 'Clear of recognized market traps',
      recommendedAction: 'PASS',
    };
  }

  /**
   * 4. Time Stop Checker (Section 7: Position Management Inside Traps and Chop)
   * "If the trade does not move within N candles (12-16 bars on 15M), exit (chop kills slow trades)."
   */
  public static shouldTimeStopExit(
    entryTime: number,
    currentPrice: number,
    entryPrice: number,
    side: 'BUY' | 'SELL',
    atr: number,
    maxBarsAllowed: number = 14
  ): { shouldExit: boolean; elapsedBars: number; reason: string } {
    const elapsedMs = Date.now() - entryTime;
    const elapsedBars = Math.floor(elapsedMs / (15 * 60 * 1000));

    if (elapsedBars >= maxBarsAllowed) {
      const priceProgress = side === 'BUY'
        ? (currentPrice - entryPrice)
        : (entryPrice - currentPrice);

      // If price has not progressed by at least 0.8 ATR after 14 bars (3.5 hours):
      if (priceProgress < 0.8 * atr) {
        return {
          shouldExit: true,
          elapsedBars,
          reason: `[TIME STOP EXIT] Trade stalled for ${elapsedBars} bars (3.5h+) with low progress ($${priceProgress.toFixed(4)} < 0.8 ATR). Exiting to prevent chop bleed.`,
        };
      }
    }

    return {
      shouldExit: false,
      elapsedBars,
      reason: 'Trade within active time window',
    };
  }
}

export const marketTraps = MarketTrapsAndChopEngine;
