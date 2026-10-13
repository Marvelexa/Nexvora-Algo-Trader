import { KlinePoint } from './quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from './cryptoDedicatedStrategyEngine';

export interface CandleAnatomy {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  range: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  bodyPct: number;
  closePos: number; // 0 = closed at low, 1 = closed at high
  sizeAtr: number;  // range / ATR(14)
  isStrongBull: boolean; // closePos >= 0.75 && bodyPct >= 0.6 && sizeAtr >= 0.8
  isStrongBear: boolean; // closePos <= 0.25 && bodyPct >= 0.6 && sizeAtr >= 0.8
  isIndecision: boolean; // bodyPct <= 0.3
  isClimax: boolean;    // sizeAtr >= 2.0 with high volume
  rvol: number;         // volume / SMA(volume, 20)
}

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
}

export interface KeyZone {
  price: number;
  upper: number;
  lower: number;
  type: 'SUPPORT' | 'RESISTANCE' | 'FLIPPED_ROLE';
  touchCount: number;
  score: number;
  lastTouchTime: number;
}

export interface PriceActionSignal {
  symbol: string;
  side: 'BUY' | 'SELL';
  setupType: 'TREND_PULLBACK' | 'REJECTION_PIN_BAR' | 'ENGULFING_AT_LEVEL' | 'BREAKOUT_RETEST_GO' | 'LIQUIDITY_SWEEP';
  marketStructure: 'UPTREND' | 'DOWNTREND' | 'RANGE';
  entryPrice: number;
  keyLevelPrice?: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  confluenceScore: number; // 0 to 100 scale (Threshold >= 70)
  triggerReason: string;
  locationReason: string;
  volumeReason: string;
  scores: {
    regimeAlignment: number; // Max 20
    locationQuality: number;  // Max 25
    triggerQuality: number;   // Max 25
    volumeConfirmation: number; // Max 15
    rewardRisk: number;       // Max 15
    total: number;
  };
}

/**
 * =========================================================================
 * PRICE ACTION ENTRY/EXIT PLAYBOOK 2026 ENGINE
 * =========================================================================
 * Core Principle: Location + Trigger + Confirmation
 * - Location alone (price at support) is NOT a signal.
 * - Trigger without location is noise.
 * - In DOWNTREND (LH/LL): Sell rallies to resistance/EMAs, or breakdown retests!
 * - In UPTREND (HH/HL): Buy pullbacks to support/EMAs, or breakout retests!
 * - In RANGE: Trade rejections at edges (sweep or pin bar).
 * =========================================================================
 */
export class PriceActionPlaybook2026Engine {
  /**
   * 1. Candle Anatomy Calculation (Normalized by ATR)
   */
  public static calculateAnatomy(candles: KlinePoint[], atr14: number): CandleAnatomy[] {
    const n = candles.length;
    if (n === 0) return [];

    // Calculate 20-period volume SMA
    const volSma20: number[] = new Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - 19);
      const slice = candles.slice(start, i + 1);
      const avgVol = slice.reduce((sum, c) => sum + c.volume, 0) / slice.length;
      volSma20[i] = Math.max(1, avgVol);
    }

    const safeAtr = Math.max(0.000001, atr14);

    return candles.map((c, i) => {
      const range = Math.max(0.000001, c.high - c.low);
      const body = Math.abs(c.close - c.open);
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const bodyPct = body / range;
      const closePos = (c.close - c.low) / range;
      const sizeAtr = range / safeAtr;
      const rvol = c.volume / volSma20[i];

      const isStrongBull = closePos >= 0.70 && bodyPct >= 0.55 && sizeAtr >= 0.75;
      const isStrongBear = closePos <= 0.30 && bodyPct >= 0.55 && sizeAtr >= 0.75;
      const isIndecision = bodyPct <= 0.30;
      const isClimax = sizeAtr >= 2.0 && rvol >= 1.5;

      return {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        range,
        body,
        upperWick,
        lowerWick,
        bodyPct,
        closePos,
        sizeAtr,
        isStrongBull,
        isStrongBear,
        isIndecision,
        isClimax,
        rvol,
      };
    });
  }

  /**
   * 2. Detect Swing Highs and Swing Lows (N=3 to 5 bars)
   */
  public static findSwings(candles: KlinePoint[], nBars: number = 3): { swingHighs: SwingPoint[]; swingLows: SwingPoint[] } {
    const swingHighs: SwingPoint[] = [];
    const swingLows: SwingPoint[] = [];
    const len = candles.length;

    for (let i = nBars; i < len - nBars; i++) {
      const c = candles[i];
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= nBars; j++) {
        if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
        if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) isLow = false;
      }

      if (isHigh) swingHighs.push({ index: i, time: c.time, price: c.high, type: 'HIGH' });
      if (isLow) swingLows.push({ index: i, time: c.time, price: c.low, type: 'LOW' });
    }

    return { swingHighs, swingLows };
  }

  /**
   * 3. Market Structure Identification (HH/HL vs LH/LL)
   */
  public static evaluateMarketStructure(
    candles: KlinePoint[],
    swingHighs: SwingPoint[],
    swingLows: SwingPoint[]
  ): {
    structure: 'UPTREND' | 'DOWNTREND' | 'RANGE';
    lastSwingHigh: number;
    lastSwingLow: number;
    hasBOS_Bullish: boolean;
    hasBOS_Bearish: boolean;
  } {
    const currentPrice = candles[candles.length - 1].close;
    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);

    const lastHigh = recentHighs[recentHighs.length - 1]?.price || currentPrice * 1.01;
    const lastLow = recentLows[recentLows.length - 1]?.price || currentPrice * 0.99;

    let higherHighs = 0;
    let lowerHighs = 0;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i].price > recentHighs[i - 1].price) higherHighs++;
      else if (recentHighs[i].price < recentHighs[i - 1].price) lowerHighs++;
    }

    let higherLows = 0;
    let lowerLows = 0;
    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i].price > recentLows[i - 1].price) higherLows++;
      else if (recentLows[i].price < recentLows[i - 1].price) lowerLows++;
    }

    let structure: 'UPTREND' | 'DOWNTREND' | 'RANGE' = 'RANGE';
    const nHighs = recentHighs.length;
    const nLows = recentLows.length;

    if (nHighs >= 2 && nLows >= 2) {
      const latestHigh = recentHighs[nHighs - 1].price;
      const prevHigh = recentHighs[nHighs - 2].price;
      const latestLow = recentLows[nLows - 1].price;
      const prevLow = recentLows[nLows - 2].price;

      if (latestHigh < prevHigh && latestLow < prevLow) {
        structure = 'DOWNTREND';
      } else if (latestHigh > prevHigh && latestLow > prevLow) {
        structure = 'UPTREND';
      } else if (lowerHighs > higherHighs && lowerLows >= higherLows) {
        structure = 'DOWNTREND';
      } else if (higherHighs > lowerHighs && higherLows >= lowerLows) {
        structure = 'UPTREND';
      } else if (lowerHighs > higherHighs && lowerLows > 0) {
        structure = 'DOWNTREND';
      } else if (higherHighs > lowerHighs && higherLows > 0) {
        structure = 'UPTREND';
      } else {
        structure = 'RANGE';
      }
    } else if (lowerHighs > higherHighs && lowerLows > higherLows) {
      structure = 'DOWNTREND';
    } else if (higherHighs > lowerHighs && higherLows > lowerLows) {
      structure = 'UPTREND';
    } else {
      structure = 'RANGE';
    }

    const hasBOS_Bullish = currentPrice > lastHigh;
    const hasBOS_Bearish = currentPrice < lastLow;

    return {
      structure,
      lastSwingHigh: lastHigh,
      lastSwingLow: lastLow,
      hasBOS_Bullish,
      hasBOS_Bearish,
    };
  }

  /**
   * 4. Build Clustered Key Levels and Zones (Width = +/- 0.35 ATR)
   */
  public static buildZones(candles: KlinePoint[], swings: { swingHighs: SwingPoint[]; swingLows: SwingPoint[] }, atr: number): KeyZone[] {
    const allPivots = [...swings.swingHighs, ...swings.swingLows];
    if (allPivots.length === 0) return [];

    const zoneRadius = atr * 0.35;
    const clustered: KeyZone[] = [];

    // Group nearby pivots
    for (const p of allPivots) {
      const existing = clustered.find(z => Math.abs(z.price - p.price) <= zoneRadius * 1.2);
      if (existing) {
        existing.touchCount++;
        existing.lastTouchTime = Math.max(existing.lastTouchTime, p.time);
        existing.score = Math.min(100, existing.score + 15);
      } else {
        clustered.push({
          price: p.price,
          upper: p.price + zoneRadius,
          lower: p.price - zoneRadius,
          type: p.type === 'HIGH' ? 'RESISTANCE' : 'SUPPORT',
          touchCount: 1,
          score: 40,
          lastTouchTime: p.time,
        });
      }
    }

    return clustered;
  }

  /**
   * =========================================================================
   * 5. MASTER PRICE ACTION EVALUATOR (PLAYBOOK 2026 ARCHITECTURE)
   * Evaluates closed 15M candle against S/R location, trigger pattern, and rvol
   * =========================================================================
   */
  public static evaluatePriceAction(
    symbol: string,
    candles: KlinePoint[],
    htfTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
  ): PriceActionSignal | null {
    const n = candles.length;
    if (n < 35) return null;

    const atr = CryptoDedicatedStrategyEngine.calculateATR(candles, 14);
    const anatomy = this.calculateAnatomy(candles, atr);
    const lastBar = anatomy[n - 1];
    const prevBar = anatomy[n - 2];
    const currentPrice = lastBar.close;

    // Moving average trends
    const closes = candles.map(c => c.close);
    const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
    const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
    const ema200Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, Math.min(200, n));
    const ema20 = ema20Arr[ema20Arr.length - 1] || currentPrice;
    const ema50 = ema50Arr[ema50Arr.length - 1] || currentPrice;
    const ema200 = ema200Arr[ema200Arr.length - 1] || currentPrice;

    // Swings & Structure
    const swings = this.findSwings(candles, 3);
    const structureData = this.evaluateMarketStructure(candles, swings.swingHighs, swings.swingLows);
    const zones = this.buildZones(candles, swings, atr);

    // Identify nearest support and resistance zones
    // Dynamic resistances: include zones above price, plus EMA20/EMA50/EMA200 if price is below them
    const potentialResistances: KeyZone[] = zones.filter(z => z.price >= currentPrice * 0.998);
    if (ema20 > currentPrice) {
      potentialResistances.push({
        price: ema20,
        upper: ema20 + atr * 0.35,
        lower: ema20 - atr * 0.35,
        type: 'RESISTANCE',
        touchCount: 2,
        score: 60,
        lastTouchTime: Date.now(),
      });
    }
    if (ema50 > currentPrice) {
      potentialResistances.push({
        price: ema50,
        upper: ema50 + atr * 0.35,
        lower: ema50 - atr * 0.35,
        type: 'RESISTANCE',
        touchCount: 2,
        score: 60,
        lastTouchTime: Date.now(),
      });
    }
    if (ema200 > currentPrice) {
      potentialResistances.push({
        price: ema200,
        upper: ema200 + atr * 0.35,
        lower: ema200 - atr * 0.35,
        type: 'RESISTANCE',
        touchCount: 2,
        score: 60,
        lastTouchTime: Date.now(),
      });
    }

    // Dynamic supports: include zones below price, plus EMA20/EMA50/EMA200 if price is above them
    const potentialSupports: KeyZone[] = zones.filter(z => z.price <= currentPrice * 1.002);
    if (ema20 < currentPrice) {
      potentialSupports.push({
        price: ema20,
        upper: ema20 + atr * 0.35,
        lower: ema20 - atr * 0.35,
        type: 'SUPPORT',
        touchCount: 2,
        score: 60,
        lastTouchTime: Date.now(),
      });
    }
    if (ema50 < currentPrice) {
      potentialSupports.push({
        price: ema50,
        upper: ema50 + atr * 0.35,
        lower: ema50 - atr * 0.35,
        type: 'SUPPORT',
        touchCount: 2,
        score: 60,
        lastTouchTime: Date.now(),
      });
    }
    if (ema200 < currentPrice) {
      potentialSupports.push({
        price: ema200,
        upper: ema200 + atr * 0.35,
        lower: ema200 - atr * 0.35,
        type: 'SUPPORT',
        touchCount: 2,
        score: 60,
        lastTouchTime: Date.now(),
      });
    }

    const supports = potentialSupports.sort((a, b) => b.price - a.price);
    const resistances = potentialResistances.sort((a, b) => a.price - b.price);
    const nearestSupport = supports.find(s => s.price <= currentPrice * 1.001) || supports[0] || { price: currentPrice - 1.8 * atr, upper: currentPrice - 1.5 * atr, lower: currentPrice - 2.1 * atr, score: 30 };
    const nearestResistance = resistances.find(r => r.price >= currentPrice * 0.999) || resistances[0] || { price: currentPrice + 1.8 * atr, upper: currentPrice + 2.1 * atr, lower: currentPrice + 1.5 * atr, score: 30 };

    const distToSupportAtr = Math.abs(currentPrice - nearestSupport.price) / atr;
    const distToResistanceAtr = Math.abs(nearestResistance.price - currentPrice) / atr;

    const isAtSupport = distToSupportAtr <= 0.70 || (Math.abs(currentPrice - ema20) / atr <= 0.70 && currentPrice >= ema20 * 0.992) || (Math.abs(currentPrice - ema50) / atr <= 0.70 && currentPrice >= ema50 * 0.992) || (Math.abs(currentPrice - ema200) / atr <= 0.70 && currentPrice >= ema200 * 0.992);
    const isAtResistance = distToResistanceAtr <= 0.70 || (Math.abs(currentPrice - ema20) / atr <= 0.70 && currentPrice <= ema20 * 1.008) || (Math.abs(currentPrice - ema50) / atr <= 0.70 && currentPrice <= ema50 * 1.008) || (Math.abs(currentPrice - ema200) / atr <= 0.70 && currentPrice <= ema200 * 1.008);

    // Check for Recent Blow-Off Top or Bottom (Exhaustion Wicks)
    let hasRecentBlowOffTop = false;
    let hasRecentBlowOffBottom = false;
    const recentSlice = anatomy.slice(Math.max(0, n - 6));
    if (recentSlice.length > 0) {
      const maxRecentHigh = Math.max(...recentSlice.map(b => b.high));
      const minRecentLow = Math.min(...recentSlice.map(b => b.low));
      for (const bar of recentSlice) {
        if (bar.high >= maxRecentHigh * 0.998 && (bar.upperWick >= bar.body * 1.3 || bar.upperWick >= 0.5 * atr) && bar.sizeAtr >= 0.9) {
          hasRecentBlowOffTop = true;
        }
        if (bar.low <= minRecentLow * 1.002 && (bar.lowerWick >= bar.body * 1.3 || bar.lowerWick >= 0.5 * atr) && bar.sizeAtr >= 0.9) {
          hasRecentBlowOffBottom = true;
        }
      }
    }

    // Check for Waterfall Cascades (consecutive bars moving against trade)
    const isWaterfallDumping = n >= 3 && (
      candles[n - 1].close < candles[n - 1].open &&
      candles[n - 2].close < candles[n - 2].open &&
      candles[n - 1].close < candles[n - 2].close
    );
    const isWaterfallPumping = n >= 3 && (
      candles[n - 1].close > candles[n - 1].open &&
      candles[n - 2].close > candles[n - 2].open &&
      candles[n - 1].close > candles[n - 2].close
    );

    // EMA50 Slope Check (Genuine Trend Direction)
    const ema50Prev = ema50Arr[Math.max(0, ema50Arr.length - 8)] || ema50;
    const ema50SlopeRising = ema50 > ema50Prev * 1.0003;
    const ema50SlopeFalling = ema50 < ema50Prev * 0.9997;

    // Macro market trend: requires real structure/slope/EMA50 alignment
    const isMacroDowntrend = (structureData.structure === 'DOWNTREND' || ema50SlopeFalling || currentPrice < ema50) && !hasRecentBlowOffBottom;
    const isMacroUptrend = (structureData.structure === 'UPTREND' || ema50SlopeRising || currentPrice > ema50) && !hasRecentBlowOffTop;

    // -------------------------------------------------------------------------
    // TRIGGER DETECTION (Section 5)
    // -------------------------------------------------------------------------
    let triggeredSide: 'BUY' | 'SELL' | null = null;
    let setupType: PriceActionSignal['setupType'] | null = null;
    let triggerQuality = 0;
    let locationQuality = 0;
    let regimeAlignment = 0;
    let volumeConfirmation = 0;
    let rewardRiskScore = 0;

    let triggerReason = '';
    let locationReason = '';
    let volumeReason = '';

    // =========================================================================
    // SETUP 1: TREND PULLBACK (Highest probability in a trend per Section 5.7)
    // In DOWNTREND: Sell rallies into Resistance / EMA50 + Bearish Rejection
    // In UPTREND: Buy pullbacks into Support / EMA50 + Bullish Rejection
    // =========================================================================
    if (isMacroDowntrend && !hasRecentBlowOffBottom && !isWaterfallPumping && structureData.structure !== 'UPTREND') {
      const isPullbackToResistance = isAtResistance || (Math.abs(currentPrice - ema20) / atr <= 0.75 && currentPrice <= ema20 * 1.01) || (Math.abs(currentPrice - ema50) / atr <= 0.75 && currentPrice <= ema50 * 1.01);
      const isRedCandle = lastBar.close < lastBar.open || lastBar.closePos <= 0.45;
      const isBearishTrigger = isRedCandle && (
        lastBar.isStrongBear ||
        (lastBar.upperWick >= lastBar.body * 1.2 && lastBar.closePos <= 0.45) ||
        (prevBar.close > prevBar.open && lastBar.close < prevBar.low) ||
        (prevBar.close > prevBar.open && lastBar.close < (prevBar.open + prevBar.close) / 2) ||
        (lastBar.upperWick >= 0.35 * lastBar.range)
      );

      if (isPullbackToResistance && isBearishTrigger) {
        triggeredSide = 'SELL';
        setupType = 'TREND_PULLBACK';
        regimeAlignment = 20;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Rally into Downtrend Resistance / EMA20/50 ($${nearestResistance.price.toFixed(4)})`;
        triggerReason = `Bearish Rejection in Downtrend (ClosePos: ${lastBar.closePos.toFixed(2)}, Range: ${lastBar.sizeAtr.toFixed(1)} ATR)`;
      }
    } else if (isMacroUptrend && !hasRecentBlowOffTop && !isWaterfallDumping) {
      const isPullbackToSupport = isAtSupport || (Math.abs(currentPrice - ema20) / atr <= 0.75 && currentPrice >= ema20 * 0.99) || (Math.abs(currentPrice - ema50) / atr <= 0.75 && currentPrice >= ema50 * 0.99);
      const isGreenCandle = lastBar.close > lastBar.open || lastBar.closePos >= 0.55;
      const isBullishTrigger = isGreenCandle && (
        lastBar.isStrongBull ||
        (lastBar.lowerWick >= lastBar.body * 1.2 && lastBar.closePos >= 0.55) ||
        (prevBar.close < prevBar.open && lastBar.close > prevBar.high) ||
        (prevBar.close < prevBar.open && lastBar.close > (prevBar.open + prevBar.close) / 2) ||
        (lastBar.lowerWick >= 0.35 * lastBar.range)
      );

      if (isPullbackToSupport && isBullishTrigger) {
        triggeredSide = 'BUY';
        setupType = 'TREND_PULLBACK';
        regimeAlignment = 20;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Pullback to Uptrend Support / EMA20/50 ($${nearestSupport.price.toFixed(4)})`;
        triggerReason = `Bullish Rejection in Uptrend (ClosePos: ${lastBar.closePos.toFixed(2)}, Range: ${lastBar.sizeAtr.toFixed(1)} ATR)`;
      }
    }

    // =========================================================================
    // SETUP 2: REJECTION / PIN BAR AT KEY LEVEL (Section 5.1)
    // =========================================================================
    if (!triggeredSide) {
      // Bullish Pin Bar at Support
      const isBullPinBar = lastBar.lowerWick >= 1.8 * lastBar.body &&
                           lastBar.lowerWick >= 0.45 * lastBar.range &&
                           lastBar.closePos >= 0.50 &&
                           isAtSupport;

      // Bearish Pin Bar at Resistance
      const isBearPinBar = lastBar.upperWick >= 1.8 * lastBar.body &&
                           lastBar.upperWick >= 0.45 * lastBar.range &&
                           lastBar.closePos <= 0.50 &&
                           isAtResistance &&
                           structureData.structure !== 'UPTREND';

      if (isBullPinBar && structureData.structure !== 'DOWNTREND') {
        triggeredSide = 'BUY';
        setupType = 'REJECTION_PIN_BAR';
        regimeAlignment = isMacroUptrend ? 20 : 15;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Testing Key Support Zone ($${nearestSupport.price.toFixed(4)})`;
        triggerReason = `Bullish Pin Bar Rejection (Lower Wick: ${Math.round((lastBar.lowerWick / lastBar.range) * 100)}% of bar)`;
      } else if (isBearPinBar && structureData.structure !== 'UPTREND') {
        triggeredSide = 'SELL';
        setupType = 'REJECTION_PIN_BAR';
        regimeAlignment = isMacroDowntrend ? 20 : 18;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Testing Key Resistance Zone ($${nearestResistance.price.toFixed(4)})`;
        triggerReason = `Bearish Pin Bar Rejection (Upper Wick: ${Math.round((lastBar.upperWick / lastBar.range) * 100)}% of bar)`;
      }
    }

    // =========================================================================
    // SETUP 3: ENGULFING AT KEY LEVEL (Section 5.2)
    // =========================================================================
    if (!triggeredSide) {
      const isBullEngulfing = prevBar.close < prevBar.open &&
                              lastBar.close > lastBar.open &&
                              lastBar.close >= (prevBar.open + prevBar.close) / 2 &&
                              lastBar.sizeAtr >= 0.60 &&
                              (isAtSupport || isMacroUptrend) && structureData.structure !== 'DOWNTREND';

      const isBearEngulfing = prevBar.close > prevBar.open &&
                              lastBar.close < lastBar.open &&
                              lastBar.close <= (prevBar.open + prevBar.close) / 2 &&
                              lastBar.sizeAtr >= 0.60 &&
                              (isAtResistance || isMacroDowntrend) &&
                              structureData.structure !== 'UPTREND';

      if (isBullEngulfing) {
        triggeredSide = 'BUY';
        setupType = 'ENGULFING_AT_LEVEL';
        regimeAlignment = isMacroUptrend ? 20 : 15;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Support Demand Zone ($${nearestSupport.price.toFixed(4)})`;
        triggerReason = `Bullish Engulfing Power Candle (${lastBar.sizeAtr.toFixed(1)} ATR)`;
      } else if (isBearEngulfing && structureData.structure !== 'UPTREND') {
        triggeredSide = 'SELL';
        setupType = 'ENGULFING_AT_LEVEL';
        regimeAlignment = isMacroDowntrend ? 20 : 18;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Resistance Supply Zone ($${nearestResistance.price.toFixed(4)})`;
        triggerReason = `Bearish Engulfing Power Candle (${lastBar.sizeAtr.toFixed(1)} ATR)`;
      }
    }

    // =========================================================================
    // SETUP 4: BREAKDOWN / BREAKOUT RETEST (Section 5.3)
    // =========================================================================
    if (!triggeredSide) {
      // Find recent swing low or support zone from the last 5-25 bars that was just broken
      const recentSwingLows = swings.swingLows.filter(s => s.price > currentPrice && s.price <= currentPrice + 1.8 * atr);
      const brokenSupport = recentSwingLows.length > 0 ? Math.min(...recentSwingLows.map(s => s.price)) : (structureData.hasBOS_Bearish ? structureData.lastSwingLow : (currentPrice < nearestSupport.price ? nearestSupport.price : undefined));

      const isSupportBreakdown = Boolean(
        brokenSupport &&
        structureData.structure !== 'UPTREND' &&
        lastBar.close < brokenSupport &&
        (prevBar.close >= brokenSupport - 0.50 * atr || (prevBar.high >= brokenSupport && lastBar.close < brokenSupport)) &&
        lastBar.closePos <= 0.40 &&
        (lastBar.sizeAtr >= 0.55 || lastBar.rvol >= 0.95)
      );

      const recentSwingHighs = swings.swingHighs.filter(s => s.price < currentPrice && s.price >= currentPrice - 1.8 * atr);
      const brokenResistance = recentSwingHighs.length > 0 ? Math.max(...recentSwingHighs.map(s => s.price)) : (structureData.hasBOS_Bullish ? structureData.lastSwingHigh : (currentPrice > nearestResistance.price ? nearestResistance.price : undefined));

      const isResistanceBreakout = Boolean(
        brokenResistance &&
        structureData.structure !== 'DOWNTREND' &&
        lastBar.close > brokenResistance &&
        (prevBar.close <= brokenResistance + 0.50 * atr || (prevBar.low <= brokenResistance && lastBar.close > brokenResistance)) &&
        lastBar.closePos >= 0.60 &&
        (lastBar.sizeAtr >= 0.55 || lastBar.rvol >= 0.95)
      );

      if (isSupportBreakdown && brokenSupport) {
        triggeredSide = 'SELL';
        setupType = 'BREAKOUT_RETEST_GO';
        regimeAlignment = isMacroDowntrend ? 20 : 18;
        locationQuality = 22;
        triggerQuality = 25;
        locationReason = `Clean Breakdown below Support Level ($${brokenSupport.toFixed(4)})`;
        triggerReason = `High-Velocity Breakdown Close (${lastBar.sizeAtr.toFixed(1)} ATR, ClosePos: ${lastBar.closePos.toFixed(2)})`;
      } else if (isResistanceBreakout && brokenResistance) {
        triggeredSide = 'BUY';
        setupType = 'BREAKOUT_RETEST_GO';
        regimeAlignment = isMacroUptrend ? 20 : 18;
        locationQuality = 22;
        triggerQuality = 25;
        locationReason = `Clean Breakout above Resistance Level ($${brokenResistance.toFixed(4)})`;
        triggerReason = `High-Velocity Breakout Close (${lastBar.sizeAtr.toFixed(1)} ATR, ClosePos: ${lastBar.closePos.toFixed(2)})`;
      }
    }

    // =========================================================================
    // SETUP 5: LIQUIDITY SWEEP + REVERSAL (Section 5.4)
    // Bear Trap: Sweeps below prior swing low, closes back above/in top 40%, lower wick >= 38%, rvol >= 1.10
    // Bull Trap: Sweeps above prior swing high, closes back below/in bottom 40%, upper wick >= 38%, rvol >= 1.10
    // =========================================================================
    if (!triggeredSide) {
      const priorSwingLow = structureData.lastSwingLow;
      const priorSwingHigh = structureData.lastSwingHigh;

      const isBullSweep = lastBar.low < priorSwingLow &&
                          lastBar.close >= priorSwingLow &&
                          lastBar.closePos >= 0.50 &&
                          (lastBar.lowerWick / lastBar.range) >= 0.35 &&
                          lastBar.rvol >= 1.05;

      const isBearSweep = lastBar.high > priorSwingHigh &&
                          lastBar.close <= priorSwingHigh &&
                          lastBar.closePos <= 0.50 &&
                          (lastBar.upperWick / lastBar.range) >= 0.35 &&
                          lastBar.rvol >= 1.05;

      if (isBullSweep && structureData.structure !== 'DOWNTREND') {
        triggeredSide = 'BUY';
        setupType = 'LIQUIDITY_SWEEP';
        regimeAlignment = 20;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Liquidity Pool Swept Below Prior Low ($${priorSwingLow.toFixed(4)})`;
        triggerReason = `Bear Trap Rejection Wick (${Math.round((lastBar.lowerWick / lastBar.range) * 100)}% lower wick, RVOL: ${lastBar.rvol.toFixed(2)})`;
      } else if (isBearSweep && structureData.structure !== 'UPTREND') {
        triggeredSide = 'SELL';
        setupType = 'LIQUIDITY_SWEEP';
        regimeAlignment = 20;
        locationQuality = 25;
        triggerQuality = 25;
        locationReason = `Liquidity Pool Swept Above Prior High ($${priorSwingHigh.toFixed(4)})`;
        triggerReason = `Bull Trap Rejection Wick (${Math.round((lastBar.upperWick / lastBar.range) * 100)}% upper wick, RVOL: ${lastBar.rvol.toFixed(2)})`;
      }
    }

    if (!triggeredSide || !setupType) return null;

    // -------------------------------------------------------------------------
    // VOLUME CONFIRMATION (Section 6)
    // -------------------------------------------------------------------------
    if (lastBar.rvol >= 1.2) {
      volumeConfirmation = 15;
      volumeReason = `Strong Volume Expansion (rvol: ${lastBar.rvol.toFixed(2)}x avg)`;
    } else if (lastBar.rvol >= 0.85) {
      volumeConfirmation = 10;
      volumeReason = `Healthy Volume (rvol: ${lastBar.rvol.toFixed(2)}x avg)`;
    } else {
      volumeConfirmation = 5;
      volumeReason = `Moderate Volume (rvol: ${lastBar.rvol.toFixed(2)}x avg)`;
    }

    // -------------------------------------------------------------------------
    // RISK, REWARD & STRUCTURE-BASED STOPS (Section 8)
    // -------------------------------------------------------------------------
    let stopLossPrice = 0;
    let takeProfitPrice = 0;

    if (triggeredSide === 'BUY') {
      const patternLow = Math.min(lastBar.low, prevBar.low);
      stopLossPrice = patternLow - 0.25 * atr;
      const targetResistance = nearestResistance.price > currentPrice + 1.2 * atr ? nearestResistance.price : currentPrice + 2.0 * atr;
      takeProfitPrice = targetResistance;
    } else {
      const patternHigh = Math.max(lastBar.high, prevBar.high);
      stopLossPrice = patternHigh + 0.25 * atr;
      const targetSupport = nearestSupport.price < currentPrice - 1.2 * atr ? nearestSupport.price : currentPrice - 2.0 * atr;
      takeProfitPrice = targetSupport;
    }

    const slDistance = Math.abs(currentPrice - stopLossPrice);
    const tpDistance = Math.abs(takeProfitPrice - currentPrice);

    // Skip trade only if structural stop is too wide (> 2.2 ATR cap) or too narrow (< 0.2 ATR)
    if (slDistance > 2.2 * atr || slDistance < 0.2 * atr) {
      return null;
    }

    const riskRewardRatio = slDistance > 0 ? tpDistance / slDistance : 1.0;

    if (riskRewardRatio >= 1.4) {
      rewardRiskScore = 15;
    } else if (riskRewardRatio >= 1.1) {
      rewardRiskScore = 10;
    } else {
      rewardRiskScore = 5;
    }

    const totalScore = regimeAlignment + locationQuality + triggerQuality + volumeConfirmation + rewardRiskScore;

    // Execution Threshold: Must reach >= 70 points out of 100!
    if (totalScore < 70) {
      return null;
    }

    let keyLevelPrice: number | undefined;
    if (setupType === 'BREAKOUT_RETEST_GO') {
      keyLevelPrice = triggeredSide === 'BUY' ? nearestResistance.upper : nearestSupport.lower;
    } else if (setupType === 'LIQUIDITY_SWEEP') {
      keyLevelPrice = triggeredSide === 'BUY' ? structureData.lastSwingLow : structureData.lastSwingHigh;
    } else if (setupType === 'TREND_PULLBACK' || setupType === 'REJECTION_PIN_BAR' || setupType === 'ENGULFING_AT_LEVEL') {
      keyLevelPrice = triggeredSide === 'BUY' ? nearestSupport.price : nearestResistance.price;
    }

    return {
      symbol,
      side: triggeredSide,
      setupType,
      marketStructure: structureData.structure,
      entryPrice: currentPrice,
      keyLevelPrice,
      stopLossPrice: parseFloat(stopLossPrice.toFixed(4)),
      takeProfitPrice: parseFloat(takeProfitPrice.toFixed(4)),
      riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
      confluenceScore: totalScore,
      triggerReason,
      locationReason,
      volumeReason,
      scores: {
        regimeAlignment,
        locationQuality,
        triggerQuality,
        volumeConfirmation,
        rewardRisk: rewardRiskScore,
        total: totalScore,
      },
    };
  }
}

export const priceActionPlaybook = PriceActionPlaybook2026Engine;
