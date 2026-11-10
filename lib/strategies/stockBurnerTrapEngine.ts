/**
 * STOCK BURNER TRAP TRADING & INSTITUTIONAL PRICE ACTION ENGINE (89 LESSONS)
 * Based on "How Trading Changed My Life in 6 Years | Losses to Success" by Dinesh Kirola (Stock Burner)
 * Playlist: https://www.youtube.com/watch?v=CNIJDaTD6-Q&list=PLYPMq50BdoaAVAK3ibZkKpg-MYwqg-PVa
 * 
 * Core Components from Dinesh Kirola's Masterclass:
 * 1. Retail Trap Trading (Fake Breakout / Breakdown Trap Reversal & Liquidity Sweeps)
 * 2. 9 / 20 / 50 EMA Macro Trend Pullback & Trend Continuation Strategy
 * 3. Big Bar Momentum Expansion Strategy (Institutional Volume Injection)
 * 4. 5 EMA Alert Candle Mean Reversion Setup (With Trend Filter to avoid catching falling knives)
 * 5. Order Flow & Taker CVD Confirmation (Blocks entries into opposing institutional dumping/absorption)
 * 6. Inside Bar (Mother-Baby Candle) Compression & Breakout
 * 7. Strict 1:2 Risk-to-Reward ($5.00 TP, $2.50 SL) at 25x leverage
 */

import { multiTimeframeCandleEngine, KlinePoint, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';

export interface StockBurnerSetupResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'RETAIL_TRAP_REVERSAL' | '9_20_EMA_PULLBACK' | 'BIG_BAR_MOMENTUM' | '5_EMA_ALERT_REVERSION' | 'INSIDE_BAR_BREAKOUT' | 'NONE';
  ema5: number;
  ema9: number;
  ema20: number;
  ema50: number;
  isAlertCandle: boolean;
  isInsideBar: boolean;
  trappedLevel: number;
  reasons: string[];
  customTP: number;
  customSL: number;
}

export class StockBurnerTrapEngine {
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

  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): StockBurnerSetupResult {
    const result: StockBurnerSetupResult = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      ema5: 0,
      ema9: 0,
      ema20: 0,
      ema50: 0,
      isAlertCandle: false,
      isInsideBar: false,
      trappedLevel: 0,
      reasons: [],
      customTP: 0,
      customSL: 0,
    };

    let candles: any[] = [];
    let candles5m: any[] = [];
    let candles1h: any[] = [];
    let candles4h: any[] = [];

    if (Array.isArray(candlesOrMtf)) {
      candles = candlesOrMtf;
    } else if (candlesOrMtf && typeof candlesOrMtf === 'object') {
      candles = candlesOrMtf.candles15m || [];
      candles5m = candlesOrMtf.candles5m || [];
      candles1h = candlesOrMtf.candles1h || [];
      candles4h = candlesOrMtf.candles4h || [];
    }

    if (!candles || candles.length < 35) {
      result.reasons.push('Need >= 35 candles for Stock Burner analysis');
      return result;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const opens = candles.map(c => c.open);
    const volumes = candles.map(c => c.volume);

    const ema5Arr = this.calculateEMA(closes, 5);
    const ema9Arr = this.calculateEMA(closes, 9);
    const ema20Arr = this.calculateEMA(closes, 20);
    const ema50Arr = this.calculateEMA(closes, 50);

    const currEma5 = ema5Arr[ema5Arr.length - 1];
    const prevEma5 = ema5Arr[ema5Arr.length - 2];
    const currEma9 = ema9Arr[ema9Arr.length - 1];
    const prevEma9 = ema9Arr[ema9Arr.length - 2];
    const currEma20 = ema20Arr[ema20Arr.length - 1];
    const prevEma20 = ema20Arr[ema20Arr.length - 2];
    const currEma50 = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : currEma20;

    result.ema5 = currEma5;
    result.ema9 = currEma9;
    result.ema20 = currEma20;
    result.ema50 = currEma50;

    const currentPrice = closes[closes.length - 1];
    const curr = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prevPrev = candles[candles.length - 3];

    // Market Trend Context based on 9, 20 & 50 EMA (Strict macro alignment)
    const isUptrend = currEma9 > currEma20 && currEma20 >= currEma50 && currentPrice >= currEma20 * 0.995;
    const isDowntrend = currEma9 < currEma20 && currEma20 <= currEma50 && currentPrice <= currEma20 * 1.005;

    // Calculate ATR(14) for volatility breathing room
    let trSum = 0;
    const atrLookback = Math.min(14, candles.length - 1);
    for (let i = candles.length - atrLookback; i < candles.length; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      trSum += tr;
    }
    const atr14 = trSum / atrLookback || (currentPrice * 0.01);

    // Volume calculation
    const avgVolume20 = volumes.slice(-21, -1).reduce((sum, v) => sum + v, 0) / 20;
    const hasVolumeExpansion = curr.volume > avgVolume20;

    let buyScore = 0;
    let sellScore = 0;
    let detectedBuySetup: StockBurnerSetupResult['setupType'] = 'NONE';
    let detectedSellSetup: StockBurnerSetupResult['setupType'] = 'NONE';
    let buySL = 0;
    let sellSL = 0;

    // =========================================================================
    // 1. RETAIL TRAP TRADING (Fake Breakout & Breakdown / Liquidity Sweeps)
    // =========================================================================
    const recentHighs = highs.slice(-25, -2);
    const recentLows = lows.slice(-25, -2);
    const swingHigh = Math.max(...recentHighs);
    const swingLow = Math.min(...recentLows);

    // Bull Trap: Price broke above swing high, but got rejected and closed back below swing high
    const isBullTrap = (prev.high > swingHigh || curr.high > swingHigh) && 
                       curr.close < swingHigh && 
                       (curr.close < curr.open || curr.close < prev.close);

    // Bear Trap: Price broke below swing low, but bounced and closed back above swing low
    const isBearTrap = (prev.low < swingLow || curr.low < swingLow) && 
                       curr.close > swingLow && 
                       (curr.close > curr.open || curr.close > prev.close);

    if (isBullTrap) {
      detectedSellSetup = 'RETAIL_TRAP_REVERSAL';
      result.trappedLevel = swingHigh;
      sellScore += 65;
      sellSL = Math.max(prev.high, curr.high) * 1.002;
    }

    if (isBearTrap) {
      detectedBuySetup = 'RETAIL_TRAP_REVERSAL';
      result.trappedLevel = swingLow;
      buyScore += 65;
      buySL = Math.min(prev.low, curr.low) * 0.998;
    }

    // =========================================================================
    // 2. 9 / 20 EMA TREND PULLBACK STRATEGY (Stock Burner Signature)
    // =========================================================================
    const isBullEmaPullback = isUptrend && 
                             (prev.low <= currEma9 * 1.002 || prev.low <= currEma20 * 1.002) && 
                             curr.close > curr.open && 
                             curr.close > currEma9;

    const isBearEmaPullback = isDowntrend && 
                             (prev.high >= currEma9 * 0.998 || prev.high >= currEma20 * 0.998) && 
                             curr.close < curr.open && 
                             curr.close < currEma9;

    if (isBullEmaPullback && buyScore < 60) {
      detectedBuySetup = '9_20_EMA_PULLBACK';
      buyScore += 60;
      buySL = Math.min(prev.low, curr.low, currEma20) * 0.998;
    }

    if (isBearEmaPullback && sellScore < 60) {
      detectedSellSetup = '9_20_EMA_PULLBACK';
      sellScore += 60;
      sellSL = Math.max(prev.high, curr.high, currEma20) * 1.002;
    }

    // =========================================================================
    // 3. BIG BAR MOMENTUM EXPANSION STRATEGY
    // =========================================================================
    const avgBody10 = candles.slice(-11, -1).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / 10;
    const currBody = Math.abs(curr.close - curr.open);
    const isBigBar = currBody >= 1.8 * avgBody10 && curr.volume >= 1.25 * avgVolume20;

    if (isBigBar && curr.close > curr.open && (isUptrend || isBearTrap) && buyScore < 55) {
      detectedBuySetup = 'BIG_BAR_MOMENTUM';
      buyScore += 55;
      buySL = curr.low * 0.998;
    }

    if (isBigBar && curr.close < curr.open && (isDowntrend || isBullTrap) && sellScore < 55) {
      detectedSellSetup = 'BIG_BAR_MOMENTUM';
      sellScore += 55;
      sellSL = curr.high * 1.002;
    }

    // =========================================================================
    // 4. 5 EMA ALERT CANDLE SETUP (DETACHED MEAN REVERSION WITH TREND GUARD)
    // =========================================================================
    const isBullDetached = prev.low > prevEma5;
    const is5EmaShortTrigger = isBullDetached && curr.close < prev.low;

    const isBearDetached = prev.high < prevEma5;
    const is5EmaLongTrigger = isBearDetached && curr.close > prev.high;

    if (isBullDetached || isBearDetached) result.isAlertCandle = true;

    if (is5EmaShortTrigger && (isDowntrend || isBullTrap || !isUptrend) && sellScore < 55) {
      detectedSellSetup = '5_EMA_ALERT_REVERSION';
      sellScore += 55;
      sellSL = Math.max(prev.high, curr.high) * 1.0015;
    }

    if (is5EmaLongTrigger && (isUptrend || isBearTrap) && buyScore < 55) {
      detectedBuySetup = '5_EMA_ALERT_REVERSION';
      buyScore += 55;
      buySL = Math.min(prev.low, curr.low) * 0.9985;
    }

    // =========================================================================
    // 5. INSIDE BAR (MOTHER-BABY CANDLE) COMPRESSION & BREAKOUT
    // =========================================================================
    const isInsideBar = prev.high < prevPrev.high && prev.low > prevPrev.low;
    result.isInsideBar = isInsideBar;
    const isInsideBarLongBreakout = isInsideBar && curr.close > prevPrev.high && (isUptrend || isBearTrap);
    const isInsideBarShortBreakdown = isInsideBar && curr.close < prevPrev.low && (isDowntrend || isBullTrap);

    if (isInsideBarLongBreakout && buyScore < 50) {
      detectedBuySetup = 'INSIDE_BAR_BREAKOUT';
      buyScore += 50;
      buySL = prev.low * 0.998;
    }

    if (isInsideBarShortBreakdown && sellScore < 50) {
      detectedSellSetup = 'INSIDE_BAR_BREAKOUT';
      sellScore += 50;
      sellSL = prev.high * 1.002;
    }

    // Volume Confluence Bonus (+15 points)
    if (hasVolumeExpansion) {
      if (buyScore > 0) buyScore += 15;
      if (sellScore > 0) sellScore += 15;
    }

    // Trend Confluence Bonus (+10 points)
    if (isUptrend && buyScore > 0) buyScore += 10;
    if (isDowntrend && sellScore > 0) sellScore += 10;

    // =========================================================================
    // 6. ORDER FLOW & TAKER CVD VETO (Trading with Sidhant Institutional Confirmation)
    // =========================================================================
    if (microData) {
      const cvd = typeof microData.cvd === 'number' ? microData.cvd : 0;
      const takerBuyRatio = typeof microData.takerBuyRatio === 'number' ? microData.takerBuyRatio : 0.50;

      if (buyScore >= 60 && (cvd < -15 || takerBuyRatio < 0.40)) {
        result.reasons.push(`Order Flow Veto: Institutional Dumping (CVD: ${cvd.toFixed(1)}, Taker Buy: ${(takerBuyRatio * 100).toFixed(0)}%). Long blocked.`);
        buyScore = 0;
      }

      if (sellScore >= 60 && (cvd > 15 || takerBuyRatio > 0.60)) {
        result.reasons.push(`Order Flow Veto: Institutional Absorption (CVD: ${cvd.toFixed(1)}, Taker Buy: ${(takerBuyRatio * 100).toFixed(0)}%). Short blocked.`);
        sellScore = 0;
      }
    }

    // Evaluate Winning Verdict
    if (buyScore >= 60 && buyScore > sellScore) {
      result.recommendedSide = 'BUY';
      result.confidenceScore = Math.min(buyScore, 100);
      result.setupType = detectedBuySetup;
      result.reasons.push(`Stock Burner Strategy (Score: ${buyScore}/100)`);
      result.reasons.push(`Setup: ${detectedBuySetup}`);
      if (result.trappedLevel > 0) result.reasons.push(`Retail Sellers Trapped at $${result.trappedLevel.toFixed(4)}`);
      result.reasons.push(`9/20/50 EMA: $${currEma9.toFixed(4)} / $${currEma20.toFixed(4)} / $${currEma50.toFixed(4)}`);

      // Geometrically safe SL strictly below currentPrice with max 1.8% distance cap
      const minBuySL = currentPrice * 0.982; // Max 1.8% SL cap for 25x leverage protection
      const rawBuySL = buySL > 0 ? buySL : currentPrice * 0.985;
      const safeBuySL = Math.max(minBuySL, Math.min(rawBuySL, currentPrice - Math.max(0.8 * atr14, currentPrice * 0.006)));
      result.customSL = parseFloat(safeBuySL.toFixed(6));
      const risk = currentPrice - result.customSL;
      result.customTP = parseFloat((currentPrice + (risk * 2.0)).toFixed(6)); // Strict 1:2 RRR
    } else if (sellScore >= 60 && sellScore > buyScore) {
      result.recommendedSide = 'SELL';
      result.confidenceScore = Math.min(sellScore, 100);
      result.setupType = detectedSellSetup;
      result.reasons.push(`Stock Burner Strategy (Score: ${sellScore}/100)`);
      result.reasons.push(`Setup: ${detectedSellSetup}`);
      if (result.trappedLevel > 0) result.reasons.push(`Retail Buyers Trapped at $${result.trappedLevel.toFixed(4)}`);
      result.reasons.push(`9/20/50 EMA: $${currEma9.toFixed(4)} / $${currEma20.toFixed(4)} / $${currEma50.toFixed(4)}`);

      // Geometrically safe SL strictly above currentPrice with max 1.8% distance cap
      const maxSellSL = currentPrice * 1.018; // Max 1.8% SL cap for 25x leverage protection
      const rawSellSL = sellSL > 0 ? sellSL : currentPrice * 1.015;
      const safeSellSL = Math.min(maxSellSL, Math.max(rawSellSL, currentPrice + Math.max(0.8 * atr14, currentPrice * 0.006)));
      result.customSL = parseFloat(safeSellSL.toFixed(6));
      const risk = result.customSL - currentPrice;
      result.customTP = parseFloat((currentPrice - (risk * 2.0)).toFixed(6)); // Strict 1:2 RRR
    } else {
      result.confidenceScore = Math.max(buyScore, sellScore);
      result.reasons.push(`Waiting for Stock Burner Setup (Buy: ${buyScore}/100, Sell: ${sellScore}/100)`);
    }

    return result;
  }
}

export const stockBurnerTrapEngine = new StockBurnerTrapEngine();
