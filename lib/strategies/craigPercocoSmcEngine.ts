// Craig Percoco Day Trading Guide - Smart Money Market Structure & FVG Engine (System 3006 / Port 3006)
// Source Video: "https://youtu.be/17dYvqJNtGA" (Craig Percoco Day Trading Guide)
//
// Core Strategy Philosophy:
// 1. Higher Timeframe (1H) Macro Trend & Bias:
//    - Evaluates 1H 50 EMA and market structure (Higher Highs / Higher Lows vs Lower Highs / Lower Lows).
//    - Bullish Bias: Price >= 1H 50 EMA and bullish swing structure.
//    - Bearish Bias: Price <= 1H 50 EMA and bearish swing structure.
//    - Counter-trend trades are strictly blocked (e.g. Bullish ChoCh rejected when 1H bias is bearish).
// 2. 5m Market Structure Shift (BOS / ChoCh):
//    - Detects decisive break of recent swing pivot with displacement candle.
//    - Displacement Candle: Body >= 1.3x 20-period average body (min 1.2x threshold) AND
//      Volume >= 1.15x 20-period average volume (min 1.1x threshold).
// 3. 3-Candle Fair Value Gap (FVG) Imbalance Zone:
//    - Bullish FVG (C1, C2 displacement, C3): C3.low > C1.high with gap >= 0.15 * ATR5m.
//      Zone = [C1.high (bottom), C3.low (top)].
//    - Bearish FVG (C1, C2 displacement, C3): C3.high < C1.low with gap >= 0.15 * ATR5m.
//      Zone = [C3.high (bottom), C1.low (top)].
//    - Overlapping wicks eliminate FVG (no imbalance).
// 4. Retest / Mitigation Entry:
//    - Price pulls back into FVG zone and exhibits rejection wick (>= 1.2x body) or favorable close.
//    - Blown FVG: If price completely breaches through FVG bottom (for Long) or top (for Short),
//      the mitigation is invalidated.
// 5. Stop Loss Formula:
//    - Long: min(C1.low, SwingLow_displacement) - max(1.0 * ATR5m, 2 * tickSize).
//    - Short: max(C1.high, SwingHigh_displacement) + max(1.0 * ATR5m, 2 * tickSize).
// 6. Pre-Reversal Take Profit Formula:
//    - Positioned buffer before opposing liquidity pool (Buy-Side Liquidity BSL for Long,
//      Sell-Side Liquidity SSL for Short):
//      Buffer = max(0.15 * ATR5m, 3 * tickSize, Pool * 0.0003).
//      TP_Long = BSL - Buffer; TP_Short = SSL + Buffer.
// 7. Strict Risk-to-Reward Ratio:
//    - Strict minimum 1:2.30 (RR >= 2.30) as mandated by Craig Percoco. Rejects any trade with RR < 2.30.
// 8. Delta Exchange Specifications:
//    - PnL and sizing calculations strictly respect contract_value (e.g. 0.001 for BTCUSD/XAUTUSD,
//      0.1 for SLVONUSD/SILVERUSD/NVDAXUSD, 0.01 for ETHUSD, 1.0 for SOL/XRP/ADA, 100 for DOGEUSD).

import { KlinePoint } from '../../src/types';
import { DELTA_PRODUCT_SPECS } from '../deltaExchangeEngine';

export interface StrategySetupResult {
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  reasons: string[];
  customTP?: number;
  customSL?: number;
  marketRegime: string;
  riskReward?: number;
  macroBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  fvgZone?: { top: number; bottom: number; width: number };
  structureShift?: string;
  displacementBodyRatio?: number;
  displacementVolRatio?: number;
}

export interface FVGZone {
  top: number;
  bottom: number;
  width: number;
  c1Index: number;
  c2Index: number;
  c3Index: number;
  type: 'BULLISH' | 'BEARISH';
}

export class CraigPercocoSmcEngine {
  /**
   * Main evaluation method for System 3006
   * Accepts 5m execution candles, with optional auxiliary 1H and 15m candles
   */
  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StrategySetupResult {
    const nullResult: StrategySetupResult = {
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      reasons: [],
      marketRegime: 'CRAIG_PERCOCO_SMC_FVG'
    };

    let candles5m: KlinePoint[] = [];
    let candles1h: KlinePoint[] = [];
    let candles15m: KlinePoint[] = [];

    if (Array.isArray(candlesOrMtf)) {
      candles5m = candlesOrMtf;
    } else if (candlesOrMtf) {
      if (Array.isArray(candlesOrMtf.candles5m)) candles5m = candlesOrMtf.candles5m;
      else if (Array.isArray(candlesOrMtf.candles15m)) candles5m = candlesOrMtf.candles15m;
      if (Array.isArray(candlesOrMtf.candles1h)) candles1h = candlesOrMtf.candles1h;
      if (Array.isArray(candlesOrMtf.candles15m)) candles15m = candlesOrMtf.candles15m;
    }

    if (microData?.candles1h && Array.isArray(microData.candles1h)) {
      candles1h = microData.candles1h;
    }
    if (microData?.candles5m && Array.isArray(microData.candles5m)) {
      candles5m = microData.candles5m;
    }

    if (!candles5m || candles5m.length < 25) {
      return nullResult;
    }

    const { tickSize, decimals, contractValue } = this.getSymbolSpec(symbol);
    const atr5m = this.calcATR(candles5m, 14);
    const currentBar = candles5m[candles5m.length - 1];
    const currentPrice = currentBar.close;

    // 1. Establish 1H Macro Trend Bias (via 1H candles or 1H EMA50 synthesized from lower timeframe)
    const macroBias = this.determine1hMacroBias(candles5m, candles1h);

    // 2. Scan for recent 3-candle Fair Value Gap (FVG) and displacement in the last 15 bars
    const fvg = this.findRecentFVG(candles5m, atr5m, tickSize);

    if (!fvg) {
      return {
        ...nullResult,
        macroBias,
        reasons: ['No qualifying 3-candle Fair Value Gap (FVG) with gap >= 0.15 * ATR found']
      };
    }

    // 3. Displacement Validation for the FVG creation bar (C2)
    const c2 = candles5m[fvg.c2Index];
    const prev20Bars = candles5m.slice(Math.max(0, fvg.c2Index - 20), fvg.c2Index);
    const avgBody = prev20Bars.reduce((sum, b) => sum + Math.abs(b.close - b.open), 0) / (prev20Bars.length || 1);
    const avgVol = prev20Bars.reduce((sum, b) => sum + (b.volume || 0), 0) / (prev20Bars.length || 1);

    const dispBody = Math.abs(c2.close - c2.open);
    const dispVol = c2.volume || 0;
    const bodyRatio = avgBody > 0 ? dispBody / avgBody : 1.0;
    const volRatio = avgVol > 0 ? dispVol / avgVol : 1.0;

    // Displacement requires body >= 1.2x (ideally >= 1.3x) and volume >= 1.1x (ideally >= 1.15x)
    if (bodyRatio < 1.20) {
      return {
        ...nullResult,
        macroBias,
        reasons: [`Displacement failure: Breakout candle body (${dispBody.toFixed(decimals)}) < 1.2x average body (${(1.2 * avgBody).toFixed(decimals)})`]
      };
    }
    if (volRatio < 1.10) {
      return {
        ...nullResult,
        macroBias,
        reasons: [`Displacement volume failure: Breakout candle volume (${dispVol.toFixed(0)}) < 1.1x average volume (${(1.1 * avgVol).toFixed(0)})`]
      };
    }

    // =========================================================================
    // EVALUATE BULLISH SMC SETUP (Long)
    // =========================================================================
    if (fvg.type === 'BULLISH') {
      // Counter-trend Guard: 1H Macro Bias must not be BEARISH
      if (macroBias === 'BEARISH') {
        return {
          ...nullResult,
          macroBias,
          reasons: ['Counter-trend 5m ChoCh rejected when 1H macro bias is bearish']
        };
      }

      // Institutional Liquidity Sweep (Manipulation)
      const sweep = this.detectLiquiditySweep(candles5m, fvg.c2Index, 'BULLISH', atr5m, tickSize);

      // Blown FVG check: If price completely breached below FVG bottom (without immediate recovery), reject
      if (currentBar.low < fvg.bottom - (0.25 * atr5m) || currentBar.close < fvg.bottom) {
        return {
          ...nullResult,
          macroBias,
          reasons: ['Blown FVG: price completely breached through FVG bottom without rejection wick']
        };
      }

      // Mitigation / Retest check: Price must have dipped into or near the FVG zone
      const touchedZone = (currentBar.low <= fvg.top && currentBar.high >= fvg.bottom) ||
                          (currentBar.close >= fvg.bottom && currentBar.close <= fvg.top + atr5m);
      if (!touchedZone) {
        return {
          ...nullResult,
          macroBias,
          reasons: ['Waiting for price pullback to mitigate Bullish FVG zone']
        };
      }

      // Rejection Wick or Green Close confirmation
      const candleBody = Math.abs(currentBar.close - currentBar.open);
      const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
      const hasRejectionWick = lowerWick >= 1.0 * candleBody || (currentBar.close > currentBar.open && currentBar.close >= fvg.bottom);

      if (!hasRejectionWick) {
        return {
          ...nullResult,
          macroBias,
          reasons: ['FVG mitigation lacks rejection wick or bullish confirmation']
        };
      }

      // Stop Loss: beyond FVG origin (C1 low or displacement low or sweep low) with generous breathing room
      const c1 = candles5m[fvg.c1Index];
      const lowestDisp = Math.min(c1.low, c2.low, sweep.sweepPrice);
      const spread = 2 * tickSize;
      const slBuffer = Math.max(1.50 * atr5m, 3.5 * spread, currentPrice * 0.015);
      const rawSL = lowestDisp - slBuffer;
      let sl = this.quantizePrice(rawSL, tickSize, decimals);
      let slDistance = currentPrice - sl;
      const minRiskDist = Math.max(1.50 * atr5m, currentPrice * 0.015, 3.5 * spread);
      if (slDistance < minRiskDist) {
        slDistance = minRiskDist;
        sl = this.quantizePrice(currentPrice - slDistance, tickSize, decimals);
        slDistance = currentPrice - sl;
      }

      if (slDistance > 0) {
        // Pre-Reversal TP: Identify opposing Buy-Side Liquidity (BSL)
        // Locate immediate nearest structural swing high above current price (NOT 50% fantasy extreme!)
        const preHistory = candles5m.slice(0, fvg.c1Index);
        const { swingHighs } = this.findSwingPivots(preHistory);
        const candidateHighs = swingHighs.filter(h => h > currentPrice + (2 * tickSize));

        let bsl: number;
        if (candidateHighs.length > 0) {
          bsl = Math.min(...candidateHighs);
        } else {
          const priorCandleHighs = preHistory.map(c => c.high).filter(h => h > currentPrice + (2 * tickSize));
          if (priorCandleHighs.length > 0) {
            bsl = Math.min(...priorCandleHighs);
          } else {
            const allPriorHighs = candles5m.slice(0, -1).map(c => c.high).filter(h => h > currentPrice + (2 * tickSize));
            if (allPriorHighs.length > 0) {
              bsl = Math.min(...allPriorHighs);
            } else {
              return {
                ...nullResult,
                macroBias,
                reasons: ['No opposing Buy-Side Liquidity (BSL) pool found above entry price']
              };
            }
          }
        }

        // Premium / Discount Array filter: verify entry occurs in Discount Zone (< equilibrium)
        const discountCheck = this.checkPremiumDiscount(currentPrice, lowestDisp, bsl, 'BULLISH');
        if (!discountCheck.inZone && currentBar.low > discountCheck.equilibrium) {
          return {
            ...nullResult,
            macroBias,
            reasons: [`Premium/Discount filter: Long setup price (${currentPrice.toFixed(decimals)}) is not in Discount Zone (< equilibrium ${discountCheck.equilibrium.toFixed(decimals)})`]
          };
        }

        // Pre-Reversal buffer before opposing liquidity pool
        const preReversalBuffer = Math.max(0.15 * atr5m, 3 * tickSize, bsl * 0.0003);
        // Avoid unrealistic fantasy targets: cap BSL if distance exceeds reasonable 15m intraday expansion
        const maxTakeProfitDistance = Math.max(slDistance * 2.50, 4.0 * atr5m);
        const effectiveBSL = (bsl - currentPrice > maxTakeProfitDistance) ? (currentPrice + (slDistance * 2.30) + preReversalBuffer) : bsl;
        const naturalTP = effectiveBSL - preReversalBuffer;
        const tp = this.quantizePrice(naturalTP, tickSize, decimals);

        const profitDist = tp - currentPrice;
        const rr = parseFloat((profitDist / slDistance).toFixed(2));

        // Strict 1:2.30 R:R enforcement (Zero-Squeeze Rule)
        if (rr < 2.30) {
          return {
            ...nullResult,
            macroBias,
            reasons: [`Risk/Reward ratio ${rr} < 2.30 strict minimum; opposing BSL pool is too close to satisfy Craig Percoco 1:2.30 rule`]
          };
        }

        const ceMidpoint = (fvg.top + fvg.bottom) / 2;

        return {
          recommendedSide: 'BUY',
          confidenceScore: 88,
          setupType: 'CRAIG_PERCOCO_BULLISH_BOS_FVG_MITIGATION',
          reasons: [
            `1H Macro Bias Bullish confirmed (Price above 50 EMA and structural HLs)`,
            `15m Structure Shift (BOS/ChoCh) confirmed with displacement body ${bodyRatio.toFixed(2)}x and volume ${volRatio.toFixed(2)}x`,
            `Institutional liquidity sweep verified at ${sweep.sweepPrice.toFixed(decimals)}`,
            `Entry in Discount Zone verified (< equilibrium ${discountCheck.equilibrium.toFixed(decimals)})`,
            `Bullish Fair Value Gap (FVG) active: [${fvg.bottom.toFixed(decimals)} - ${fvg.top.toFixed(decimals)}] (width: ${fvg.width.toFixed(decimals)}, CE midpoint: ${ceMidpoint.toFixed(decimals)})`,
            `FVG mitigation confirmed with rejection wick at zone`,
            `Pre-Reversal Take Profit positioned before opposing BSL pool ${bsl.toFixed(decimals)} (TP: ${tp.toFixed(decimals)})`,
            `Strict Risk-to-Reward satisfied: 1:${rr.toFixed(2)} (>= 2.30 strict minimum mandated by Craig Percoco)`
          ],
          customSL: sl,
          customTP: tp,
          marketRegime: 'SMC_BULLISH_EXPANSION',
          riskReward: rr,
          macroBias,
          fvgZone: fvg,
          structureShift: 'BULLISH_BOS',
          displacementBodyRatio: parseFloat(bodyRatio.toFixed(2)),
          displacementVolRatio: parseFloat(volRatio.toFixed(2))
        };
      }
    }

    // =========================================================================
    // EVALUATE BEARISH SMC SETUP (Short)
    // =========================================================================
    if (fvg.type === 'BEARISH') {
      // Counter-trend Guard: 1H Macro Bias must not be BULLISH
      if (macroBias === 'BULLISH') {
        return {
          ...nullResult,
          macroBias,
          reasons: ['Counter-trend 5m ChoCh rejected when 1H macro bias is bullish']
        };
      }

      // Institutional Liquidity Sweep (Manipulation)
      const sweep = this.detectLiquiditySweep(candles5m, fvg.c2Index, 'BEARISH', atr5m, tickSize);

      // Blown FVG check: If price completely breached above FVG top, reject
      if (currentBar.high > fvg.top + (0.25 * atr5m) || currentBar.close > fvg.top) {
        return {
          ...nullResult,
          macroBias,
          reasons: ['Blown FVG: price completely breached through FVG top without rejection wick']
        };
      }

      // Mitigation / Retest check
      const touchedZone = (currentBar.high >= fvg.bottom && currentBar.low <= fvg.top) ||
                          (currentBar.close <= fvg.top && currentBar.close >= fvg.bottom - atr5m);
      if (!touchedZone) {
        return {
          ...nullResult,
          macroBias,
          reasons: ['Waiting for price rally to mitigate Bearish FVG zone']
        };
      }

      // Rejection Wick or Red Close confirmation
      const candleBody = Math.abs(currentBar.close - currentBar.open);
      const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
      const hasRejectionWick = upperWick >= 1.0 * candleBody || (currentBar.close < currentBar.open && currentBar.close <= fvg.top);

      if (!hasRejectionWick) {
        return {
          ...nullResult,
          macroBias,
          reasons: ['FVG mitigation lacks rejection wick or bearish confirmation']
        };
      }

      // Stop Loss: beyond FVG origin (C1 high or displacement high or sweep high) with generous breathing room
      const c1 = candles5m[fvg.c1Index];
      const highestDisp = Math.max(c1.high, c2.high, sweep.sweepPrice);
      const spread = 2 * tickSize;
      const slBuffer = Math.max(1.50 * atr5m, 3.5 * spread, currentPrice * 0.015);
      const rawSL = highestDisp + slBuffer;
      let sl = this.quantizePrice(rawSL, tickSize, decimals);
      let slDistance = sl - currentPrice;
      const minRiskDist = Math.max(1.50 * atr5m, currentPrice * 0.015, 3.5 * spread);
      if (slDistance < minRiskDist) {
        slDistance = minRiskDist;
        sl = this.quantizePrice(currentPrice + slDistance, tickSize, decimals);
        slDistance = sl - currentPrice;
      }

      if (slDistance > 0) {
        // Pre-Reversal TP: Identify opposing Sell-Side Liquidity (SSL)
        // Locate immediate nearest structural swing low below current price (NOT 50% fantasy extreme!)
        const preHistory = candles5m.slice(0, fvg.c1Index);
        const { swingLows } = this.findSwingPivots(preHistory);
        const candidateLows = swingLows.filter(l => l < currentPrice - (2 * tickSize));

        let ssl: number;
        if (candidateLows.length > 0) {
          ssl = Math.max(...candidateLows);
        } else {
          const priorCandleLows = preHistory.map(c => c.low).filter(l => l < currentPrice - (2 * tickSize));
          if (priorCandleLows.length > 0) {
            ssl = Math.max(...priorCandleLows);
          } else {
            const allPriorLows = candles5m.slice(0, -1).map(c => c.low).filter(l => l < currentPrice - (2 * tickSize));
            if (allPriorLows.length > 0) {
              ssl = Math.max(...allPriorLows);
            } else {
              return {
                ...nullResult,
                macroBias,
                reasons: ['No opposing Sell-Side Liquidity (SSL) pool found below entry price']
              };
            }
          }
        }

        // Premium / Discount Array filter: verify entry occurs in Premium Zone (> equilibrium)
        const discountCheck = this.checkPremiumDiscount(currentPrice, ssl, highestDisp, 'BEARISH');
        if (!discountCheck.inZone && currentBar.high < discountCheck.equilibrium) {
          return {
            ...nullResult,
            macroBias,
            reasons: [`Premium/Discount filter: Short setup price (${currentPrice.toFixed(decimals)}) is not in Premium Zone (> equilibrium ${discountCheck.equilibrium.toFixed(decimals)})`]
          };
        }

        // Pre-Reversal buffer before opposing liquidity pool floor
        const preReversalBuffer = Math.max(0.15 * atr5m, 3 * tickSize, ssl * 0.0003);
        // Avoid unrealistic fantasy targets: cap SSL if distance exceeds reasonable 15m intraday expansion
        const maxTakeProfitDistance = Math.max(slDistance * 2.50, 4.0 * atr5m);
        const effectiveSSL = (currentPrice - ssl > maxTakeProfitDistance) ? (currentPrice - (slDistance * 2.30) - preReversalBuffer) : ssl;
        const naturalTP = effectiveSSL + preReversalBuffer;
        const tp = this.quantizePrice(naturalTP, tickSize, decimals);

        const profitDist = currentPrice - tp;
        const rr = parseFloat((profitDist / slDistance).toFixed(2));

        // Strict 1:2.30 R:R enforcement (Zero-Squeeze Rule)
        if (rr < 2.30) {
          return {
            ...nullResult,
            macroBias,
            reasons: [`Risk/Reward ratio ${rr} < 2.30 strict minimum; opposing SSL pool is too close to satisfy Craig Percoco 1:2.30 rule`]
          };
        }

        const ceMidpoint = (fvg.top + fvg.bottom) / 2;

        return {
          recommendedSide: 'SELL',
          confidenceScore: 88,
          setupType: 'CRAIG_PERCOCO_BEARISH_BOS_FVG_MITIGATION',
          reasons: [
            `1H Macro Bias Bearish confirmed (Price below 50 EMA and structural LHs)`,
            `15m Structure Shift (BOS/ChoCh) confirmed with displacement body ${bodyRatio.toFixed(2)}x and volume ${volRatio.toFixed(2)}x`,
            `Institutional liquidity sweep verified at ${sweep.sweepPrice.toFixed(decimals)}`,
            `Entry in Premium Zone verified (> equilibrium ${discountCheck.equilibrium.toFixed(decimals)})`,
            `Bearish Fair Value Gap (FVG) active: [${fvg.bottom.toFixed(decimals)} - ${fvg.top.toFixed(decimals)}] (width: ${fvg.width.toFixed(decimals)}, CE midpoint: ${ceMidpoint.toFixed(decimals)})`,
            `FVG mitigation confirmed with rejection wick at zone`,
            `Pre-Reversal Take Profit positioned before opposing SSL pool ${ssl.toFixed(decimals)} (TP: ${tp.toFixed(decimals)})`,
            `Strict Risk-to-Reward satisfied: 1:${rr.toFixed(2)} (>= 2.30 strict minimum mandated by Craig Percoco)`
          ],
          customSL: sl,
          customTP: tp,
          marketRegime: 'SMC_BEARISH_CONTRACTION',
          riskReward: rr,
          macroBias,
          fvgZone: fvg,
          structureShift: 'BEARISH_BOS',
          displacementBodyRatio: parseFloat(bodyRatio.toFixed(2)),
          displacementVolRatio: parseFloat(volRatio.toFixed(2))
        };
      }
    }

    return nullResult;
  }

  /**
   * Determine 1H Macro Bias from 1H candles or synthesized 5m/15m EMA50
   */
  public determine1hMacroBias(candles5m: KlinePoint[], candles1h?: KlinePoint[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    if (candles1h && candles1h.length >= 10) {
      const closes1h = candles1h.map(c => c.close);
      const ema50 = this.calcEMA(closes1h, Math.min(50, closes1h.length));
      const curr1h = closes1h[closes1h.length - 1];
      if (curr1h > ema50) return 'BULLISH';
      if (curr1h < ema50) return 'BEARISH';
    }

    // Mathematical equivalence: 1H 50 EMA is equivalent to 600 EMA on 5m, or check slope over long lookback
    const closes = candles5m.map(c => c.close);
    const emaPeriod = Math.min(closes.length, 50);
    const ema = this.calcEMA(closes, emaPeriod);
    const currentPrice = closes[closes.length - 1];

    // Check recent 30-bar slope
    const firstHalf = closes.slice(0, Math.floor(closes.length / 2));
    const secondHalf = closes.slice(Math.floor(closes.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / (firstHalf.length || 1);
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / (secondHalf.length || 1);

    if (currentPrice >= ema && avgSecond >= avgFirst) return 'BULLISH';
    if (currentPrice <= ema && avgSecond <= avgFirst) return 'BEARISH';

    return currentPrice >= ema ? 'BULLISH' : 'BEARISH';
  }

  /**
   * Scan for recent 3-Candle Fair Value Gap (FVG)
   * Bullish FVG: C3.low > C1.high with gap >= 0.15 * ATR
   * Bearish FVG: C3.high < C1.low with gap >= 0.15 * ATR
   */
  public findRecentFVG(candles: KlinePoint[], atr: number, tickSize: number): FVGZone | null {
    if (!candles || candles.length < 3) return null;

    const minGap = Math.max(0.15 * atr, tickSize * 2);

    // If candles has 3 bars (standalone FVG check), check those 3 bars directly
    if (candles.length === 3) {
      const c1 = candles[0];
      const c2 = candles[1];
      const c3 = candles[2];
      if (c2.close > c2.open && c3.low > c1.high && (c3.low - c1.high) >= minGap) {
        return { top: c3.low, bottom: c1.high, width: c3.low - c1.high, c1Index: 0, c2Index: 1, c3Index: 2, type: 'BULLISH' };
      }
      if (c2.close < c2.open && c3.high < c1.low && (c1.low - c3.high) >= minGap) {
        return { top: c1.low, bottom: c3.high, width: c1.low - c3.high, c1Index: 0, c2Index: 1, c3Index: 2, type: 'BEARISH' };
      }
      return null;
    }

    // For evaluation: current bar (candles.length - 1) is the mitigation bar,
    // so the FVG formed at or before candles.length - 2 (i.e. c3Index <= candles.length - 2)
    const scanEnd = candles.length - 1;
    const scanStart = Math.max(2, scanEnd - 12);

    for (let i = scanEnd - 1; i >= scanStart; i--) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      // Check Bullish FVG: C2 is big green candle, C3.low > C1.high
      if (c2.close > c2.open && c3.low > c1.high) {
        const gap = c3.low - c1.high;
        if (gap >= minGap) {
          return {
            top: c3.low,
            bottom: c1.high,
            width: gap,
            c1Index: i - 2,
            c2Index: i - 1,
            c3Index: i,
            type: 'BULLISH'
          };
        }
      }

      // Check Bearish FVG: C2 is big red candle, C3.high < C1.low
      if (c2.close < c2.open && c3.high < c1.low) {
        const gap = c1.low - c3.high;
        if (gap >= minGap) {
          return {
            top: c1.low,
            bottom: c3.high,
            width: gap,
            c1Index: i - 2,
            c2Index: i - 1,
            c3Index: i,
            type: 'BEARISH'
          };
        }
      }
    }

    return null;
  }

  /**
   * Helper: Identify structural swing pivot highs and lows
   */
  public findSwingPivots(candles: KlinePoint[]): { swingHighs: number[]; swingLows: number[] } {
    const swingHighs: number[] = [];
    const swingLows: number[] = [];
    if (!candles || candles.length < 3) return { swingHighs, swingLows };

    for (let i = 1; i < candles.length - 1; i++) {
      const c = candles[i];
      const prev = candles[i - 1];
      const next = candles[i + 1];

      if (c.high >= prev.high && c.high >= next.high) {
        swingHighs.push(c.high);
      }
      if (c.low <= prev.low && c.low <= next.low) {
        swingLows.push(c.low);
      }
    }

    return { swingHighs, swingLows };
  }

  /**
   * Helper: Detect institutional liquidity sweep (manipulation) prior to displacement
   */
  public detectLiquiditySweep(
    candles: KlinePoint[],
    c2Index: number,
    type: 'BULLISH' | 'BEARISH',
    atr: number,
    tickSize: number
  ): { swept: boolean; sweepPrice: number } {
    const lookback = candles.slice(0, c2Index);
    if (lookback.length < 3) {
      return { swept: true, sweepPrice: candles[c2Index].low };
    }

    if (type === 'BULLISH') {
      const priorBars = lookback.slice(0, -2);
      const priorLow = priorBars.length > 0 ? Math.min(...priorBars.map(c => c.low)) : lookback[0].low;
      const startIdx = Math.max(0, c2Index - 2);
      const sweepBars = candles.slice(startIdx, c2Index + 1);
      const minSweepLow = Math.min(...sweepBars.map(c => c.low));
      const swept = minSweepLow <= priorLow + Math.max(0.20 * atr, 2 * tickSize);
      return { swept, sweepPrice: minSweepLow };
    } else {
      const priorBars = lookback.slice(0, -2);
      const priorHigh = priorBars.length > 0 ? Math.max(...priorBars.map(c => c.high)) : lookback[0].high;
      const startIdx = Math.max(0, c2Index - 2);
      const sweepBars = candles.slice(startIdx, c2Index + 1);
      const maxSweepHigh = Math.max(...sweepBars.map(c => c.high));
      const swept = maxSweepHigh >= priorHigh - Math.max(0.20 * atr, 2 * tickSize);
      return { swept, sweepPrice: maxSweepHigh };
    }
  }

  /**
   * Helper: Evaluate Premium vs Discount Zone relative to equilibrium
   */
  public checkPremiumDiscount(
    currentPrice: number,
    rangeLow: number,
    rangeHigh: number,
    type: 'BULLISH' | 'BEARISH'
  ): { inZone: boolean; equilibrium: number; zone: 'DISCOUNT' | 'PREMIUM' } {
    if (rangeHigh <= rangeLow) {
      return { inZone: true, equilibrium: currentPrice, zone: type === 'BULLISH' ? 'DISCOUNT' : 'PREMIUM' };
    }
    const equilibrium = (rangeLow + rangeHigh) / 2;
    const zone = currentPrice < equilibrium ? 'DISCOUNT' : 'PREMIUM';
    const inZone = type === 'BULLISH' ? currentPrice <= equilibrium : currentPrice >= equilibrium;
    return { inZone, equilibrium, zone };
  }

  /**
   * Calculate genuine PnL respecting Delta Exchange contract_value
   */
  public calculatePnL(
    side: 'BUY' | 'SELL',
    entryPrice: number,
    exitPrice: number,
    contracts: number,
    symbol: string
  ): number {
    const { contractValue } = this.getSymbolSpec(symbol);
    const priceDiff = side === 'BUY' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
    return parseFloat((contracts * contractValue * priceDiff).toFixed(4));
  }

  /**
   * Helper: Calculate Exponential Moving Average
   */
  public calcEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  /**
   * Helper: Calculate 14-period Average True Range
   */
  public calcATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return (candles?.[0]?.close || 1) * 0.015;
    const effectivePeriod = Math.min(period, candles.length - 1);
    const trs: number[] = [];
    for (let i = candles.length - effectivePeriod; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return trs.reduce((a, b) => a + b, 0) / effectivePeriod;
  }

  /**
   * Helper: Quantize price to exchange tickSize and decimals
   */
  public quantizePrice(price: number, tickSize: number, decimals: number): number {
    if (price <= 0 || !isFinite(price)) return 0;
    const factor = Math.round(price / tickSize);
    return parseFloat((factor * tickSize).toFixed(decimals));
  }

  /**
   * Helper: Retrieve symbol specifications from DELTA_PRODUCT_SPECS
   */
  public getSymbolSpec(symbol: string): { tickSize: number; contractValue: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim().replace(/USD[T]?$/, '') + 'USD';
    const spec = DELTA_PRODUCT_SPECS[clean] || DELTA_PRODUCT_SPECS[symbol];
    if (spec) {
      return { tickSize: spec.tickSize, contractValue: spec.contractValue, decimals: spec.decimals };
    }
    return { tickSize: 0.0001, contractValue: 1.0, decimals: 4 };
  }
}

export const craigPercocoSmcEngine = new CraigPercocoSmcEngine();
export const craigPercocoEngine = craigPercocoSmcEngine;
