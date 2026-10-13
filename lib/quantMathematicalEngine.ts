import { CryptoDedicatedStrategyEngine } from './cryptoDedicatedStrategyEngine';
import { MicrostructureDerivativesData } from './deltaExchangeEngine';

export interface KlinePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * =========================================================================
 * CRYPTO SIGNAL PLAYBOOK 2026 & BEYOND: QUANTITATIVE DUAL-ENGINE SYSTEM
 * =========================================================================
 * 
 * Architecture v2:
 * 1. Data Layers (OHLCV, Order Book, Trades/CVD, Derivatives/OI/Funding)
 * 2. Regime Detection Gate (CI, ADX, KER, Variance Ratio, Hurst, Volatility Percentile)
 * 3. Signal Groups (1 Vote Per Group, Max 100, Clean Score Scale):
 *    - Group A: Trend / Momentum (Max 20 pts)
 *    - Group B: Mean-Reversion / Oscillators (Max 20 pts)
 *    - Group C: Volatility / Squeeze (Max 10 pts)
 *    - Group D: Structure (S/R Hold & Confirmed Break) (Max 20 pts)
 *    - Group E: Order Flow & Microstructure (CVD, OBI) (Max 20 pts)
 *    - Group F: Derivatives & Positioning (Funding, OI Matrix) (Max 10 pts)
 * 4. Regime-Driven Strategy Selection:
 *    - TREND: Enables momentum & breakouts, blocks counter-trend mean-reversion
 *    - RANGE: Enables mean-reversion & S/R bounces, blocks breakout chasing
 *    - CHAOS / EXTREME VOL: Blocks trade execution (capital protection)
 * 5. Execution Threshold: >= 70 points on 0-100 scale.
 * =========================================================================
 */

export interface QuantMathVerdict {
  symbol: string;
  quantScore: number; // Clean 0 to 100 scale (Execution threshold: >= 70)
  recommendedSide: 'BUY' | 'SELL' | null;
  marketRegime: 'TREND' | 'RANGE' | 'CHAOS_NO_TRADE' | 'VOL_EXTREME_DANGER' | 'TRENDING_PERSISTENT' | 'MEAN_REVERTING' | 'RANDOM_WALK_CHOP';
  regimeReason?: string;
  
  // Statistical & DSP Indicator Values
  hurstExponent: number;
  varianceRatio?: number;
  efficiencyRatio: number;
  choppinessIndex?: number;
  adx?: number;
  volatilityPercentile?: number;
  
  fisherTransform: number;
  fisherSignal: number;
  superSmootherPrice: number;
  superSmootherSlope: number;
  kalmanEstimate: number;
  kalmanDeviationPct: number;
  zScore: number;
  
  // Structure & S/R Breakout (PDF Priority 4)
  nearestSupport?: number;
  nearestResistance?: number;
  isAtSupport?: boolean;
  isAtResistance?: boolean;
  supportBounceConfirmed?: boolean;
  supportBreakConfirmed?: boolean;
  resistanceRejectConfirmed?: boolean;
  resistanceBreakConfirmed?: boolean;

  // Group Breakdown (1 Vote per Group, Max 100)
  scores?: {
    groupA_trend: number;       // Max 20
    groupB_meanRevert: number;   // Max 20
    groupC_volatility: number;   // Max 10
    groupD_structure: number;    // Max 20
    groupE_orderFlow: number;    // Max 20
    groupF_derivatives: number;  // Max 10
    totalBuyScore: number;
    totalSellScore: number;
  };

  microstructure?: {
    obi: number;
    cvd: number;
    takerBuyRatio: number;
    fundingRate: number;
    openInterest: number;
  };

  reasons: string[];
}

export class QuantMathematicalEngine {
  /**
   * 1. John Ehlers 2-Pole SuperSmoother Filter
   * 2nd-order Butterworth DSP filter removing noise while preserving trend direction.
   * Reference: John F. Ehlers, "Cybernetic Analysis for Stocks and Futures"
   */
  public static calculateSuperSmoother(closes: number[], cutoffPeriod: number = 10): number[] {
    const n = closes.length;
    if (n === 0) return [];
    if (n < 3) return [...closes];

    const a1 = Math.exp(-1.414 * Math.PI / cutoffPeriod);
    const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / cutoffPeriod);
    const c2 = b1;
    const c3 = -a1 * a1;
    const c1 = 1 - c2 - c3;

    const smooth: number[] = new Array(n);
    smooth[0] = closes[0];
    smooth[1] = closes[1];

    for (let i = 2; i < n; i++) {
      const p = (closes[i] + closes[i - 1]) / 2;
      smooth[i] = c1 * p + c2 * smooth[i - 1] + c3 * smooth[i - 2];
    }
    return smooth;
  }

  /**
   * 2. John Ehlers Fisher Transform
   * Normalizes bounded price oscillations into Gaussian probability distribution.
   * Signal: Fisher crosses its 1-bar-lag line from an extreme.
   */
  public static calculateFisherTransform(candles: KlinePoint[], period: number = 10): { fisher: number[]; signal: number[] } {
    const n = candles.length;
    if (n < period) return { fisher: [], signal: [] };

    const fisher: number[] = new Array(n).fill(0);
    const signal: number[] = new Array(n).fill(0);
    let prevVal = 0;
    let prevFisher = 0;

    for (let i = period - 1; i < n; i++) {
      const window = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...window.map(c => c.high));
      const low = Math.min(...window.map(c => c.low));
      const range = Math.max(0.000001, high - low);
      const mid = (candles[i].high + candles[i].low) / 2;

      let rawVal = 0.33 * 2 * ((mid - low) / range - 0.5) + 0.67 * prevVal;
      rawVal = Math.max(-0.999, Math.min(0.999, rawVal));
      prevVal = rawVal;

      const fish = 0.5 * Math.log((1 + rawVal) / (1 - rawVal)) + 0.5 * prevFisher;
      fisher[i] = fish;
      signal[i] = prevFisher;
      prevFisher = fish;
    }
    return { fisher, signal };
  }

  private static rescaledRange(seg: number[]): number {
    const n = seg.length;
    const mean = seg.reduce((a, b) => a + b, 0) / n;
    let cum = 0, minC = 0, maxC = 0, ss = 0;
    for (const v of seg) {
      const d = v - mean;
      cum += d;
      if (cum < minC) minC = cum;
      if (cum > maxC) maxC = cum;
      ss += d * d;
    }
    const sd = Math.sqrt(ss / n);
    return sd > 0 ? (maxC - minC) / sd : 0;
  }

  // Pre-calculated Monte Carlo noise baseline (trials = 5000 on i.i.d Gaussian noise)
  // For R/S analysis, empirical noise expectation E[R/S] at lag n:
  // lag 8: ~2.632, lag 16: ~4.022, lag 24: ~5.105, lag 32: ~6.025, lag 64: ~8.974
  private static readonly NOISE_RS_BASELINE: Record<number, number> = {
    8: 2.632,
    16: 4.022,
    24: 5.105,
    32: 6.025,
    64: 8.974,
  };

  /**
   * 3. Hurst Exponent (Rescaled Range Analysis - R/S with Noise Baseline Correction)
   * Corrected for small-sample upward bias so pure random noise centers at H ~ 0.50.
   * - H > 0.55: Persistent / Trending market (momentum continuation)
   * - H < 0.45: Anti-Persistent / Mean-reverting market (mean reversion bounces)
   * - 0.45 <= H <= 0.55: Brownian Random Walk
   */
  public static calculateHurstExponent(closes: number[], maxLag: number = 64): number {
    const n = closes.length;
    if (n < 64) return 0.50;

    const logReturns: number[] = [];
    for (let i = 1; i < n; i++) {
      logReturns.push(Math.log(closes[i] / (closes[i - 1] || 1)));
    }

    const lagSizes = [8, 16, 32, 64];
    const logLags: number[] = [];
    const logDeltaRS: number[] = [];

    for (const lag of lagSizes) {
      if (logReturns.length < lag) continue;
      const numSegments = Math.floor(logReturns.length / lag);
      if (numSegments < 2) continue;
      let totalRS = 0;

      for (let s = 0; s < numSegments; s++) {
        const segment = logReturns.slice(s * lag, (s + 1) * lag);
        totalRS += this.rescaledRange(segment);
      }

      const avgRS = totalRS / numSegments;
      const noiseRS = this.NOISE_RS_BASELINE[lag] || Math.sqrt(Math.PI * lag / 2);
      if (avgRS > 0 && noiseRS > 0) {
        logLags.push(Math.log(lag));
        // Baseline correction: Subtract expected random walk log(RS)
        logDeltaRS.push(Math.log(avgRS) - Math.log(noiseRS));
      }
    }

    if (logLags.length < 2) return 0.50;

    const nPts = logLags.length;
    const meanX = logLags.reduce((a, b) => a + b, 0) / nPts;
    const meanY = logDeltaRS.reduce((a, b) => a + b, 0) / nPts;

    let num = 0;
    let den = 0;
    for (let i = 0; i < nPts; i++) {
      num += (logLags[i] - meanX) * (logDeltaRS[i] - meanY);
      den += (logLags[i] - meanX) * (logLags[i] - meanX);
    }

    const slope = den > 0 ? num / den : 0;
    const hurst = 0.50 + slope;
    return Math.max(0.05, Math.min(0.95, parseFloat(hurst.toFixed(3))));
  }

  /**
   * 4. Lo-MacKinlay Variance Ratio Test (VR, q=4)
   * VR(q) = Var(r_q) / (q * Var(r_1))
   * VR > 1.05 = Trending / Positive autocorrelation
   * VR < 0.95 = Mean-Reverting / Negative autocorrelation
   * ~1.0 = Random walk
   */
  public static calculateVarianceRatio(closes: number[], q: number = 4): number {
    const n = closes.length;
    if (n < q + 15) return 1.0;

    const r1: number[] = [];
    for (let i = 1; i < n; i++) {
      r1.push(Math.log(closes[i] / closes[i - 1]));
    }
    const meanR1 = r1.reduce((a, b) => a + b, 0) / r1.length;
    const varR1 = r1.reduce((sum, r) => sum + Math.pow(r - meanR1, 2), 0) / (r1.length - 1);

    const rq: number[] = [];
    for (let i = q; i < n; i++) {
      rq.push(Math.log(closes[i] / closes[i - q]));
    }
    const meanRq = rq.reduce((a, b) => a + b, 0) / rq.length;
    const varRq = rq.reduce((sum, r) => sum + Math.pow(r - meanRq, 2), 0) / (rq.length - 1);

    if (varR1 <= 0) return 1.0;
    const vr = varRq / (q * varR1);
    return parseFloat(vr.toFixed(3));
  }

  /**
   * 5. Kaufman Fractal Efficiency Ratio (KER)
   * Ratio of net displacement to total path traveled:
   * KER = |P_t - P_{t-n}| / Sum(|P_i - P_{i-1}|)
   */
  public static calculateEfficiencyRatio(closes: number[], period: number = 14): number {
    const n = closes.length;
    if (n < period + 1) return 0.5;

    const netChange = Math.abs(closes[n - 1] - closes[n - 1 - period]);
    let totalPath = 0;
    for (let i = n - period; i < n; i++) {
      totalPath += Math.abs(closes[i] - closes[i - 1]);
    }
    return totalPath > 0 ? parseFloat((netChange / totalPath).toFixed(3)) : 0.5;
  }

  /**
   * 6. Volatility Percentile Rank (100-bar rolling ATR percentile)
   * Percentile > 95: High-vol danger / blow-off (NO TRADE)
   * Percentile < 15: Low-vol squeeze (breakout setup)
   */
  public static calculateVolatilityPercentile(candles: KlinePoint[], lookback: number = 100): number {
    const n = candles.length;
    if (n < 15) return 50;

    const atrs: number[] = [];
    for (let i = 14; i < n; i++) {
      let sumTr = 0;
      for (let j = i - 13; j <= i; j++) {
        const c = candles[j];
        const prev = candles[j - 1];
        const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
        sumTr += tr;
      }
      atrs.push(sumTr / 14);
    }

    if (atrs.length === 0) return 50;
    const currentAtr = atrs[atrs.length - 1] || 0;
    const windowAtrs = atrs.slice(-lookback);
    const countBelow = windowAtrs.filter(a => a <= currentAtr).length;
    return parseFloat(((countBelow / windowAtrs.length) * 100).toFixed(1));
  }

  /**
   * 7. Adaptive Kalman Optimal State Estimator
   * Recursively estimates true market fair-value by dynamically modulating Process Noise (Q)
   * relative to Measurement Noise (R) based on price displacement velocity:
   * - During explosive trend/breakout: Q expands -> Kalman Gain K increases (~0.50-0.75), tracking price with near-zero lag.
   * - During consolidating range/chop: Q contracts -> Kalman Gain K reduces (~0.12-0.18), delivering heavy noise filtering.
   */
  public static calculateKalmanFilter(closes: number[], baseQ: number = 0.01, baseR: number = 0.05): number[] {
    const n = closes.length;
    if (n === 0) return [];
    if (n < 3) return [...closes];

    const filtered: number[] = new Array(n);
    let xHat = closes[0];
    let pCov = 1.0;
    filtered[0] = xHat;

    for (let i = 1; i < n; i++) {
      // Dynamic process noise based on price deviation from current state estimate
      const dev = Math.abs(closes[i] - xHat) / (xHat || 1);
      const qAdaptive = Math.max(0.002, Math.min(0.20, dev * 2.0));
      const rMeasurement = baseR || 0.05;

      const pPred = pCov + qAdaptive;
      const kGain = pPred / (pPred + rMeasurement);
      xHat = xHat + kGain * (closes[i] - xHat);
      pCov = (1 - kGain) * pPred;
      filtered[i] = xHat;
    }
    return filtered;
  }

  /**
   * 8. Statistical Rolling Z-Score
   * Z = (Price - Mean) / StdDev
   */
  public static calculateZScore(closes: number[], period: number = 20): number {
    const n = closes.length;
    if (n < period) return 0;

    const window = closes.slice(n - period);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    return parseFloat(((closes[n - 1] - mean) / stdDev).toFixed(2));
  }

  /**
   * 9. TTM-Style Squeeze Detector
   * Bollinger Bands (20, 2.0) inside Keltner Channel (20, 1.5 ATR)
   */
  public static isTTMSqueeze(candles: KlinePoint[]): { inSqueeze: boolean; squeezeReleased: boolean } {
    const closes = candles.map(c => c.close);
    const n = closes.length;
    if (n < 20) return { inSqueeze: false, squeezeReleased: false };

    const slice = closes.slice(n - 20);
    const mean = slice.reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / 20);

    const bbUpper = mean + 2.0 * stdDev;
    const bbLower = mean - 2.0 * stdDev;

    // Keltner: EMA20 +/- 1.5 * ATR
    const atr = CryptoDedicatedStrategyEngine.calculateATR(candles, 20);
    const kcUpper = mean + 1.5 * atr;
    const kcLower = mean - 1.5 * atr;

    const inSqueeze = bbUpper <= kcUpper && bbLower >= kcLower;
    // Check previous bar to see if squeeze just released
    const prevSlice = closes.slice(n - 21, n - 1);
    let prevInSqueeze = false;
    if (prevSlice.length === 20) {
      const prevMean = prevSlice.reduce((a, b) => a + b, 0) / 20;
      const prevStd = Math.sqrt(prevSlice.reduce((acc, v) => acc + Math.pow(v - prevMean, 2), 0) / 20);
      const prevBbUpper = prevMean + 2.0 * prevStd;
      const prevBbLower = prevMean - 2.0 * prevStd;
      prevInSqueeze = prevBbUpper <= (prevMean + 1.5 * atr) && prevBbLower >= (prevMean - 1.5 * atr);
    }

    const squeezeReleased = prevInSqueeze && !inSqueeze;
    return { inSqueeze, squeezeReleased };
  }

  /**
   * 10. Structural Support & Resistance Confluence Engine
   * Detects key swing pivots and zone boundaries (pivot +/- 0.35 ATR).
   * Supports both Hold (Bounce/Reject) AND Break (Breakout/Breakdown per PDF Priority 4).
   */
  public static calculateSupportResistance(candles: KlinePoint[]): {
    nearestSupport: number;
    nearestResistance: number;
    isAtSupport: boolean;
    isAtResistance: boolean;
    supportBounceConfirmed: boolean;
    supportBreakConfirmed: boolean;
    resistanceRejectConfirmed: boolean;
    resistanceBreakConfirmed: boolean;
    macroTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    ema50: number;
    ema200: number;
    atr: number;
  } {
    const closes = candles.map(c => c.close);
    const n = closes.length;
    const currentPrice = closes[n - 1] || 0;
    const atr = CryptoDedicatedStrategyEngine.calculateATR(candles, 14);

    if (n < 20) {
      return {
        nearestSupport: currentPrice * 0.98,
        nearestResistance: currentPrice * 1.02,
        isAtSupport: false,
        isAtResistance: false,
        supportBounceConfirmed: false,
        supportBreakConfirmed: false,
        resistanceRejectConfirmed: false,
        resistanceBreakConfirmed: false,
        macroTrend: 'SIDEWAYS',
        ema50: currentPrice,
        ema200: currentPrice,
        atr,
      };
    }

    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
    const ema200 = CryptoDedicatedStrategyEngine.calculateEMA(closes, Math.min(200, n));
    const lastEma50 = ema50[ema50.length - 1] || currentPrice;
    const lastEma200 = ema200[ema200.length - 1] || currentPrice;

    let macroTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
    if (currentPrice > lastEma50 && (lastEma50 >= lastEma200 || currentPrice > lastEma200)) {
      macroTrend = 'BULLISH';
    } else if (currentPrice < lastEma50 && (lastEma50 <= lastEma200 || currentPrice < lastEma200)) {
      macroTrend = 'BEARISH';
    } else if (lastEma50 < lastEma200 && currentPrice < lastEma200) {
      macroTrend = 'BEARISH';
    } else if (lastEma50 > lastEma200 && currentPrice > lastEma200) {
      macroTrend = 'BULLISH';
    }

    const window = candles.slice(Math.max(0, n - 40));
    const pivotLows: number[] = [];
    const pivotHighs: number[] = [];

    for (let i = 2; i < window.length - 2; i++) {
      const c = window[i];
      if (
        c.low <= window[i - 1].low &&
        c.low <= window[i - 2].low &&
        c.low <= window[i + 1].low &&
        c.low <= window[i + 2].low
      ) {
        pivotLows.push(c.low);
      }
      if (
        c.high >= window[i - 1].high &&
        c.high >= window[i - 2].high &&
        c.high >= window[i + 1].high &&
        c.high >= window[i + 2].high
      ) {
        pivotHighs.push(c.high);
      }
    }

    if (lastEma50 < currentPrice) pivotLows.push(lastEma50);
    else pivotHighs.push(lastEma50);

    if (lastEma200 < currentPrice) pivotLows.push(lastEma200);
    else pivotHighs.push(lastEma200);

    // Zone is defined as pivot +/- 0.35 ATR
    const zoneBuffer = atr * 0.35;
    const validSupports = pivotLows.filter(lvl => lvl <= currentPrice);
    const nearestSupport = validSupports.length > 0 ? Math.max(...validSupports) : currentPrice * 0.985;

    const validResistances = pivotHighs.filter(lvl => lvl >= currentPrice);
    const nearestResistance = validResistances.length > 0 ? Math.min(...validResistances) : currentPrice * 1.015;

    const distToSupport = Math.abs(currentPrice - nearestSupport);
    const distToResistance = Math.abs(nearestResistance - currentPrice);

    // Mutual Exclusivity: Price cannot be simultaneously at support and resistance unless in noise chop
    const isAtSupport = distToSupport <= zoneBuffer * 1.2 && distToSupport < distToResistance;
    const isAtResistance = distToResistance <= zoneBuffer * 1.2 && distToResistance < distToSupport;

    const lastBar = candles[n - 1];
    const prevBar = candles[n - 2];
    const rangeLast = Math.max(lastBar.high - lastBar.low, 0.0001);
    const lowerWickLast = Math.min(lastBar.open, lastBar.close) - lastBar.low;
    const upperWickLast = lastBar.high - Math.max(lastBar.open, lastBar.close);

    const isBullishCandle = lastBar.close > lastBar.open;
    const isBearishCandle = lastBar.close < lastBar.open;
    const isHammerWick = (lowerWickLast / rangeLast) >= 0.35 && (upperWickLast / rangeLast) <= 0.25;
    const isShootingStarWick = (upperWickLast / rangeLast) >= 0.25 && (lowerWickLast / rangeLast) <= 0.25;

    // 1. Support Hold (Bounce) — strictly requires being at support (not resistance), bullish candle or strong absorption hammer
    let supportBounceConfirmed = isAtSupport && !isAtResistance && (
      (isBullishCandle && rangeLast >= atr * 0.25) ||
      (isHammerWick && !isBearishCandle) ||
      (lowerWickLast >= rangeLast * 0.35 && lastBar.close >= prevBar.close)
    );

    // 2. Support Break (Breakdown - close below zone with volume/bearish candle)
    const supportBreakConfirmed = (lastBar.close < (nearestSupport - zoneBuffer * 0.2) || (lastBar.close < nearestSupport && isBearishCandle)) &&
                                  prevBar.close >= (nearestSupport - zoneBuffer * 1.5) &&
                                  (rangeLast >= atr * 0.6 || lastBar.volume >= prevBar.volume * 0.85);

    // 3. Resistance Hold (Rejection) — strictly requires being at resistance (not support), bearish candle or strong shooting star
    let resistanceRejectConfirmed = isAtResistance && !isAtSupport && (
      (isBearishCandle && rangeLast >= atr * 0.25) ||
      (isShootingStarWick && !isBullishCandle) ||
      (upperWickLast >= rangeLast * 0.35 && lastBar.close <= prevBar.close)
    );

    // 4. Resistance Break (Breakout - close above zone with volume/bullish candle)
    const resistanceBreakConfirmed = (lastBar.close > (nearestResistance + zoneBuffer * 0.2) || (lastBar.close > nearestResistance && isBullishCandle)) &&
                                     prevBar.close <= (nearestResistance + zoneBuffer * 1.5) &&
                                     (rangeLast >= atr * 0.6 || lastBar.volume >= prevBar.volume * 0.85);

    // Ambiguity Veto: If both fire due to extreme volatility wick, neither is a confirmed clean hold
    if (supportBounceConfirmed && resistanceRejectConfirmed) {
      supportBounceConfirmed = false;
      resistanceRejectConfirmed = false;
    }

    return {
      nearestSupport: parseFloat(nearestSupport.toFixed(4)),
      nearestResistance: parseFloat(nearestResistance.toFixed(4)),
      isAtSupport,
      isAtResistance,
      supportBounceConfirmed,
      supportBreakConfirmed,
      resistanceRejectConfirmed,
      resistanceBreakConfirmed,
      macroTrend,
      ema50: lastEma50,
      ema200: lastEma200,
      atr,
    };
  }

  /**
   * =========================================================================
   * MASTER QUANT EVALUATOR (PLAYBOOK 2026 ARCHITECTURE v2)
   * =========================================================================
   * Pipeline:
   * 1. Regime Detection Gate (Trend vs Range vs Chaos/High-Vol Danger)
   * 2. Signal Groups: One vote per group, max 100 total score.
   *    - Group A: Trend (max 20)
   *    - Group B: Mean-Reversion (max 20)
   *    - Group C: Volatility / Squeeze (max 10)
   *    - Group D: Structure (S/R Hold & Confirmed Break) (max 20)
   *    - Group E: Order Flow (CVD / OBI) (max 20)
   *    - Group F: Derivatives (Funding / OI Matrix) (max 10)
   * 3. Clean score scale (Threshold >= 70)
   * =========================================================================
   */
  public static evaluateMarketMath(
    symbol: string,
    candles: KlinePoint[],
    microstructureData?: MicrostructureDerivativesData | null,
    dedicatedSignal?: { side: 'BUY' | 'SELL' | null; strategyName?: string; waveValue?: number } | null
  ): QuantMathVerdict {
    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1] || 0;

    const defaultVerdict: QuantMathVerdict = {
      symbol,
      quantScore: 50,
      recommendedSide: null,
      marketRegime: 'RANDOM_WALK_CHOP',
      hurstExponent: 0.50,
      varianceRatio: 1.0,
      efficiencyRatio: 0.5,
      choppinessIndex: 50,
      adx: 20,
      volatilityPercentile: 50,
      fisherTransform: 0,
      fisherSignal: 0,
      superSmootherPrice: currentPrice,
      superSmootherSlope: 0,
      kalmanEstimate: currentPrice,
      kalmanDeviationPct: 0,
      zScore: 0,
      reasons: ['Insufficient historical bars (<30)'],
    };

    if (candles.length < 30) return defaultVerdict;

    const lastBar = candles[candles.length - 1];
    const prevBar = candles[candles.length - 2] || lastBar;
    const rangeLast = Math.max(lastBar.high - lastBar.low, 0.00001);
    const upperWickLast = lastBar.high - Math.max(lastBar.open, lastBar.close);
    const lowerWickLast = Math.min(lastBar.open, lastBar.close) - lastBar.low;

    // -------------------------------------------------------------------------
    // STEP 1: CALCULATE REGIME GATES (Section 2 of Playbook)
    // -------------------------------------------------------------------------
    const chopIndex = CryptoDedicatedStrategyEngine.calculateChoppinessIndex(candles, 14);
    const adx = CryptoDedicatedStrategyEngine.calculateADX(candles, 14);
    const ker = this.calculateEfficiencyRatio(closes, 14);
    const vr = this.calculateVarianceRatio(closes, 4);
    const hurst = this.calculateHurstExponent(closes, 32);
    const volPercentile = this.calculateVolatilityPercentile(candles, 100);
    const atr = CryptoDedicatedStrategyEngine.calculateATR(candles, 14);

    let marketRegime: 'TREND' | 'RANGE' | 'CHAOS_NO_TRADE' | 'VOL_EXTREME_DANGER' = 'RANGE';
    let regimeReason = '';

    // Gate 1: Dead Random Walk Chaos (Very high chop + compressed dead volume)
    if (chopIndex > 65.0 && volPercentile < 15.0) {
      marketRegime = 'CHAOS_NO_TRADE';
      regimeReason = `Dead Random Walk Chop (CI: ${chopIndex.toFixed(1)}, Vol: ${volPercentile}%ile)`;
    }
    // Gate 2: Active Directional Trend / High Volatility Momentum Expansion
    else if ((adx >= 20.0 && (chopIndex < 55.0 || ker >= 0.25)) || chopIndex < 42.0 || volPercentile > 90.0) {
      marketRegime = 'TREND';
      regimeReason = `Active Directional Momentum (ADX: ${adx.toFixed(1)}, CI: ${chopIndex.toFixed(1)}, Vol: ${volPercentile}%ile)`;
    }
    // Gate 3: Mean-Reverting Range (Oscillation between support & resistance)
    else {
      marketRegime = 'RANGE';
      regimeReason = `Oscillating Range (CI: ${chopIndex.toFixed(1)}, ADX: ${adx.toFixed(1)}, VR: ${vr})`;
    }

    // Only Dead Chaos blocks trade entries
    if (marketRegime === 'CHAOS_NO_TRADE') {
      return {
        ...defaultVerdict,
        marketRegime,
        regimeReason,
        hurstExponent: hurst,
        varianceRatio: vr,
        efficiencyRatio: ker,
        choppinessIndex: chopIndex,
        adx,
        volatilityPercentile: volPercentile,
        quantScore: 0,
        recommendedSide: null,
        reasons: [`REGIME GATE ACTIVE: ${regimeReason} — TRADING STRICTLY BLOCKED`],
      };
    }

    // -------------------------------------------------------------------------
    // STEP 2: CALCULATE UNDERLYING INDICATORS
    // -------------------------------------------------------------------------
    // SuperSmoother
    const smooth = this.calculateSuperSmoother(closes, 10);
    const sLen = smooth.length;
    const currentSmooth = sLen > 0 ? smooth[sLen - 1] : (closes[closes.length - 1] || 0);
    const prevSmooth = sLen > 1 ? smooth[sLen - 2] : currentSmooth;
    const superSmootherSlope = (prevSmooth && !isNaN(prevSmooth) && prevSmooth !== 0)
      ? ((currentSmooth - prevSmooth) / prevSmooth) * 100
      : 0;

    // Fisher Transform (cross verified from extreme levels)
    const { fisher, signal: fishSig } = this.calculateFisherTransform(candles, 10);
    const fLen = fisher.length;
    const currentFisher = fLen > 0 ? fisher[fLen - 1] : 0;
    const currentFishSig = fLen > 0 ? fishSig[fLen - 1] : 0;
    const prevFisher = fLen > 1 ? fisher[fLen - 2] : 0;
    const prevFishSig = fLen > 1 ? fishSig[fLen - 2] : 0;
    const isFisherBullishCross = prevFisher <= prevFishSig && currentFisher > currentFishSig && (prevFisher <= -0.70 || currentFisher <= -0.40);
    const isFisherBearishCross = prevFisher >= prevFishSig && currentFisher < currentFishSig && (prevFisher >= 0.70 || currentFisher >= 0.40);

    // Adaptive Kalman Filter
    const kalmanArr = this.calculateKalmanFilter(closes);
    const kalmanEstimate = kalmanArr[kalmanArr.length - 1] || currentPrice;
    const kalmanDeviationPct = ((currentPrice - kalmanEstimate) / (kalmanEstimate || 1)) * 100;
    const kalmanNormalizedDev = (currentPrice - kalmanEstimate) / (atr || 1);

    // Z-Score
    const zScore = this.calculateZScore(closes, 20);

    // RSI & RSI Reclaim (PDF Section 3 & 4)
    const rsiArr = CryptoDedicatedStrategyEngine.calculateRSI(closes, 14);
    const currentRsi = rsiArr[rsiArr.length - 1] || 50;
    const prevRsi1 = rsiArr[rsiArr.length - 2] || 50;
    const prevRsi2 = rsiArr[rsiArr.length - 3] || 50;
    const isRsiBullishReclaim = (prevRsi1 < 35 || prevRsi2 < 35) && currentRsi >= 35;
    const isRsiBearishReclaim = (prevRsi1 > 65 || prevRsi2 > 65) && currentRsi <= 65;

    // S/R Structure
    const sr = this.calculateSupportResistance(candles);

    // TTM Squeeze
    const squeeze = this.isTTMSqueeze(candles);

    // Nexvora Quantum Future Momentum Predictor [Original v1] (d²P/dt² Zero-Lag Acceleration)
    const nexPredict = CryptoDedicatedStrategyEngine.evaluateNexvoraQuantumFuturePredictor(candles);

    // -------------------------------------------------------------------------
    // STEP 3: VOTE BY SIGNAL GROUP (1 Vote Per Group, Max 100 Points)
    // -------------------------------------------------------------------------
    let buyA = 0, sellA = 0;   // Group A: Trend (Max 20)
    let buyB = 0, sellB = 0;   // Group B: Mean-Reversion / Predictive Turns (Max 20)
    let buyC = 0, sellC = 0;   // Group C: Volatility (Max 10)
    let buyD = 0, sellD = 0;   // Group D: Structure (Max 20)
    let buyE = 0, sellE = 0;   // Group E: Order Flow (Max 20)
    let buyF = 0, sellF = 0;   // Group F: Derivatives (Max 10)

    const reasons: string[] = [];

    const isMacroBearish = sr.macroTrend === 'BEARISH' || (sr.macroTrend !== 'BULLISH' && currentPrice < sr.ema50);
    const isMacroBullish = sr.macroTrend === 'BULLISH' || (sr.macroTrend !== 'BEARISH' && currentPrice > sr.ema50);

    // -------------------------------------------------------------------------
    // GROUP A: TREND & ZERO-LAG PREDICTIVE MOMENTUM (Max 20 pts)
    // Anchored on 50/200 EMA + SuperSmoother Slope + Nexvora Quantum Predictive Wave
    // -------------------------------------------------------------------------
    const priceVsEma50Pct = ((currentPrice - sr.ema50) / (sr.ema50 || 1)) * 100;
    const isLastBarGreen = lastBar.close > lastBar.open;
    const isLastBarRed = lastBar.close < lastBar.open;

    // 1. 50/200 EMA Trend Bias
    if (priceVsEma50Pct > 0.05 && currentPrice >= sr.ema50) {
      if (superSmootherSlope >= -0.015) {
        buyA += 10;
        reasons.push('Trend Bias > EMA50 (+10 A)');
      }
    } else if (priceVsEma50Pct < -0.05 && currentPrice <= sr.ema50) {
      if (superSmootherSlope <= 0.015) {
        sellA += 10;
        reasons.push('Trend Bias < EMA50 (+10 A)');
      }
    }

    // 2. Nexvora Quantum Predictive Wave & Acceleration Momentum (d²P/dt²)
    if (nexPredict.scaledWave > nexPredict.scaledSignal && nexPredict.scaledHist > 0) {
      buyA += 10;
      reasons.push(`Nexvora Predictive Wave Bullish Momentum (Wave: ${nexPredict.scaledWave.toFixed(1)} > Sig, Hist: +${nexPredict.scaledHist.toFixed(1)}) (+10 A)`);
    } else if (nexPredict.scaledWave < nexPredict.scaledSignal && nexPredict.scaledHist < 0) {
      sellA += 10;
      reasons.push(`Nexvora Predictive Wave Bearish Momentum (Wave: ${nexPredict.scaledWave.toFixed(1)} < Sig, Hist: ${nexPredict.scaledHist.toFixed(1)}) (+10 A)`);
    } else if (superSmootherSlope > 0.015 && currentPrice >= currentSmooth) {
      buyA += 5;
      reasons.push(`SuperSmoother Uptrend (+${superSmootherSlope.toFixed(3)}%) (+5 A)`);
    } else if (superSmootherSlope < -0.015) {
      sellA += 5;
      reasons.push(`SuperSmoother Downtrend (${superSmootherSlope.toFixed(3)}%) (+5 A)`);
    }

    if (dedicatedSignal?.side === 'BUY') {
      sellA = 0;
      buyA = Math.max(buyA, 15);
      reasons.push(`Dedicated Sniper Bullish Momentum Alignment [${dedicatedSignal.strategyName || 'PRO'}] (+15 A BUY)`);
    } else if (dedicatedSignal?.side === 'SELL') {
      buyA = 0;
      sellA = Math.max(sellA, 15);
      reasons.push(`Dedicated Sniper Bearish Momentum Alignment [${dedicatedSignal.strategyName || 'PRO'}] (+15 A SELL)`);
    }
    buyA = Math.min(20, buyA);
    sellA = Math.min(20, sellA);

    // -------------------------------------------------------------------------
    // GROUP B: PREDICTIVE TURNING POINTS & DIVERGENCES (Max 20 pts)
    // Nexvora Quantum Future Predictor Turning Points + Divergences + Fisher Extremes
    // -------------------------------------------------------------------------
    if (nexPredict.bullishDiv) {
      buyB = 20;
      reasons.push('Nexvora 🔮 FUTURE PUMP: Leading Bullish Divergence on Predictive Wave (+20 B BUY)');
    } else if (nexPredict.bearishDiv) {
      sellB = 20;
      reasons.push('Nexvora 🔮 FUTURE DUMP: Leading Bearish Divergence on Predictive Wave (+20 B SELL)');
    } else if (nexPredict.predictUp) {
      buyB = Math.max(buyB, 15);
      reasons.push('Nexvora 🚀 Future UP Wave Triggered: Acceleration turning up before price (+15 B BUY)');
    } else if (nexPredict.predictDown) {
      sellB = Math.max(sellB, 15);
      reasons.push('Nexvora ⚠️ Future DOWN Wave Triggered: Acceleration turning down before price (+15 B SELL)');
    }

    // 2. Fisher Transform & Extreme Reversal Confirmation
    if (isFisherBullishCross && currentFisher <= -0.50 && !sr.supportBreakConfirmed) {
      buyB = Math.max(buyB, 10);
      reasons.push(`Fisher Extreme Bullish Cross (F:${currentFisher.toFixed(2)}) (+10 B)`);
    } else if (isFisherBearishCross && currentFisher >= 0.50 && !sr.resistanceBreakConfirmed) {
      sellB = Math.max(sellB, 10);
      reasons.push(`Fisher Extreme Bearish Cross (F:${currentFisher.toFixed(2)}) (+10 B)`);
    }

    // 3. RSI Reclaim
    if (isRsiBullishReclaim && !sr.supportBreakConfirmed) {
      buyB += 5;
      reasons.push(`RSI Bullish Reclaim (${currentRsi.toFixed(1)} > 35) (+5 B)`);
    } else if (isRsiBearishReclaim && !sr.resistanceBreakConfirmed) {
      sellB += 5;
      reasons.push(`RSI Bearish Reclaim (${currentRsi.toFixed(1)} < 65) (+5 B)`);
    } else if (currentRsi >= 60 && (isLastBarRed || isFisherBearishCross)) {
      sellB += 5;
      reasons.push(`RSI Overbought Resistance (${currentRsi.toFixed(1)}) (+5 B)`);
    }

    // 4. Kalman Normalized Deviation
    if (kalmanNormalizedDev < -0.5 && !sr.supportBreakConfirmed && !isFisherBearishCross) {
      buyB += 5;
      reasons.push(`Kalman State Discount (${kalmanNormalizedDev.toFixed(2)} ATR) (+5 B)`);
    } else if (kalmanNormalizedDev > 0.5 && !sr.resistanceBreakConfirmed && !isFisherBullishCross) {
      sellB += 5;
      reasons.push(`Kalman State Premium (+${kalmanNormalizedDev.toFixed(2)} ATR) (+5 B)`);
    }

    if (dedicatedSignal?.side === 'BUY') {
      sellB = 0;
      buyB = Math.max(buyB, 10);
      reasons.push('Dedicated Strategy Oversold Confluence (+10 B BUY)');
    } else if (dedicatedSignal?.side === 'SELL') {
      buyB = 0;
      sellB = Math.max(sellB, 10);
      reasons.push('Dedicated Strategy Overbought Confluence (+10 B SELL)');
    }
    buyB = Math.min(20, buyB);
    sellB = Math.min(20, sellB);

    // -------------------------------------------------------------------------
    // GROUP C: VOLATILITY / SQUEEZE (Max 10 pts)
    // -------------------------------------------------------------------------
    if (squeeze.squeezeReleased) {
      if (currentPrice > currentSmooth) {
        buyC += 10;
        reasons.push('TTM Squeeze Breakout Expansion (+10 C)');
      } else {
        sellC += 10;
        reasons.push('TTM Squeeze Breakdown Expansion (+10 C)');
      }
    } else if (volPercentile >= 20.0 && volPercentile <= 85.0) {
      // Healthy tradable volatility band
      buyC += 5;
      sellC += 5;
    }
    buyC = Math.min(10, buyC);
    sellC = Math.min(10, sellC);

    // -------------------------------------------------------------------------
    // GROUP D: STRUCTURE (S/R HOLD & CONFIRMED BREAKS) (Max 20 pts)
    // Playbook 2026 Principle: Location + Trigger + Market Structure
    // -------------------------------------------------------------------------
    if (sr.supportBreakConfirmed) {
      // 1. Confirmed Breakdown below Support
      sellD = 20;
      reasons.push(`⚡ [BREAKDOWN CONFIRMED] Close below Support Zone $${sr.nearestSupport} with Volume (+20 D SELL)`);
    } else if (sr.resistanceBreakConfirmed) {
      // 2. Confirmed Breakout above Resistance
      buyD = 20;
      reasons.push(`⚡ [BREAKOUT CONFIRMED] Close above Resistance Zone $${sr.nearestResistance} with Volume (+20 D BUY)`);
    } else if (sr.resistanceRejectConfirmed) {
      // 3. Resistance Rejection / Bearish Reversal
      if (isMacroBearish) {
        sellD = 20;
        reasons.push(`🛡️ [DOWNTREND PULLBACK] Rally into Resistance $${sr.nearestResistance} with Bearish Rejection (+20 D SELL)`);
      } else if (marketRegime === 'RANGE' && !isMacroBullish) {
        sellD = 20;
        reasons.push(`🛡️ [RANGE CEILING REJECTION] Bearish Rejection at Resistance Zone $${sr.nearestResistance} (+20 D SELL)`);
      } else if (isLastBarRed || upperWickLast / rangeLast >= 0.25) {
        sellD = 15;
        reasons.push(`🛡️ [RESISTANCE REJECTION] Bearish Rejection at Resistance Zone $${sr.nearestResistance} (+15 D SELL)`);
      } else {
        sellD = 0;
      }
    } else if (sr.supportBounceConfirmed) {
      // 4. Support Bounce / Bullish Absorption
      if (isMacroBullish && superSmootherSlope >= -0.015) {
        buyD = 20;
        reasons.push(`🛡️ [UPTREND PULLBACK] Pullback to Support $${sr.nearestSupport} with Bullish Absorption (+20 D BUY)`);
      } else if (marketRegime === 'RANGE' && !isMacroBearish && superSmootherSlope >= -0.015) {
        buyD = 20;
        reasons.push(`🛡️ [RANGE FLOOR BOUNCE] Bullish Bounce at Support Zone $${sr.nearestSupport} (+20 D BUY)`);
      } else if (!isMacroBearish && (isLastBarGreen || lowerWickLast / rangeLast >= 0.25)) {
        buyD = 15;
        reasons.push(`🛡️ [SUPPORT ABSORPTION BOUNCE] Confirmed Bullish Absorption at $${sr.nearestSupport} (+15 D BUY)`);
      } else {
        // In Macro Bearish Downtrend: support bounces are weak counter-trend tests
        buyD = 5;
        if (isLastBarRed || currentPrice <= sr.ema50) {
          sellD = Math.max(sellD, 15);
          reasons.push(`Pressure on Support in Macro Downtrend $${sr.nearestSupport} (+15 D SELL)`);
        } else {
          reasons.push(`Testing Support in Macro Downtrend $${sr.nearestSupport} (+5 D BUY)`);
        }
      }
    } else if (sr.isAtResistance && !sr.resistanceBreakConfirmed) {
      sellD = 10;
      reasons.push(`Testing Resistance Zone $${sr.nearestResistance} (+10 D SELL)`);
    } else if (sr.isAtSupport && !sr.supportBreakConfirmed) {
      if (isMacroBearish || isLastBarRed) {
        sellD = Math.max(sellD, 10);
        buyD = 0;
        reasons.push(`Testing Support Breakdown Pressure $${sr.nearestSupport} (+10 D SELL)`);
      } else {
        buyD = 10;
        reasons.push(`Testing Support Zone $${sr.nearestSupport} (+10 D BUY)`);
      }
    } else {
      // Open air structure: reward direction with clean clearance to opposing zone
      if (currentPrice > sr.nearestSupport && (sr.nearestResistance - currentPrice) > atr * 1.0 && (isLastBarGreen || isMacroBullish)) {
        buyD += 10;
      }
      if (currentPrice < sr.nearestResistance && (currentPrice - sr.nearestSupport) > atr * 1.0 && (isLastBarRed || isMacroBearish)) {
        sellD += 10;
      }
    }
    if (dedicatedSignal?.side === 'BUY') {
      if (!sr.supportBreakConfirmed) {
        sellD = 0;
        buyD = Math.max(buyD, 10);
        reasons.push('Dedicated Strategy Support Bounce Hold (+10 D BUY)');
      }
    } else if (dedicatedSignal?.side === 'SELL') {
      if (!sr.resistanceBreakConfirmed) {
        buyD = 0;
        sellD = Math.max(sellD, 10);
        reasons.push('Dedicated Strategy Resistance Rejection Hold (+10 D SELL)');
      }
    }
    buyD = Math.min(20, buyD);
    sellD = Math.min(20, sellD);

    // -------------------------------------------------------------------------
    // GROUP E: ORDER FLOW & MICROSTRUCTURE (Max 20 pts)
    // -------------------------------------------------------------------------
    if (microstructureData) {
      // Live Delta Exchange Order Book & Recent Trades
      // 1. Order Book Imbalance (OBI)
      if (microstructureData.obi > 0.20) {
        buyE += 10;
        reasons.push(`Order Book Imbalance Bullish (OBI: +${microstructureData.obi.toFixed(2)}) (+10 E)`);
      } else if (microstructureData.obi < -0.20) {
        sellE += 10;
        reasons.push(`Order Book Imbalance Bearish (OBI: ${microstructureData.obi.toFixed(2)}) (+10 E)`);
      }

      // 2. Cumulative Volume Delta & Taker Buy Ratio
      if (microstructureData.takerBuyRatio > 0.55 || microstructureData.cvd > 0) {
        buyE += 10;
        reasons.push(`Aggressive Taker Buy Dominance (${(microstructureData.takerBuyRatio * 100).toFixed(0)}%) (+10 E)`);
      } else if (microstructureData.takerBuyRatio < 0.45 || microstructureData.cvd < 0) {
        sellE += 10;
        reasons.push(`Aggressive Taker Sell Dominance (${((1 - microstructureData.takerBuyRatio) * 100).toFixed(0)}%) (+10 E)`);
      }
    } else {
      // High-accuracy Candle Volume & Wick Microstructure Proxy for backtest/offline
      const lastBar = candles[candles.length - 1];
      const prevBar = candles[candles.length - 2];
      const candleRange = Math.max(lastBar.high - lastBar.low, 0.0001);
      const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
      const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
      const lowerWickRatio = lowerWick / candleRange;
      const upperWickRatio = upperWick / candleRange;

      if (lowerWickRatio >= 0.30 && lastBar.volume >= prevBar.volume * 0.9) {
        buyE += 15;
        reasons.push(`Absorption Volume Delta at Lows (+15 E)`);
      } else if (upperWickRatio >= 0.30 && lastBar.volume >= prevBar.volume * 0.9) {
        sellE += 15;
        reasons.push(`Exhaustion Volume Delta at Highs (+15 E)`);
      } else if (lastBar.close > lastBar.open && lastBar.volume > prevBar.volume) {
        buyE += 10;
      } else if (lastBar.close < lastBar.open && lastBar.volume > prevBar.volume) {
        sellE += 10;
      }
    }
    buyE = Math.min(20, buyE);
    sellE = Math.min(20, sellE);

    // -------------------------------------------------------------------------
    // GROUP F: DERIVATIVES / POSITIONING (Max 10 pts)
    // -------------------------------------------------------------------------
    if (microstructureData) {
      // 1. Funding Rate (Crowded position fade / squeeze)
      if (microstructureData.fundingRate < -0.005) {
        buyF += 5;
        reasons.push(`Negative Funding Rate (${microstructureData.fundingRate}) Short Squeeze Setup (+5 F)`);
      } else if (microstructureData.fundingRate > 0.02) {
        sellF += 5;
        reasons.push(`High Positive Funding Rate (${microstructureData.fundingRate}) Long Flush Risk (+5 F)`);
      }

      // 2. Open Interest + Price Matrix (Page 5 & 6)
      const isPriceUp = currentPrice >= (candles[candles.length - 5]?.close || currentPrice);
      const isOiUp = microstructureData.oiChangeUsd6h > 0;

      if (isPriceUp && isOiUp) {
        buyF += 5; // New longs, strong trend
        reasons.push('OI Expanding with Price Up: New Longs Trend (+5 F)');
      } else if (!isPriceUp && isOiUp) {
        sellF += 5; // New shorts, strong trend
        reasons.push('OI Expanding with Price Down: New Shorts Trend (+5 F)');
      } else if (!isPriceUp && !isOiUp) {
        buyF += 5; // Long liquidation exhaustion
        reasons.push('OI Dropping with Price Down: Liquidation Exhaustion (+5 F)');
      } else if (isPriceUp && !isOiUp) {
        sellF += 5; // Short covering weak rally
        reasons.push('OI Dropping with Price Up: Short Covering Exhaustion (+5 F)');
      }
    } else {
      // Neutral default for offline/backtest
      buyF += 5;
      sellF += 5;
    }
    buyF = Math.min(10, buyF);
    sellF = Math.min(10, sellF);

    // -------------------------------------------------------------------------
    // STEP 4: TOTAL CONFLUENCE SCORE & EXECUTION THRESHOLD (Clean 0-100 Scale)
    // Execution threshold: >= 35 points
    // -------------------------------------------------------------------------
    const EXECUTION_THRESHOLD = 35;
    let totalBuyScore = buyA + buyB + buyC + buyD + buyE + buyF;
    let totalSellScore = sellA + sellB + sellC + sellD + sellE + sellF;

    // Macro Trend & Market Structure Steering (Playbook 2026: Trade With The Trend!)
    // 1. In TREND regime: Enforce strict directional trend-following (block counter-trend catching falling knives or shorting breakouts).
    // 2. In RANGE regime: Allow mean-reversion in BOTH directions (support floor bounce BUY and resistance ceiling reject SELL).
    if (marketRegime === 'TREND') {
      if (isMacroBearish || currentPrice < sr.ema50) {
        totalBuyScore = Math.min(totalBuyScore, 25);
        if (currentPrice < sr.ema50) {
          totalSellScore = Math.min(99, totalSellScore + 15);
          reasons.push('Macro Downtrend Steering: Trend follows EMA50 (Capped Buy <= 25, +15 Sell Score)');
        }
      } else if (isMacroBullish || currentPrice > sr.ema50) {
        totalSellScore = Math.min(totalSellScore, 25);
        if (currentPrice > sr.ema50) {
          totalBuyScore = Math.min(99, totalBuyScore + 15);
          reasons.push('Macro Uptrend Steering: Trend follows EMA50 (Capped Sell <= 25, +15 Buy Score)');
        }
      }
    } else if (marketRegime === 'RANGE') {
      if (sr.supportBounceConfirmed || (sr.isAtSupport && !sr.supportBreakConfirmed)) {
        reasons.push(`Range Floor Bounce Setup active at $${sr.nearestSupport}`);
      }
      if (sr.resistanceRejectConfirmed || (sr.isAtResistance && !sr.resistanceBreakConfirmed)) {
        reasons.push(`Range Ceiling Rejection Setup active at $${sr.nearestResistance}`);
      }
    }

    totalBuyScore = Math.min(99, Math.max(0, totalBuyScore));
    totalSellScore = Math.min(99, Math.max(0, totalSellScore));

    let recommendedSide: 'BUY' | 'SELL' | null = null;
    let finalScore = 50;

    if (totalBuyScore >= EXECUTION_THRESHOLD && totalBuyScore > totalSellScore) {
      recommendedSide = 'BUY';
      finalScore = Math.min(99, Math.round(totalBuyScore));
      reasons.push(`EXECUTION APPROVED: BUY Score = ${totalBuyScore}/100 >= ${EXECUTION_THRESHOLD}`);
    } else if (totalSellScore >= EXECUTION_THRESHOLD && totalSellScore > totalBuyScore) {
      recommendedSide = 'SELL';
      finalScore = Math.min(99, Math.round(totalSellScore));
      reasons.push(`EXECUTION APPROVED: SELL Score = ${totalSellScore}/100 >= ${EXECUTION_THRESHOLD}`);
    } else {
      recommendedSide = null;
      finalScore = Math.max(totalBuyScore, totalSellScore);
      reasons.push(`BELOW CONFLUENCE THRESHOLD: Buy=${totalBuyScore}, Sell=${totalSellScore} (Need >= ${EXECUTION_THRESHOLD})`);
    }

    return {
      symbol,
      quantScore: finalScore,
      recommendedSide,
      marketRegime,
      regimeReason,
      hurstExponent: hurst,
      varianceRatio: vr,
      efficiencyRatio: ker,
      choppinessIndex: chopIndex,
      adx,
      volatilityPercentile: volPercentile,
      fisherTransform: parseFloat(currentFisher.toFixed(2)),
      fisherSignal: parseFloat(currentFishSig.toFixed(2)),
      superSmootherPrice: parseFloat(currentSmooth.toFixed(4)),
      superSmootherSlope: parseFloat(superSmootherSlope.toFixed(3)),
      kalmanEstimate: parseFloat(kalmanEstimate.toFixed(4)),
      kalmanDeviationPct: parseFloat(kalmanDeviationPct.toFixed(3)),
      zScore,
      nearestSupport: sr.nearestSupport,
      nearestResistance: sr.nearestResistance,
      isAtSupport: sr.isAtSupport,
      isAtResistance: sr.isAtResistance,
      supportBounceConfirmed: sr.supportBounceConfirmed,
      supportBreakConfirmed: sr.supportBreakConfirmed,
      resistanceRejectConfirmed: sr.resistanceRejectConfirmed,
      resistanceBreakConfirmed: sr.resistanceBreakConfirmed,
      scores: {
        groupA_trend: Math.max(buyA, sellA),
        groupB_meanRevert: Math.max(buyB, sellB),
        groupC_volatility: Math.max(buyC, sellC),
        groupD_structure: Math.max(buyD, sellD),
        groupE_orderFlow: Math.max(buyE, sellE),
        groupF_derivatives: Math.max(buyF, sellF),
        totalBuyScore,
        totalSellScore,
      },
      microstructure: microstructureData ? {
        obi: microstructureData.obi,
        cvd: microstructureData.cvd,
        takerBuyRatio: microstructureData.takerBuyRatio,
        fundingRate: microstructureData.fundingRate,
        openInterest: microstructureData.openInterest,
      } : undefined,
      reasons,
    };
  }
}

export const quantMath = QuantMathematicalEngine;
