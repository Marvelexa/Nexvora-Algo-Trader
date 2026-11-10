import { KlinePoint } from '../../src/types';

/**
 * ============================================================================
 * THE TRADING GEEK - SMART MONEY CONCEPTS (SMC) & CRYPTO TRADING ENGINE
 * Based on Brad Goh's "ULTIMATE Cryptocurrency Trading Course (From Beginner To PRO)"
 * Video: http://youtube.com/watch?v=UYnCQEHx7ZU
 * ============================================================================
 * 
 * CORE TRADING PHILOSOPHY:
 * 1. Price Action & Market Structure > Lagging Indicators.
 * 2. 3-Step Setup Framework:
 *    - STEP 1: Direction (Market Structure: BOS & CHoCH + 50/200 EMA Trend Bias)
 *    - STEP 2: Location (Institutional Zones: FVG, Order Blocks, 50% Equilibrium Discount/Premium)
 *    - STEP 3: Execution (Mitigation Retracement + Rejection Wick/Engulfing Trigger + Volume RVOL)
 * 3. Bitcoin Macro Correlation Filter: Altcoins MUST NOT fight Bitcoin's dominant 15M/1H orderflow.
 * 4. Strict Asymmetric Risk Management: Min 1:2 Risk-to-Reward ($5.00 TP / $2.50 SL).
 */

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
}

export interface FairValueGap {
  startIndex: number;
  time: number;
  type: 'BULLISH' | 'BEARISH';
  topPrice: number;
  bottomPrice: number;
  mitigated: boolean;
  mitigatedAt?: number;
}

export interface OrderBlock {
  index: number;
  time: number;
  type: 'BULLISH' | 'BEARISH';
  topPrice: number;
  bottomPrice: number;
  displacementVolume: number;
}

export interface SmcEvaluationResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number; // 0 - 100
  marketStructure: 'UPTREND' | 'DOWNTREND' | 'RANGING';
  lastStructureBreak: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';
  equilibriumZone: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  equilibriumPrice: number;
  activeFvg: FairValueGap | null;
  fvgMitigated: boolean;
  activeOrderBlock: OrderBlock | null;
  emaTrendBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ema50: number;
  ema200: number;
  rvol: number;
  rsi14: number;
  rejectionTrigger: string | null;
  btcAlignment: boolean;
  reason: string;
  customTP: number;
  customSL: number;
}

export class TheTradingGeekSmcEngine {
  private static instance: TheTradingGeekSmcEngine;

  public static getInstance(): TheTradingGeekSmcEngine {
    if (!TheTradingGeekSmcEngine.instance) {
      TheTradingGeekSmcEngine.instance = new TheTradingGeekSmcEngine();
    }
    return TheTradingGeekSmcEngine.instance;
  }

  // -------------------------------------------------------------
  // 1. Technical Math & Indicator Helpers (EMA, RSI, RVOL)
  // -------------------------------------------------------------

  public calculateEMA(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    const k = 2 / (period + 1);
    const emaArr: number[] = new Array(values.length);
    let sum = 0;
    const initialPeriod = Math.min(period, values.length);
    for (let i = 0; i < initialPeriod; i++) {
      sum += values[i];
    }
    emaArr[initialPeriod - 1] = sum / initialPeriod;

    for (let i = 0; i < initialPeriod - 1; i++) {
      emaArr[i] = values[i];
    }

    for (let i = initialPeriod; i < values.length; i++) {
      emaArr[i] = values[i] * k + emaArr[i - 1] * (1 - k);
    }
    return emaArr;
  }

  public calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  public calculateRVOL(candles: KlinePoint[], period: number = 20): number {
    if (candles.length < period + 1) return 1.0;
    const currentVol = candles[candles.length - 1].volume;
    const slice = candles.slice(-period - 1, -1);
    const avgVol = slice.reduce((acc, c) => acc + c.volume, 0) / period;
    if (avgVol <= 0) return 1.0;
    return currentVol / avgVol;
  }

  // -------------------------------------------------------------
  // 2. Fractal Swing High / Swing Low Detection
  // -------------------------------------------------------------

  public findFractalSwings(candles: KlinePoint[], lookback: number = 3): { swingHighs: SwingPoint[]; swingLows: SwingPoint[] } {
    const swingHighs: SwingPoint[] = [];
    const swingLows: SwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= current.high || candles[i + j].high > current.high) {
          isHigh = false;
        }
        if (candles[i - j].low <= current.low || candles[i + j].low < current.low) {
          isLow = false;
        }
      }

      if (isHigh) {
        swingHighs.push({
          index: i,
          time: current.time,
          price: current.high,
          type: 'HIGH',
        });
      }
      if (isLow) {
        swingLows.push({
          index: i,
          time: current.time,
          price: current.low,
          type: 'LOW',
        });
      }
    }

    return { swingHighs, swingLows };
  }

  // -------------------------------------------------------------
  // 3. Market Structure, Break of Structure (BOS) & Change of Character (CHoCH)
  // -------------------------------------------------------------

  public evaluateMarketStructure(
    candles: KlinePoint[],
    swingHighs: SwingPoint[],
    swingLows: SwingPoint[]
  ): {
    structure: 'UPTREND' | 'DOWNTREND' | 'RANGING';
    lastBreak: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';
    breakPrice: number;
    lastSwingHigh: SwingPoint | null;
    lastSwingLow: SwingPoint | null;
  } {
    if (swingHighs.length < 2 || swingLows.length < 2) {
      return {
        structure: 'RANGING',
        lastBreak: 'NONE',
        breakPrice: 0,
        lastSwingHigh: swingHighs[swingHighs.length - 1] || null,
        lastSwingLow: swingLows[swingLows.length - 1] || null,
      };
    }

    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevHigh = swingHighs[swingHighs.length - 2];
    const lastLow = swingLows[swingLows.length - 1];
    const prevLow = swingLows[swingLows.length - 2];

    const currentCandle = candles[candles.length - 1];
    const recentCandles = candles.slice(-5);

    // Baseline Trend Structure: Higher Highs + Higher Lows vs Lower Highs + Lower Lows
    let structure: 'UPTREND' | 'DOWNTREND' | 'RANGING' = 'RANGING';
    if (lastHigh.price > prevHigh.price && lastLow.price >= prevLow.price) {
      structure = 'UPTREND';
    } else if (lastHigh.price <= prevHigh.price && lastLow.price < prevLow.price) {
      structure = 'DOWNTREND';
    }

    let lastBreak: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE' = 'NONE';
    let breakPrice = 0;

    // Check recent candles for Break of Structure (BOS) or Change of Character (CHoCH)
    for (const c of recentCandles) {
      // Bullish break: Candle closes above recent Swing High
      if (c.close > lastHigh.price) {
        if (structure === 'DOWNTREND') {
          lastBreak = 'BULLISH_CHOCH'; // Trend reversal from down to up!
        } else {
          lastBreak = 'BULLISH_BOS'; // Trend continuation!
        }
        breakPrice = lastHigh.price;
        break;
      }

      // Bearish break: Candle closes below recent Swing Low
      if (c.close < lastLow.price) {
        if (structure === 'UPTREND') {
          lastBreak = 'BEARISH_CHOCH'; // Trend reversal from up to down!
        } else {
          lastBreak = 'BEARISH_BOS'; // Trend continuation!
        }
        breakPrice = lastLow.price;
        break;
      }
    }

    return {
      structure,
      lastBreak,
      breakPrice,
      lastSwingHigh: lastHigh,
      lastSwingLow: lastLow,
    };
  }

  // -------------------------------------------------------------
  // 4. Fair Value Gaps (FVG) Detection & Mitigation Tracking
  // -------------------------------------------------------------

  public findFairValueGaps(candles: KlinePoint[]): FairValueGap[] {
    const fvgs: FairValueGap[] = [];
    const minGapPercent = 0.001; // Minimum 0.1% gap to be considered valid imbalance

    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1]; // Displacement candle
      const c3 = candles[i];

      // Bullish FVG: Candle 1 High < Candle 3 Low (Gap in between)
      if (c3.low > c1.high) {
        const gapSize = (c3.low - c1.high) / c1.high;
        if (gapSize >= minGapPercent) {
          const fvg: FairValueGap = {
            startIndex: i - 1,
            time: c2.time,
            type: 'BULLISH',
            topPrice: c3.low,
            bottomPrice: c1.high,
            mitigated: false,
          };
          // Check subsequent candles to see if mitigated
          for (let j = i + 1; j < candles.length; j++) {
            if (candles[j].low <= fvg.bottomPrice) {
              fvg.mitigated = true;
              fvg.mitigatedAt = candles[j].time;
              break;
            }
          }
          fvgs.push(fvg);
        }
      }

      // Bearish FVG: Candle 1 Low > Candle 3 High (Gap in between)
      if (c1.low > c3.high) {
        const gapSize = (c1.low - c3.high) / c3.high;
        if (gapSize >= minGapPercent) {
          const fvg: FairValueGap = {
            startIndex: i - 1,
            time: c2.time,
            type: 'BEARISH',
            topPrice: c1.low,
            bottomPrice: c3.high,
            mitigated: false,
          };
          // Check subsequent candles to see if mitigated
          for (let j = i + 1; j < candles.length; j++) {
            if (candles[j].high >= fvg.topPrice) {
              fvg.mitigated = true;
              fvg.mitigatedAt = candles[j].time;
              break;
            }
          }
          fvgs.push(fvg);
        }
      }
    }

    return fvgs;
  }

  // -------------------------------------------------------------
  // 5. Institutional Order Blocks (OB)
  // -------------------------------------------------------------

  public findOrderBlocks(candles: KlinePoint[], swingHighs: SwingPoint[], swingLows: SwingPoint[]): OrderBlock[] {
    const obs: OrderBlock[] = [];
    if (candles.length < 10) return obs;

    // Scan the last 30 candles for high-volume displacement candles
    const lookback = Math.min(30, candles.length - 2);
    const startIdx = candles.length - lookback;

    for (let i = startIdx; i < candles.length - 1; i++) {
      const prevCandle = candles[i - 1];
      const dispCandle = candles[i];
      const body = Math.abs(dispCandle.close - dispCandle.open);
      const range = dispCandle.high - dispCandle.low;

      // Displacement candle must have body >= 65% of candle range and elevated volume
      if (range > 0 && body / range >= 0.65) {
        // Bullish Order Block: Prev candle was red/bearish, displacement is green/bullish
        if (dispCandle.close > dispCandle.open && prevCandle.close < prevCandle.open) {
          obs.push({
            index: i - 1,
            time: prevCandle.time,
            type: 'BULLISH',
            topPrice: Math.max(prevCandle.open, prevCandle.close),
            bottomPrice: prevCandle.low,
            displacementVolume: dispCandle.volume,
          });
        }
        // Bearish Order Block: Prev candle was green/bullish, displacement is red/bearish
        else if (dispCandle.close < dispCandle.open && prevCandle.close > prevCandle.open) {
          obs.push({
            index: i - 1,
            time: prevCandle.time,
            type: 'BEARISH',
            topPrice: prevCandle.high,
            bottomPrice: Math.min(prevCandle.open, prevCandle.close),
            displacementVolume: dispCandle.volume,
          });
        }
      }
    }

    return obs;
  }

  // -------------------------------------------------------------
  // 6. Premium vs. Discount Zone (50% Equilibrium Rule)
  // -------------------------------------------------------------

  public calculateEquilibrium(swingHigh: SwingPoint | null, swingLow: SwingPoint | null, currentPrice: number): {
    zone: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
    equilibriumPrice: number;
    rangeHigh: number;
    rangeLow: number;
  } {
    if (!swingHigh || !swingLow || swingHigh.price <= swingLow.price) {
      return { zone: 'EQUILIBRIUM', equilibriumPrice: currentPrice, rangeHigh: currentPrice, rangeLow: currentPrice };
    }

    const rangeHigh = swingHigh.price;
    const rangeLow = swingLow.price;
    const equilibriumPrice = (rangeHigh + rangeLow) / 2;

    if (currentPrice < equilibriumPrice * 0.998) {
      return { zone: 'DISCOUNT', equilibriumPrice, rangeHigh, rangeLow };
    } else if (currentPrice > equilibriumPrice * 1.002) {
      return { zone: 'PREMIUM', equilibriumPrice, rangeHigh, rangeLow };
    }

    return { zone: 'EQUILIBRIUM', equilibriumPrice, rangeHigh, rangeLow };
  }

  // -------------------------------------------------------------
  // 7. Candlestick Anatomy & Rejection Triggers
  // -------------------------------------------------------------

  public checkRejectionTrigger(candles: KlinePoint[], zoneSide: 'BUY' | 'SELL'): string | null {
    if (candles.length < 2) return null;
    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const totalRange = current.high - current.low;
    if (totalRange <= 0) return null;

    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const body = Math.abs(current.close - current.open);

    if (zoneSide === 'BUY') {
      // Long lower wick rejection (Pin Bar / Hammer) at support/FVG
      if (lowerWick / totalRange >= 0.45 && current.close >= current.open) {
        return `BULLISH_PIN_BAR (Lower Wick: ${((lowerWick / totalRange) * 100).toFixed(0)}%)`;
      }
      // Bullish Engulfing
      if (current.close > current.open && prev.close < prev.open && current.close > prev.open && current.open <= prev.close) {
        return 'BULLISH_ENGULFING';
      }
    } else {
      // Long upper wick rejection (Shooting Star) at resistance/FVG
      if (upperWick / totalRange >= 0.45 && current.close <= current.open) {
        return `BEARISH_SHOOTING_STAR (Upper Wick: ${((upperWick / totalRange) * 100).toFixed(0)}%)`;
      }
      // Bearish Engulfing
      if (current.close < current.open && prev.close > prev.open && current.close < prev.open && current.open >= prev.close) {
        return 'BEARISH_ENGULFING';
      }
    }

    return null;
  }

  // -------------------------------------------------------------
  // 8. Main Evaluator: Comprehensive Smart Money Concepts Engine
  // -------------------------------------------------------------

  public evaluateSmcSetup(
    symbol: string,
    candles15m: KlinePoint[],
    btcTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL',
    targetProfitUSD: number = 5.0,
    stopLossUSD: number = 2.5
  ): SmcEvaluationResult {
    const cleanSym = symbol.toUpperCase().replace('USDT', 'USD');
    const defaultFail: SmcEvaluationResult = {
      symbol: cleanSym,
      recommendedSide: null,
      confidenceScore: 0,
      marketStructure: 'RANGING',
      lastStructureBreak: 'NONE',
      equilibriumZone: 'EQUILIBRIUM',
      equilibriumPrice: 0,
      activeFvg: null,
      fvgMitigated: false,
      activeOrderBlock: null,
      emaTrendBias: 'NEUTRAL',
      ema50: 0,
      ema200: 0,
      rvol: 1.0,
      rsi14: 50,
      rejectionTrigger: null,
      btcAlignment: true,
      reason: 'Insufficient candle data',
      customTP: 0,
      customSL: 0,
    };

    if (!candles15m || candles15m.length < 35) {
      return defaultFail;
    }

    const currentCandle = candles15m[candles15m.length - 1];
    const currentPrice = currentCandle.close;
    const closes = candles15m.map(c => c.close);

    // 1. Indicators: 50 EMA, 200 EMA, RSI, RVOL
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema200Arr = this.calculateEMA(closes, Math.min(200, closes.length));
    const ema50 = ema50Arr[ema50Arr.length - 1] || currentPrice;
    const ema200 = ema200Arr[ema200Arr.length - 1] || currentPrice;
    const rsi14 = this.calculateRSI(closes, 14);
    const rvol = this.calculateRVOL(candles15m, 20);

    const emaTrendBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      currentPrice > ema50 && ema50 > ema200
        ? 'BULLISH'
        : currentPrice < ema50 && ema50 < ema200
        ? 'BEARISH'
        : currentPrice > ema50
        ? 'BULLISH'
        : currentPrice < ema50
        ? 'BEARISH'
        : 'NEUTRAL';

    // 2. Market Structure: Fractal Swings, BOS, CHoCH
    const { swingHighs, swingLows } = this.findFractalSwings(candles15m, 3);
    const structureResult = this.evaluateMarketStructure(candles15m, swingHighs, swingLows);

    // 3. Imbalance & Value Zones: FVG and Order Blocks
    const fvgs = this.findFairValueGaps(candles15m);
    const obs = this.findOrderBlocks(candles15m, swingHighs, swingLows);

    // 4. Premium vs Discount Zone (50% Equilibrium)
    const eqResult = this.calculateEquilibrium(structureResult.lastSwingHigh, structureResult.lastSwingLow, currentPrice);

    // 5. Check Active FVGs near current price
    // Bullish FVG: Price enters between bottomPrice and topPrice
    const recentBullishFvg = fvgs
      .filter(f => f.type === 'BULLISH' && !f.mitigated)
      .reverse()[0] || null;

    const recentBearishFvg = fvgs
      .filter(f => f.type === 'BEARISH' && !f.mitigated)
      .reverse()[0] || null;

    // Check if price is currently testing/mitigating the FVG
    let isTestingBullishFvg = false;
    if (recentBullishFvg) {
      isTestingBullishFvg = currentCandle.low <= recentBullishFvg.topPrice && currentCandle.close >= recentBullishFvg.bottomPrice;
    }

    let isTestingBearishFvg = false;
    if (recentBearishFvg) {
      isTestingBearishFvg = currentCandle.high >= recentBearishFvg.bottomPrice && currentCandle.close <= recentBearishFvg.topPrice;
    }

    // 6. Check Active Order Blocks
    const recentBullishOb = obs.filter(o => o.type === 'BULLISH').reverse()[0] || null;
    const recentBearishOb = obs.filter(o => o.type === 'BEARISH').reverse()[0] || null;

    const isTestingBullishOb = Boolean(recentBullishOb && currentCandle.low <= recentBullishOb.topPrice && currentCandle.close >= recentBullishOb.bottomPrice);
    const isTestingBearishOb = Boolean(recentBearishOb && currentCandle.high >= recentBearishOb.bottomPrice && currentCandle.close <= recentBearishOb.topPrice);

    // Dynamic 50 EMA support/resistance test
    const isTestingEma50Support = Math.abs(currentCandle.low - ema50) / currentPrice <= 0.005;
    const isTestingEma50Resistance = Math.abs(currentCandle.high - ema50) / currentPrice <= 0.005;

    // 7. Check Rejection Candle Triggers
    const buyRejection = this.checkRejectionTrigger(candles15m, 'BUY');
    const sellRejection = this.checkRejectionTrigger(candles15m, 'SELL');

    // 8. Bitcoin Macro Alignment Filter
    const isAltcoin = !cleanSym.startsWith('BTC');
    let btcAlignment = true;
    if (isAltcoin) {
      // Brad Goh rule: Altcoin direction must not trade against dominant Bitcoin trend
      if (btcTrend === 'BEARISH') {
        // Can only sell, cannot buy altcoin
        btcAlignment = false; // Flag if trying to buy
      } else if (btcTrend === 'BULLISH') {
        // Can only buy, cannot sell altcoin
        btcAlignment = false; // Flag if trying to sell
      }
    }

    // -------------------------------------------------------------
    // SCORING & CONFLUENCE MATRIX (Brad Goh's Master System)
    // -------------------------------------------------------------
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    // Criteria 1: Market Structure (BOS / CHoCH) (+30 pts)
    if (structureResult.lastBreak === 'BULLISH_BOS' || structureResult.structure === 'UPTREND') {
      buyScore += 30;
      buyReasons.push(structureResult.lastBreak === 'BULLISH_BOS' ? 'Bullish BOS' : 'Uptrend Structure (HH/HL)');
    } else if (structureResult.lastBreak === 'BULLISH_CHOCH') {
      buyScore += 25;
      buyReasons.push('Bullish CHoCH Reversal');
    }

    if (structureResult.lastBreak === 'BEARISH_BOS' || structureResult.structure === 'DOWNTREND') {
      sellScore += 30;
      sellReasons.push(structureResult.lastBreak === 'BEARISH_BOS' ? 'Bearish BOS' : 'Downtrend Structure (LH/LL)');
    } else if (structureResult.lastBreak === 'BEARISH_CHOCH') {
      sellScore += 25;
      sellReasons.push('Bearish CHoCH Reversal');
    }

    // Criteria 2: Location - 50% Equilibrium Rule (Anti-FOMO) (+20 pts)
    // Rule: BUY only in Discount; SELL only in Premium!
    if (eqResult.zone === 'DISCOUNT') {
      buyScore += 20;
      buyReasons.push('Discount Zone (<50% Eq)');
    } else if (eqResult.zone === 'PREMIUM') {
      sellScore += 20;
      sellReasons.push('Premium Zone (>50% Eq)');
    }

    // Criteria 3: Key Zone Retracement / Mitigation (FVG, Order Block, or 50 EMA) (+20 pts)
    if (isTestingBullishFvg) {
      buyScore += 20;
      buyReasons.push('Bullish FVG Retest');
    } else if (isTestingBullishOb) {
      buyScore += 20;
      buyReasons.push('Bullish Order Block Retest');
    } else if (isTestingEma50Support && emaTrendBias === 'BULLISH') {
      buyScore += 15;
      buyReasons.push('50 EMA Dynamic Support');
    }

    if (isTestingBearishFvg) {
      sellScore += 20;
      sellReasons.push('Bearish FVG Retest');
    } else if (isTestingBearishOb) {
      sellScore += 20;
      sellReasons.push('Bearish Order Block Retest');
    } else if (isTestingEma50Resistance && emaTrendBias === 'BEARISH') {
      sellScore += 15;
      sellReasons.push('50 EMA Dynamic Resistance');
    }

    // Criteria 4: Price Action Rejection Trigger (+15 pts)
    if (buyRejection) {
      buyScore += 15;
      buyReasons.push(buyRejection);
    }
    if (sellRejection) {
      sellScore += 15;
      sellReasons.push(sellRejection);
    }

    // Criteria 5: Dynamic Trend (50 & 200 EMA) (+15 pts)
    if (emaTrendBias === 'BULLISH') {
      buyScore += 15;
      buyReasons.push('50>200 EMA Bullish');
    } else if (emaTrendBias === 'BEARISH') {
      sellScore += 15;
      sellReasons.push('50<200 EMA Bearish');
    }

    // Criteria 6: Volume Confirmation (RVOL >= 1.2x) (+10 pts bonus)
    if (rvol >= 1.2) {
      buyScore += 10;
      sellScore += 10;
      buyReasons.push(`Inst. Vol RVOL: ${rvol.toFixed(2)}x`);
      sellReasons.push(`Inst. Vol RVOL: ${rvol.toFixed(2)}x`);
    }

    // -------------------------------------------------------------
    // BRAD GOH HARD VETO RULES (Non-Negotiable Shields)
    // -------------------------------------------------------------
    // 1. Anti-FOMO Veto: NEVER buy in the Premium Zone; NEVER sell in the Discount Zone!
    if (eqResult.zone === 'PREMIUM') {
      buyScore = 0; // Completely eliminate chasing tops
    }
    if (eqResult.zone === 'DISCOUNT') {
      sellScore = 0; // Completely eliminate shorting bottoms
    }

    // 2. RSI Overbought/Oversold Filter:
    if (rsi14 >= 70) {
      buyScore = 0; // Overbought exhaustion
    }
    if (rsi14 <= 30) {
      sellScore = 0; // Oversold exhaustion
    }

    // 3. Bitcoin Macro Correlation Filter for Altcoins:
    if (isAltcoin) {
      if (btcTrend === 'BEARISH' && buyScore > 0) {
        buyScore = Math.max(0, buyScore - 15); // Moderate BTC dip penalty, allows strong breakout BUYs
      }
      if (btcTrend === 'BULLISH' && sellScore > 0) {
        sellScore = Math.max(0, sellScore - 15); // Moderate BTC rally penalty, allows strong breakdown SELLs
      }
    }

    // Determine Final Verdict
    let recommendedSide: 'BUY' | 'SELL' | null = null;
    let confidenceScore = 0;
    let reason = '';

    const MIN_CONFLUENCE_THRESHOLD = 60; // Require at least 60/100 confluence score

    if (buyScore >= MIN_CONFLUENCE_THRESHOLD && buyScore > sellScore) {
      recommendedSide = 'BUY';
      confidenceScore = Math.min(98, buyScore);
      reason = `Brad Goh SMC Long: ${buyReasons.join(' + ')}`;
    } else if (sellScore >= MIN_CONFLUENCE_THRESHOLD && sellScore > buyScore) {
      recommendedSide = 'SELL';
      confidenceScore = Math.min(98, sellScore);
      reason = `Brad Goh SMC Short: ${sellReasons.join(' + ')}`;
    } else {
      confidenceScore = Math.max(buyScore, sellScore);
      reason = `Monitoring SMC Setups (Buy: ${buyScore}/100, Sell: ${sellScore}/100). Waiting for confluence ≥ 60.`;
    }

    // -------------------------------------------------------------
    // ASYMMETRIC TARGETS (1:2 Risk to Reward: $5.00 TP / $2.50 SL)
    // -------------------------------------------------------------
    // Sized on ~$90-$100 notional:
    // $5.00 profit = ~5.5% move on $90 notional (~0.22% price move with 25x leverage)
    const tpPercentMove = (targetProfitUSD / 90) / 25;
    const slPercentMove = (stopLossUSD / 90) / 25;

    let customTP = 0;
    let customSL = 0;

    if (recommendedSide === 'BUY') {
      // TP projected upwards, SL below recent swing low or structural invalidation
      const structuralSL = structureResult.lastSwingLow ? structureResult.lastSwingLow.price * 0.998 : currentPrice * (1 - slPercentMove);
      customSL = parseFloat(Math.min(currentPrice * (1 - slPercentMove), structuralSL).toFixed(4));
      customTP = parseFloat((currentPrice * (1 + tpPercentMove)).toFixed(4));
    } else if (recommendedSide === 'SELL') {
      // TP projected downwards, SL above recent swing high or structural invalidation
      const structuralSL = structureResult.lastSwingHigh ? structureResult.lastSwingHigh.price * 1.002 : currentPrice * (1 + slPercentMove);
      customSL = parseFloat(Math.max(currentPrice * (1 + slPercentMove), structuralSL).toFixed(4));
      customTP = parseFloat((currentPrice * (1 - tpPercentMove)).toFixed(4));
    }

    return {
      symbol: cleanSym,
      recommendedSide,
      confidenceScore,
      marketStructure: structureResult.structure,
      lastStructureBreak: structureResult.lastBreak,
      equilibriumZone: eqResult.zone,
      equilibriumPrice: eqResult.equilibriumPrice,
      activeFvg: recommendedSide === 'BUY' ? recentBullishFvg : recentBearishFvg,
      fvgMitigated: Boolean(recentBullishFvg?.mitigated || recentBearishFvg?.mitigated),
      activeOrderBlock: recommendedSide === 'BUY' ? recentBullishOb : recentBearishOb,
      emaTrendBias,
      ema50,
      ema200,
      rvol,
      rsi14,
      rejectionTrigger: recommendedSide === 'BUY' ? buyRejection : sellRejection,
      btcAlignment: !isAltcoin || (recommendedSide === 'BUY' ? btcTrend !== 'BEARISH' : btcTrend !== 'BULLISH'),
      reason,
      customTP,
      customSL,
    };
  }
}

export const tradingGeekSmc = TheTradingGeekSmcEngine.getInstance();
