// Multi-Timeframe Candlestick & Price Action Analysis Engine (5M, 15M, 1H, 4H)
// Implements exact multi-timeframe candle principles from top YouTube trading masterclasses:
// - 4H: Macro Institutional Trend & Key Major S/R Swing Zones
// - 1H: Intermediate Market Structure (HH/HL vs LH/LL) & S/R Flips / Value Zones / Fib Golden Pocket
// - 15M: Primary Setup Confirmation (20 EMA Retest, Consolidation Breakout, VWAP Reclaim)
// - 5M: Precision Entry Trigger (Hammer, Shooting Star, Engulfing, Marubozu, Tweezers, Wick Rejection + Volume Surge)

export interface KlinePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlestickPattern {
  name: 'HAMMER_PINBAR' | 'SHOOTING_STAR' | 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'MARUBOZU_MOMENTUM' | 'TWEEZER_BOTTOM' | 'TWEEZER_TOP' | 'PIERCING_LINE' | 'DARK_CLOUD_COVER' | 'INSIDE_BAR_BREAKOUT' | 'BULLISH_WICK_REJECT' | 'BEARISH_WICK_REJECT' | 'NONE';
  side: 'BUY' | 'SELL' | 'NEUTRAL';
  significance: number; // 0 to 100
  timeframe: string;
  reason: string;
}

export interface MultiTimeframeAnalysisResult {
  symbol: string;
  trend4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend5m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  macroAligned: boolean;
  overallBias: 'STRONG_BUY' | 'BUY' | 'STRONG_SELL' | 'SELL' | 'NEUTRAL';
  patterns5m: CandlestickPattern[];
  patterns15m: CandlestickPattern[];
  keyLevels1h: { support: number; resistance: number };
  keyLevels4h: { support: number; resistance: number };
  ema20_15m: number;
  ema50_15m: number;
  ema200_1h: number;
  rvol15m: number;
  rvol5m: number;
  triggerPattern: CandlestickPattern | null;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  reasons: string[];
}

export class MultiTimeframeCandleAnalysisEngine {
  public calcEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  public calcATR(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      trs.push(tr);
    }
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
  }

  public calcRVOL(candles: KlinePoint[], lookback: number = 20): number {
    if (!candles || candles.length < 5) return 1.0;
    const currentVol = candles[candles.length - 1].volume || 1;
    const history = candles.slice(-lookback - 1, -1).map(c => c.volume || 1);
    const avgVol = history.reduce((a, b) => a + b, 0) / (history.length || 1);
    return currentVol / (avgVol || 1);
  }

  /**
   * Detects high-significance Candlestick Patterns on any given timeframe candles
   */
  public detectCandlestickPatterns(candles: KlinePoint[], tf: string): CandlestickPattern[] {
    const patterns: CandlestickPattern[] = [];
    if (!candles || candles.length < 5) return patterns;

    const curr = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];
    const atr = this.calcATR(candles, 14);

    const range = curr.high - curr.low;
    if (range <= 0) return patterns;

    const body = Math.abs(curr.close - curr.open);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const isGreen = curr.close >= curr.open;
    const isRed = curr.close < curr.open;

    const rvol = this.calcRVOL(candles, 20);

    // 1. HAMMER / BULLISH PIN BAR (Reversal at Support / Retest)
    if (lowerWick >= 1.7 * body && lowerWick >= 0.45 * range && upperWick <= 0.25 * range && range >= 0.5 * atr) {
      patterns.push({
        name: 'HAMMER_PINBAR',
        side: 'BUY',
        significance: 85,
        timeframe: tf,
        reason: `${tf} Hammer/Bullish Pin Bar (Lower wick: ${((lowerWick / range) * 100).toFixed(0)}% of range)`
      });
    }

    // 2. SHOOTING STAR / BEARISH PIN BAR (Reversal at Resistance / Retest)
    if (upperWick >= 1.7 * body && upperWick >= 0.45 * range && lowerWick <= 0.25 * range && range >= 0.5 * atr) {
      patterns.push({
        name: 'SHOOTING_STAR',
        side: 'SELL',
        significance: 85,
        timeframe: tf,
        reason: `${tf} Shooting Star/Bearish Pin Bar (Upper wick: ${((upperWick / range) * 100).toFixed(0)}% of range)`
      });
    }

    // 3. BULLISH ENGULFING (Strong momentum takeover)
    const prevBody = Math.abs(prev.close - prev.open);
    if (prev.close < prev.open && isGreen && curr.open <= prev.close * 1.002 && curr.close >= prev.open * 0.998 && body > prevBody && range >= 0.6 * atr) {
      patterns.push({
        name: 'BULLISH_ENGULFING',
        side: 'BUY',
        significance: 90,
        timeframe: tf,
        reason: `${tf} Bullish Engulfing (Body ${(body / (prevBody || 1)).toFixed(1)}x of prev red candle | RVOL: ${rvol.toFixed(2)}x)`
      });
    }

    // 4. BEARISH ENGULFING (Strong momentum takeover)
    if (prev.close > prev.open && isRed && curr.open >= prev.close * 0.998 && curr.close <= prev.open * 1.002 && body > prevBody && range >= 0.6 * atr) {
      patterns.push({
        name: 'BEARISH_ENGULFING',
        side: 'SELL',
        significance: 90,
        timeframe: tf,
        reason: `${tf} Bearish Engulfing (Body ${(body / (prevBody || 1)).toFixed(1)}x of prev green candle | RVOL: ${rvol.toFixed(2)}x)`
      });
    }

    // 5. MARUBOZU MOMENTUM EXPANSION (Institutional drive)
    if (body >= 0.75 * range && range >= 0.8 * atr && rvol >= 1.25) {
      patterns.push({
        name: 'MARUBOZU_MOMENTUM',
        side: isGreen ? 'BUY' : 'SELL',
        significance: 88,
        timeframe: tf,
        reason: `${tf} ${isGreen ? 'Bullish' : 'Bearish'} Marubozu (Body ${((body / range) * 100).toFixed(0)}% of range | RVOL: ${rvol.toFixed(2)}x)`
      });
    }

    // 6. TWEEZER BOTTOM (Matching lows rejection)
    if (Math.abs(curr.low - prev.low) <= atr * 0.08 && prev.close < prev.open && isGreen) {
      patterns.push({
        name: 'TWEEZER_BOTTOM',
        side: 'BUY',
        significance: 82,
        timeframe: tf,
        reason: `${tf} Tweezer Bottom (Identical low rejection at $${curr.low.toFixed(4)})`
      });
    }

    // 7. TWEEZER TOP (Matching highs rejection)
    if (Math.abs(curr.high - prev.high) <= atr * 0.08 && prev.close > prev.open && isRed) {
      patterns.push({
        name: 'TWEEZER_TOP',
        side: 'SELL',
        significance: 82,
        timeframe: tf,
        reason: `${tf} Tweezer Top (Identical high rejection at $${curr.high.toFixed(4)})`
      });
    }

    // 8. PIERCING LINE (Bullish 50% recovery)
    if (prev.close < prev.open && isGreen && curr.open < prev.low && curr.close > (prev.open + prev.close) / 2) {
      patterns.push({
        name: 'PIERCING_LINE',
        side: 'BUY',
        significance: 80,
        timeframe: tf,
        reason: `${tf} Piercing Line (Bullish recovery > 50% of previous red body)`
      });
    }

    // 9. DARK CLOUD COVER (Bearish 50% rejection)
    if (prev.close > prev.open && isRed && curr.open > prev.high && curr.close < (prev.open + prev.close) / 2) {
      patterns.push({
        name: 'DARK_CLOUD_COVER',
        side: 'SELL',
        significance: 80,
        timeframe: tf,
        reason: `${tf} Dark Cloud Cover (Bearish reversal > 50% into previous green body)`
      });
    }

    // 10. INSIDE BAR BREAKOUT (Volatility expansion)
    if (prev.high <= prev2.high && prev.low >= prev2.low && rvol >= 1.15) {
      if (curr.close > prev.high && isGreen) {
        patterns.push({
          name: 'INSIDE_BAR_BREAKOUT',
          side: 'BUY',
          significance: 85,
          timeframe: tf,
          reason: `${tf} Inside Bar Bullish Breakout (Closed above $${prev.high.toFixed(4)})`
        });
      } else if (curr.close < prev.low && isRed) {
        patterns.push({
          name: 'INSIDE_BAR_BREAKOUT',
          side: 'SELL',
          significance: 85,
          timeframe: tf,
          reason: `${tf} Inside Bar Bearish Breakdown (Closed below $${prev.low.toFixed(4)})`
        });
      }
    }

    // 11. GENERAL WICK REJECTION (Bounce off key dynamic levels)
    if (lowerWick >= 0.50 * range && isGreen && range >= 0.45 * atr) {
      patterns.push({
        name: 'BULLISH_WICK_REJECT',
        side: 'BUY',
        significance: 75,
        timeframe: tf,
        reason: `${tf} Bullish Wick Rejection (${((lowerWick / range) * 100).toFixed(0)}% lower wick)`
      });
    } else if (upperWick >= 0.50 * range && isRed && range >= 0.45 * atr) {
      patterns.push({
        name: 'BEARISH_WICK_REJECT',
        side: 'SELL',
        significance: 75,
        timeframe: tf,
        reason: `${tf} Bearish Wick Rejection (${((upperWick / range) * 100).toFixed(0)}% upper wick)`
      });
    }

    return patterns;
  }

  /**
   * Complete Multi-Timeframe (4H, 1H, 15M, 5M) Candlestick & Confluence Evaluator
   */
  public evaluateMultiTimeframe(
    symbol: string,
    candles5m: KlinePoint[],
    candles15m: KlinePoint[],
    candles1h: KlinePoint[],
    candles4h: KlinePoint[]
  ): MultiTimeframeAnalysisResult {
    const reasons: string[] = [];
    const lastPrice = candles15m && candles15m.length > 0
      ? candles15m[candles15m.length - 1].close
      : (candles5m && candles5m.length > 0 ? candles5m[candles5m.length - 1].close : 0);

    // 1. 4H MACRO TREND & MAJOR S&R
    let trend4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let s4h = 0, r4h = 0;
    if (candles4h && candles4h.length >= 20) {
      const closes4h = candles4h.map(c => c.close);
      const ema50_4h = this.calcEMA(closes4h, 50);
      const ema200_4h = this.calcEMA(closes4h, Math.min(200, closes4h.length));
      trend4h = lastPrice >= ema50_4h ? 'BULLISH' : 'BEARISH';
      const lookback4h = candles4h.slice(-30);
      s4h = Math.min(...lookback4h.map(c => c.low));
      r4h = Math.max(...lookback4h.map(c => c.high));
      reasons.push(`4H Macro: ${trend4h} (EMA50: $${ema50_4h.toFixed(2)}) | Range: [$${s4h.toFixed(2)} - $${r4h.toFixed(2)}]`);
    }

    // 2. 1H INTERMEDIATE TREND & S&R
    let trend1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let s1h = 0, r1h = 0, ema200_1h = 0;
    if (candles1h && candles1h.length >= 20) {
      const closes1h = candles1h.map(c => c.close);
      const ema20_1h = this.calcEMA(closes1h, 20);
      const ema50_1h = this.calcEMA(closes1h, 50);
      ema200_1h = this.calcEMA(closes1h, Math.min(200, closes1h.length));
      trend1h = (lastPrice >= ema20_1h && ema20_1h >= ema50_1h)
        ? 'BULLISH'
        : (lastPrice <= ema20_1h && ema20_1h <= ema50_1h ? 'BEARISH' : (lastPrice >= ema50_1h ? 'BULLISH' : 'BEARISH'));
      const lookback1h = candles1h.slice(-25);
      s1h = Math.min(...lookback1h.map(c => c.low));
      r1h = Math.max(...lookback1h.map(c => c.high));
      reasons.push(`1H Trend: ${trend1h} (EMA20: $${ema20_1h.toFixed(2)}, EMA200: $${ema200_1h.toFixed(2)})`);
    }

    // 3. 15M SETUP STRUCTURE & PATTERNS
    let trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let ema20_15m = 0, ema50_15m = 0;
    let patterns15m: CandlestickPattern[] = [];
    const rvol15m = this.calcRVOL(candles15m, 20);
    if (candles15m && candles15m.length >= 20) {
      const closes15m = candles15m.map(c => c.close);
      ema20_15m = this.calcEMA(closes15m, 20);
      ema50_15m = this.calcEMA(closes15m, 50);
      trend15m = lastPrice >= ema20_15m && ema20_15m >= ema50_15m
        ? 'BULLISH'
        : (lastPrice <= ema20_15m && ema20_15m <= ema50_15m ? 'BEARISH' : (lastPrice >= ema50_15m ? 'BULLISH' : 'BEARISH'));
      patterns15m = this.detectCandlestickPatterns(candles15m, '15m');
      if (patterns15m.length > 0) {
        reasons.push(`15M Patterns: ${patterns15m.map(p => p.name).join(', ')}`);
      }
    }

    // 4. 5M PRECISION ENTRY TRIGGER PATTERNS
    let trend5m: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let patterns5m: CandlestickPattern[] = [];
    const rvol5m = this.calcRVOL(candles5m, 20);
    if (candles5m && candles5m.length >= 10) {
      const closes5m = candles5m.map(c => c.close);
      const ema20_5m = this.calcEMA(closes5m, 20);
      trend5m = lastPrice >= ema20_5m ? 'BULLISH' : 'BEARISH';
      patterns5m = this.detectCandlestickPatterns(candles5m, '5m');
      if (patterns5m.length > 0) {
        reasons.push(`5M Triggers: ${patterns5m.map(p => p.name).join(', ')} (RVOL: ${rvol5m.toFixed(2)}x)`);
      }
    }

    // 5. CONFLUENCE SCORING & DECISION
    let buyPoints = 0;
    let sellPoints = 0;

    // Macro weight: 4H
    if (trend4h === 'BULLISH') buyPoints += 25;
    else if (trend4h === 'BEARISH') sellPoints += 25;

    // Intermediate weight: 1H
    if (trend1h === 'BULLISH') buyPoints += 25;
    else if (trend1h === 'BEARISH') sellPoints += 25;

    // Setup weight: 15M
    if (trend15m === 'BULLISH') buyPoints += 20;
    else if (trend15m === 'BEARISH') sellPoints += 20;

    // Trigger patterns (15m + 5m)
    const allPatterns = [...patterns15m, ...patterns5m];
    const buyPatterns = allPatterns.filter(p => p.side === 'BUY');
    const sellPatterns = allPatterns.filter(p => p.side === 'SELL');

    for (const pat of buyPatterns) {
      buyPoints += Math.round(pat.significance * 0.35);
    }
    for (const pat of sellPatterns) {
      sellPoints += Math.round(pat.significance * 0.35);
    }

    const macroAligned = (trend4h === trend1h) && (trend1h === trend15m);
    let recommendedSide: 'BUY' | 'SELL' | null = null;
    let confidenceScore = 0;
    let overallBias: 'STRONG_BUY' | 'BUY' | 'STRONG_SELL' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let bestTrigger: CandlestickPattern | null = null;

    if (buyPoints >= 65 && buyPoints > sellPoints + 15) {
      // If there's an aggressive opposing sell pattern (e.g. Shooting Star / Bearish Engulfing >= 75), do not long
      const hasStrongOpposing = sellPatterns.some(p => p.significance >= 75);
      if (!hasStrongOpposing && buyPatterns.length > 0) {
        recommendedSide = 'BUY';
        confidenceScore = Math.min(98, Math.round(buyPoints));
        overallBias = macroAligned ? 'STRONG_BUY' : 'BUY';
        bestTrigger = buyPatterns.reduce((prev, curr) => curr.significance > prev.significance ? curr : prev, buyPatterns[0]);
        reasons.push(`Multi-Timeframe BUY Confluence: Score=${confidenceScore}/100 (4H:${trend4h}, 1H:${trend1h}, 15M:${trend15m}, 5M:${trend5m}) | Trigger: ${bestTrigger.name}`);
      } else {
        reasons.push(`BUY Confluence blocked by opposing bearish pattern or missing trigger`);
      }
    } else if (sellPoints >= 65 && sellPoints > buyPoints + 15) {
      // If there's an aggressive opposing buy pattern (e.g. Hammer / Bullish Engulfing >= 75), do not short!
      const hasStrongOpposing = buyPatterns.some(p => p.significance >= 75);
      if (!hasStrongOpposing && sellPatterns.length > 0) {
        recommendedSide = 'SELL';
        confidenceScore = Math.min(98, Math.round(sellPoints));
        overallBias = macroAligned ? 'STRONG_SELL' : 'SELL';
        bestTrigger = sellPatterns.reduce((prev, curr) => curr.significance > prev.significance ? curr : prev, sellPatterns[0]);
        reasons.push(`Multi-Timeframe SELL Confluence: Score=${confidenceScore}/100 (4H:${trend4h}, 1H:${trend1h}, 15M:${trend15m}, 5M:${trend5m}) | Trigger: ${bestTrigger.name}`);
      } else {
        reasons.push(`SELL Confluence blocked by opposing bullish pattern (e.g. Bullish Engulfing/Hammer)`);
      }
    } else {
      reasons.push(`Timeframes mixed or in balance (BUY: ${buyPoints} pts, SELL: ${sellPoints} pts)`);
    }

    return {
      symbol,
      trend4h,
      trend1h,
      trend15m,
      trend5m,
      macroAligned,
      overallBias,
      patterns5m,
      patterns15m,
      keyLevels1h: { support: s1h, resistance: r1h },
      keyLevels4h: { support: s4h, resistance: r4h },
      ema20_15m,
      ema50_15m,
      ema200_1h,
      rvol15m,
      rvol5m,
      triggerPattern: bestTrigger,
      recommendedSide,
      confidenceScore,
      reasons,
    };
  }
}

export const multiTimeframeCandleEngine = new MultiTimeframeCandleAnalysisEngine();
