import { KlinePoint } from '../../src/types';
import { mathRiskEngine } from '../mathematicalRiskEngine';

export interface SidhantSetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  customSL?: number;
  customTP?: number;
  reasons: string[];
  swingHigh?: number;
  swingLow?: number;
  fib618?: number;
  fib786?: number;
  fib886?: number;
  riskReward?: number;
}

/**
 * Sidhant Kisshor's 3-Step World Champion Method (Trading with Sidhant)
 * Reference Video: https://youtu.be/-ygKPKj3uj8 ("Stop Using Candles on Bitcoin!")
 *
 * 3-Step World Champion Framework:
 * -------------------------------------------------------------
 * Step 1: Strip the Noise (Line Chart Structure & 50 EMA Macro Trend)
 *   - Uses closing prices to cut out emotional candlestick noise and fakeout wicks.
 *   - Identifies macro trend from 50 EMA on closing prices.
 *   - Strictly PROHIBITS counter-trend trades:
 *       * Bull Trend: Only look for BUY pullbacks into Golden Zone.
 *       * Bear Trend: Only look for SELL pullbacks into Golden Zone.
 *
 * Step 2: Identify the Impulse Leg & Map the Golden Fibonacci Zone
 *   - Measures the structural impulse swing (Swing Low to Swing High for Bull, Swing High to Swing Low for Bear).
 *   - Golden Pocket: 0.618 to 0.786 Fibonacci Retracement Zone.
 *   - Invalidation Level: 0.886 Fibonacci Retracement Level.
 *
 * Step 3: Line Chart Reversal Bounce & Strict 1:2.3 Risk-to-Reward Ratio
 *   - Price cleanly pulls back into 0.618 - 0.786 zone and confirms reversal bounce.
 *   - Stop Loss (SL): Placed beyond 0.886 Fib invalidation level with breathing room buffer.
 *   - Take Profit (TP): Placed strictly at 2.3x the Stop Loss distance (1:2.3 RR).
 *   - Viability Guard: If opposing structural ceiling prevents achieving 2.3x reward, the trade is rejected.
 */
export class SidhantWorldChampionEngine {

  private calculateATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  private calculateEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    const len = prices.length;
    const effectivePeriod = Math.min(period, len);
    const k = 2 / (effectivePeriod + 1);
    let ema = prices.slice(0, effectivePeriod).reduce((a, b) => a + b, 0) / effectivePeriod;
    for (let i = effectivePeriod; i < len; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  public evaluateSetup(
    symbol: string,
    candles15m: KlinePoint[],
    microData?: any
  ): SidhantSetupResult {
    const cleanSym = (symbol || '').toUpperCase().trim();

    if (!candles15m || candles15m.length < 30) {
      return {
        recommendedSide: null,
        confidenceScore: 0,
        setupType: 'INSUFFICIENT_DATA',
        reasons: ['Need at least 30 bars of 15m structure for Sidhant method'],
      };
    }

    const n = candles15m.length;
    const currentBar = candles15m[n - 1];
    const prevBar = candles15m[n - 2];
    const currentPrice = currentBar.close;
    const atr = this.calculateATR(candles15m, 14) || (currentPrice * 0.006);

    // Step 1: Strip Noise - Line chart closes & 50 EMA Macro Trend
    const closes = candles15m.map(c => c.close);
    const ema50 = this.calculateEMA(closes, 50);
    const prevEma50 = this.calculateEMA(closes.slice(0, -1), 50);
    const isEmaSlopingUp = ema50 >= prevEma50;
    const isEmaSlopingDown = ema50 <= prevEma50;

    // Identify structural swing pivots on line closes (3-bar fractal on closes)
    const highs: { index: number; price: number; close: number }[] = [];
    const lows: { index: number; price: number; close: number }[] = [];

    for (let i = 2; i < n - 2; i++) {
      const c = candles15m[i].close;
      const h = candles15m[i].high;
      const l = candles15m[i].low;

      // Peak on line chart (close higher than adjacent closes)
      if (
        c > candles15m[i - 1].close &&
        c > candles15m[i - 2].close &&
        c >= candles15m[i + 1].close &&
        c >= candles15m[i + 2].close
      ) {
        highs.push({ index: i, price: h, close: c });
      }

      // Trough on line chart (close lower than adjacent closes)
      if (
        c < candles15m[i - 1].close &&
        c < candles15m[i - 2].close &&
        c <= candles15m[i + 1].close &&
        c <= candles15m[i + 2].close
      ) {
        lows.push({ index: i, price: l, close: c });
      }
    }

    // Market Structure Analysis on Line Chart (Step 1)
    let isHigherHighs = false;
    let isHigherLows = false;
    let isLowerHighs = false;
    let isLowerLows = false;

    if (highs.length >= 2) {
      isHigherHighs = highs[highs.length - 1].close > highs[highs.length - 2].close;
      isLowerHighs = highs[highs.length - 1].close < highs[highs.length - 2].close;
    }
    if (lows.length >= 2) {
      isHigherLows = lows[lows.length - 1].close > lows[lows.length - 2].close;
      isLowerLows = lows[lows.length - 1].close < lows[lows.length - 2].close;
    }

    // Trend determination per Sidhant 3-Step World Champion (Video https://youtu.be/-ygKPKj3uj8):
    // 50 EMA on closing prices defines the macro bias.
    // Price >= 50 EMA -> Bullish (Only BUY pullbacks)
    // Price < 50 EMA  -> Bearish (Only SELL pullbacks)
    const isBullStructure = currentPrice >= ema50;
    const isBearStructure = currentPrice < ema50;

    // =========================================================================
    // STEP 2 & 3: BULLISH SETUP (Bull Trend -> Pullback to Golden Zone 0.618 - 0.786)
    // Strictly Prohibits Counter-Trend Buys during Bearish Structure
    // =========================================================================
    if (isBullStructure) {
      // Find the impulse leg: Look back up to 35 bars for the most significant recent swing high
      let swingHighPrice = -Infinity;
      let swingHighIdx = -1;
      const candidateHighs = highs.filter(h => (n - 1) - h.index <= 30 && (n - 1) - h.index >= 1);
      if (candidateHighs.length > 0) {
        const sh = candidateHighs.reduce((p, c) => c.price > p.price ? c : p);
        swingHighPrice = sh.price;
        swingHighIdx = sh.index;
      } else {
        for (let i = Math.max(0, n - 30); i < n - 1; i++) {
          if (candles15m[i].high > swingHighPrice) {
            swingHighPrice = candles15m[i].high;
            swingHighIdx = i;
          }
        }
      }

      if (swingHighIdx >= 0) {
        // Find swing low before this swing high
        let baseLowPrice = Infinity;
        let baseLowIdx = -1;
        for (let i = Math.max(0, swingHighIdx - 30); i < swingHighIdx; i++) {
          if (candles15m[i].low < baseLowPrice) {
            baseLowPrice = candles15m[i].low;
            baseLowIdx = i;
          }
        }

        if (baseLowIdx >= 0) {
          const impulse = swingHighPrice - baseLowPrice;
          if (impulse >= 2.2 * atr && impulse >= currentPrice * 0.010 && (swingHighIdx - baseLowIdx >= 6)) {
            const fib618 = swingHighPrice - (0.618 * impulse);
            const fib786 = swingHighPrice - (0.786 * impulse);
            const fib886 = swingHighPrice - (0.886 * impulse);

            // Find lowest price since swing high
            let lowestSinceHigh = Infinity;
            let lowestBarIdx = -1;
            for (let b = swingHighIdx; b < n; b++) {
              if (candles15m[b].low < lowestSinceHigh) {
                lowestSinceHigh = candles15m[b].low;
                lowestBarIdx = b;
              }
            }

            // Price touched the Golden Pocket (0.618 - 0.786) recently (within last 6 bars)
            const touchedGoldenPocket = lowestSinceHigh <= (fib618 + 0.20 * atr) && lowestSinceHigh >= (fib886 - 0.30 * atr);
            const isFreshTouch = lowestBarIdx >= n - 6;

            if (touchedGoldenPocket && isFreshTouch) {
              // Step 3: Reversal Confirmation Bounce
              // Price closes above fib786 and shows bullish line candle rejection or green close
              const isGreenBar = currentBar.close > currentBar.open;
              const hasLowerRejectionWick = (Math.min(currentBar.open, currentBar.close) - currentBar.low) >= 0.20 * (currentBar.high - currentBar.low);
              const isClosingUpward = currentBar.close >= prevBar.close;
              const isReversalConfirmed = currentBar.close >= fib786 && (isGreenBar || hasLowerRejectionWick || isClosingUpward);

              if (isReversalConfirmed) {
                // Structural Stop Loss: Below 0.886 invalidation level with breathing room buffer (min 1.20% for alts)
                const isMajor = ['BTC', 'ETH'].some(m => (symbol || '').toUpperCase().includes(m));
                const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
                const slBuffer = Math.max(1.50 * atr, currentPrice * minBreathingPercent);
                const structuralSL = Math.min(lowestSinceHigh, fib886) - slBuffer;

                // Calculate targets using Mathematical Risk Core enforcing strict 1:2.3 RR
                const targets = mathRiskEngine.calculateGeometricTargets({
                  side: 'BUY',
                  entryPrice: currentPrice,
                  atr,
                  structuralSL,
                  minRiskReward: 2.3,
                });

                if (targets.isValidSetup && targets.riskRewardRatio >= 2.25) {
                  let confidence = 92;
                  if (currentPrice > ema50) confidence += 4;
                  if (microData?.obi && microData.obi > 0) confidence += 3;

                  return {
                    recommendedSide: 'BUY',
                    confidenceScore: Math.min(confidence, 99),
                    setupType: 'SIDHANT_3STEP_GOLDEN_POCKET_BULL_BOUNCE',
                    customTP: targets.takeProfitPrice,
                    customSL: targets.stopLossPrice,
                    swingHigh: swingHighPrice,
                    swingLow: baseLowPrice,
                    fib618,
                    fib786,
                    fib886,
                    riskReward: targets.riskRewardRatio,
                    reasons: [
                      `Sidhant 3-Step World Champion (Video https://youtu.be/-ygKPKj3uj8): Bull trend confirmed above 50 EMA`,
                      `Impulse leg retraced cleanly into 0.618-0.786 Golden Pocket (${fib618.toFixed(4)} - ${fib786.toFixed(4)})`,
                      `Confirmed line chart reversal bounce above 0.786 support`,
                      `Stop Loss set beyond 0.886 invalidation level at $${targets.stopLossPrice.toFixed(4)} with full breathing room`,
                      `Take Profit set at $${targets.takeProfitPrice.toFixed(4)} enforcing exact 1:${targets.riskRewardRatio} Risk:Reward ratio`,
                    ],
                  };
                }
              }
            }
          }
        }
      }
    }

    // =========================================================================
    // STEP 2 & 3: BEARISH SETUP (Bear Trend -> Pullback to Golden Zone 0.618 - 0.786)
    // Strictly Prohibits Counter-Trend Shorts during Bullish Structure
    // =========================================================================
    if (isBearStructure) {
      // Find the impulse leg: Look back up to 35 bars for the most significant recent swing low
      let swingLowPrice = Infinity;
      let swingLowIdx = -1;
      const candidateLows = lows.filter(l => (n - 1) - l.index <= 30 && (n - 1) - l.index >= 1);
      if (candidateLows.length > 0) {
        const sl = candidateLows.reduce((p, c) => c.price < p.price ? c : p);
        swingLowPrice = sl.price;
        swingLowIdx = sl.index;
      } else {
        for (let i = Math.max(0, n - 30); i < n - 1; i++) {
          if (candles15m[i].low < swingLowPrice) {
            swingLowPrice = candles15m[i].low;
            swingLowIdx = i;
          }
        }
      }

      if (swingLowIdx >= 0) {
        // Find swing high before this swing low
        let baseHighPrice = -Infinity;
        let baseHighIdx = -1;
        for (let i = Math.max(0, swingLowIdx - 30); i < swingLowIdx; i++) {
          if (candles15m[i].high > baseHighPrice) {
            baseHighPrice = candles15m[i].high;
            baseHighIdx = i;
          }
        }

        if (baseHighIdx >= 0) {
          const impulse = baseHighPrice - swingLowPrice;
          if (impulse >= 2.2 * atr && impulse >= currentPrice * 0.010 && (swingLowIdx - baseHighIdx >= 6)) {
            const fib618 = swingLowPrice + (0.618 * impulse);
            const fib786 = swingLowPrice + (0.786 * impulse);
            const fib886 = swingLowPrice + (0.886 * impulse);

            // Find highest price since swing low
            let highestSinceLow = -Infinity;
            let highestBarIdx = -1;
            for (let b = swingLowIdx; b < n; b++) {
              if (candles15m[b].high > highestSinceLow) {
                highestSinceLow = candles15m[b].high;
                highestBarIdx = b;
              }
            }

            // Price touched the Golden Pocket (0.618 - 0.786) recently (within last 6 bars)
            const touchedGoldenPocket = highestSinceLow >= (fib618 - 0.20 * atr) && highestSinceLow <= (fib886 + 0.30 * atr);
            const isFreshTouch = highestBarIdx >= n - 6;

            if (touchedGoldenPocket && isFreshTouch) {
              // Step 3: Reversal Confirmation Rejection
              const isRedBar = currentBar.close < currentBar.open;
              const hasUpperRejectionWick = (currentBar.high - Math.max(currentBar.open, currentBar.close)) >= 0.20 * (currentBar.high - currentBar.low);
              const isClosingDownward = currentBar.close <= prevBar.close;
              const isReversalConfirmed = currentBar.close <= fib786 && (isRedBar || hasUpperRejectionWick || isClosingDownward);

              if (isReversalConfirmed) {
                // Structural Stop Loss: Beyond 0.886 invalidation level with breathing room buffer (min 1.20% for alts)
                const isMajor = ['BTC', 'ETH'].some(m => (symbol || '').toUpperCase().includes(m));
                const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
                const slBuffer = Math.max(1.50 * atr, currentPrice * minBreathingPercent);
                const structuralSL = Math.max(highestSinceLow, fib886) + slBuffer;

                // Calculate targets using Mathematical Risk Core enforcing strict 1:2.3 RR
                const targets = mathRiskEngine.calculateGeometricTargets({
                  side: 'SELL',
                  entryPrice: currentPrice,
                  atr,
                  structuralSL,
                  minRiskReward: 2.3,
                });

                if (targets.isValidSetup && targets.riskRewardRatio >= 2.25) {
                  let confidence = 92;
                  if (currentPrice < ema50) confidence += 4;
                  if (microData?.obi && microData.obi < 0) confidence += 3;

                  return {
                    recommendedSide: 'SELL',
                    confidenceScore: Math.min(confidence, 99),
                    setupType: 'SIDHANT_3STEP_GOLDEN_POCKET_BEAR_REJECTION',
                    customTP: targets.takeProfitPrice,
                    customSL: targets.stopLossPrice,
                    swingHigh: baseHighPrice,
                    swingLow: swingLowPrice,
                    fib618,
                    fib786,
                    fib886,
                    riskReward: targets.riskRewardRatio,
                    reasons: [
                      `Sidhant 3-Step World Champion (Video https://youtu.be/-ygKPKj3uj8): Bear trend confirmed below 50 EMA`,
                      `Impulse leg retraced cleanly into 0.618-0.786 Golden Pocket (${fib618.toFixed(4)} - ${fib786.toFixed(4)})`,
                      `Confirmed line chart reversal rejection below 0.786 resistance`,
                      `Stop Loss set beyond 0.886 invalidation level at $${targets.stopLossPrice.toFixed(4)} with full breathing room`,
                      `Take Profit set at $${targets.takeProfitPrice.toFixed(4)} enforcing exact 1:${targets.riskRewardRatio} Risk:Reward ratio`,
                    ],
                  };
                }
              }
            }
          }
        }
      }
    }

    return {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'WAITING_FOR_GOLDEN_ZONE_PULLBACK',
      reasons: ['Price is not currently inside the 0.618-0.786 Golden Reversal Zone with verified 1:2.3 R:R clearance'],
    };
  }
}

export const sidhantEngine = new SidhantWorldChampionEngine();
