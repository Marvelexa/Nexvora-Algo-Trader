import { KlinePoint } from '../../src/types';

export interface HTFBilateralVerdict {
  allowed: boolean;
  permittedSide: 'BUY' | 'SELL' | 'BOTH' | 'NONE';
  marketStructure: 'BULLISH_HH_HL' | 'BEARISH_LH_LL' | 'RANGING';
  dealingZone: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  rangeHigh: number;
  rangeLow: number;
  equilibrium50: number;
  priceVsEquilibriumPct: number;
  reason: string;
  biasConfidence: number;
}

/**
 * HTF BILATERAL BIAS GATEKEEPER & INSTITUTIONAL QUALITY SHIELD
 * Mandate:
 * 1. Volatility Expansion Gate: ATR(14) > SMA(ATR(14), 50) (blocks low-volume chop zones)
 * 2. IF 1H/4H Market Structure is BULLISH (HH/HL) AND Price is in Discount (<50% range):
 *    -> ONLY Long (Buy) setups are allowed. (Block all Shorts).
 * 3. IF 1H/4H Market Structure is BEARISH (LH/LL) AND Price is in Premium (>50% range):
 *    -> ONLY Short (Sell) setups are allowed. (Block all Longs).
 * 4. Spread & Fee Filter: Stop-Loss distance >= 0.50% of asset price
 */
export class HTFBilateralBiasGatekeeper {

  public static checkVolatilityExpansion(candles: KlinePoint[]): { isExpanded: boolean; atr14: number; smaAtr50: number } {
    if (!candles || candles.length < 55) {
      return { isExpanded: true, atr14: 1.0, smaAtr50: 1.0 };
    }
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      trs.push(tr);
    }
    const atrs: number[] = [];
    let curAtr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    atrs.push(curAtr);
    for (let i = 14; i < trs.length; i++) {
      curAtr = ((curAtr * 13) + trs[i]) / 14;
      atrs.push(curAtr);
    }
    const currentAtr14 = atrs[atrs.length - 1];
    const recentAtrs = atrs.slice(-50);
    const smaAtr50 = recentAtrs.reduce((a, b) => a + b, 0) / Math.max(1, recentAtrs.length);

    return {
      isExpanded: currentAtr14 > smaAtr50,
      atr14: currentAtr14,
      smaAtr50,
    };
  }

  public static checkMinimumStopDistance(
    entryPrice: number,
    stopLossPrice: number,
    minDistancePct: number = 0.0050 // 0.50% minimum distance to prevent exchange fee bleed
  ): { valid: boolean; distancePct: number; distanceUSDPct: number } {
    if (entryPrice <= 0) return { valid: true, distancePct: 0.01, distanceUSDPct: 1.0 };
    const distance = Math.abs(entryPrice - stopLossPrice);
    const distancePct = distance / entryPrice;
    return {
      valid: distancePct >= minDistancePct,
      distancePct,
      distanceUSDPct: Number((distancePct * 100).toFixed(2)),
    };
  }

  public static evaluateGate(
    intendedSide: 'BUY' | 'SELL',
    candles: KlinePoint[]
  ): HTFBilateralVerdict {
    if (!candles || candles.length < 35) {
      return {
        allowed: true,
        permittedSide: 'BOTH',
        marketStructure: 'RANGING',
        dealingZone: 'EQUILIBRIUM',
        rangeHigh: candles?.[candles.length - 1]?.close || 0,
        rangeLow: candles?.[candles.length - 1]?.close || 0,
        equilibrium50: candles?.[candles.length - 1]?.close || 0,
        priceVsEquilibriumPct: 0,
        reason: 'Warmup candle buffer (<35 bars)',
        biasConfidence: 50,
      };
    }

    const n = candles.length;
    const curPrice = candles[n - 1].close;

    // 0. Volatility Expansion Gate: ATR(14) > SMA(ATR(14), 50)
    const vol = this.checkVolatilityExpansion(candles);
    if (!vol.isExpanded && candles.length >= 55) {
      return {
        allowed: false,
        permittedSide: 'NONE',
        marketStructure: 'RANGING',
        dealingZone: 'EQUILIBRIUM',
        rangeHigh: curPrice,
        rangeLow: curPrice,
        equilibrium50: curPrice,
        priceVsEquilibriumPct: 50,
        reason: `Volatility Compression Gate: ATR(14) ($${vol.atr14.toFixed(4)}) <= SMA(ATR, 50) ($${vol.smaAtr50.toFixed(4)}). Blocking low-volume chop.`,
        biasConfidence: 30,
      };
    }

    // 1. Calculate Dealing Range (Past 60-100 bars)
    const lookback = Math.min(80, n);
    const rangeSlice = candles.slice(n - lookback);
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;

    for (const c of rangeSlice) {
      if (c.high > rangeHigh) rangeHigh = c.high;
      if (c.low < rangeLow) rangeLow = c.low;
    }

    const rangeDiff = rangeHigh - rangeLow;
    if (rangeDiff <= 0) {
      return {
        allowed: true,
        permittedSide: 'BOTH',
        marketStructure: 'RANGING',
        dealingZone: 'EQUILIBRIUM',
        rangeHigh,
        rangeLow,
        equilibrium50: curPrice,
        priceVsEquilibriumPct: 50,
        reason: 'Zero range flatline',
        biasConfidence: 50,
      };
    }

    const equilibrium50 = rangeLow + (rangeDiff * 0.5);
    const pricePercentInRange = ((curPrice - rangeLow) / rangeDiff) * 100;

    let dealingZone: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM' = 'EQUILIBRIUM';
    if (pricePercentInRange < 48) {
      dealingZone = 'DISCOUNT';
    } else if (pricePercentInRange > 52) {
      dealingZone = 'PREMIUM';
    }

    // 2. Determine HTF 1H/4H Market Structure (HH/HL vs LH/LL + EMA alignment)
    const closes = candles.map(c => c.close);
    const ema16 = this.calcEMA(closes, 16); // 1H equivalent on 15m
    const ema64 = this.calcEMA(closes, 64); // 4H equivalent on 15m
    const curEma16 = ema16[ema16.length - 1];
    const curEma64 = ema64[ema64.length - 1];

    // Identify swing fractals
    const swings = this.findRecentSwingPoints(candles.slice(-50));
    let isBullishStructure = false;
    let isBearishStructure = false;

    if (swings.highs.length >= 2 && swings.lows.length >= 2) {
      const lastH = swings.highs[swings.highs.length - 1];
      const prevH = swings.highs[swings.highs.length - 2];
      const lastL = swings.lows[swings.lows.length - 1];
      const prevL = swings.lows[swings.lows.length - 2];

      const higherHighs = lastH.price > prevH.price;
      const higherLows = lastL.price > prevL.price;
      const lowerHighs = lastH.price < prevH.price;
      const lowerLows = lastL.price < prevL.price;

      if (higherHighs && higherLows && curEma16 >= curEma64) {
        isBullishStructure = true;
      } else if (lowerHighs && lowerLows && curEma16 <= curEma64) {
        isBearishStructure = true;
      }
    }

    // Fallback to EMA vector if swing count is tight
    if (!isBullishStructure && !isBearishStructure) {
      if (curEma16 > curEma64 && curPrice > curEma64) {
        isBullishStructure = true;
      } else if (curEma16 < curEma64 && curPrice < curEma64) {
        isBearishStructure = true;
      }
    }

    const marketStructure: 'BULLISH_HH_HL' | 'BEARISH_LH_LL' | 'RANGING' =
      isBullishStructure ? 'BULLISH_HH_HL' : isBearishStructure ? 'BEARISH_LH_LL' : 'RANGING';

    // 3. Check for External Sweep Reversal (Turtle Soup Exception)
    const last3Bars = candles.slice(-3);
    const sweptRangeHigh = last3Bars.some(c => c.high >= rangeHigh * 0.998) && curPrice < rangeHigh;
    const sweptRangeLow = last3Bars.some(c => c.low <= rangeLow * 1.002) && curPrice > rangeLow;

    // 4. Directional Enforcement Logic (Strict Quality Filter)
    let permittedSide: 'BUY' | 'SELL' | 'BOTH' | 'NONE' = 'BOTH';
    let allowed = false;
    let reason = '';
    let confidence = 75;

    if (isBullishStructure && !sweptRangeHigh) {
      permittedSide = 'BUY';
      if (intendedSide === 'BUY') {
        if (dealingZone === 'DISCOUNT' || dealingZone === 'EQUILIBRIUM') {
          allowed = true;
          confidence = 88;
          reason = `HTF Bullish Trend (HH/HL) + Discount/Equilibrium Zone (${pricePercentInRange.toFixed(1)}%). LONG Approved.`;
        } else {
          allowed = true;
          confidence = 72;
          reason = `HTF Bullish Trend, but price in Premium (${pricePercentInRange.toFixed(1)}%). LONG permitted with caution.`;
        }
      } else {
        allowed = false;
        reason = `Bilateral Gate Block: Cannot SHORT in Bullish 1H/4H Structure (HH/HL) unless major External High is swept.`;
      }
    } else if (isBearishStructure && !sweptRangeLow) {
      permittedSide = 'SELL';
      if (intendedSide === 'SELL') {
        if (dealingZone === 'PREMIUM' || dealingZone === 'EQUILIBRIUM') {
          allowed = true;
          confidence = 88;
          reason = `HTF Bearish Trend (LH/LL) + Premium/Equilibrium Zone (${pricePercentInRange.toFixed(1)}%). SHORT Approved.`;
        } else {
          allowed = true;
          confidence = 72;
          reason = `HTF Bearish Trend, but price in Discount (${pricePercentInRange.toFixed(1)}%). SHORT permitted with caution.`;
        }
      } else {
        allowed = false;
        reason = `Bilateral Gate Block: Cannot LONG in Bearish 1H/4H Structure (LH/LL) unless major External Low is swept.`;
      }
    } else if (sweptRangeHigh) {
      permittedSide = 'SELL';
      if (intendedSide === 'SELL') {
        allowed = true;
        confidence = 92;
        reason = `External Liquidity Sweep Rejection at Range High ($${rangeHigh.toFixed(2)}). High-Probability SHORT Approved.`;
      } else {
        allowed = false;
        reason = `Bilateral Gate Block: Do not BUY at the peak of a swept Range High.`;
      }
    } else if (sweptRangeLow) {
      permittedSide = 'BUY';
      if (intendedSide === 'BUY') {
        allowed = true;
        confidence = 92;
        reason = `External Liquidity Sweep Absorption at Range Low ($${rangeLow.toFixed(2)}). High-Probability LONG Approved.`;
      } else {
        allowed = false;
        reason = `Bilateral Gate Block: Do not SHORT at the bottom of a swept Range Low.`;
      }
    } else {
      permittedSide = 'BOTH';
      if (intendedSide === 'BUY' && (dealingZone === 'DISCOUNT' || dealingZone === 'EQUILIBRIUM')) {
        allowed = true;
        confidence = 75;
        reason = `Range Market: BUY approved at Discount Floor (${pricePercentInRange.toFixed(1)}%).`;
      } else if (intendedSide === 'SELL' && (dealingZone === 'PREMIUM' || dealingZone === 'EQUILIBRIUM')) {
        allowed = true;
        confidence = 75;
        reason = `Range Market: SELL approved at Premium Ceiling (${pricePercentInRange.toFixed(1)}%).`;
      } else {
        allowed = false;
        reason = `Range Market: Mismatch between intended ${intendedSide} and Dealing Zone (${dealingZone} ${pricePercentInRange.toFixed(1)}%).`;
      }
    }

    return {
      allowed,
      permittedSide,
      marketStructure,
      dealingZone,
      rangeHigh,
      rangeLow,
      equilibrium50,
      priceVsEquilibriumPct: Number(pricePercentInRange.toFixed(1)),
      reason: `${vol.isExpanded ? 'Volatility Expansion [ATR > SMA(ATR, 50)]' : 'Low Vol'} | ${reason}`,
      biasConfidence: confidence,
    };
  }

  private static calcEMA(prices: number[], period: number): number[] {
    if (prices.length === 0) return [];
    const k = 2 / (period + 1);
    const ema: number[] = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
      ema.push(prices[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  }

  private static findRecentSwingPoints(candles: KlinePoint[]): {
    highs: { index: number; price: number }[];
    lows: { index: number; price: number }[];
  } {
    const highs: { index: number; price: number }[] = [];
    const lows: { index: number; price: number }[] = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const cur = candles[i];
      if (
        cur.high > candles[i - 1].high &&
        cur.high > candles[i - 2].high &&
        cur.high > candles[i + 1].high &&
        cur.high > candles[i + 2].high
      ) {
        highs.push({ index: i, price: cur.high });
      }

      if (
        cur.low < candles[i - 1].low &&
        cur.low < candles[i - 2].low &&
        cur.low < candles[i + 1].low &&
        cur.low < candles[i + 2].low
      ) {
        lows.push({ index: i, price: cur.low });
      }
    }
    return { highs, lows };
  }
}
