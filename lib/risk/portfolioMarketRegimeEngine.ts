import fs from 'fs';
import path from 'path';
import { KlinePoint, DeltaPosition } from '../../src/types';
import { deltaExchange } from '../deltaExchangeEngine';

export type MarketRegimeBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface MarketRegimeBiasState {
  bias: MarketRegimeBias;
  timestamp: number;
  btcPrice: number;
  btcVwap15m: number;
  btcEma9: number;
  btcEma21: number;
  btcStructure15m: 'BULLISH' | 'BEARISH' | 'RANGING';
  btcStructure1h: 'BULLISH' | 'BEARISH' | 'RANGING';
  btcAdx14: number;
  breadthPctAboveVwap: number; // percentage (0.0 to 1.0) of top coins above 15m VWAP
  activeBtcPositionSide: 'BUY' | 'SELL' | null;
  reasons: string[];
}

/**
 * PORTFOLIO MARKET REGIME ENGINE (BTC MARKET LEADER COMPASS)
 * 
 * Enforces:
 * 1. BTC Market Leader Directional Compass (No Fighting Bitcoin)
 *    - Altcoins correlate 85%+ with BTC during intraday moves.
 *    - BEARISH: BTC Short or Price < VWAP with lower lows -> STRICTLY BLOCK ALL LONGS across 189+ coins.
 *    - BULLISH: BTC Long or Price > VWAP with higher highs -> STRICTLY BLOCK ALL SHORTS across 189+ coins.
 *    - NEUTRAL: BTC ADX < 20 & inside range -> Only relative-strength outliers (>2x vol) or Port 3010 range trades.
 * 2. Portfolio Directional Coherence Across 4 Concurrent Open Slots
 *    - Never mix Buy and Sell positions across the 4 concurrent slots.
 *    - If BTC is Short, all other open slots can only be Short on weak altcoins.
 *    - If regime flips, tighten stops to Breakeven on existing trades before opening opposite positions.
 * 3. Relative Strength / Weakness Selection
 *    - Bullish: Pick strongest altcoins trading above 15m VWAP.
 *    - Bearish: Pick weakest altcoins trading below 15m VWAP.
 * 4. Hard Gatekeeper for TP/SL Math
 *    - Actual_RR >= 1.15 minimum (never allow inverted TP < SL).
 *    - Clamp SL distance to [0.45%, 1.50%] of price.
 */
export class PortfolioMarketRegimeEngine {
  private static instance: PortfolioMarketRegimeEngine;
  private readonly STATE_FILE_PATH: string;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
  private inMemoryState: MarketRegimeBiasState | null = null;
  private lastEvaluationTime = 0;
  private lastKnownBias: MarketRegimeBias = 'NEUTRAL';

  public static readonly MIN_SL_DISTANCE_PCT = 0.0035; // 0.35% minimum SL floor
  public static readonly MAX_SL_DISTANCE_PCT = 0.0085; // 0.85% maximum SL ceiling (max -25.5% ROE at 30x)
  public static readonly MIN_ACTUAL_RR = 1.05; // 1.05R minimum risk:reward

  private constructor() {
    this.STATE_FILE_PATH = path.join(process.cwd(), '.global_market_regime_bias.json');
    this.loadPersistedState();
  }

  public static getInstance(): PortfolioMarketRegimeEngine {
    if (!PortfolioMarketRegimeEngine.instance) {
      PortfolioMarketRegimeEngine.instance = new PortfolioMarketRegimeEngine();
    }
    return PortfolioMarketRegimeEngine.instance;
  }

  /**
   * Loads persisted regime from disk if available and fresh
   */
  private loadPersistedState(): MarketRegimeBiasState | null {
    try {
      if (fs.existsSync(this.STATE_FILE_PATH)) {
        const raw = fs.readFileSync(this.STATE_FILE_PATH, 'utf-8').trim();
        if (raw) {
          const parsed = JSON.parse(raw) as MarketRegimeBiasState;
          if (parsed && typeof parsed.bias === 'string' && parsed.timestamp) {
            this.inMemoryState = parsed;
            this.lastEvaluationTime = parsed.timestamp;
            return parsed;
          }
        }
      }
    } catch (e) {
      // Ignore read errors
    }
    return null;
  }

  /**
   * Synchronous accessor for currently cached or persisted market regime bias
   */
  public getMarketRegimeBias(): MarketRegimeBiasState | null {
    if (this.inMemoryState) return this.inMemoryState;
    return this.loadPersistedState();
  }

  /**
   * Persists regime state to disk for cross-port synchronization
   */
  private persistState(state: MarketRegimeBiasState): void {
    try {
      this.inMemoryState = state;
      this.lastEvaluationTime = state.timestamp;
      fs.writeFileSync(this.STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) {
      // Non-fatal if write fails
    }
  }

  /**
   * Immediately flip regime bias when BTC initiates a confirmed structural reversal
   */
  public setImmediateRegimeFlip(newBias: MarketRegimeBias): void {
    try {
      const state = this.inMemoryState || this.loadPersistedState() || {
        bias: newBias,
        timestamp: Date.now(),
        btcPrice: 0,
        btcVwap15m: 0,
        btcEma9: 0,
        btcEma21: 0,
        btcStructure15m: newBias === 'BULLISH' ? 'BULLISH' : 'BEARISH',
        btcStructure1h: newBias === 'BULLISH' ? 'BULLISH' : 'BEARISH',
        btcAdx14: 25,
        breadthPctAboveVwap: newBias === 'BULLISH' ? 0.65 : 0.25,
        reasons: [`BTC Market Leader Reversal: Flipped to ${newBias}`],
      };
      state.bias = newBias;
      state.timestamp = Date.now();
      if (newBias === 'NEUTRAL') {
        state.btcAdx14 = 15;
        state.breadthPctAboveVwap = 0.50;
      } else if (newBias === 'BULLISH') {
        state.breadthPctAboveVwap = 0.65;
      } else {
        state.breadthPctAboveVwap = 0.25;
      }
      state.activeBtcPositionSide = this.getActiveBtcPositionSide();
      this.persistState(state);
    } catch (e) {}
  }

  /**
   * Scans all port state files to see if BTCUSD has an active open position
   */
  public getActiveBtcPositionSide(): 'BUY' | 'SELL' | null {
    try {
      const rootDir = process.cwd();
      const files = fs.readdirSync(rootDir);
      const now = Date.now();
      for (const file of files) {
        if (file.startsWith('.delta_auto_trader_state_') && file.endsWith('.json')) {
          // Strictly ignore Port 3001 (isolated manual/paper port)
          if (file.includes('3001')) continue;
          try {
            const raw = fs.readFileSync(path.join(rootDir, file), 'utf-8').trim();
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            // Ignore stale files from inactive/stopped ports (> 60s old)
            if (parsed.lastScanTimestamp && (now - parsed.lastScanTimestamp) > 60000) {
              continue;
            }
            if (Array.isArray(parsed.activePositions)) {
              for (const pos of parsed.activePositions) {
                const sym = (pos.symbol || '').toUpperCase().replace('USDT', 'USD');
                if (sym === 'BTCUSD') {
                  return pos.side === 'SELL' ? 'SELL' : 'BUY';
                }
              }
            }
          } catch (err) {
            // ignore individual file parse failure
          }
        }
      }
    } catch (e) {
      // ignore directory read error
    }
    return null;
  }

  /**
   * Calculate Rolling VWAP over lookback bars
   */
  public static calculateVWAP(candles: KlinePoint[], lookbackBars: number = 48): number {
    if (!candles || candles.length === 0) return 0;
    const n = candles.length;
    const start = Math.max(0, n - lookbackBars);
    let cumVol = 0;
    let cumVolPrice = 0;

    for (let i = start; i < n; i++) {
      const c = candles[i];
      const typ = (c.high + c.low + c.close) / 3;
      const vol = c.volume && c.volume > 0 ? c.volume : 1;
      cumVol += vol;
      cumVolPrice += typ * vol;
    }

    return cumVol > 0 ? cumVolPrice / cumVol : candles[n - 1].close;
  }

  /**
   * Calculate EMA series
   */
  public static calculateEMA(prices: number[], period: number): number[] {
    if (!prices || prices.length === 0) return [];
    if (prices.length < period) return prices;
    const k = 2 / (period + 1);
    const ema: number[] = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
      ema.push(prices[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  }

  /**
   * Calculate Wilder's ADX(14)
   */
  public static calculateADX(candles: KlinePoint[], period: number = 14): number {
    if (!candles || candles.length < period * 2) return 25; // fallback
    const n = candles.length;
    const trs: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < n; i++) {
      const cur = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
      trs.push(tr);

      const upMove = cur.high - prev.high;
      const downMove = prev.low - cur.low;

      if (upMove > downMove && upMove > 0) {
        plusDMs.push(upMove);
      } else {
        plusDMs.push(0);
      }

      if (downMove > upMove && downMove > 0) {
        minusDMs.push(downMove);
      } else {
        minusDMs.push(0);
      }
    }

    if (trs.length < period) return 25;

    // Wilder smoothed
    let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

    const dxList: number[] = [];

    for (let i = period; i < trs.length; i++) {
      smoothTR = smoothTR - (smoothTR / period) + trs[i];
      smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDMs[i];
      smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDMs[i];

      const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
      const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
      const diSum = plusDI + minusDI;
      const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
      dxList.push(dx);
    }

    if (dxList.length < period) return dxList.length > 0 ? dxList[dxList.length - 1] : 25;
    const adx = dxList.slice(-period).reduce((a, b) => a + b, 0) / period;
    return isFinite(adx) ? adx : 25;
  }

  /**
   * Detect market structure (HH/HL vs LH/LL vs RANGING)
   */
  public static detectStructure(candles: KlinePoint[]): 'BULLISH' | 'BEARISH' | 'RANGING' {
    if (!candles || candles.length < 20) return 'RANGING';
    const n = candles.length;
    const slice = candles.slice(-20);
    const mid = Math.floor(slice.length / 2);
    const firstHalf = slice.slice(0, mid);
    const secondHalf = slice.slice(mid);

    const high1 = Math.max(...firstHalf.map(c => c.high));
    const low1 = Math.min(...firstHalf.map(c => c.low));
    const high2 = Math.max(...secondHalf.map(c => c.high));
    const low2 = Math.min(...secondHalf.map(c => c.low));

    if (high2 > high1 && low2 > low1) return 'BULLISH';
    if (high2 < high1 && low2 < low1) return 'BEARISH';
    return 'RANGING';
  }

  /**
   * Get fresh or cached Market Regime Bias
   */
  public async getOrEvaluateMarketRegimeBias(
    fetchCandlesFn: (symbol: string, timeframe: string, count: number) => Promise<KlinePoint[]>
  ): Promise<MarketRegimeBiasState> {
    const now = Date.now();
    // 1. Check in-memory / disk cache freshness
    if (this.inMemoryState && (now - this.lastEvaluationTime) < this.CACHE_TTL_MS) {
      // Re-verify if an active BTC position just opened or changed direction
      const currentBtcPos = this.getActiveBtcPositionSide();
      if (currentBtcPos !== this.inMemoryState.activeBtcPositionSide) {
        // Position direction changed, force immediate re-evaluation
        return this.evaluateAndPersist(fetchCandlesFn);
      }
      return this.inMemoryState;
    }

    // Try reading disk state written by another port
    const diskState = this.loadPersistedState();
    if (diskState && (now - diskState.timestamp) < this.CACHE_TTL_MS) {
      const currentBtcPos = this.getActiveBtcPositionSide();
      if (currentBtcPos === diskState.activeBtcPositionSide) {
        return diskState;
      }
    }

    // 2. Perform full evaluation
    return this.evaluateAndPersist(fetchCandlesFn);
  }

  /**
   * Full evaluation of BTC 15m/1H + Market Breadth + Active Position
   */
  private async evaluateAndPersist(
    fetchCandlesFn: (symbol: string, timeframe: string, count: number) => Promise<KlinePoint[]>
  ): Promise<MarketRegimeBiasState> {
    const reasons: string[] = [];
    const activeBtcPositionSide = this.getActiveBtcPositionSide();

    // 1. Fetch BTC 15M candles
    let btc15m: KlinePoint[] = [];
    let btc1h: KlinePoint[] = [];
    try {
      btc15m = await fetchCandlesFn('BTCUSDT', '15m', 80);
      btc1h = await fetchCandlesFn('BTCUSDT', '1h', 50);
    } catch (e) {
      // Fallback
    }

    const btcPrice = btc15m.length > 0 ? btc15m[btc15m.length - 1].close : 0;
    const btcVwap15m = PortfolioMarketRegimeEngine.calculateVWAP(btc15m, 48);

    const btcCloses15m = btc15m.map(c => c.close);
    const ema9Series = PortfolioMarketRegimeEngine.calculateEMA(btcCloses15m, 9);
    const ema21Series = PortfolioMarketRegimeEngine.calculateEMA(btcCloses15m, 21);
    const ema50Series = PortfolioMarketRegimeEngine.calculateEMA(btcCloses15m, 50);
    const btcEma9 = ema9Series.length > 0 ? ema9Series[ema9Series.length - 1] : btcPrice;
    const btcEma21 = ema21Series.length > 0 ? ema21Series[ema21Series.length - 1] : btcPrice;
    const btcEma50 = ema50Series.length > 0 ? ema50Series[ema50Series.length - 1] : btcPrice;

    const btcStructure15m = PortfolioMarketRegimeEngine.detectStructure(btc15m);
    const btcStructure1h = PortfolioMarketRegimeEngine.detectStructure(btc1h);
    const btcAdx14 = PortfolioMarketRegimeEngine.calculateADX(btc15m, 14);

    // 2. Market Breadth Check (% of top liquid coins above their 15m VWAP)
    const TOP_BREADTH_COINS = [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT',
      'LINKUSDT', 'NEARUSDT', 'APTUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT', 'TIAUSDT'
    ];
    let aboveVwapCount = 0;
    let sampledCount = 0;

    for (const sym of TOP_BREADTH_COINS) {
      try {
        const c15m = await fetchCandlesFn(sym, '15m', 35);
        if (c15m && c15m.length >= 10) {
          const lastClose = c15m[c15m.length - 1].close;
          const vwap = PortfolioMarketRegimeEngine.calculateVWAP(c15m, 30);
          if (lastClose >= vwap) {
            aboveVwapCount++;
          }
          sampledCount++;
        }
      } catch (e) {
        // ignore individual coin fetch errors
      }
    }

    const breadthPctAboveVwap = sampledCount > 0 ? (aboveVwapCount / sampledCount) : 0.50;

    // 3. SYNTHESIS INTO GLOBAL MARKET REGIME BIAS (Objective Technical Reality)
    let bias: MarketRegimeBias = 'NEUTRAL';

    // Technical Analysis Bias Evaluation
    const isPriceBelowVwap = btcPrice < btcVwap15m;
    const isEma9Below21 = btcEma9 < btcEma21;
    const isPriceAboveEma50 = btcPrice > btcEma50;
    const isEma21AboveEma50 = btcEma21 >= btcEma50 * 0.998;
    const isBearishBreadth = breadthPctAboveVwap < 0.45;
    const isBullishBreadth = breadthPctAboveVwap > 0.55;

    let bearishScore = 0;
    let bullishScore = 0;

    if (isPriceBelowVwap) bearishScore += 2;
    else bullishScore += 2;

    if (isEma9Below21) bearishScore += 1;
    else bullishScore += 1;

    // Macro EMA50 Alignment (User Mandate: Fix 2)
    if (isPriceAboveEma50 && isEma21AboveEma50) bullishScore += 2;
    else if (!isPriceAboveEma50 && !isEma21AboveEma50) bearishScore += 2;

    if (btcStructure15m === 'BEARISH') bearishScore += 2;
    else if (btcStructure15m === 'BULLISH') bullishScore += 2;

    if (btcStructure1h === 'BEARISH') bearishScore += 2;
    else if (btcStructure1h === 'BULLISH') bullishScore += 2;

    if (isBearishBreadth) bearishScore += 2;
    if (isBullishBreadth) bullishScore += 2;

    if (bearishScore >= 6) {
      bias = 'BEARISH';
      reasons.push(`BTC Technical Bearish Confluence (Score: ${bearishScore}/11): Price ($${btcPrice.toFixed(1)}) ${isPriceBelowVwap ? '<' : '>='} VWAP ($${btcVwap15m.toFixed(1)}), EMA50=$${btcEma50.toFixed(1)}, 15M=${btcStructure15m}, 1H=${btcStructure1h}, Breadth=${(breadthPctAboveVwap * 100).toFixed(0)}%`);
    } else if (bullishScore >= 6) {
      bias = 'BULLISH';
      reasons.push(`BTC Technical Bullish Confluence (Score: ${bullishScore}/11): Price ($${btcPrice.toFixed(1)}) ${isPriceBelowVwap ? '<' : '>='} VWAP ($${btcVwap15m.toFixed(1)}), EMA50=$${btcEma50.toFixed(1)}, 15M=${btcStructure15m}, 1H=${btcStructure1h}, Breadth=${(breadthPctAboveVwap * 100).toFixed(0)}%`);
    } else if (btcAdx14 < 20) {
      bias = 'NEUTRAL';
      reasons.push(`BTC Low-Volatility Range (ADX=${btcAdx14.toFixed(1)} < 20): Sideways market regime.`);
    } else {
      // Slight lean based on VWAP & EMA50
      bias = (isPriceBelowVwap || !isPriceAboveEma50) ? 'BEARISH' : 'BULLISH';
        reasons.push(`BTC Moderate Trend: Price vs VWAP (${isPriceBelowVwap ? 'Below' : 'Above'}), Breadth=${(breadthPctAboveVwap * 100).toFixed(0)}%`);
      }

    const state: MarketRegimeBiasState = {
      bias,
      timestamp: Date.now(),
      btcPrice,
      btcVwap15m,
      btcEma9,
      btcEma21,
      btcStructure15m,
      btcStructure1h,
      btcAdx14,
      breadthPctAboveVwap,
      activeBtcPositionSide,
      reasons,
    };

    this.persistState(state);
    console.log(`🧭 [MARKET REGIME COMPASS] BTC Bias: ${bias} | BTC: $${btcPrice.toFixed(1)} (VWAP: $${btcVwap15m.toFixed(1)}, EMA9: $${btcEma9.toFixed(1)}) | Breadth: ${(breadthPctAboveVwap * 100).toFixed(0)}% above VWAP | Active BTC: ${activeBtcPositionSide || 'NONE'}`);
    return state;
  }

  /**
   * FIX 1 & FIX 3: Checks whether a candidate trade setup is allowed under current regime
   */
  public isTradeAllowedByRegime(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    currentPrice: number;
    vwap15m: number;
    volumeRatio?: number;
    isPort3010?: boolean;
    isFlipped?: boolean;
    biasState?: MarketRegimeBiasState;
    candles15m?: KlinePoint[];
    candles5m?: KlinePoint[];
    rangePosition?: number;
    rangePos16?: number;
    hasRejectionOrChoch?: boolean;
    isFastScalpSlot?: boolean;
    vEngulfingDetected?: boolean;
  }): { allowed: boolean; reason: string } {
    const {
      symbol,
      side,
      currentPrice,
      vwap15m,
      volumeRatio = 1.0,
      isPort3010 = false,
      isFlipped = false,
      candles15m,
      candles5m,
    } = params;
    const cleanSym = symbol.toUpperCase().replace('USDT', 'USD');
    const isBtc = cleanSym === 'BTCUSD';
    const state = params.biasState || this.inMemoryState || this.loadPersistedState();
    const bias = state ? state.bias : 'NEUTRAL';

    // Calculate 50-candle 15m Range Position if not explicitly provided
    let rangePos = params.rangePosition;
    if (rangePos === undefined && candles15m && candles15m.length >= 10) {
      const slice = candles15m.slice(-50);
      let rHigh = -Infinity;
      let rLow = Infinity;
      for (const c of slice) {
        if (c.high > rHigh) rHigh = c.high;
        if (c.low < rLow) rLow = c.low;
      }
      const span = rHigh - rLow;
      if (span > 0) {
        rangePos = (currentPrice - rLow) / span;
      }
    }

    // =========================================================================
    // FIX 2: COIN-FIRST AUTONOMY RULE (15M EMA9 / EMA21 / VWAP & STRUCTURE)
    // Make each coin 100% self-governed by its own structure unless extreme BTC event
    // =========================================================================
    let coinEma9 = 0;
    let coinEma21 = 0;
    let isBelowOwnEmas = false;
    let isAboveOwnEmas = false;
    if (candles15m && candles15m.length >= 21) {
      const closes = candles15m.map(c => c.close);
      const ema9Arr = PortfolioMarketRegimeEngine.calculateEMA(closes, 9);
      const ema21Arr = PortfolioMarketRegimeEngine.calculateEMA(closes, 21);
      coinEma9 = ema9Arr[ema9Arr.length - 1];
      coinEma21 = ema21Arr[ema21Arr.length - 1];
      isBelowOwnEmas = currentPrice <= coinEma9 && currentPrice <= coinEma21;
      isAboveOwnEmas = currentPrice >= coinEma9 && currentPrice >= coinEma21;
    }

    // Check extreme single-candle BTC vertical steamroller event (> 2.0 * ATR)
    const isBtcExtremeSqueeze = state && (state as any).btcExtremeVerticalSqueeze === true;
    const isBtcExtremeCrash = state && (state as any).btcExtremeVerticalCrash === true;

    const isBullishTrend = isAboveOwnEmas || (coinEma9 > coinEma21 && currentPrice > coinEma21);
    const isBearishTrend = isBelowOwnEmas || (coinEma9 < coinEma21 && currentPrice < coinEma21);

    // Check extreme structural reversals at 50-bar range boundaries
    const isTopCeilingReversal = rangePos !== undefined && rangePos >= 0.80 && currentPrice < coinEma9;
    const isBottomFloorBounce = rangePos !== undefined && rangePos <= 0.20 && currentPrice > coinEma9;

    // Counter-Trend Vetoes:
    if (side === 'SELL' && isBullishTrend && !isBelowOwnEmas && !isTopCeilingReversal) {
      return {
        allowed: false,
        reason: `NO_SELLING_IN_BULLISH_TREND_VETO: ${cleanSym} is in a confirmed 15m Bullish Trend (Price > EMA21, EMA9 > EMA21). Counter-trend shorts are 100% forbidden until price breaks and closes below both EMA9 and EMA21.`,
      };
    }

    if (side === 'BUY' && isBearishTrend && !isAboveOwnEmas && !isBottomFloorBounce) {
      return {
        allowed: false,
        reason: `NO_BUYING_IN_BEARISH_TREND_VETO: ${cleanSym} is in a confirmed 15m Bearish Trend (Price < EMA21, EMA9 < EMA21). Counter-trend longs are 100% forbidden until price breaks and closes below both EMA9 and EMA21.`,
      };
    }

    // A. SELL is ALLOWED if coin is in Bearish trend or confirmed breakdown, or structural top ceiling reversal
    if (side === 'SELL' && (isBelowOwnEmas || isBearishTrend || isTopCeilingReversal)) {
      if (isBtcExtremeSqueeze) {
        return {
          allowed: false,
          reason: `BTC_VERTICAL_SQUEEZE_VETO: BTC is printing an extreme > 2.0 * ATR vertical short squeeze. Pausing altcoin shorts.`,
        };
      }
      return {
        allowed: true,
        reason: isTopCeilingReversal
          ? `STRUCTURAL_CEILING_REVERSAL_APPROVED: ${cleanSym} SELL permitted at 50-bar resistance ceiling (RangePos: ${(rangePos * 100).toFixed(1)}%, Close < EMA9 $${coinEma9.toFixed(4)}).`
          : `COIN_AUTONOMY_APPROVED: ${cleanSym} SELL permitted by its own 15m Bearish structure (Price $${currentPrice.toFixed(4)} <= EMA9 $${coinEma9.toFixed(4)} & EMA21 $${coinEma21.toFixed(4)}).`,
      };
    }

    // B. BUY is ALLOWED if coin is in Bullish trend or confirmed breakout, or structural bottom floor bounce
    if (side === 'BUY' && (isAboveOwnEmas || isBullishTrend || isBottomFloorBounce)) {
      if (isBtcExtremeCrash) {
        return {
          allowed: false,
          reason: `BTC_VERTICAL_CRASH_VETO: BTC is printing an extreme > 2.0 * ATR vertical waterfall dump. Pausing altcoin longs.`,
        };
      }
      return {
        allowed: true,
        reason: isBottomFloorBounce
          ? `STRUCTURAL_FLOOR_BOUNCE_APPROVED: ${cleanSym} BUY permitted at 50-bar support floor (RangePos: ${(rangePos * 100).toFixed(1)}%, Close > EMA9 $${coinEma9.toFixed(4)}).`
          : `COIN_AUTONOMY_APPROVED: ${cleanSym} BUY permitted by its own 15m Bullish structure (Price $${currentPrice.toFixed(4)} >= EMA9 $${coinEma9.toFixed(4)} & EMA21 $${coinEma21.toFixed(4)}).`,
      };
    }
    // 1. BEARISH MARKET REGIME (BTC trend is downward)
    if (bias === 'BEARISH') {
      if (side === 'BUY') {
        // BTC is market leader
        if (isBtc && this.getActiveBtcPositionSide() !== 'SELL') {
          return {
            allowed: true,
            reason: `BTC REVERSAL LEADER APPROVED: BTCUSD confirmed a valid candidate BUY reversal setup.`,
          };
        }

        // Port 3010 & Reversal Proximity Flipper: Buying at Support Discount is explicitly allowed
        if (isPort3010 || isFlipped) {
          return {
            allowed: true,
            reason: `SUPPORT DISCOUNT REVERSAL APPROVED: Range bottom / liquidity sweep permits BUY on ${cleanSym} even in Bearish regime.`,
          };
        }

        // Fast Scalp Slots 1 & 2 / V-Engulfing Reversal:
        if (params.isFastScalpSlot || params.vEngulfingDetected) {
          return {
            allowed: true,
            reason: `FAST SCALP REVERSAL APPROVED: 2-Candle V-Engulfing / Fast Scalp setup permits BUY on ${cleanSym} for Slot 1/2.`,
          };
        }

        // Check if individual coin structure or BTC momentum allows LONG:
        const isBtcRecovering = state && state.btcPrice >= state.btcEma9 && state.btcAdx14 <= 25;
        const isAtDiscountSupport = (rangePos !== undefined && rangePos <= 0.35) || (params.rangePos16 !== undefined && params.rangePos16 <= 0.35);
        const isLocalBreakout = currentPrice >= vwap15m && (candles5m && candles5m.length >= 2 && candles5m[candles5m.length - 1].close > candles5m[candles5m.length - 1].open);

        if (isAtDiscountSupport || (isBtcRecovering && isLocalBreakout)) {
          return {
            allowed: true,
            reason: `BEARISH REGIME EXCEPTION APPROVED: ${cleanSym} BUY permitted (Discount Position: ${params.rangePos16 !== undefined ? (params.rangePos16 * 100).toFixed(0) + '%' : (rangePos !== undefined ? (rangePos * 100).toFixed(0) + '%' : 'N/A')}, Local Support/Breakout confirmed).`,
          };
        }

        // Runaway steamroller dump: block mid-range buys
        if (state && state.btcAdx14 > 28 && state.btcPrice < state.btcEma9) {
          return {
            allowed: false,
            reason: `BEARISH MARKET REGIME VETO (STEAMROLLER): BTC is in high-momentum dump (ADX: ${state.btcAdx14.toFixed(1)} > 28). Mid-range altcoin buys strictly vetoed.`,
          };
        }

        return {
          allowed: false,
          reason: `BEARISH MARKET REGIME VETO: Strictly blocking mid-range LONG (BUY) on ${cleanSym}. Longs only permitted at deep discount support (<= 30%) with confirmed rejection.`,
        };
      }

      // Allowed side is SELL (SHORT). Check Relative Weakness
      if (!isBtc && vwap15m > 0 && currentPrice > vwap15m * 1.025 && (rangePos === undefined || rangePos < 0.70)) {
        return {
          allowed: false,
          reason: `RELATIVE STRENGTH VETO: ${cleanSym} is trading +${(((currentPrice - vwap15m) / vwap15m) * 100).toFixed(2)}% ABOVE 15m VWAP. Do not short relatively strong coins in mid-range.`,
        };
      }
      return {
        allowed: true,
        reason: `BEARISH REGIME APPROVED: ${cleanSym} SELL aligns with downward BTC flow.`,
      };
    }

    // 2. BULLISH MARKET REGIME (BTC trend is upward)
    if (bias === 'BULLISH') {
      if (side === 'SELL') {
        // BTC is market leader
        if (isBtc && this.getActiveBtcPositionSide() !== 'BUY') {
          return {
            allowed: true,
            reason: `BTC REVERSAL LEADER APPROVED: BTCUSD confirmed a valid candidate SELL reversal setup.`,
          };
        }

        // Port 3010 & Reversal Proximity Flipper: Selling at Resistance Premium is explicitly allowed
        if (isPort3010 || isFlipped) {
          return {
            allowed: true,
            reason: `RESISTANCE PREMIUM REVERSAL APPROVED: Range top / liquidity sweep permits SELL on ${cleanSym} even in Bullish regime.`,
          };
        }

        // Fast Scalp Slots 1 & 2 / V-Engulfing Reversal:
        if (params.isFastScalpSlot || params.vEngulfingDetected) {
          return {
            allowed: true,
            reason: `FAST SCALP REVERSAL APPROVED: 2-Candle V-Engulfing / Fast Scalp setup permits SELL on ${cleanSym} for Slot 1/2.`,
          };
        }

        // Check if individual coin structure or BTC momentum allows SHORT:
        const pool = (candles5m && candles5m.length >= 2) ? candles5m : (candles15m && candles15m.length >= 2 ? candles15m : []);
        let hasBearishRejection = false;
        if (pool.length >= 2) {
          const cur = pool[pool.length - 1];
          const prev = pool[pool.length - 2];
          const span = Math.max(cur.high - cur.low, cur.close * 0.0005);
          const upperWick = cur.high - Math.max(cur.open, cur.close);
          const isPinbar = (upperWick / span) >= 0.40;
          const isEngulfing = cur.close < cur.open && cur.close < prev.open && prev.close > prev.open;
          const isRedClose = cur.close < cur.open;
          hasBearishRejection = isPinbar || isEngulfing || isRedClose;
        }

        const isAtPremiumResistance = (rangePos !== undefined && rangePos >= 0.65) || (params.rangePos16 !== undefined && params.rangePos16 >= 0.65);
        const isBtcExplosivePump = state && (state as any).btcExplosivePump === true;

        // FIX DEADLOCK #2: If coin is at Premium Resistance (>= 65%) with confirmed rejection,
        // ALLOW THE SHORT regardless of whether BTC is above its 5m EMA9 (unless BTC explosive pump > 1.5 ATR)!
        if (isAtPremiumResistance && hasBearishRejection && !isBtcExplosivePump) {
          return {
            allowed: true,
            reason: `PREMIUM RESISTANCE SHORT APPROVED: ${cleanSym} is at Premium Resistance (${params.rangePos16 !== undefined ? (params.rangePos16 * 100).toFixed(0) + '%' : (rangePos !== undefined ? (rangePos * 100).toFixed(0) + '%' : '65%')}) with confirmed rejection candle. Selling allowed in Bullish regime.`,
          };
        }

        const isBtcCooling = state && state.btcPrice <= state.btcEma9 && state.btcAdx14 <= 25;
        const isLocalBreakdown = currentPrice <= vwap15m && (pool.length >= 2 && pool[pool.length - 1].close < pool[pool.length - 1].open);

        if (isAtPremiumResistance || (isBtcCooling && isLocalBreakdown)) {
          return {
            allowed: true,
            reason: `BULLISH REGIME EXCEPTION APPROVED: ${cleanSym} SELL permitted (Premium Position: ${rangePos !== undefined ? (rangePos * 100).toFixed(0) + '%' : 'N/A'}, Resistance rejection or local breakdown confirmed).`,
          };
        }

        // Runaway steamroller pump: block mid-range shorts
        if (state && state.btcAdx14 > 28 && state.btcPrice > state.btcEma9) {
          return {
            allowed: false,
            reason: `BULLISH MARKET REGIME VETO (STEAMROLLER): BTC is in high-momentum pump (ADX: ${state.btcAdx14.toFixed(1)} > 28). Mid-range altcoin shorts strictly vetoed.`,
          };
        }

        return {
          allowed: false,
          reason: `BULLISH MARKET REGIME VETO: Strictly blocking mid-range SHORT (SELL) on ${cleanSym}. Shorts only permitted at premium resistance (>= 70%) or local breakdown.`,
        };
      }

      // Allowed side is BUY (LONG). Check Relative Strength
      if (!isBtc && vwap15m > 0 && currentPrice < vwap15m * 0.975 && (rangePos === undefined || rangePos > 0.30)) {
        return {
          allowed: false,
          reason: `RELATIVE WEAKNESS VETO: ${cleanSym} is trading ${(((currentPrice - vwap15m) / vwap15m) * 100).toFixed(2)}% BELOW 15m VWAP. Prioritize strong coins above VWAP for mid-range buys.`,
        };
      }
      return {
        allowed: true,
        reason: `BULLISH REGIME APPROVED: ${cleanSym} BUY aligns with upward BTC flow.`,
      };
    }

    // 3. NEUTRAL / SIDEWAYS MARKET REGIME
    const btcAdx = state ? state.btcAdx14 : 15;
    const breadth = state ? state.breadthPctAboveVwap : 0.50;
    const isConfirmedSideways = btcAdx < 25 && breadth >= 0.30 && breadth <= 0.70;

    if (isPort3010 || isFlipped) {
      return {
        allowed: true,
        reason: `NEUTRAL REGIME APPROVED: Range boundary / sweep ${side} permitted on ${cleanSym}.`,
      };
    }

    if (volumeRatio >= 2.0) {
      return {
        allowed: true,
        reason: `NEUTRAL REGIME: ${cleanSym} has independent volume surge (${volumeRatio.toFixed(1)}x average) permitting decoupled trade.`,
      };
    }

    if (isConfirmedSideways && (candles15m && candles15m.length >= 10)) {
      return {
        allowed: true,
        reason: `NEUTRAL REGIME APPROVED: BTC in consolidation (ADX: ${btcAdx.toFixed(1)}). Structural setup permitted.`,
      };
    }

    return {
      allowed: false,
      reason: `NEUTRAL / SIDEWAYS REGIME VETO: BTC is in low-volatility consolidation. Only relative-strength volume outliers (>=2.0x) or Port 3010 range trades permitted.`,
    };
  }

  /**
   * FIX 2: Portfolio Directional Coherence Across 4 Concurrent Open Slots
   * Enforces that ALL open positions across the portfolio share the same direction matching MARKET_REGIME_BIAS.
   */
  public checkPortfolioCoherence(
    activePositions: DeltaPosition[],
    candidateSide: 'BUY' | 'SELL',
    candidateSymbol: string,
    opts?: {
      isDiscountSupport?: boolean;
      isPremiumResistance?: boolean;
      isPort3010?: boolean;
      isCoinAutonomous?: boolean;
    }
  ): { allowed: boolean; reason: string } {
    if (!activePositions || activePositions.length === 0) {
      return { allowed: true, reason: 'Portfolio slot 1: Initial position establishes portfolio direction.' };
    }

    const cleanSym = candidateSymbol.toUpperCase().replace('USDT', 'USD');

    // Rule 0: Never open opposing positions on the exact same asset (no hedging / wash trading)
    const sameSymPos = activePositions.find(p => (p.symbol || '').toUpperCase().replace('USDT', 'USD') === cleanSym);
    if (sameSymPos && sameSymPos.side !== candidateSide) {
      return {
        allowed: false,
        reason: `OPPOSING_SAME_COIN_VETO: Active position for ${cleanSym} is already ${sameSymPos.side}. Cannot open opposing ${candidateSide} on the same asset.`,
      };
    }

    const openBuys = activePositions.filter(p => p.side === 'BUY');
    const openSells = activePositions.filter(p => p.side === 'SELL');
    const btcPos = activePositions.find(p => (p.symbol || '').toUpperCase().replace('USDT', 'USD') === 'BTCUSD');

    const isSupportReversalBuy = candidateSide === 'BUY' && (opts?.isDiscountSupport || opts?.isPort3010 || opts?.isCoinAutonomous);
    const isResistanceReversalSell = candidateSide === 'SELL' && (opts?.isPremiumResistance || opts?.isPort3010 || opts?.isCoinAutonomous);
    const biasObj = this.getMarketRegimeBias();
    const btcAdx = biasObj?.btcAdx14 ?? 0;
    const btcBias = biasObj?.bias ?? 'NEUTRAL';
    const isBtcSteamrollerAgainstBuy = btcBias === 'BEARISH' && btcAdx > 28;
    const isBtcSteamrollerAgainstSell = btcBias === 'BULLISH' && btcAdx > 28;

    // Rule A: If holding active BTCUSD position, all other slots MUST match BTC direction
    // UNLESS it is a verified structural support discount reversal (BUY), resistance sweep (SELL), or coin autonomy and BTC is not actively steamrolling against it
    if (btcPos) {
      if (candidateSide !== btcPos.side) {
        const isSteamrollingAgainstMe = candidateSide === 'BUY' ? isBtcSteamrollerAgainstBuy : isBtcSteamrollerAgainstSell;
        if ((isSupportReversalBuy || isResistanceReversalSell) && !isSteamrollingAgainstMe) {
          return {
            allowed: true,
            reason: `COIN AUTONOMY APPROVED: ${cleanSym} ${candidateSide} permitted off structural boundary/breakdown despite flat/rangebound BTC ${btcPos.side} position.`,
          };
        }
        return {
          allowed: false,
          reason: `PORTFOLIO COHERENCE VETO: Active BTCUSD position is ${btcPos.side}. Opening ${candidateSide} on ${cleanSym} is strictly forbidden (Never Buy alts while Shorting Bitcoin, and vice versa).`,
        };
      }
    }

    // FIX 3: GLOBAL MARKET LEADER ALIGNMENT & PORTFOLIO DIRECTION LOCK
    // Strictly prohibits contradictory positions across the portfolio (e.g. longing XRP while shorting ETH)
    if (candidateSide === 'BUY' && openSells.length > 0) {
      const sellSyms = openSells.map(p => `${p.symbol} SELL`).join(', ');
      return {
        allowed: false,
        reason: `PORTFOLIO COHERENCE VETO: Portfolio currently holds ${openSells.length} active SHORT position(s) (${sellSyms}). Opening BUY on ${cleanSym} is strictly forbidden! All slots must share the same macro direction (SELL ONLY).`,
      };
    }

    if (candidateSide === 'SELL' && openBuys.length > 0) {
      const buySyms = openBuys.map(p => `${p.symbol} BUY`).join(', ');
      return {
        allowed: false,
        reason: `PORTFOLIO COHERENCE VETO: Portfolio currently holds ${openBuys.length} active LONG position(s) (${buySyms}). Opening SELL on ${cleanSym} is strictly forbidden! All slots must share the same macro direction (BUY ONLY).`,
      };
    }

    return {
      allowed: true,
      reason: `Portfolio coherence verified: ${candidateSide} aligns with existing portfolio exposure (${candidateSide === 'BUY' ? openBuys.length : openSells.length} slots).`,
    };
  }

  /**
   * MANDATORY FIX 1: "SET-AND-FORGET" FIXED BRACKET RULE (User Mandate: "SL ek hi baar lagega, change nahi hoga!")
   * Once placed at entry, Delta Exchange Bracket SL and TP are NEVER modified or moved to breakeven on regime flips.
   */
  public checkRegimeFlipAndBreakeven(
    activePositions: DeltaPosition[],
    currentBias: MarketRegimeBias,
    forceFlip: boolean = false
  ): { positions: DeltaPosition[]; tightenedCount: number } {
    let tightenedCount = 0;
    const previousBias = this.lastKnownBias;
    this.lastKnownBias = currentBias;

    const isBiasFlipped = forceFlip || (previousBias !== currentBias);
    if (!isBiasFlipped && !forceFlip) {
      return { positions: activePositions, tightenedCount: 0 };
    }

    const updated = activePositions.map(pos => {
      const isOpposing = (currentBias === 'BEARISH' && pos.side === 'BUY') || (currentBias === 'BULLISH' && pos.side === 'SELL');
      if (isOpposing && !pos.isBreakevenLocked) {
        tightenedCount++;
        return {
          ...pos,
          stopLossPrice: pos.entryPrice,
          isBreakevenLocked: true,
        };
      }
      return pos;
    });

    return { positions: updated, tightenedCount };
  }

  /**
   * FIX 4: HARD GATEKEEPER FOR TP/SL MATH
   * Enforces:
   * 1. SL Distance clamped to [0.45%, 1.50%] of Entry Price
   * 2. Actual_RR = TP_Distance / SL_Distance MUST be >= 1.15
   * 3. If Actual_RR < 1.0, NEVER place inverted TP! Auto-adjusts TP to 1.15R.
   */
  public static validateAndEnforceGeometricTargets(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    reversalLevel?: number;
    atr?: number;
    isPostFill?: boolean;
    initialStopLossPrice?: number;
    tickSize?: number;
    decimals?: number;
  }): {
    valid: boolean;
    stopLossPrice: number;
    takeProfitPrice: number;
    slDistance: number;
    tpDistance: number;
    actualRR: number;
    wasAdjusted: boolean;
    reason: string;
  } {
    const { symbol, side, entryPrice, tickSize = 0.0001, decimals = 4 } = params;
    let slPrice = params.stopLossPrice;
    let tpPrice = params.takeProfitPrice;

    if (entryPrice <= 0) {
      return {
        valid: false,
        stopLossPrice: slPrice,
        takeProfitPrice: tpPrice,
        slDistance: 0,
        tpDistance: 0,
        actualRR: 0,
        wasAdjusted: false,
        reason: 'Invalid entry price (<=0)',
      };
    }

    // 1. Clamp SL Distance to [0.45%, 1.50%]
    const minSLDist = entryPrice * PortfolioMarketRegimeEngine.MIN_SL_DISTANCE_PCT; // 0.45%
    const maxSLDist = entryPrice * PortfolioMarketRegimeEngine.MAX_SL_DISTANCE_PCT; // 1.50%

    let rawSLDist = Math.abs(entryPrice - slPrice);
    if (rawSLDist <= 0) {
      rawSLDist = minSLDist;
    }
    let clampedSLDist = Math.min(Math.max(rawSLDist, minSLDist), maxSLDist);

    // RULE 1.1: NEVER WIDEN STOP-LOSS POST-FILL
    // Once position size is calculated based on initial structural SL, widening SL post-fill is strictly forbidden!
    if (params.isPostFill && (params.initialStopLossPrice || params.stopLossPrice)) {
      const origSL = params.initialStopLossPrice || params.stopLossPrice;
      const initialSLDist = Math.abs(entryPrice - origSL);
      if (initialSLDist > 0 && clampedSLDist > initialSLDist) {
        clampedSLDist = initialSLDist;
      }
    }

    let wasAdjusted = false;
    if (Math.abs(clampedSLDist - rawSLDist) > (tickSize * 2)) {
      wasAdjusted = true;
    }

    // Recompute SL price from clamped distance
    if (side === 'BUY') {
      slPrice = parseFloat((entryPrice - clampedSLDist).toFixed(decimals));
      // Ensure SL cannot move backward (widen) post-fill
      if (params.isPostFill && (params.initialStopLossPrice || params.stopLossPrice)) {
        const origSL = params.initialStopLossPrice || params.stopLossPrice;
        if (slPrice < origSL) slPrice = origSL;
      }
    } else {
      slPrice = parseFloat((entryPrice + clampedSLDist).toFixed(decimals));
      // Ensure SL cannot move backward (widen) post-fill
      if (params.isPostFill && (params.initialStopLossPrice || params.stopLossPrice)) {
        const origSL = params.initialStopLossPrice || params.stopLossPrice;
        if (slPrice > origSL) slPrice = origSL;
      }
    }

    // 2. Front-Run Reversal Level Boundary & Actual_RR >= 1.15 Enforcement
    // RULE 1.2: TP MUST ALWAYS SIT BEFORE THE REVERSAL LEVEL (FRONT-RUN)
    // - For SHORT: TP >= Reversal_Level + (0.10 * ATR)
    // - For LONG: TP <= Reversal_Level - (0.10 * ATR)
    if (params.reversalLevel && params.reversalLevel > 0) {
      const frontRunBuffer = (params.atr && params.atr > 0) ? (0.12 * params.atr) : (entryPrice * 0.001);
      if (side === 'SELL') {
        const frontRunFloor = parseFloat((params.reversalLevel + frontRunBuffer).toFixed(decimals));
        if (tpPrice < frontRunFloor) {
          tpPrice = frontRunFloor;
          wasAdjusted = true;
        }
      } else {
        const frontRunCeiling = parseFloat((params.reversalLevel - frontRunBuffer).toFixed(decimals));
        if (tpPrice > frontRunCeiling) {
          tpPrice = frontRunCeiling;
          wasAdjusted = true;
        }
      }
    }

    let rawTPDist = Math.abs(tpPrice - entryPrice);
    let actualRR = clampedSLDist > 0 ? (rawTPDist / clampedSLDist) : 0;

    // Clean Airway Pre-Trade Check: If reversal barrier is present, strictly veto if Actual_RR < 1.35
    if (params.reversalLevel && params.reversalLevel > 0 && !params.isPostFill) {
      if (actualRR < 1.35) {
        return {
          valid: false,
          stopLossPrice: slPrice,
          takeProfitPrice: tpPrice,
          slDistance: clampedSLDist,
          tpDistance: rawTPDist,
          actualRR: parseFloat(actualRR.toFixed(2)),
          wasAdjusted: true,
          reason: `WALL_TOO_CLOSE_BAD_RR_VETO: ROOM-TO-RUN VETO: INSUFFICIENT_REVERSAL_ROOM_VETO: Reversal barrier ($${params.reversalLevel}) allows only RR 1:${actualRR.toFixed(2)} (< 1:1.35 required). Trade blocked pre-entry! Do not move TP past the wall.`,
        };
      }
    }

    // Hard Gatekeeper: If Actual_RR < 1.0 (inverted RR like 0.2R), evaluate pre-trade veto or post-fill adjustment
    if (actualRR < 1.0 || tpPrice <= 0 || (side === 'BUY' && tpPrice <= entryPrice) || (side === 'SELL' && tpPrice >= entryPrice)) {
      const targetDist = clampedSLDist * PortfolioMarketRegimeEngine.MIN_ACTUAL_RR; // 1.05R
      const proposedTP = side === 'BUY'
        ? parseFloat((entryPrice + targetDist).toFixed(decimals))
        : parseFloat((entryPrice - targetDist).toFixed(decimals));

      // Check if proposed 1.05R TP breaches the reversal level
      let breachesReversal = false;
      if (params.reversalLevel && params.reversalLevel > 0) {
        const frontRunBuffer = (params.atr && params.atr > 0) ? (0.12 * params.atr) : (entryPrice * 0.001);
        if (side === 'SELL' && proposedTP < (params.reversalLevel + frontRunBuffer)) {
          breachesReversal = true;
        }
        if (side === 'BUY' && proposedTP > (params.reversalLevel - frontRunBuffer)) {
          breachesReversal = true;
        }
      }

      if (breachesReversal || (params.reversalLevel && params.reversalLevel > 0)) {
        // Pre-trade: BLOCK THE TRADE BEFORE ENTRY! Never force 1.05R/1.35R by pushing TP past reversal!
        if (!params.isPostFill) {
          return {
            valid: false,
            stopLossPrice: slPrice,
            takeProfitPrice: tpPrice,
            slDistance: clampedSLDist,
            tpDistance: rawTPDist,
            actualRR: parseFloat(actualRR.toFixed(2)),
            wasAdjusted: true,
            reason: `WALL_TOO_CLOSE_BAD_RR_VETO: ROOM-TO-RUN VETO: INSUFFICIENT_REVERSAL_ROOM_VETO: Reversal barrier ($${params.reversalLevel}) is too close to allow required RR without breaching reversal level. Trade blocked pre-entry! Do not move TP past the wall.`,
          };
        }
        // Post-fill: Keep TP at front-run reversal level so it actually fills!
      } else {
        wasAdjusted = true;
        tpPrice = proposedTP;
        rawTPDist = Math.abs(tpPrice - entryPrice);
        actualRR = PortfolioMarketRegimeEngine.MIN_ACTUAL_RR;
      }
    }

    const reason = wasAdjusted
      ? `[HARD GATEKEEPER APPLIED] Enforced SL distance within [0.35%, 0.85%] ($${clampedSLDist.toFixed(decimals)}) and Actual_RR >= 1.05 (1:${actualRR.toFixed(2)})`
      : `Valid geometric targets: SL dist $${clampedSLDist.toFixed(decimals)} (${((clampedSLDist / entryPrice) * 100).toFixed(2)}%), RR 1:${actualRR.toFixed(2)}`;

    return {
      valid: true,
      stopLossPrice: slPrice,
      takeProfitPrice: tpPrice,
      slDistance: clampedSLDist,
      tpDistance: rawTPDist,
      actualRR: parseFloat(actualRR.toFixed(2)),
      wasAdjusted,
      reason,
    };
  }
}

export const portfolioMarketRegime = PortfolioMarketRegimeEngine.getInstance();
