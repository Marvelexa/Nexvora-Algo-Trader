/**
 * CHARUKA WEERAKKODY WYCKOFF & VSA CRYPTO MASTERCLASS ENGINE (29 LESSONS)
 * Enhanced with "The 70% You're Missing: Order Flow & Delta (CVD)" by Trading with Sidhant
 * 
 * Core Components:
 * 1. Wyckoff 4 Market Phases: Accumulation (Phase C Spring), Markup, Distribution (Phase C UTAD), Markdown
 * 2. Volume Spread Analysis (VSA):
 *    - Spring Liquidity Sweep: Shakeout below support + high volume absorption + close back inside
 *    - UTAD Upthrust Sweep: Bull trap above resistance + high volume distribution + close back inside
 *    - No Supply Bar: 2-Bar volume dry-up at 20 EMA pullback in confirmed Markup (Phase D)
 *    - No Demand Bar: 2-Bar volume dry-up at 20 EMA pullback in confirmed Markdown (Phase D)
 *    - Stopping Volume: Phase A alert only (never an entry trigger without a confirmed Spring or retest)
 * 3. The 70% Missing: Order Flow, Footprint & Cumulative Volume Delta (CVD):
 *    - Blocks BUYs if aggressive sellers are dumping market orders (Negative CVD / Taker Buy < 40%)
 *    - Blocks SELLs if aggressive buyers are hitting the ask (Positive CVD / Taker Buy > 60%)
 * 4. Geometrically Invariant Stop Loss & Strict 1:2 Risk-to-Reward ($5.00 TP, $2.50 SL) at 25x leverage
 */

export interface WyckoffSetupResult {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  marketPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'RANGING';
  vsaSignal: 'SPRING_LIQUIDITY_SWEEP' | 'UTAD_UPTHRUST_SWEEP' | 'NO_SUPPLY_PULLBACK' | 'NO_DEMAND_PULLBACK' | 'NONE';
  dowStructure: 'BULLISH_HH_HL' | 'BEARISH_LH_LL' | 'SIDEWAYS';
  spreadRatio: number;
  rvol: number;
  reasons: string[];
  customTP: number;
  customSL: number;
}

export class CharukaWyckoffCryptoEngine {
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

  public evaluateSetup(symbol: string, candlesOrMtf: any, microData?: any): WyckoffSetupResult {
    const result: WyckoffSetupResult = {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      marketPhase: 'RANGING',
      vsaSignal: 'NONE',
      dowStructure: 'SIDEWAYS',
      spreadRatio: 1.0,
      rvol: 1.0,
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

    if (!candles || candles.length < 50) {
      result.reasons.push('Need at least 50 candles for Wyckoff analysis');
      return result;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const opens = candles.map(c => c.open);
    const volumes = candles.map(c => c.volume);

    const currentPrice = closes[closes.length - 1];
    const curr = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3] || prev;

    const ema20Arr = this.calculateEMA(closes, 20);
    const ema50Arr = this.calculateEMA(closes, 50);
    const currEma20 = ema20Arr[ema20Arr.length - 1] || currentPrice;
    const currEma50 = ema50Arr[ema50Arr.length - 1] || currentPrice;

    // 1. Calculate Average Spread & Volume (last 20 bars)
    const spreads = candles.slice(-21, -1).map(c => c.high - c.low);
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / (spreads.length || 1);
    const currSpread = curr.high - curr.low || 0.0001;
    result.spreadRatio = currSpread / (avgSpread || 0.0001);

    const recentVols = volumes.slice(-21, -1);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
    const currVol = curr.volume;
    const rvol = avgVol > 0 ? currVol / avgVol : 1.0;
    result.rvol = rvol;

    // 2. Dow Theory Higher Highs / Lower Lows Structure
    const recentHighs = highs.slice(-30);
    const recentLows = lows.slice(-30);
    const h1 = Math.max(...recentHighs.slice(0, 15));
    const h2 = Math.max(...recentHighs.slice(15));
    const l1 = Math.min(...recentLows.slice(0, 15));
    const l2 = Math.min(...recentLows.slice(15));

    if (h2 > h1 && l2 > l1) result.dowStructure = 'BULLISH_HH_HL';
    else if (h2 < h1 && l2 < l1) result.dowStructure = 'BEARISH_LH_LL';

    // 3. Liquidity Levels (lookback 25 bars excluding current 2 bars)
    const rangeLows = lows.slice(-27, -2);
    const rangeHighs = highs.slice(-27, -2);
    const supportLevel = Math.min(...rangeLows);
    const resistanceLevel = Math.max(...rangeHighs);
    const rangeSpan = resistanceLevel - supportLevel || 0.0001;

    // Price location within the range (0.0 = at support, 1.0 = at resistance)
    const priceLocationInRange = (currentPrice - supportLevel) / rangeSpan;

    // Calculate ATR(14) for volatility breathing room
    let trSum = 0;
    for (let i = candles.length - 14; i < candles.length; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      trSum += tr;
    }
    const atr14 = trSum / 14 || (currentPrice * 0.01);

    // VSA 1: Spring Liquidity Grab (Accumulation Phase C)
    // Price dips below supportLevel sweeping retail stops, but aggressively recovers and closes back above support
    const isSpring = (curr.low < supportLevel || prev.low < supportLevel) &&
      curr.close > supportLevel &&
      rvol >= 1.20 &&
      curr.close >= curr.open;

    // VSA 2: UTAD Upthrust After Distribution (Distribution Phase C)
    // Price spikes above resistanceLevel trapping breakout buyers, but aggressively reverses and closes back below resistance
    const isUtad = (curr.high > resistanceLevel || prev.high > resistanceLevel) &&
      curr.close < resistanceLevel &&
      rvol >= 1.20 &&
      curr.close <= curr.open;

    // VSA 3: No Supply Pullback (Phase D Markup Strength)
    // 2-Bar Volume Rule: Volume is lower than BOTH preceding bars.
    // Retest context: Price pulled back towards 20 EMA in an uptrend (NOT at top of range).
    const distToEma20Pct = Math.abs(currentPrice - currEma20) / currEma20 * 100;
    const isTwoBarVolDryUp = curr.volume < prev.volume && curr.volume < prev2.volume;
    const isNoSupply = curr.close <= curr.open &&
      isTwoBarVolDryUp &&
      rvol <= 0.80 &&
      result.spreadRatio <= 0.85 &&
      (result.dowStructure === 'BULLISH_HH_HL' || currEma20 > currEma50) &&
      distToEma20Pct <= 1.5 &&
      priceLocationInRange <= 0.75;

    // VSA 4: No Demand Pullback (Phase D Markdown Weakness)
    // 2-Bar Volume Rule: Volume is lower than BOTH preceding bars.
    // Retest context: Price rallied up towards 20 EMA in a downtrend (NOT at bottom of range!).
    const isNoDemand = curr.close >= curr.open &&
      isTwoBarVolDryUp &&
      rvol <= 0.80 &&
      result.spreadRatio <= 0.85 &&
      (result.dowStructure === 'BEARISH_LH_LL' || currEma20 < currEma50) &&
      distToEma20Pct <= 1.5 &&
      priceLocationInRange >= 0.25;

    if (isSpring) result.vsaSignal = 'SPRING_LIQUIDITY_SWEEP';
    else if (isUtad) result.vsaSignal = 'UTAD_UPTHRUST_SWEEP';
    else if (isNoSupply) result.vsaSignal = 'NO_SUPPLY_PULLBACK';
    else if (isNoDemand) result.vsaSignal = 'NO_DEMAND_PULLBACK';

    // Determine Wyckoff Market Phase
    if (isSpring) result.marketPhase = 'ACCUMULATION';
    else if (isUtad) result.marketPhase = 'DISTRIBUTION';
    else if (result.dowStructure === 'BULLISH_HH_HL' && currEma20 > currEma50) result.marketPhase = 'MARKUP';
    else if (result.dowStructure === 'BEARISH_LH_LL' && currEma20 < currEma50) result.marketPhase = 'MARKDOWN';

    // MANDATORY WYCKOFF RULE: No trade without a confirmed Phase C / Phase D VSA Signal!
    // (Stopping volume alone is Phase A warning, NEVER an autonomous blind entry)
    if (result.vsaSignal === 'NONE') {
      result.reasons.push(`Waiting for Wyckoff VSA Signal (Phase: ${result.marketPhase} | Dow: ${result.dowStructure})`);
      return result;
    }

    let buyScore = 0;
    let sellScore = 0;

    // Long Scoring
    if (isSpring) buyScore += 50;
    if (isNoSupply) buyScore += 40;
    if (result.marketPhase === 'MARKUP' || result.marketPhase === 'ACCUMULATION') buyScore += 25;
    if (result.dowStructure === 'BULLISH_HH_HL') buyScore += 20;
    if (currEma20 > currEma50) buyScore += 15;

    // Short Scoring
    if (isUtad) sellScore += 50;
    if (isNoDemand) sellScore += 40;
    if (result.marketPhase === 'MARKDOWN' || result.marketPhase === 'DISTRIBUTION') sellScore += 25;
    if (result.dowStructure === 'BEARISH_LH_LL') sellScore += 20;
    if (currEma20 < currEma50) sellScore += 15;

    // =========================================================================
    // THE 70% MISSING: ORDER FLOW & TAKER CVD CHECK (Trading with Sidhant Rules)
    // Evaluates real-time Taker aggression vs passive limit order absorption
    // =========================================================================
    if (microData) {
      const cvd = typeof microData.cvd === 'number' ? microData.cvd : 0;
      const takerBuyRatio = typeof microData.takerBuyRatio === 'number' ? microData.takerBuyRatio : 0.50;

      // Smart Money Aggressive Dumping Veto:
      if (buyScore >= 70 && (cvd < -15 || takerBuyRatio < 0.40)) {
        result.reasons.push(`Order Flow Veto: Aggressive Institutional Dumping (CVD: ${cvd.toFixed(1)}, Taker Buy: ${(takerBuyRatio * 100).toFixed(0)}%). Long blocked.`);
        buyScore = 0;
      }

      // Smart Money Aggressive Buying Veto:
      if (sellScore >= 70 && (cvd > 15 || takerBuyRatio > 0.60)) {
        result.reasons.push(`Order Flow Veto: Aggressive Institutional Absorption (CVD: ${cvd.toFixed(1)}, Taker Buy: ${(takerBuyRatio * 100).toFixed(0)}%). Short blocked.`);
        sellScore = 0;
      }

      // Order Flow Alignment Boost:
      if (buyScore > 0 && cvd > 5 && takerBuyRatio >= 0.52) {
        buyScore += 10;
        result.reasons.push(`Order Flow Confirmed: Positive Taker Delta (+10)`);
      }
      if (sellScore > 0 && cvd < -5 && takerBuyRatio <= 0.48) {
        sellScore += 10;
        result.reasons.push(`Order Flow Confirmed: Negative Taker Delta (+10)`);
      }
    }

    if (buyScore >= 70 && buyScore > sellScore) {
      result.recommendedSide = 'BUY';
      result.confidenceScore = Math.min(buyScore, 100);
      result.reasons.push(`Wyckoff VSA Bullish Setup (${buyScore}/100)`);
      result.reasons.push(`Signal: ${result.vsaSignal}`);
      result.reasons.push(`Phase: ${result.marketPhase}`);
      result.reasons.push(`Dow: ${result.dowStructure}`);
      result.reasons.push(`RVOL: ${rvol.toFixed(2)}x`);

      // Geometrically Invariant Stop Loss: Strictly BELOW currentPrice with minimum ATR buffer
      const lowestWick = isSpring
        ? Math.min(curr.low, prev.low)
        : Math.min(...lows.slice(-5));
      const invalidationPrice = Math.min(lowestWick * 0.9985, currentPrice - Math.max(1.2 * atr14, currentPrice * 0.01));
      const rawRisk = currentPrice - invalidationPrice;

      result.customSL = parseFloat(invalidationPrice.toFixed(6));
      result.customTP = parseFloat((currentPrice + (rawRisk * 2.30)).toFixed(6)); // Strict 1:2.3 RRR
    } else if (sellScore >= 70 && sellScore > buyScore) {
      result.recommendedSide = 'SELL';
      result.confidenceScore = Math.min(sellScore, 100);
      result.reasons.push(`Wyckoff VSA Bearish Setup (${sellScore}/100)`);
      result.reasons.push(`Signal: ${result.vsaSignal}`);
      result.reasons.push(`Phase: ${result.marketPhase}`);
      result.reasons.push(`Dow: ${result.dowStructure}`);
      result.reasons.push(`RVOL: ${rvol.toFixed(2)}x`);

      // Geometrically Invariant Stop Loss: Strictly ABOVE currentPrice with minimum ATR buffer
      const highestWick = isUtad
        ? Math.max(curr.high, prev.high)
        : Math.max(...highs.slice(-5));
      const invalidationPrice = Math.max(highestWick * 1.0015, currentPrice + Math.max(1.2 * atr14, currentPrice * 0.01));
      const rawRisk = invalidationPrice - currentPrice;

      result.customSL = parseFloat(invalidationPrice.toFixed(6));
      result.customTP = parseFloat((currentPrice - (rawRisk * 2.30)).toFixed(6)); // Strict 1:2.3 RRR
    } else {
      result.confidenceScore = Math.max(buyScore, sellScore);
      result.reasons.push(`Waiting for Wyckoff VSA Confluence (Score: ${result.confidenceScore}/100, needed >= 70)`);
    }

    return result;
  }
}

export const charukaWyckoffEngine = new CharukaWyckoffCryptoEngine();
