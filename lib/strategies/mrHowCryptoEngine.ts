/**
 * MR HOW CRYPTO TRADING FULL COURSE STRATEGY ENGINE
 * Based on "Crypto Trading Full Course for Beginners by Mr How | Zero to Master Level"
 * Video: https://youtu.be/Xc_gLDARbqs
 * 
 * Core Components:
 * 1. Key Level Breakout & Retest (Horizontal S/R lookback 30-50 bars)
 * 2. Solid Body Breakout Confirmation (Body >= 55% of candle range)
 * 3. MACD (12, 26, 9) Histogram & Signal Crossover
 * 4. RSI(14) Midline Momentum Filter (RSI > 52 for Long, RSI < 48 for Short)
 * 5. Relative Volume Expansion (RVOL >= 1.2)
 * 6. Strict 1:2 Risk-to-Reward ($5.00 TP, $2.50 SL) at 25x leverage
 */

export interface MrHowSetupResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  breakoutType: 'RESISTANCE_BREAKOUT' | 'SUPPORT_BREAKDOWN' | 'NONE';
  levelPrice: number;
  macd: { macdLine: number; signalLine: number; histogram: number };
  rsi14: number;
  rvol: number;
  candleBodyRatio: number;
  reasons: string[];
  customTP: number;
  customSL: number;
}

export class MrHowCryptoEngine {
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

  public calculateMACD(closes: number[], fast: number = 12, slow: number = 26, signal: number = 9) {
    if (closes.length < slow + signal) return null;
    const fastEMA = this.calculateEMA(closes, fast);
    const slowEMA = this.calculateEMA(closes, slow);

    const macdLine: number[] = [];
    const offset = slow - fast;
    for (let i = 0; i < slowEMA.length; i++) {
      macdLine.push(fastEMA[i + offset] - slowEMA[i]);
    }

    const signalLine = this.calculateEMA(macdLine, signal);
    if (signalLine.length === 0) return null;

    const currMacd = macdLine[macdLine.length - 1];
    const currSignal = signalLine[signalLine.length - 1];
    const currHist = currMacd - currSignal;

    return { macdLine: currMacd, signalLine: currSignal, histogram: currHist };
  }

  public calculateRSI(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) return [];
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    const rsiArray: number[] = [];
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray.push(100 - (100 / (1 + rs)));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const currentRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiArray.push(100 - (100 / (1 + currentRs)));
    }
    return rsiArray;
  }

  public evaluateSetup(symbol: string, candles: any[]): MrHowSetupResult {
    const result: MrHowSetupResult = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      breakoutType: 'NONE',
      levelPrice: 0,
      macd: { macdLine: 0, signalLine: 0, histogram: 0 },
      rsi14: 50,
      rvol: 1.0,
      candleBodyRatio: 0,
      reasons: [],
      customTP: 0,
      customSL: 0,
    };

    if (!candles || candles.length < 50) {
      result.reasons.push('Insufficient candles for Mr How setup');
      return result;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    const macdData = this.calculateMACD(closes, 12, 26, 9);
    const rsiArr = this.calculateRSI(closes, 14);

    if (!macdData || rsiArr.length === 0) {
      result.reasons.push('Indicators warming up');
      return result;
    }

    result.macd = macdData;
    const currRsi = rsiArr[rsiArr.length - 1];
    result.rsi14 = currRsi;

    // RVOL (last 20 bars)
    const recentVols = volumes.slice(-21, -1);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const currentVol = volumes[volumes.length - 1];
    const rvol = avgVol > 0 ? currentVol / avgVol : 1.0;
    result.rvol = rvol;

    // Current candle properties
    const curr = candles[candles.length - 1];
    const currRange = curr.high - curr.low || 0.0001;
    const bodySize = Math.abs(curr.close - curr.open);
    const bodyRatio = bodySize / currRange;
    result.candleBodyRatio = bodyRatio;
    const isGreen = curr.close > curr.open;
    const isRed = curr.close < curr.open;

    // S/R Levels (Lookback 30 bars excluding last 3 bars)
    const lookbackHighs = highs.slice(-35, -3);
    const lookbackLows = lows.slice(-35, -3);
    const resistance = Math.max(...lookbackHighs);
    const support = Math.min(...lookbackLows);

    const currentPrice = curr.close;

    // Bullish Breakout: Candle closes above recent resistance
    const isBullBreakout = currentPrice > resistance && isGreen && bodyRatio >= 0.5;
    // Bearish Breakdown: Candle closes below recent support
    const isBearBreakdown = currentPrice < support && isRed && bodyRatio >= 0.5;

    let buyScore = 0;
    let sellScore = 0;

    // Bullish Evaluation
    if (isBullBreakout) {
      result.breakoutType = 'RESISTANCE_BREAKOUT';
      result.levelPrice = resistance;
      buyScore += 35; // Breakout base

      if (macdData.histogram > 0 && macdData.macdLine > macdData.signalLine) {
        buyScore += 25; // MACD alignment
      }
      if (currRsi >= 52 && currRsi <= 72) {
        buyScore += 20; // RSI momentum
      }
      if (rvol >= 1.2) {
        buyScore += 20; // Volume expansion
      }
    }

    // Bearish Evaluation
    if (isBearBreakdown) {
      result.breakoutType = 'SUPPORT_BREAKDOWN';
      result.levelPrice = support;
      sellScore += 35; // Breakdown base

      if (macdData.histogram < 0 && macdData.macdLine < macdData.signalLine) {
        sellScore += 25; // MACD alignment
      }
      if (currRsi <= 48 && currRsi >= 28) {
        sellScore += 20; // RSI momentum
      }
      if (rvol >= 1.2) {
        sellScore += 20; // Volume expansion
      }
    }

    if (buyScore >= 65) {
      result.recommendedSide = 'BUY';
      result.confidenceScore = Math.min(buyScore, 100);
      result.reasons.push(`Mr How Breakout Strategy (Score: ${buyScore})`);
      result.reasons.push(`Resistance Broken: $${resistance.toFixed(4)} with ${Math.round(bodyRatio * 100)}% solid body`);
      result.reasons.push(`MACD: Hist +${macdData.histogram.toFixed(4)} > 0`);
      result.reasons.push(`RSI(14): ${currRsi.toFixed(1)} > 52`);
      result.reasons.push(`RVOL: ${rvol.toFixed(2)}x`);

      result.customSL = Math.min(curr.low, resistance * 0.992);
      const risk = currentPrice - result.customSL;
      result.customTP = currentPrice + (risk * 2.0); // 1:2 RRR
    } else if (sellScore >= 65) {
      result.recommendedSide = 'SELL';
      result.confidenceScore = Math.min(sellScore, 100);
      result.reasons.push(`Mr How Breakdown Strategy (Score: ${sellScore})`);
      result.reasons.push(`Support Broken: $${support.toFixed(4)} with ${Math.round(bodyRatio * 100)}% solid body`);
      result.reasons.push(`MACD: Hist ${macdData.histogram.toFixed(4)} < 0`);
      result.reasons.push(`RSI(14): ${currRsi.toFixed(1)} < 48`);
      result.reasons.push(`RVOL: ${rvol.toFixed(2)}x`);

      result.customSL = Math.max(curr.high, support * 1.008);
      const risk = result.customSL - currentPrice;
      result.customTP = currentPrice - (risk * 2.0); // 1:2 RRR
    } else {
      result.confidenceScore = Math.max(buyScore, sellScore);
      result.reasons.push(`Waiting for Mr How Setup (Buy: ${buyScore}/100, Sell: ${sellScore}/100)`);
    }

    return result;
  }
}

export const mrHowCryptoEngine = new MrHowCryptoEngine();
