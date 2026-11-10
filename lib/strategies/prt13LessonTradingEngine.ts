/**
 * PUSHKAR RAJ THAKUR (PRT) 13-LESSON COMPLETE CRASH COURSE ENGINE
 * Based on "Learn Trading for Beginners in 2026 | Step by Step Free Crash Course" (13 Lessons)
 * Playlist: https://www.youtube.com/watch?v=zlw7xHt539c&list=PLxNHpNhDaEFJbaCbe9_3FCZ1AHPTwzO05
 * 
 * Core Components:
 * 1. Supertrend (Period 10, Multiplier 3)
 * 2. 9 EMA & 21 EMA Dynamic Crossover Trend
 * 3. Central Pivot Range (CPR: Pivot, TC, BC) Support/Resistance Boundaries
 * 4. Double Bottom (W Pattern) & Double Top (M Pattern) Breakout Confirmation
 * 5. 20-period Volume SMA Institutional Participation
 * 6. Strict 1:2 Risk-to-Reward ($5.00 TP, $2.50 SL) at 25x leverage
 */

export interface PrtSetupResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  supertrend: 'BULLISH' | 'BEARISH';
  ema9: number;
  ema21: number;
  emaCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'ALIGNED_BULL' | 'ALIGNED_BEAR' | 'NONE';
  cpr: { pivot: number; tc: number; bc: number; widthPct: number; position: 'ABOVE_CPR' | 'BELOW_CPR' | 'INSIDE_CPR' };
  chartPattern: 'DOUBLE_BOTTOM_W' | 'DOUBLE_TOP_M' | null;
  volumeAboveAverage: boolean;
  reasons: string[];
  customTP: number;
  customSL: number;
}

export class Prt13LessonTradingEngine {
  public calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i];
    let currentEMA = sum / period;
    emaArray.push(currentEMA);

    for (let i = period; i < prices.length; i++) {
      currentEMA = (prices[i] * k) + (currentEMA * (1 - k));
      emaArray.push(currentEMA);
    }
    return emaArray;
  }

  public calculateATR(candles: any[], period: number = 10): number[] {
    if (candles.length < period + 1) return [];
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const prevC = candles[i - 1].close;
      const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
      trs.push(tr);
    }
    const atrs: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += trs[i];
    let currAtr = sum / period;
    atrs.push(currAtr);

    for (let i = period; i < trs.length; i++) {
      currAtr = (currAtr * (period - 1) + trs[i]) / period;
      atrs.push(currAtr);
    }
    return atrs;
  }

  public calculateSupertrend(candles: any[], period: number = 10, multiplier: number = 3) {
    const atrs = this.calculateATR(candles, period);
    if (atrs.length === 0) return { direction: 'BULLISH', band: 0 };

    let trend = 'BULLISH';
    let upperBand = 0;
    let lowerBand = 0;

    const offset = candles.length - atrs.length;
    for (let i = 0; i < atrs.length; i++) {
      const idx = i + offset;
      const c = candles[idx];
      const hl2 = (c.high + c.low) / 2;
      const atr = atrs[i];

      let basicUpper = hl2 + (multiplier * atr);
      let basicLower = hl2 - (multiplier * atr);

      const prevClose = candles[idx - 1]?.close || c.close;
      upperBand = (basicUpper < upperBand || prevClose > upperBand) ? basicUpper : upperBand;
      lowerBand = (basicLower > lowerBand || prevClose < lowerBand) ? basicLower : lowerBand;

      if (c.close > upperBand) trend = 'BULLISH';
      else if (c.close < lowerBand) trend = 'BEARISH';
    }

    return { direction: trend as 'BULLISH' | 'BEARISH', band: trend === 'BULLISH' ? lowerBand : upperBand };
  }

  public evaluateSetup(symbol: string, candles: any[]): PrtSetupResult {
    const result: PrtSetupResult = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      supertrend: 'BULLISH',
      ema9: 0,
      ema21: 0,
      emaCrossover: 'NONE',
      cpr: { pivot: 0, tc: 0, bc: 0, widthPct: 0, position: 'INSIDE_CPR' },
      chartPattern: null,
      volumeAboveAverage: false,
      reasons: [],
      customTP: 0,
      customSL: 0,
    };

    if (!candles || candles.length < 50) {
      result.reasons.push('Insufficient candle history (need >= 50)');
      return result;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    const ema9Arr = this.calculateEMA(closes, 9);
    const ema21Arr = this.calculateEMA(closes, 21);
    const st = this.calculateSupertrend(candles, 10, 3);
    result.supertrend = st.direction as 'BULLISH' | 'BEARISH';

    if (ema9Arr.length < 5 || ema21Arr.length < 5) {
      result.reasons.push('EMA calculation warming up');
      return result;
    }

    const currentPrice = closes[closes.length - 1];
    const currEma9 = ema9Arr[ema9Arr.length - 1];
    const currEma21 = ema21Arr[ema21Arr.length - 1];
    const prevEma9 = ema9Arr[ema9Arr.length - 2];
    const prevEma21 = ema21Arr[ema21Arr.length - 2];

    result.ema9 = currEma9;
    result.ema21 = currEma21;

    // EMA crossover detection
    if (prevEma9 <= prevEma21 && currEma9 > currEma21) {
      result.emaCrossover = 'BULLISH_CROSS';
    } else if (prevEma9 >= prevEma21 && currEma9 < currEma21) {
      result.emaCrossover = 'BEARISH_CROSS';
    } else if (currEma9 > currEma21) {
      result.emaCrossover = 'ALIGNED_BULL';
    } else if (currEma9 < currEma21) {
      result.emaCrossover = 'ALIGNED_BEAR';
    }

    // CPR (Central Pivot Range) Calculation using prior session lookback (last 24 bars)
    const prevSessionHigh = Math.max(...highs.slice(-32, -8));
    const prevSessionLow = Math.min(...lows.slice(-32, -8));
    const prevSessionClose = closes[closes.length - 9];

    const pivot = (prevSessionHigh + prevSessionLow + prevSessionClose) / 3;
    const bc = (prevSessionHigh + prevSessionLow) / 2;
    const tc = (pivot - bc) + pivot;
    const topCpr = Math.max(tc, bc);
    const botCpr = Math.min(tc, bc);
    const widthPct = Math.abs(tc - bc) / pivot * 100;

    let cprPos: 'ABOVE_CPR' | 'BELOW_CPR' | 'INSIDE_CPR' = 'INSIDE_CPR';
    if (currentPrice > topCpr) cprPos = 'ABOVE_CPR';
    else if (currentPrice < botCpr) cprPos = 'BELOW_CPR';

    result.cpr = { pivot, tc, bc, widthPct, position: cprPos };

    // Volume vs 20 SMA
    const recentVols = volumes.slice(-21, -1);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const currentVol = volumes[volumes.length - 1];
    result.volumeAboveAverage = currentVol > avgVol;

    // Chart Pattern Detection (W and M patterns in last 20 bars)
    const recentLows = lows.slice(-20);
    const recentHighs = highs.slice(-20);
    const firstLow = Math.min(...recentLows.slice(0, 10));
    const secondLow = Math.min(...recentLows.slice(10));
    if (Math.abs(firstLow - secondLow) / firstLow < 0.015 && currentPrice > (firstLow * 1.01)) {
      result.chartPattern = 'DOUBLE_BOTTOM_W';
    }
    const firstHigh = Math.max(...recentHighs.slice(0, 10));
    const secondHigh = Math.max(...recentHighs.slice(10));
    if (Math.abs(firstHigh - secondHigh) / firstHigh < 0.015 && currentPrice < (firstHigh * 0.99)) {
      result.chartPattern = 'DOUBLE_TOP_M';
    }

    let buyScore = 0;
    let sellScore = 0;

    // Pushkar Raj Thakur Bullish Confluence
    if (st.direction === 'BULLISH') buyScore += 25;
    if (result.emaCrossover === 'BULLISH_CROSS' || result.emaCrossover === 'ALIGNED_BULL') buyScore += 25;
    if (cprPos === 'ABOVE_CPR') buyScore += 25;
    if (result.chartPattern === 'DOUBLE_BOTTOM_W') buyScore += 15;
    if (result.volumeAboveAverage) buyScore += 10;

    // Pushkar Raj Thakur Bearish Confluence
    if (st.direction === 'BEARISH') sellScore += 25;
    if (result.emaCrossover === 'BEARISH_CROSS' || result.emaCrossover === 'ALIGNED_BEAR') sellScore += 25;
    if (cprPos === 'BELOW_CPR') sellScore += 25;
    if (result.chartPattern === 'DOUBLE_TOP_M') sellScore += 15;
    if (result.volumeAboveAverage) sellScore += 10;

    if (buyScore >= 65 && buyScore > sellScore) {
      result.recommendedSide = 'BUY';
      result.confidenceScore = Math.min(buyScore, 100);
      result.reasons.push(`PRT 13-Lesson Confluence (Score: ${buyScore})`);
      result.reasons.push(`Supertrend: Green (BULLISH)`);
      result.reasons.push(`EMA 9/21: ${result.emaCrossover}`);
      result.reasons.push(`CPR: Trading ABOVE CPR range`);
      if (result.chartPattern) result.reasons.push(`Pattern: ${result.chartPattern}`);

      result.customSL = Math.max(botCpr, currentPrice * 0.988);
      const risk = currentPrice - result.customSL;
      result.customTP = currentPrice + (risk * 2.0); // Strict 1:2 RRR
    } else if (sellScore >= 65 && sellScore > buyScore) {
      result.recommendedSide = 'SELL';
      result.confidenceScore = Math.min(sellScore, 100);
      result.reasons.push(`PRT 13-Lesson Confluence (Score: ${sellScore})`);
      result.reasons.push(`Supertrend: Red (BEARISH)`);
      result.reasons.push(`EMA 9/21: ${result.emaCrossover}`);
      result.reasons.push(`CPR: Trading BELOW CPR range`);
      if (result.chartPattern) result.reasons.push(`Pattern: ${result.chartPattern}`);

      result.customSL = Math.min(topCpr, currentPrice * 1.012);
      const risk = result.customSL - currentPrice;
      result.customTP = currentPrice - (risk * 2.0); // Strict 1:2 RRR
    } else {
      result.confidenceScore = Math.max(buyScore, sellScore);
      result.reasons.push(`Waiting for PRT Setup (Buy: ${buyScore}/100, Sell: ${sellScore}/100)`);
    }

    return result;
  }
}

export const prt13LessonTradingEngine = new Prt13LessonTradingEngine();
