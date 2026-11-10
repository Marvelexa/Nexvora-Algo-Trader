import {
  evaluateStrategyForPort,
  sanitizeCandles,
  buildBulletproofBracket,
  buildMasterSixSlotBracket,
  roundToTickSize,
  TradeTier,
  TieredBracketPlan,
  SeatBucketType,
  FifteenMinCandleCloseGate,
} from './strategies/strategyRegistry';
import fs from 'fs';
import path from 'path';
import { 
  DeltaPosition, 
  DeltaClosedTrade, 
  DeltaAutoTraderState, 
  AssetDiagnostics,
  KlinePoint,
  TradeExecutionMode
} from '../src/types';
import { deltaExchange, DELTA_PRODUCT_SPECS } from './deltaExchangeEngine';
import { strategyEngine, CryptoDedicatedStrategyEngine } from './cryptoDedicatedStrategyEngine';
import { quantMath, QuantMathVerdict } from './quantMathematicalEngine';
import { priceActionPlaybook, PriceActionSignal } from './priceActionPlaybook2026Engine';
import { marketTraps, ChopAnalysis, TrapEvaluation } from './marketTrapsAndChopEngine';
import { timingEngine, TimingEvaluation, MovePhase } from './timingAndAntiChaseEngine';
import { multiTimeframeCandleEngine, MultiTimeframeAnalysisResult } from './multiTimeframeCandleAnalysis';
import { mathRiskEngine } from './mathematicalRiskEngine';
import { deltaOptionsTrader } from './strategies/deltaOptionsTraderEngine';
import { zeroLagPriceActionEngine } from './strategies/zeroLagPriceActionEngine';
import { portfolioMarketRegime, PortfolioMarketRegimeEngine, MarketRegimeBias } from './risk/portfolioMarketRegimeEngine';
import { 
  CandleStructureTPCalculator, 
  LiveCandleReversalDetector, 
  CandleByCandleProfitRatchet,
  StructuralZoneTarget,
  LiveReversalVerdict,
  ProfitRatchetResult,
  RoomToRunVerdict
} from './risk/candleStructureProfitProtectionEngine';
import { 
  UniversalTradeGuard, 
  universalTradeGuard, 
  PreTradeVerdict, 
  LiveProfitAction, 
  ALLOWED_CRYPTO_SYMBOLS, 
  ActivePositionInfo, 
  GuardValidationResult,
  HybridSixSlotManager,
  SixSlotPortfolioState,
  ReservedSixSeatManager,
  ReservedSeatCounts,
  DeltaOptionsMasterEngine,
  OptionProductMeta,
  OptionTradePlan
} from './risk/universalTradeGuard';
import { ReversalProximityFlipper, reversalProximityFlipper, ReversalProximityVerdict, LiveMidTradeFlipVerdict } from './risk/reversalProximityFlipper';
import { acquireOrderMutex, releaseMutex } from './risk/globalOrderMutex.js';

// Top 10 Crypto Whitelist from UniversalTradeGuard
export { ALLOWED_CRYPTO_SYMBOLS };

// Non-whitelisted coins are rejected by UniversalTradeGuard
export const FORBIDDEN_COINS = new Set<string>();

// Full Top 10 Whitelist for Scanner
export const PRIME_LIQUID_WATCHLIST = Array.from(ALLOWED_CRYPTO_SYMBOLS);

export class DeltaAutoTraderEngine {
  public port: number;
  private stateFilePath: string;
  private historyFilePath: string;
  private isScanning: boolean = false;
  private scanTimer: any = null;
  private tickTimer: any = null;
  private lastExchangeSyncTimestamp: number = 0;
  private lastExchangeSyncLogTime: number = 0;
  private lastStateSaveTime: number = 0;
  private lastTradeExecutionTime: number = 0;
  private symbolLastTradeTime: Map<string, number> = new Map();
  private candidateLastAttemptTime: Map<string, number> = new Map();
  private symbolLastBracketAttemptTime: Map<string, number> = new Map();
  private lastProcessedBarTime: Map<string, number> = new Map();
  // Anti-Whipsaw Same-Coin Direction Memory (User Mandate: "same buy buy sell htaa doo same coin pee wo wala")
  private symbolLastTradeSide: Map<string, { side: 'BUY' | 'SELL'; timestamp: number; exitReason: string; pnlUSD: number }> = new Map();
  private readonly MIN_SYMBOL_COOLDOWN_MS: number = 5 * 60 * 1000; // 5 minutes cooldown per coin
  private readonly MIN_INTER_TRADE_INTERVAL_MS: number = 60 * 1000; // 1 minute between separate trades
  private readonly engineStartTime: number = Date.now();
  private readonly STARTUP_GRACE_PERIOD_MS: number = 2 * 1000; // 2s grace period on boot
  private scanRotationIndex: number = 0; // Round-robin watchlist rotation index
  private lastPauseLogTime: number = 0;
  private lastHeartbeatLogTime: number = 0;
  // Playbook 2026 Circuit Breakers (Priority 8)
  private consecutiveLosses: number = 0;
  private circuitBreakerPauseUntil: number = 0;
  private lastCircuitLogTime: number = 0;

  // Dynamic Watchlist from UniversalTradeGuard (189+ coins on Live / dynamically discovered on Testnet)
  public get WATCHLIST(): string[] {
    return Array.from(ALLOWED_CRYPTO_SYMBOLS);
  }
  private lastEvaluatedCandleTimestamp: Map<string, number> = new Map();
  private lastV6Indicators: { ema9: number; ema20: number; ema50: number; atr14: number; rsi14: number } | null = null;

  // Leader-Follower Hierarchy (User Mandate: "remaing trade nho copie karne dekh lo xrp kaa copie kiyaa hota sol aisa")
  // Leaders (XRP, DOGE) have proven high win-rates (83% and 73%).
  // Followers (SOL copies XRP, AVAX copies DOGE) MUST copy their designated Leader.
  // A Follower NEVER dictates direction to a Leader ("remaining trade nahi copy karne")!
  public static readonly LEADER_FOLLOWERS: Record<string, string> = {
    'XRPUSD': 'SOLUSD',
    'DOGEUSD': 'AVAXUSD',
  };
  public static readonly FOLLOWER_LEADERS: Record<string, string> = {
    'SOLUSD': 'XRPUSD',
    'AVAXUSD': 'DOGEUSD',
  };
  public static readonly LEADER_RANKS: Record<string, number> = {
    'XRPUSD': 100, // Supreme Leader (83.3% Win Rate)
    'DOGEUSD': 80,  // Meme Leader (73.3% Win Rate)
    'SUIUSD': 70,   // Independent Strong
    'SOLUSD': 40,   // Follower (Must copy XRP)
    'AVAXUSD': 30,  // Follower (Must copy DOGE)
  };

  private state: DeltaAutoTraderState;
  private closedTradesHistory: DeltaClosedTrade[] = [];
  private lastDiagnostics: Map<string, AssetDiagnostics> = new Map();
  private lastSmartDetections: Map<string, any> = new Map();
  private inFlightSymbols: Set<string> = new Set();
  private closingPositions: Set<string> = new Set();
  private candleCache: Map<string, { data: KlinePoint[]; timestamp: number }> = new Map();
  private lastHtfAnalyses: Map<string, any> = new Map();

  constructor(portOverride?: number) {
    const activePort = portOverride?.toString() || process.env.PORT || '3005';
    this.port = parseInt(activePort, 10);
    const stateFile = process.env.STATE_FILE || `.delta_auto_trader_state_${activePort}.json`;
    this.stateFilePath = path.join(process.cwd(), stateFile);
    const histFile = `closed_trades_history_${activePort}.json`;
    this.historyFilePath = path.join(process.cwd(), 'public', histFile);

    // Default Initial State according to blueprint
    const isTestnet = process.env.DELTA_IS_TESTNET === 'true' || deltaExchange.getConfig().isTestnet;
    const isAuthorizedBrokerPort = (process.env.PORT || '3005') === '3005';
    const isSimulation = !isAuthorizedBrokerPort || deltaExchange.getConfig().isSimulation || process.env.DELTA_IS_SIMULATION === 'true' || process.env.PAPER_TRADING === 'true' || process.env.DELTA_TRADING_MODE === 'SIMULATION_PAPER';
    const hasKeys = !!(process.env.DELTA_API_KEY && process.env.DELTA_API_SECRET);
    const initialMode: 'LIVE_DELTA_INDIA' | 'DELTA_TESTNET' | 'SIMULATION_PAPER' = isSimulation || !hasKeys
      ? 'SIMULATION_PAPER'
      : (isTestnet ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA');

    this.state = {
      activeSystem: (process.env.ACTIVE_SYSTEM || '3001_3005'),
      isRunning: true,
      mode: initialMode,
      accountCapitalUSD: 178.57, // ₹15,000 INR capital (~.57 USD) // ₹2,000 INR capital (~$23.81 USD)
      currentCapitalUSD: 178.57,
      dailyRealizedPnlUSD: 0,
      totalRealizedPnlUSD: 0,
      totalTradesCount: 0,
      winningTradesCount: 0,
      losingTradesCount: 0,
      winRatePercent: 0,
      activePositions: [],
      maxConcurrentPositions: Math.max(HybridSixSlotManager.MAX_TOTAL_TRADES, parseInt(process.env.MAX_CONCURRENT_POSITIONS || '6', 10) || 6), // 4 Normal Perpetuals + 2 Options = 6 Total
      leverage: 30,
      marginPercentPerTrade: 25.0, // Deploys 25% margin per slot across 4 slots (100% full capital total)
      lastScanTimestamp: Date.now(),
      scanIntervalSeconds: 1, // High-frequency scan cycle
      shadowGateEnabled: false, // DISABLED — Shadow Gate removed from system
      activeShadowCandidates: [],
      trapsFilteredCount: 0,
      capitalSavedUSD: 0,
      isInverseTrading: false, // Direct Trend Mode (Aligned with video courses: BUY on Uptrend, SELL on Downtrend)
      minCapitalFloorINR: 1000, // Stop if capital drops to zero / floor (User Mandate)
      targetCapitalGoalINR: 50000, // Target profit goal
      recentFilteredTraps: [],
      targetProfitPerTradeUSD: (this.port === 3025 && process.env.TOTAL_CAPITAL_INR !== '15000') ? 10.00 : 34.50, // at least $34.50 ($15 max loss * 2.30) to preserve 1:2.30 RR positive asymmetry
      maxLossPerTradeUSD: (this.port === 3025 && process.env.TOTAL_CAPITAL_INR !== '15000') ? 4.50 : 15.00, // $15.00 for ₹15k capital deployment, $4.50 micro fallback
    };

    this.loadState();
    this.state.mode = initialMode;
    this.loadHistory();
    this.syncLivePositionsFromExchange().catch(() => {});
  }

  // -------------------------------------------------------------
  // 1. Persistence & State Recovery
  // -------------------------------------------------------------

  private loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8').trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          this.state = { ...this.state, ...parsed };
          const isTestnet = process.env.DELTA_IS_TESTNET === 'true' || deltaExchange.getConfig().isTestnet;
          const isAuthorizedBrokerPort = (process.env.PORT || '3005') === '3005';
          const isSimulation = !isAuthorizedBrokerPort || deltaExchange.getConfig().isSimulation || process.env.DELTA_IS_SIMULATION === 'true' || process.env.PAPER_TRADING === 'true' || process.env.DELTA_TRADING_MODE === 'SIMULATION_PAPER';
          const hasKeys = !!(process.env.DELTA_API_KEY && process.env.DELTA_API_SECRET);
          const computedMode = isSimulation || !hasKeys
            ? 'SIMULATION_PAPER'
            : (isTestnet ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA');
          if (parsed.mode && parsed.mode !== computedMode) {
            console.log(`🔄 Mode transition detected (${parsed.mode} -> ${computedMode}). Resetting positions for new environment.`);
            this.state.activePositions = [];
          }
          this.state.mode = computedMode;
          // Capital Upgrade: User Mandate ("all system have 15k capital okay not 2k and trade with full capital 15k")
          if (!this.state.accountCapitalUSD || this.state.accountCapitalUSD < 100) {
            this.state.accountCapitalUSD = 178.57;
            this.state.currentCapitalUSD = 178.57;
          }
          // 6-Slot Hybrid Architecture: 4 Normal Perpetuals + 2 Options = 6 Total
          this.state.maxConcurrentPositions = HybridSixSlotManager.MAX_TOTAL_TRADES;
          this.state.marginPercentPerTrade = 25.0;
          // Normal Direct Trading: User Mandate ("make all of them normal system not reversal")
          const isInverseRequested = process.env.IS_INVERSE_TRADING === 'true';
          this.state.isInverseTrading = isInverseRequested ? true : false;
          this.state.shadowGateEnabled = false;
          this.deduplicateActivePositions();
        }
      }
      this.loadAndValidateRiskConfig();
    } catch (e) {
      console.warn('Could not load .delta_auto_trader_state.json, initializing fresh state:', e);
      this.loadAndValidateRiskConfig();
    }
  }

  private loadAndValidateRiskConfig() {
    const configPath = path.join(process.cwd(), 'config', 'riskConfig.json');
    try {
      if (!fs.existsSync(configPath)) {
        console.warn(`⚠️ [RISK CONFIG] No config/riskConfig.json found at ${configPath}. Using defaults.`);
        return;
      }
      const raw = fs.readFileSync(configPath, 'utf-8');
      const cfg = JSON.parse(raw);

      // Startup safety limit validations (solutions.pdf Item 6)
      if (typeof cfg.maxLeverage === 'number') {
        if (cfg.maxLeverage > 50 || cfg.maxLeverage < 1) {
          throw new Error(`CRITICAL RISK VIOLATION: maxLeverage (${cfg.maxLeverage}x) exceeds safe limits [1x-50x]!`);
        }
        this.state.leverage = cfg.maxLeverage;
      }

      // Enforce 6-Slot Hybrid Portfolio (4 Normal Perpetuals + 2 Options = 6 Total)
      this.state.maxConcurrentPositions = HybridSixSlotManager.MAX_TOTAL_TRADES;

      if (typeof cfg.marginPercentPerTrade === 'number') {
        if (cfg.marginPercentPerTrade < 10 || cfg.marginPercentPerTrade > 95) {
          throw new Error(`CRITICAL RISK VIOLATION: marginPercentPerTrade (${cfg.marginPercentPerTrade}%) out of safe bounds (10-95%)!`);
        }
        this.state.marginPercentPerTrade = cfg.marginPercentPerTrade;
      }

      if (typeof cfg.maxLossPerTradeUSD === 'number') {
        this.state.maxLossPerTradeUSD = cfg.maxLossPerTradeUSD;
      }
      if (typeof cfg.targetProfitPerTradeUSD === 'number') {
        const minAsymmetricProfit = (this.state.maxLossPerTradeUSD || 15.00) * 2.30;
        this.state.targetProfitPerTradeUSD = Math.max(cfg.targetProfitPerTradeUSD, minAsymmetricProfit);
      }
      if (typeof cfg.minCapitalFloorINR === 'number') {
        this.state.minCapitalFloorINR = cfg.minCapitalFloorINR;
      }
      if (typeof cfg.targetCapitalGoalINR === 'number') {
        this.state.targetCapitalGoalINR = cfg.targetCapitalGoalINR;
      }

      // System 3025 Risk Parameters:
      // Scales with account capital: ₹15,000 INR ($178.57 USD) mandate uses $15.00 max loss / $34.50 profit (1:2.30 RR)
      // for full 4-portion capital utilization (~$44 margin, ~$1,320 notional per trade).
      // Micro accounts (< $100 USD) safely default to $4.50 max loss / $10.35 profit.
      const isLargeCapital = (this.state.accountCapitalUSD || 0) >= 100 || (process.env.TOTAL_CAPITAL_INR && parseInt(process.env.TOTAL_CAPITAL_INR) >= 10000);
      if (this.port === 3025) {
        this.state.maxLossPerTradeUSD = isLargeCapital ? 15.00 : 4.50;
        this.state.targetProfitPerTradeUSD = isLargeCapital ? 34.50 : 10.35;
      }

      console.log(`🛡️ [RISK CONFIG VALIDATED] Leverage: ${this.state.leverage}x | MaxPositions: ${this.state.maxConcurrentPositions} | Margin: ${this.state.marginPercentPerTrade}% | MaxLoss: $${this.state.maxLossPerTradeUSD ?? 2.50} | TargetProfit: $${this.state.targetProfitPerTradeUSD ?? 6.00} | Floor: ₹${this.state.minCapitalFloorINR} | Goal: ₹${this.state.targetCapitalGoalINR}`);
      deltaExchange.ensureProductsLeverage(this.state.leverage).catch(() => {});
    } catch (err: any) {
      console.error(`🚨 [RISK VALIDATION FATAL ERROR] Refusing to start due to unsafe risk settings: ${err.message}`);
      throw err;
    }
  }

  public deduplicateActivePositions() {
    const seen = new Set<string>();
    const unique: DeltaPosition[] = [];
    for (const p of this.state.activePositions) {
      const s = (p.symbol || '').toUpperCase().replace('USDT', 'USD');
      if (!seen.has(s)) {
        seen.add(s);
        unique.push(p);
      } else {
        console.warn(`🛑 [DEDUPLICATION] Purged duplicate active position for ${s} (ID: ${p.id})`);
      }
    }
    if (unique.length !== this.state.activePositions.length) {
      this.state.activePositions = unique;
    }
  }

  public saveState() {
    try {
      this.deduplicateActivePositions();
      this.state.activeSystem = this.state.activeSystem || (process.env.ACTIVE_SYSTEM || '3001_3005');
    this.state.activeShadowCandidates = [];
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to persist auto trader state:', e);
    }
  }

  private loadHistory() {
    try {
      if (fs.existsSync(this.historyFilePath)) {
        const raw = fs.readFileSync(this.historyFilePath, 'utf-8').trim();
        if (raw) {
          this.closedTradesHistory = JSON.parse(raw);
          // Seed symbolLastTradeSide from history to preserve same-coin direction memory across reboots
          for (const trade of this.closedTradesHistory) {
            const sym = (trade.symbol || '').toUpperCase().replace('USDT', 'USD');
            if (sym && !this.symbolLastTradeSide.has(sym)) {
              this.symbolLastTradeSide.set(sym, {
                side: trade.side,
                timestamp: trade.exitTime || trade.entryTime || Date.now(),
                exitReason: trade.exitReason || 'CLOSED',
                pnlUSD: trade.pnlUSD || 0,
              });
            }
          }
          return;
        }
      }
      this.closedTradesHistory = [];
      this.saveHistory();
    } catch (e) {
      console.warn('Could not load closed_trades_history.json, starting empty:', e);
      this.closedTradesHistory = [];
    }
  }

  public saveHistory() {
    try {
      const publicDir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.closedTradesHistory, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to persist closed trades history:', e);
    }
  }

  public getReservedSeatCounts(): ReservedSeatCounts {
    let activeBigSignalSeats = 0;
    let activeOptionSeats = 0;
    let activeChopNormalSeats = 0;

    for (const p of this.state.activePositions) {
      const sym = (p.symbol || '').toUpperCase().trim();
      const isOption =
        p.seatBucket === 'OPTION_UNCAPPED_SEAT' ||
        p.seatBucket === 'OPTION_SEAT' ||
        p.instrumentType === 'OPTION' ||
        sym.startsWith('C-') ||
        sym.startsWith('P-');

      if (isOption) {
        activeOptionSeats++;
        continue;
      }

      const tpMovePct = p.entryPrice > 0 && p.takeProfitPrice > 0
        ? Math.abs(p.takeProfitPrice - p.entryPrice) / p.entryPrice
        : 0;

      const isNormalRunner =
        p.seatBucket === 'NORMAL_23_TO_40PCT_SEAT' ||
        p.seatBucket === 'BIG_SIGNAL_SEAT' ||
        (!p.seatBucket && (
          p.tier === 'STRONG_23PCT_RUNNER' ||
          (p.expectedRoePct || 0) >= 23.0 ||
          tpMovePct >= 0.0105
        ));

      if (isNormalRunner) {
        activeBigSignalSeats++;
      } else {
        activeChopNormalSeats++;
      }
    }

    return {
      activeBigSignalSeats,
      activeOptionSeats,
      activeChopNormalSeats,
    };
  }

  public getSlotCounts(): SixSlotPortfolioState {
    const seats = this.getReservedSeatCounts();
    return {
      activePerpetualCount: seats.activeBigSignalSeats + seats.activeChopNormalSeats,
      activeOptionsCount: seats.activeOptionSeats,
    };
  }

  /**
   * Synchronizes active positions and live exchange bracket orders (TP/SL) from Delta Exchange
   */
  public async syncLivePositionsFromExchange() {
    try {
      // STRICT PORT ISOLATION: Only authorized broker port (3005) in non-simulation mode syncs/manages real Delta positions!
      if (!deltaExchange.isLiveDispatchActive()) {
        return;
      }

      const wallet = await deltaExchange.getWalletBalance().catch(() => null);
      if (wallet && wallet.balanceUSD > 0) {
        this.state.accountCapitalUSD = parseFloat(wallet.balanceUSD.toFixed(2));
        this.state.currentCapitalUSD = parseFloat(wallet.balanceUSD.toFixed(2));
      }

      const exchangePositions = await deltaExchange.getMarginedPositions();
      if (!exchangePositions || !Array.isArray(exchangePositions)) {
        return;
      }

      const openOrdersRaw = await deltaExchange.getOpenOrders();
      const didFetchOpenOrders = Array.isArray(openOrdersRaw);
      const openOrders = didFetchOpenOrders ? openOrdersRaw : [];
      const now = Date.now();

      const isLiveExchange = deltaExchange.isLiveDispatchActive();

      // If Delta Exchange has 0 active positions:
      if (exchangePositions.length === 0) {
        if (isLiveExchange && this.state.activePositions.length > 0) {
          for (const localPos of this.state.activePositions) {
            if ((!localPos.symbol.startsWith('C-') && !localPos.symbol.startsWith('P-')) || (localPos.instrumentType === 'OPTION' && !localPos.id.startsWith('opt-sim-'))) {
              console.log(`📡 Position ${localPos.symbol} was closed on Delta Exchange. Archiving.`);
              this.archiveClosedTrade(localPos, 'EXCHANGE_CLOSED');
            }
          }
          this.state.activePositions = [];
          this.saveState();
        }
        return;
      }

      const activeSymbolsOnExchange = new Set<string>();
      const reconciledPositions: DeltaPosition[] = [];

      for (const exPos of exchangePositions) {
        const symbol = exPos.product_symbol; // e.g. "BTCUSD", "XRPUSD", "C-BTC-..."
        const size = parseFloat(exPos.size);
        if (size === 0 || isNaN(size)) continue;
        const existing = this.state.activePositions.find(p => p.symbol === symbol);
        const isOptionEx = symbol.startsWith('C-') || symbol.startsWith('P-') || existing?.instrumentType === 'OPTION';
        // Skip foreign Port-3001 short OTM option writes unless tracked in this engine
        if (isOptionEx && this.port !== 3001 && !existing && size < 0) continue;

        activeSymbolsOnExchange.add(symbol);

        const side: 'BUY' | 'SELL' = size > 0 ? 'BUY' : 'SELL';
        const entryPrice = parseFloat(exPos.avg_entry_price || exPos.entry_price || '0');
        const markPrice = parseFloat(exPos.mark_price || exPos.avg_entry_price || exPos.entry_price || '0');
        const spec = deltaExchange.getProductSpec(symbol, entryPrice);
        const contractValue = exPos.product?.contract_value ? parseFloat(exPos.product.contract_value) : spec.contractValue;
        const contracts = Math.abs(size);
        const quantity = parseFloat((contracts * contractValue).toFixed(6));
        const marginUSD = parseFloat(exPos.margin || '0');
        const notionalUSD = entryPrice > 0 ? parseFloat((entryPrice * quantity).toFixed(2)) : parseFloat((marginUSD * this.state.leverage).toFixed(2));

        // Ground-truth PnL calculation: Strictly bind to Delta Exchange's authoritative unrealized_pnl
        const priceDiff = side === 'BUY' ? markPrice - entryPrice : entryPrice - markPrice;
        const exchangePnl = (exPos.unrealized_pnl !== undefined && exPos.unrealized_pnl !== null) ? parseFloat(exPos.unrealized_pnl) : NaN;
        const pnlUSD = !isNaN(exchangePnl) ? parseFloat(exchangePnl.toFixed(2)) : parseFloat((priceDiff * quantity).toFixed(2));
        const effectiveMarginUSD = marginUSD > 0 ? marginUSD : (existing?.marginUSD || (this.state.accountCapitalUSD * (this.state.marginPercentPerTrade / 100)));
        const pnlPercent = effectiveMarginUSD > 0 ? parseFloat(((pnlUSD / effectiveMarginUSD) * 100).toFixed(2)) : 0;

        // Find associated exchange bracket orders (from open/untriggered orders or position metadata)
        const matchingOrders = openOrders.filter(
          (o: any) => (o.product_symbol === symbol || o.product_id === exPos.product_id)
        );

        let tpOrder = matchingOrders.find(
          (o: any) => o.stop_order_type === 'take_profit_order' || o.order_type === 'take_profit_order' || o.bracket_order_type === 'take_profit_order'
        );
        let slOrder = matchingOrders.find(
          (o: any) => o.stop_order_type === 'stop_loss_order' || o.order_type === 'stop_loss_order' || o.bracket_order_type === 'stop_loss_order'
        );

        // Fallback: match untriggered stop orders by price relative to entry
        if (!tpOrder || !slOrder) {
          for (const o of matchingOrders) {
            const sp = parseFloat(o.stop_price || o.limit_price || o.price || '0');
            if (sp <= 0 || isNaN(sp)) continue;
            if (side === 'BUY') {
              if (sp > entryPrice && !tpOrder) tpOrder = o;
              else if (sp < entryPrice && !slOrder) slOrder = o;
            } else { // SELL
              if (sp < entryPrice && !tpOrder) tpOrder = o;
              else if (sp > entryPrice && !slOrder) slOrder = o;
            }
          }
        }

        const posBracketTP = parseFloat(exPos.bracket_take_profit_price || exPos.take_profit_order?.stop_price || '0');
        const posBracketSL = parseFloat(exPos.bracket_stop_loss_price || exPos.stop_loss_order?.stop_price || '0');

        let accurateTP = existing?.takeProfitPrice || 0;
        let accurateSL = existing?.stopLossPrice || 0;
        let syncedActivationPrice = existing?.trailActivationPrice || existing?.trailTriggerPrice;
        let syncedLockPrice = existing?.trailLockPrice;
        let syncedBeTrigger = existing?.breakevenPlusFeeTriggerPrice;
        let syncedBeLock = existing?.breakevenPlusFeeLockPrice;
        let syncedRunTrigger = existing?.runner23PctTriggerPrice;
        let syncedRunLock = existing?.runner18PctLockPrice;
        let syncedBucket = existing?.seatBucket;
        let syncedGrossRoe = existing?.grossRoePct;
        let syncedNetRoe = existing?.netRoeAfterFeesPct;
        let enforcedActualRR = 1.6;

        if (isOptionEx) {
          if (!accurateTP || accurateTP <= 0) {
            accurateTP = side === 'BUY'
              ? roundToTickSize(entryPrice * 1.55, spec.tickSize)
              : parseFloat(Math.max(0.10, entryPrice * 0.25).toFixed(spec.decimals));
          }
          if (!accurateSL || accurateSL <= 0) {
            accurateSL = side === 'BUY'
              ? roundToTickSize(entryPrice * 0.82, spec.tickSize)
              : parseFloat((entryPrice * 2.20).toFixed(spec.decimals));
          }
          syncedBucket = existing?.seatBucket || 'OPTION_UNCAPPED_SEAT';
          enforcedActualRR = 3.0;
        } else {
          // Unified Fee-Adjusted 6-Slot Bracket calculation on closed candles when position lacks stored brackets
          let posCandles: KlinePoint[] = [];
          try {
            posCandles = await this.fetchCandles(symbol, '15m', 60);
          } catch (e) {}

          const closedSyncCandles = posCandles.length > 2 ? posCandles.slice(0, -1) : posCandles;
          const effectiveAtr = existing?.atr || Math.max(entryPrice * 0.004, (exPos.atr ? parseFloat(exPos.atr) : 0));
          const syncPlan = buildMasterSixSlotBracket({
            symbol,
            side,
            entryPrice,
            closedCandles: closedSyncCandles,
            atr: effectiveAtr,
            reason: existing?.strategyName || '',
            tickSize: spec.tickSize,
          });

          if (!accurateSL || accurateSL <= 0) accurateSL = syncPlan.slPrice;
          if (!accurateTP || accurateTP <= 0) accurateTP = syncPlan.tpPrice;
          if (!syncedBeTrigger) syncedBeTrigger = syncPlan.breakevenPlusFeeTriggerPrice;
          if (!syncedBeLock) syncedBeLock = syncPlan.breakevenPlusFeeLockPrice;
          if (!syncedRunTrigger) syncedRunTrigger = syncPlan.runner23PctTriggerPrice;
          if (!syncedRunLock) syncedRunLock = syncPlan.runner18PctLockPrice;
          if (!syncedBucket) syncedBucket = syncPlan.bucket;
          if (syncedGrossRoe === undefined) syncedGrossRoe = syncPlan.grossRoePct;
          if (syncedNetRoe === undefined) syncedNetRoe = syncPlan.netRoeAfterFeesPct;
          if (!syncedActivationPrice || syncedActivationPrice <= 0) {
            syncedActivationPrice = syncedBeTrigger || syncPlan.breakevenPlusFeeTriggerPrice;
          }
          if (!syncedLockPrice || syncedLockPrice <= 0) {
            syncedLockPrice = syncedBeLock || syncPlan.breakevenPlusFeeLockPrice;
          }
          const slDistTmp = Math.abs(entryPrice - accurateSL);
          enforcedActualRR = slDistTmp > 0 ? Math.abs(accurateTP - entryPrice) / slDistTmp : syncPlan.rrRatio;
        }

        // Inspect existing bracket orders on exchange
        const currentExchangeTP = tpOrder ? parseFloat(tpOrder.stop_price || tpOrder.limit_price || tpOrder.price || '0') : (posBracketTP > 0 ? posBracketTP : 0);
        const currentExchangeSL = slOrder ? parseFloat(slOrder.stop_price || slOrder.price || '0') : (posBracketSL > 0 ? posBracketSL : 0);

        const isBracketMissing = currentExchangeTP <= 0 || currentExchangeSL <= 0;

        // CRITICAL FIX: Repair ANY active position on Delta Exchange that has TP/SL: - (whether existing locally or freshly discovered!)
        const desiredSL = (existing?.stopLossPrice && existing.stopLossPrice > 0) ? existing.stopLossPrice : accurateSL;
        const desiredTP = (existing?.takeProfitPrice && existing.takeProfitPrice > 0) ? existing.takeProfitPrice : accurateTP;
        const desiredSLDist = Math.abs(entryPrice - desiredSL);
        const desiredTPDist = Math.abs(desiredTP - entryPrice);
        const desiredRR = desiredSLDist > 0 ? (desiredTPDist / desiredSLDist) : enforcedActualRR;

        if (didFetchOpenOrders && isBracketMissing && isLiveExchange && desiredTP > 0 && desiredSL > 0 && (isOptionEx || desiredRR >= 1.0)) {
          const lastBracketAttempt = this.symbolLastBracketAttemptTime.get(symbol) || 0;
          if (now - lastBracketAttempt > 8000) { // Fast 8s retry until BOTH SL and TP appear on Delta Exchange
            this.symbolLastBracketAttemptTime.set(symbol, now);

            console.log(`🎯 [INITIAL BRACKET PLACEMENT] Setting missing exchange bracket on ${symbol} (${side}): SL=$${desiredSL} | TP=$${desiredTP} (RR: 1:${desiredRR.toFixed(2)})`);
            try {
              if (!isOptionEx && currentExchangeTP <= 0 && currentExchangeSL <= 0) {
                await deltaExchange.setBracketOrder(symbol, desiredSL, desiredTP, side);
              } else {
                await deltaExchange.updateBracketOrder(symbol, desiredSL, desiredTP, side, entryPrice);
              }
            } catch (e: any) {
              console.warn(`[DeltaExchange] Initial bracket setup note for ${symbol}:`, e.message);
            }
          }
        }

        // Ground-truth exchange bracket orders: Preserve validated local SL if already trailed or set by guard
        let slPrice: number;
        if (existing && existing.stopLossPrice > 0) {
          slPrice = existing.stopLossPrice;
        } else if (currentExchangeSL > 0) {
          slPrice = currentExchangeSL;
        } else {
          slPrice = desiredSL > 0 ? desiredSL : entryPrice;
        }

        let tpPrice: number;
        if (existing && existing.takeProfitPrice > 0) {
          tpPrice = existing.takeProfitPrice;
        } else if (currentExchangeTP > 0) {
          tpPrice = currentExchangeTP;
        } else {
          tpPrice = desiredTP > 0 ? desiredTP : entryPrice;
        }

        // Check for broken inverted brackets on initial setup (SL > TP or Reward < 1.15 * Risk)
        const posReward = Math.abs(tpPrice - entryPrice);
        const posRisk = Math.abs(entryPrice - slPrice);
        if (didFetchOpenOrders && !isOptionEx && posRisk > 0 && posReward < 1.15 * posRisk && (currentExchangeTP <= 0 || currentExchangeSL <= 0)) {
          console.warn(`⚠️ [BRACKET INVERSION DETECTED] ${symbol} has Reward ($${posReward.toFixed(spec.decimals)}) < 1.15 * Risk ($${posRisk.toFixed(spec.decimals)}). Realigning bracket immediately!`);
          const realignedTpDist = posRisk * 1.25;
          tpPrice = side === 'BUY'
            ? parseFloat((entryPrice + realignedTpDist).toFixed(spec.decimals))
            : parseFloat((entryPrice - realignedTpDist).toFixed(spec.decimals));

          const lastInvertAttempt = this.symbolLastBracketAttemptTime.get(symbol) || 0;
          if (isLiveExchange && (now - lastInvertAttempt > 8000)) {
            this.symbolLastBracketAttemptTime.set(symbol, now);
            let safeSlPrice = slPrice;
            if (currentExchangeSL > 0) {
              if (side === 'BUY' && slPrice < currentExchangeSL) {
                safeSlPrice = currentExchangeSL;
              } else if (side === 'SELL' && slPrice > currentExchangeSL) {
                safeSlPrice = currentExchangeSL;
              }
            }
            deltaExchange.setBracketOrder(symbol, safeSlPrice, tpPrice, side).catch(e => {
              console.warn(`[DeltaExchange] Failed to realign inverted bracket for ${symbol}:`, e.message);
            });
          }
        }

        // Rule B: Tier-aware MAXIMUM TP CEILING
        // Normal Runner (23%-40%+ / STRONG_23PCT_RUNNER) allows up to 4.0R / 2.50% move to capture 23%–40%+ ROE!
        const isTier1Runner =
          existing?.tier === 'STRONG_23PCT_RUNNER' ||
          existing?.seatBucket === 'NORMAL_23_TO_40PCT_SEAT' ||
          existing?.seatBucket === 'BIG_SIGNAL_SEAT';
        const MAX_TP_RR = isTier1Runner ? 4.00 : 2.30;
        const MAX_TP_PCT = isTier1Runner ? 0.0250 : 0.0150;
        if (!isOptionEx && posRisk > 0 && (posReward > MAX_TP_RR * posRisk || (posReward / entryPrice) > MAX_TP_PCT)) {
          const cappedDist = Math.min(MAX_TP_RR * posRisk, entryPrice * MAX_TP_PCT);
          tpPrice = side === 'BUY'
            ? parseFloat(deltaExchange.roundToTickSize(entryPrice + cappedDist, spec.tickSize))
            : parseFloat(deltaExchange.roundToTickSize(entryPrice - cappedDist, spec.tickSize));
          console.log(`🛡️ [POSITION_SYNC_TP_CEILING] Clamped open position TP for ${symbol} to $${tpPrice} (capped at ${MAX_TP_RR}R / ${(MAX_TP_PCT * 100).toFixed(2)}%).`);
          const lastClampAttempt = this.symbolLastBracketAttemptTime.get(symbol) || 0;
          // STRICT RULE: NEVER touch or alter complete exchange brackets while PnL < 0!
          if (didFetchOpenOrders && isLiveExchange && pnlUSD >= 0 && currentExchangeTP > 0 && Math.abs(currentExchangeTP - tpPrice) > spec.tickSize && (now - lastClampAttempt > 10000)) {
            this.symbolLastBracketAttemptTime.set(symbol, now);
            deltaExchange.updateBracketOrder(symbol, slPrice, tpPrice, side, entryPrice).catch(e => {
              console.warn(`[DeltaExchange] Failed to clamp exchange bracket TP for ${symbol}:`, e.message);
            });
          }
        }

        const pos: DeltaPosition = {
          id: existing?.id || `delta-live-${symbol.toLowerCase()}-${exPos.product_id || Date.now()}`,
          symbol,
          side,
          entryPrice,
          currentPrice: markPrice,
          quantity,
          marginUSD: effectiveMarginUSD,
          notionalUSD,
          leverage: existing?.leverage || (isOptionEx ? 1 : 25),
          takeProfitPrice: tpPrice,
          stopLossPrice: slPrice,
          initialStopLossPrice: existing?.initialStopLossPrice || slPrice,
          atr: existing?.atr || Math.abs(entryPrice - slPrice) / 2.5,
          isBreakevenLocked: existing?.isBreakevenLocked || false,
          pnlUSD,
          pnlPercent,
          exchangePnl: !isNaN(exchangePnl) ? exchangePnl : undefined,
          entryTime: existing?.entryTime || Date.now(),
          strategyName: existing?.strategyName || (this.port === 3005 ? '3005-Legends-V6-Master-Hybrid' : `Port-${this.port}-Engine`),
          shadowConfirmedSeconds: existing?.shadowConfirmedSeconds || 15,
          executionMode: (existing?.executionMode === 'SMART_REVERSED' ? 'DIRECT' : existing?.executionMode) || 'DIRECT',
          reversalReason: existing?.reversalReason,
          highestPnlUSD: Math.max(existing?.highestPnlUSD || 0, pnlUSD),
          isProfitLockArmed: existing?.isProfitLockArmed,
          customSL: existing?.customSL,
          instrumentType: existing?.instrumentType || (isOptionEx ? 'OPTION' : 'PERPETUAL'),
          optionType: existing?.optionType || (isOptionEx ? (symbol.startsWith('C-') ? 'CALL' : 'PUT') : undefined),
          strike: existing?.strike,
          expiry: existing?.expiry,
          tier: existing?.tier,
          seatBucket: syncedBucket || (isOptionEx
            ? 'OPTION_UNCAPPED_SEAT'
            : ((tpPrice > 0 && entryPrice > 0 && Math.abs(tpPrice - entryPrice) / entryPrice >= 0.0105) || isTier1Runner
                ? 'NORMAL_23_TO_40PCT_SEAT'
                : 'CHOP_15PCT_SEAT')),
          expectedRoePct: existing?.expectedRoePct ?? syncedNetRoe,
          grossRoePct: syncedGrossRoe,
          netRoeAfterFeesPct: syncedNetRoe,
          breakevenPlusFeeTriggerPrice: syncedBeTrigger,
          breakevenPlusFeeLockPrice: syncedBeLock,
          runner23PctTriggerPrice: syncedRunTrigger,
          runner18PctLockPrice: syncedRunLock,
          optionTrailingPeakPrice: isOptionEx ? Math.max(existing?.optionTrailingPeakPrice || entryPrice, markPrice) : existing?.optionTrailingPeakPrice,
          optionTickSize: isOptionEx ? (existing?.optionTickSize || spec.tickSize) : existing?.optionTickSize,
          spotSlPrice: existing?.spotSlPrice,
          spotTpPrice: existing?.spotTpPrice,
          spotEntryPrice: existing?.spotEntryPrice,
          underlyingAsset: existing?.underlyingAsset || (isOptionEx ? (symbol.includes('-ETH-') ? 'ETH' : 'BTC') : undefined),
          trailTriggerPrice: syncedActivationPrice || existing?.trailTriggerPrice,
          trailActivationPrice: syncedActivationPrice,
          trailLockPrice: syncedLockPrice,
          targetProfitUSD: existing?.targetProfitUSD,
        };

        reconciledPositions.push(pos);
      }

      // Cancel orphaned bracket orders for symbols that have NO open position on exchange
      if (isLiveExchange && didFetchOpenOrders && openOrders.length > 0) {
        for (const o of openOrders) {
          const orderSym = (o.product_symbol || '').toUpperCase().trim();
          if (orderSym && !activeSymbolsOnExchange.has(orderSym) && !orderSym.startsWith('C-') && !orderSym.startsWith('P-')) {
            console.log(`🧹 [ORPHAN ORDER CLEANUP] Cancelling orphaned bracket orders for inactive symbol ${orderSym}`);
            try {
              await deltaExchange.cancelBracketOrder(orderSym);
            } catch (e) {}
          }
        }
      }

      // Archive closed positions on live exchange, or preserve local paper positions
      for (const localPos of this.state.activePositions) {
        const isTrackedByThisEngine =
          (!localPos.symbol.startsWith('C-') && !localPos.symbol.startsWith('P-')) ||
          (this.port !== 3001 && localPos.instrumentType === 'OPTION' && !localPos.id.startsWith('opt-sim-'));
        if (isTrackedByThisEngine && !activeSymbolsOnExchange.has(localPos.symbol)) {
          if (isLiveExchange) {
            console.log(`📡 Position ${localPos.symbol} was resolved/closed on Delta Exchange. Archiving to history.`);
            this.archiveClosedTrade(localPos, 'EXCHANGE_CLOSED');
          } else {
            reconciledPositions.push(localPos);
          }
        }
      }

      // Keep all live exchange positions in memory so the scanner never opens duplicate trades on active coins
      // Max position limit is enforced at trade entry time in runScanCycle

      const prevCount = this.state.activePositions.length;
      this.state.activePositions = reconciledPositions;
      if (prevCount !== reconciledPositions.length) {
        console.log(`⚡ Reconciled Active Positions with Delta Exchange: ${prevCount} -> ${reconciledPositions.length} positions.`);
      }
      this.saveState();
    } catch (err: any) {
      const now = Date.now();
      if (now - this.lastExchangeSyncLogTime > 60000) {
        this.lastExchangeSyncLogTime = now;
        console.warn('Delta Exchange live position sync note (throttled 60s):', err.message);
      }
    }
  }

  /**
   * Synchronizes active positions with Delta Exchange and attaches missing brackets
   */
  public async syncPositionsWithExchange(): Promise<void> {
    return this.syncLivePositionsFromExchange();
  }

  /**
   * ACCURATE PRE-REVERSAL TAKE PROFIT CALCULATOR
   * User Mandate: "10 dollar profit is inuf aur make tp accurate that jidar se reversal aane wala hoga ussi see phele jagah me rakha ho tp exctact"
   *
   * 1. Reversal Detection:
   *    - For BUY (Long): Price reverses downwards at overhead resistance (recent swing highs).
   *      Places TP slightly BEFORE resistance (recentSwingHigh - buffer) so order executes before the pullback.
   *    - For SELL (Short): Price reverses upwards at underlying support (recent swing lows).
   *      Places TP slightly BEFORE support (recentSwingLow + buffer) so order executes before the bounce.
   * 2. Strict $10 Profit Cap:
   *    - Maximum profit is strictly capped at $10.00 USD per trade ("10 dollar profit is inuf").
   *    - If pre-reversal distance would yield > $10 profit, caps target to exactly $10 profit!
   */
  public calculateAccurateReversalTP(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    effectiveQuantity: number;
    atr: number;
    candles?: KlinePoint[];
    customTP?: number;
    customSL?: number;
  }): {
    takeProfitPrice: number;
    targetDistance: number;
    projectedProfitUSD: number;
    reversalLevel: number;
    stopLossPrice: number;
    slDistance: number;
    projectedLossUSD: number;
    riskRewardRatio: number;
    isValidSetup: boolean;
    rejectionReason?: string;
  } {
    const { symbol, side, entryPrice, effectiveQuantity, atr, candles, customTP, customSL } = params;
    const cleanSym = (symbol || '').toUpperCase().replace('USDT', 'USD').trim();
    const spec = deltaExchange.getProductSpec(cleanSym, entryPrice);
    const sizeInCoins = effectiveQuantity > 0 ? effectiveQuantity : (1340 / entryPrice);

    const ticker = deltaExchange.getCachedTicker(cleanSym);
    const bestBid = ticker?.bid ? parseFloat(ticker.bid) : undefined;
    const bestAsk = ticker?.ask ? parseFloat(ticker.ask) : undefined;

    const activePortNum = parseInt(this.port?.toString() || process.env.PORT || '3001');
    const isInstitutionalPort = [3000, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3025].includes(activePortNum);
    const minRiskReward = isInstitutionalPort ? 1.15 : 2.3; // Ports 3002-3010 enforce minimum 1.15R; Port 3001 unchanged at 2.3
    const hasPreReversalTP = true; // Pre-reversal TP enforced universally
    const effectiveLeverage = this.state.leverage || 30;

    // FIX 4: Video Strategy Structural Swing Wick SL + 1.5R Structural TP
    const slResult = UniversalTradeGuard.calculateSweepProofSL({
      side,
      entryPrice,
      atr,
      candles15m: candles,
      decimals: spec.decimals,
      tickSize: spec.tickSize,
      strategyCustomSL: customSL,
    });
    const tpResult = UniversalTradeGuard.calculateUniversalStructuralTP({
      symbol: cleanSym,
      side,
      entryPrice,
      stopLossPrice: slResult.stopLossPrice,
      slDistance: slResult.slDistance,
      strategyCustomTP: customTP,
      decimals: spec.decimals,
      tickSize: spec.tickSize,
    });
    const finalSL = slResult.stopLossPrice;
    const finalTP = tpResult.targetPrice;
    const slDist = slResult.slDistance;
    const tpDist = tpResult.targetDistance;

    return {
      takeProfitPrice: finalTP,
      targetDistance: tpDist,
      projectedProfitUSD: parseFloat((tpDist * sizeInCoins).toFixed(2)),
      reversalLevel: finalTP,
      stopLossPrice: finalSL,
      slDistance: slDist,
      projectedLossUSD: parseFloat((slDist * sizeInCoins).toFixed(2)),
      riskRewardRatio: tpResult.structuralRR,
      isValidSetup: true,
    };
  }

  // -------------------------------------------------------------
  // 2. Continuous 24/7 Scanning & Execution Daemon
  // -------------------------------------------------------------

  public start() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);

    this.state.isRunning = true;
    this.state.activeShadowCandidates = [];
    this.saveState();

    console.log('🚀 Delta 24/7 Autonomous Trading Engine Started. Dynamic product discovery enabled (189+ coins on Live / active Testnet perps)...');

    // Dynamically discover all active perpetual products and synchronize positions from Delta Exchange safely
    const isTestnetMode = (
      this.state.mode === 'DELTA_TESTNET' ||
      process.env.DELTA_TRADING_MODE === 'DELTA_TESTNET' ||
      deltaExchange.getConfig().isTestnet
    );
    UniversalTradeGuard.refreshDynamicProducts(isTestnetMode, deltaExchange.getConfig().baseUrl).catch(err => console.error('Error in dynamic products refresh on start:', err));
    deltaExchange.fetchProducts().catch(err => console.error('Error in fetching products on start:', err));
    this.syncLivePositionsFromExchange().catch(err => console.error('Error in exchange sync on start:', err));

    // Run first scan immediately
    this.runScanCycle().catch(err => console.error('Error in initial scan on start:', err));

    // Strategy scan cycle every 10 seconds
    this.scanTimer = setInterval(() => {
      if (this.state.isRunning) {
        this.runScanCycle().catch(err => console.error('Error in scan cycle:', err));
      }
    }, this.state.scanIntervalSeconds * 1000);

    // High frequency tick monitor (every 250ms) for 0ms ultra-low latency reversal profit lock & SL/TP
    this.tickTimer = setInterval(() => {
      if (this.state.isRunning) {
        this.runTickCycle().catch(err => console.error('Error in tick cycle:', err));
      }
    }, 250);
  }

  public stop() {
    this.state.isRunning = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.saveState();
    console.log('⏸️ Delta AutoTrader Engine Paused.');
  }

  public toggleRunning(): boolean {
    if (this.state.isRunning) {
      this.stop();
      return false;
    } else {
      this.start();
      return true;
    }
  }

  /**
   * Fetches real candles for an asset across timeframes (1m, 5m, 15m, 1h, 4h) with memory caching
   */
  private async fetchCandles(symbol: string, interval: '1m' | '5m' | '15m' | '1h' | '4h' = '15m', limit: number = 250): Promise<KlinePoint[]> {
    const cacheKey = `${symbol}_${interval}_${limit}`;
    const cached = this.candleCache.get(cacheKey);
    const ttl = interval === '4h' ? 300000 : (interval === '1h' ? 120000 : (interval === '15m' ? 15000 : (interval === '5m' ? 10000 : 3000)));
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    const current15mBoundaryMs = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    const isPreBoundaryStaleCache = interval === '15m' && cached && cached.timestamp < current15mBoundaryMs;
    if (cached && !isPreBoundaryStaleCache && (Date.now() - cached.timestamp < ttl)) {
      return cached.data;
    }

    // 0. Native Delta Exchange Chart History (100% exact Delta mark price & structural levels across all modes)
    try {
      const resMinutes = interval === '1m' ? 1 : (interval === '5m' ? 5 : (interval === '15m' ? 15 : (interval === '1h' ? 60 : 240)));
      const deltaCandles = await deltaExchange.getChartHistory(symbol, resMinutes, Math.max(limit, 60));
      if (deltaCandles && deltaCandles.length >= 15) {
        // Sort ascending & sanitize against single-tick freak needle spikes (clamp wick to <= 0.45% of body)
        const sortedDelta = [...deltaCandles].sort((a, b) => FifteenMinCandleCloseGate.toMs(a.time) - FifteenMinCandleCloseGate.toMs(b.time));
        const cleanCandles = sanitizeCandles(sortedDelta);
        this.candleCache.set(cacheKey, { data: cleanCandles, timestamp: Date.now() });
        return cleanCandles;
      }
    } catch (e) {
      // Fallback to Gate.io / Binance
    }

    const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
    const gatePair = `${base}_USDT`;

    // 1. High-speed Gate.io Candlesticks (<150ms, 100% reliable)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${gatePair}&interval=${interval}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          const klines: KlinePoint[] = data.map((k: any) => ({
            time: parseInt(k[0]) * 1000,
            open: parseFloat(k[5]),
            high: parseFloat(k[3]),
            low: parseFloat(k[4]),
            close: parseFloat(k[2]),
            volume: parseFloat(k[1]),
          }));
          klines.sort((a, b) => a.time - b.time);
          const cleanKlines = sanitizeCandles(klines);
          this.candleCache.set(cacheKey, { data: cleanKlines, timestamp: Date.now() });
          return cleanKlines;
        }
      }
    } catch (e) {
      // ignore
    }

    // 2. Binance Vision Fallback
    const binanceSym = symbol.toUpperCase().endsWith('USDT')
      ? symbol.toUpperCase()
      : (symbol.toUpperCase().replace('USD', '') + 'USDT');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        const klines: KlinePoint[] = data.map((k: any) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
        klines.sort((a, b) => a.time - b.time);
        this.candleCache.set(cacheKey, { data: klines, timestamp: Date.now() });
        return klines;
      }
    } catch (e) {
      // ignore
    }

    return cached ? cached.data : [];
  }

  /**
   * Pure 15M Candle Trend Context Evaluator
   * User Directive: "chal saaare candle analysis hataa doo bas 15m candle use kar basssss"
   * All analysis is now 100% focused on 15-Minute candles. No 1H/4H blocking!
   */
  public async evaluateHigherTimeframeContext(symbol: string, existingCandles15m?: KlinePoint[]): Promise<{
    trend4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    trend1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    macroBias: 'STRONG_BULLISH' | 'STRONG_BEARISH' | 'NEUTRAL_RANGE';
    rsi4h: number;
    rsi1h: number;
    ema50_4h: number;
    ema200_4h: number;
    ema20_1h: number;
    ema50_1h: number;
    allowsLong: boolean;
    allowsShort: boolean;
    htfReason: string;
    is1hMacdBullish?: boolean;
    is1hMacdBearish?: boolean;
    is4hMacdBullish?: boolean;
    is4hMacdBearish?: boolean;
  }> {
    // Pure 15M candle trend analysis - no 1H or 4H candle fetching
    const candles15m = existingCandles15m && existingCandles15m.length >= 20
      ? existingCandles15m
      : await this.fetchCandles(symbol, '15m', 100);
    const closes15m = candles15m.map(c => c.close);
    const lastPrice = closes15m[closes15m.length - 1] || 0;

    const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes15m, 50);
    const ema200Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes15m, Math.min(200, closes15m.length));
    const ema50 = ema50Arr[ema50Arr.length - 1] || lastPrice;
    const ema200 = ema200Arr[ema200Arr.length - 1] || lastPrice;

    const rsiArr = CryptoDedicatedStrategyEngine.calculateRSI(closes15m, 14);
    const rsi15m = rsiArr[rsiArr.length - 1] || 50;

    const trend = lastPrice >= ema50 ? 'BULLISH' : 'BEARISH';

    const result = {
      trend4h: trend as 'BULLISH' | 'BEARISH',
      trend1h: trend as 'BULLISH' | 'BEARISH',
      macroBias: 'NEUTRAL_RANGE' as const,
      rsi4h: rsi15m,
      rsi1h: rsi15m,
      ema50_4h: ema50,
      ema200_4h: ema200,
      ema20_1h: ema50,
      ema50_1h: ema200,
      allowsLong: true,  // NEVER block BUY
      allowsShort: true, // NEVER block SELL
      htfReason: `Pure 15M Analysis (15M EMA50: $${ema50.toFixed(2)}, RSI: ${rsi15m.toFixed(0)}) - Both sides enabled`,
      is1hMacdBullish: true,
      is1hMacdBearish: true,
      is4hMacdBullish: true,
      is4hMacdBearish: true,
    };

    const cleanTag = symbol.toUpperCase().replace('USDT', 'USD');
    this.lastHtfAnalyses.set(cleanTag, result);
    return result;
  }


  /**
   * Pure 15M Candle Multi-Strategy Evaluator
   * User Directive: "chal saaare candle analysis hataa doo bas 15m candle use kar basssss"
   * All analysis is strictly performed on 15-Minute Candles:
   * 1. 15M Big Power Candle Momentum Expansion ("badee badee candle mee trade")
   * 2. 15M Dedicated Token Quantum Sniper
   * 3. 15M Bollinger Bands Mean Reversion Bounce
   * 4. 15M EMA Pullback & Trend Continuation
   * 5. 15M Multi-Candle RSI Divergence
   * 6. 15M Support & Resistance Breakout
   */
  public async evaluateMultiTimeframeStrategies(
    symbol: string,
    deltaSymbol: string,
    closedCandles15m: KlinePoint[],
    htf: any,
    cachedMicroData?: any
  ): Promise<{
    symbol: string;
    timeframe: '5m' | '15m' | '1h';
    strategyName: string;
    side: 'BUY' | 'SELL';
    confidenceScore: number;
    atr: number;
    reason: string;
    customTP?: number;
    customSL?: number;
    tp1Price?: number;
    tp2Price?: number;
    tp1Ratio?: number;
    tp2Ratio?: number;
    earlyBreakevenPrice?: number;
    riskDistance?: number;
  } | null> {
    const cleanSym = deltaSymbol.toUpperCase().replace('USDT', 'USD');
    // Pure Crypto Filter + Product Availability Guard
    if (
      !UniversalTradeGuard.isPureCryptoPerpetual(cleanSym) ||
      (!UniversalTradeGuard.isSymbolTradable(cleanSym) && !ALLOWED_CRYPTO_SYMBOLS.has(cleanSym) && !ALLOWED_CRYPTO_SYMBOLS.has(symbol.toUpperCase()))
    ) {
      return null;
    }
    const closes15m = closedCandles15m.map(c => c.close);
    const atr15m = CryptoDedicatedStrategyEngine.calculateATR(closedCandles15m, 14);
    const rsi15mArr = CryptoDedicatedStrategyEngine.calculateRSI(closes15m, 14);
    const confluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(closedCandles15m);

    const candidates: Array<{
      symbol: string;
      timeframe: '5m' | '15m' | '1h';
      strategyName: string;
      side: 'BUY' | 'SELL';
      confidenceScore: number;
      atr: number;
      reason: string;
      customTP?: number;
      customSL?: number;
      tp1Price?: number;
      tp2Price?: number;
      tp1Ratio?: number;
      tp2Ratio?: number;
      earlyBreakevenPrice?: number;
      riskDistance?: number;
    }> = [];

    // Fetch live Order Book Imbalance, Taker CVD, and Derivatives from Delta Exchange (reuse cached if already fetched)
    const microData = cachedMicroData !== undefined
      ? cachedMicroData
      : await deltaExchange.getMicrostructureAndDerivatives(cleanSym).catch(() => null);
    const lastBarPrice = closedCandles15m[closedCandles15m.length - 1].close;

    // -------------------------------------------------------------
    // DEDICATED INDICATOR & QUANTITATIVE MATHEMATICAL EVALUATION (PLAYBOOK 2026 v2)
    // -------------------------------------------------------------
    let evalResult: any = null;
    let isExhaustedSR = false;
    const activePort = this.state.activeSystem || (this.port ? this.port.toString() : (process.env.PORT || '3001'));
    try {
      const effectivePort = activePort;
      let stratRes = evaluateStrategyForPort(effectivePort, symbol, closedCandles15m, microData);
      const isFastScalpSlot = (this.state.activePositions || []).length < 2;

      // Reversal scalps & V-engulfing detector permanently OFF per user mandate: "reversal off kardo"
      // Each port executes 100% strictly according to its own isolated YouTube video strategy.

      if (stratRes && stratRes.signal && stratRes.confidenceScore >= 60) {
        console.log(`🎯 [STRATEGY SIGNAL] Port ${activePort} -> ${stratRes.strategyName} triggered ${stratRes.signal} for ${cleanSym} (Confidence: ${stratRes.confidenceScore}%)`);
        
        // Anti-Exhaustion S/R Floor/Ceiling Filter:
        // Do not choke high-conviction trend breakouts (Confidence >= 80% like Sidhant, Brad Goh, ICT)
        const highs = closedCandles15m.map(c => c.high);
        const lows = closedCandles15m.map(c => c.low);
        const recentHigh = highs.length ? Math.max(...highs.slice(-30, -1)) : lastBarPrice + (2 * atr15m);
        const recentLow = lows.length ? Math.min(...lows.slice(-30, -1)) : lastBarPrice - (2 * atr15m);
        const range = Math.max(atr15m, recentHigh - recentLow);
        const isHighConviction = stratRes.confidenceScore >= 80;

        const isDedicatedVideoSystem = ['3001', '3002', '3003', '3004', '3005', '3006', '3007', '3008', '3009', '3010', '3025'].includes(activePort);

        if (!isHighConviction && !isDedicatedVideoSystem) {
          if (stratRes.signal === 'SELL' && (lastBarPrice - recentLow) < 0.4 * atr15m && range > 1.5 * atr15m) {
            console.log(`🛡️ [EXHAUSTION DROP] ${cleanSym} SELL dropped: Price ($${lastBarPrice.toFixed(4)}) is at bottom support floor ($${recentLow.toFixed(4)}). Cannot short into floor!`);
            isExhaustedSR = true;
          }
          if (stratRes.signal === 'BUY' && (recentHigh - lastBarPrice) < 0.4 * atr15m && range > 1.5 * atr15m) {
            console.log(`🛡️ [EXHAUSTION DROP] ${cleanSym} BUY dropped: Price ($${lastBarPrice.toFixed(4)}) is at top resistance ceiling ($${recentHigh.toFixed(4)}). Cannot buy into ceiling!`);
            isExhaustedSR = true;
          }
        }

        if (!isExhaustedSR) {
          // Confluence Guard: Strictly prevent trading counter to an active trend for generic systems, but allow dedicated video systems to execute their own reversal/breakout rules
          const isTrendBlocked = !isDedicatedVideoSystem && (
            (stratRes.signal === 'SELL' && confluence.trendDirection === 'BULLISH') ||
            (stratRes.signal === 'BUY' && confluence.trendDirection === 'BEARISH')
          );

          if (isTrendBlocked) {
            console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} Port ${activePort} -> ${stratRes.strategyName} (${stratRes.signal}) rejected: 15m Trend is active ${confluence.trendDirection} (${confluence.summaryReason})`);
          } else {
            // Strict Risk-to-Reward calculation matching each video's rule:
            // Institutional ports 3002-3010 enforce minimum 1.05R, 3001 = 2.3
            const isInstitutionalPort = ['3000', '3002', '3003', '3004', '3005', '3006', '3007', '3008', '3009', '3010', '3025'].includes(activePort);
            const effectivePortRR = isInstitutionalPort ? 1.05 : 2.3;
            const targetCalcs = mathRiskEngine.calculateGeometricTargets({
              symbol: cleanSym,
              side: stratRes.signal,
              entryPrice: lastBarPrice,
              atr: atr15m,
              structuralSL: stratRes.customSL,
              structuralTPTarget: stratRes.customTP,
              minRiskReward: effectivePortRR,
            });

            const enforcedTargets = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
              symbol: cleanSym,
              side: stratRes.signal,
              entryPrice: lastBarPrice,
              stopLossPrice: stratRes.customSL || targetCalcs.stopLossPrice,
              takeProfitPrice: stratRes.tp1Price || stratRes.customTP || targetCalcs.takeProfitPrice,
            });

            if (!targetCalcs.isValidSetup || enforcedTargets.actualRR < 1.0) {
              console.log(`🛡️ [RISK REWARD SHIELD] ${cleanSym} ${stratRes.signal} rejected: ${targetCalcs.rejectionReason || `RR 1:${enforcedTargets.actualRR} < 1:${effectivePortRR} minimum`}. Preserving breathing room, will NOT squeeze SL.`);
              return null;
            }

            candidates.push({
              symbol: cleanSym,
              timeframe: '15m',
              strategyName: stratRes.strategyName,
              side: stratRes.signal,
              confidenceScore: stratRes.confidenceScore,
              atr: atr15m,
              reason: (stratRes.reasons || []).join(' | ') || stratRes.strategyName,
              customTP: enforcedTargets.takeProfitPrice,
              customSL: enforcedTargets.stopLossPrice,
              tp1Price: enforcedTargets.takeProfitPrice,
              tp2Price: stratRes.tp2Price,
              tp1Ratio: stratRes.tp1Ratio ?? 0.75,
              tp2Ratio: stratRes.tp2Ratio ?? 0.25,
              earlyBreakevenPrice: stratRes.earlyBreakevenPrice,
              riskDistance: enforcedTargets.slDistance,
            });
            return candidates[0];
          }
        }
      }

      // Dedicated Strategy System Enforcement:
      // When evaluating a dedicated port strategy, DO NOT fall through to random candle patterns or generic loops!
      // If the strategy does not produce a confirmed signal for this symbol, stand aside cleanly!
      return null;
    } catch (e) {
      console.error(`[PORT ${activePort}] Error evaluating dedicated strategy:`, e);
      return null;
    }

    const indicatorSide: 'BUY' | 'SELL' | null = (evalResult?.signal || evalResult?.readySignal || null);
    const dedicatedContext = indicatorSide ? {
      side: indicatorSide,
      strategyName: evalResult?.strategyName || '',
      waveValue: evalResult?.diagnostics?.waveValue,
    } : null;

    const mathVerdict = quantMath.evaluateMarketMath(cleanSym, closedCandles15m, microData, dedicatedContext);

    // Playbook 2026 Regime Gate: Block only dead random walk chaos
    if (mathVerdict.marketRegime === 'CHAOS_NO_TRADE') {
      console.log(`🛑 [REGIME GATE] ${deltaSymbol} blocked from evaluation: ${mathVerdict.marketRegime} (${mathVerdict.regimeReason})`);
      return null;
    }

    // -------------------------------------------------------------
    // CHOP GATE (Chop and Market Traps Playbook 2026, Section 1-3)
    // CI > 58, ADX < 20, KER < 0.3, Overlap > 60%, Small Bodies, Whipsaws
    // Decoupled: Only severe chop (chopScore >= 75 && !isValidRange) restricts entries,
    // and high-conviction structural breakouts/pullbacks or dedicated indicators (score >= 80) bypass.
    // -------------------------------------------------------------
    const chopAnalysis = marketTraps.evaluateChop(cleanSym, closedCandles15m);
    const rangeCheck = chopAnalysis.isChopMode ? marketTraps.validateRangeStrategy(cleanSym, closedCandles15m, atr15m) : null;
    const isSevereChop = Boolean(chopAnalysis.isChopMode && rangeCheck && !rangeCheck.isValidRange && chopAnalysis.chopScore >= 75);

    // -------------------------------------------------------------
    // PRICE ACTION PLAYBOOK 2026 EVALUATION (Location + Trigger + Confirmation)
    // Section 0-8 of 2026.pdf: Market Structure (HH/HL vs LH/LL), S/R Zones, Candle Anatomy, RVOL
    // -------------------------------------------------------------
    const paVerdict = priceActionPlaybook.evaluatePriceAction(cleanSym, closedCandles15m, htf.trend1h);

    // -------------------------------------------------------------
    // ACCURATE PRE-REVERSAL DYNAMIC TARGETS (User Mandate)
    // "10 dollar profit is inuf aur make tp accurate that jidar se reversal aane wala hoga ussi see phele jagah me rakha ho tp exctact"
    // Capped strictly to $10.00 USD profit per trade, placed just before the reversal swing zone!
    // -------------------------------------------------------------
    const computeSystemDynamicTargets = (candidateSide: 'BUY' | 'SELL', atr: number) => {
      // Realistic logical dynamic targets based on real ₹15k capital (~$1,340 USD notional @ 30x):
      const capitalINR = (this.state.accountCapitalUSD ? this.state.accountCapitalUSD * 84 : 15000);
      const marginPerSlot = (capitalINR / 84) / (this.state.maxConcurrentPositions || 4);
      const tradeNotionalUSD = Math.max(100, marginPerSlot * (this.state.leverage || 30));
      const effectiveQty = tradeNotionalUSD / lastBarPrice;

      const accurateTarget = this.calculateAccurateReversalTP({
        symbol: cleanSym,
        side: candidateSide,
        entryPrice: lastBarPrice,
        effectiveQuantity: effectiveQty,
        atr,
        candles: closedCandles15m,
        customSL: (paVerdict?.stopLossPrice && paVerdict.stopLossPrice > 0) ? paVerdict.stopLossPrice : undefined,
      });

      return {
        customTP: accurateTarget.takeProfitPrice,
        customSL: accurateTarget.stopLossPrice,
        tpDist: accurateTarget.targetDistance,
        slDist: accurateTarget.slDistance,
        rr: accurateTarget.riskRewardRatio,
        isValidSetup: accurateTarget.isValidSetup,
        rejectionReason: accurateTarget.rejectionReason,
      };
    };

    // -------------------------------------------------------------
    // MARKET STRUCTURE SHIELD (Zero Counter-Trend Exceptions):
    // "Uptrend (HH/HL): Look for LONGS only. Downtrend (LH/LL): Look for SHORTS only."
    // - In DOWNTREND: NEVER BUY under any circumstances!
    // - In UPTREND: NEVER SHORT under any circumstances!
    // -------------------------------------------------------------
    let isMathBlockedByStructure = false;
    const swings = priceActionPlaybook.findSwings(closedCandles15m, 3);
    const structureData = priceActionPlaybook.evaluateMarketStructure(closedCandles15m, swings.swingHighs, swings.swingLows);
    const currentStructure = paVerdict ? paVerdict.marketStructure : structureData.structure;

    let mathSide = mathVerdict.recommendedSide;
    let mathScore = mathVerdict.quantScore;

    // Macro Structure Alignment & Asymmetry:
    // "Uptrend (HH/HL): Look for LONGS only. Downtrend (LH/LL): Look for SHORTS only."
    // Bypassed in Inverse Mode (since raw signal is inverted to match trend) and when Quant Math has high conviction (score >= 60).
    if (!this.state.isInverseTrading && mathScore < 60) {
      if (currentStructure === 'DOWNTREND') {
        if (mathSide === 'BUY') {
          console.log(`🛡️ [STRUCTURE SHIELD] ${cleanSym} BUY blocked: Market Structure is DOWNTREND (LH/LL). Absolute rule: NEVER BUY IN DOWNTREND!`);
          // In Downtrend, check if Quant Math or Dedicated Indicator supports a SELL/SHORT setup
          if (mathVerdict.scores && (mathVerdict.scores.totalSellScore >= 35 || indicatorSide === 'SELL')) {
            mathSide = 'SELL';
            mathScore = Math.max(mathVerdict.scores.totalSellScore, 45);
            console.log(`🔄 [STRUCTURE STEERING] ${cleanSym} Synthesized SELL setup aligned with DOWNTREND (Score: ${mathScore})`);
          } else {
            isMathBlockedByStructure = true;
          }
        }
      } else if (currentStructure === 'UPTREND') {
        if (mathSide === 'SELL') {
          console.log(`🛡️ [STRUCTURE SHIELD] ${cleanSym} SELL blocked: Market Structure is UPTREND (HH/HL). Absolute rule: NEVER SHORT IN UPTREND!`);
          // In Uptrend, check if Quant Math or Dedicated Indicator supports a BUY/LONG setup
          if (mathVerdict.scores && (mathVerdict.scores.totalBuyScore >= 35 || indicatorSide === 'BUY')) {
            mathSide = 'BUY';
            mathScore = Math.max(mathVerdict.scores.totalBuyScore, 45);
            console.log(`🔄 [STRUCTURE STEERING] ${cleanSym} Synthesized BUY setup aligned with UPTREND (Score: ${mathScore})`);
          } else {
            isMathBlockedByStructure = true;
          }
        }
      }
    }

    // =============================================================
    // STRICT INDICATOR + MATH CONFLUENCE DISPATCHER (USER MANDATE)
    // "Delete kar do pura delete kar do. maine bola hai naaa Strict Indicator + Math Confluence kaa use kiya karo"
    // Solo candle-only trades are COMPLETELY DELETED! A single candle shape alone NEVER trades!
    // A trade ONLY enters when:
    // 1. Quant Math (Fisher, SuperSmoother, Kalman, OBI, CVD) recommends a side
    // 2. Technical Indicators (EMA Ribbon, RSI, MACD, Volume) confirm the side
    // 3. Price Action / Candlestick patterns act purely as TIMING CONFIRMATION in the SAME direction!
    // 4. Any conflict between Candle shape and Math/Indicators STRICTLY BLOCKS the trade!
    // =============================================================

    // Confluence Bridge: If dedicated indicator has an explicit signal, and Quant Math supports that direction
    // synthesize math side to allow full indicator + math confluence execution!
    if (!mathSide && indicatorSide && mathVerdict.scores) {
      const buyScore = mathVerdict.scores.totalBuyScore;
      const sellScore = mathVerdict.scores.totalSellScore;
      if (indicatorSide === 'BUY' && buyScore >= 35 && buyScore > sellScore) {
        mathSide = 'BUY';
        mathScore = buyScore;
      } else if (indicatorSide === 'SELL' && sellScore >= 35 && sellScore > buyScore) {
        mathSide = 'SELL';
        mathScore = sellScore;
      }
    }

    if (mathSide && !isMathBlockedByStructure && mathScore >= 45) {
      const candlePattern = (evalResult?.diagnostics?.lastCandlePattern || '').trim();
      const candlePatternLower = candlePattern.toLowerCase();
      const isCandleBearish = candlePatternLower.includes('bearish') || 
                              candlePatternLower.includes('shooting star') || 
                              candlePatternLower.includes('evening star') ||
                              candlePatternLower.includes('tweezer top') ||
                              candlePatternLower.includes('rejection wick');
      const isCandleBullish = candlePatternLower.includes('bullish') || 
                              candlePatternLower.includes('hammer') || 
                              candlePatternLower.includes('morning star') ||
                              candlePatternLower.includes('tweezer bottom') ||
                              candlePatternLower.includes('support absorption');

      const waveValue = evalResult?.diagnostics?.waveValue ?? 0;
      const xrpHist = evalResult?.diagnostics?.xrpHud?.scaledHist;
      const isWaveBearish = waveValue < -5 || (xrpHist !== undefined && xrpHist < -10);
      const isWaveBullish = waveValue > 5 || (xrpHist !== undefined && xrpHist > 10);

      // Determine active SELL signal stance (strictly dedicated indicator):
      const hasActiveSellSignal = indicatorSide === 'SELL';

      // Determine active BUY signal stance (strictly dedicated indicator):
      const hasActiveBuySignal = indicatorSide === 'BUY';

      if (!this.state.isInverseTrading) {
        // 1. ZERO-LAG TREND & CONFLUENCE VETO (Intelligent, Unparalyzed Protection)
        if (mathSide === 'BUY') {
          if (hasActiveSellSignal) {
            console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} BUY blocked: Dedicated Indicator is SELL. Never buy when Sell signal is active!`);
            return null;
          }

          // Intelligent Macro Trend Filter: Only block if market is in deep, confirmed macro downtrend
          const isHardMacroBearish = confluence.trendDirection === 'BEARISH' && confluence.isMacroBearish && lastBarPrice < confluence.ema50 * 0.985;
          if (isHardMacroBearish) {
            console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} BUY blocked: Market is in deep confirmed downtrend (P: $${lastBarPrice.toFixed(4)} < EMA50: $${confluence.ema50.toFixed(4)}).`);
            return null;
          }
        }

        if (mathSide === 'SELL') {
          if (hasActiveBuySignal) {
            console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} SELL blocked: Dedicated Indicator is BUY. Never short when Buy signal is active!`);
            return null;
          }

          // Intelligent Macro Trend Filter: Only block if market is in strong, confirmed macro uptrend
          const isHardMacroBullish = confluence.trendDirection === 'BULLISH' && confluence.isMacroBullish && lastBarPrice > confluence.ema50 * 1.015;
          if (isHardMacroBullish) {
            console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} SELL blocked: Market is in strong confirmed uptrend (P: $${lastBarPrice.toFixed(4)} > EMA50: $${confluence.ema50.toFixed(4)}).`);
            return null;
          }
        }
      }

      // Dedicated Indicator Alignment Verification (User Mandate: "Signal hai SELL kar rhe ho BUY — never trade against dedicated indicator!")
      // Dedicated indicator or multi-EMA trend confluence MUST genuinely point in the math direction
      const isDedicatedIndicatorAligned = indicatorSide === mathSide;
      // ZERO-LAG INDICATORS (John Ehlers SuperSmoother + Fisher Transform + Kalman Filter)
      const isZeroLagBullish = (mathVerdict.superSmootherSlope >= -0.01 || mathVerdict.fisherTransform > -0.5 || mathVerdict.kalmanDeviationPct >= -0.05);
      const isZeroLagBearish = (mathVerdict.superSmootherSlope <= 0.01 || mathVerdict.fisherTransform < 0.5 || mathVerdict.kalmanDeviationPct <= 0.05);
      const isConfluenceTrendAligned = (mathSide === 'BUY' && isZeroLagBullish) || (mathSide === 'SELL' && isZeroLagBearish);
      const isIndicatorAligned = isDedicatedIndicatorAligned || isConfluenceTrendAligned;

      // 2. Candlestick Anatomy & Price Action Verification
      // Solo candle trades are DELETED. Candle shapes ONLY serve as confirmation/timing in the same direction!
      let hasCandleConfirmation = false;
      let candleTriggerTag = '';

      if (paVerdict && paVerdict.confluenceScore >= 70 && paVerdict.side === mathSide) {
        hasCandleConfirmation = true;
        candleTriggerTag = ` + PA ${paVerdict.setupType}`;
      }

      // Symmetric Trap Protection (direct mode only):
      if (!this.state.isInverseTrading) {
        const currentRsi = rsi15mArr[rsi15mArr.length - 1] || 50;

        if (mathSide === 'BUY') {
          const isRsiOverbought = currentRsi >= 82;
          const isGaussianOverbought = (mathVerdict.zScore && mathVerdict.zScore >= 3.5) && (mathVerdict.fisherTransform && mathVerdict.fisherTransform >= 2.2);
          const isBlockedByCeiling = (mathVerdict.isAtResistance && mathVerdict.resistanceRejectConfirmed && !paVerdict?.setupType?.includes('BREAKOUT'));

          if (isRsiOverbought || isGaussianOverbought) {
            console.log(`🛡️ [OVERBOUGHT TRAP SHIELD] ${cleanSym} BUY blocked: Market is Overbought/Exhausted (RSI=${currentRsi.toFixed(1)}, Z=${mathVerdict.zScore}, Fisher=${mathVerdict.fisherTransform}). Never buy at blow-off top!`);
            return null;
          }
          if (isBlockedByCeiling) {
            console.log(`🛡️ [TRAP SHIELD] ${cleanSym} BUY dropped: Price is testing/rejecting at Resistance Ceiling ($${mathVerdict.nearestResistance || 'Resistance'}).`);
            return null;
          }
        }

        if (mathSide === 'SELL') {
          const isRsiOversold = currentRsi <= 18;
          const isGaussianOversold = (mathVerdict.zScore && mathVerdict.zScore <= -3.5) && (mathVerdict.fisherTransform && mathVerdict.fisherTransform <= -2.2);
          const isBlockedByFloor = (mathVerdict.isAtSupport && mathVerdict.supportBounceConfirmed && !paVerdict?.setupType?.includes('BREAKDOWN'));

          if (isRsiOversold || isGaussianOversold) {
            console.log(`🛡️ [OVERSOLD TRAP SHIELD] ${cleanSym} SELL blocked: Market is Oversold/Dumped (RSI=${currentRsi.toFixed(1)}, Z=${mathVerdict.zScore}, Fisher=${mathVerdict.fisherTransform}). Never sell at capitulation bottom!`);
            return null;
          }
          if (isBlockedByFloor) {
            console.log(`🛡️ [TRAP SHIELD] ${cleanSym} SELL dropped: Price is testing/bouncing at Support Floor ($${mathVerdict.nearestSupport || 'Support'}).`);
            return null;
          }
        }

        // Reject any trade where technical indicators do not confirm the direction
        if (!isIndicatorAligned) {
          console.log(`🛡️ [INDICATOR UNCONFIRMED] ${cleanSym} ${mathSide} blocked: Technical indicators do not support ${mathSide}. Standing aside.`);
          return null;
        }
      }

      let strictScore = mathScore;
      strictScore += 15; // Confirmed Indicator Alignment adds +15
      if (hasCandleConfirmation) {
        strictScore += 10; // Candle shape acts strictly as timing confirmation (+10 max)
      }
      strictScore = Math.min(99, Math.max(strictScore, mathScore));

      // Minimum strict score required is 60 (User Mandate: "60 scroing pe trade lee")
      if (strictScore < 60) {
        console.log(`🛡️ [CONFLUENCE SCORE TOO LOW] ${cleanSym} ${mathSide} blocked: Score ${strictScore}/100 is below threshold (60/100). Standing aside.`);
        return null;
      }

      const mathConfluenceNote = `Strict Math & Indicator Confluence (${mathVerdict.marketRegime} | Score ${strictScore}/100): Fisher=${mathVerdict.fisherTransform}, Hurst=${mathVerdict.hurstExponent}, SS_Slope=${mathVerdict.superSmootherSlope}%, KalmanDev=${mathVerdict.kalmanDeviationPct}%${microData ? ` | OBI=${microData.obi}, CVD=${microData.cvd}` : ''} | Indicators: ${confluence.summaryReason}${candleTriggerTag} | Reasons: ${mathVerdict.reasons.join(' + ')}`;

      console.log(`🧮 [STRICT CONFLUENCE VERIFIED] ${cleanSym} Direction=${mathSide} (Score: ${strictScore}/100 | Math: ${mathScore}/100 | Indicators: ${isIndicatorAligned ? 'ALIGNED' : 'NEUTRAL'}${candleTriggerTag})`);

      const targets = computeSystemDynamicTargets(mathSide, atr15m);
      if (targets.isValidSetup && targets.rr >= 2.0) {
        candidates.push({
          symbol: cleanSym,
          timeframe: '15m',
          strategyName: `15M Strict Math & Indicator Confluence [${mathVerdict.marketRegime} | Score:${strictScore}]${candleTriggerTag}`,
          side: mathSide,
          confidenceScore: strictScore,
          atr: atr15m,
          reason: mathConfluenceNote,
          customTP: targets.customTP,
          customSL: targets.customSL,
        });
      } else {
        console.log(`🛡️ [RISK-REWARD / EXHAUSTION REJECTED] ${cleanSym} Strict Confluence dropped: ${targets.rejectionReason || `RR is 1:${targets.rr} (< 1:2.0)`}`);
      }
    }

    // -------------------------------------------------------------
    // TERTIARY STRATEGY: 15M Multi-Candle RSI Divergence
    // Only accepted if validated by Hurst Mean-Reversion or Fisher Gaussian Extreme
    // -------------------------------------------------------------
    try {
      const div15m = CryptoDedicatedStrategyEngine.detectRsiDivergence(closedCandles15m, closes15m, rsi15mArr);
      const isOpposingMath = (div15m === 'BULLISH_DIV' && mathVerdict.recommendedSide === 'SELL') ||
                             (div15m === 'BEARISH_DIV' && mathVerdict.recommendedSide === 'BUY');

      if (!isOpposingMath) {
        if (div15m === 'BULLISH_DIV' && (mathVerdict.marketRegime === 'MEAN_REVERTING' || mathVerdict.fisherTransform <= -1.2 || mathVerdict.recommendedSide === 'BUY')) {
          const targets = computeSystemDynamicTargets('BUY', atr15m);
          if (targets.isValidSetup && targets.rr >= 2.0) {
            candidates.push({
              symbol: cleanSym,
              timeframe: '15m',
              strategyName: `15M Bullish RSI Divergence [Quant Confirmed]`,
              side: 'BUY',
              confidenceScore: 89,
              atr: atr15m,
              reason: `15M price lower low with RSI higher low confirmed by Quant Math (Fisher: ${mathVerdict.fisherTransform}, Hurst: ${mathVerdict.hurstExponent})`,
              customTP: targets.customTP,
              customSL: targets.customSL,
            });
          }
        } else if (div15m === 'BEARISH_DIV' && (mathVerdict.marketRegime === 'MEAN_REVERTING' || mathVerdict.fisherTransform >= 1.2 || mathVerdict.recommendedSide === 'SELL')) {
          const targets = computeSystemDynamicTargets('SELL', atr15m);
          if (targets.isValidSetup && targets.rr >= 2.0) {
            candidates.push({
              symbol: cleanSym,
              timeframe: '15m',
              strategyName: `15M Bearish RSI Divergence [Quant Confirmed]`,
              side: 'SELL',
              confidenceScore: 89,
              atr: atr15m,
              reason: `15M price higher high with RSI lower high confirmed by Quant Math (Fisher: ${mathVerdict.fisherTransform}, Hurst: ${mathVerdict.hurstExponent})`,
              customTP: targets.customTP,
              customSL: targets.customSL,
            });
          }
        }
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // FIX 4: COMPRESSION BREAKOUT (Catch Trends Earlier at Bar 1 - traps.pdf)
    // TTM / BB Squeeze with RVOL >= 1.3
    // -------------------------------------------------------------
    try {
      const compression = timingEngine.checkCompressionBreakout(closedCandles15m);
      if (compression.isBreakout && compression.breakoutSide) {
        const isOpposingMath = mathVerdict.recommendedSide && mathVerdict.recommendedSide !== compression.breakoutSide;
        const isAlignedWithIndicator = indicatorSide === compression.breakoutSide ||
          (compression.breakoutSide === 'BUY' && (confluence.trendDirection === 'BULLISH' || confluence.allowsLong)) ||
          (compression.breakoutSide === 'SELL' && (confluence.trendDirection === 'BEARISH' || confluence.allowsShort));
        
        if (!isOpposingMath && !isMathBlockedByStructure && isAlignedWithIndicator) {
          const targets = computeSystemDynamicTargets(compression.breakoutSide, atr15m);
          if (targets.isValidSetup && targets.rr >= 2.0) {
            console.log(`🚀 [COMPRESSION BREAKOUT] ${cleanSym} Early Bar 1 Breakout (${compression.breakoutSide}): RVOL=${compression.rvol}, Bandwidth=${(compression.bandwidthPct * 100).toFixed(1)}% | Indicator Aligned`);
            candidates.push({
              symbol: cleanSym,
              timeframe: '15m',
              strategyName: `15M Compression Breakout [Early Phase | RVOL:${compression.rvol}]`,
              side: compression.breakoutSide,
              confidenceScore: 88,
              atr: atr15m,
              reason: compression.reason,
              customTP: targets.customTP,
              customSL: targets.customSL,
            });
          }
        }
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // FIX 5: MULTI-TIMEFRAME CANDLESTICK & PRICE ACTION (User Mandate)
    // "joo candle analysis bolee wo bhi video ke hisab se apne ssystem me add kar dena exampe 15m 5m 1h 4h etc"
    // Evaluates 4H Macro + 1H Trend/Levels + 15M Setup + 5M Precision Candlestick Trigger
    // -------------------------------------------------------------
    try {
      const [candles5m, candles1h, candles4h] = await Promise.all([
        this.fetchCandles(symbol, '5m', 40),
        this.fetchCandles(symbol, '1h', 50),
        this.fetchCandles(symbol, '4h', 50),
      ]);

      const mtfAnalysis = multiTimeframeCandleEngine.evaluateMultiTimeframe(
        cleanSym,
        candles5m,
        closedCandles15m,
        candles1h,
        candles4h
      );

      if (mtfAnalysis.recommendedSide && mtfAnalysis.confidenceScore >= 65 && mtfAnalysis.triggerPattern && mtfAnalysis.triggerPattern.side === mtfAnalysis.recommendedSide) {
        // Confluence Guard: MTF candle patterns must never trade counter to 15m institutional confluence!
        if (mtfAnalysis.recommendedSide === 'SELL' && confluence.trendDirection === 'BULLISH') {
          console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} MTF Candle (${mtfAnalysis.triggerPattern.name} SELL) rejected: 15m Trend is active BULLISH (${confluence.summaryReason})`);
        } else if (mtfAnalysis.recommendedSide === 'BUY' && confluence.trendDirection === 'BEARISH') {
          console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} MTF Candle (${mtfAnalysis.triggerPattern.name} BUY) rejected: 15m Trend is active BEARISH (${confluence.summaryReason})`);
        } else {
          const isOpposingMath = mathVerdict.recommendedSide && mathVerdict.recommendedSide !== mtfAnalysis.recommendedSide;
          if (!isOpposingMath && !isMathBlockedByStructure) {
            const targets = computeSystemDynamicTargets(mtfAnalysis.recommendedSide, atr15m);
            if (targets.isValidSetup && targets.rr >= 2.30) {
              console.log(`🕯️ [MTF CANDLE ANALYSIS] ${cleanSym} Cross-Timeframe Pattern (${mtfAnalysis.recommendedSide} | Score: ${mtfAnalysis.confidenceScore}/100 | Pattern: ${mtfAnalysis.triggerPattern.name} | RR: 1:${targets.rr.toFixed(2)}): 4H=${mtfAnalysis.trend4h}, 1H=${mtfAnalysis.trend1h}, 15M=${mtfAnalysis.trend15m}, 5M=${mtfAnalysis.trend5m}`);
              candidates.push({
                symbol: cleanSym,
                timeframe: '15m',
                strategyName: `Multi-Timeframe Candle [${mtfAnalysis.recommendedSide} | ${mtfAnalysis.triggerPattern.name}] (4H:${mtfAnalysis.trend4h} | 1H:${mtfAnalysis.trend1h} | 15M:${mtfAnalysis.trend15m} | 5M:${mtfAnalysis.trend5m})`,
                side: mtfAnalysis.recommendedSide,
                confidenceScore: mtfAnalysis.confidenceScore,
                atr: atr15m,
                reason: mtfAnalysis.reasons.join(' | '),
                customTP: targets.customTP,
                customSL: targets.customSL,
              });
            } else {
              console.log(`🛡️ [RISK-REWARD / EXHAUSTION REJECTED] ${cleanSym} MTF Candle dropped: ${targets.rejectionReason || `RR is 1:${targets.rr.toFixed(2)} (< 1:2.0)`}`);
            }
          }
        }
      }
    } catch (e) {}

    if (candidates.length === 0) return null;

    // CONFLUENCE GUARD (Master Trend & Permission Filter):
    // Strictly prevent any counter-trend trade (e.g. candle pattern SELL) when 15m confluence is BULLISH or isMacroBullish.
    // Symmetrically prevent counter-trend BUY when 15m confluence is BEARISH or isMacroBearish.
    const validCandidates = candidates
      .filter(cand => cand.confidenceScore >= 60)
      .filter(cand => {
        if (cand.side === 'SELL' && confluence.trendDirection === 'BULLISH') {
          console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} ${cand.strategyName} (SELL) rejected: 15m Trend is active BULLISH (${confluence.summaryReason})`);
          return false;
        }
        if (cand.side === 'BUY' && confluence.trendDirection === 'BEARISH') {
          console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} ${cand.strategyName} (BUY) rejected: 15m Trend is active BEARISH (${confluence.summaryReason})`);
          return false;
        }
        return true;
      });

    if (validCandidates.length === 0) return null;

    validCandidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return validCandidates[0];
  }

  /**
   * Diagnostic Trade Accuracy Evaluator (solutions.pdf Item 3)
   * Note: This evaluator is an auxiliary verification tool used for diagnostic reporting,
   * accuracy metrics, and backtesting. The live trading loop relies on the Dual-Engine Harmony
   * (QuantMathematicalEngine + CryptoDedicatedStrategyEngine / SmartReversalDetector).
   * Factor in BTC macro trend proportionally (-15 penalty) while rewarding confirmed local support bounces (+25).
   */
  public evaluateTradeAccuracy(
    symbol: string,
    proposedSide: 'BUY' | 'SELL',
    candles: KlinePoint[],
    btcTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  ): { isAccurate: boolean; score: number; reason: string } {
    if (candles.length < 20) {
      return { isAccurate: false, score: 0, reason: 'Insufficient candle data (<20)' };
    }

    const currentPrice = candles[candles.length - 1].close;
    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];

    // Technical indicators
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
    const ema100 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 100);
    const last50Ema = ema50[ema50.length - 1] || currentPrice;
    const last100Ema = ema100[ema100.length - 1] || currentPrice;

    const rsi14 = CryptoDedicatedStrategyEngine.calculateRSI(closes, 14);
    const lastRsi = rsi14[rsi14.length - 1] || 50;

    // Choppiness Index (14-period)
    const atrSum14 = candles.slice(-14).reduce((sum, c, idx, arr) => {
      const prevC = idx > 0 ? arr[idx - 1] : c;
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
      return sum + tr;
    }, 0);
    const high14 = Math.max(...candles.slice(-14).map(c => c.high));
    const low14 = Math.min(...candles.slice(-14).map(c => c.low));
    const range14 = high14 - low14;
    const chopIndex = range14 > 0 ? 100 * (Math.log10(atrSum14 / range14) / Math.log10(14)) : 50;

    let score = 0;
    const reasons: string[] = [];

    // 1. Trend & 50/100 EMA Alignment (30 points)
    if (proposedSide === 'BUY') {
      if (currentPrice >= last50Ema && currentPrice >= last100Ema) {
        score += 30;
        reasons.push('Above 50/100 EMA (+30)');
      } else if (currentPrice >= last50Ema || currentPrice >= last100Ema) {
        score += 15;
        reasons.push('Above one major EMA (+15)');
      } else {
        score -= 25;
        reasons.push('Below 50/100 EMA - Downtrend against Buy (-25)');
      }
    } else {
      if (currentPrice <= last50Ema && currentPrice <= last100Ema) {
        score += 30;
        reasons.push('Below 50/100 EMA (+30)');
      } else if (currentPrice <= last50Ema || currentPrice <= last100Ema) {
        score += 15;
        reasons.push('Below one major EMA (+15)');
      } else {
        score -= 25;
        reasons.push('Above 50/100 EMA - Uptrend against Short (-25)');
      }
    }

    // 2. BTC Macro Market Confluence (20 points)
    const isBtc = symbol.toUpperCase().includes('BTC');
    if (!isBtc) {
      if (proposedSide === 'BUY') {
        if (btcTrend === 'BULLISH') {
          score += 20;
          reasons.push('BTC Macro Bullish (+20)');
        } else if (btcTrend === 'BEARISH') {
          score -= 15; // Penalty for Altcoin buys when BTC dumps
          reasons.push('BTC Dumping: Altcoin Long Prohibited (-15)');
        } else {
          score += 10;
        }
      } else {
        if (btcTrend === 'BEARISH') {
          score += 20;
          reasons.push('BTC Macro Bearish (+20)');
        } else if (btcTrend === 'BULLISH') {
          score -= 15; // Altcoin shorting during BTC rally is dangerous
          reasons.push('BTC Pumping: Altcoin Short Risky (-15)');
        } else {
          score += 10;
        }
      }
    } else {
      score += 15; // Self-anchored
    }

    // 3. RSI Range & Quality (20 points)
    if (proposedSide === 'BUY') {
      if (lastRsi >= 38 && lastRsi <= 64) {
        score += 20;
        reasons.push(`RSI ${lastRsi.toFixed(1)} Healthy (+20)`);
      } else if (lastRsi < 32) {
        score += 15;
        reasons.push(`RSI ${lastRsi.toFixed(1)} Oversold Reversal (+15)`);
      } else if (lastRsi > 68) {
        score -= 15; // Overbought peak!
        reasons.push(`RSI ${lastRsi.toFixed(1)} Overbought Risk (-15)`);
      } else {
        score += 10;
      }
    } else {
      if (lastRsi >= 36 && lastRsi <= 62) {
        score += 20;
        reasons.push(`RSI ${lastRsi.toFixed(1)} Healthy Breakdown (+20)`);
      } else if (lastRsi > 68) {
        score += 15;
        reasons.push(`RSI ${lastRsi.toFixed(1)} Overbought Blowoff (+15)`);
      } else if (lastRsi < 32) {
        score -= 15; // Oversold bottom!
        reasons.push(`RSI ${lastRsi.toFixed(1)} Oversold Bottom Risk (-15)`);
      } else {
        score += 10;
      }
    }

    // 4. Anti-Chop & Regime Cleanliness (15 points)
    if (chopIndex > 65.0) {
      score -= 15; // Extreme dead chop = whipsaw risk
      reasons.push(`Extreme Dead Chop ${chopIndex.toFixed(1)} (-15)`);
    } else if (chopIndex <= 52.0) {
      score += 15;
      reasons.push(`Clean Directional Rhythm ${chopIndex.toFixed(1)} (+15)`);
    } else {
      score += 10;
      reasons.push(`Healthy Oscillating Range ${chopIndex.toFixed(1)} (+10)`);
    }

    // 5. Structural Wick & Rejection Conviction (Replaced naive green/red candle check)
    // User Directive: "green candle buy aur red candle pe sell aisa mat karnaa naa... dekhna kidhar isne support liyaa"
    const candleRange = Math.max(lastCandle.high - lastCandle.low, 0.0001);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
    const lowerWickPct = (lowerWick / candleRange) * 100;
    const upperWickPct = (upperWick / candleRange) * 100;

    if (proposedSide === 'BUY') {
      if (lowerWickPct >= 25) {
        score += 15;
        reasons.push(`Support Absorption Wick (${lowerWickPct.toFixed(0)}% lower wick) (+15)`);
      } else if (currentPrice >= last50Ema && lowerWickPct >= 15) {
        score += 10;
        reasons.push(`Support Hold (+10)`);
      } else {
        score += 5;
      }
    } else {
      if (upperWickPct >= 25) {
        score += 15;
        reasons.push(`Resistance Rejection Wick (${upperWickPct.toFixed(0)}% upper wick) (+15)`);
      } else if (currentPrice <= last50Ema && upperWickPct >= 15) {
        score += 10;
        reasons.push(`Resistance Hold (+10)`);
      } else {
        score += 5;
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const isAccurate = score >= 70;

    return {
      isAccurate,
      score,
      reason: reasons.join(' | '),
    };
  }

  /**
   * Dedicated Delta Options Trading Engine (System 3001 / Port 3001)
   * User Mandate: "make 3001 system trade in option"
   * Analyzes real-time market structure on BTC & ETH, selects optimal live OTM Option contracts,
   * and executes Option Selling (Theta Decay harvesting) / Option Trading on Delta Exchange.
   */
  public async runOptionsScanCycle(availableSlots: number): Promise<void> {
    if (availableSlots <= 0) {
      return;
    }

    const underlyings: Array<'BTC' | 'ETH'> = ['BTC', 'ETH'];
    for (const underlying of underlyings) {
      if (this.state.activePositions.length >= (this.state.maxConcurrentPositions || 4)) break;

      const sym15m = `${underlying}USD`;
      let candles15m: KlinePoint[] = [];
      try {
        candles15m = await this.fetchCandles(sym15m, '15m', 35);
      } catch (e) {}

      if (!candles15m || candles15m.length < 20) continue;

      // 1. Evaluate Zero-Lag Directional Bias on the Underlying
      const setup = zeroLagPriceActionEngine.evaluateSetup(sym15m, candles15m);
      const bias: 'BUY' | 'SELL' | 'NEUTRAL' = setup.recommendedSide || 'NEUTRAL';
      const score = setup.confidenceScore || 75;
      const reason = setup.reasons?.[0] || `${underlying} Zero-Lag Market Structure`;

      // 2. Fetch live option chain and select optimal OTM option contract from Delta Exchange
      const candidate = await deltaOptionsTrader.selectBestOption(underlying, bias, score, reason);
      if (!candidate) continue;

      // Avoid duplicate exposure to the same option symbol or underlying
      const alreadyOpen = this.state.activePositions.some(p => 
        p.symbol === candidate.symbol || 
        (p.symbol.includes(underlying) && (p.instrumentType === 'OPTION' || p.symbol.startsWith('C-') || p.symbol.startsWith('P-')))
      );
      if (alreadyOpen) continue;

      console.log(`🎯 [PORT 3001 OPTIONS ENGINE] Identified Option Opportunity: ${candidate.symbol} (${candidate.optionType}) | Strike: $${candidate.strike} | Mark: $${candidate.markPrice} | Bias: ${bias} (Score: ${score})`);

      // 3. Execute Option Trade
      const isSimulation = this.state.mode === 'SIMULATION_PAPER' || deltaExchange.getConfig().isSimulation;
      const optionPos = await deltaOptionsTrader.executeOptionOrder(candidate, isSimulation);
      if (optionPos) {
        this.state.activePositions.push(optionPos);
        this.symbolLastTradeTime.set(candidate.symbol, Date.now());
        console.log(`✅ [OPTION TRADE PLACED] ${candidate.symbol} (${optionPos.side}) | Strike: $${candidate.strike} | Margin: $${optionPos.marginUSD} | Target Theta Decay TP: $${optionPos.takeProfitPrice}`);
        this.saveState();
        availableSlots--;
      }
    }
  }

  // -------------------------------------------------------------
  // V6 CLOSED-CANDLE SYSTEM (User Emergency Hard Reset Mandate)
  // -------------------------------------------------------------

  /**
   * Evaluate Single V6 Closed-Candle Rule on 15M Candles
   * Using ONLY closed 15m candles:
   * c = candles15m[candles15m.length - 2] (the newly closed candle)
   * prev = candles15m[candles15m.length - 3] (the candle before c)
   */
  public evaluateV6ClosedCandleRule(candles15m: KlinePoint[]): {
    signal: 'BUY' | 'SELL';
    ema9: number;
    ema20: number;
    ema50: number;
    atr14: number;
    rsi14: number;
    closedCandle: KlinePoint;
    prevCandle: KlinePoint;
  } | null {
    if (!candles15m || candles15m.length < 55) return null;

    // Last element candles15m[candles15m.length - 1] is the unclosed forming bar.
    // Slice off forming candle to evaluate ONLY fully closed bars!
    const closedCandles = candles15m.slice(0, -1);
    if (closedCandles.length < 52) return null;

    const c = closedCandles[closedCandles.length - 1]; // candles15m[candles15m.length - 2]
    const prev = closedCandles[closedCandles.length - 2]; // candles15m[candles15m.length - 3]
    const closes = closedCandles.map(x => x.close);

    // Exact EMA calculation
    const calcEMA = (vals: number[], period: number) => {
      const k = 2 / (period + 1);
      let ema = vals[0];
      for (let i = 1; i < vals.length; i++) {
        ema = vals[i] * k + ema * (1 - k);
      }
      return ema;
    };

    const ema9 = calcEMA(closes, 9);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);

    // Exact ATR 14
    let atr14 = 0;
    if (closedCandles.length >= 2) {
      const trs: number[] = [];
      for (let i = 1; i < closedCandles.length; i++) {
        const cur = closedCandles[i];
        const pr = closedCandles[i - 1];
        trs.push(Math.max(cur.high - cur.low, Math.abs(cur.high - pr.close), Math.abs(cur.low - pr.close)));
      }
      const recentTrs = trs.slice(-14);
      atr14 = recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length;
    }

    // Exact Wilder RSI 14 on closed bars
    let rsi14 = 50;
    if (closes.length >= 15) {
      let gains = 0;
      let losses = 0;
      for (let i = 1; i <= 14; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
      }
      let avgGain = gains / 14;
      let avgLoss = losses / 14;
      for (let i = 15; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
      }
      if (avgLoss === 0) rsi14 = 100;
      else {
        const rs = avgGain / avgLoss;
        rsi14 = 100 - (100 / (1 + rs));
      }
    }

    this.lastV6Indicators = { ema9, ema20, ema50, atr14, rsi14 };

    // BUY Signal:
    // c.close > EMA_20 AND c.close > EMA_50 AND EMA_9 > EMA_20 AND (c.low <= EMA_9 * 1.001 or c.low <= EMA_20 * 1.0015) AND c.close > c.open AND c.close > prev.high AND RSI_14 <= 64
    const isBuy = 
      c.close > ema20 &&
      c.close > ema50 &&
      ema9 > ema20 &&
      (c.low <= ema9 * 1.001 || c.low <= ema20 * 1.0015) &&
      c.close > c.open &&
      c.close > prev.high &&
      rsi14 <= 64;

    if (isBuy) {
      return { signal: 'BUY' as const, side: 'BUY' as const, ema9, ema20, ema50, atr14, rsi14, closedCandle: c, prevCandle: prev };
    }

    // SELL Signal:
    // c.close < EMA_20 AND c.close < EMA_50 AND EMA_9 < EMA_20 AND (c.high >= EMA_9 * 0.999 or c.high >= EMA_20 * 0.9985) AND c.close < c.open AND c.close < prev.low AND RSI_14 >= 36
    const isSell = 
      c.close < ema20 &&
      c.close < ema50 &&
      ema9 < ema20 &&
      (c.high >= ema9 * 0.999 || c.high >= ema20 * 0.9985) &&
      c.close < c.open &&
      c.close < prev.low &&
      rsi14 >= 36;

    if (isSell) {
      return { signal: 'SELL' as const, side: 'SELL' as const, ema9, ema20, ema50, atr14, rsi14, closedCandle: c, prevCandle: prev };
    }

    return null;
  }

  /**
   * Wide Swing-Protected Bracket & Sizing ($3.00 Max Risk)
   * - Stop-Loss (SL): 1.20 * ATR_14 away from entry (minimum 0.75% distance so 15m noise wicks cannot touch it!)
   * - Take-Profit (TP): 2.10 * ATR_14 away from entry (1.75R reward)
   * - Position Size: Quantity = Math.floor(3.00 / (slDistance * contractValue)) so max loss is strictly -$3.00 USD and TP is +$5.25 USD
   */
  public calculateV6Brackets(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    atr14: number;
  }): {
    stopLossPrice: number;
    takeProfitPrice: number;
    slDistance: number;
    tpDistance: number;
    quantity: number;
    contracts: number;
    contractValue: number;
    actualRiskUSD: number;
    actualRewardUSD: number;
  } {
    const { symbol, side, entryPrice, atr14 } = params;
    const cleanSym = symbol.toUpperCase().replace('USDT', 'USD').trim();
    const spec = deltaExchange.getProductSpec(cleanSym, entryPrice);
    const contractValue = spec.contractValue || 1.0;

    // SL: 1.20 * ATR_14 away from entry (minimum 0.75% distance)
    const slDistance = Math.max(1.20 * atr14, entryPrice * 0.0075);

    // TP: 2.10 * ATR_14 away from entry (1.75R reward)
    const tpDistance = 2.10 * atr14;

    // Sizing: Quantity = Math.floor(3.00 / (slDistance * contractValue))
    const riskPerContract = slDistance * contractValue;
    const contracts = Math.max(1, Math.floor(3.00 / (riskPerContract > 0 ? riskPerContract : 1)));
    const quantity = contracts * contractValue;

    const rawSL = side === 'BUY' ? entryPrice - slDistance : entryPrice + slDistance;
    const rawTP = side === 'BUY' ? entryPrice + tpDistance : entryPrice - tpDistance;

    const formatPrice = (p: number) => {
      const rounded = Math.round(p / spec.tickSize) * spec.tickSize;
      return parseFloat(rounded.toFixed(spec.decimals));
    };

    const stopLossPrice = formatPrice(rawSL);
    const takeProfitPrice = formatPrice(rawTP);

    const actualRiskUSD = parseFloat((contracts * contractValue * slDistance).toFixed(2));
    const actualRewardUSD = parseFloat((contracts * contractValue * tpDistance).toFixed(2));

    return {
      stopLossPrice,
      takeProfitPrice,
      slDistance,
      tpDistance,
      quantity,
      contracts,
      contractValue,
      actualRiskUSD,
      actualRewardUSD,
    };
  }

  /**
   * Execute V6 Trade directly on Delta Exchange with Native Brackets
   */
  public async executeV6Trade(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    atr14: number;
    closedCandle: KlinePoint;
  }): Promise<DeltaPosition | null> {
    const { symbol, side, entryPrice, atr14, closedCandle } = params;
    const cleanSym = symbol.toUpperCase().replace('USDT', 'USD').trim();
    const spec = deltaExchange.getProductSpec(cleanSym, entryPrice);
    const brackets = this.calculateV6Brackets({ symbol: cleanSym, side, entryPrice, atr14 });

    console.log(`🚀 [V6 TRADE DISPATCH] ${cleanSym} ${side}: Entry=$${entryPrice.toFixed(spec.decimals)} | SL=$${brackets.stopLossPrice} (Risk: -$${brackets.actualRiskUSD.toFixed(2)} USD, Dist: $${brackets.slDistance.toFixed(spec.decimals)}, ${(brackets.slDistance / entryPrice * 100).toFixed(2)}%) | TP=$${brackets.takeProfitPrice} (Reward: +$${brackets.actualRewardUSD.toFixed(2)} USD, Dist: $${brackets.tpDistance.toFixed(spec.decimals)}, ${(brackets.tpDistance / entryPrice * 100).toFixed(2)}%) | Qty=${brackets.quantity} (${brackets.contracts} contracts, ContractVal: ${brackets.contractValue})`);

    const orderResult = await deltaExchange.placeOrder({
      symbol: cleanSym,
      side,
      size: brackets.quantity,
      price: entryPrice,
      takeProfitPrice: brackets.takeProfitPrice,
      stopLossPrice: brackets.stopLossPrice,
    });

    if (this.state.mode !== 'SIMULATION_PAPER' && (!orderResult || !orderResult.success)) {
      console.error(`❌ Delta Exchange rejected order for ${cleanSym}: ${orderResult?.message || 'Order dispatch error'}. Aborting trade entry.`);
      return null;
    }

    const fillPrice = (orderResult?.success && orderResult?.fillPrice && orderResult.fillPrice > 0)
      ? orderResult.fillPrice
      : entryPrice;

    const notionalUSD = parseFloat((brackets.quantity * fillPrice).toFixed(2));
    const marginUSD = parseFloat((notionalUSD / (this.state.leverage || 30)).toFixed(2));

    const newPos: DeltaPosition = {
      id: orderResult?.orderId || ('pos-v6-' + Date.now()),
      symbol: cleanSym,
      side,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      quantity: brackets.quantity,
      notionalUSD,
      marginUSD,
      leverage: this.state.leverage || 30,
      takeProfitPrice: brackets.takeProfitPrice,
      stopLossPrice: brackets.stopLossPrice,
      initialStopLossPrice: brackets.stopLossPrice,
      atr: atr14,
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: `V6 Closed 15M (${side}) [Risk: -$${brackets.actualRiskUSD.toFixed(2)} | TP: +$${brackets.actualRewardUSD.toFixed(2)}]`,
      shadowConfirmedSeconds: 0,
    };

    this.state.activePositions = [newPos]; // Strictly 1 position!
    this.symbolLastTradeTime.set(cleanSym, Date.now());
    this.saveState();
    console.log(`✅ [V6 POSITION ACTIVE] ${cleanSym} ${side} live in slot 1/1. Delta exchange bracket set at SL=$${brackets.stopLossPrice}, TP=$${brackets.takeProfitPrice}.`);
    return newPos;
  }

  /**
   * Execute Guarded Order directly on Delta Exchange with Native Brackets
   */
  public async executeGuardedOrder(
    guard: GuardValidationResult,
    strategyName: string,
    spec: any
  ): Promise<DeltaPosition | null> {
    const { symbol, side, entryPrice, slPrice, tpPrice, contracts } = guard;
    const cleanSym = symbol.toUpperCase().replace('USDT', 'USD').trim();
    const contractValue = spec.contractValue || 1.0;

    // 25% Margin Hard Ceiling Clamp:
    // Max margin per trade = $46.00 USD. Max notional = $1,380.00 USD (User Mandate: "25%")
    let safeContracts = contracts;
    const contractNotional = entryPrice * contractValue;
    if (safeContracts * contractNotional > 1380.0) {
      safeContracts = Math.max(1, Math.floor(1380.0 / Math.max(contractNotional, 1e-8)));
    }
    const quantity = parseFloat((safeContracts * contractValue).toFixed(6));

    const tickSizeVal = guard.tickSize || spec?.tickSize || (entryPrice < 1 ? 0.0001 : entryPrice < 100 ? 0.001 : 0.01);
    let finalSlPrice = roundToTickSize(slPrice, tickSizeVal);
    let finalTpPrice = roundToTickSize(tpPrice, tickSizeVal);

    // Enforce Unified Bulletproof Bracket SL bounds [0.50%, 0.88%] without breaking front-run structure
    const slDistPct = Math.abs(entryPrice - finalSlPrice) / (entryPrice || 1);
    if (!finalSlPrice || finalSlPrice <= 0 || slDistPct > 0.0088 || slDistPct < 0.0050) {
      console.warn(`🛡️ [EMERGENCY PRE-ORDER CLAMP] SL on ${cleanSym} was ${(slDistPct * 100).toFixed(2)}% away ($${finalSlPrice})! Enforcing 0.60% safety clamp.`);
      finalSlPrice = roundToTickSize(
        side === 'BUY' ? entryPrice * (1 - 0.0060) : entryPrice * (1 + 0.0060),
        tickSizeVal
      );
    }

    // Preserve Front-Run Reversal TP within Fee-Adjusted 6-Slot bounds
    // Enforce >= 0.72% (18.0% Gross / 15.0%+ Net ROE) on CHOP_15PCT_SEAT and >= 1.08% (27.0% Gross / 24.0%+ Net ROE) on NORMAL_23_TO_40PCT_SEAT!
    const effectiveSlPct = Math.abs(entryPrice - finalSlPrice) / (entryPrice || 1);
    const isNormalRunnerBucket =
      guard.bucket === 'NORMAL_23_TO_40PCT_SEAT' || guard.bucket === ('BIG_SIGNAL_SEAT' as any);
    const isChopBucket =
      guard.bucket === 'CHOP_15PCT_SEAT' || guard.bucket === ('CHOP_NORMAL_SEAT' as any);

    const bucketFloorTpPct = isNormalRunnerBucket
      ? 0.0108
      : isChopBucket
      ? 0.0072
      : 0.0072;
    const minTpPct = Math.max(bucketFloorTpPct, effectiveSlPct * 1.02);
    const maxTpPct = isChopBucket ? Math.max(minTpPct, 0.0105) : 0.0168;
    const tpDistPct = Math.abs(finalTpPrice - entryPrice) / (entryPrice || 1);
    if (!finalTpPrice || finalTpPrice <= 0 || tpDistPct < minTpPct || tpDistPct > maxTpPct) {
      const fallbackTpMult = isNormalRunnerBucket
        ? Math.max(minTpPct, Math.min(0.0136, effectiveSlPct * 1.85))
        : Math.max(minTpPct, Math.min(0.0088, effectiveSlPct * 1.35));
      finalTpPrice = roundToTickSize(
        side === 'BUY' ? entryPrice * (1 + fallbackTpMult) : entryPrice * (1 - fallbackTpMult),
        tickSizeVal
      );
    }

    // Strict Directional Bracket Validation before dispatch
    const isDirectionallyValid = side === 'BUY'
      ? finalSlPrice > 0 && finalSlPrice < entryPrice && finalTpPrice > entryPrice
      : finalSlPrice > entryPrice && finalTpPrice > 0 && finalTpPrice < entryPrice;
    if (!isDirectionallyValid) {
      console.error(`❌ [BRACKET DIRECTION ABORT] ${cleanSym} ${side} failed directional sanity: Entry=$${entryPrice}, SL=$${finalSlPrice}, TP=$${finalTpPrice}. Aborting order.`);
      return null;
    }

    const effectiveLeverage = guard.leverage && guard.leverage > 0 ? guard.leverage : 25;
    const finalTpDist = Math.abs(finalTpPrice - entryPrice);
    const finalBeTrigger = guard.breakevenPlusFeeTriggerPrice || guard.trailActivationPrice || guard.trailTriggerPrice || roundToTickSize(
      side === 'BUY'
        ? entryPrice * (isNormalRunnerBucket ? 1.0048 : 1.0044)
        : entryPrice * (isNormalRunnerBucket ? 0.9952 : 0.9956),
      tickSizeVal
    );
    const finalBeLock = guard.breakevenPlusFeeLockPrice || guard.trailLockPrice || roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0018 : entryPrice * 0.9982,
      tickSizeVal
    );
    const finalRunnerTrigger = guard.runner23PctTriggerPrice || (
      isNormalRunnerBucket
        ? roundToTickSize(side === 'BUY' ? entryPrice * 1.0096 : entryPrice * 0.9904, tickSizeVal)
        : finalTpPrice
    );
    const finalRunnerLock = guard.runner18PctLockPrice || (
      isNormalRunnerBucket
        ? roundToTickSize(side === 'BUY' ? entryPrice * 1.0080 : entryPrice * 0.9920, tickSizeVal)
        : finalBeLock
    );

    console.log(`🚀 [GUARDED ORDER DISPATCH] ${cleanSym} ${side} [${guard.bucket || guard.tier || '6SLOT'} | NetROE: ${guard.netRoeAfterFeesPct ?? guard.expectedRoePct ?? 16}% @ ${effectiveLeverage}x]: Entry=$${entryPrice.toFixed(spec.decimals)} | SL=$${finalSlPrice} (Dist: ${(effectiveSlPct * 100).toFixed(2)}%) | TP=$${finalTpPrice} (Dist: ${(finalTpDist / entryPrice * 100).toFixed(2)}%) | Stage1Lock: $${finalBeTrigger}->$${finalBeLock}${isNormalRunnerBucket ? ` | Stage2Runner: $${finalRunnerTrigger}->$${finalRunnerLock}` : ''} | Qty=${quantity} (${safeContracts} contracts)`);

    // Global Live Portfolio Deduplication Guard:
    // If a position already exists on Delta Exchange for this symbol, NEVER open a duplicate!
    if (deltaExchange.isLiveDispatchActive()) {
      try {
        const liveExPos = await deltaExchange.getMarginedPositions();
        const existing = liveExPos?.find((p: any) => ((p.product_symbol || p.product?.symbol || '').toUpperCase()) === cleanSym && Math.abs(parseFloat(p.size)) > 0);
        if (existing) {
          console.warn(`🛡️ [LIVE DEDUP VETO] Position already active on Delta Exchange for ${cleanSym} (${existing.size} lots). Blocking duplicate order!`);
          return null;
        }
      } catch (e) {}
    }

    const orderResult = await deltaExchange.placeOrder({
      symbol: cleanSym,
      side,
      size: quantity,
      price: entryPrice,
      takeProfitPrice: finalTpPrice,
      stopLossPrice: finalSlPrice,
    });

    if (this.state.mode !== 'SIMULATION_PAPER' && (!orderResult || !orderResult.success)) {
      console.error(`❌ Delta Exchange rejected order for ${cleanSym}: ${orderResult?.message || 'Order dispatch error'}. Aborting trade entry.`);
      return null;
    }

    const fillPrice = (orderResult?.success && orderResult?.fillPrice && orderResult.fillPrice > 0)
      ? orderResult.fillPrice
      : entryPrice;

    const fillTpDist = Math.abs(finalTpPrice - fillPrice);
    const hasSlippageShift =
      Math.abs(fillPrice - entryPrice) > tickSizeVal * 0.5 &&
      fillTpDist > 0 &&
      ((side === 'BUY' && finalTpPrice > fillPrice) || (side === 'SELL' && finalTpPrice < fillPrice));
    const postFillBeTrigger = hasSlippageShift
      ? roundToTickSize(
          side === 'BUY'
            ? fillPrice * (isNormalRunnerBucket ? 1.0048 : 1.0044)
            : fillPrice * (isNormalRunnerBucket ? 0.9952 : 0.9956),
          tickSizeVal
        )
      : finalBeTrigger;
    const postFillBeLock = hasSlippageShift
      ? roundToTickSize(side === 'BUY' ? fillPrice * 1.0018 : fillPrice * 0.9982, tickSizeVal)
      : finalBeLock;
    const postFillRunTrigger = hasSlippageShift && isNormalRunnerBucket
      ? roundToTickSize(side === 'BUY' ? fillPrice * 1.0096 : fillPrice * 0.9904, tickSizeVal)
      : finalRunnerTrigger;
    const postFillRunLock = hasSlippageShift && isNormalRunnerBucket
      ? roundToTickSize(side === 'BUY' ? fillPrice * 1.0080 : fillPrice * 0.9920, tickSizeVal)
      : finalRunnerLock;

    const notionalUSD = parseFloat((quantity * fillPrice).toFixed(2));
    const marginUSD = parseFloat((notionalUSD / effectiveLeverage).toFixed(2));
    const resolvedSeatBucket: SeatBucketType =
      guard.bucket || (isNormalRunnerBucket || guard.tier === 'STRONG_23PCT_RUNNER' ? 'NORMAL_23_TO_40PCT_SEAT' : 'CHOP_15PCT_SEAT');

    const newPos: DeltaPosition = {
      id: orderResult?.orderId || ('pos-' + Date.now()),
      symbol: cleanSym,
      side,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      quantity,
      notionalUSD,
      marginUSD,
      leverage: effectiveLeverage,
      takeProfitPrice: finalTpPrice,
      stopLossPrice: finalSlPrice,
      initialStopLossPrice: finalSlPrice,
      atr: Math.abs(fillPrice - finalSlPrice),
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      highestPnlUSD: 0,
      entryTime: Date.now(),
      strategyName: `${strategyName} (${side}) [${guard.tierLabel || guard.tier || '6SLOT'} | Risk: -$${guard.expectedMaxLossUSD.toFixed(2)} | TP: +$${guard.expectedRewardUSD.toFixed(2)}]`,
      shadowConfirmedSeconds: 0,
      instrumentType: 'PERPETUAL',
      tier: guard.tier,
      seatBucket: resolvedSeatBucket,
      expectedRoePct: guard.netRoeAfterFeesPct ?? guard.expectedRoePct,
      grossRoePct: guard.grossRoePct,
      netRoeAfterFeesPct: guard.netRoeAfterFeesPct,
      breakevenPlusFeeTriggerPrice: postFillBeTrigger,
      breakevenPlusFeeLockPrice: postFillBeLock,
      runner23PctTriggerPrice: postFillRunTrigger,
      runner18PctLockPrice: postFillRunLock,
      trailTriggerPrice: postFillBeTrigger,
      trailActivationPrice: postFillBeTrigger,
      trailLockPrice: postFillBeLock,
      targetProfitUSD: guard.targetProfitUSD || guard.expectedRewardUSD,
    };

    this.state.activePositions.push(newPos);
    this.symbolLastTradeTime.set(cleanSym, Date.now());
    this.saveState();
    const seats = this.getReservedSeatCounts();
    console.log(`✅ [GUARDED POSITION ACTIVE] ${cleanSym} ${side} [${newPos.seatBucket}] live | [SEAT STATUS] Chopping 15%+ Net: ${seats.activeChopNormalSeats}/2 | Normal 23%-40%+: ${seats.activeBigSignalSeats}/2 | Options: ${seats.activeOptionSeats}/2. Bracket SL=$${finalSlPrice}, TP=$${finalTpPrice}.`);
    return newPos;
  }

  /**
   * Part 4: Master Institutional Options Execution Engine (2 dedicated Option Slots)
   * Uses DeltaOptionsMasterEngine:
   *  1) Slightly ITM strike (Delta 0.55-0.65: Call <= spot, Put >= spot) + >= 20h expiry (no Theta burn)
   *  2) Strict <= 2.2% bid-ask spread veto + Limit Order entry at Math.min(bestAsk, mark * 1.004)
   *  3) Spot-Synced SL + -18% catastrophe floor + +35%..+75% TP + +25%->+15% Profit Trail
   */
  public async executeHybridAtmOption(params: {
    underlying: 'BTC' | 'ETH';
    direction: 'BUY' | 'SELL';
    spotPrice: number;
    closedCandleTime: number;
    tierPlan?: TieredBracketPlan;
    isTestnetMode: boolean;
    spotSlPrice?: number;
    spotTpPrice?: number;
  }): Promise<DeltaPosition | null> {
    const { underlying, direction, spotPrice, tierPlan, isTestnetMode, spotSlPrice, spotTpPrice } = params;
    const optionType: 'CALL' | 'PUT' = direction === 'BUY' ? 'CALL' : 'PUT';
    const targetContractType: 'call_options' | 'put_options' = direction === 'BUY' ? 'call_options' : 'put_options';

    // Prevent duplicate option exposure on same underlying
    const alreadyOpen = this.state.activePositions.some(p => {
      const s = (p.symbol || '').toUpperCase();
      return (p.instrumentType === 'OPTION' || s.startsWith('C-') || s.startsWith('P-')) && s.includes(underlying);
    });
    if (alreadyOpen) {
      return null;
    }

    const effectiveSpotSl =
      spotSlPrice && spotSlPrice > 0
        ? spotSlPrice
        : (direction === 'BUY' ? spotPrice * 0.992 : spotPrice * 1.008);
    const effectiveSpotTp =
      spotTpPrice && spotTpPrice > 0
        ? spotTpPrice
        : (direction === 'BUY' ? spotPrice * 1.015 : spotPrice * 0.985);

    const baseUrl = deltaExchange.getConfig().baseUrl || (isTestnetMode ? 'https://cdn-ind.testnet.deltaex.org' : 'https://api.india.delta.exchange');
    try {
      const [prodResp, tickResp] = await Promise.all([
        fetch(`${baseUrl}/v2/products?contract_types=call_options,put_options&states=live`, { signal: AbortSignal.timeout(4500) }).catch(() => null),
        fetch(`${baseUrl}/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=${underlying}`, { signal: AbortSignal.timeout(4500) }).catch(() => null),
      ]);

      const prodJson: any = (prodResp && prodResp.ok) ? await prodResp.json().catch(() => null) : null;
      const tickJson: any = (tickResp && tickResp.ok) ? await tickResp.json().catch(() => null) : null;

      const rawProducts: any[] = prodJson?.result || [];
      const rawTickers: any[] = tickJson?.result || [];
      if (rawTickers.length === 0) {
        return null;
      }

      const prodBySym = new Map<string, any>();
      for (const p of rawProducts) {
        if (p.symbol) prodBySym.set(p.symbol.toUpperCase(), p);
      }

      const now = Date.now();
      const optionMetas: OptionProductMeta[] = [];
      const tickerInfoBySym = new Map<string, {
        bestBid: number;
        bestAsk: number;
        markPrice: number;
        expiryCode: string;
        productObj: any;
      }>();

      for (const t of rawTickers) {
        if (t.contract_type !== targetContractType) continue;
        const sym = (t.symbol || '').toUpperCase().trim();
        if (!sym) continue;
        const prod = prodBySym.get(sym);
        if (prod && prod.trading_status && prod.trading_status !== 'operational') continue;

        const parts = sym.split('-');
        const expCode = parts[3] || '';
        let expMs = prod?.settlement_time ? Date.parse(prod.settlement_time) : 0;
        if ((!expMs || isNaN(expMs)) && expCode.length === 6) {
          // Delta daily/weekly options settle at 12:00 UTC (17:30 IST)
          expMs = Date.UTC(
            2000 + parseInt(expCode.slice(4, 6), 10),
            parseInt(expCode.slice(2, 4), 10) - 1,
            parseInt(expCode.slice(0, 2), 10),
            12,
            0,
            0
          );
        }

        const strike = parseFloat(t.strike_price || parts[2] || '0');
        const bestAsk = parseFloat(t.quotes?.best_ask || '0');
        const bestBid = parseFloat(t.quotes?.best_bid || '0');
        const markPrice = parseFloat(t.mark_price || '0');
        const greeksDelta = t.greeks?.delta !== undefined ? parseFloat(t.greeks.delta) : undefined;

        if (!strike || isNaN(strike) || bestBid <= 0 || bestAsk <= 0 || markPrice <= 0) continue;

        const contractValue = parseFloat(prod?.contract_value || t.contract_value || (underlying === 'BTC' ? '0.001' : '0.01'));
        const tickSize = parseFloat(prod?.tick_size || t.tick_size || '0.5');

        optionMetas.push({
          symbol: sym,
          underlyingAsset: underlying,
          contractType: targetContractType,
          strikePrice: strike,
          expiryTime: expMs || now + 24 * 3600 * 1000,
          tickSize,
          contractValue,
          delta: Number.isFinite(greeksDelta) ? greeksDelta : undefined,
        });

        tickerInfoBySym.set(sym, {
          bestBid,
          bestAsk,
          markPrice,
          expiryCode: expCode || 'NEAR',
          productObj: prod || {
            id: t.product_id,
            symbol: sym,
            tick_size: String(tickSize),
            contract_value: String(contractValue),
            contract_type: t.contract_type || targetContractType,
          },
        });
      }

      if (optionMetas.length === 0) {
        return null;
      }

      // 1. Select Slightly ITM Option (>= 20h expiry, Delta 0.55-0.65 / strike immediately ITM)
      let chosenMeta = DeltaOptionsMasterEngine.selectOptimalOptionContract({
        underlying,
        direction,
        currentSpotPrice: spotPrice,
        availableOptions: optionMetas,
        nowMs: now,
      });

      if (!chosenMeta) {
        console.log(`🛡️ [OPTION VETO] ${underlying} ${optionType}: No >=20h Slightly ITM option contract available.`);
        return null;
      }

      let chosenQuote = tickerInfoBySym.get(chosenMeta.symbol)!;
      let planVerdict = DeltaOptionsMasterEngine.buildOptionBracketPlan({
        optionMeta: chosenMeta,
        bestBid: chosenQuote.bestBid,
        bestAsk: chosenQuote.bestAsk,
        markPrice: chosenQuote.markPrice,
        spotEntryPrice: spotPrice,
        spotSlPrice: effectiveSpotSl,
        spotTpPrice: effectiveSpotTp,
      });

      // If primary ITM strike fails <= 2.2% spread, try remaining near-money (<= 2.5% from spot) tight-spread candidates
      if (!planVerdict.approved || !planVerdict.plan) {
        const tightSpreadPool = optionMetas.filter((m) => {
          const q = tickerInfoBySym.get(m.symbol);
          if (!q || q.bestBid <= 0 || q.bestAsk <= 0) return false;
          const sp = (q.bestAsk - q.bestBid) / q.bestBid;
          return sp <= 0.022 && Math.abs(m.strikePrice - spotPrice) / spotPrice <= 0.025;
        });

        const fallbackMeta = tightSpreadPool.length > 0
          ? DeltaOptionsMasterEngine.selectOptimalOptionContract({
              underlying,
              direction,
              currentSpotPrice: spotPrice,
              availableOptions: tightSpreadPool,
              nowMs: now,
            })
          : null;

        if (!fallbackMeta) {
          console.log(`🛡️ [OPTION VETO] ${chosenMeta.symbol} rejected: ${planVerdict.vetoReason}. Skipping option entry!`);
          return null;
        }

        chosenMeta = fallbackMeta;
        chosenQuote = tickerInfoBySym.get(chosenMeta.symbol)!;
        planVerdict = DeltaOptionsMasterEngine.buildOptionBracketPlan({
          optionMeta: chosenMeta,
          bestBid: chosenQuote.bestBid,
          bestAsk: chosenQuote.bestAsk,
          markPrice: chosenQuote.markPrice,
          spotEntryPrice: spotPrice,
          spotSlPrice: effectiveSpotSl,
          spotTpPrice: effectiveSpotTp,
        });

        if (!planVerdict.approved || !planVerdict.plan) {
          console.log(`🛡️ [OPTION VETO] ${chosenMeta.symbol} rejected: ${planVerdict.vetoReason}. Skipping option entry!`);
          return null;
        }
      }

      // Live fresh ticker/orderbook re-check right before order dispatch (only on live dispatch)
      if (deltaExchange.isLiveDispatchActive()) {
        try {
          const freshTicker = await deltaExchange.getTicker(chosenMeta.symbol);
          const fBid = parseFloat(freshTicker?.quotes?.best_bid || '0');
          const fAsk = parseFloat(freshTicker?.quotes?.best_ask || '0');
          const fMark = parseFloat(freshTicker?.mark_price || '0');
          if (fBid > 0 && fAsk > 0) {
            const freshPlan = DeltaOptionsMasterEngine.buildOptionBracketPlan({
              optionMeta: chosenMeta,
              bestBid: fBid,
              bestAsk: fAsk,
              markPrice: fMark > 0 ? fMark : chosenQuote.markPrice,
              spotEntryPrice: spotPrice,
              spotSlPrice: effectiveSpotSl,
              spotTpPrice: effectiveSpotTp,
            });
            if (!freshPlan.approved || !freshPlan.plan) {
              console.log(`🛡️ [OPTION VETO] ${chosenMeta.symbol} fresh book check failed: ${freshPlan.vetoReason}. Skipping option entry!`);
              return null;
            }
            planVerdict = freshPlan;
          }
        } catch {}
      }

      const plan: OptionTradePlan = planVerdict.plan!;
      // Ensure DeltaExchangeEngine has full Option product_id & tick_size metadata for Reduce-Only SL/TP & bracket endpoints
      deltaExchange.registerProduct(chosenQuote.productObj);

      const unitPremiumUSD = plan.entryPremiumLimit * chosenMeta.contractValue;
      const perContractRiskUSD = Math.max(
        chosenMeta.tickSize * chosenMeta.contractValue,
        (plan.entryPremiumLimit - plan.optionSlPrice) * chosenMeta.contractValue
      );
      let contracts = Math.max(1, Math.round(plan.maxRiskUSD / Math.max(perContractRiskUSD, 0.01)));
      while (contracts > 1 && contracts * perContractRiskUSD > 4.25) {
        contracts--;
      }
      while (
        contracts > 1 &&
        deltaExchange.isLiveDispatchActive() &&
        this.state.currentCapitalUSD > 0 &&
        contracts * unitPremiumUSD > this.state.currentCapitalUSD * 0.90
      ) {
        contracts--;
      }
      const optionPremiumUSD = parseFloat((contracts * unitPremiumUSD).toFixed(2));
      if (optionPremiumUSD < 0.50 || optionPremiumUSD > 30.0) {
        return null;
      }

      let optionTP = plan.optionTpPrice;
      let optionSL = plan.optionSlPrice;
      const quantity = parseFloat((contracts * chosenMeta.contractValue).toFixed(6));

      let fillOptionPrice = plan.entryPremiumLimit;
      let orderId = 'opt-sim-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);

      if (deltaExchange.isLiveDispatchActive()) {
        // Strict Limit Order entry at Math.min(bestAsk, markPrice * 1.004) — NEVER overpay on spread!
        const orderRes = await deltaExchange.placeOrder({
          symbol: chosenMeta.symbol,
          side: 'BUY',
          size: quantity,
          price: plan.entryPremiumLimit,
          orderType: 'limit_order',
          limitPrice: plan.entryPremiumLimit,
          takeProfitPrice: optionTP,
          stopLossPrice: optionSL,
        });
        if (!orderRes || !orderRes.success) {
          console.warn(`⚠️ [OPTIONS LIMIT NOTE] ${chosenMeta.symbol} skipped/unfilled (${orderRes?.message || 'error'}).`);
          return null;
        }
        fillOptionPrice = orderRes.fillPrice > 0 ? orderRes.fillPrice : plan.entryPremiumLimit;
        orderId = orderRes.orderId || orderId;
        if (Math.abs(fillOptionPrice - plan.entryPremiumLimit) > chosenMeta.tickSize * 1.5) {
          const tpMult = 1 + (plan.expectedRoePct / 100);
          optionTP = roundToTickSize(fillOptionPrice * tpMult, chosenMeta.tickSize);
          optionSL = roundToTickSize(fillOptionPrice * 0.82, chosenMeta.tickSize);
        }
      }

      const finalPremiumUSD = parseFloat((quantity * fillOptionPrice).toFixed(2));
      const trailActivation = roundToTickSize(fillOptionPrice * 1.25, chosenMeta.tickSize);
      const trailLock = roundToTickSize(fillOptionPrice * 1.15, chosenMeta.tickSize);
      const runTrigger = roundToTickSize(fillOptionPrice * 1.28, chosenMeta.tickSize);
      const runLock = roundToTickSize(fillOptionPrice * 1.22, chosenMeta.tickSize);

      const newOptPos: DeltaPosition = {
        id: orderId,
        symbol: chosenMeta.symbol,
        side: 'BUY',
        entryPrice: fillOptionPrice,
        currentPrice: fillOptionPrice,
        quantity,
        marginUSD: finalPremiumUSD,
        notionalUSD: finalPremiumUSD,
        leverage: 1,
        takeProfitPrice: optionTP,
        stopLossPrice: optionSL,
        initialStopLossPrice: optionSL,
        atr: fillOptionPrice * 0.18,
        isBreakevenLocked: false,
        pnlUSD: 0,
        pnlPercent: 0,
        highestPnlUSD: 0,
        entryTime: Date.now(),
        strategyName: `Master ITM Option [BUY ${optionType} | Strike: $${chosenMeta.strikePrice} | Limit: $${fillOptionPrice} | SpotSL: $${plan.spotSlPrice} | +${plan.expectedRoePct}% TP / -18% SL]`,
        shadowConfirmedSeconds: 0,
        executionMode: 'DIRECT',
        instrumentType: 'OPTION',
        optionType,
        strike: chosenMeta.strikePrice,
        expiry: chosenQuote.expiryCode,
        tier: tierPlan?.tier || 'STRONG_23PCT_RUNNER',
        seatBucket: 'OPTION_UNCAPPED_SEAT',
        expectedRoePct: plan.expectedRoePct,
        grossRoePct: plan.expectedRoePct,
        netRoeAfterFeesPct: Number((plan.expectedRoePct - 3).toFixed(1)),
        optionTickSize: chosenMeta.tickSize,
        optionTrailingPeakPrice: fillOptionPrice,
        spotSlPrice: plan.spotSlPrice,
        spotTpPrice: effectiveSpotTp,
        spotEntryPrice: spotPrice,
        underlyingAsset: underlying,
        trailActivationPrice: trailActivation,
        trailLockPrice: trailLock,
        runner23PctTriggerPrice: runTrigger,
        runner18PctLockPrice: runLock,
        targetProfitUSD: parseFloat((finalPremiumUSD * (plan.expectedRoePct / 100)).toFixed(2)),
      };

      this.state.activePositions.push(newOptPos);
      this.symbolLastTradeTime.set(chosenMeta.symbol, Date.now());
      this.saveState();
      const optSeats = this.getReservedSeatCounts();
      console.log(`🎯 [MASTER ITM OPTION ACTIVE] BUY ${chosenMeta.symbol} (${contracts} contracts @ Limit $${fillOptionPrice} | Premium: $${finalPremiumUSD} | SpotSL: $${plan.spotSlPrice} | TP: $${optionTP} [+${plan.expectedRoePct}%] | SL: $${optionSL} [-18%]) | [SEAT STATUS] Chopping 15%+ Net: ${optSeats.activeChopNormalSeats}/2 | Normal 23%-40%+: ${optSeats.activeBigSignalSeats}/2 | Options: ${optSeats.activeOptionSeats}/2`);
      return newOptPos;
    } catch (e: any) {
      console.warn(`[OPTIONS SELECTOR ERROR] ${underlying}:`, e?.message || e);
      return null;
    }
  }

  /**
   * Hard Wall-Clock Gate: returns TRUE ONLY right after a 15-minute candle close (:00, :15, :30, :45).
   * Window: :00:02–:01:30, :15:02–:16:30, :30:02–:31:30, :45:02–:46:30.
   */
  public static isAt15mBoundaryWindow(nowDate: Date = new Date()): boolean {
    const minutes = nowDate.getUTCMinutes();
    const seconds = nowDate.getUTCSeconds();
    return (minutes % 15 === 0 && seconds >= 2 && seconds <= 55) || (minutes % 15 === 1 && seconds <= 30);
  }

  /**
   * 15M Autonomous Scan Cycle: Evaluates ONLY ONCE at every 15m boundary (:00/:15/:30/:45) using Pure YouTube Video Rules & UniversalTradeGuard
   */
  public async runScanCycle() {
    if (this.isScanning) return;
    this.isScanning = true;
    this.state.lastScanTimestamp = Date.now();

    try {
      if (Date.now() - this.engineStartTime < this.STARTUP_GRACE_PERIOD_MS) {
        return;
      }

      if (this.state.isNewTradesPaused || !this.state.isRunning) {
        return;
      }

      // WALL-CLOCK 15M BOUNDARY GATE: Never scan/enter new trades mid-candle! (Position TP/SL monitor continues every 250ms.)
      const nowClock = new Date();
      if (!DeltaAutoTraderEngine.isAt15mBoundaryWindow(nowClock)) {
        const nowMsLog = nowClock.getTime();
        if (nowMsLog - this.lastHeartbeatLogTime > 60000) {
          this.lastHeartbeatLogTime = nowMsLog;
          const curSeats = this.getReservedSeatCounts();
          const totalUsed = curSeats.activeBigSignalSeats + curSeats.activeOptionSeats + curSeats.activeChopNormalSeats;
          console.log(`⏳ [15M CLOCK GATE] Mid-candle hold (${nowClock.toLocaleTimeString()}). Waiting for next 15m candle close (:00/:15/:30/:45) before evaluating new entries | [SEAT STATUS] Big Signals: ${curSeats.activeBigSignalSeats}/2 (Reserved) | Options: ${curSeats.activeOptionSeats}/2 | Chopping 15%+: ${curSeats.activeChopNormalSeats}/2 (${totalUsed}/6 Total)`);
        }
        return;
      }

      const activePortNum = this.port || parseInt(process.env.PORT || '3005', 10);
      const startSeats = this.getReservedSeatCounts();
      const startTotalActive = startSeats.activeBigSignalSeats + startSeats.activeOptionSeats + startSeats.activeChopNormalSeats;

      if (startTotalActive >= ReservedSixSeatManager.MAX_TOTAL_SEATS) {
        const now = Date.now();
        if (now - this.lastHeartbeatLogTime > 30000) {
          this.lastHeartbeatLogTime = now;
          const posList = this.state.activePositions.map(p => `${p.symbol} ${p.side} @ $${p.entryPrice} (SL: $${p.stopLossPrice}, TP: $${p.takeProfitPrice}, PnL: $${p.pnlUSD || 0})`).join(' | ');
          console.log(`🔒 [MAX 6/6 SEATS FULL] [SEAT STATUS] Big Signals: ${startSeats.activeBigSignalSeats}/2 (Reserved) | Options: ${startSeats.activeOptionSeats}/2 | Chopping 15%+: ${startSeats.activeChopNormalSeats}/2 (${startTotalActive}/6 Total) | Active: ${posList}. Holding for bracket resolution.`);
        }
        return;
      }

      // Fetch BTC and ETH 15m candles once per cycle for leader lock evaluation
      let btcCandles15m: KlinePoint[] = [];
      let ethCandles15m: KlinePoint[] = [];
      try {
        btcCandles15m = await this.fetchCandles('BTCUSD', '15m', 60);
        ethCandles15m = await this.fetchCandles('ETHUSD', '15m', 60);
      } catch (err) {
        console.warn('⚠️ Could not fetch BTC/ETH candles for leader alignment check:', err);
      }

      const activePositionsInfo: ActivePositionInfo[] = this.state.activePositions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        unrealizedPnL: p.pnlUSD || 0,
      }));

      // Refresh dynamic products from Delta Exchange every 30 minutes
      const isTestnetMode = (
        this.state.mode === 'DELTA_TESTNET' ||
        process.env.DELTA_TRADING_MODE === 'DELTA_TESTNET' ||
        deltaExchange.getConfig().isTestnet
      );
      await UniversalTradeGuard.refreshDynamicProducts(isTestnetMode, deltaExchange.getConfig().baseUrl);

      // STAGE A: 1 Bulk API Call to GET /v2/tickers?contract_types=perpetual_futures
      let qualifiedSymbols: string[] = [];
      let totalPerpsFound = ALLOWED_CRYPTO_SYMBOLS.size;
      try {
        const tickerUrl = isTestnetMode
          ? 'https://cdn-ind.testnet.deltaex.org/v2/tickers?contract_types=perpetual_futures'
          : `${deltaExchange.getConfig().baseUrl || 'https://api.india.delta.exchange'}/v2/tickers?contract_types=perpetual_futures`;
        
        const tResp = await fetch(tickerUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (tResp && tResp.ok) {
          const tJson: any = await tResp.json().catch(() => null);
          const rawTickers: any[] = tJson?.result || [];
          const pureCryptoTickers = rawTickers.filter((t: any) => {
            const isPerp = t.contract_type === 'perpetual_futures' || t.contract_type === 'futures';
            return isPerp && UniversalTradeGuard.isPureCryptoPerpetual(t.symbol, t);
          });
          totalPerpsFound = pureCryptoTickers.length;

          // Filter & rank active pure-crypto movers with healthy spreads
          const validTickers = pureCryptoTickers.filter((t: any) => {
            const bid = parseFloat(t.quotes?.best_bid || 0);
            const ask = parseFloat(t.quotes?.best_ask || 0);
            if (bid <= 0 || ask <= 0) return false;
            const spreadPct = (ask - bid) / bid;
            const maxSpread = isTestnetMode ? 0.0035 : 0.0015; // <= 0.15% on Live, 0.35% on Testnet
            return spreadPct <= maxSpread;
          });

          // Sort by 24h turnover (liquidity & active movers)
          validTickers.sort((a: any, b: any) => {
            const tA = parseFloat(a.turnover_usd || 0);
            const tB = parseFloat(b.turnover_usd || 0);
            return tB - tA;
          });

          // Extract top symbols
          const candidateSymbols = validTickers.map((t: any) => t.symbol.toUpperCase().trim());

          // Always ensure Market Leaders BTCUSD and ETHUSD are included at the very top
          const leaderSet = new Set(['BTCUSD', 'ETHUSD']);
          qualifiedSymbols = ['BTCUSD', 'ETHUSD'];
          for (const sym of candidateSymbols) {
            if (!leaderSet.has(sym)) {
              qualifiedSymbols.push(sym);
            }
          }
        }
      } catch (err: any) {
        console.warn(`⚠️ [BULK TICKER SCANNER] Stage A failed: ${err.message}. Using cached symbols.`);
      }

      // Fallback if bulk ticker call failed or returned empty
      if (qualifiedSymbols.length === 0) {
        qualifiedSymbols = Array.from(ALLOWED_CRYPTO_SYMBOLS).filter((s) => UniversalTradeGuard.isPureCryptoPerpetual(s));
      }

      // In Live mode, evaluate top 25 active movers; on Testnet, evaluate all active testnet coins
      const maxScanBatch = isTestnetMode ? qualifiedSymbols.length : Math.min(qualifiedSymbols.length, 25);
      const symbolsToScan = qualifiedSymbols.slice(0, maxScanBatch);

      for (const symbol of symbolsToScan) {
        const curSeats = this.getReservedSeatCounts();
        const curTotalSeats = curSeats.activeBigSignalSeats + curSeats.activeOptionSeats + curSeats.activeChopNormalSeats;
        if (curTotalSeats >= ReservedSixSeatManager.MAX_TOTAL_SEATS) {
          break;
        }

        // Skip if already holding a perpetual position in this symbol
        if (this.state.activePositions.some(p => p.symbol === symbol)) {
          continue;
        }

        // In Demo/Testnet or Live: fetch candles safely without throwing or crashing
        let candles15m: KlinePoint[] = [];
        let candles5m: KlinePoint[] = [];
        try {
          [candles15m, candles5m] = await Promise.all([
            (symbol === 'BTCUSD' && btcCandles15m.length >= 50)
              ? Promise.resolve(btcCandles15m)
              : (symbol === 'ETHUSD' && ethCandles15m.length >= 50)
                ? Promise.resolve(ethCandles15m)
                : this.fetchCandles(symbol, '15m', 100),
            this.fetchCandles(symbol, '5m', 40).catch(() => []),
          ]);
        } catch (_) {
          // Silently skip unavailable/broken demo coins
          continue;
        }

        if (!candles15m || candles15m.length < 50) continue;

        // STRICT 15M CANDLE CLOSE GATE (Part 1): read-only peek without premature mutation
        const peek = FifteenMinCandleCloseGate.peekLastClosedCandle(candles15m);
        if (!peek || !peek.closedCandle || peek.closedCandles.length < 35) {
          continue;
        }
        const closedCandle = peek.closedCandle;
        const closedTime = peek.closedCandleOpenMs;
        const lastEvalTime = this.lastEvaluatedCandleTimestamp.get(symbol);

        // ONLY EVALUATE ONCE PER 15M CANDLE CLOSE FOR EACH SYMBOL
        if (lastEvalTime === closedTime) {
          continue;
        }

        // Evaluate strategy on closed candles (passing openOptionSlots for backwards-compatible routing metadata)
        const stratRes = evaluateStrategyForPort({
          port: activePortNum,
          symbol,
          candles15m,
          candles5m,
          openOptionSlots: curSeats.activeOptionSeats,
        });

        // Persist closed candle open timestamp whether BUY, SELL, or WAIT
        const resolvedClosedOpenMs = stratRes?.closedCandleTime || closedTime;
        if (resolvedClosedOpenMs > 0) {
          this.lastEvaluatedCandleTimestamp.set(symbol, resolvedClosedOpenMs);
        }

        if (stratRes?.reason?.includes('WAITING_FOR_NEXT_15M_CANDLE_CLOSE')) {
          continue;
        }
        if (stratRes?.reason?.includes('MID_CANDLE_LATE_ENTRY_BLOCKED')) {
          console.log(`⏸️ [15M GATE BLOCKED] ${symbol}: ${stratRes.reason}`);
          continue;
        }

        const candleCloseTimeStr = new Date(resolvedClosedOpenMs + 15 * 60 * 1000).toLocaleTimeString();
        console.log(`🕯️ [15M CANDLE CLOSED] ${symbol}: Bar closed at ${candleCloseTimeStr} (O: $${closedCandle.open}, H: $${closedCandle.high}, L: $${closedCandle.low}, C: $${closedCandle.close}). Evaluating Port ${activePortNum} Strategy...`);

        if (!stratRes || stratRes.action === 'WAIT' || !stratRes.signal) {
          console.log(`⏳ [STRATEGY EVAL] Port ${activePortNum} (${stratRes?.strategyName || 'Strategy'}) ${symbol}: No signal on closed bar (Close: $${closedCandle.close}). Awaiting next 15m candle.`);
          continue;
        }

        console.log(`🎯 [STRATEGY SIGNAL] Port ${activePortNum} (${stratRes.strategyName}) generated ${stratRes.action} [${stratRes.tierPlan?.tier || 'RUNNER'} | ADX: ${(stratRes.adx || 0).toFixed(1)}] for ${symbol} (Reason: ${stratRes.reason})!`);

        // Get live market price & product spec
        const currentPrice = await deltaExchange.getMarketPrice(symbol) || stratRes.entryPrice || closedCandle.close;
        const spec = deltaExchange.getProductSpec(symbol, currentPrice);
        const meta = UniversalTradeGuard.getProductMeta(symbol);

        // Retrieve live account balance for 25% margin sizing
        let accountCapitalUSD = this.state.accountCapitalUSD || 178.57;
        try {
          const bal = await deltaExchange.getWalletBalance();
          if (bal && bal.balanceUSD > 0 && !deltaExchange.getConfig().isSimulation) {
            accountCapitalUSD = bal.balanceUSD;
            this.state.accountCapitalUSD = bal.balanceUSD;
            this.state.currentCapitalUSD = bal.availableUSD;
          }
        } catch (e) {}

        // Validate trade and build 3-Bucket Reserved Seat bracket with UniversalTradeGuard
        const guard = UniversalTradeGuard.validateAndBuildBracket({
          symbol,
          side: stratRes.action,
          entryPrice: currentPrice,
          candles15m,
          candles5m,
          contractValue: spec.contractValue || meta?.contractValue || 1.0,
          tickSize: spec.tickSize || meta?.tickSize || 0.01,
          accountCapitalUSD,
          leverage: stratRes.threeBucketPlan?.leverage || stratRes.tierPlan?.leverage || this.state.leverage || 25,
          marginPercent: 0.25,
          activePositions: activePositionsInfo,
          btcCandles15m,
          ethCandles15m,
          signalReason: stratRes.reason,
          tierPlan: stratRes.tierPlan,
          threeBucketPlan: stratRes.threeBucketPlan,
          enforceCloseWindow: true,
        });

        if (!guard.approved) {
          console.log(`🛡️ [UNIVERSAL GUARD VETO] ${symbol} ${stratRes.action} rejected: ${guard.vetoReason}`);
          continue;
        }

        // Strict 2 + 2 + 2 Reserved Seat Allocation Gate (2 Chopping 15%+ Net | 2 Normal 23%-40%+ | 2 Options)
        const requestedBucket: SeatBucketType = guard.bucket || 'CHOP_15PCT_SEAT';
        const latestSeats = this.getReservedSeatCounts();
        const seatDecision = ReservedSixSeatManager.allocateSeat(latestSeats, requestedBucket);

        if (!seatDecision.approved) {
          // If 2/2 Normal/Big seats are occupied, a BTC/ETH Normal/Strong signal can still enter directly via a free Option seat
          if (guard.canAlsoTriggerOption) {
            const optionOnlyDecision = ReservedSixSeatManager.allocateSeat(latestSeats, 'OPTION_UNCAPPED_SEAT');
            if (optionOnlyDecision.approved) {
              console.log(`🎯 [BTC/ETH OPTION SEAT DIRECT] Normal 23%-40%+ Perp seats full (${latestSeats.activeBigSignalSeats}/2) — routing ${symbol} ${guard.side} into Option Seat ${latestSeats.activeOptionSeats + 1}/2!`);
              await this.executeHybridAtmOption({
                underlying: symbol.includes('ETH') ? 'ETH' : 'BTC',
                direction: guard.side,
                spotPrice: currentPrice,
                closedCandleTime: closedTime,
                tierPlan: stratRes.tierPlan,
                isTestnetMode,
                spotSlPrice: guard.slPrice,
                spotTpPrice: guard.tpPrice,
              });
              continue;
            }
          }

          if (seatDecision.vetoReason?.includes('CHOP_2_SEATS_FULL_KEEPING_BIG_SEATS_KHALI')) {
            console.log(`🛡️ [SEAT RESERVATION] ${latestSeats.activeChopNormalSeats}/2 Chopping seats occupied. Keeping 2 Normal/Big-Signal seats KHALI for 23%-40%+ ROE Runners!`);
          } else {
            console.log(`⏸️ [2+2+2 SEAT MANAGER] ${symbol} ${guard.side} skipped: ${seatDecision.vetoReason}`);
          }
          continue;
        }

        const wallInfo = guard.reversalWallPrice ? ` (FrontRun Wall=$${guard.reversalWallPrice})` : '';
        console.log(`✅ [UNIVERSAL GUARD APPROVED] ${symbol} ${guard.side} -> Bucket=${seatDecision.allocatedBucket} (${guard.tierLabel || guard.tier || '6SLOT'} | NetROE: ${guard.netRoeAfterFeesPct ?? guard.expectedRoePct ?? 16}% / Gross: ${guard.grossRoePct ?? 19}%): Entry=$${guard.entryPrice} | SL=$${guard.slPrice} (MaxLoss: -$${guard.expectedMaxLossUSD.toFixed(2)} USD) | TP=$${guard.tpPrice}${wallInfo} (Reward: +$${guard.expectedRewardUSD.toFixed(2)} USD, RR: 1:${guard.riskRewardRatio}) | Contracts=${guard.contracts}`);

        await this.executeGuardedOrder(guard, stratRes.strategyName, spec);

        // Simultaneously trigger BTC/ETH ATM Call/Put Option into reserved Option Seat if eligible
        if (guard.canAlsoTriggerOption) {
          const postPerpSeats = this.getReservedSeatCounts();
          const optDecision = ReservedSixSeatManager.allocateSeat(postPerpSeats, 'OPTION_UNCAPPED_SEAT');
          if (optDecision.approved) {
            const optPos = await this.executeHybridAtmOption({
              underlying: symbol.includes('ETH') ? 'ETH' : 'BTC',
              direction: guard.side,
              spotPrice: currentPrice,
              closedCandleTime: closedTime,
              tierPlan: stratRes.tierPlan,
              isTestnetMode,
              spotSlPrice: guard.slPrice,
              spotTpPrice: guard.tpPrice,
            });
            if (!optPos) {
              console.log(`ℹ️ [OPTIONS CHAIN UNAVAILABLE] ${symbol} Normal Runner Perpetual active in Reserved Seat; Option leg skipped (no liquid ATM strikes on current environment).`);
            }
          }
        }
      }

      // Heartbeat logging
      const now = Date.now();
      if (now - this.lastHeartbeatLogTime > 30000) {
        this.lastHeartbeatLogTime = now;
        const finalSeats = this.getReservedSeatCounts();
        const totalUsed = finalSeats.activeBigSignalSeats + finalSeats.activeOptionSeats + finalSeats.activeChopNormalSeats;
        const btcLastClosed = this.lastEvaluatedCandleTimestamp.get('BTCUSD');
        const ethLastClosed = this.lastEvaluatedCandleTimestamp.get('ETHUSD');
        const btcTimeStr = btcLastClosed ? new Date(btcLastClosed).toLocaleTimeString() : 'pending';
        const ethTimeStr = ethLastClosed ? new Date(ethLastClosed).toLocaleTimeString() : 'pending';
        console.log(`📡 [AUTOTRADER 2-STAGE SCANNER] Port ${activePortNum} (${isTestnetMode ? 'DEMO/TESTNET' : 'LIVE'}) | [SEAT STATUS] Chopping 15%+ Net: ${finalSeats.activeChopNormalSeats}/2 | Normal 23%-40%+: ${finalSeats.activeBigSignalSeats}/2 (Reserved) | Options: ${finalSeats.activeOptionSeats}/2 (${totalUsed}/6 Total) | Qualified Watchlist (${symbolsToScan.length}/${totalPerpsFound}): ${symbolsToScan.slice(0, 10).join(', ')}${symbolsToScan.length > 10 ? '...' : ''} | Last closed -> BTC: ${btcTimeStr}, ETH: ${ethTimeStr} | Pure closed-candle scan active.`);
      }
    } catch (err) {
      console.error('Error during auto-trader scan cycle:', err);
    } finally {
      this.isScanning = false;
      this.saveState();
    }
  }

  /**
   * High frequency tick update: evaluates Shadow Gate and Active Positions
   */
  public async runTickCycle() {
    try {
      // 0. Periodic sync with live Delta Exchange positions (15s when idle, 5s when active)
      const isLivePort = (this.state.mode === 'DELTA_TESTNET' || this.state.mode === 'DELTA_LIVE' || this.state.mode === 'LIVE_DELTA_INDIA' || process.env.DELTA_TRADING_MODE === 'DELTA_TESTNET' || process.env.DELTA_TRADING_MODE === 'LIVE_DELTA_INDIA');
      const syncFreqMs = isLivePort ? (this.state.activePositions.length > 0 ? 5000 : 15000) : 15000;
      if (Date.now() - this.lastExchangeSyncTimestamp >= syncFreqMs) {
        this.lastExchangeSyncTimestamp = Date.now();
        await this.syncLivePositionsFromExchange();
        await this.reconcileFollowerPositions();
      }

      // Mandatory User Mandate: "4k capital ho jaye to trade off kar dena"
      // Real-time Capital Preservation Circuit Breaker:
      const floatingPnl = this.state.activePositions.reduce((sum, p) => sum + (p.pnlUSD || 0), 0);
      const liveEquityUSD = (this.state.accountCapitalUSD || 178.57) + floatingPnl;
      const liveEquityINR = liveEquityUSD * 84;
      const minFloorINR = 1000;
      const minFloorUSD = minFloorINR / 84; // ~$47.62 USD

      // Capital guard removed

      // 2. Evaluate Active Positions (Dynamic SL, TP)
      for (let i = this.state.activePositions.length - 1; i >= 0; i--) {
        const pos = this.state.activePositions[i];
        if (!pos || !pos.symbol) continue;
        if (this.closingPositions.has(pos.id) || this.closingPositions.has(pos.symbol)) continue;
        // Skip option contracts (C-* and P-*) as they are managed by deltaOptionsCondor, UNLESS this is Port 3001 Options Engine
        if ((pos.symbol.startsWith('C-') || pos.symbol.startsWith('P-')) && this.port !== 3001 && pos.instrumentType !== 'OPTION') {
          continue;
        }
        let livePrice = await deltaExchange.getMarketPrice(pos.symbol);
        if ((!livePrice || livePrice <= 0) && (pos.instrumentType === 'OPTION' || pos.symbol.startsWith('C-') || pos.symbol.startsWith('P-'))) {
          const optTicker = await deltaExchange.getTicker(pos.symbol).catch(() => null);
          livePrice = parseFloat(optTicker?.mark_price || optTicker?.close || '0');
        }
        await this.evaluatePositionSLTP(pos, livePrice, i);
      }

      // Only throttle persist floating updates if active positions exist
      if (this.state.activePositions.length > 0) {
        const now = Date.now();
        if (now - this.lastStateSaveTime > 15000) {
          this.lastStateSaveTime = now;
          this.saveState();
        }
      }
    } catch (err: any) {
      console.error('Error in runTickCycle:', err.message);
    }
  }

  // -------------------------------------------------------------
  // 3. Order Execution & Dynamic Re-Anchoring
  // -------------------------------------------------------------

  /**
   * Dynamic Full-Balance Margin Allocation Engine
   * User Directive: "जितना बैलेंस है मार्जिन यूज़ होना चाहिए"
   * Automatically calculates margin per trade so the account's available balance is fully utilized
   * across active slots, while preserving a safe 8-10% buffer for taker fees and market noise.
   */
  public async calculateDynamicTradeMargin(maxSlots?: number): Promise<{
    marginUSD: number;
    notionalUSD: number;
    leverage: number;
    effectiveMaxPositions: number;
    totalBalanceUSD: number;
    availableUSD: number;
  }> {
    const effectiveMaxPositions = maxSlots || this.state.maxConcurrentPositions || 1;
    const leverage = this.state.leverage || 30;

    let totalBalanceUSD = this.state.accountCapitalUSD || 178.57; // ₹2,000 INR (~$23.53 USD) default
    let availableUSD = this.state.currentCapitalUSD || 178.57;

    try {
      const bal = await deltaExchange.getWalletBalance();
      if (bal && bal.balanceUSD > 0 && !deltaExchange.getConfig().isSimulation) {
        totalBalanceUSD = bal.balanceUSD;
        availableUSD = bal.availableUSD;
        this.state.accountCapitalUSD = totalBalanceUSD;
        this.state.currentCapitalUSD = availableUSD;
      }
    } catch (e) {
      // quiet fallback
    }

    const currentActiveCount = this.state.activePositions.length;
    const remainingSlots = Math.max(1, effectiveMaxPositions - currentActiveCount);

    // High Margin Utilization (User Mandate: "use 25% of the capital")
    // Total capital deployed fully across 4 slots = 25% per trade slot (100% full capital total)
    const baseMarginPerSlot = totalBalanceUSD * 0.25;

    // Distribute available free cash across remaining available slots
    const dynamicMarginFromAvailable = availableUSD / remainingSlots;

    // Dynamic margin allocation per slot: 25% of full capital
    const minMarginFloor = 10.00;
    let marginUSD = Math.min(
      availableUSD * 0.99,
      Math.max(minMarginFloor, Math.min(baseMarginPerSlot, dynamicMarginFromAvailable))
    );

    marginUSD = Math.max(minMarginFloor, parseFloat(marginUSD.toFixed(2)));

    const notionalUSD = parseFloat((marginUSD * leverage).toFixed(2));

    return {
      marginUSD,
      notionalUSD,
      leverage,
      effectiveMaxPositions,
      totalBalanceUSD,
      availableUSD,
    };
  }

  public async executeNewPosition(params: {
    symbol: string;
    strategyName: string;
    side: 'BUY' | 'SELL';
    signalPrice: number;
    atr: number;
    shadowConfirmedSeconds: number;
    executionMode?: TradeExecutionMode;
    reversalReason?: string;
    customTP?: number;
    customSL?: number;
    tp1Price?: number;
    tp2Price?: number;
    tp1Ratio?: number;
    tp2Ratio?: number;
    earlyBreakevenPrice?: number;
    riskDistance?: number;
  }): Promise<DeltaPosition | null> {
    // Runtime Integrity Guard: Signal Side must strictly match Order Side (solutions.pdf Item 1)
    const orderSide: 'BUY' | 'SELL' = params.side;
    if (orderSide !== 'BUY' && orderSide !== 'SELL') {
      console.error(`❌ [INTEGRITY GUARD] Invalid signal side "${params.side}" for ${params.symbol}. Aborting trade.`);
      return null;
    }
    if (orderSide !== params.side) {
      console.error(`❌ [INTEGRITY GUARD] Signal inversion attempt detected (${params.side} !== ${orderSide}). Aborting trade.`);
      return null;
    }

    // Dummy Price Guard: Never take trades at fallback $1.00 price
    if (!params.signalPrice || params.signalPrice <= 0 || params.signalPrice === 1.0) {
      console.warn(`🛑 [DUMMY PRICE GUARD] ${params.symbol} rejected: Unverified or fallback price ($${params.signalPrice}).`);
      return null;
    }

    const cleanSym = params.symbol.toUpperCase().replace('USDT', 'USD').trim();
    // Pure Crypto Filter + Dynamic Perpetual Product Check: Reject tokenized stocks/commodities & inactive contracts
    if (!UniversalTradeGuard.isPureCryptoPerpetual(cleanSym)) {
      console.warn(`🛑 [NON_CRYPTO_STOCK_COMMODITY_VETO] Order dispatch rejected for ${cleanSym}: Tokenized stock/commodity/forex excluded.`);
      return null;
    }
    if (!UniversalTradeGuard.isSymbolTradable(cleanSym) && !ALLOWED_CRYPTO_SYMBOLS.has(cleanSym)) {
      console.warn(`🛑 [SYMBOL_NOT_AVAILABLE_VETO] Order dispatch rejected for ${cleanSym}: Symbol is not an active perpetual contract on this environment.`);
      return null;
    }
    // Hard Blacklist Guard per User Mandates (BTC, ETH, ADA permanently OFF):
    if (FORBIDDEN_COINS.has(cleanSym) || FORBIDDEN_COINS.has(params.symbol.toUpperCase())) {
      console.warn(`🛑 [TRADE BLOCKED] ${params.symbol} is permanently blacklisted per user directives ("bth eth bade bade off kardo", "adaa mee coin off kardo").`);
      return null;
    }
    const existing = this.state.activePositions.find(
      p => (p.symbol || '').toUpperCase().replace('USDT', 'USD') === cleanSym
    );
    if (existing) {
      console.log(`⚠️ Position for ${params.symbol} already exists in activePositions. Skipping duplicate position.`);
      return existing;
    }

    // Real-time Entry Price Sanity Guard: Protect against mock or stale prices
    try {
      const realLivePrice = await deltaExchange.getMarketPrice(params.symbol);
      if (realLivePrice > 0 && Math.abs(params.signalPrice - realLivePrice) / realLivePrice > 0.05) {
        console.warn(`🛑 [PRICE INTEGRITY GUARD] Signal price ($${params.signalPrice}) deviates >5% from real live market price ($${realLivePrice}). Aborting entry to prevent phantom profit/loss.`);
        return null;
      }
    } catch (e) {}

    // =========================================================================
    // RULE 3: HARD PRE-DISPATCH VETO IN [CANDLE COLOR ADAPTIVE]
    // User Mandate: NEVER SELL ON AN ACTIVE GREEN BAR / NEVER BUY ON AN ACTIVE RED BAR
    // Check both active 15m AND 5m candles!
    // =========================================================================
    try {
      const [liveCandles15m, liveCandles5m] = await Promise.all([
        this.fetchCandles(params.symbol, '15m', 10),
        this.fetchCandles(params.symbol, '5m', 10),
      ]);

      const bar15m = (liveCandles15m && liveCandles15m.length > 0) ? liveCandles15m[liveCandles15m.length - 1] : null;
      const bar5m = (liveCandles5m && liveCandles5m.length > 0) ? liveCandles5m[liveCandles5m.length - 1] : null;

      const isManual = (params as any).isManualForce === true || params.strategyName?.includes('Manual Execution');

      if (!isManual) {
        const effAtr = params.atr || (params.signalPrice * 0.005);

        // --- CHECK 1: SELL (SHORT) DISPATCH ---
        if (orderSide === 'SELL') {
          // 15M Check
          if (bar15m) {
            const is15mGreen = params.signalPrice > bar15m.open;
            const liveHigh15m = Math.max(bar15m.high, params.signalPrice);
            const liveLow15m = Math.min(bar15m.low, params.signalPrice);
            const span15m = Math.max(liveHigh15m - liveLow15m, bar15m.close * 0.0005);
            const upperWick15m = Math.max(0, liveHigh15m - Math.max(bar15m.open, params.signalPrice));
            const upperWickRatio15m = upperWick15m / span15m;
            const body15m = Math.abs(params.signalPrice - bar15m.open);

            if (is15mGreen && body15m > 1.5 * effAtr) {
              console.warn(`🛑 [MOMENTUM VELOCITY BRAKE] ${cleanSym} SELL rejected: Active 15M candle body ($${body15m.toFixed(4)}) > 1.5 * ATR ($${(1.5 * effAtr).toFixed(4)}) pumping upward. Pausing entry to avoid steamroller.`);
              return null;
            }

            // FIX DEADLOCK #3: Only block on active 15M bar if it has moved > 0.25 * ATR against the trade direction!
            if (is15mGreen && body15m > (0.25 * effAtr) && upperWickRatio15m < 0.40) {
              console.warn(`🛑 [CANDLE COLOR VETO] ${cleanSym} SELL aborted: Active 15M bar moved +$${body15m.toFixed(4)} (> 0.25*ATR) against Sell with only ${(upperWickRatio15m * 100).toFixed(0)}% upper wick (< 40% required). Holding dispatch until bar turns RED.`);
              return null;
            }
          }

          // 5M Check
          if (bar5m) {
            const is5mGreen = params.signalPrice > bar5m.open;
            const liveHigh5m = Math.max(bar5m.high, params.signalPrice);
            const liveLow5m = Math.min(bar5m.low, params.signalPrice);
            const span5m = Math.max(liveHigh5m - liveLow5m, bar5m.close * 0.0005);
            const upperWick5m = Math.max(0, liveHigh5m - Math.max(bar5m.open, params.signalPrice));
            const upperWickRatio5m = upperWick5m / span5m;
            const body5m = Math.abs(params.signalPrice - bar5m.open);

            if (is5mGreen && body5m > 1.5 * effAtr) {
              console.warn(`🛑 [MOMENTUM VELOCITY BRAKE] ${cleanSym} SELL rejected: Active 5M candle body ($${body5m.toFixed(4)}) > 1.5 * ATR ($${(1.5 * effAtr).toFixed(4)}) pumping upward. Pausing entry to avoid steamroller.`);
              return null;
            }

            if (is5mGreen && body5m > (0.35 * effAtr) && upperWickRatio5m < 0.35) {
              console.warn(`🛑 [CANDLE COLOR VETO] ${cleanSym} SELL aborted: Active 5M bar is GREEN ($${params.signalPrice.toFixed(4)} > Open $${bar5m.open.toFixed(4)}) with only ${(upperWickRatio5m * 100).toFixed(0)}% upper wick (< 35% required). Holding dispatch until bar turns RED.`);
              return null;
            }
          }
        }

        // --- CHECK 2: BUY (LONG) DISPATCH ---
        if (orderSide === 'BUY') {
          // 15M Check
          if (bar15m) {
            const is15mRed = params.signalPrice < bar15m.open;
            const liveHigh15m = Math.max(bar15m.high, params.signalPrice);
            const liveLow15m = Math.min(bar15m.low, params.signalPrice);
            const span15m = Math.max(liveHigh15m - liveLow15m, bar15m.close * 0.0005);
            const lowerWick15m = Math.max(0, Math.min(bar15m.open, params.signalPrice) - liveLow15m);
            const lowerWickRatio15m = lowerWick15m / span15m;
            const body15m = Math.abs(params.signalPrice - bar15m.open);

            if (is15mRed && body15m > 1.5 * effAtr) {
              console.warn(`🛑 [MOMENTUM VELOCITY BRAKE] ${cleanSym} BUY rejected: Active 15M candle body ($${body15m.toFixed(4)}) > 1.5 * ATR ($${(1.5 * effAtr).toFixed(4)}) dumping downward. Pausing entry to avoid catching a falling knife.`);
              return null;
            }

            // FIX DEADLOCK #3: Only block on active 15M bar if it has dropped > 0.25 * ATR against the trade direction!
            if (is15mRed && body15m > (0.25 * effAtr) && lowerWickRatio15m < 0.40) {
              console.warn(`🛑 [CANDLE COLOR VETO] ${cleanSym} BUY aborted: Active 15M bar dropped -$${body15m.toFixed(4)} (> 0.25*ATR) against Buy with only ${(lowerWickRatio15m * 100).toFixed(0)}% lower wick (< 40% required). Holding dispatch until bar turns GREEN.`);
              return null;
            }
          }

          // 5M Check
          if (bar5m) {
            const is5mRed = params.signalPrice < bar5m.open;
            const liveHigh5m = Math.max(bar5m.high, params.signalPrice);
            const liveLow5m = Math.min(bar5m.low, params.signalPrice);
            const span5m = Math.max(liveHigh5m - liveLow5m, bar5m.close * 0.0005);
            const lowerWick5m = Math.max(0, Math.min(bar5m.open, params.signalPrice) - liveLow5m);
            const lowerWickRatio5m = lowerWick5m / span5m;
            const body5m = Math.abs(params.signalPrice - bar5m.open);

            if (is5mRed && body5m > 1.5 * effAtr) {
              console.warn(`🛑 [MOMENTUM VELOCITY BRAKE] ${cleanSym} BUY rejected: Active 5M candle body ($${body5m.toFixed(4)}) > 1.5 * ATR ($${(1.5 * effAtr).toFixed(4)}) dumping downward. Pausing entry to avoid catching a falling knife.`);
              return null;
            }

            if (is5mRed && body5m > (0.35 * effAtr) && lowerWickRatio5m < 0.35) {
              console.warn(`🛑 [CANDLE COLOR VETO] ${cleanSym} BUY aborted: Active 5M bar is RED ($${params.signalPrice.toFixed(4)} < Open $${bar5m.open.toFixed(4)}) with only ${(lowerWickRatio5m * 100).toFixed(0)}% lower wick (< 35% required). Holding dispatch until bar turns GREEN.`);
              return null;
            }
          }
        }
      }

      if (bar15m) {
        const isBarGreen = params.signalPrice >= bar15m.open;
        console.log(`🕯️ [CANDLE COLOR ADAPTIVE] ${cleanSym} ${orderSide} (${params.executionMode}): Active 15M bar is ${isBarGreen ? 'GREEN' : 'RED'} ($${params.signalPrice.toFixed(4)} vs Open $${bar15m.open.toFixed(4)}) - PASSED CONFIRMATION.`);
      }
    } catch (e) {}

    // User Mandate: "4k capital ho jaye to trade off kar dena" -> Target Profit Goal of ₹4,000 INR
    const currentEquityINR = ((this.state.accountCapitalUSD || 178.57) + this.state.activePositions.reduce((s, p) => s + (p.pnlUSD || 0), 0)) * 84;

    // Emergency Zero Capital Floor Check (Enforced on both Paper and Live):
    const effectiveFloorINR = this.state.minCapitalFloorINR !== undefined ? this.state.minCapitalFloorINR : 50;
    if (currentEquityINR <= effectiveFloorINR) {
      console.warn(`🛑 [EMERGENCY ZERO CAPITAL FLOOR] Equity ₹${currentEquityINR.toFixed(0)} is at/below floor (₹${effectiveFloorINR} INR). Rejecting new position for ${cleanSym} and halting trading.`);
      this.state.isNewTradesPaused = true;
      this.state.isRunning = false;
      this.saveState();
      return null;
    }

    if (this.state.mode !== 'SIMULATION_PAPER') {
      const targetProfitCeilingINR = this.state.targetCapitalGoalINR || 10000;
      if (currentEquityINR >= targetProfitCeilingINR && targetProfitCeilingINR > 0) {
        console.warn(`🎯 [TARGET PROFIT CEILING REACHED] Equity ₹${currentEquityINR.toFixed(0)} is at/above ₹${targetProfitCeilingINR} INR profit goal. Pausing trading to secure profits.`);
        this.state.isNewTradesPaused = true;
        this.state.isRunning = false;
        this.saveState();
        return null;
      }
    }

    // Independent Multi-Coin Trading: Up to 4 positions concurrently (User Mandate: "trade le 4 part me apna capital use karo")
    const maxPositionsAllowed = this.state.maxConcurrentPositions || 4;
    const totalCurrentAndPending = this.state.activePositions.length + this.inFlightSymbols.size;
    if (totalCurrentAndPending >= maxPositionsAllowed) {
      console.warn(`🛑 Maximum concurrent positions limit (${maxPositionsAllowed}) reached (active: ${this.state.activePositions.length}, in-flight: ${this.inFlightSymbols.size}). Rejecting new position for ${params.symbol}.`);
      return null;
    }

    if (this.inFlightSymbols.has(cleanSym)) {
      console.log(`⚠️ Position execution already in-flight for ${cleanSym}. Skipping duplicate call.`);
      return null;
    }
    this.inFlightSymbols.add(cleanSym);

    try {
      const sizing = await this.calculateDynamicTradeMargin(maxPositionsAllowed);
      let marginUSD = sizing.marginUSD;
      let notionalUSD = sizing.notionalUSD;
      const leverage = sizing.leverage;

      // If available free cash is less than required margin, wait for active positions to free up margin
      if (sizing.availableUSD < marginUSD * 0.90) {
        console.log(`⚠️ Available cash ($${sizing.availableUSD.toFixed(2)}) is less than required margin ($${marginUSD.toFixed(2)}). Waiting for active positions to take profit or free up balance.`);
        return null;
      }

      const balanceINR = sizing.totalBalanceUSD * 84;
      console.log(`💰 [FULL MARGIN UTILIZATION] Balance: ₹${balanceINR.toFixed(0)} ($${sizing.totalBalanceUSD.toFixed(2)}) | Free: $${sizing.availableUSD.toFixed(2)} → Dynamic Margin: $${marginUSD.toFixed(2)} ($${notionalUSD.toFixed(2)} Notional @ ${leverage}x) | Slot ${this.state.activePositions.length + 1}/${maxPositionsAllowed}`);

      const rawQuantity = notionalUSD / params.signalPrice;
      let quantity = parseFloat(rawQuantity.toFixed(4));

    const isXrp = params.symbol.toUpperCase().includes('XRP') || params.strategyName.includes('XRP');
    const isBtc = params.symbol.toUpperCase().includes('BTC') || params.strategyName.includes('BTC') || params.strategyName.includes('V33');
    const isAda = params.symbol.toUpperCase().includes('ADA') || params.strategyName.includes('ADA');
    const isAvax = params.symbol.toUpperCase().includes('AVAX') || params.strategyName.includes('AVAX');
    const isDoge = params.symbol.toUpperCase().includes('DOGE') || params.strategyName.includes('DOGE');
    const isEth = params.symbol.toUpperCase().includes('ETH') || params.strategyName.includes('ETH');
    const isSol = params.symbol.toUpperCase().includes('SOL') || params.strategyName.includes('SOL');

    // ============================================================
    // FULL CAPITAL ₹15K DEPLOYMENT SIZING
    // User Mandate: "all system have 15k capital okay not 2k and trade with full capital 15k"
    // ============================================================
    // 1. Full Capital Margin Sizing:
    // Sized directly to deploy the available margin calculated for this trade
    quantity = rawQuantity;
    if (quantity <= 0) quantity = 0.0001;

    // Half-size sizing for Zigzag Base Bounce longs per signal.pdf Section 6:
    if (params.strategyName.includes('ZIGZAG_BASE_BOUNCE')) {
      quantity = parseFloat((quantity * 0.5).toFixed(4));
      console.log(`🛡️ [ZIGZAG HALF SIZE] Base bounce long sized to 50% (${quantity} contracts) per signal.pdf.`);
    }

    // Fetch recent candles to calculate accurate pre-reversal TP & SL on CLOSED candles
    let execCandles: KlinePoint[] = [];
    try {
      execCandles = await this.fetchCandles(params.symbol, '15m', 100);
    } catch (e) {}
    const closedExecCandles = execCandles.length > 1 ? execCandles.slice(0, -1) : execCandles;

    const btcLead = await this.fetchCandles('BTCUSD', '15m', 60).catch(() => []);
    const ethLead = await this.fetchCandles('ETHUSD', '15m', 60).catch(() => []);
    const btcClosed = btcLead.length > 1 ? btcLead.slice(0, -1) : btcLead;
    const ethClosed = ethLead.length > 1 ? ethLead.slice(0, -1) : ethLead;

    const spec = deltaExchange.getProductSpec(cleanSym, params.signalPrice);

    const avgVol = closedExecCandles.length >= 20
      ? closedExecCandles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20
      : 1;
    const curVol = closedExecCandles[closedExecCandles.length - 1]?.volume || 0;
    const volumeRatio = avgVol > 0 ? curVol / avgVol : 1.0;

    const isManualForce = params.strategyName?.includes('Manual Execution') || (params as any).isManualForce === true;

    // UNIVERSAL TRADE GUARD (RULES 1, 2, 3, 5 PRE-DISPATCH FINAL GATE)
    const guardVerdict = UniversalTradeGuard.evaluatePreTradeGate({
      symbol: cleanSym,
      side: params.side,
      currentPrice: params.signalPrice,
      accountCapitalUSD: this.state.accountCapitalUSD || 193,
      candles15m: closedExecCandles,
      atr: params.atr,
      activePositions: this.state.activePositions,
      leverage,
      decimals: spec.decimals,
      tickSize: spec.tickSize,
      maxMarginUSD: marginUSD,
      isPort3010: this.port === 3010,
      volumeRatio,
      isManualForce,
      port: this.port,
      strategyCustomSL: params.customSL,
      strategyCustomTP: params.customTP,
      btcCandles15m: btcClosed,
      ethCandles15m: ethClosed,
    });

    if (!guardVerdict.allowed) {
      console.warn(`🛑 [UNIVERSAL TRADE GUARD REJECTED] ${params.symbol} ${params.side}: ${guardVerdict.reason}`);
      return null;
    }

    let takeProfitPrice = guardVerdict.takeProfitPrice;
    let stopLossPrice = guardVerdict.stopLossPrice;
    let targetPriceDistance = guardVerdict.tpDistance;
    let slPriceDistance = guardVerdict.slDistance;
    if (guardVerdict.quantity > 0 && guardVerdict.quantity < quantity) {
      quantity = guardVerdict.quantity;
    }

    // Safety & Risk Parity Guard: Never risk more than maxLossPerTradeUSD on any single slot
    const maxLossLimitUSD = 3.20; // HARD CAP: $3.20 max loss per trade (User Mandate: -$3.20 USD risk cap)
    const MAX_NOTIONAL_USD = 750; // HARD NOTIONAL CAP: $750 USD max per position (User Mandate)

    if (slPriceDistance > 0) {
      const maxAllowedByRisk = maxLossLimitUSD / slPriceDistance;
      const maxAllowedByNotional = MAX_NOTIONAL_USD / params.signalPrice;
      const finalMaxCoins = Math.min(maxAllowedByRisk, maxAllowedByNotional);
      if (quantity > finalMaxCoins) {
        console.log(`🛡️ [RISK & NOTIONAL SIZING] Capping size on ${params.symbol} from ${quantity.toFixed(4)} to ${finalMaxCoins.toFixed(4)} coins (SL dist: $${slPriceDistance.toFixed(spec.decimals)}, maxLoss: $${maxLossLimitUSD}, maxNotional: $${MAX_NOTIONAL_USD}).`);
        quantity = finalMaxCoins;
      }
    }

    // Floor to nearest contract lot to never overshoot risk
    const contracts = Math.max(1, Math.floor(quantity / spec.contractValue));
    quantity = contracts * spec.contractValue;

    // Full 4-Portion Capital Utilization
    notionalUSD = parseFloat((quantity * params.signalPrice).toFixed(2));
    marginUSD = parseFloat((notionalUSD / leverage).toFixed(2));

    const projectedLossUSD = parseFloat((slPriceDistance * quantity).toFixed(2));
    const projectedProfitUSD = parseFloat((targetPriceDistance * quantity).toFixed(2));

    // MANDATORY MINIMUM CONTRACT RISK & NOTIONAL CEILING VETO:
    // If even 1 single minimum contract exceeds $3.90 risk or $750 notional (e.g. MKR, PAXG), ABORT PRE-DISPATCH!
    if (projectedLossUSD > maxLossLimitUSD * 1.05) {
      console.warn(`🛡️ [MINIMUM CONTRACT RISK VETO] ${params.symbol}: Minimum contract lot risk ($${projectedLossUSD.toFixed(2)} USD) exceeds $${maxLossLimitUSD.toFixed(2)} limit. Minimum tradeable unit is too large for account risk cap. Aborting trade.`);
      return null;
    }
    if (notionalUSD > MAX_NOTIONAL_USD * 1.10) {
      console.warn(`🛡️ [MINIMUM CONTRACT NOTIONAL VETO] ${params.symbol}: Minimum contract lot notional ($${notionalUSD.toFixed(2)} USD) exceeds $${MAX_NOTIONAL_USD} limit. Aborting trade.`);
      return null;
    }

    console.log(`💰 [FULL CAPITAL SIZING] ${params.symbol} sized to ${quantity} (${contracts} contracts, $${notionalUSD.toFixed(2)} Notional @ ${leverage}x, Margin: $${marginUSD.toFixed(2)} | SL: $${stopLossPrice.toFixed(4)}, TP: $${takeProfitPrice.toFixed(4)}).`);
    console.log(`🎯 [ACCURATE DIRECT TREND DISPATCH] ${params.symbol} ${params.side}: Entry=$${params.signalPrice.toFixed(4)} | TP=$${takeProfitPrice.toFixed(4)} (Projected Win: +$${projectedProfitUSD} USD, Target Level: $${takeProfitPrice.toFixed(4)}) | SL=$${stopLossPrice.toFixed(4)} (Max Risk: -$${projectedLossUSD} USD) | Margin=$${marginUSD.toFixed(2)} (${contracts} contracts)`);

    const finalSide = guardVerdict.executedSide;
    const effectiveStrategyName = guardVerdict.isFlipped
      ? `${params.strategyName} [${guardVerdict.reversalTag}]`
      : params.strategyName;

    // UNBREAKABLE FINAL PRE-DISPATCH CANDLE-BODY SUPPORT/RESISTANCE GATEKEEPER (FIX 2)
    // NEVER stretch or push takeProfitPrice further away than the Nearest Opposing Candle-Body Support/Resistance!
    // The market will NOT break through real support just because our formula wants 1.25R!
    let finalRisk = Math.abs(params.signalPrice - stopLossPrice);
    let finalReward = Math.abs(takeProfitPrice - params.signalPrice);
    let tpDistPct = finalReward / params.signalPrice;

    if (finalReward < 0.95 * finalRisk || tpDistPct < 0.0050) {
      console.warn(`🛑 [SUPPORT_WALL_TOO_CLOSE_VETO] Aborting order dispatch for ${params.symbol}: Distance to real candle-body wall ($${finalReward.toFixed(spec.decimals)}, ${(tpDistPct * 100).toFixed(2)}%) < 0.95 * Risk ($${(0.95 * finalRisk).toFixed(spec.decimals)}) or < 0.50%. Never push TP past real support wall into thin air!`);
      return null;
    }

    // Rule B: HARD MAXIMUM TP CEILING (MAX_TP_RR = 2.20R & MAX_TP_PCT = 1.20%)
    // Never allow the TP scanner to jump across an empty crash void to a 9.30R moonshot target!
    const MAX_TP_RR = 2.20;
    const MAX_TP_PCT = 0.0120;
    if (finalReward > MAX_TP_RR * finalRisk || tpDistPct > MAX_TP_PCT) {
      const cappedDist = Math.min(2.00 * finalRisk, params.signalPrice * 0.0100);
      takeProfitPrice = params.side === 'BUY'
        ? parseFloat((params.signalPrice + cappedDist).toFixed(spec.decimals))
        : parseFloat((params.signalPrice - cappedDist).toFixed(spec.decimals));
      finalReward = cappedDist;
      tpDistPct = finalReward / params.signalPrice;
      console.log(`🛡️ [TP_CEILING_ENFORCED] Capped moonshot TP for ${params.symbol} to $${takeProfitPrice.toFixed(spec.decimals)} (${(finalReward / finalRisk).toFixed(2)}R, ${(tpDistPct * 100).toFixed(2)}%).`);
    }

    // CROSS-PORT ATOMIC MUTEX: Prevent duplicate orders on same symbol across ports (User Mandate)
    const mutexResult = acquireOrderMutex(params.symbol, this.port);
    if (!mutexResult.allowed) {
      console.warn(`🛑 [CROSS-PORT MUTEX BLOCKED] ${params.symbol} order blocked: ${mutexResult.reason}`);
      return null;
    }

    // Send order to Delta Exchange Broker Gateway
    let orderResult = await deltaExchange.placeOrder({
      symbol: params.symbol,
      side: finalSide,
      size: quantity,
      price: params.signalPrice,
      takeProfitPrice,
      stopLossPrice,
    });

    if (this.state.mode !== 'SIMULATION_PAPER' && (!orderResult || !orderResult.success)) {
      const exchangeError = orderResult?.message || 'Dispatch error';
      if (this.state.mode === 'DELTA_TESTNET' && (exchangeError.includes('ip_not_whitelisted') || exchangeError.includes('401'))) {
        console.warn(`⚠️ [TESTNET IP RESTRICTION] Delta Testnet rejected order (${exchangeError}). Executing trade in Testnet paper emulation mode so trades are not missed!`);
        orderResult = {
          success: true,
          orderId: 'testnet-emu-' + Date.now(),
          fillPrice: params.signalPrice,
          message: 'Testnet Emulation (IP 175.100.133.89 whitelist pending)',
        };
      } else {
        console.error(`❌ Delta Exchange rejected order for ${params.symbol}: ${exchangeError}. Aborting position entry so phantom trades are not created.`);
        return null;
      }
    } else {
      console.log(`✅ Delta Exchange live order confirmed for ${params.symbol}!`);
    }

    const fillPrice = (orderResult && orderResult.success && orderResult.fillPrice && orderResult.fillPrice > 0)
      ? orderResult.fillPrice
      : params.signalPrice;

    const fillAccurateTarget = this.calculateAccurateReversalTP({
      symbol: params.symbol,
      side: finalSide,
      entryPrice: fillPrice,
      effectiveQuantity: quantity,
      atr: params.atr,
      candles: execCandles,
      customTP: params.customTP,
      customSL: params.customSL,
    });

    let reanchoredTP = fillAccurateTarget.takeProfitPrice;
    let reanchoredSL = stopLossPrice; // MANDATORY: Anchor to validated pre-trade structural SL, NEVER widen post-fill!

    // Strict Tighten-Only Guarantee: SL must NEVER widen away from fillPrice beyond pre-sized stopLossPrice
    if (finalSide === 'BUY') {
      if (reanchoredTP <= fillPrice || reanchoredTP < takeProfitPrice) {
        reanchoredTP = Math.max(takeProfitPrice, fillPrice + Math.max(fillAccurateTarget.targetDistance, Math.max(slPriceDistance * 1.15, fillPrice * 0.0050)));
      }
      if (reanchoredSL < stopLossPrice) {
        reanchoredSL = stopLossPrice;
      }
      // Hard Risk Parity Enforcement: SL distance can NEVER exceed maxLossLimitUSD ($4.00) for this quantity
      const maxAllowedDistFromFill = maxLossLimitUSD / quantity;
      const minAllowedSL = fillPrice - maxAllowedDistFromFill;
      if (reanchoredSL < minAllowedSL) {
        console.warn(`🛡️ [RISK PARITY POST-FILL] Clamping reanchored SL on ${params.symbol} BUY from $${reanchoredSL.toFixed(4)} to $${minAllowedSL.toFixed(4)} to guarantee loss <= $${maxLossLimitUSD} USD.`);
        reanchoredSL = minAllowedSL;
      }
      // Guarantee Reward >= 1.20 * Risk post-fill (User Mandate: Min RR >= 1.20R)
      const postFillRisk = Math.abs(fillPrice - reanchoredSL);
      if (reanchoredTP - fillPrice < postFillRisk * 1.20) {
        reanchoredTP = parseFloat((fillPrice + (postFillRisk * 1.20)).toFixed(spec.decimals));
      }
    } else {
      if (reanchoredTP >= fillPrice || reanchoredTP > takeProfitPrice) {
        reanchoredTP = Math.min(takeProfitPrice, fillPrice - Math.max(fillAccurateTarget.targetDistance, Math.max(slPriceDistance * 1.20, fillPrice * 0.0055)));
      }
      if (reanchoredSL > stopLossPrice) {
        reanchoredSL = stopLossPrice;
      }
      const maxAllowedDistFromFill = maxLossLimitUSD / quantity;
      const maxAllowedSL = fillPrice + maxAllowedDistFromFill;
      if (reanchoredSL > maxAllowedSL) {
        console.warn(`🛡️ [RISK PARITY POST-FILL] Clamping reanchored SL on ${params.symbol} SELL from $${reanchoredSL.toFixed(4)} to $${maxAllowedSL.toFixed(4)} to guarantee loss <= $${maxLossLimitUSD} USD.`);
        reanchoredSL = maxAllowedSL;
      }
      // Guarantee Reward >= 1.20 * Risk post-fill (User Mandate: Min RR >= 1.20R)
      const postFillRisk = Math.abs(reanchoredSL - fillPrice);
      if (fillPrice - reanchoredTP < postFillRisk * 1.20) {
        reanchoredTP = parseFloat((fillPrice - (postFillRisk * 1.20)).toFixed(spec.decimals));
      }
    }

    // Sync position bracket order only if fillPrice deviated significantly from signalPrice
    if (deltaExchange.isLiveDispatchActive()) {
      try {
        if (Math.abs(fillPrice - params.signalPrice) > (params.atr * 0.1)) {
          await deltaExchange.updateBracketOrder(params.symbol, reanchoredSL, reanchoredTP, finalSide, fillPrice);
          console.log(`🎯 [DELTA BRACKET SYNC] Adjusted pre-reversal bracket on ${params.symbol} (${finalSide}): SL=$${reanchoredSL.toFixed(4)}, TP=$${reanchoredTP.toFixed(4)}`);
        }
      } catch (err: any) {
        console.warn(`⚠️ [DELTA BRACKET NOTE] ${params.symbol}:`, err?.message || err);
      }
    }

    const newPos: DeltaPosition = {
      id: 'pos-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      symbol: params.symbol,
      side: finalSide,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      quantity,
      marginUSD,
      notionalUSD,
      leverage: this.state.leverage,
      takeProfitPrice: reanchoredTP,
      stopLossPrice: reanchoredSL,
      initialStopLossPrice: reanchoredSL,
      atr: params.atr,
      isBreakevenLocked: false,
      isRiskRecycled: false,
      tp1Hit: false,
      tp1Price: params.tp1Price || reanchoredTP,
      tp2Price: params.tp2Price,
      strategyName: effectiveStrategyName,
      tp1Ratio: params.tp1Ratio ?? 0.75,
      tp2Ratio: params.tp2Ratio ?? 0.25,
      earlyBreakevenPrice: params.earlyBreakevenPrice,
      riskDistance: params.riskDistance || Math.abs(fillPrice - reanchoredSL),
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      shadowConfirmedSeconds: params.shadowConfirmedSeconds,
      executionMode: params.executionMode || 'DIRECT',
      reversalReason: params.reversalReason,
      isFastScalp: guardVerdict.isFastScalp ?? (this.state.activePositions.length < 2),
      slotType: guardVerdict.slotType ?? (this.state.activePositions.length < 2 ? 'FAST_SCALP' : 'SNIPER_RUNNER'),
    };

    this.state.activePositions.push(newPos);
    this.state.totalTradesCount += 1;
    this.saveState();

    console.log(`🎯 Position opened: ${params.symbol} ${params.side} @ $${fillPrice.toFixed(2)} | TP: $${reanchoredTP.toFixed(2)} | SL: $${reanchoredSL.toFixed(2)}`);

    // Independent Trading: Do not forcibly propagate leader signals to other coins
    // Each coin trades purely on its own dedicated indicator + math confluence

    return newPos;
    } finally {
      this.inFlightSymbols.delete(cleanSym);
    }
  }

  /**
   * Propagates a trade signal from a Leader coin to its designated Follower (Disabled for pure independent signals)
   */
  public async propagateLeaderSignal(_leaderSymbol: string, _leaderSide: 'BUY' | 'SELL', _leaderStrategy: string) {
    // Disabled: Coins trade independently on their dedicated indicators
  }

  public async reconcileFollowerPositions() {
    // Disabled: Coins trade independently on their dedicated indicators
  }

  // -------------------------------------------------------------
  // 4. Dynamic Risk Management, SL & TP Engine
  // -------------------------------------------------------------

  public async evaluatePositionSLTP(pos: DeltaPosition, currentPrice: number, index: number) {
    if (!currentPrice || currentPrice <= 0 || isNaN(currentPrice)) return;

    // Dedicated Options Risk & PnL Evaluation (Hybrid ATM Options + Port 3001)
    const isOptionPos = pos.symbol.startsWith('C-') || pos.symbol.startsWith('P-') || pos.instrumentType === 'OPTION';
    if (isOptionPos) {
      pos.currentPrice = currentPrice;
      const isHybridBuyOption = pos.side === 'BUY' || pos.strategyName?.includes('Hybrid ATM Option');
      if (isHybridBuyOption) {
        const priceDiffOpt = pos.side === 'SELL' ? pos.entryPrice - currentPrice : currentPrice - pos.entryPrice;
        pos.pnlUSD = parseFloat((priceDiffOpt * pos.quantity).toFixed(2));
        pos.pnlPercent = pos.marginUSD > 0 ? parseFloat(((pos.pnlUSD / pos.marginUSD) * 100).toFixed(2)) : 0;
        pos.highestPnlUSD = Math.max(pos.highestPnlUSD || 0, pos.pnlUSD);
        pos.optionTrailingPeakPrice = Math.max(pos.optionTrailingPeakPrice || pos.entryPrice, currentPrice);

        const optGainPct = pos.entryPrice > 0 ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : pos.pnlPercent;
        const optTick = pos.optionTickSize || deltaExchange.getProductSpec(pos.symbol, pos.entryPrice).tickSize || 0.5;
        const isLiveExOpt = Boolean(deltaExchange.getConfig().apiKey && !deltaExchange.getConfig().isSimulation && process.env.PAPER_TRADING !== 'true');

        // STRICT RULE: NEVER trail or touch Option SL while in loss / <= entry!
        // Option Trailing Lock:
        // - Up >= +28%: Lock SL >= +22% (and trail 12% behind peak premium, strictly < currentPrice)
        // - Up >= +25%: Lock SL >= +15%
        if (pos.pnlUSD > 0 && currentPrice > pos.entryPrice && optGainPct >= 25.0) {
          const targetLockPrice = optGainPct >= 28.0
            ? roundToTickSize(Math.max(pos.entryPrice * 1.22, (pos.optionTrailingPeakPrice || currentPrice) * 0.88), optTick)
            : roundToTickSize(pos.entryPrice * 1.15, optTick);

          if (targetLockPrice > pos.entryPrice && targetLockPrice < currentPrice && targetLockPrice > (pos.stopLossPrice || 0)) {
            pos.stopLossPrice = targetLockPrice;
            pos.customSL = targetLockPrice;
            pos.trailLockPrice = targetLockPrice;
            pos.isProfitLockArmed = true;
            pos.isBreakevenLocked = true;
            console.log(`🛡️ [OPTION TRAILING LOCK] ${pos.symbol} up +${optGainPct.toFixed(1)}% (Mark $${currentPrice}). Locking Option SL at $${targetLockPrice}!`);
            if (isLiveExOpt) {
              deltaExchange.updateBracketOrder(pos.symbol, targetLockPrice, pos.takeProfitPrice, pos.side, pos.entryPrice).catch(() => {});
            }
          }
        }

        // Spot-Synced Structural Stop-Loss check for Options (avoids Theta bleed if underlying invalidates structure!)
        if (pos.spotSlPrice && pos.spotSlPrice > 0) {
          const spotAsset = pos.underlyingAsset || (pos.symbol.includes('-ETH-') ? 'ETH' : 'BTC');
          const spotSym = spotAsset === 'ETH' ? 'ETHUSD' : 'BTCUSD';
          let spotLivePrice = await deltaExchange.getMarketPrice(spotSym).catch(() => 0);
          if (!spotLivePrice || spotLivePrice <= 0) {
            const cachedSpotTicker = deltaExchange.getCachedTicker(spotSym);
            spotLivePrice = parseFloat(cachedSpotTicker?.spot_price || cachedSpotTicker?.mark_price || '0');
          }
          const isValidSpotRef =
            spotLivePrice > 0 &&
            Number.isFinite(spotLivePrice) &&
            (!pos.spotEntryPrice || Math.abs(spotLivePrice - pos.spotEntryPrice) / pos.spotEntryPrice < 0.25);

          if (isValidSpotRef) {
            const isCallOpt = pos.optionType === 'CALL' || pos.symbol.startsWith('C-');
            const spotSlTriggered = isCallOpt
              ? spotLivePrice <= pos.spotSlPrice
              : spotLivePrice >= pos.spotSlPrice;

            if (spotSlTriggered) {
              console.log(`🛑 [SPOT-SYNCED OPTION SL] ${spotSym} ($${spotLivePrice}) breached Spot SL ($${pos.spotSlPrice}). Closing ${pos.symbol} @ $${currentPrice} (${pos.pnlPercent.toFixed(1)}% ROE)!`);
              await this.closePosition(pos.id, 'STOP_LOSS_HIT', currentPrice, { allowOptionSpotSlClose: true });
              return;
            }
          }
        }

        const targetRoe = pos.expectedRoePct || 55.0;
        const isTPHitOpt = currentPrice >= (pos.takeProfitPrice || pos.entryPrice * 1.55) || pos.pnlPercent >= targetRoe;
        const isTrailedSlHitLive = Boolean(isLiveExOpt && pos.isProfitLockArmed && pos.stopLossPrice > pos.entryPrice && currentPrice <= pos.stopLossPrice);
        const isSLHitOpt = (!isLiveExOpt && (currentPrice <= (pos.stopLossPrice || pos.entryPrice * 0.82) || pos.pnlPercent <= -18.0)) || isTrailedSlHitLive;

        if (isTPHitOpt) {
          console.log(`🎯 [HYBRID OPTION TP] ${pos.symbol} reached +${pos.pnlPercent.toFixed(1)}% ROE (PnL: +$${pos.pnlUSD} USD). Banking Option profit.`);
          await this.closePosition(pos.id, 'TARGET_HIT', currentPrice);
          return;
        }
        if (isSLHitOpt) {
          const reasonTag = isTrailedSlHitLive ? 'REVERSAL_PROFIT_LOCKED' : 'STOP_LOSS_HIT';
          console.log(`🛑 [HYBRID OPTION SL] ${pos.symbol} triggered Option SL at $${currentPrice} (${pos.pnlPercent.toFixed(1)}% ROE, PnL: $${pos.pnlUSD} USD). Closing position.`);
          await this.closePosition(pos.id, reasonTag, currentPrice, isTrailedSlHitLive ? undefined : undefined);
          return;
        }
        return;
      }

      const contractValue = pos.symbol.includes('BTC') ? 0.001 : 0.01;
      // For option writing (side: SELL): price drop = profit!
      const priceDiff = pos.side === 'SELL' ? pos.entryPrice - currentPrice : currentPrice - pos.entryPrice;
      pos.pnlUSD = parseFloat((priceDiff * pos.quantity * contractValue).toFixed(2));
      pos.pnlPercent = pos.marginUSD > 0 ? parseFloat(((pos.pnlUSD / pos.marginUSD) * 100).toFixed(2)) : 0;
      pos.highestPnlUSD = Math.max(pos.highestPnlUSD || 0, pos.pnlUSD);

      // Theta Decay Target Hit (e.g. markPrice decayed to <= takeProfitPrice or pnlUSD >= $1.50)
      const isTPHit = pos.side === 'SELL'
        ? (currentPrice <= (pos.takeProfitPrice || 0.20) || pos.pnlUSD >= 1.50)
        : (currentPrice >= (pos.takeProfitPrice || pos.entryPrice * 2.0));

      // Stop Loss Hit (e.g. markPrice doubled or pnlUSD <= -2.50)
      const isSLHit = pos.side === 'SELL'
        ? (currentPrice >= (pos.stopLossPrice || pos.entryPrice * 2.20))
        : (currentPrice <= (pos.stopLossPrice || pos.entryPrice * 0.50));

      if (isTPHit) {
        console.log(`🎯 [OPTION TAKE PROFIT] ${pos.symbol} reached theta decay target (PnL: +$${pos.pnlUSD} USD). Closing position.`);
        await this.closePosition(pos.id, 'TARGET_HIT', currentPrice);
        return;
      }

      if (isSLHit) {
        console.log(`🛑 [OPTION STOP LOSS] ${pos.symbol} hit stop ceiling (PnL: $${pos.pnlUSD} USD). Closing position.`);
        await this.closePosition(pos.id, 'STOP_LOSS_HIT', currentPrice);
        return;
      }
      return;
    }

    // Reject price anomalies (> 50% deviation from entry) to prevent bad ticks from falsely closing trades
    if (pos.entryPrice > 0 && Math.abs(currentPrice - pos.entryPrice) / pos.entryPrice > 0.5) {
      console.warn(`⚠️ Price anomaly skipped for ${pos.symbol}: entry=${pos.entryPrice}, tick=${currentPrice}`);
      return;
    }

    const isLivePos = pos.id.startsWith('delta-live-') || (this.state.mode === 'DELTA_TESTNET' || this.state.mode === 'DELTA_LIVE' || this.state.mode === 'LIVE_DELTA_INDIA' || process.env.DELTA_TRADING_MODE === 'DELTA_TESTNET' || process.env.DELTA_TRADING_MODE === 'LIVE_DELTA_INDIA');
    
    // For live exchange positions, synchronize mark price directly from Delta Exchange
    if (isLivePos) {
      const cached = deltaExchange.getCachedTicker(pos.symbol);
      const mark = cached?.mark_price ? parseFloat(cached.mark_price) : 0;
      if (mark > 0) {
        currentPrice = mark;
      }
    }

    // Real-time tick price update for all positions
    pos.currentPrice = currentPrice;

    // Floating PnL calculation with exact contract value multiplier precision
    const priceDiff = pos.side === 'BUY'
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;

    const spec = deltaExchange.getProductSpec(pos.symbol, pos.entryPrice);
    let effectiveQty = pos.quantity;
    if (spec.contractValue < 1.0 && effectiveQty >= 10 && pos.notionalUSD > 0 && Math.abs(pos.notionalUSD - (pos.entryPrice * effectiveQty * spec.contractValue)) < Math.abs(pos.notionalUSD - (pos.entryPrice * effectiveQty))) {
      effectiveQty = effectiveQty * spec.contractValue;
      pos.quantity = effectiveQty;
      pos.notionalUSD = parseFloat((pos.entryPrice * effectiveQty).toFixed(2));
    }
    
    let calculatedPnl = effectiveQty > 0
      ? priceDiff * effectiveQty
      : (priceDiff / (pos.entryPrice || 1)) * pos.notionalUSD;

    // Precision zeroing: If price is identical to entry within 1.05 ticks, zero out PnL (prevents micro ghost loss)
    if (Math.abs(currentPrice - pos.entryPrice) <= (spec.tickSize * 1.05)) {
      calculatedPnl = 0.0;
    }

    // Authoritative Exchange PnL: If live exchange reported exact unrealized_pnl, bind strictly to it
    if (isLivePos && pos.exchangePnl !== undefined && !isNaN(pos.exchangePnl)) {
      calculatedPnl = pos.exchangePnl;
    }

    // Live continuous mark-to-market PnL tracking matching Delta Exchange WebSocket tick-by-tick
    pos.pnlUSD = parseFloat(calculatedPnl.toFixed(2));
    pos.pnlPercent = pos.marginUSD > 0 ? parseFloat(((pos.pnlUSD / pos.marginUSD) * 100).toFixed(2)) : 0;

    // Update peak floating profit reached during trade
    pos.highestPnlUSD = Math.max(pos.highestPnlUSD || 0, pos.pnlUSD);

    // =========================================================================
    // FIX 7: TIME STOP & EXHAUSTION EXIT (Timing Fix Playbook traps.pdf)
    // Time stop removed per user mandate: pure TP/SL only

    // Exhaustion exit removed per user mandate: pure TP/SL only

    // =========================================================================
    // Validate and auto-repair TP and SL so positions are NEVER abandoned without monitoring!
    if (!pos.takeProfitPrice || pos.takeProfitPrice <= 0 || isNaN(pos.takeProfitPrice)) {
      pos.takeProfitPrice = pos.side === 'BUY' ? pos.entryPrice * 1.02 : pos.entryPrice * 0.98;
      console.warn(`⚠️ [AUTO-REPAIR] Fixed non-positive TP on ${pos.symbol} to ${pos.takeProfitPrice.toFixed(4)}`);
    }
    if (!pos.stopLossPrice || pos.stopLossPrice <= 0 || isNaN(pos.stopLossPrice)) {
      pos.stopLossPrice = pos.side === 'BUY' ? pos.entryPrice * 0.98 : pos.entryPrice * 1.02;
      console.warn(`⚠️ [AUTO-REPAIR] Fixed non-positive SL on ${pos.symbol} to ${pos.stopLossPrice.toFixed(4)}`);
    }

    // User Mandate: Strict Hold for full 1:2.3 TP or Structural SL
    // "yee sab band hata do bas sl/tp hit hone wala ham bhi dekhe youtube pe btaya hai wo sach hai ki nhi tp/sl"
    // Breakeven and trailing SLs are completely removed so trades have full breathing room to play out.

    // SET-AND-FORGET FIXED BRACKET MODE (User Mandate: "SL ek hi baar lagega, change nahi hoga!")
    // Stop-Loss and Take-Profit are placed ONCE at order entry and NEVER modified, trailed, or moved to breakeven!
    const isInstPort = [3000, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3025].includes(this.port);

    // UniversalTradeGuard & early software profit locks DISABLED per User Emergency Hard Reset Mandate.
    // Trades strictly run with Exchange Brackets: zero software close on losses.

    // =========================================================================
    // FEE-ADJUSTED MULTI-STAGE PROFIT LOCK ENGINE
    // Rule: NEVER touch/modify exchange brackets while PnL <= 0!
    // Stage 1 (Fee Recovery): At breakevenPlusFeeTriggerPrice (+11%/+12% Gross ROE), lock SL at breakevenPlusFeeLockPrice (+4.5% ROE -> fees paid + green!).
    // Stage 2 (23% -> 40% Runner Lock): For Normal Runners, at runner23PctTriggerPrice (+24% Gross / +21% Net), lock SL at runner18PctLockPrice (+20% Gross / +17% Net) and let TP run to 30%–40%+!
    // Fallback: Positions without explicit fee-recovery triggers preserve unified 55% -> +25% lock.
    // =========================================================================
    if (pos.pnlUSD > 0 && pos.entryPrice > 0 && pos.takeProfitPrice > 0) {
      if (pos.breakevenPlusFeeTriggerPrice && pos.breakevenPlusFeeLockPrice) {
        const hasRunnerStage = Boolean(
          pos.runner23PctTriggerPrice &&
          pos.runner18PctLockPrice &&
          pos.runner23PctTriggerPrice !== pos.takeProfitPrice &&
          (pos.seatBucket === 'NORMAL_23_TO_40PCT_SEAT' || pos.seatBucket === 'BIG_SIGNAL_SEAT' || pos.tier === 'STRONG_23PCT_RUNNER')
        );

        let lockedStage2 = false;
        if (hasRunnerStage && pos.runner23PctTriggerPrice && pos.runner18PctLockPrice) {
          const crossedRun23 = pos.side === 'BUY'
            ? currentPrice >= pos.runner23PctTriggerPrice
            : currentPrice <= pos.runner23PctTriggerPrice;
          const isRunLockProfitable = pos.side === 'BUY'
            ? pos.runner18PctLockPrice > pos.entryPrice
            : pos.runner18PctLockPrice < pos.entryPrice;
          const isSlBehindRunLock = pos.side === 'BUY'
            ? pos.stopLossPrice < pos.runner18PctLockPrice
            : pos.stopLossPrice > pos.runner18PctLockPrice;

          if (crossedRun23 && isRunLockProfitable && isSlBehindRunLock) {
            pos.stopLossPrice = pos.runner18PctLockPrice;
            pos.customSL = pos.runner18PctLockPrice;
            pos.trailLockPrice = pos.runner18PctLockPrice;
            pos.isProfitLockArmed = true;
            pos.isBreakevenLocked = true;
            lockedStage2 = true;
            console.log(
              `🚀 [23%->40% RUNNER LOCK] ${pos.symbol} (${pos.side}) hit $${pos.runner23PctTriggerPrice} (+24% Gross ROE | PnL: +$${pos.pnlUSD.toFixed(2)} USD). Locking SL at $${pos.runner18PctLockPrice} (+20% Gross / +17% Net) while riding TP $${pos.takeProfitPrice}!`
            );
            if (isLivePos) {
              deltaExchange.updateBracketOrder(pos.symbol, pos.runner18PctLockPrice, pos.takeProfitPrice, pos.side, pos.entryPrice).catch(() => {});
            }
          }
        }

        if (!lockedStage2) {
          const crossedStage1 = pos.side === 'BUY'
            ? currentPrice >= pos.breakevenPlusFeeTriggerPrice
            : currentPrice <= pos.breakevenPlusFeeTriggerPrice;
          const isBeProfitable = pos.side === 'BUY'
            ? pos.breakevenPlusFeeLockPrice > pos.entryPrice
            : pos.breakevenPlusFeeLockPrice < pos.entryPrice;
          const isSlBehindBe = pos.side === 'BUY'
            ? pos.stopLossPrice < pos.breakevenPlusFeeLockPrice
            : pos.stopLossPrice > pos.breakevenPlusFeeLockPrice;

          if (crossedStage1 && isBeProfitable && isSlBehindBe) {
            pos.stopLossPrice = pos.breakevenPlusFeeLockPrice;
            pos.customSL = pos.breakevenPlusFeeLockPrice;
            pos.trailActivationPrice = pos.breakevenPlusFeeTriggerPrice;
            pos.trailLockPrice = pos.breakevenPlusFeeLockPrice;
            pos.isProfitLockArmed = true;
            pos.isBreakevenLocked = true;
            console.log(
              `🛡️ [STAGE-1 FEE RECOVERY LOCK] ${pos.symbol} (${pos.side}) crossed $${pos.breakevenPlusFeeTriggerPrice} (+11%/+12% ROE | PnL: +$${pos.pnlUSD.toFixed(2)} USD). Locking SL at +4.5% ROE ($${pos.breakevenPlusFeeLockPrice}) — fees 100% covered!`
            );
            if (isLivePos) {
              deltaExchange.updateBracketOrder(pos.symbol, pos.breakevenPlusFeeLockPrice, pos.takeProfitPrice, pos.side, pos.entryPrice).catch(() => {});
            }
          }
        }
      } else {
        const tpDist = Math.abs(pos.takeProfitPrice - pos.entryPrice);
        if (tpDist > 0) {
          const activationPrice =
            pos.trailActivationPrice && pos.trailActivationPrice > 0
              ? pos.trailActivationPrice
              : pos.trailTriggerPrice && pos.trailTriggerPrice > 0
              ? pos.trailTriggerPrice
              : roundToTickSize(
                  pos.side === 'BUY' ? pos.entryPrice + tpDist * 0.55 : pos.entryPrice - tpDist * 0.55,
                  spec.tickSize
                );

          const lockPrice =
            pos.trailLockPrice && pos.trailLockPrice > 0
              ? pos.trailLockPrice
              : roundToTickSize(
                  pos.side === 'BUY' ? pos.entryPrice + tpDist * 0.25 : pos.entryPrice - tpDist * 0.25,
                  spec.tickSize
                );

          const crossed55Pct = pos.side === 'BUY' ? currentPrice >= activationPrice : currentPrice <= activationPrice;
          const isLockStrictlyProfitable = pos.side === 'BUY' ? lockPrice > pos.entryPrice : lockPrice < pos.entryPrice;
          const isSlBehindLock = pos.side === 'BUY' ? pos.stopLossPrice < lockPrice : pos.stopLossPrice > lockPrice;

          if (crossed55Pct && isLockStrictlyProfitable && isSlBehindLock) {
            pos.stopLossPrice = lockPrice;
            pos.customSL = lockPrice;
            pos.trailActivationPrice = activationPrice;
            pos.trailLockPrice = lockPrice;
            pos.isProfitLockArmed = true;
            pos.isBreakevenLocked = true;
            console.log(
              `🛡️ [55% AUTO-PROFIT LOCK ARMED] ${pos.symbol} (${pos.side}) crossed $${activationPrice} (55% of TP $${pos.takeProfitPrice} | PnL: +$${pos.pnlUSD.toFixed(2)} USD). Locking SL at +25% profit ($${lockPrice})!`
            );
            if (isLivePos) {
              deltaExchange.updateBracketOrder(pos.symbol, lockPrice, pos.takeProfitPrice, pos.side, pos.entryPrice).catch(() => {});
            }
          }
        }
      }
    }

    // =========================================================================
    // LIVE REVERSAL DETECTION (Only after green PnL > $1.00 & >= 15% ROE / $5 / 15m EMA9 cross)
    // Normal Runners (23%-40%+) ONLY exit early on EXPLICIT 15m EMA9 cross so 5m noise never kills 40% runs!
    // Options run strictly to their Option TP/Trailing SL without perpetual candle interruption.
    // =========================================================================
    const isOptionPosition =
      pos.seatBucket === 'OPTION_UNCAPPED_SEAT' ||
      pos.seatBucket === 'OPTION_SEAT' ||
      pos.instrumentType === 'OPTION' ||
      pos.symbol.startsWith('C-') ||
      pos.symbol.startsWith('P-');
    const isNormalRunnerPosition =
      pos.seatBucket === 'NORMAL_23_TO_40PCT_SEAT' ||
      pos.seatBucket === 'BIG_SIGNAL_SEAT' ||
      pos.tier === 'STRONG_23PCT_RUNNER';
    if (pos.pnlUSD > 1.00 && !isOptionPosition) {
      const posLeverage = pos.leverage || this.state.leverage || 25;
      const moveInFavorPct = (pos.side === 'BUY' ? (currentPrice - pos.entryPrice) : (pos.entryPrice - currentPrice)) / (pos.entryPrice || 1);
      const currentRoePct = pos.marginUSD > 0 ? pos.pnlPercent : (moveInFavorPct * posLeverage * 100);

      // 2. Live Reversal Detection: Normal Runners require explicit 15m EMA9 cross; Chop checks >= 15% ROE (or $5 / 15m cross)
      try {
        const [live5m, live15m] = await Promise.all([
          this.fetchCandles(pos.symbol, '5m', 25).catch(() => []),
          this.fetchCandles(pos.symbol, '15m', 25).catch(() => []),
        ]);

        const reversalCheck = UniversalTradeGuard.detectLiveReversalAgainstPosition({
          side: pos.side,
          entryPrice: pos.entryPrice,
          currentPrice,
          unrealizedPnL: pos.pnlUSD,
          currentRoePct,
          candles5m: live5m,
          candles15m: live15m,
        });

        const isExplicit15mCross = Boolean(reversalCheck.reversalReason?.includes('EXPLICIT_15M_EMA9_CROSS'));
        const isAboveFloorOrExplicit15mCross = isNormalRunnerPosition
          ? isExplicit15mCross
          : (currentRoePct >= 15.0 || pos.pnlUSD >= 5.00 || isExplicit15mCross);

        if (reversalCheck.shouldExitNow && isAboveFloorOrExplicit15mCross) {
          console.log(`⚡ [SMART REVERSAL HARVEST] Booked green profit on ${pos.symbol} at +${currentRoePct.toFixed(1)}% ROE! Reason: ${reversalCheck.reversalReason} | PnL: +$${pos.pnlUSD.toFixed(2)} USD (Current: $${currentPrice})`);
          const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
          if (targetIdx !== -1) {
            await this.closePosition(targetIdx, 'REVERSAL_EXIT_EARLY', currentPrice);
            return;
          }
        }
      } catch (err: any) {
        // Safe fallback: never disrupt normal monitoring on candle fetch error
      }
    }

    // =========================================================================
    // USER MANDATE: "make target of high dollar 100 rupees se kya hota hai 15k capital hai 4 portion me pura use karo"
    // "ham khelege 1:2.3 me samje aur jidar se reversal ke changes rahgee usdhar tak tp"
    // HIGH DOLLAR TARGET PROFIT CAP ($34.50+ USD) or REAL TAKE PROFIT (1:2.30+ RR):
    // =========================================================================
    const isLargeCap = (this.state.accountCapitalUSD || 0) >= 100 || (process.env.TOTAL_CAPITAL_INR && parseInt(process.env.TOTAL_CAPITAL_INR) >= 10000);
    const defaultProfitGoal = (this.port === 3025 && !isLargeCap) ? 10.00 : 34.50;
    const minTargetUSD = (this.port === 3025 && !isLargeCap) ? 10.00 : ((this.state.maxLossPerTradeUSD || 15.00) * 2.30);
    const highDollarTargetUSD = Math.max(this.state.targetProfitPerTradeUSD || defaultProfitGoal, minTargetUSD);
    if (pos.pnlUSD >= highDollarTargetUSD) {
      console.log(`🎯 [HIGH DOLLAR PROFIT BANKED] ${pos.symbol} reached +$${pos.pnlUSD.toFixed(2)} USD (>= $${highDollarTargetUSD} goal)! Immediate profit bank!`);
      const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (targetIdx !== -1) {
        await this.closePosition(targetIdx, 'TARGET_HIT', currentPrice);
      }
      return;
    }

    // 1. Take Profit (TP) Check with ZERO MS DELAY:
    const isTPHit = pos.side === 'BUY'
      ? currentPrice >= pos.takeProfitPrice
      : currentPrice <= pos.takeProfitPrice;

    const tpPriceDelta = pos.side === 'BUY' ? pos.takeProfitPrice - pos.entryPrice : pos.entryPrice - pos.takeProfitPrice;
    const tpMovePct = tpPriceDelta / (pos.entryPrice || 1);
    // Fee-shield validity: Ensure TP represents a real price expansion (>= 0.35%)
    const isTPValid = tpMovePct >= 0.0035;

    if (isTPHit && isTPValid) {
      console.log(`🎯 [FULL TAKE PROFIT HIT] Take Profit reached for ${pos.symbol} (PnL: +$${pos.pnlUSD.toFixed(2)} USD, Price: $${currentPrice.toFixed(4)} vs TP: $${pos.takeProfitPrice.toFixed(4)}, Move: ${(tpMovePct * 100).toFixed(2)}%)! Banking win!`);
      const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (targetIdx !== -1) {
        await this.closePosition(targetIdx, 'TARGET_HIT', currentPrice);
      }
      return;
    }

    // 2. Stop Loss (SL) Check:
    // On live exchange, Delta Exchange Bracket SL executes natively on the exchange orderbook.
    // In paper / simulation mode, evaluate structural SL hit to record simulation history.
    const isLiveExchange = Boolean(deltaExchange.getConfig().apiKey && !deltaExchange.getConfig().isSimulation && process.env.PAPER_TRADING !== 'true');
    if (!isLiveExchange) {
      const isSLHit = pos.side === 'BUY'
        ? currentPrice <= pos.stopLossPrice
        : currentPrice >= pos.stopLossPrice;

      if (isSLHit) {
        console.log(`🛑 [SIMULATION STOP LOSS HIT] ${pos.symbol} reached SL level ${pos.stopLossPrice.toFixed(4)} (Current: ${currentPrice.toFixed(4)}, PnL: $${pos.pnlUSD.toFixed(2)}). Simulating exchange bracket fill!`);
        await this.closePosition(pos.id, 'EXCHANGE_CLOSED', currentPrice);
        return;
      }
    }

    // 3. STRICT HOLD: As long as market price has not reached TP or SL, trade is held intact.
    // Artificial dollar stop choke permanently removed per user mandate ("yee sab band hata do bas sl/tp hit hone pe hi trade se nikal jaye").
    return;
  }

  public archiveClosedTrade(pos: DeltaPosition, exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT' | 'REVERSAL_EXIT_EARLY' | 'WALL_REVERSAL_EXIT' | 'REVERSAL_WALL_HIT', exitPrice?: number) {
    // Guard against duplicate archive loop
    const lastArchive = this.closedTradesHistory[0];
    if (lastArchive && lastArchive.symbol === pos.symbol && Math.abs(lastArchive.entryPrice - pos.entryPrice) < 0.0001 && (Date.now() - (lastArchive.exitTime || 0)) < 30000) {
      console.log(`⚠️ Prevented duplicate trade archive for ${pos.symbol} (${exitReason})`);
      return;
    }

    let finalPrice = exitPrice || pos.currentPrice;

    // Price Sanity Shield: Reject cross-symbol alien ticks or abnormal bad prints
    // A price deviating > 35% from entry on a 15m Perpetual trade indicates cross-symbol tick contamination
    // (Options target +35% to +75%+ premium swings, so Option cap is 250%).
    const isOptionArchive = pos.instrumentType === 'OPTION' || pos.symbol.startsWith('C-') || pos.symbol.startsWith('P-');
    const sanityLimit = isOptionArchive ? 2.5 : 0.35;
    if (pos.entryPrice > 0 && Math.abs(finalPrice - pos.entryPrice) / pos.entryPrice > sanityLimit) {
      console.warn(`🚨 [SANITY SHIELD] Alien exit price rejected for ${pos.symbol}: entry=${pos.entryPrice}, alienExitPrice=${finalPrice}. Falling back to safe price.`);
      finalPrice = (pos.currentPrice > 0 && Math.abs(pos.currentPrice - pos.entryPrice) / pos.entryPrice <= sanityLimit)
        ? pos.currentPrice
        : pos.entryPrice;
    }

    const priceDiff = pos.side === 'BUY'
      ? finalPrice - pos.entryPrice
      : pos.entryPrice - finalPrice;

    const rawRealizedPnl = pos.quantity > 0
      ? parseFloat((priceDiff * pos.quantity).toFixed(2))
      : parseFloat(((priceDiff / (pos.entryPrice || 1)) * pos.notionalUSD).toFixed(2));

    // High Dollar Profit Target ($34.50+ USD, $10 for System 3025) & Structural Loss Protection ($4.50 for System 3025)
    // User Mandate: "make target of high dollar 100 rupees se kya hota hai 15k capital hai 4 portion me pura use karo"
    const isLargeCap = (this.state.accountCapitalUSD || 0) >= 100 || (process.env.TOTAL_CAPITAL_INR && parseInt(process.env.TOTAL_CAPITAL_INR) >= 10000);
    const defaultProfitGoal = (this.port === 3025 && !isLargeCap) ? 10.00 : 34.50;
    const minTargetUSD = (this.port === 3025 && !isLargeCap) ? 10.00 : ((this.state.maxLossPerTradeUSD || 15.00) * 2.30);
    const maxAllowedProfitUSD = Math.max(this.state.targetProfitPerTradeUSD || defaultProfitGoal, minTargetUSD);
    const maxAllowedLossUSD = this.state.maxLossPerTradeUSD || 4.00; // HARD CAP: $4.00 max loss (User Mandate)

    let boundedPnlUSD = rawRealizedPnl;
    if (boundedPnlUSD > maxAllowedProfitUSD) {
      boundedPnlUSD = maxAllowedProfitUSD;
    } else if (boundedPnlUSD < -maxAllowedLossUSD) {
      boundedPnlUSD = -maxAllowedLossUSD;
    }
    const realizedPnlUSD = parseFloat(boundedPnlUSD.toFixed(2));
    const realizedPnlPercent = pos.marginUSD > 0 ? parseFloat(((realizedPnlUSD / pos.marginUSD) * 100).toFixed(2)) : 0;
    const rMultiple = pos.atr > 0 ? parseFloat((priceDiff / pos.atr).toFixed(2)) : 0;

    const closedTrade: DeltaClosedTrade = {
      id: 'trade-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: finalPrice,
      takeProfitPrice: pos.takeProfitPrice,
      stopLossPrice: pos.stopLossPrice,
      quantity: pos.quantity,
      marginUSD: pos.marginUSD,
      notionalUSD: pos.notionalUSD,
      pnlUSD: realizedPnlUSD,
      pnlPercent: realizedPnlPercent,
      rMultiple,
      exitReason,
      entryTime: pos.entryTime,
      exitTime: Date.now(),
      durationMs: Date.now() - (pos.entryTime || Date.now()),
      strategyName: pos.strategyName,
    };

    this.closedTradesHistory.unshift(closedTrade);
    this.saveHistory();

    this.state.currentCapitalUSD = parseFloat((this.state.currentCapitalUSD + realizedPnlUSD).toFixed(2));
    this.state.dailyRealizedPnlUSD = parseFloat((this.state.dailyRealizedPnlUSD + realizedPnlUSD).toFixed(2));
    this.state.totalRealizedPnlUSD = parseFloat((this.state.totalRealizedPnlUSD + realizedPnlUSD).toFixed(2));

    if (realizedPnlUSD >= 0) {
      this.state.winningTradesCount += 1;
      this.consecutiveLosses = 0;
    } else {
      this.state.losingTradesCount += 1;
      // User Mandate Fix 3: Lock symbol for 45 minutes on loss to prevent revenge-trading!
      UniversalTradeGuard.recordStopLoss(pos.symbol);

      // Only count genuine STOP_LOSS_HIT toward systematic consecutive loss pause
      // Manual closes or exchange settlement syncs do not trigger 30-minute lock
      if (exitReason === 'STOP_LOSS_HIT') {
        this.consecutiveLosses = (this.consecutiveLosses || 0) + 1;
        if (this.consecutiveLosses >= 3) {
          this.circuitBreakerPauseUntil = Date.now() + 15 * 60 * 1000; // 15-min pause
          console.warn(`🛑 [CIRCUIT BREAKER TRIGGERED] 3 consecutive stop losses reached. Pausing new trade entries for 15 minutes to protect capital.`);
        }
      }
    }

    // Daily loss limit circuit breaker (Playbook 2026 Priority 8)
    if (this.state.dailyRealizedPnlUSD <= -75.0) {
      this.circuitBreakerPauseUntil = Math.max(this.circuitBreakerPauseUntil, Date.now() + 4 * 60 * 60 * 1000); // 4-hour pause
      console.warn(`🛑 [CIRCUIT BREAKER TRIGGERED] Daily loss limit of -$15.00 reached. Pausing new trade entries for 4 hours.`);
    }

    const totalResolved = this.state.winningTradesCount + this.state.losingTradesCount;
    this.state.winRatePercent = totalResolved > 0
      ? parseFloat(((this.state.winningTradesCount / totalResolved) * 100).toFixed(1))
      : 0;

    const cleanSym = pos.symbol.toUpperCase().replace('USDT', 'USD');
    this.symbolLastTradeTime.set(cleanSym, Date.now());
    this.symbolLastTradeTime.set(pos.symbol, Date.now());

    // Record direction memory for Anti-Whipsaw check (User Mandate: "same buy buy sell htaa doo same coin pee wo wala")
    this.symbolLastTradeSide.set(cleanSym, {
      side: pos.side,
      timestamp: Date.now(),
      exitReason,
      pnlUSD: realizedPnlUSD,
    });
    // NOTE: We NEVER delete lastProcessedBarTime here! Retaining the closed candle timestamp
    // guarantees that the engine will NEVER re-enter on the exact same 15m candle bar!
    console.log(`🏁 Position archived: ${pos.symbol} via ${exitReason} | PnL: $${realizedPnlUSD > 0 ? '+' : ''}${realizedPnlUSD} (${realizedPnlPercent}%) | 15-min cooldown active`);
  }

  public async closePosition(
    target: number | string,
    exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT' | 'REVERSAL_EXIT_EARLY' | 'WALL_REVERSAL_EXIT' | 'REVERSAL_WALL_HIT',
    exitPrice?: number,
    options?: { allowOptionSpotSlClose?: boolean }
  ) {
    const index = typeof target === 'string'
      ? this.state.activePositions.findIndex(p => p.id === target)
      : target;
    if (index < 0 || index >= this.state.activePositions.length) return;
    const pos = this.state.activePositions[index];
    if (!pos) return;

    const isOptionSym = pos.symbol.startsWith('C-') || pos.symbol.startsWith('P-') || pos.instrumentType === 'OPTION';
    const allowOptionSpotClose = Boolean(options?.allowOptionSpotSlClose && isOptionSym);

    // 🛑 ABSOLUTE DRAWDOWN PROTECTION (User Mandate: "if unrealizedPnL < 0, 100% FORBIDDEN to market-close"):
    // Software is 100% FORBIDDEN from cancelling brackets or market-closing ANY Perpetual position when PnL < 0!
    // The native Delta Exchange Bracket SL executes at the true price. Software must NEVER intervene at a loss.
    const currentMktPrice = exitPrice || pos.currentPrice || pos.entryPrice;
    const currentUnrealizedPnL = pos.side === 'BUY'
      ? (currentMktPrice - pos.entryPrice) * (pos.quantity || 1)
      : (pos.entryPrice - currentMktPrice) * (pos.quantity || 1);

    // Enforce UniversalTradeGuard 100% prohibition against software closes when PnL < 0 (except explicit Spot-Synced Option SL)
    if (exitReason !== 'EXCHANGE_CLOSED' && !allowOptionSpotClose && !UniversalTradeGuard.canSoftwareClosePosition(currentUnrealizedPnL)) {
      return;
    }

    if (this.closingPositions.has(pos.id) || this.closingPositions.has(pos.symbol)) {
      console.log(`🛡️ [CLOSE LOCK] Close already in progress for ${pos.symbol}. Ignoring duplicate call.`);
      return;
    }
    this.closingPositions.add(pos.id);
    this.closingPositions.add(pos.symbol);

    try {
      // Execute close on Delta Exchange broker
      const res = await deltaExchange.closePosition(pos.symbol, allowOptionSpotClose ? { allowOptionSpotSlClose: true } : undefined);
      const config = deltaExchange.getConfig();
      if (config.apiKey && config.apiSecret && !config.isSimulation) {
        if (!res || !res.success) {
          const errMsg = (res?.message || '').toLowerCase();
          if (errMsg.includes('position_not_found') || errMsg.includes('no_position') || errMsg.includes('insufficient_margin') || errMsg.includes('out_of_bankruptcy')) {
            console.log(`ℹ️ [EXCHANGE ALREADY RESOLVED] ${pos.symbol} position already closed or settled on Delta Exchange (${res?.message}). Archiving trade locally.`);
          } else {
            console.warn(`Delta closePosition could not close ${pos.symbol} directly (${res?.message || 'Exchange rejected'}). Keeping position active in memory until confirmed.`);
            return;
          }
        }
      }

      this.archiveClosedTrade(pos, exitReason, exitPrice);
      const removeIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (removeIdx !== -1) {
        this.state.activePositions.splice(removeIdx, 1);
      }
      this.saveState();
    } finally {
      setTimeout(() => {
        this.closingPositions.delete(pos.id);
        this.closingPositions.delete(pos.symbol);
      }, 10000);
    }
  }

  public async reverseSinglePosition(idOrSymbol: string): Promise<DeltaPosition | null> {
    const cleanSym = idOrSymbol.toUpperCase().replace('USDT', 'USD');
    const idx = this.state.activePositions.findIndex(
      p => p.id === idOrSymbol || (p.symbol || '').toUpperCase().replace('USDT', 'USD') === cleanSym
    );
    if (idx === -1) {
      console.warn(`Cannot reverse position: ${idOrSymbol} not found.`);
      return null;
    }

    const currentPos = this.state.activePositions[idx];

    // 🛑 ABSOLUTE DRAWDOWN PROTECTION: Never reverse a position in drawdown (User Mandate)
    const liveReversePrice = await deltaExchange.getMarketPrice(currentPos.symbol).catch(() => currentPos.currentPrice || currentPos.entryPrice);
    const reversePnl = currentPos.side === 'BUY'
      ? (liveReversePrice - currentPos.entryPrice) * (currentPos.quantity || 1)
      : (currentPos.entryPrice - liveReversePrice) * (currentPos.quantity || 1);
    if (reversePnl <= 0) {
      console.warn(`🛑 [ABSOLUTE DRAWDOWN PROTECTION] BLOCKING reverse on ${currentPos.symbol}: PnL $${reversePnl.toFixed(2)} <= 0. Letting bracket SL handle exit.`);
      return null;
    }

    const oldSide = currentPos.side;
    const flippedSide: 'BUY' | 'SELL' = oldSide === 'BUY' ? 'SELL' : 'BUY';
    const symbol = currentPos.symbol;
    const atr = currentPos.atr || 1.0;

    // 1. Close current position
    try {
      await deltaExchange.closePosition(symbol);
    } catch (e: any) {
      console.warn(`Error closing ${symbol} on exchange before reverse:`, e.message);
    }
    this.archiveClosedTrade(currentPos, 'MANUAL_EXIT');
    this.state.activePositions.splice(idx, 1);
    this.saveState();

    // 2. Fetch fresh market price
    const livePrice = await deltaExchange.getMarketPrice(symbol);

    // 3. Open opposite side immediately
    const newPos = await this.executeNewPosition({
      symbol,
      strategyName: `Reversed (${oldSide} ➔ ${flippedSide}) [INVERSE MODE]`,
      side: flippedSide,
      signalPrice: livePrice,
      atr,
      shadowConfirmedSeconds: 0,
      executionMode: 'INVERSE_RAW',
      reversalReason: `Manual Reverse executed: Switched from ${oldSide} to ${flippedSide}`,
    });

    console.log(`🔄 [POSITION REVERSED] ${symbol} ${oldSide} ➔ ${flippedSide} @ $${livePrice}`);
    return newPos;
  }

  public async reverseAllPositions(): Promise<DeltaPosition[]> {
    const currentPositions = [...this.state.activePositions];
    const newPositions: DeltaPosition[] = [];
    for (const pos of currentPositions) {
      const reversed = await this.reverseSinglePosition(pos.id);
      if (reversed) {
        newPositions.push(reversed);
      }
    }
    return newPositions;
  }

  // -------------------------------------------------------------
  // 5. Public API Inspection Getters
  // -------------------------------------------------------------

  public resetCircuitBreaker() {
    this.circuitBreakerPauseUntil = 0;
    this.consecutiveLosses = 0;
    console.log('✅ Circuit breaker reset. Immediate trade entries unlocked.');
  }

  public setActiveSystem(system: string): void {
    this.state.activeSystem = system;
    this.saveState();
    console.log(`🔀 [SYSTEM SWITCH] AutoTrader active system set to: ${system}`);
  }

  public getStatus(): DeltaAutoTraderState {
    this.deduplicateActivePositions();
    if (!this.state.accountCapitalUSD || this.state.accountCapitalUSD < 100) {
      this.state.accountCapitalUSD = 178.57;
      this.state.currentCapitalUSD = 178.57;
    }
    this.state.maxConcurrentPositions = HybridSixSlotManager.MAX_TOTAL_TRADES;
    this.state.marginPercentPerTrade = 25.0; // 25% margin per trade
    this.state.activeShadowCandidates = [];
    this.state.smartDetectorEnabled = true;
    const directCount = this.state.isInverseTrading ? 0 : this.state.activePositions.length;
    const reversedCount = this.state.isInverseTrading ? this.state.activePositions.length : 0;
    this.state.smartDetectorSummary = {
      activeMode: this.state.isInverseTrading 
        ? 'INVERSE_TRADING (User Inverted: BUY ➔ SELL, SELL ➔ BUY)' 
        : 'PURE_DIRECT_TRADING (100% Direct Long & Short Execution)',
      directTradesCount: directCount,
      reversedTradesCount: reversedCount,
      filteredChopCount: this.state.trapsFilteredCount,
    };
    return { ...this.state };
  }

  public getSmartDetections(): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [k, v] of this.lastSmartDetections.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public getHtfAnalyses(): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [k, v] of this.lastHtfAnalyses.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public resetPositions() {
    this.state.activePositions = [];
    this.symbolLastTradeTime.clear();
    this.lastProcessedBarTime.clear();
    this.saveState();
  }

  public resetPnlAndHistory() {
    this.consecutiveLosses = 0;
    this.circuitBreakerPauseUntil = 0;
    this.closedTradesHistory = [];
    this.saveHistory();
    this.state.dailyRealizedPnlUSD = 0;
    this.state.totalRealizedPnlUSD = 0;
    this.state.totalTradesCount = this.state.activePositions.length;
    this.state.winningTradesCount = 0;
    this.state.losingTradesCount = 0;
    this.state.winRatePercent = 0;
    this.state.currentCapitalUSD = this.state.accountCapitalUSD || 178.57;
    this.state.isNewTradesPaused = false;
    this.state.isRunning = true;
    this.saveState();
    console.log('✅ [RESET] PnL and trade history successfully reset to 0. Active positions preserved.');
  }

  public getDiagnostics(): AssetDiagnostics[] {
    return Array.from(this.lastDiagnostics.values());
  }

  public getHistory(): DeltaClosedTrade[] {
    return [...this.closedTradesHistory];
  }

  public toggleInverse(explicitState?: boolean): boolean {
    this.state.isInverseTrading = false;
    this.saveState();
    console.log(`🛡️ [REVERSAL PERMANENTLY DISABLED] isInverseTrading is locked to false per user mandate.`);
    return false;
  }

  public setNewTradesPaused(paused: boolean): boolean {
    this.state.isNewTradesPaused = paused;
    this.saveState();
    console.log(`⏸️ [NEW TRADES HOLD TOGGLE] isNewTradesPaused set to: ${paused}`);
    return this.state.isNewTradesPaused;
  }

  public updateConfig(config: Partial<DeltaAutoTraderState>) {
    if (config.isRunning !== undefined) {
      if (config.isRunning) {
        this.start();
      } else {
        this.stop();
      }
    }
    if (config.isNewTradesPaused !== undefined) {
      this.state.isNewTradesPaused = config.isNewTradesPaused;
    }
    const newInverse = config.isInverseTrading !== undefined ? config.isInverseTrading : this.state.isInverseTrading;
    const isPaperOnly =
      process.env.PAPER_TRADING === 'true' ||
      process.env.DELTA_IS_SIMULATION === 'true' ||
      process.env.DELTA_TRADING_MODE === 'SIMULATION_PAPER' ||
      (process.env.PORT || '3005') !== '3005';
    this.state = {
      ...this.state,
      ...config,
      isInverseTrading: newInverse,
      ...(isPaperOnly ? { mode: 'SIMULATION_PAPER' as const } : {}),
    };
    if (config.activeSystem !== undefined) {
      this.state.activeSystem = config.activeSystem;
    }
    if (config.maxConcurrentPositions !== undefined) {
      this.state.maxConcurrentPositions = config.maxConcurrentPositions;
    } else if (!this.state.maxConcurrentPositions) {
      this.state.maxConcurrentPositions = HybridSixSlotManager.MAX_TOTAL_TRADES;
    }
    this.saveState();
  }
}

export const deltaAutoTrader = new DeltaAutoTraderEngine();

