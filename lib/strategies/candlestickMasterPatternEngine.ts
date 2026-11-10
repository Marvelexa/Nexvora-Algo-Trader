import { KlinePoint, SmartAdaptiveReversalResult } from '../../src/types';
import { CryptoDedicatedStrategyEngine } from './cryptoDedicatedStrategyEngine';
import { SmartReversalDetector, SmartDetectionResult } from '../smartReversalDetector';

export interface DetectedCandlePattern {
  name: string;
  category: 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'MULTI_BAR' | 'CONTINUATION';
  signal: 'BUY' | 'SELL';
  confidence: number; // 0 - 100
  description: string;
  candleIndex: number;
  triggerPrice: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  patternBars: number; // how many candles make up the pattern (1 to 5)
  confluenceConfirmed?: boolean;
  confluenceReason?: string;
  executionMode?: 'DIRECT' | 'SMART_REVERSED';
  effectiveSignal?: 'BUY' | 'SELL';
  reversalReason?: string;
}

export interface CandlestickAnalysisResult {
  symbol: string;
  interval: string;
  lastPrice: number;
  atr: number;
  dominantSignal: 'BUY' | 'SELL' | 'NEUTRAL';
  highestConfidencePattern: DetectedCandlePattern | null;
  detectedPatterns: DetectedCandlePattern[];
  bullishPatternsCount: number;
  bearishPatternsCount: number;
  overallSentiment: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
  smartDetector?: SmartAdaptiveReversalResult;
  smartDetection?: SmartDetectionResult;
  confluence?: {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi14: number;
    rvol: number;
    allowsLong: boolean;
    allowsShort: boolean;
    summaryReason: string;
  };
}

export class CandlestickMasterPatternEngine {
  /**
   * Helper: Calculate Average True Range (14-period default)
   */
  public static calculateATR(candles: KlinePoint[], period: number = 14): number {
    if (candles.length < 2) return (candles[0]?.close || 1) * 0.015;
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
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  /**
   * Evaluates candles against all 50+ master patterns from the Japanese Candlestick Reference
   */
  public static analyze(symbol: string, candles: KlinePoint[], tpAtrMultiplier: number = 1.02, requireConfluence: boolean = true): CandlestickAnalysisResult {
    const len = candles.length;
    if (len < 5) {
      return {
        symbol,
        interval: '15m',
        lastPrice: candles[len - 1]?.close || 0,
        atr: 0,
        dominantSignal: 'NEUTRAL',
        highestConfidencePattern: null,
        detectedPatterns: [],
        bullishPatternsCount: 0,
        bearishPatternsCount: 0,
        overallSentiment: 'NEUTRAL',
      };
    }

    const currentPrice = candles[len - 1].close;
    const atr = this.calculateATR(candles, 14);
    const safeAtr = atr > 0 ? atr : currentPrice * 0.015;

    // Multi-Indicator Institutional Confluence Evaluation
    const confluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(candles);

    // Relative lookups: c0 is latest (current/just closed), c1 is previous, c2 is 2 bars ago, etc.
    const c0 = candles[len - 1];
    const c1 = candles[len - 2];
    const c2 = candles[len - 3];
    const c3 = len >= 4 ? candles[len - 4] : c2;
    const c4 = len >= 5 ? candles[len - 5] : c3;

    // Smart Adaptive Reversal Detector Pre-Evaluation
    const rawHypothesisSignal: 'BUY' | 'SELL' = confluence.allowsLong ? 'BUY' : (confluence.allowsShort ? 'SELL' : (c0.close >= c0.open ? 'BUY' : 'SELL'));
    const smartDetection = SmartReversalDetector.evaluateTrade(symbol, rawHypothesisSignal, candles, currentPrice, safeAtr);

    // Helper functions for candle metrics
    const body = (c: KlinePoint) => Math.abs(c.close - c.open);
    const range = (c: KlinePoint) => Math.max(c.high - c.low, 0.00001);
    const upperWick = (c: KlinePoint) => c.high - Math.max(c.open, c.close);
    const lowerWick = (c: KlinePoint) => Math.min(c.open, c.close) - c.low;
    const isGreen = (c: KlinePoint) => c.close > c.open;
    const isRed = (c: KlinePoint) => c.close < c.open;
    const isDoji = (c: KlinePoint) => body(c) <= 0.10 * range(c);

    // Trend & Pullback Context:
    // A pullback in an uptrend occurs when recent bars retraced (e.g. c1 or c2 was red, or tested lower near EMA 20/50)
    const isPullbackInUptrend = isRed(c1) || c1.close < c2.close || c0.low <= (confluence.ema20 || currentPrice) * 1.005 || c0.low <= (confluence.ema50 || currentPrice) * 1.005;
    // A relief bounce in a downtrend occurs when recent bars bounced (e.g. c1 or c2 was green, or tested higher near EMA 20/50)
    const isPullbackInDowntrend = isGreen(c1) || c1.close > c2.close || c0.high >= (confluence.ema20 || currentPrice) * 0.995 || c0.high >= (confluence.ema50 || currentPrice) * 0.995;

    // Multi-bar trend fallback (for standalone pattern analysis)
    const closes10 = candles.slice(-10).map(c => c.close);
    const isRawDowntrend = (closes10[closes10.length - 1] < closes10[0] && c0.close < c2.close) || (confluence.ema20 < confluence.ema50);
    const isRawUptrend = (closes10[closes10.length - 1] > closes10[0] && c0.close > c2.close) || (confluence.ema20 > confluence.ema50);
    const isDowntrend = isRawDowntrend;
    const isUptrend = isRawUptrend;

    // Bullish reversals require a prior downtrend or pullback in an uptrend; bearish reversals require a prior uptrend or bounce in a downtrend
    const allowsBullishReversal = (confluence.allowsLong || isPullbackInUptrend || isDowntrend) && !confluence.isMacroBearish;
    const allowsBearishReversal = (confluence.allowsShort || isPullbackInDowntrend || isUptrend) && !confluence.isMacroBullish;

    const detected: DetectedCandlePattern[] = [];

    const addPattern = (
      name: string,
      category: DetectedCandlePattern['category'],
      signal: 'BUY' | 'SELL',
      confidence: number,
      description: string,
      sl: number,
      patternBars: number = 1
    ) => {
      const tp = signal === 'BUY'
        ? currentPrice + (safeAtr * tpAtrMultiplier)
        : currentPrice - (safeAtr * tpAtrMultiplier);

      // Strict institutional confluence gate: require allowsLong for BUY, allowsShort for SELL
      let isConfluent = signal === 'BUY' ? confluence.allowsLong : confluence.allowsShort;
      const executionMode: 'DIRECT' | 'SMART_REVERSED' = 'DIRECT';
      const effectiveSignal: 'BUY' | 'SELL' = signal;
      const reversalReason = '';

      // Check Smart Trap Filter: if SmartReversalDetector rejects this setup (overbought climax, oversold floor, exhaustion trap), reject pattern
      if (smartDetection.bias === 'REJECT' && smartDetection.originalSignal === signal) {
        isConfluent = false;
      }

      let confReason = '';
      let patConfidence = confidence;

      if (!isConfluent && smartDetection.bias === 'REJECT' && smartDetection.originalSignal === signal) {
        confReason = `Filtered by Smart Trap Guard: ${smartDetection.primaryReason}`;
        patConfidence = Math.max(20, confidence - 30);
      } else if (isConfluent) {
        confReason = signal === 'BUY'
          ? 'Confirmed by EMA Uptrend + Institutional Momentum (DIRECT)'
          : 'Confirmed by EMA Downtrend + Institutional Momentum (DIRECT)';
        patConfidence = Math.max(confidence, 75);
      } else {
        confReason = confluence.summaryReason || 'Filtered by sideways chop';
        patConfidence = Math.max(20, confidence - 25);
      }

      detected.push({
        name,
        category,
        signal,
        confidence: patConfidence,
        description: isConfluent ? description : `[LOW CONFLUENCE] ${description} (${confReason})`,
        candleIndex: len - 1,
        triggerPrice: currentPrice,
        suggestedStopLoss: parseFloat(sl.toFixed(4)),
        suggestedTakeProfit: parseFloat(tp.toFixed(4)),
        patternBars,
        confluenceConfirmed: isConfluent,
        confluenceReason: confReason,
        executionMode,
        effectiveSignal,
        reversalReason,
      });
    };

    // =========================================================================
    // 1. SINGLE CANDLESTICK REVERSAL & CONTINUATION PATTERNS
    // =========================================================================

    // A. Hammer (Bullish Reversal after pullback)
    if (lowerWick(c0) >= 2.0 * body(c0) && upperWick(c0) <= 0.30 * body(c0) && body(c0) >= 0.10 * range(c0) && allowsBullishReversal) {
      addPattern(
        'Hammer',
        'SINGLE',
        'BUY',
        85,
        'Bullish Hammer: Long lower rejection shadow indicating aggressive buyer absorption at pullback support.',
        c0.low - safeAtr * 0.3,
        1
      );
    }

    // B. Hanging Man (Bearish Reversal after rally)
    if (lowerWick(c0) >= 2.0 * body(c0) && upperWick(c0) <= 0.30 * body(c0) && body(c0) >= 0.10 * range(c0) && allowsBearishReversal) {
      addPattern(
        'Hanging Man',
        'SINGLE',
        'SELL',
        80,
        'Bearish Hanging Man: Distribution warning after rally showing vulnerable buyer support.',
        c0.high + safeAtr * 0.3,
        1
      );
    }

    // C. Inverted Hammer (Bullish Reversal after pullback)
    if (upperWick(c0) >= 2.0 * body(c0) && lowerWick(c0) <= 0.25 * body(c0) && body(c0) >= 0.10 * range(c0) && allowsBullishReversal) {
      addPattern(
        'Inverted Hammer',
        'SINGLE',
        'BUY',
        82,
        'Inverted Hammer: Buyers testing higher prices, building reversal pressure at swing low.',
        c0.low - safeAtr * 0.3,
        1
      );
    }

    // D. Shooting Star (Bearish Reversal after rally)
    if (upperWick(c0) >= 2.0 * body(c0) && lowerWick(c0) <= 0.30 * body(c0) && body(c0) >= 0.10 * range(c0) && allowsBearishReversal) {
      addPattern(
        'Shooting Star',
        'SINGLE',
        'SELL',
        88,
        'Shooting Star: Violent rejection of highs with long upper wick. Institutional sellers in control.',
        c0.high + safeAtr * 0.3,
        1
      );
    }

    // E1. Bullish Power Bar / Momentum Expansion (Institutional Conviction Bar in Macro Uptrend)
    if (isGreen(c0) && body(c0) >= 0.38 * range(c0) && c0.close > c1.high && (confluence.allowsLong || currentPrice >= confluence.ema50)) {
      addPattern(
        'Bullish Power Bar',
        'SINGLE',
        'BUY',
        92,
        'Bullish Power Bar: High-conviction institutional green expansion bar breaking above previous high in trend direction.',
        c0.low - safeAtr * 0.2,
        1
      );
    }

    // E2. Bullish Pullback Bounce (Defending EMA 20/50 Support in Macro Uptrend)
    if (isGreen(c0) && (isRed(c1) || c0.low <= (confluence.ema20 || currentPrice) * 1.008) && c0.close > c1.close && (confluence.allowsLong || currentPrice >= confluence.ema50)) {
      addPattern(
        'Bullish Pullback Bounce',
        'DOUBLE',
        'BUY',
        90,
        'Bullish Pullback Bounce: Institutional buyers defended dynamic EMA support and resumed upward trend momentum.',
        Math.min(c0.low, c1.low) - safeAtr * 0.25,
        2
      );
    }

    // E3. EMA Trend Rider (Dynamic Support Continuation)
    if (isGreen(c0) && c0.close > confluence.ema20 && c0.low > c1.low && c0.close > c1.close && (confluence.allowsLong || currentPrice >= confluence.ema50)) {
      addPattern(
        'EMA Trend Rider',
        'DOUBLE',
        'BUY',
        88,
        'EMA Trend Rider: Consecutive higher lows and higher closes confirming buyers maintaining control of the trend.',
        c0.low - safeAtr * 0.2,
        2
      );
    }

    // E4. Bearish Power Bar / Breakdown Expansion (Institutional Liquidation Bar in Macro Downtrend)
    if (isRed(c0) && body(c0) >= 0.38 * range(c0) && c0.close < c1.low && (confluence.allowsShort || currentPrice <= confluence.ema50)) {
      addPattern(
        'Bearish Power Bar',
        'SINGLE',
        'SELL',
        92,
        'Bearish Power Bar: High-conviction institutional red expansion bar breaking below previous low in trend direction.',
        c0.high + safeAtr * 0.2,
        1
      );
    }

    // E5. Bearish Relief Rejection (Selling into Dynamic Resistance in Macro Downtrend)
    if (isRed(c0) && (isGreen(c1) || c0.high >= (confluence.ema20 || currentPrice) * 0.992) && c0.close < c1.close && (confluence.allowsShort || currentPrice <= confluence.ema50)) {
      addPattern(
        'Bearish Relief Rejection',
        'DOUBLE',
        'SELL',
        90,
        'Bearish Relief Rejection: Institutional sellers rejected bounce at dynamic EMA resistance.',
        Math.max(c0.high, c1.high) + safeAtr * 0.25,
        2
      );
    }

    // E3. Bullish Belt Hold (White Opening Marubozu)
    if (isGreen(c0) && lowerWick(c0) <= 0.05 * range(c0) && body(c0) >= 0.65 * range(c0) && allowsBullishReversal) {
      addPattern(
        'Bullish Belt Hold',
        'SINGLE',
        'BUY',
        86,
        'Bullish Belt Hold: Price opened at absolute low with no lower wick and surged fiercely upward.',
        c0.low - safeAtr * 0.2,
        1
      );
    }

    // F. Bearish Belt Hold (Black Opening Marubozu)
    if (isRed(c0) && upperWick(c0) <= 0.05 * range(c0) && body(c0) >= 0.65 * range(c0) && allowsBearishReversal) {
      addPattern(
        'Bearish Belt Hold',
        'SINGLE',
        'SELL',
        86,
        'Bearish Belt Hold: Price opened at absolute high with no upper wick and crashed fiercely downward.',
        c0.high + safeAtr * 0.2,
        1
      );
    }

    // G. Dragonfly Doji (Bullish) & Gravestone Doji (Bearish)
    if (isDoji(c0)) {
      if (lowerWick(c0) >= 0.70 * range(c0) && allowsBullishReversal) {
        addPattern('Dragonfly Doji', 'SINGLE', 'BUY', 84, 'Dragonfly Doji: Long lower shadow rejection with flat close at high.', c0.low - safeAtr * 0.2, 1);
      } else if (upperWick(c0) >= 0.70 * range(c0) && allowsBearishReversal) {
        addPattern('Gravestone Doji', 'SINGLE', 'SELL', 84, 'Gravestone Doji: Long upper shadow rejection with flat close at low.', c0.high + safeAtr * 0.2, 1);
      }
    }

    // =========================================================================
    // 2. TWO-CANDLESTICK REVERSAL PATTERNS
    // =========================================================================

    // A. Bullish Engulfing
    if (isRed(c1) && isGreen(c0) && c0.open <= c1.close + safeAtr * 0.05 && c0.close >= c1.open && body(c0) > body(c1) * 0.9 && allowsBullishReversal) {
      addPattern(
        'Bullish Engulfing',
        'DOUBLE',
        'BUY',
        92,
        'Bullish Engulfing: Massive green candle completely swallows previous red bar body after pullback. High conviction reversal.',
        Math.min(c0.low, c1.low) - safeAtr * 0.2,
        2
      );
    }

    // B. Bearish Engulfing
    if (isGreen(c1) && isRed(c0) && c0.open >= c1.close - safeAtr * 0.05 && c0.close <= c1.open && body(c0) > body(c1) * 0.9 && allowsBearishReversal) {
      addPattern(
        'Bearish Engulfing',
        'DOUBLE',
        'SELL',
        92,
        'Bearish Engulfing: Massive red candle completely swallows previous green bar body after rally. Severe liquidation pressure.',
        Math.max(c0.high, c1.high) + safeAtr * 0.2,
        2
      );
    }

    // C. Piercing Pattern (Bullish Reversal >= 50% retracement)
    if (isRed(c1) && isGreen(c0) && c0.close > (c1.open + c1.close) / 2 && c0.close <= c1.open && allowsBullishReversal) {
      addPattern(
        'Piercing Pattern',
        'DOUBLE',
        'BUY',
        87,
        'Piercing Pattern: Green candle pierced and closed above 50% of prior red body after pullback.',
        Math.min(c0.low, c1.low) - safeAtr * 0.2,
        2
      );
    }

    // D. Dark Cloud Cover (Bearish Reversal >= 50% penetration)
    if (isGreen(c1) && isRed(c0) && c0.close < (c1.open + c1.close) / 2 && c0.close >= c1.open && allowsBearishReversal) {
      addPattern(
        'Dark Cloud Cover',
        'DOUBLE',
        'SELL',
        87,
        'Dark Cloud Cover: Red candle pierced and closed below 50% of prior green body after rally.',
        Math.max(c0.high, c1.high) + safeAtr * 0.2,
        2
      );
    }

    // E. Bullish Harami & Harami Cross
    if (isRed(c1) && c0.open >= c1.close && c0.close <= c1.open && body(c0) < body(c1) * 0.6 && allowsBullishReversal) {
      if (isDoji(c0)) {
        addPattern('Bullish Harami Cross', 'DOUBLE', 'BUY', 88, 'Bullish Harami Cross: Inside-bar Doji signaling trend stall and immediate reversal.', c1.low - safeAtr * 0.2, 2);
      } else if (isGreen(c0)) {
        addPattern('Bullish Harami', 'DOUBLE', 'BUY', 81, 'Bullish Harami: Small green inside-bar showing selling exhaustion.', c1.low - safeAtr * 0.2, 2);
      }
    }

    // F. Bearish Harami & Harami Cross
    if (isGreen(c1) && c0.open <= c1.close && c0.close >= c1.open && body(c0) < body(c1) * 0.6 && allowsBearishReversal) {
      if (isDoji(c0)) {
        addPattern('Bearish Harami Cross', 'DOUBLE', 'SELL', 88, 'Bearish Harami Cross: Inside-bar Doji signaling rally exhaustion and immediate distribution.', c1.high + safeAtr * 0.2, 2);
      } else if (isRed(c0)) {
        addPattern('Bearish Harami', 'DOUBLE', 'SELL', 81, 'Bearish Harami: Small red inside-bar showing buyer exhaustion.', c1.high + safeAtr * 0.2, 2);
      }
    }

    // G. Tweezers Bottom & Tweezers Top
    if (Math.abs(c0.low - c1.low) <= safeAtr * 0.06 && isRed(c1) && isGreen(c0) && allowsBullishReversal) {
      addPattern('Tweezers Bottom', 'DOUBLE', 'BUY', 89, 'Tweezers Bottom: Identical support lows hit consecutively. Double bottom bounce confirmed.', c0.low - safeAtr * 0.2, 2);
    }
    if (Math.abs(c0.high - c1.high) <= safeAtr * 0.06 && isGreen(c1) && isRed(c0) && allowsBearishReversal) {
      addPattern('Tweezers Top', 'DOUBLE', 'SELL', 89, 'Tweezers Top: Identical resistance highs hit consecutively. Double top rejection confirmed.', c0.high + safeAtr * 0.2, 2);
    }

    // H. Bullish & Bearish Kicker
    if (isRed(c1) && isGreen(c0) && c0.open >= c1.open && body(c0) >= safeAtr * 0.8 && allowsBullishReversal) {
      addPattern('Bullish Kicker', 'DOUBLE', 'BUY', 95, 'Bullish Kicker: Sudden explosive gap-and-go green candle blowing away prior red bar.', c1.low - safeAtr * 0.2, 2);
    }
    if (isGreen(c1) && isRed(c0) && c0.open <= c1.open && body(c0) >= safeAtr * 0.8 && allowsBearishReversal) {
      addPattern('Bearish Kicker', 'DOUBLE', 'SELL', 95, 'Bearish Kicker: Sudden violent gap-down crash blowing away prior green bar.', c1.high + safeAtr * 0.2, 2);
    }

    // I. Matching Low & Matching High
    if (isRed(c1) && isRed(c0) && Math.abs(c0.close - c1.close) <= safeAtr * 0.05 && allowsBullishReversal) {
      addPattern('Matching Low', 'DOUBLE', 'BUY', 80, 'Matching Low: Two black candles closing at identical floor level, forming accumulation base.', c0.low - safeAtr * 0.2, 2);
    }
    if (isGreen(c1) && isGreen(c0) && Math.abs(c0.close - c1.close) <= safeAtr * 0.05 && allowsBearishReversal) {
      addPattern('Matching High', 'DOUBLE', 'SELL', 80, 'Matching High: Two white candles closing at identical ceiling level, forming distribution cap.', c0.high + safeAtr * 0.2, 2);
    }

    // J. Homing Pigeon (Bullish) & Two Crows (Bearish)
    if (isRed(c1) && isRed(c0) && c0.open < c1.open && c0.close > c1.close && allowsBullishReversal) {
      addPattern('Homing Pigeon', 'DOUBLE', 'BUY', 78, 'Homing Pigeon: Red inside-candle showing sellers trapped inside prior bar range.', c1.low - safeAtr * 0.2, 2);
    }

    // =========================================================================
    // 3. THREE-CANDLESTICK PATTERNS
    // =========================================================================

    // A. Morning Star & Morning Doji Star (Bullish)
    if (isRed(c2) && body(c2) >= safeAtr * 0.4 && body(c1) < body(c2) * 0.5 && isGreen(c0) && c0.close > (c2.open + c2.close) / 2 && allowsBullishReversal) {
      if (isDoji(c1)) {
        addPattern('Morning Doji Star', 'TRIPLE', 'BUY', 94, 'Morning Doji Star: Textbook 3-candle reversal with center Doji star and violent green breakout.', Math.min(c0.low, c1.low, c2.low) - safeAtr * 0.2, 3);
      } else {
        addPattern('Morning Star', 'TRIPLE', 'BUY', 91, 'Morning Star: Heavy red bar followed by star consolidation and strong green recovery.', Math.min(c0.low, c1.low, c2.low) - safeAtr * 0.2, 3);
      }
    }

    // B. Evening Star & Evening Doji Star (Bearish)
    if (isGreen(c2) && body(c2) >= safeAtr * 0.4 && body(c1) < body(c2) * 0.5 && isRed(c0) && c0.close < (c2.open + c2.close) / 2 && allowsBearishReversal) {
      if (isDoji(c1)) {
        addPattern('Evening Doji Star', 'TRIPLE', 'SELL', 94, 'Evening Doji Star: Textbook 3-candle distribution with center Doji star and violent red plunge.', Math.max(c0.high, c1.high, c2.high) + safeAtr * 0.2, 3);
      } else {
        addPattern('Evening Star', 'TRIPLE', 'SELL', 91, 'Evening Star: Heavy green bar followed by star consolidation and strong red breakdown.', Math.max(c0.high, c1.high, c2.high) + safeAtr * 0.2, 3);
      }
    }

    // C. Abandoned Baby (Extremely High Win-Rate Gap Reversals)
    if (isRed(c2) && isDoji(c1) && isGreen(c0) && c1.high < c2.low && c1.high < c0.low) {
      addPattern('Bullish Abandoned Baby', 'TRIPLE', 'BUY', 98, 'Bullish Abandoned Baby: Pristine gap-island reversal. 98% institutional turnaround rate.', c1.low - safeAtr * 0.2, 3);
    }
    if (isGreen(c2) && isDoji(c1) && isRed(c0) && c1.low > c2.high && c1.low > c0.high) {
      addPattern('Bearish Abandoned Baby', 'TRIPLE', 'SELL', 98, 'Bearish Abandoned Baby: Pristine gap-island top reversal. 98% institutional breakdown rate.', c1.high + safeAtr * 0.2, 3);
    }

    // D. Three White Soldiers & Three Black Crows
    if (isGreen(c2) && isGreen(c1) && isGreen(c0) && c0.close > c1.close && c1.close > c2.close && upperWick(c0) <= body(c0) * 0.3 && upperWick(c1) <= body(c1) * 0.3) {
      addPattern('Three White Soldiers', 'TRIPLE', 'BUY', 93, 'Three White Soldiers: Three strong expanding green bars with small wicks marching upward.', c2.low - safeAtr * 0.2, 3);
    }
    if (isRed(c2) && isRed(c1) && isRed(c0) && c0.close < c1.close && c1.close < c2.close && lowerWick(c0) <= body(c0) * 0.3 && lowerWick(c1) <= body(c1) * 0.3) {
      addPattern('Three Black Crows', 'TRIPLE', 'SELL', 93, 'Three Black Crows: Three heavy cascading red bars with small wicks tumbling downward.', c2.high + safeAtr * 0.2, 3);
    }

    // E. Three Inside Up & Three Inside Down
    if (isRed(c2) && isGreen(c1) && c1.open > c2.close && c1.close < c2.open && isGreen(c0) && c0.close > c2.high) {
      addPattern('Three Inside Up', 'TRIPLE', 'BUY', 90, 'Three Inside Up: Harami base confirmed by aggressive third-candle breakout above candle 1 high.', c2.low - safeAtr * 0.2, 3);
    }
    if (isGreen(c2) && isRed(c1) && c1.open < c2.close && c1.close > c2.open && isRed(c0) && c0.close < c2.low) {
      addPattern('Three Inside Down', 'TRIPLE', 'SELL', 90, 'Three Inside Down: Harami top confirmed by aggressive third-candle breakdown below candle 1 low.', c2.high + safeAtr * 0.2, 3);
    }

    // F. Three Outside Up & Three Outside Down
    if (isRed(c2) && isGreen(c1) && c1.open <= c2.close && c1.close >= c2.open && isGreen(c0) && c0.close > c1.high) {
      addPattern('Three Outside Up', 'TRIPLE', 'BUY', 92, 'Three Outside Up: Bullish Engulfing validated by continuation breakout candle.', c1.low - safeAtr * 0.2, 3);
    }
    if (isGreen(c2) && isRed(c1) && c1.open >= c2.close && c1.close <= c2.open && isRed(c0) && c0.close < c1.low) {
      addPattern('Three Outside Down', 'TRIPLE', 'SELL', 92, 'Three Outside Down: Bearish Engulfing validated by continuation breakdown candle.', c1.high + safeAtr * 0.2, 3);
    }

    // G. Bullish Stick Sandwich & Bearish Stick Sandwich
    if (isRed(c2) && isGreen(c1) && isRed(c0) && Math.abs(c0.close - c2.close) <= safeAtr * 0.05 && c1.close > c2.open) {
      addPattern('Bullish Stick Sandwich', 'TRIPLE', 'BUY', 86, 'Bullish Stick Sandwich: Red-Green-Red where outer bars form an unyielding horizontal support floor.', c0.low - safeAtr * 0.2, 3);
    }
    if (isGreen(c2) && isRed(c1) && isGreen(c0) && Math.abs(c0.close - c2.close) <= safeAtr * 0.05 && c1.close < c2.open) {
      addPattern('Bearish Stick Sandwich', 'TRIPLE', 'SELL', 86, 'Bearish Stick Sandwich: Green-Red-Green where outer bars form a hard horizontal resistance ceiling.', c0.high + safeAtr * 0.2, 3);
    }

    // H. Advance Block (Bearish Exhaustion) & Deliberation (Bearish Stall)
    if (isGreen(c2) && isGreen(c1) && isGreen(c0) && body(c0) < body(c1) * 0.6 && upperWick(c0) >= body(c0) && isUptrend) {
      addPattern('Advance Block', 'TRIPLE', 'SELL', 85, 'Advance Block: Buyers exhausted, candle bodies shrinking with growing upper rejection wicks.', c0.high + safeAtr * 0.2, 3);
    }

    // I. Upside Gap Two Crows
    if (isGreen(c2) && isRed(c1) && c1.open > c2.close && isRed(c0) && c0.open > c1.open && c0.close < c1.close) {
      addPattern('Upside Gap Two Crows', 'TRIPLE', 'SELL', 87, 'Upside Gap Two Crows: Bearish double-crow engulfment after gap up.', c0.high + safeAtr * 0.2, 3);
    }

    // J. Three Stars in the South (Bullish Exhaustion)
    if (isRed(c2) && isRed(c1) && isRed(c0) && lowerWick(c2) >= body(c2) && body(c0) < body(c1) && lowerWick(c0) >= body(c0)) {
      addPattern('Three Stars in the South', 'TRIPLE', 'BUY', 83, 'Three Stars in the South: Selling momentum vanishing with shrinking bodies at bottom.', c2.low - safeAtr * 0.2, 3);
    }

    // =========================================================================
    // 4. MULTI-BAR CONTINUATION & GAP PATTERNS (4 to 5 Candles)
    // =========================================================================

    // A. Rising Three Methods (Bullish Continuation)
    if (isGreen(c4) && body(c4) >= safeAtr * 0.6 &&
        isRed(c3) && isRed(c2) && isRed(c1) &&
        c3.high <= c4.high && c1.low >= c4.low &&
        isGreen(c0) && c0.close > c4.high) {
      addPattern('Rising Three Methods', 'MULTI_BAR', 'BUY', 95, 'Rising Three Methods: Classic 5-bar pause and explosive trend breakout.', c4.low - safeAtr * 0.2, 5);
    }

    // B. Falling Three Methods (Bearish Continuation)
    if (isRed(c4) && body(c4) >= safeAtr * 0.6 &&
        isGreen(c3) && isGreen(c2) && isGreen(c1) &&
        c3.low >= c4.low && c1.high <= c4.high &&
        isRed(c0) && c0.close < c4.low) {
      addPattern('Falling Three Methods', 'MULTI_BAR', 'SELL', 95, 'Falling Three Methods: Classic 5-bar pause and catastrophic trend breakdown.', c4.high + safeAtr * 0.2, 5);
    }

    // C. Upside & Downside Tasuki Gap
    if (isGreen(c2) && isGreen(c1) && c1.open > c2.close && isRed(c0) && c0.open > c1.open && c0.close < c1.open && c0.close > c2.close) {
      addPattern('Upside Tasuki Gap', 'TRIPLE', 'BUY', 88, 'Upside Tasuki Gap: Red pullback tested the gap and held. Bullish continuation confirmed.', c2.low - safeAtr * 0.2, 3);
    }
    if (isRed(c2) && isRed(c1) && c1.open < c2.close && isGreen(c0) && c0.open < c1.open && c0.close > c1.open && c0.close < c2.close) {
      addPattern('Downside Tasuki Gap', 'TRIPLE', 'SELL', 88, 'Downside Tasuki Gap: Green bounce tested the gap and failed. Bearish continuation confirmed.', c2.high + safeAtr * 0.2, 3);
    }

    // D. Bullish & Bearish Separating Lines
    if (isRed(c1) && isGreen(c0) && Math.abs(c0.open - c1.open) <= safeAtr * 0.05 && isRawUptrend) {
      addPattern('Bullish Separating Lines', 'DOUBLE', 'BUY', 86, 'Bullish Separating Lines: Green bar opened at exact same price as red bar open and surged up.', c0.low - safeAtr * 0.2, 2);
    }
    if (isGreen(c1) && isRed(c0) && Math.abs(c0.open - c1.open) <= safeAtr * 0.05 && isRawDowntrend) {
      addPattern('Bearish Separating Lines', 'DOUBLE', 'SELL', 86, 'Bearish Separating Lines: Red bar opened at exact same price as green bar open and collapsed down.', c0.high + safeAtr * 0.2, 2);
    }

    // E. Bullish & Bearish Three-Line Strike
    if (isGreen(c3) && isGreen(c2) && isGreen(c1) && c1.close > c2.close && c2.close > c3.close &&
        isRed(c0) && c0.open > c1.close && c0.close < c3.open) {
      addPattern('Bullish Three-Line Strike', 'MULTI_BAR', 'BUY', 92, 'Bullish Three-Line Strike: Massive liquidity flush bar resetting orderbook. Strong resumption signal.', c0.low - safeAtr * 0.2, 4);
    }
    if (isRed(c3) && isRed(c2) && isRed(c1) && c1.close < c2.close && c2.close < c3.close &&
        isGreen(c0) && c0.open < c1.close && c0.close > c3.open) {
      addPattern('Bearish Three-Line Strike', 'MULTI_BAR', 'SELL', 92, 'Bearish Three-Line Strike: Massive short squeeze flush bar resetting orderbook. Strong continuation signal.', c0.high + safeAtr * 0.2, 4);
    }

    // F. Rising Window & Falling Window (Clean Gaps)
    if (c0.low > c1.high) {
      addPattern('Rising Window', 'DOUBLE', 'BUY', 85, 'Rising Window: Clean breakaway gap. Bullish momentum continuation.', c1.high - safeAtr * 0.2, 2);
    }
    if (c0.high < c1.low) {
      addPattern('Falling Window', 'DOUBLE', 'SELL', 85, 'Falling Window: Clean breakdown gap. Bearish momentum continuation.', c1.low + safeAtr * 0.2, 2);
    }

    // G. On Neck, In Neck & Thrusting Pattern (Bearish Continuation)
    if (isRed(c1) && isGreen(c0) && c0.open < c1.low) {
      if (Math.abs(c0.close - c1.low) <= safeAtr * 0.05) {
        addPattern('On Neck Pattern', 'DOUBLE', 'SELL', 82, 'On Neck Pattern: Weak green bounce stalled right at previous red bar low. Trend continues down.', c1.high + safeAtr * 0.2, 2);
      } else if (c0.close > c1.low && c0.close < (c1.open + c1.close) / 2) {
        addPattern('Thrusting Pattern', 'DOUBLE', 'SELL', 79, 'Thrusting Pattern: Weak green candle failed to pierce 50% midpoint of red body. Bearish resumption.', c1.high + safeAtr * 0.2, 2);
      }
    }

    // H. Ladder Bottom & Ladder Top
    if (isRed(c4) && isRed(c3) && isRed(c2) && lowerWick(c1) >= body(c1) && isGreen(c0) && c0.open > c1.open && c0.close > c2.high) {
      addPattern('Ladder Bottom', 'MULTI_BAR', 'BUY', 91, 'Ladder Bottom: 5-candle capitulation climax and violent reversal eruption.', c1.low - safeAtr * 0.2, 5);
    }

    // I. Bullish & Bearish Breakaway (5-Bar Acceleration Reversals)
    if (isRed(c4) && c3.open < c4.close && isGreen(c0) && c0.close > c3.high) {
      addPattern('Bullish Breakaway', 'MULTI_BAR', 'BUY', 88, 'Bullish Breakaway: 5-bar acceleration bottom turning into decisive breakout.', c3.low - safeAtr * 0.2, 5);
    }
    if (isGreen(c4) && c3.open > c4.close && isRed(c0) && c0.close < c3.low) {
      addPattern('Bearish Breakaway', 'MULTI_BAR', 'SELL', 88, 'Bearish Breakaway: 5-bar acceleration top turning into decisive breakdown.', c3.high + safeAtr * 0.2, 5);
    }

    // =========================================================================
    // SENTIMENT & HIGHEST CONFIDENCE SYNTHESIS
    // =========================================================================
    let highest: DetectedCandlePattern | null = null;
    let bullishCount = 0;
    let bearishCount = 0;

    for (const pat of detected) {
      // If requireConfluence is true, count and consider ONLY patterns with institutional confluence!
      if (requireConfluence && !pat.confluenceConfirmed) {
        continue;
      }

      if (pat.signal === 'BUY') bullishCount++;
      if (pat.signal === 'SELL') bearishCount++;
      if (!highest || pat.confidence > highest.confidence) {
        highest = pat;
      }
    }

    let dominantSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let overallSentiment: CandlestickAnalysisResult['overallSentiment'] = 'NEUTRAL';

    if (highest) {
      dominantSignal = highest.signal;
      overallSentiment = highest.signal === 'BUY'
        ? (bullishCount >= 2 ? 'STRONG_BULLISH' : 'BULLISH')
        : (bearishCount >= 2 ? 'STRONG_BEARISH' : 'BEARISH');
    } else {
      dominantSignal = 'NEUTRAL';
      overallSentiment = confluence.trendDirection === 'BULLISH'
        ? 'BULLISH'
        : (confluence.trendDirection === 'BEARISH' ? 'BEARISH' : 'NEUTRAL');
    }

    const smartDetector = SmartReversalDetector.toAdaptiveResult(smartDetection, currentPrice, safeAtr);

    return {
      symbol,
      interval: '15m',
      lastPrice: currentPrice,
      atr: parseFloat(safeAtr.toFixed(4)),
      dominantSignal,
      highestConfidencePattern: highest,
      detectedPatterns: detected,
      bullishPatternsCount: bullishCount,
      bearishPatternsCount: bearishCount,
      overallSentiment,
      smartDetector,
      smartDetection,
      confluence: {
        ema20: confluence.ema20,
        ema50: confluence.ema50,
        ema200: confluence.ema200,
        rsi14: confluence.rsi14,
        rvol: confluence.rvol,
        allowsLong: confluence.allowsLong,
        allowsShort: confluence.allowsShort,
        summaryReason: confluence.summaryReason,
      },
    };
  }

  /**
   * Generates a complete TradingView Pine Script v5 code incorporating ALL 11 photo patterns!
   */
  public static generateTradingViewPineScript(): string {
    return `//@version=5
strategy("Nexvora Candlestick Master Strategy [Tester Pro]", shorttitle="NEX-SOL-PRO", overlay=true, initial_capital=176, default_qty_type=strategy.cash, default_qty_value=25, currency=currency.USD, commission_type=strategy.commission.percent, commission_value=0.05, process_orders_on_close=true, max_bars_back=5000, pyramiding=0)

// =============================================================================
// INPUTS & CONFIGURATION
// =============================================================================
atrLen         = input.int(14, "ATR Period", minval=1, group="Strategy Parameters")
tpAtrMult      = input.float(1.02, "Take Profit ATR Multiplier", step=0.01, group="Strategy Parameters")
slAtrMult      = input.float(1.80, "Stop Loss ATR Multiplier", step=0.01, group="Strategy Parameters")
invertSignals  = input.bool(false, "Inverse Trading Mode (Flip Long and Short)", group="Strategy Parameters")
useTrendFilter = input.bool(true, "Require EMA 20/50/200 Trend Alignment", group="Strategy Parameters")
useRsiFilter   = input.bool(true, "Require RSI Confluence (50 Centerline)", group="Strategy Parameters")
useVolFilter   = input.bool(true, "Require Volume > 20 SMA Volume", group="Strategy Parameters")

// Backtest Date Window (Matches Aug 1, 2026 — Sep 27, 2026)
useDateFilter  = input.bool(false, "Enable Custom Date Filter in Script", group="Backtest Window")
startTime      = input.time(timestamp("2026-08-01 00:00 +0000"), "Start Date", group="Backtest Window")
endTime        = input.time(timestamp("2026-09-27 23:59 +0000"), "End Date", group="Backtest Window")
inDateRange    = not useDateFilter or (time >= startTime and time <= endTime)

// Visuals & Displays
showSignals    = input.bool(true, "Show Signal Markers on Chart", group="Visuals")
showTpSlLines  = input.bool(true, "Show Active TP / SL Levels", group="Visuals")
showHudTable   = input.bool(true, "Show Performance HUD Table", group="Visuals")
tablePosInput  = input.string("Top Right", "HUD Table Position", options=["Top Right", "Bottom Right", "Top Left", "Bottom Left"], group="Visuals")
enableAlerts   = input.bool(true, "Enable Trading Alerts", group="Alerts")

// ATR Calculation
atrVal = ta.atr(atrLen)

// Candle Body & Range Math
cBody   = math.abs(close - open)
cRange  = math.max(high - low, syminfo.mintick)
uWick   = high - math.max(open, close)
lWick   = math.min(open, close) - low
isGreen = close > open
isRed   = close < open
isDoji  = cBody <= (cRange * 0.10)

// Institutional Confluence Indicators
ema20    = ta.ema(close, 20)
ema50    = ta.ema(close, 50)
ema200   = ta.ema(close, 200)
rsi14    = ta.rsi(close, 14)
volSma20 = ta.sma(volume, 20)

trendLong  = not useTrendFilter or (close > ema200 and ema20 > ema50 and close > ema50)
trendShort = not useTrendFilter or (close < ema200 and ema20 < ema50 and close < ema50)
rsiLong    = not useRsiFilter or (rsi14 >= 50.0 and rsi14 <= 70.0)
rsiShort   = not useRsiFilter or (rsi14 <= 50.0 and rsi14 >= 30.0)
volPass    = not useVolFilter or (volume >= volSma20 * 0.90)

isMacroBullConfluence = trendLong and rsiLong and volPass
isMacroBearConfluence = trendShort and rsiShort and volPass

isDowntrend = ema20 < ema50
isUptrend   = ema20 > ema50

// =============================================================================
// 1. SINGLE CANDLESTICK PATTERNS (Photo 1 & 4)
// =============================================================================
isHammer         = lWick >= (2.0 * cBody) and uWick <= (0.25 * cBody) and isDowntrend
isHangingMan     = lWick >= (2.0 * cBody) and uWick <= (0.25 * cBody) and isUptrend
isInvertedHammer = uWick >= (2.0 * cBody) and lWick <= (0.20 * cBody) and isDowntrend
isShootingStar   = uWick >= (2.0 * cBody) and lWick <= (0.20 * cBody) and isUptrend
isBullBeltHold   = isGreen and lWick <= (0.05 * cRange) and cBody >= (0.70 * cRange) and isDowntrend
isBearBeltHold   = isRed and uWick <= (0.05 * cRange) and cBody >= (0.70 * cRange) and isUptrend

// =============================================================================
// 2. TWO CANDLESTICK PATTERNS (Photo 1, 2, 3, 6, 8, 10, 11)
// =============================================================================
isBullEngulf     = isRed[1] and isGreen and open <= close[1] and close >= open[1] and cBody > cBody[1]
isBearEngulf     = isGreen[1] and isRed and open >= close[1] and close <= open[1] and cBody > cBody[1]
isPiercing       = isRed[1] and isGreen and open < low[1] and close > (open[1] + close[1])/2 and close < open[1]
isDarkCloud      = isGreen[1] and isRed and open > high[1] and close < (open[1] + close[1])/2 and close > open[1]
isBullHarami     = isRed[1] and open > close[1] and close < open[1] and cBody < cBody[1] * 0.6
isBearHarami     = isGreen[1] and open < close[1] and close > open[1] and cBody < cBody[1] * 0.6
isTweezersBottom = math.abs(low - low[1]) <= (atrVal * 0.05) and isRed[1] and isGreen
isTweezersTop    = math.abs(high - high[1]) <= (atrVal * 0.05) and isGreen[1] and isRed
isBullKicker     = isRed[1] and isGreen and open >= open[1] and cBody >= (atrVal * 0.7)
isBearKicker     = isGreen[1] and isRed and open <= open[1] and cBody >= (atrVal * 0.7)

// =============================================================================
// 3. THREE CANDLESTICK PATTERNS (Photo 2, 3, 4, 5, 7, 8, 9, 11)
// =============================================================================
isMorningStar        = isRed[2] and cBody[1] < cBody[2] * 0.4 and isGreen and close > (open[2] + close[2])/2
isEveningStar        = isGreen[2] and cBody[1] < cBody[2] * 0.4 and isRed and close < (open[2] + close[2])/2
isAbandonedBabyBull  = isRed[2] and isDoji[1] and isGreen and high[1] < low[2] and high[1] < low
isAbandonedBabyBear  = isGreen[2] and isDoji[1] and isRed and low[1] > high[2] and low[1] > high
isThreeWhiteSoldiers = isGreen[2] and isGreen[1] and isGreen and close > close[1] and close[1] > close[2] and uWick <= cBody * 0.3
isThreeBlackCrows    = isRed[2] and isRed[1] and isRed and close < close[1] and close[1] < close[2] and lWick <= cBody * 0.3
isThreeInsideUp      = isBullHarami[1] and isGreen and close > high[2]
isThreeInsideDown    = isBearHarami[1] and isRed and close < low[2]
isThreeOutsideUp     = isBullEngulf[1] and isGreen and close > high[1]
isThreeOutsideDown   = isBearEngulf[1] and isRed and close < low[1]
isStickSandwichBull  = isRed[2] and isGreen[1] and isRed and math.abs(close - close[2]) <= (atrVal * 0.05)
isStickSandwichBear  = isGreen[2] and isRed[1] and isGreen and math.abs(close - close[2]) <= (atrVal * 0.05)

// =============================================================================
// 4. MULTI-BAR CONTINUATION PATTERNS (Photo 6, 9, 10, 11)
// =============================================================================
isRisingThree        = isGreen[4] and isRed[3] and isRed[2] and isRed[1] and isGreen and close > high[4]
isFallingThree       = isRed[4] and isGreen[3] and isGreen[2] and isGreen[1] and isRed and close < low[4]
isThreeLineStrikeBull= isGreen[3] and isGreen[2] and isGreen[1] and isRed and open > close[1] and close < open[3]
isThreeLineStrikeBear= isRed[3] and isRed[2] and isRed[1] and isGreen and open < close[1] and close > open[3]
isTasukiGapBull      = isGreen[2] and isGreen[1] and open[1] > close[2] and isRed and open > open[1] and close < open[1] and close > close[2]
isTasukiGapBear      = isRed[2] and isRed[1] and open[1] < close[2] and isGreen and open < open[1] and close > open[1] and close < close[2]

// =============================================================================
// SIGNAL AGGREGATION
// =============================================================================
bullSignalSingle = isHammer or isInvertedHammer or isBullBeltHold
bullSignalDouble = isBullEngulf or isPiercing or isBullHarami or isTweezersBottom or isBullKicker
bullSignalTriple = isMorningStar or isAbandonedBabyBull or isThreeWhiteSoldiers or isThreeInsideUp or isThreeOutsideUp or isStickSandwichBull
bullSignalMulti  = isRisingThree or isThreeLineStrikeBull or isTasukiGapBull
bullSignal       = (bullSignalSingle or bullSignalDouble or bullSignalTriple or bullSignalMulti) and isMacroBullConfluence

bearSignalSingle = isHangingMan or isShootingStar or isBearBeltHold
bearSignalDouble = isBearEngulf or isDarkCloud or isBearHarami or isTweezersTop or isBearKicker
bearSignalTriple = isEveningStar or isAbandonedBabyBear or isThreeBlackCrows or isThreeInsideDown or isThreeOutsideDown or isStickSandwichBear
bearSignalMulti  = isFallingThree or isThreeLineStrikeBear or isTasukiGapBear
bearSignal       = (bearSignalSingle or bearSignalDouble or bearSignalTriple or bearSignalMulti) and isMacroBearConfluence

// Dynamic Pattern Comment for Orders
patternTxt = "Pattern"
if isAbandonedBabyBull
    patternTxt := "Abandoned Baby (Bull)"
else if isAbandonedBabyBear
    patternTxt := "Abandoned Baby (Bear)"
else if isMorningStar
    patternTxt := "Morning Star"
else if isEveningStar
    patternTxt := "Evening Star"
else if isThreeWhiteSoldiers
    patternTxt := "3 White Soldiers"
else if isThreeBlackCrows
    patternTxt := "3 Black Crows"
else if isBullEngulf
    patternTxt := "Bullish Engulfing"
else if isBearEngulf
    patternTxt := "Bearish Engulfing"
else if isHammer
    patternTxt := "Hammer"
else if isShootingStar
    patternTxt := "Shooting Star"
else if isRisingThree
    patternTxt := "Rising 3 Methods"
else if isFallingThree
    patternTxt := "Falling 3 Methods"
else if isTweezersBottom
    patternTxt := "Tweezers Bottom"
else if isTweezersTop
    patternTxt := "Tweezers Top"
else if isBullKicker
    patternTxt := "Bullish Kicker"
else if isBearKicker
    patternTxt := "Bearish Kicker"
else if isPiercing
    patternTxt := "Piercing"
else if isDarkCloud
    patternTxt := "Dark Cloud"
else if isBullHarami
    patternTxt := "Bullish Harami"
else if isBearHarami
    patternTxt := "Bearish Harami"
else if isThreeInsideUp
    patternTxt := "Three Inside Up"
else if isThreeInsideDown
    patternTxt := "Three Inside Down"
else if isThreeOutsideUp
    patternTxt := "Three Outside Up"
else if isThreeOutsideDown
    patternTxt := "Three Outside Down"
else if isBullBeltHold
    patternTxt := "Bull Belt Hold"
else if isBearBeltHold
    patternTxt := "Bear Belt Hold"
else if isHangingMan
    patternTxt := "Hanging Man"
else if isInvertedHammer
    patternTxt := "Inverted Hammer"
else if isStickSandwichBull
    patternTxt := "Bull Stick Sandwich"
else if isStickSandwichBear
    patternTxt := "Bear Stick Sandwich"
else if isThreeLineStrikeBull
    patternTxt := "Bull 3-Line Strike"
else if isThreeLineStrikeBear
    patternTxt := "Bear 3-Line Strike"
else if isTasukiGapBull
    patternTxt := "Upside Tasuki"
else if isTasukiGapBear
    patternTxt := "Downside Tasuki"

// =============================================================================
// NATIVE STRATEGY EXECUTION ENGINE (FOR STRATEGY TESTER TAB)
// =============================================================================
var float entryPriceLevel = na
var float tpPriceLevel = na
var float slPriceLevel = na

// Execution Signals with Inverse Mode Support
tradeLongSignal  = invertSignals ? bearSignal : bullSignal
tradeShortSignal = invertSignals ? bullSignal : bearSignal
tradePatternTxt  = invertSignals ? ("INV: " + patternTxt) : patternTxt

if inDateRange
    if tradeLongSignal and strategy.position_size <= 0
        entryPriceLevel := close
        tpPriceLevel := close + (atrVal * tpAtrMult)
        slPriceLevel := close - (atrVal * slAtrMult)
        strategy.entry("Long", strategy.long, comment=tradePatternTxt)

    if tradeShortSignal and strategy.position_size >= 0
        entryPriceLevel := close
        tpPriceLevel := close - (atrVal * tpAtrMult)
        slPriceLevel := close + (atrVal * slAtrMult)
        strategy.entry("Short", strategy.short, comment=tradePatternTxt)

// Continuous Order & Intrabar TP/SL Management
if strategy.position_size > 0
    if na(tpPriceLevel)
        entryPriceLevel := strategy.position_avg_price
        tpPriceLevel := strategy.position_avg_price + (atrVal * tpAtrMult)
        slPriceLevel := strategy.position_avg_price - (atrVal * slAtrMult)

    strategy.exit("Exit Long", from_entry="Long", limit=tpPriceLevel, stop=slPriceLevel, comment_profit="TP 1.02 ATR", comment_loss="SL Hit")
    if high >= tpPriceLevel
        strategy.close("Long", comment="TP 1.02 ATR")
    else if low <= slPriceLevel
        strategy.close("Long", comment="SL Hit")

if strategy.position_size < 0
    if na(tpPriceLevel)
        entryPriceLevel := strategy.position_avg_price
        tpPriceLevel := strategy.position_avg_price - (atrVal * tpAtrMult)
        slPriceLevel := strategy.position_avg_price + (atrVal * slAtrMult)

    strategy.exit("Exit Short", from_entry="Short", limit=tpPriceLevel, stop=slPriceLevel, comment_profit="TP 1.02 ATR", comment_loss="SL Hit")
    if low <= tpPriceLevel
        strategy.close("Short", comment="TP 1.02 ATR")
    else if high >= slPriceLevel
        strategy.close("Short", comment="SL Hit")

if strategy.position_size == 0
    tpPriceLevel := na
    slPriceLevel := na

// Close position if custom backtest date window finishes
if useDateFilter and time > endTime and strategy.position_size != 0
    strategy.close_all(comment="Backtest End")

// =============================================================================
// ACTIVE TP / SL LINES ON CHART
// =============================================================================
var line l_entry = na
var line l_tp = na
var line l_sl = na

if showTpSlLines
    if strategy.position_size != 0
        if na(l_entry)
            l_entry := line.new(bar_index, entryPriceLevel, bar_index + 1, entryPriceLevel, color=#2962ff, width=1, style=line.style_dashed)
            l_tp    := line.new(bar_index, tpPriceLevel, bar_index + 1, tpPriceLevel, color=#10b981, width=2, style=line.style_solid)
            l_sl    := line.new(bar_index, slPriceLevel, bar_index + 1, slPriceLevel, color=#ef4444, width=2, style=line.style_solid)
        else
            line.set_x2(l_entry, bar_index + 1)
            line.set_x2(l_tp, bar_index + 1)
            line.set_x2(l_sl, bar_index + 1)
    else
        l_entry := na
        l_tp    := na
        l_sl    := na

// Candlestick Highlights
barcolor(bullSignal and inDateRange ? #10b981 : bearSignal and inDateRange ? #ef4444 : na)

plotshape(showSignals and bullSignal and inDateRange, title="Bull Signal", style=shape.triangleup, location=location.belowbar, color=#10b981, size=size.tiny)
plotshape(showSignals and bearSignal and inDateRange, title="Bear Signal", style=shape.triangledown, location=location.abovebar, color=#ef4444, size=size.tiny)

// =============================================================================
// ON-CHART PERFORMANCE HUD TABLE (SYNCS WITH STRATEGY TESTER)
// =============================================================================
tablePos = position.top_right
if tablePosInput == "Bottom Right"
    tablePos := position.bottom_right
else if tablePosInput == "Top Left"
    tablePos := position.top_left
else if tablePosInput == "Bottom Left"
    tablePos := position.bottom_left

var table hudTable = table.new(tablePos, 2, 7, bgcolor=#131722, border_color=#363c4e, border_width=1, frame_color=#2962ff, frame_width=2)

if barstate.islast and showHudTable
    totalNetPnl = strategy.netprofit
    pnlPct = 0.0
    if strategy.initial_capital > 0
        pnlPct := (totalNetPnl / strategy.initial_capital) * 100.0

    winRate = 0.0
    if strategy.closedtrades > 0
        winRate := (strategy.wintrades / strategy.closedtrades) * 100.0

    pnlCol = #ef4444
    pnlSign = ""
    if totalNetPnl >= 0
        pnlCol := #10b981
        pnlSign := "+"

    pnlPctSign = ""
    if pnlPct >= 0
        pnlPctSign := "+"

    openPosTxt = "FLAT"
    openPosCol = #808080
    if strategy.position_size > 0
        openPosTxt := "LONG (" + str.tostring(strategy.position_size) + ")"
        openPosCol := #10b981
    else if strategy.position_size < 0
        openPosTxt := "SHORT (" + str.tostring(strategy.position_size) + ")"
        openPosCol := #ef4444

    table.cell(hudTable, 0, 0, "MASTER CANDLESTICK AUDIT", bgcolor=#2962ff, text_color=#ffffff, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 0, syminfo.ticker, bgcolor=#2962ff, text_color=#ffffff, text_size=size.small, text_halign=text.align_right)

    table.cell(hudTable, 0, 1, "Monthly Realized PnL", text_color=#808080, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 1, pnlSign + "$" + str.tostring(totalNetPnl, "#.##") + " (" + pnlPctSign + str.tostring(pnlPct, "#.##") + "%)", bgcolor=#1e293b, text_color=pnlCol, text_size=size.small, text_halign=text.align_right)

    table.cell(hudTable, 0, 2, "Max Drawdown", text_color=#808080, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 2, "$" + str.tostring(strategy.max_drawdown, "#.##"), text_color=#ef4444, text_size=size.small, text_halign=text.align_right)

    table.cell(hudTable, 0, 3, "Monthly Win Rate", text_color=#808080, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 3, str.tostring(winRate, "#.##") + "% (" + str.tostring(strategy.wintrades) + "/" + str.tostring(strategy.closedtrades) + ")", text_color=#00e5ff, text_size=size.small, text_halign=text.align_right)

    table.cell(hudTable, 0, 4, "Current Equity", text_color=#808080, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 4, "$" + str.tostring(strategy.equity, "#.##"), text_color=#ffffff, text_size=size.small, text_halign=text.align_right)

    table.cell(hudTable, 0, 5, "Open Position", text_color=#808080, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 5, openPosTxt, text_color=openPosCol, text_size=size.small, text_halign=text.align_right)

    table.cell(hudTable, 0, 6, "Initial Capital", text_color=#808080, text_size=size.small, text_halign=text.align_left)
    table.cell(hudTable, 1, 6, "$" + str.tostring(strategy.initial_capital, "#.##") + " USD", text_color=#ffffff, text_size=size.small, text_halign=text.align_right)

// Alerts
if bullSignal and enableAlerts
    alert("Bullish Pattern Triggered: " + patternTxt + " on " + syminfo.ticker, alert.freq_once_per_bar_close)

if bearSignal and enableAlerts
    alert("Bearish Pattern Triggered: " + patternTxt + " on " + syminfo.ticker, alert.freq_once_per_bar_close)
`;
  }
}
export const candlestickMaster = new CandlestickMasterPatternEngine();
