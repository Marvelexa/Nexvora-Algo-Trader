// src/lib/guards/universalTradeGuard.ts
import {
  KlinePoint,
  calcEMA,
  calcATR,
  calcADX,
  calcRSI,
  calcVWAP,
  findStructuralBracket,
  buildBulletproofBracket,
  buildMasterSixSlotBracket,
  buildThreeBucketTradePlan,
  roundToTickSize,
  sanitizeCandles,
  TradeTier,
  TieredBracketPlan,
  SixSlotBucket,
  MasterSixSlotBracketPlan,
  SeatBucketType,
  ThreeBucketTradePlan,
  FifteenMinCandleCloseGate,
} from '../strategies/strategyRegistry';

export interface ReservedSeatCounts {
  activeBigSignalSeats: number;   // Max 2 Seats (Normal / Strong 23%-40%+ ROE Runners)
  activeOptionSeats: number;      // Max 2 Seats (Reserved ONLY for BTC/ETH Call & Put Options)
  activeChopNormalSeats: number;  // Max 2 Seats (Reserved for 15%+ Net ROE Chopping Trades)
}

export class ReservedSixSeatManager {
  public static readonly MAX_BIG_SIGNAL_SEATS = 2;
  public static readonly MAX_OPTION_SEATS = 2;
  public static readonly MAX_CHOP_NORMAL_SEATS = 2;
  public static readonly MAX_TOTAL_SEATS = 6;

  /**
   * STRICT 2+2+2 SEAT RESERVATION GATE
   * 2 Chopping (15%+ Net) | 2 Normal/Strong (23%-40%+) | 2 Options (BTC/ETH ATM Uncapped)
   * - Chopping trades can ONLY use the 2 Chop seats (if 2/2 Chop seats are full, Chop trades are BLOCKED so the 2 Normal/Big seats stay 100% KHALI/EMPTY!).
   * - Normal/Strong trades use the 2 Normal/Big-Signal seats (and BTC/ETH can also trigger an Option seat).
   */
  public static allocateSeat(
    counts: ReservedSeatCounts,
    requestedBucket: SeatBucketType
  ): {
    approved: boolean;
    allocatedBucket?: SixSlotBucket;
    vetoReason?: string;
  } {
    const totalUsed =
      counts.activeBigSignalSeats + counts.activeOptionSeats + counts.activeChopNormalSeats;

    if (totalUsed >= this.MAX_TOTAL_SEATS) {
      return {
        approved: false,
        vetoReason: `ALL_6_SEATS_FULL: [Normal23To40: ${counts.activeBigSignalSeats}/2 | Options: ${counts.activeOptionSeats}/2 | Chop15Pct: ${counts.activeChopNormalSeats}/2]`,
      };
    }

    if (requestedBucket === 'OPTION_UNCAPPED_SEAT' || requestedBucket === 'OPTION_SEAT') {
      if (counts.activeOptionSeats < this.MAX_OPTION_SEATS) {
        return { approved: true, allocatedBucket: 'OPTION_UNCAPPED_SEAT' };
      }
      return {
        approved: false,
        vetoReason: `OPTION_2_SEATS_FULL (${counts.activeOptionSeats}/2 occupied)`,
      };
    }

    if (requestedBucket === 'NORMAL_23_TO_40PCT_SEAT' || requestedBucket === 'BIG_SIGNAL_SEAT') {
      if (counts.activeBigSignalSeats < this.MAX_BIG_SIGNAL_SEATS) {
        return { approved: true, allocatedBucket: 'NORMAL_23_TO_40PCT_SEAT' };
      }
      return {
        approved: false,
        vetoReason: `NORMAL_2_SEATS_FULL / BIG_SIGNAL_2_SEATS_FULL (${counts.activeBigSignalSeats}/2 occupied)`,
      };
    }

    // requestedBucket === 'CHOP_15PCT_SEAT' | 'CHOP_NORMAL_SEAT'
    // CRITICAL RULE: NEVER allow a Chopping trade to touch the 2 Normal/Big-Signal seats!
    if (counts.activeChopNormalSeats < this.MAX_CHOP_NORMAL_SEATS) {
      return { approved: true, allocatedBucket: 'CHOP_15PCT_SEAT' };
    }

    return {
      approved: false,
      vetoReason: `CHOP_2_SEATS_FULL_KEEPING_BIG_SEATS_KHALI: 2/2 Chopping (15%+ Net) seats are active. Keeping the 2 Normal/Strong (23%-40%+) seats strictly RESERVED (Khali)!`,
    };
  }
}

export interface SixSlotPortfolioState {
  activePerpetualCount: number; // Max 4 Normal Perpetual Futures trades
  activeOptionsCount: number;   // Max 2 Options trades (BTC/ETH Calls or Puts)
}

export class HybridSixSlotManager {
  public static readonly MAX_TOTAL_TRADES = 6;
  public static readonly MAX_PERPETUAL_SLOTS = 4;
  public static readonly MAX_OPTION_SLOTS = 2;

  public static canOpenNewTrade(
    state: SixSlotPortfolioState,
    wantsOptionSlot: boolean
  ): { allowed: boolean; assignSlotType: 'PERPETUAL' | 'OPTION' | 'NONE'; reason?: string } {
    const totalActive = state.activePerpetualCount + state.activeOptionsCount;
    if (totalActive >= this.MAX_TOTAL_TRADES) {
      return {
        allowed: false,
        assignSlotType: 'NONE',
        reason: `MAX_6_SLOTS_FULL: ${state.activePerpetualCount}/4 Perpetuals + ${state.activeOptionsCount}/2 Options active.`,
      };
    }

    // 1. If it's a Strong BTC/ETH trade and an Option slot (out of 2) is open -> Route to Options Engine!
    if (wantsOptionSlot && state.activeOptionsCount < this.MAX_OPTION_SLOTS) {
      return { allowed: true, assignSlotType: 'OPTION' };
    }

    // 2. Otherwise route to one of the 4 Normal Perpetual Futures slots!
    if (state.activePerpetualCount < this.MAX_PERPETUAL_SLOTS) {
      return { allowed: true, assignSlotType: 'PERPETUAL' };
    }

    return {
      allowed: false,
      assignSlotType: 'NONE',
      reason: `PERPETUAL_4_SLOTS_FULL: All 4 normal slots are occupied (Options: ${state.activeOptionsCount}/2).`,
    };
  }
}

export const ALLOWED_CRYPTO_SYMBOLS = new Set<string>([
  'BTCUSD',
  'ETHUSD',
  'SOLUSD',
  'XRPUSD',
  'DOGEUSD',
  'ADAUSD',
  'BNBUSD',
  'LINKUSD',
  'AVAXUSD',
  'SUIUSD',
]);

export interface DeltaProductMeta {
  productId: number;
  symbol: string;
  contractType: string;
  contractValue: number;
  tickSize: number;
  state: string;
  tradingStatus: string;
  quotingAsset?: string;
  settlingAsset?: string;
}

export interface ActivePositionInfo {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  unrealizedPnL: number;
}

export interface GuardValidationResult {
  approved: boolean;
  vetoReason?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  contracts: number;
  leverage?: number;
  expectedMaxLossUSD: number;
  expectedRewardUSD: number;
  riskRewardRatio: number;
  tier?: TradeTier;
  bucket?: SixSlotBucket;
  tierLabel?: string;
  canAlsoTriggerOption?: boolean;
  expectedRoePct?: number;
  grossRoePct?: number;
  netRoeAfterFeesPct?: number;
  breakevenPlusFeeTriggerPrice?: number;
  breakevenPlusFeeLockPrice?: number;
  runner23PctTriggerPrice?: number;
  runner18PctLockPrice?: number;
  trailTriggerPrice?: number;
  trailActivationPrice?: number;
  trailLockPrice?: number;
  useOptionsSlot?: boolean;
  targetProfitUSD?: number;
  tickSize?: number;
  reversalWallPrice?: number | null;
}

export interface PreTradeVerdict {
  allowed: boolean;
  reason: string;
  originalSide: 'BUY' | 'SELL';
  executedSide: 'BUY' | 'SELL';
  isFlipped: boolean;
  reversalTag: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  tp1Price: number;
  tp2Price: number;
  slDistance: number;
  tpDistance: number;
  actualRR: number;
  quantity: number;
  marginUSD: number;
  notionalUSD: number;
  structuralTargetDescription: string;
  riskCapUSD: number;
  isFastScalp: boolean;
  slotType: string;
}

export interface LiveProfitAction {
  shouldClose100: boolean;
  updateBrackets: boolean;
  ratchetStage: number;
  closeReason: string;
  newStopLossPrice?: number;
  ratchetReason?: string;
}

export class UniversalTradeGuard {
  public static readonly MAX_RISK_PER_TRADE_USD = 4.00;
  public static readonly MAX_NOTIONAL_USD = 750.0;
  public static readonly MIN_SL_PCT = 0.0065; // 0.65% minimum (never 0.45% noise zone!)
  public static readonly MAX_SL_PCT = 0.0125; // 1.25% maximum

  // Prevents firing multiple entries on the same 15m candle
  private static lastTradedCandleBySymbol: Map<string, number> = new Map();

  // 45-Minute per-symbol loss cooldown to prevent revenge-trading after stop-loss (User Mandate Fix 3)
  private static lastStopLossTimestampBySymbol: Map<string, number> = new Map();

  public static recordStopLoss(symbol: string): void {
    const clean = symbol.toUpperCase().trim();
    this.lastStopLossTimestampBySymbol.set(clean, Date.now());
    console.log(`🔒 [45-MIN LOSS COOLDOWN] Locked ${clean} for 45 minutes after stop loss to prevent revenge trading.`);
  }

  public static isSymbolInLossCooldown(symbol: string): { inCooldown: boolean; remainingMinutes: number } {
    const clean = symbol.toUpperCase().trim();
    const lastTime = this.lastStopLossTimestampBySymbol.get(clean) || 0;
    const elapsed = Date.now() - lastTime;
    const cooldownMs = 45 * 60 * 1000;
    if (elapsed < cooldownMs) {
      return { inCooldown: true, remainingMinutes: Math.ceil((cooldownMs - elapsed) / 60000) };
    }
    return { inCooldown: false, remainingMinutes: 0 };
  }

  public static resetCandleDeduplication(symbol?: string): void {
    if (symbol) {
      this.lastTradedCandleBySymbol.delete(symbol);
    } else {
      this.lastTradedCandleBySymbol.clear();
    }
  }

  // Live dynamic product metadata cache (refreshed every 30 mins)
  private static dynamicProducts: Map<string, DeltaProductMeta> = new Map();
  private static dynamicBlockedNonCrypto: Set<string> = new Set();
  private static lastProductsFetchTime: number = 0;
  private static isTestnetEnvironment: boolean = false;
  private static activeBaseUrl: string = '';

  // Genuine Crypto symbols ending with *XUSD / *XUSDT that must NEVER be filtered out
  private static readonly PURE_CRYPTO_XUSD_ALLOWLIST = new Set<string>([
    'IMXUSD',
    'SNXUSD',
    'STXUSD',
    'CVXUSD',
    'GMXUSD',
    'CFXUSD',
    'IOTXUSD',
    'TRXUSD',
    'AVAXUSD',
    'DYDXUSD',
    'FRAXUSD',
    'SPXUSD',
    'ONXUSD',
  ]);

  // Substrings / prefixes matching Tokenized Stocks, Commodities, ETFs, RWA, & Forex
  private static readonly NON_CRYPTO_SYMBOL_SUBSTRINGS = [
    'XAUT',
    'PAXG',
    'SILVER',
    'SLVON',
    'GOLD',
    'NVDA',
    'SNDK',
    'TSLA',
    'AAPL',
    'MSFT',
    'META',
    'AMZN',
    'GOOG',
    'SPY',
    'QQQ',
    'USOON',
    'BRENT',
    'WTI',
    'EUR',
    'GBP',
    'JPY',
    'INR',
  ];

  // Exact non-crypto commodities & bStocks / xStock perpetuals on Delta Exchange
  private static readonly NON_CRYPTO_EXACT_SYMBOLS = new Set<string>([
    'OILUSD',
    'USOILUSD',
    'UKOILUSD',
    'XAUUSD',
    'XAGUSD',
    'COINXUSD',
    'CRCLXUSD',
    'SPCXXUSD',
    'TQQQBUSD',
    'MSTRBUSD',
    'PLTRBUSD',
    'ORCLBUSD',
    'INTCBUSD',
    'TSMBUSD',
    'AVGOBUSD',
    'BABABUSD',
    'HOODBUSD',
    'DELLBUSD',
    'ARMBUSD',
    'AMDBUSD',
    'MRVLBUSD',
    'MRNABUSD',
    'SOXLBUSD',
    'MUUBUSD',
    'MVLLBUSD',
    'COHRBUSD',
    'SNXXBUSD',
    'BMNRBUSD',
    'CRWVBUSD',
    'KORUBUSD',
    'AAOIBUSD',
    'RKLBBUSD',
    'SKHYBUSD',
    'NBISBUSD',
    'LITEBUSD',
    'EWYBUSD',
    'WDCBUSD',
    'CBRSBUSD',
    'DRAMBUSD',
    'MUBUSD',
    'BEBUSD',
  ]);

  /**
   * Filters out Tokenized Stocks, Commodities, Metals, ETFs, RWA, and Forex.
   * Keeps only pure Crypto Perpetuals (including genuine *XUSD coins like IMXUSD, STXUSD, AVAXUSD, TRXUSD).
   */
  public static isPureCryptoPerpetual(symbol: string, productOrTicker?: any): boolean {
    const raw = (symbol || '').toUpperCase().trim();
    if (!raw) return false;
    const clean = raw.replace(/USDT$/, 'USD');

    if (productOrTicker) {
      const topTag = String(productOrTicker?.product_specs?.top_tag || '').toLowerCase();
      const tags: string[] = Array.isArray(productOrTicker?.product_specs?.tags)
        ? productOrTicker.product_specs.tags.map((t: any) => String(t).toLowerCase())
        : [];
      const desc = `${productOrTicker?.description || ''} ${productOrTicker?.short_description || ''} ${productOrTicker?.underlying_asset?.name || ''}`.toLowerCase();

      if (
        topTag === 'tradfi' ||
        tags.some((t) => ['xstock', 'metal', 'rawa', 'commodity', 'forex', 'equity', 'tradfi'].includes(t)) ||
        /bstocks?\s*token|xstock\s*token|ondo\s*token|gold\s*token|silver\s*token|oil\s*fund|tokenized\s*stock/i.test(desc)
      ) {
        this.dynamicBlockedNonCrypto.add(raw);
        this.dynamicBlockedNonCrypto.add(clean);
        return false;
      }
    }

    if (this.dynamicBlockedNonCrypto.has(raw) || this.dynamicBlockedNonCrypto.has(clean)) {
      return false;
    }
    if (this.NON_CRYPTO_EXACT_SYMBOLS.has(raw) || this.NON_CRYPTO_EXACT_SYMBOLS.has(clean)) {
      return false;
    }
    for (const token of this.NON_CRYPTO_SYMBOL_SUBSTRINGS) {
      if (clean.includes(token)) {
        return false;
      }
    }
    if (clean.endsWith('XUSD') && !this.PURE_CRYPTO_XUSD_ALLOWLIST.has(clean)) {
      return false;
    }

    return true;
  }

  /**
   * Refreshes tradable perpetual products dynamically from Delta Exchange (/v2/products)
   * Live Delta Exchange unlocks pure crypto coins; Demo/Testnet dynamically discovers pure crypto testnet coins.
   */
  public static async refreshDynamicProducts(isTestnet?: boolean, baseUrl?: string): Promise<Map<string, DeltaProductMeta>> {
    const now = Date.now();
    const testnet = isTestnet ?? (
      process.env.DELTA_TRADING_MODE === 'DELTA_TESTNET' ||
      process.env.DELTA_ENV === 'testnet' ||
      this.isTestnetEnvironment
    );
    const endpoint = baseUrl || (testnet
      ? 'https://cdn-ind.testnet.deltaex.org'
      : 'https://api.india.delta.exchange');

    // Cache for 30 minutes (when active endpoint matches)
    if (this.dynamicProducts.size > 0 && endpoint === this.activeBaseUrl && (now - this.lastProductsFetchTime < 30 * 60 * 1000)) {
      return this.dynamicProducts;
    }

    this.isTestnetEnvironment = testnet;
    this.activeBaseUrl = endpoint;

    try {
      const url = `${endpoint}/v2/products?contract_types=perpetual_futures`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      let list: any[] = [];
      if (res && res.ok) {
        const data: any = await res.json().catch(() => null);
        list = data?.result || (Array.isArray(data) ? data : []);
      }

      // Fallback to tickers if /v2/products returned empty
      if (!list || list.length === 0) {
        const tickerUrl = `${endpoint}/v2/tickers?contract_types=perpetual_futures`;
        const tRes = await fetch(tickerUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (tRes && tRes.ok) {
          const tData: any = await tRes.json().catch(() => null);
          const raw = tData?.result || [];
          list = raw.map((t: any) => ({
            id: t.product_id,
            symbol: t.symbol,
            contract_type: t.contract_type || 'perpetual_futures',
            contract_value: t.contract_value,
            tick_size: t.tick_size,
            state: 'live',
            trading_status: t.product_trading_status || 'operational',
            product_specs: t.product_specs,
            description: t.description,
          }));
        }
      }

      let filteredOutNonCrypto = 0;
      const activePerps = list.filter((p: any) => {
        const isPerp = p.contract_type === 'perpetual_futures' || p.contract_type === 'futures';
        const isLive = p.state === 'live' || !p.state;
        const isOp = p.trading_status === 'operational' || !p.trading_status;
        if (!isPerp || !isLive || !isOp || !p.symbol) return false;
        if (!this.isPureCryptoPerpetual(p.symbol, p)) {
          filteredOutNonCrypto++;
          return false;
        }
        return true;
      });

      if (activePerps.length > 0) {
        this.dynamicProducts.clear();
        ALLOWED_CRYPTO_SYMBOLS.clear();

        for (const p of activePerps) {
          const symUpper = p.symbol.toUpperCase().trim();
          const meta: DeltaProductMeta = {
            productId: p.id || p.product_id,
            symbol: symUpper,
            contractType: p.contract_type || 'perpetual_futures',
            contractValue: parseFloat(p.contract_value) || 1.0,
            tickSize: parseFloat(p.tick_size) || 0.01,
            state: p.state || 'live',
            tradingStatus: p.trading_status || 'operational',
            quotingAsset: p.quoting_asset?.symbol,
            settlingAsset: p.settling_asset?.symbol,
          };
          this.dynamicProducts.set(symUpper, meta);
          ALLOWED_CRYPTO_SYMBOLS.add(symUpper);
        }
        this.lastProductsFetchTime = now;
        console.log(`🌐 [UNIVERSAL GUARD] Loaded ${this.dynamicProducts.size} pure crypto perpetual contracts on ${testnet ? 'DEMO/TESTNET' : 'LIVE'} environment (excluded ${filteredOutNonCrypto} non-crypto stocks/commodities).`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [UNIVERSAL GUARD] Failed to fetch dynamic products: ${err.message}. Retaining existing symbols (${ALLOWED_CRYPTO_SYMBOLS.size}).`);
    }

    return this.dynamicProducts;
  }

  public static isSymbolTradable(symbol: string): boolean {
    const clean = (symbol || '').toUpperCase().trim();
    if (!this.isPureCryptoPerpetual(clean)) {
      return false;
    }
    if (this.dynamicProducts.size > 0) {
      return this.dynamicProducts.has(clean);
    }
    return ALLOWED_CRYPTO_SYMBOLS.has(clean);
  }

  public static getProductMeta(symbol: string): DeltaProductMeta | undefined {
    const clean = (symbol || '').toUpperCase().trim();
    return this.dynamicProducts.get(clean);
  }

  public static getDynamicProductsMap(): Map<string, DeltaProductMeta> {
    return this.dynamicProducts;
  }

  /**
   * Rounds a price to the product's tick size
   */
  public static roundToTick(price: number, tickSize: number): number {
    return roundToTickSize(price, tickSize);
  }

  /**
   * HARD GUARD 1: Block ANY software attempt to cancel brackets or market-close at a loss!
   */
  public static canSoftwareClosePosition(unrealizedPnL: number): boolean {
    if (unrealizedPnL < 0) {
      console.log(
        `[UNIVERSAL GUARD BLOCKED LOSS CLOSE] Software tried to close at ${unrealizedPnL.toFixed(
          2
        )} USD. FORBIDDEN! Let Exchange Bracket SL work.`
      );
      return false;
    }
    return true;
  }

  /**
   * HARD GUARD 2: Global BTC/ETH Leader Lock — Bidirectional BUY & SELL execution!
   * - Allows BUY on Macro Bullish OR Confirmed Recovery Breakout (CHoCH BUY: Close > EMA20 & VWAP, EMA9 > EMA20, 2 closed bars).
   * - Strictly blocks SELL if price is rising above EMA9, EMA20, or VWAP!
   */
  public static checkPortfolioDirectionAlignment(
    candidateSide: 'BUY' | 'SELL',
    activePositions: ActivePositionInfo[],
    btcCandles15m?: KlinePoint[],
    ethCandles15m?: KlinePoint[],
    signalReason?: string,
    candidateSymbol?: string
  ): { aligned: boolean; reason?: string } {
    const cleanCandidate = candidateSymbol ? candidateSymbol.toUpperCase().trim() : '';

    // 1. Anti-Hedging: Strictly FORBID holding opposite BUY and SELL on the SAME SYMBOL!
    // Example: If BTCUSD has an active SELL, cannot open a BUY on BTCUSD.
    // However, different symbols (e.g. SUIUSD BUY vs BTCUSD SELL) trade independently on Delta Exchange!
    if (cleanCandidate) {
      for (const pos of activePositions) {
        if (pos.symbol.toUpperCase().trim() === cleanCandidate && pos.side !== candidateSide) {
          return {
            aligned: false,
            reason: `SAME_SYMBOL_HEDGE_VETO: Cannot open ${candidateSide} on ${pos.symbol} while already holding active ${pos.side}!`,
          };
        }
      }
    }

    // Direct Price-Action & Strategic Reversal Bypass:
    // High-confluence price action signals (W-Bottom, M-Top, Engulfing, Hammer, Pinbars, Pullbacks)
    // take precedence and should never be blocked by lagging indicator locks!
    const isDirectStructuralSignal =
      signalReason?.startsWith('PA_') ||
      signalReason?.includes('REVERSAL') ||
      signalReason?.includes('ENGULFING') ||
      signalReason?.includes('W_BOTTOM') ||
      signalReason?.includes('M_TOP') ||
      signalReason?.includes('BREAKOUT') ||
      signalReason?.includes('PULLBACK');

    if (isDirectStructuralSignal) {
      return { aligned: true };
    }

    // 2. Check BTCUSD / ETHUSD closed 15m trend (Bidirectional confirmation & V-Bottom Reversal)
    const leaderCandles = btcCandles15m && btcCandles15m.length > 55 ? btcCandles15m : ethCandles15m;
    if (leaderCandles && leaderCandles.length > 55) {
      const closed = leaderCandles.slice(0, -1);
      const closes = closed.map((c) => c.close);
      const lastClose = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      const lastBar = closed[closed.length - 1];
      const prevBar = closed[closed.length - 2];
      const ema9 = calcEMA(closes, 9).pop() || lastClose;
      const ema20 = calcEMA(closes, 20).pop() || lastClose;
      const vwap = calcVWAP(closed, 32);
      const rsi = calcRSI(closes, 14);

      // Fast Bullish Trend OR 2-bar Bottom V-Reversal (Never wait for lagging EMA 50!)
      const isLeaderFastBullish =
        (lastClose > ema20 && ema9 >= ema20 * 0.9990) || // Confirmed above EMA 20
        (lastClose > ema9 && lastBar.close > lastBar.open && prevBar.close > prevBar.open && rsi <= 62 && lastClose > prevBar.high); // 2-bar V-Bottom Reversal off lows!

      // Fast Bearish Trend (STRICTLY FORBIDS shorting at oversold bottoms or when price is reclaiming EMA 9!)
      const distBelowEma20Pct = (ema20 - lastClose) / lastClose;
      const isLeaderFastBearish =
        lastClose < ema20 &&
        lastClose < ema9 &&
        ema9 <= ema20 * 1.0010 &&
        rsi >= 38 && // NEVER short when RSI < 38 (oversold floor)
        distBelowEma20Pct <= 0.0055; // NEVER short if price has already dumped >0.55% below EMA 20!

      if (candidateSide === 'BUY' && !isLeaderFastBullish) {
        return {
          aligned: false,
          reason: `MARKET_LEADER_NOT_BULLISH_VETO: Leader BTC/ETH is not in Fast Bullish structure or V-Bottom Reversal (Close < EMA9/20). Altcoin BUY blocked!`,
        };
      }
      if (candidateSide === 'SELL' && !isLeaderFastBearish) {
        return {
          aligned: false,
          reason: `MARKET_LEADER_REVERSAL_VETO: Leader BTC/ETH is either oversold (RSI < 38), reclaiming EMA9, or extended >0.55% below EMA20. Bottom SELL blocked!`,
        };
      }
    }

    return { aligned: true };
  }

  /**
   * Risk-Budgeted Position Sizing: Strictly $4.00 USD max loss per trade (User Mandate Fix 4)
   * With 25% margin ceiling clamp ($46.00 USD max margin / $1,380 USD notional).
   */
  public static calculateRiskScaledPositionSize(params: {
    entryPrice: number;
    slPrice: number;
    contractValue?: number;
    accountCapitalUSD?: number;
    leverage?: number;
    marginPercent?: number;
    maxRiskUSD?: number;
  }): { contracts: number; maxLossUSD: number; notionalUSD: number; marginUSD: number } {
    const { 
      entryPrice, 
      slPrice, 
      contractValue = 1.0, 
      accountCapitalUSD = 178.57, 
      leverage = 30, 
      marginPercent = 0.25,
      maxRiskUSD = 4.00,
    } = params;

    const slDistance = Math.abs(entryPrice - slPrice);
    if (entryPrice <= 0 || slDistance <= 0) {
      return { contracts: 1, maxLossUSD: maxRiskUSD, notionalUSD: 0, marginUSD: 0 };
    }

    const lossPerContractUSD = slDistance * contractValue;
    const contractNotional = entryPrice * contractValue;

    // 1. Contract sizing strictly budgeted to max $4.00 USD risk (User Mandate Fix 4)
    let contractsByRisk = Math.max(1, Math.floor(maxRiskUSD / Math.max(lossPerContractUSD, 1e-8)));

    // 2. 25% Margin Ceiling Clamp: max 25% of capital (target ~$44.64 USD margin / $1,380 USD notional)
    const effectiveCapital = accountCapitalUSD > 0 ? accountCapitalUSD : 178.57;
    const targetMarginUSD = Math.min(46.0, Math.max(10.0, effectiveCapital * marginPercent));
    const targetNotionalUSD = targetMarginUSD * leverage;
    const contractsByMargin = Math.max(1, Math.floor(targetNotionalUSD / Math.max(contractNotional, 1e-8)));

    // Select the safer of the two
    let contracts = Math.max(1, Math.min(contractsByRisk, contractsByMargin));

    // Hard ceiling clamp: if notional exceeds $1,380 USD, scale down contracts
    if (contracts * contractNotional > 1380.0) {
      contracts = Math.max(1, Math.floor(1380.0 / Math.max(contractNotional, 1e-8)));
    }

    // Strict Loss Protection: ensure actual loss does NOT exceed $4.00 USD
    while (contracts > 1 && contracts * lossPerContractUSD > maxRiskUSD) {
      contracts--;
    }

    const notionalUSD = Number((contracts * contractNotional).toFixed(2));
    const marginUSD = Number((notionalUSD / leverage).toFixed(2));
    const actualMaxLossUSD = Number((contracts * lossPerContractUSD).toFixed(2));

    return { 
      contracts, 
      maxLossUSD: actualMaxLossUSD, 
      notionalUSD, 
      marginUSD 
    };
  }

  /**
   * MASTER VALIDATION PIPELINE CALLED BEFORE PLACING ANY ORDER ON DELTA EXCHANGE
   */
  public static validateAndBuildBracket(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    candles15m: KlinePoint[];
    candles5m?: KlinePoint[];
    contractValue?: number;
    tickSize?: number;
    accountCapitalUSD?: number;
    leverage?: number;
    marginPercent?: number;
    activePositions?: ActivePositionInfo[];
    btcCandles15m?: KlinePoint[];
    ethCandles15m?: KlinePoint[];
    signalReason?: string;
    tierPlan?: TieredBracketPlan;
    threeBucketPlan?: ThreeBucketTradePlan;
    enforceCloseWindow?: boolean;
    nowMs?: number;
  }): GuardValidationResult {
    const {
      symbol,
      side,
      entryPrice: rawEntryPrice,
      candles15m,
      candles5m,
      contractValue,
      tickSize,
      accountCapitalUSD,
      leverage,
      marginPercent,
      activePositions = [],
      btcCandles15m,
      ethCandles15m,
      signalReason,
      tierPlan,
      threeBucketPlan,
      enforceCloseWindow = false,
      nowMs = Date.now(),
    } = params;

    const cleanSym = symbol.toUpperCase().trim();

    // 0A. Pure Crypto Perpetual Filter (Reject tokenized stocks, commodities, metals, ETFs & forex)
    if (!this.isPureCryptoPerpetual(cleanSym)) {
      return {
        approved: false,
        vetoReason: `NON_CRYPTO_STOCK_COMMODITY_VETO: ${cleanSym} is a non-crypto stock, commodity, or forex asset and is excluded from crypto perpetual scanning.`,
        symbol,
        side,
        entryPrice: rawEntryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    // 0. 45-Minute per-symbol loss cooldown to prevent revenge-trading (User Mandate Fix 3)
    const lossCooldown = this.isSymbolInLossCooldown(cleanSym);
    if (lossCooldown.inCooldown) {
      return {
        approved: false,
        vetoReason: `LOSS_COOLDOWN_ACTIVE: ${cleanSym} is locked for ${lossCooldown.remainingMinutes} more minutes after recent stop-loss to prevent revenge-trading!`,
        symbol,
        side,
        entryPrice: rawEntryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    // 1. Dynamic Perpetual Product Availability Check (Live 189+ coins vs Demo/Testnet perps)
    if (!this.isSymbolTradable(cleanSym)) {
      return {
        approved: false,
        vetoReason: `SYMBOL_NOT_AVAILABLE_VETO: ${symbol} is not an active perpetual contract on this environment (${this.isTestnetEnvironment ? 'Demo/Testnet' : 'Live'}).`,
        symbol,
        side,
        entryPrice: rawEntryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    // Resolve exact product precision metadata dynamically (fallback tick rule: <1 -> 0.0001, <100 -> 0.001, >=100 -> 0.01)
    const meta = this.getProductMeta(cleanSym);
    const effectiveContractValue = contractValue && contractValue > 0
      ? contractValue
      : (meta?.contractValue || 1.0);
    const fallbackTickSize = rawEntryPrice < 1 ? 0.0001 : rawEntryPrice < 100 ? 0.001 : 0.01;
    const effectiveTickSize = tickSize && tickSize > 0
      ? tickSize
      : (meta?.tickSize && meta.tickSize > 0 ? meta.tickSize : fallbackTickSize);

    const entryPrice = roundToTickSize(rawEntryPrice, effectiveTickSize);

    // 2. 5M Structure Filter Check (User Mandate Fix 2: Block Counter-Bounce Shorts & Counter-Dump Buys)
    // Direct structural price-action patterns (W-Bottom, M-Top, Engulfing, Hammer) bypass 5m filter so reversals enter cleanly
    const isDirectReversal =
      signalReason?.startsWith('PA_') ||
      signalReason?.includes('REVERSAL') ||
      signalReason?.includes('ENGULFING') ||
      signalReason?.includes('W_BOTTOM') ||
      signalReason?.includes('M_TOP');

    if (!isDirectReversal && candles5m && candles5m.length >= 25) {
      const clean5m = sanitizeCandles(candles5m);
      const closed5m = clean5m.slice(0, -1);
      if (closed5m.length >= 20) {
        const c5m_last = closed5m[closed5m.length - 1];
        const c5m_prev2 = closed5m[closed5m.length - 3];
        const closes5m = closed5m.map((k) => k.close);
        const ema9_5mArr = calcEMA(closes5m, 9);
        const ema20_5mArr = calcEMA(closes5m, 20);
        const ema9_5m = ema9_5mArr[ema9_5mArr.length - 1];
        const ema20_5m = ema20_5mArr[ema20_5mArr.length - 1];

        if (side === 'SELL') {
          const is5mBouncing = (c5m_last.close > c5m_prev2.close && c5m_last.close > ema20_5m) || c5m_last.close > ema9_5m;
          if (is5mBouncing) {
            return {
              approved: false,
              vetoReason: `5M_RELIEF_BOUNCE_VETO: 5m candles are rising (Close $${c5m_last.close} > Prev2 $${c5m_prev2.close} & EMA20_5m $${ema20_5m.toFixed(2)} / EMA9_5m $${ema9_5m.toFixed(2)}). Counter-bounce SELL blocked until 5m closes below EMA9!`,
              symbol,
              side,
              entryPrice,
              slPrice: 0,
              tpPrice: 0,
              contracts: 0,
              expectedMaxLossUSD: 0,
              expectedRewardUSD: 0,
              riskRewardRatio: 0,
            };
          }
        } else if (side === 'BUY') {
          const is5mDumping = (c5m_last.close < c5m_prev2.close && c5m_last.close < ema20_5m) || c5m_last.close < ema9_5m;
          if (is5mDumping) {
            return {
              approved: false,
              vetoReason: `5M_ACTIVE_DUMP_VETO: 5m candles are falling (Close $${c5m_last.close} < Prev2 $${c5m_prev2.close} & EMA20_5m $${ema20_5m.toFixed(2)} / EMA9_5m $${ema9_5m.toFixed(2)}). Counter-dump BUY blocked until 5m closes above EMA9!`,
              symbol,
              side,
              entryPrice,
              slPrice: 0,
              tpPrice: 0,
              contracts: 0,
              expectedMaxLossUSD: 0,
              expectedRewardUSD: 0,
              riskRewardRatio: 0,
            };
          }
        }
      }
    }

    // Sanitize against Testnet freak needle wicks (clamped to <= 0.45% of body) & sort ascending by time
    const cleanCandles = sanitizeCandles(candles15m);
    const peek = FifteenMinCandleCloseGate.peekLastClosedCandle(cleanCandles, nowMs);

    // 3. Closed-Candle Freshness Window & Deduplication Lock (Never fire mid-candle or repeatedly on same bar!)
    const closed15m = peek.closedCandles.length > 0 ? peek.closedCandles : (cleanCandles.length > 30 ? cleanCandles.slice(0, -1) : cleanCandles);
    const closedCandleTime = peek.closedCandleOpenMs || FifteenMinCandleCloseGate.toMs(closed15m[closed15m.length - 1]?.time || 0);
    const prevTradedTime = this.lastTradedCandleBySymbol.get(cleanSym) || this.lastTradedCandleBySymbol.get(symbol);

    if (prevTradedTime && prevTradedTime === closedCandleTime) {
      return {
        approved: false,
        vetoReason: `SAME_CANDLE_CHURN_VETO: Already evaluated/traded ${symbol} on closed 15m candle ${closedCandleTime}.`,
        symbol,
        side,
        entryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    if (enforceCloseWindow && peek.closedCandleEndMs > 0) {
      const msSinceClosed = nowMs - peek.closedCandleEndMs;
      if (msSinceClosed > 90 * 1000) {
        this.lastTradedCandleBySymbol.set(cleanSym, closedCandleTime);
        return {
          approved: false,
          vetoReason: `MID_CANDLE_LATE_ENTRY_VETO: ${cleanSym} closed ${Math.round(msSinceClosed / 1000)}s ago (> 90s boundary window). Waiting for next 15m close (:00/:15/:30/:45).`,
          symbol,
          side,
          entryPrice,
          slPrice: 0,
          tpPrice: 0,
          contracts: 0,
          expectedMaxLossUSD: 0,
          expectedRewardUSD: 0,
          riskRewardRatio: 0,
        };
      }
    }

    // 4. Portfolio & Market Leader Direction Check (Bidirectional & Strict Counter-Bounce Block)
    const alignCheck = this.checkPortfolioDirectionAlignment(
      side,
      activePositions,
      btcCandles15m,
      ethCandles15m,
      signalReason,
      cleanSym
    );
    if (!alignCheck.aligned) {
      return {
        approved: false,
        vetoReason: alignCheck.reason,
        symbol,
        side,
        entryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    // 5. Fee-Adjusted 6-Slot Master Bracket Engine (zero glitch wicks, front-run reversal TP, exact tick-size rounding)
    const atr = calcATR(closed15m, 14);
    const adx = calcADX(closed15m, 14);
    const bracketPlan: MasterSixSlotBracketPlan = buildMasterSixSlotBracket({
      symbol: cleanSym,
      side,
      entryPrice,
      closedCandles: closed15m,
      atr,
      reason: signalReason || (threeBucketPlan?.tierLabel || ''),
      tickSize: effectiveTickSize,
    });

    // Block Chopping entries trapped inside a tight dead box (< 0.60% / < 15% ROE room before multi-touch ceiling/floor)
    if (bracketPlan.bucket === 'CHOP_15PCT_SEAT' && adx < 22 && bracketPlan.blockingWallPrice) {
      return {
        approved: false,
        vetoReason: `CHOP_REVERSAL_WALL_TOO_CLOSE_VETO: Multi-touch opposing wall at $${bracketPlan.blockingWallPrice} (${bracketPlan.blockingWallDistPct}% away) leaves < 15% ROE before reversal.`,
        symbol,
        side,
        entryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    const slPrice = bracketPlan.slPrice;
    const finalTpPrice = bracketPlan.tpPrice;

    // 5B. Enforce strict Directional Bracket Validation before approving any trade
    const isDirectionallyValid =
      side === 'BUY'
        ? slPrice > 0 && slPrice < entryPrice && finalTpPrice > entryPrice
        : slPrice > entryPrice && finalTpPrice > 0 && finalTpPrice < entryPrice;

    if (!isDirectionallyValid) {
      return {
        approved: false,
        vetoReason: `INVALID_BRACKET_DIRECTION: ${cleanSym} ${side} bracket failed directional validation (Entry=$${entryPrice}, SL=$${slPrice}, TP=$${finalTpPrice}).`,
        symbol,
        side,
        entryPrice,
        slPrice: 0,
        tpPrice: 0,
        contracts: 0,
        expectedMaxLossUSD: 0,
        expectedRewardUSD: 0,
        riskRewardRatio: 0,
      };
    }

    // 6. Compute Risk-Budgeted Quantity strictly capped by 6-Slot Risk Budget ($3.80 Normal 23%-40%+ / $3.20 Chop 15%+ Net)
    const effectiveLeverage = leverage && leverage > 0 ? leverage : (bracketPlan.leverage || tierPlan?.leverage || 25);
    const effectiveMaxRiskUSD = bracketPlan.maxRiskUSD || UniversalTradeGuard.MAX_RISK_PER_TRADE_USD;
    const { contracts, maxLossUSD } = this.calculateRiskScaledPositionSize({
      entryPrice,
      slPrice,
      contractValue: effectiveContractValue,
      accountCapitalUSD,
      leverage: effectiveLeverage,
      marginPercent: marginPercent ?? 0.25,
      maxRiskUSD: effectiveMaxRiskUSD,
    });

    const tpDistance = Math.abs(finalTpPrice - entryPrice);
    const tpPct = entryPrice > 0 ? Number(((tpDistance / entryPrice) * 100).toFixed(2)) : bracketPlan.tpPct;
    const roundTripFeePct = 0.12;
    const grossRoePct = Number((tpPct * effectiveLeverage).toFixed(1));
    const netRoeAfterFeesPct = Number(((tpPct - roundTripFeePct) * effectiveLeverage).toFixed(1));
    const expectedRewardUSD = Number((contracts * tpDistance * effectiveContractValue).toFixed(2));
    const legacyTier: TradeTier =
      bracketPlan.bucket === 'NORMAL_23_TO_40PCT_SEAT' ? 'STRONG_23PCT_RUNNER' : 'NORMAL_5_TO_8_USD_SCALP';

    // Mark this 15m closed candle as traded (normalized symbol + ms timestamp)
    this.lastTradedCandleBySymbol.set(cleanSym, closedCandleTime);
    this.lastTradedCandleBySymbol.set(symbol, closedCandleTime);

    return {
      approved: true,
      symbol,
      side,
      entryPrice,
      slPrice,
      tpPrice: finalTpPrice,
      contracts,
      leverage: effectiveLeverage,
      expectedMaxLossUSD: maxLossUSD,
      expectedRewardUSD,
      riskRewardRatio: bracketPlan.rrRatio,
      tier: legacyTier,
      bucket: bracketPlan.bucket,
      tierLabel: bracketPlan.tierLabel,
      canAlsoTriggerOption: bracketPlan.canTriggerOptionSeat,
      expectedRoePct: netRoeAfterFeesPct,
      grossRoePct,
      netRoeAfterFeesPct,
      breakevenPlusFeeTriggerPrice: bracketPlan.breakevenPlusFeeTriggerPrice,
      breakevenPlusFeeLockPrice: bracketPlan.breakevenPlusFeeLockPrice,
      runner23PctTriggerPrice: bracketPlan.runner23PctTriggerPrice,
      runner18PctLockPrice: bracketPlan.runner18PctLockPrice,
      trailTriggerPrice: bracketPlan.breakevenPlusFeeTriggerPrice,
      trailActivationPrice: bracketPlan.breakevenPlusFeeTriggerPrice,
      trailLockPrice: bracketPlan.breakevenPlusFeeLockPrice,
      useOptionsSlot: tierPlan?.useOptionsSlot ?? bracketPlan.canTriggerOptionSeat,
      targetProfitUSD: bracketPlan.expectedProfitUSD || expectedRewardUSD,
      tickSize: effectiveTickSize,
      reversalWallPrice: bracketPlan.nearestReversalWall ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // COMPATIBILITY SHIMS FOR LEGACY CALLERS
  // --------------------------------------------------------------------------
  public static evaluatePreTradeGate(params: any): PreTradeVerdict {
    const res = this.validateAndBuildBracket({
      symbol: params.symbol,
      side: params.side,
      entryPrice: params.currentPrice,
      candles15m: params.candles15m || [],
      contractValue: params.contractValue || 1.0,
      activePositions: (params.activePositions || []).map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        unrealizedPnL: p.pnlUSD || 0,
      })),
      btcCandles15m: params.btcCandles15m,
      ethCandles15m: params.ethCandles15m,
    });

    const slDist = Math.abs(res.entryPrice - res.slPrice);
    const tpDist = Math.abs(res.tpPrice - res.entryPrice);

    return {
      allowed: res.approved,
      reason: res.vetoReason || 'Approved by UniversalTradeGuard',
      originalSide: params.side,
      executedSide: res.side,
      isFlipped: false,
      reversalTag: 'DIRECT_EXECUTION',
      entryPrice: res.entryPrice,
      stopLossPrice: res.slPrice,
      takeProfitPrice: res.tpPrice,
      tp1Price: res.tpPrice,
      tp2Price: res.tpPrice,
      slDistance: slDist,
      tpDistance: tpDist,
      actualRR: res.riskRewardRatio,
      quantity: res.contracts * (params.contractValue || 1.0),
      marginUSD: 0,
      notionalUSD: res.contracts * res.entryPrice * (params.contractValue || 1.0),
      riskCapUSD: res.expectedMaxLossUSD,
      structuralTargetDescription: 'Structural Wall TP',
      isFastScalp: true,
      slotType: 'FAST_SCALP',
    };
  }

  public static evaluateLiveProfitLock(params: any): LiveProfitAction {
    const pnl = params.position?.pnlUSD || 0;
    if (!this.canSoftwareClosePosition(pnl)) {
      return {
        shouldClose100: false,
        updateBrackets: false,
        ratchetStage: 0,
        closeReason: 'BLOCKED_BY_GUARD_PNL_NEGATIVE',
      };
    }
    return {
      shouldClose100: false,
      updateBrackets: false,
      ratchetStage: 0,
      closeReason: '',
    };
  }

  public static calculateSweepProofSL(params: any): { stopLossPrice: number; slDistance: number } {
    const atr = params.atr || 1.0;
    const { slPrice } = findStructuralBracket(params.candles15m || [], params.side, params.entryPrice, atr, params.tickSize);
    return { stopLossPrice: slPrice, slDistance: Math.abs(params.entryPrice - slPrice) };
  }

  public static calculateUniversalStructuralTP(params: any): { targetPrice: number; targetDistance: number; structuralRR: number; description: string } {
    const atr = calcATR(params.candles15m || [], 14);
    const { tpPrice } = findStructuralBracket(params.candles15m || [], params.side, params.entryPrice, atr, params.tickSize);
    const slDist = params.slDistance || 1.0;
    const tpDist = Math.abs(tpPrice - params.entryPrice);
    return { targetPrice: tpPrice, targetDistance: tpDist, structuralRR: Number((tpDist / Math.max(slDist, 1e-8)).toFixed(2)), description: 'Structural Wall' };
  }

  /**
   * LIVE MARKET REVERSAL DETECTOR FOR OPEN PROFITABLE POSITIONS
   * - BLOCKS premature 4%-9% ROE exits (<15% ROE & <$5.00 USD) unless explicit opposing 15m candle closes across EMA 9!
   * - Once >= 15% ROE (or >= $5.00 USD), triggers immediate harvest if 5m/15m shows Shooting Star / Hammer / Engulfing reversal!
   */
  public static detectLiveReversalAgainstPosition(params: {
    side: 'BUY' | 'SELL';
    entryPrice: number;
    currentPrice: number;
    unrealizedPnL: number;
    currentRoePct?: number;
    candles5m: KlinePoint[];
    candles15m: KlinePoint[];
  }): { shouldExitNow: boolean; tightenSlTo?: number; reversalReason?: string } {
    const { side, entryPrice, currentPrice, unrealizedPnL, currentRoePct, candles5m, candles15m } = params;

    // NEVER allow software to close when in a loss!
    if (unrealizedPnL <= 0.85) {
      return { shouldExitNow: false };
    }

    // PART 5 SHIELD: Forbid premature 4%–9% ROE software exits!
    // When currentRoePct < 15.0% and profit < $5.00 USD, ONLY exit if an explicit opposing 15m candle closes across EMA 9!
    const isSubTargetProfit = (currentRoePct !== undefined ? currentRoePct < 15.0 : false) && unrealizedPnL < 5.00;
    if (isSubTargetProfit) {
      if (!candles15m || candles15m.length < 15) return { shouldExitNow: false };
      const closed15 = candles15m.slice(0, -1);
      const c15 = closed15[closed15.length - 1];
      const prev15 = closed15[closed15.length - 2];
      if (!c15 || !prev15) return { shouldExitNow: false };
      const ema9_15 = calcEMA(closed15.map((k) => k.close), 9).pop() || currentPrice;

      if (side === 'BUY' && c15.close < c15.open && c15.close < ema9_15 && prev15.close >= ema9_15) {
        return {
          shouldExitNow: true,
          tightenSlTo: Math.max(entryPrice * 1.0018, c15.low * 0.9995),
          reversalReason: `EXPLICIT_15M_EMA9_CROSS_BEARISH_EXIT`,
        };
      }
      if (side === 'SELL' && c15.close > c15.open && c15.close > ema9_15 && prev15.close <= ema9_15) {
        return {
          shouldExitNow: true,
          tightenSlTo: Math.min(entryPrice * 0.9982, c15.high * 1.0005),
          reversalReason: `EXPLICIT_15M_EMA9_CROSS_BULLISH_EXIT`,
        };
      }
      return { shouldExitNow: false };
    }

    const activeCandles = candles5m && candles5m.length > 20 ? candles5m : candles15m;
    const closed = activeCandles.slice(0, -1);
    const c = closed[closed.length - 1];
    const prev = closed[closed.length - 2];
    if (!c || !prev) return { shouldExitNow: false };

    const closes = closed.map((k) => k.close);
    const ema9 = calcEMA(closes, 9).pop() || currentPrice;
    const rsi = calcRSI(closes, 14);

    const bodyTop = Math.max(c.open, c.close);
    const bodyBot = Math.min(c.open, c.close);
    const bodySize = bodyTop - bodyBot;
    const candRange = Math.max(c.high - c.low, 1e-8);
    const upperWick = c.high - bodyTop;
    const lowerWick = bodyBot - c.low;
    const isRed = c.close < c.open;
    const isGreen = c.close > c.open;

    if (side === 'BUY') {
      // We are LONG and in profit — check if market is starting to reverse DOWN:
      const isShootingStar = upperWick >= candRange * 0.50 && isRed;
      const isBearishEngulf = isRed && c.close < Math.min(prev.open, prev.close) && bodySize >= candRange * 0.50;
      const brokeBelowEma9 = isRed && c.close < ema9 && prev.close >= ema9;
      const rsiOverboughtTurn = rsi >= 68 && isRed;

      if (isShootingStar || isBearishEngulf || brokeBelowEma9 || rsiOverboughtTurn) {
        return {
          shouldExitNow: true,
          tightenSlTo: Math.max(entryPrice * 1.0018, c.low * 0.9995),
          reversalReason: `LIVE_BEARISH_REVERSAL_DETECTED_ON_PROFITABLE_LONG`,
        };
      }
    } else {
      // We are SHORT and in profit — check if market is starting to reverse UP:
      const isHammer = lowerWick >= candRange * 0.50 && isGreen;
      const isBullishEngulf = isGreen && c.close > Math.max(prev.open, prev.close) && bodySize >= candRange * 0.50;
      const brokeAboveEma9 = isGreen && c.close > ema9 && prev.close <= ema9;
      const rsiOversoldTurn = rsi <= 32 && isGreen;

      if (isHammer || isBullishEngulf || brokeAboveEma9 || rsiOversoldTurn) {
        return {
          shouldExitNow: true,
          tightenSlTo: Math.min(entryPrice * 0.9982, c.high * 1.0005),
          reversalReason: `LIVE_BULLISH_REVERSAL_DETECTED_ON_PROFITABLE_SHORT`,
        };
      }
    }

    return { shouldExitNow: false };
  }
}

/**
 * ============================================================================
 * MASTER-LEVEL OPTIONS TRADING ENGINE FOR DELTA EXCHANGE
 * Designed for 2 Dedicated Option Slots with Spot-Synced SL & Spread Protection
 * ============================================================================
 */
export interface OptionProductMeta {
  symbol: string;
  underlyingAsset: 'BTC' | 'ETH';
  contractType: 'call_options' | 'put_options';
  strikePrice: number;
  expiryTime: number;
  tickSize: number;
  contractValue: number;
  delta?: number;
}

export interface OptionTradePlan {
  optionSymbol: string;
  contractType: 'call_options' | 'put_options';
  strikePrice: number;
  entryPremiumLimit: number;
  optionSlPrice: number;
  optionTpPrice: number;
  spotSlPrice: number; // Linked directly to underlying BTC/ETH Spot SL
  maxRiskUSD: number;
  targetProfitUSD: number;
  expectedRoePct: number;
  trailingActivationPremium: number;
  trailingLockPremium: number;
}

export class DeltaOptionsMasterEngine {
  /**
   * 1. SELECTS THE OPTIMAL SLIGHTLY ITM / ATM STRIKE (DELTA 0.55 - 0.65)
   * Prevents buying near-expiring (<20h) OTM options that lose value rapidly to Theta decay.
   */
  public static selectOptimalOptionContract(params: {
    underlying: 'BTC' | 'ETH';
    direction: 'BUY' | 'SELL'; // BUY for Call, SELL for Put
    currentSpotPrice: number;
    availableOptions: OptionProductMeta[];
    nowMs?: number;
  }): OptionProductMeta | null {
    const { underlying, direction, currentSpotPrice, availableOptions, nowMs } = params;
    const targetType = direction === 'BUY' ? 'call_options' : 'put_options';

    const now = nowMs ?? Date.now();
    const toExpiryMs = (opt: OptionProductMeta) =>
      opt.expiryTime < 1e12 ? opt.expiryTime * 1000 : opt.expiryTime;

    // Require >= 20 hours to expiry (blocks rapid Theta burn) and <= 7 days (168h)
    const validCandidates = availableOptions.filter((opt) => {
      const expiryMs = toExpiryMs(opt);
      const hoursToExpiry = (expiryMs - now) / (1000 * 60 * 60);
      return (
        opt.underlyingAsset === underlying &&
        opt.contractType === targetType &&
        hoursToExpiry >= 20 &&
        hoursToExpiry <= 168
      );
    });

    if (validCandidates.length === 0) return null;

    // Prefer nearest qualifying expiry bucket (>= 20h) first so short-term Spot swings map cleanly
    const minExpMs = Math.min(...validCandidates.map((o) => toExpiryMs(o)));
    const nearestExpiryCandidates = validCandidates.filter(
      (o) => toExpiryMs(o) <= minExpMs + 6 * 3600 * 1000
    );

    const pickFromPool = (pool: OptionProductMeta[]): OptionProductMeta | null => {
      // A. Prefer genuine Delta in 0.55–0.65 (Slightly ITM) when live Greeks delta is supplied
      const deltaItmPool = pool.filter((opt) => {
        if (opt.delta === undefined || !Number.isFinite(opt.delta) || opt.delta === 0) return false;
        if (direction === 'BUY') {
          return opt.strikePrice <= currentSpotPrice * 1.003 && opt.delta >= 0.54 && opt.delta <= 0.66;
        }
        return opt.strikePrice >= currentSpotPrice * 0.997 && opt.delta <= -0.54 && opt.delta >= -0.66;
      });
      if (deltaItmPool.length > 0) {
        deltaItmPool.sort(
          (a, b) => Math.abs(Math.abs(a.delta!) - 0.59) - Math.abs(Math.abs(b.delta!) - 0.59)
        );
        return deltaItmPool[0];
      }

      // B. Strictly Slightly ITM by strike (Call < Spot*0.9985, Put > Spot*1.0015 -> avoids ATM 74200/74400 noise!)
      const strictItmPool = pool.filter((opt) =>
        direction === 'BUY'
          ? opt.strikePrice <= currentSpotPrice * 0.9985
          : opt.strikePrice >= currentSpotPrice * 1.0015
      );
      if (strictItmPool.length > 0) {
        strictItmPool.sort(
          (a, b) => Math.abs(a.strikePrice - currentSpotPrice) - Math.abs(b.strikePrice - currentSpotPrice)
        );
        return strictItmPool[0];
      }

      // C. Slightly ITM / ATM tolerance pool (strike <= Spot * 1.003 for Call, >= Spot * 0.997 for Put)
      const nearItmPool = pool.filter((opt) =>
        direction === 'BUY'
          ? opt.strikePrice <= currentSpotPrice * 1.003
          : opt.strikePrice >= currentSpotPrice * 0.997
      );
      if (nearItmPool.length > 0) {
        nearItmPool.sort(
          (a, b) => Math.abs(a.strikePrice - currentSpotPrice) - Math.abs(b.strikePrice - currentSpotPrice)
        );
        return nearItmPool[0];
      }

      return null;
    };

    const matchNearest = pickFromPool(nearestExpiryCandidates);
    if (matchNearest) return matchNearest;

    const matchAny = pickFromPool(validCandidates);
    if (matchAny) return matchAny;

    // Final fallback to closest strike across >= 20h valid expiries
    const sortedFallback = [...validCandidates].sort(
      (a, b) => Math.abs(a.strikePrice - currentSpotPrice) - Math.abs(b.strikePrice - currentSpotPrice)
    );
    return sortedFallback[0];
  }

  /**
   * 2. VALIDATES ORDERBOOK SPREAD (<= 2.2%) & CALCULATES SPOT-SYNCED LIMIT BRACKET
   */
  public static buildOptionBracketPlan(params: {
    optionMeta: OptionProductMeta;
    bestBid: number;
    bestAsk: number;
    markPrice: number;
    spotEntryPrice: number;
    spotSlPrice: number; // Underlying spot structural SL
    spotTpPrice: number; // Underlying spot front-run TP
  }): { approved: boolean; plan?: OptionTradePlan; vetoReason?: string } {
    const { optionMeta, bestBid, bestAsk, markPrice, spotEntryPrice, spotSlPrice, spotTpPrice } = params;

    // A. Two-sided Liquidity + Strict Spread Check (Max 2.2% allowable spread)
    if (!bestBid || bestBid <= 0 || !bestAsk || bestAsk <= 0) {
      return {
        approved: false,
        vetoReason: `OPTION_SPREAD_TOO_WIDE: Missing two-sided quotes (bestBid=${bestBid}, bestAsk=${bestAsk})`,
      };
    }
    const spreadPct = (bestAsk - bestBid) / bestBid;
    if (spreadPct > 0.022) {
      return {
        approved: false,
        vetoReason: `OPTION_SPREAD_TOO_WIDE: ${(spreadPct * 100).toFixed(2)}% (Max allowed 2.2%)`,
      };
    }

    const tick = optionMeta.tickSize > 0 ? optionMeta.tickSize : 0.5;
    const rawLimit = Math.min(bestAsk, markPrice > 0 ? markPrice * 1.004 : bestAsk);
    const entryPremiumLimit = roundToTickSize(rawLimit, tick);
    if (!Number.isFinite(entryPremiumLimit) || entryPremiumLimit <= 0) {
      return { approved: false, vetoReason: `INVALID_OPTION_PREMIUM_PRICE` };
    }

    // B. Spot-Synced Risk Ratios
    const spotMoveToTpPct =
      spotEntryPrice > 0 ? Math.abs(spotTpPrice - spotEntryPrice) / spotEntryPrice : 0.015;
    const optionLeverageFactor = 3.0;

    // C. Option Premium SL (-18% hard stop on premium, rounded cleanly to tickSize)
    const maxPremiumLossPct = 0.18;
    let optionSlPrice = roundToTickSize(Math.max(tick, entryPremiumLimit * (1 - maxPremiumLossPct)), tick);
    if (optionSlPrice >= entryPremiumLimit) {
      optionSlPrice = roundToTickSize(Math.max(tick, entryPremiumLimit - tick * 2), tick);
    }

    // D. Option Premium TP (+35% to +75% synchronized with spot TP)
    const impliedOptionGainPct = Math.min(0.75, Math.max(0.35, spotMoveToTpPct * optionLeverageFactor));
    let optionTpPrice = roundToTickSize(entryPremiumLimit * (1 + impliedOptionGainPct), tick);
    if (optionTpPrice <= entryPremiumLimit) {
      optionTpPrice = roundToTickSize(entryPremiumLimit + tick * 4, tick);
    }

    // E. Trailing Locks (+25% premium gain triggers +15% locked floor)
    const trailingActivationPremium = roundToTickSize(entryPremiumLimit * 1.25, tick);
    const trailingLockPremium = roundToTickSize(entryPremiumLimit * 1.15, tick);

    const expectedRoePct = Number((impliedOptionGainPct * 100).toFixed(1));

    const plan: OptionTradePlan = {
      optionSymbol: optionMeta.symbol,
      contractType: optionMeta.contractType,
      strikePrice: optionMeta.strikePrice,
      entryPremiumLimit,
      optionSlPrice,
      optionTpPrice,
      spotSlPrice,
      maxRiskUSD: 4.00, // Strict $4 risk budget per option slot
      targetProfitUSD: Number((4.00 * (impliedOptionGainPct / maxPremiumLossPct)).toFixed(2)),
      expectedRoePct,
      trailingActivationPremium,
      trailingLockPremium,
    };

    return { approved: true, plan };
  }
}

export const universalTradeGuard = new UniversalTradeGuard();
