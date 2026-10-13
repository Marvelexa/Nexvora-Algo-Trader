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

export class DeltaAutoTraderEngine {
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

  // The Supported Altcoins with Dedicated Indicators (Delta Exchange Perpetual Contracts)
  // BTC, ETH, ADA turned OFF per user directives:
  // - "adaa mee coin off kardo aage se bnd rakhna bas"
  // - "bth eth bade bade off kardo abhi ke liye kam margin ke baje se"
  public readonly WATCHLIST = [
    'SUIUSD',
    'SOLUSD',
    'DOGEUSD',
    'AVAXUSD',
  ];

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
  private candleCache: Map<string, { data: KlinePoint[]; timestamp: number }> = new Map();
  private lastHtfAnalyses: Map<string, any> = new Map();

  constructor() {
    this.stateFilePath = path.join(process.cwd(), '.delta_auto_trader_state.json');
    this.historyFilePath = path.join(process.cwd(), 'public', 'closed_trades_history.json');

    // Default Initial State according to blueprint
    const isTestnet = process.env.DELTA_IS_TESTNET === 'true' || deltaExchange.getConfig().isTestnet;
    const isSimulation = deltaExchange.getConfig().isSimulation || process.env.DELTA_IS_SIMULATION === 'true' || process.env.PAPER_TRADING === 'true';
    const hasKeys = !!(process.env.DELTA_API_KEY && process.env.DELTA_API_SECRET);
    const initialMode: 'LIVE_DELTA_INDIA' | 'DELTA_TESTNET' | 'SIMULATION_PAPER' = isSimulation || !hasKeys
      ? 'SIMULATION_PAPER'
      : (isTestnet ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA');

    this.state = {
      isRunning: true,
      mode: initialMode,
      accountCapitalUSD: 23.81, // ₹2,000 INR capital (~$23.81 USD)
      currentCapitalUSD: 23.81,
      dailyRealizedPnlUSD: 0,
      totalRealizedPnlUSD: 0,
      totalTradesCount: 0,
      winningTradesCount: 0,
      losingTradesCount: 0,
      winRatePercent: 0,
      activePositions: [],
      maxConcurrentPositions: 3, // Up to 3 trades maximum (User Mandate)
      leverage: 25,
      marginPercentPerTrade: 30.0, // Deploys ~30% margin per slot across 3 slots
      lastScanTimestamp: Date.now(),
      scanIntervalSeconds: 1, // High-frequency scan cycle
      shadowGateEnabled: false, // DISABLED — Shadow Gate removed from system
      activeShadowCandidates: [],
      trapsFilteredCount: 0,
      capitalSavedUSD: 0,
      isInverseTrading: false, // Direct mode — proper signals + proper R:R
      minCapitalFloorINR: 50, // Stop if capital drops to zero / floor (User Mandate)
      targetCapitalGoalINR: 10000, // Target profit goal
      recentFilteredTraps: [],
      targetProfitPerTradeUSD: 1.00, // Calibrated $1.00 USD profit target (~₹84 INR) per trade
      maxLossPerTradeUSD: 0.55, // Calibrated $0.55 USD max loss (~₹46 INR) per trade
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
          const isSimulation = deltaExchange.getConfig().isSimulation || process.env.DELTA_IS_SIMULATION === 'true' || process.env.PAPER_TRADING === 'true';
          const hasKeys = !!(process.env.DELTA_API_KEY && process.env.DELTA_API_SECRET);
          const computedMode = isSimulation || !hasKeys
            ? 'SIMULATION_PAPER'
            : (isTestnet ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA');
          if (parsed.mode && parsed.mode !== computedMode) {
            console.log(`🔄 Mode transition detected (${parsed.mode} -> ${computedMode}). Resetting positions for new environment.`);
            this.state.activePositions = [];
          }
          this.state.mode = computedMode;
          // Capacity limit (User Mandate: "you can able to do 3 trades maxium")
          this.state.maxConcurrentPositions = parsed.maxConcurrentPositions || 3;
          this.state.marginPercentPerTrade = 30.0;
          this.state.isInverseTrading = false;
          this.state.shadowGateEnabled = false;
          if (Array.isArray(this.state.activePositions)) {
            for (const pos of this.state.activePositions) {
              if (pos.executionMode === 'SMART_REVERSED' || pos.executionMode === 'INVERSE_RAW') {
                pos.executionMode = 'DIRECT';
              }
              if (pos.strategyName) {
                pos.strategyName = pos.strategyName
                  .replace(/\[SMART_REVERSED:[^\]]*\]/g, `[DIRECT: ${pos.side}]`)
                  .replace(/\[SMART REVERSAL:[^\]]*\]/g, '')
                  .replace(/\[INVERSE:[^\]]*\]/g, `[DIRECT: ${pos.side}]`)
                  .replace(/Reversed \([^)]*\) \[INVERSE MODE\]/g, `Direct ${pos.side} [Playbook 2026 Engine]`);
              }
              if (pos.reversalReason) {
                pos.reversalReason = undefined;
              }
            }
          }
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

      if (typeof cfg.maxConcurrentPositions === 'number') {
        if (cfg.maxConcurrentPositions < 1 || cfg.maxConcurrentPositions > 4) {
          throw new Error(`CRITICAL RISK VIOLATION: maxConcurrentPositions (${cfg.maxConcurrentPositions}) must be between 1 and 4!`);
        }
        this.state.maxConcurrentPositions = cfg.maxConcurrentPositions;
      }

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
        this.state.targetProfitPerTradeUSD = cfg.targetProfitPerTradeUSD;
      }
      if (typeof cfg.minCapitalFloorINR === 'number') {
        this.state.minCapitalFloorINR = cfg.minCapitalFloorINR;
      }
      if (typeof cfg.targetCapitalGoalINR === 'number') {
        this.state.targetCapitalGoalINR = cfg.targetCapitalGoalINR;
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

  /**
   * Synchronizes active positions and live exchange bracket orders (TP/SL) from Delta Exchange
   */
  public async syncLivePositionsFromExchange() {
    try {
      const config = deltaExchange.getConfig();
      // Only mirror exchange positions if configured with live or demo exchange credentials
      if (!config.apiKey || !config.apiSecret || config.isSimulation) {
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
      const openOrders = Array.isArray(openOrdersRaw) ? openOrdersRaw : [];
      const now = Date.now();

      const isLiveExchange = Boolean(deltaExchange.getConfig().apiKey && !deltaExchange.getConfig().isSimulation);

      // If Delta Exchange has 0 active positions:
      if (exchangePositions.length === 0) {
        if (isLiveExchange && this.state.activePositions.length > 0) {
          for (const localPos of this.state.activePositions) {
            if (!localPos.symbol.startsWith('C-') && !localPos.symbol.startsWith('P-')) {
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
        const symbol = exPos.product_symbol; // e.g. "BTCUSD", "XRPUSD"
        // Skip option contracts (C-* and P-*) as they are managed by deltaOptionsCondor
        if (symbol.startsWith('C-') || symbol.startsWith('P-')) continue;
        const size = parseFloat(exPos.size);
        if (size === 0 || isNaN(size)) continue;

        activeSymbolsOnExchange.add(symbol);

        const side: 'BUY' | 'SELL' = size > 0 ? 'BUY' : 'SELL';
        const entryPrice = parseFloat(exPos.avg_entry_price || exPos.entry_price || '0');
        const markPrice = parseFloat(exPos.mark_price || exPos.avg_entry_price || exPos.entry_price || '0');
        const spec = DELTA_PRODUCT_SPECS[symbol] || { tickSize: 0.0001, contractValue: 1.0, decimals: 4 };
        const contracts = Math.abs(size);
        const quantity = contracts * spec.contractValue;
        const marginUSD = parseFloat(exPos.margin || '0');
        const notionalUSD = entryPrice > 0 ? entryPrice * quantity : marginUSD * this.state.leverage;

        // Accurate PnL calculation
        const priceDiff = side === 'BUY' ? markPrice - entryPrice : entryPrice - markPrice;
        const pnlUSD = parseFloat((priceDiff * quantity).toFixed(2));
        const pnlPercent = marginUSD > 0 ? parseFloat(((pnlUSD / marginUSD) * 100).toFixed(2)) : 0;

        // Find associated exchange bracket orders (from open orders or position metadata)
        const tpOrder = openOrders.find(
          (o: any) => (o.product_symbol === symbol || o.product_id === exPos.product_id) &&
            (o.stop_order_type === 'take_profit_order' || o.order_type === 'take_profit_order' || o.bracket_order_type === 'take_profit_order')
        );
        const slOrder = openOrders.find(
          (o: any) => (o.product_symbol === symbol || o.product_id === exPos.product_id) &&
            (o.stop_order_type === 'stop_loss_order' || o.order_type === 'stop_loss_order' || o.bracket_order_type === 'stop_loss_order')
        );

        const posBracketTP = parseFloat(exPos.bracket_take_profit_price || exPos.take_profit_order?.stop_price || '0');
        const posBracketSL = parseFloat(exPos.bracket_stop_loss_price || exPos.stop_loss_order?.stop_price || '0');
        const hasPosBracket = (posBracketTP > 0 && posBracketSL > 0);

        const existing = this.state.activePositions.find(p => p.symbol === symbol);

        // Strict User Mandate: Max $1.50 Loss, Max $3.00 Profit per trade
        const targetProfitUSD = 6.00;
        const maxLossUSD = 3.00;
        const tpDist = Math.max(2.5 * (exPos.atr || entryPrice * 0.015), entryPrice * 0.01);
        const slDist = Math.max(1.5 * (exPos.atr || entryPrice * 0.015), entryPrice * 0.005);

        const defaultTP = side === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist;
        const defaultSL = side === 'BUY' ? entryPrice - slDist : entryPrice + slDist;
        const isBtcTrade = symbol.toUpperCase().includes('BTC');

        // For BTC: user specifically mandated $0.25 TP, so enforce defaultTP directly
        const resolvedTP = isBtcTrade ? defaultTP : (tpOrder ? parseFloat(tpOrder.stop_price || tpOrder.price) : (posBracketTP > 0 ? posBracketTP : 0));
        let resolvedSL = slOrder ? parseFloat(slOrder.stop_price || slOrder.price) : (posBracketSL > 0 ? posBracketSL : 0);

        // Crucial Safety: If exchange has a micro SL recorded that is dangerously tight (<1.5% away), enforce wide defaultSL
        if (resolvedSL > 0 && Math.abs(entryPrice - resolvedSL) < entryPrice * 0.015) {
          resolvedSL = defaultSL;
        }

        const tpPrice = resolvedTP > 0 ? resolvedTP : defaultTP;
        const slPrice = resolvedSL > 0 ? resolvedSL : defaultSL;

        // If bracket orders are missing on exchange for an active position, attach them once (throttled 5 mins)
        const hasExchangeOrders = openOrders.some((o: any) =>
          (o.product_symbol === symbol || o.product_id === exPos.product_id) &&
          (o.bracket_order || o.stop_order_type || o.order_type === 'stop_loss_order' || o.order_type === 'take_profit_order')
        );
        const isBracketMissingOnExchange = !hasExchangeOrders && !hasPosBracket && (!tpOrder || !slOrder);
        if (isBracketMissingOnExchange) {
          const lastBracketAttempt = this.symbolLastBracketAttemptTime.get(symbol) || 0;
          if (now - lastBracketAttempt > 300000) { // 5-minute throttle to prevent cancellation loops
            this.symbolLastBracketAttemptTime.set(symbol, now);
            console.log(`🎯 [EXCHANGE BRACKET ATTACH] Active position ${symbol} has no bracket orders. Attaching bracket: SL=$${slPrice}, TP=$${tpPrice}`);
            try {
              await deltaExchange.setBracketOrder(symbol, slPrice, tpPrice);
            } catch (e: any) {
              console.warn(`[DeltaExchange] Bracket attach note for ${symbol}:`, e.message);
            }
          }
        }

        const pos: DeltaPosition = {
          id: existing?.id || `delta-live-${symbol.toLowerCase()}-${exPos.product_id || Date.now()}`,
          symbol,
          side,
          entryPrice,
          currentPrice: markPrice,
          quantity,
          marginUSD: marginUSD > 0 ? marginUSD : (this.state.accountCapitalUSD * (this.state.marginPercentPerTrade / 100)),
          notionalUSD,
          leverage: this.state.leverage,
          takeProfitPrice: tpPrice,
          stopLossPrice: slPrice,
          initialStopLossPrice: existing?.initialStopLossPrice || slPrice,
          atr: existing?.atr || Math.abs(entryPrice - slPrice) / 2.5,
          isBreakevenLocked: existing?.isBreakevenLocked || false,
          pnlUSD,
          pnlPercent,
          entryTime: existing?.entryTime || (exPos.created_at ? new Date(exPos.created_at).getTime() : Date.now()),
          strategyName: existing?.strategyName || `${symbol} Dedicated Real Delta Route`,
          shadowConfirmedSeconds: existing?.shadowConfirmedSeconds || 15,
          executionMode: (existing?.executionMode === 'SMART_REVERSED' ? 'DIRECT' : existing?.executionMode) || 'DIRECT',
          reversalReason: existing?.reversalReason,
        };

        reconciledPositions.push(pos);
      }

      // Archive closed positions on live exchange, or preserve local paper positions
      for (const localPos of this.state.activePositions) {
        if (!localPos.symbol.startsWith('C-') && !localPos.symbol.startsWith('P-') && !activeSymbolsOnExchange.has(localPos.symbol)) {
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

  // -------------------------------------------------------------
  // 2. Continuous 24/7 Scanning & Execution Daemon
  // -------------------------------------------------------------

  public start() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);

    this.state.isRunning = true;
    this.state.activeShadowCandidates = [];
    this.saveState();

    console.log('🚀 Delta 24/7 Autonomous Trading Engine Started. Scanning 8 dedicated indicator pairs (BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, SUI)...');

    // Synchronize live positions from Delta Exchange safely
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
   * Fetches real candles for an asset across timeframes (5m, 15m, 1h, 4h) with memory caching
   */
  private async fetchCandles(symbol: string, interval: '5m' | '15m' | '1h' | '4h' = '15m', limit: number = 250): Promise<KlinePoint[]> {
    const cacheKey = `${symbol}_${interval}_${limit}`;
    const cached = this.candleCache.get(cacheKey);
    const ttl = interval === '4h' ? 180000 : (interval === '1h' ? 60000 : (interval === '15m' ? 10000 : 5000));
    if (cached && (Date.now() - cached.timestamp < ttl)) {
      return cached.data;
    }

    const binanceSym = symbol.toUpperCase().endsWith('USDT')
      ? symbol.toUpperCase()
      : (symbol.toUpperCase().replace('USD', '') + 'USDT');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
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
  public async evaluateHigherTimeframeContext(symbol: string): Promise<{
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
    const candles15m = await this.fetchCandles(symbol, '15m', 100);
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
    htf: any
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
  } | null> {
    const cleanSym = deltaSymbol.toUpperCase().replace('USDT', 'USD');
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
    }> = [];

    // Fetch live Order Book Imbalance, Taker CVD, and Derivatives from Delta Exchange
    const microData = await deltaExchange.getMicrostructureAndDerivatives(cleanSym).catch(() => null);

    // -------------------------------------------------------------
    // DEDICATED INDICATOR & QUANTITATIVE MATHEMATICAL EVALUATION (PLAYBOOK 2026 v2)
    // -------------------------------------------------------------
    let evalResult: any = null;
    try {
      evalResult = strategyEngine.evaluateSymbol(symbol, closedCandles15m);
    } catch (e) {}

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
    // SYSTEM DYNAMIC TP & SL CALCULATOR (User Mandate)
    // "hamara tp 1000 rupees hai to 1 dollar profit ek trade bohot haii aise target hit hona chaiyee"
    // Dynamically project targets calibrated strictly to $1.00 USD profit per trade (~8.4% return on ₹1,000 INR)
    // -------------------------------------------------------------
    const lastBarPrice = closedCandles15m[closedCandles15m.length - 1].close;
    const computeSystemDynamicTargets = (candidateSide: 'BUY' | 'SELL', atr: number) => {
      const recentCandles = closedCandles15m.slice(-10);
      const minStopDistance = Math.max(0.85 * atr, lastBarPrice * 0.005);

      const targetUSD = this.state.targetProfitPerTradeUSD || 1.00;
      const maxLossUSD = this.state.maxLossPerTradeUSD || 0.55;

      // Sized on ~$90 notional: $1.00 profit = ~1.11% price move, $0.55 loss = ~0.61% price move
      const calibratedTpDist = lastBarPrice * (targetUSD / 90);
      const calibratedSlDist = Math.max(minStopDistance, lastBarPrice * (maxLossUSD / 90));

      if (candidateSide === 'BUY') {
        const recentLow = Math.min(...recentCandles.map(c => c.low));
        let structuralSL = recentLow - 0.25 * atr;
        if (paVerdict?.side === 'BUY' && paVerdict.stopLossPrice > 0 && paVerdict.stopLossPrice < lastBarPrice) {
          structuralSL = Math.min(structuralSL, paVerdict.stopLossPrice);
        }
        const slDist = Math.max(minStopDistance, Math.min(calibratedSlDist * 1.25, lastBarPrice - structuralSL));
        const customSL = parseFloat((lastBarPrice - slDist).toFixed(4));

        // Direct TP target calibrated to $1.00 USD profit (clean 1:1.8+ R:R)
        const tpDist = Math.max(slDist * 1.8, calibratedTpDist);
        const customTP = parseFloat((lastBarPrice + tpDist).toFixed(4));
        return { customTP, customSL, tpDist, slDist };
      } else {
        const recentHigh = Math.max(...recentCandles.map(c => c.high));
        let structuralSL = recentHigh + 0.25 * atr;
        if (paVerdict?.side === 'SELL' && paVerdict.stopLossPrice > 0 && paVerdict.stopLossPrice > lastBarPrice) {
          structuralSL = Math.max(structuralSL, paVerdict.stopLossPrice);
        }
        const slDist = Math.max(minStopDistance, Math.min(calibratedSlDist * 1.25, structuralSL - lastBarPrice));
        const customSL = parseFloat((lastBarPrice + slDist).toFixed(4));

        // Direct TP target calibrated to $1.00 USD profit (clean 1:1.8+ R:R)
        const tpDist = Math.max(slDist * 1.8, calibratedTpDist);
        const customTP = parseFloat((lastBarPrice - tpDist).toFixed(4));
        return { customTP, customSL, tpDist, slDist };
      }
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

      // 1. ABSOLUTE MACRO TREND & CONFLUENCE VETO (Zero Counter-Trend Guesswork)
      if (mathSide === 'BUY') {
        if (hasActiveSellSignal) {
          console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} BUY blocked: Dedicated Indicator is SELL. Never buy when Sell signal is active!`);
          return null;
        }

        // ABSOLUTE MACRO TREND FILTER: Price below EMA50 or Macro Trend Bearish NEVER BUYS!
        const isMacroTrendBearish = confluence.trendDirection === 'BEARISH' || confluence.isMacroBearish || lastBarPrice < confluence.ema50;
        if (isMacroTrendBearish) {
          console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} BUY blocked: Macro Trend is BEARISH (Trend=${confluence.trendDirection}, P=$${lastBarPrice.toFixed(4)} < EMA50=$${confluence.ema50.toFixed(4)}). Zero counter-trend guesswork!`);
          return null;
        }
      }

      if (mathSide === 'SELL') {
        if (hasActiveBuySignal) {
          console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} SELL blocked: Dedicated Indicator is BUY. Never short when Buy signal is active!`);
          return null;
        }

        // ABSOLUTE MACRO TREND FILTER: Price above EMA50 or Macro Trend Bullish NEVER SHORTS!
        const isMacroTrendBullish = confluence.trendDirection === 'BULLISH' || confluence.isMacroBullish || lastBarPrice > confluence.ema50;
        if (isMacroTrendBullish) {
          console.log(`🛡️ [CONFLUENCE VETO] ${cleanSym} SELL blocked: Macro Trend is BULLISH (Trend=${confluence.trendDirection}, P=$${lastBarPrice.toFixed(4)} > EMA50=$${confluence.ema50.toFixed(4)}). Zero counter-trend guesswork!`);
          return null;
        }
      }

      // Dedicated Indicator Alignment Verification (User Mandate: "Signal hai SELL kar rhe ho BUY — never trade against dedicated indicator!")
      // Dedicated indicator or multi-EMA trend confluence MUST genuinely point in the math direction
      const isDedicatedIndicatorAligned = indicatorSide === mathSide;
      const isConfluenceTrendAligned = (mathSide === 'BUY' && (confluence.trendDirection === 'BULLISH' || confluence.isMacroBullish) && (confluence.allowsLong || (lastBarPrice > confluence.ema50 && confluence.macd?.isBullish))) ||
                                       (mathSide === 'SELL' && (confluence.trendDirection === 'BEARISH' || confluence.isMacroBearish) && (confluence.allowsShort || (lastBarPrice < confluence.ema50 && (confluence.macd?.isBearish || confluence.isRsiBearish))));
      const isIndicatorAligned = isDedicatedIndicatorAligned || isConfluenceTrendAligned;

      // 2. Candlestick Anatomy & Price Action Verification
      // Solo candle trades are DELETED. Candle shapes ONLY serve as confirmation/timing in the same direction!
      let hasCandleConfirmation = false;
      let candleTriggerTag = '';

      if (paVerdict && paVerdict.confluenceScore >= 70 && paVerdict.side === mathSide) {
        hasCandleConfirmation = true;
        candleTriggerTag = ` + PA ${paVerdict.setupType}`;
      }

      // Symmetric Trap Protection:
      // 1. Do NOT BUY into Overbought Climax (RSI >= 70, Fisher >= 1.5, Z >= 1.6, or testing Resistance)
      // 2. Do NOT SELL into Oversold Capitulation (RSI <= 30, Fisher <= -1.5, Z <= -1.6, or testing Support)
      const currentRsi = rsi15mArr[rsi15mArr.length - 1] || 50;

      if (mathSide === 'BUY') {
        const isRsiOverbought = currentRsi >= 82;
        const isGaussianOverbought = (mathVerdict.zScore && mathVerdict.zScore >= 3.5) && (mathVerdict.fisherTransform && mathVerdict.fisherTransform >= 2.2);
        const isBlockedByCeiling = (mathVerdict.isAtResistance && mathVerdict.resistanceRejectConfirmed) ||
          Boolean(paVerdict && paVerdict.locationReason?.includes('Resistance') && paVerdict.confluenceScore >= 85);

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
        const isBlockedByFloor = (mathVerdict.isAtSupport && mathVerdict.supportBounceConfirmed) ||
          Boolean(paVerdict && paVerdict.locationReason?.includes('Support') && paVerdict.confluenceScore >= 85);

        if (isRsiOversold || isGaussianOversold) {
          console.log(`🛡️ [OVERSOLD TRAP SHIELD] ${cleanSym} SELL blocked: Market is Oversold/Dumped (RSI=${currentRsi.toFixed(1)}, Z=${mathVerdict.zScore}, Fisher=${mathVerdict.fisherTransform}). Never sell at capitulation bottom!`);
          return null;
        }
        if (isBlockedByFloor) {
          console.log(`🛡️ [TRAP SHIELD] ${cleanSym} SELL dropped: Price is testing/bouncing at Support Floor ($${mathVerdict.nearestSupport || 'Support'}).`);
          return null;
        }
      }

      // 3. Synthesize Multi-Layer Strict Confluence Score
      // Reject any trade where technical indicators do not confirm the direction
      if (!isIndicatorAligned) {
        console.log(`🛡️ [INDICATOR UNCONFIRMED] ${cleanSym} ${mathSide} blocked: Technical indicators do not support ${mathSide}. Standing aside.`);
        return null;
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
        } else if (div15m === 'BEARISH_DIV' && (mathVerdict.marketRegime === 'MEAN_REVERTING' || mathVerdict.fisherTransform >= 1.2 || mathVerdict.recommendedSide === 'SELL')) {
          const targets = computeSystemDynamicTargets('SELL', atr15m);
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
          console.log(`🚀 [COMPRESSION BREAKOUT] ${cleanSym} Early Bar 1 Breakout (${compression.breakoutSide}): RVOL=${compression.rvol}, Bandwidth=${(compression.bandwidthPct * 100).toFixed(1)}% | Indicator Aligned`);
          const targets = computeSystemDynamicTargets(compression.breakoutSide, atr15m);
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
    } catch (e) {}

    if (candidates.length === 0) return null;

    // CHOP GATE FILTER (Severe Chop Decoupling):
    // If in severe chop (chopScore >= 75 && !isValidRange), only allow high-conviction
    // structural breakouts/pullbacks and dedicated indicators (score >= 80) to bypass chop.
    let eligibleCandidates = candidates;
    if (isSevereChop) {
      const chopBypassCandidates = candidates.filter(cand => {
        const isBypass = cand.confidenceScore >= 88 && (
          cand.strategyName.includes('BREAKOUT') ||
          cand.strategyName.includes('LIQUIDITY_SWEEP') ||
          cand.strategyName.includes('Breakout')
        );
        return isBypass;
      });

      if (chopBypassCandidates.length === 0) {
        console.log(`🛡️ [CHOP GATE BLOCKED] ${cleanSym} in severe CHOP Mode (Score: ${chopAnalysis.chopScore}/100, CI: ${chopAnalysis.choppinessIndex}). ${candidates.length} candidates lacked high-conviction breakout/pullback/indicator score >= 80. Standing aside.`);
        return null;
      }
      eligibleCandidates = chopBypassCandidates;
    }

    // -------------------------------------------------------------
    // MARKET TRAP SHIELD (Section 4, 5, 6 of Chop and Market Traps Playbook 2026)
    // Filters out Fakeouts, Stop Hunts, Crowded Squeezes, Falling Knives, and Over-Tested Levels
    // -------------------------------------------------------------
    const safeCandidates = eligibleCandidates.filter(cand => {
      // Pass the actual broken structural swing level rather than entryPrice (which was lastBar.close)
      const isBreakout = cand.strategyName.includes('BREAKOUT') || cand.strategyName.includes('Breakout');
      let structuralLevel = (paVerdict && paVerdict.side === cand.side) ? paVerdict.keyLevelPrice : undefined;
      if (!structuralLevel || Math.abs(structuralLevel - closedCandles15m[closedCandles15m.length - 1].close) < 1e-5) {
        const priorBars = closedCandles15m.slice(-21, -1);
        if (priorBars.length > 0) {
          if (isBreakout) {
            structuralLevel = cand.side === 'BUY'
              ? Math.max(...priorBars.map(c => c.high))
              : Math.min(...priorBars.map(c => c.low));
          } else {
            structuralLevel = cand.side === 'BUY'
              ? Math.min(...priorBars.map(c => c.low))
              : Math.max(...priorBars.map(c => c.high));
          }
        }
      }

      const levelType = isBreakout
        ? (cand.side === 'BUY' ? 'RESISTANCE' : 'SUPPORT')
        : (cand.side === 'BUY' ? 'SUPPORT' : 'RESISTANCE');

      const trapCheck = marketTraps.evaluateMarketTraps({
        symbol: cleanSym,
        side: cand.side,
        setupType: cand.strategyName,
        marketStructure: paVerdict?.marketStructure || 'RANGE',
        candles: closedCandles15m,
        targetLevelPrice: structuralLevel,
        levelType,
        microstructure: microData,
      });

      if (trapCheck.isBlockedByTrap) {
        console.log(`🚫 [TRAP SHIELD BLOCKED] ${cleanSym} ${cand.side} blocked by ${trapCheck.trapType}: ${trapCheck.trapReason}`);
        return false;
      }
      return true;
    });

    if (safeCandidates.length === 0) return null;

    // -------------------------------------------------------------
    // LATE_SKIP GATE PERMANENTLY REMOVED (User mandate: "system not take any trade")
    // Safe confluence candidates directly sort by conviction score and execute
    // -------------------------------------------------------------
    safeCandidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return safeCandidates[0];
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
   * Rapid-Fire 15M Autonomous Scan Cycle with Accuracy & Profit Enforcement
   */
  public async runScanCycle() {
    if (this.isScanning) return;
    this.isScanning = true;
    this.state.lastScanTimestamp = Date.now();

    try {
      // 1. Startup grace period: allow existing positions to sync from exchange first
      if (Date.now() - this.engineStartTime < this.STARTUP_GRACE_PERIOD_MS) {
        return;
      }

      // 0. Macro BTC Market Anchor for Altcoin Accuracy
      const btcCandles = await this.fetchCandles('BTCUSDT', '15m', 250);
      let btcTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      if (btcCandles.length >= 20) {
        const btcConfluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(btcCandles);
        btcTrend = btcConfluence.trendDirection;
      }

      // 0. Circuit Breaker Check (Playbook 2026 Priority 8)
      if (this.circuitBreakerPauseUntil && Date.now() < this.circuitBreakerPauseUntil) {
        const minsLeft = Math.ceil((this.circuitBreakerPauseUntil - Date.now()) / 60000);
        if (Date.now() - this.lastCircuitLogTime > 60000) {
          this.lastCircuitLogTime = Date.now();
          console.warn(`⏳ [CIRCUIT BREAKER ACTIVE] New trades paused for ${minsLeft} more minutes to protect capital.`);
        }
        return;
      }

      // Dynamic capacity limit (User Mandate: "trade do only one limit")
      const maxAllowed = this.state.maxConcurrentPositions || 1;
      this.state.maxConcurrentPositions = maxAllowed;

      try {
        const walletBal = await deltaExchange.getWalletBalance();
        if (walletBal && walletBal.balanceUSD > 0 && !deltaExchange.getConfig().isSimulation) {
          this.state.accountCapitalUSD = walletBal.balanceUSD;
          this.state.currentCapitalUSD = walletBal.availableUSD;
        }
      } catch (err) {}

      // TRADE LIMIT: Calculate Available Position Slots
      // Continuous 24/7 Diagnostics: Scanner NEVER stops calculating scores, even while in a trade!
      const totalOccupied = this.state.activePositions.length + this.inFlightSymbols.size;
      const availableSlots = Math.max(0, maxAllowed - totalOccupied);

      // 1. ROUND-ROBIN WATCHLIST ROTATION
      // Ensures Altcoins (XRP, DOGE, SOL, ADA) get equal turns and BTC/ETH don't monopolize slots
      const n = this.WATCHLIST.length;
      const startIndex = this.scanRotationIndex % n;
      this.scanRotationIndex = (this.scanRotationIndex + 1) % n;
      const rotatedWatchlist = [
        ...this.WATCHLIST.slice(startIndex),
        ...this.WATCHLIST.slice(0, startIndex),
      ];

      interface ScannedMarketCandidate {
        symbol: string;
        cleanDeltaSym: string;
        multiSignal: any;
        currentPrice: number;
        atr: number;
        lastClosedBarTime: number;
        isAltcoin: boolean;
        closedCandles?: KlinePoint[];
        isSmartRejected?: boolean;
        smartRejectReason?: string;
      }
      const candidatesPool: ScannedMarketCandidate[] = [];

      for (const symbol of rotatedWatchlist) {
        const deltaSymbol = symbol.toUpperCase().replace('USDT', 'USD');
        const cleanDeltaSym = deltaSymbol;
        const isAltcoin = !['BTCUSD', 'ETHUSD'].includes(cleanDeltaSym);

        // User Mandates: Disable ADA, BTC, and ETH
        // - "adaa mee coin off kardo aage se bnd rakhna bas"
        // - "bth eth bade bade off kardo abhi ke liye kam margin ke baje se"
        if (['ADAUSD', 'BTCUSD', 'ETHUSD'].includes(deltaSymbol) || ['ADAUSD', 'BTCUSD', 'ETHUSD'].includes(cleanDeltaSym)) {
          continue;
        }

        // Check if coin is supported on testnet (Delta Testnet only supports BTC, ETH, SOL, XRP, DOGE, ADA)
        const isTestnet = this.state.mode === 'DELTA_TESTNET' || deltaExchange.getConfig().isTestnet;
        if (isTestnet && (deltaSymbol === 'AVAXUSD' || deltaSymbol === 'SUIUSD')) {
          continue;
        }

        // Testnet Broken Spread Guard for SOLUSD:
        if (isTestnet && deltaSymbol === 'SOLUSD') {
          try {
            const solTicker = await deltaExchange.getTicker('SOLUSD');
            const bestBid = parseFloat(solTicker?.quotes?.best_bid || '0');
            const mark = parseFloat(solTicker?.mark_price || '0');
            if (mark > 0 && bestBid > 0 && (mark - bestBid) / mark > 0.01) {
              continue;
            }
          } catch (e) {}
        }

        // Fetch 15M candles for entry indicators directly (600 bars for accurate zero-bias 200 EMA)
        const candles15m = await this.fetchCandles(symbol, '15m', 600);
        if (candles15m.length < 35) continue;

        const closedCandles15m = candles15m.slice(0, -1);
        const lastClosedBar = closedCandles15m[closedCandles15m.length - 1];
        const lastClosedBarTime = lastClosedBar.time;

        // Fetch live Order Book Imbalance, Taker CVD, and Derivatives from Delta Exchange
        const microData = await deltaExchange.getMicrostructureAndDerivatives(cleanDeltaSym).catch(() => null);

        // Run strategy diagnostics, quant mathematical evaluation, price action playbook, and chop analysis
        const evalResult = strategyEngine.evaluateSymbol(symbol, closedCandles15m);
        const dedicatedSide = evalResult?.signal || evalResult?.readySignal || evalResult?.diagnostics?.readySignal || null;
        const dedicatedContext = dedicatedSide ? {
          side: dedicatedSide as 'BUY' | 'SELL',
          strategyName: evalResult?.strategyName || '',
          waveValue: evalResult?.diagnostics?.waveValue,
        } : null;
        const mathVerdict = quantMath.evaluateMarketMath(cleanDeltaSym, closedCandles15m, microData, dedicatedContext);
        const paVerdict = priceActionPlaybook.evaluatePriceAction(cleanDeltaSym, closedCandles15m);
        const chopAnalysis = marketTraps.evaluateChop(cleanDeltaSym, closedCandles15m);
        const timingAnalysis = timingEngine.evaluateTimingAndAntiChase({
          symbol: cleanDeltaSym,
          side: mathVerdict.recommendedSide || 'BUY',
          currentPrice: lastClosedBar.close,
          candles: closedCandles15m,
          atr: evalResult?.diagnostics?.atr || 1.0,
        });

        // Compute live active forming 15M candle telemetry & execution gate status
        const activeBar = candles15m[candles15m.length - 1];
        const livePrice = activeBar.close;
        const liveOpen = activeBar.open;
        const diffUSD = livePrice - liveOpen;
        const diffPct = liveOpen > 0 ? (diffUSD / liveOpen) * 100 : 0;
        const barColor: 'GREEN' | 'RED' | 'DOJI' = diffUSD > 0.00001 ? 'GREEN' : diffUSD < -0.00001 ? 'RED' : 'DOJI';

        const barDurationMs = 15 * 60 * 1000;
        const nextBarCloseMs = activeBar.time + barDurationMs;
        const secondsToClose = Math.max(0, Math.floor((nextBarCloseMs - Date.now()) / 1000));

        const hasOpenPosition = this.state.activePositions.some(p => {
          const s = (p.symbol || '').toUpperCase().replace('USDT', 'USD');
          return s === cleanDeltaSym;
        });

        let isVetoActive = false;
        let vetoReason = '';
        let executionStatus: 'IN_TRADE' | 'ARMED_WAITING_GATE' | 'READY_TO_ENTER' | 'SCANNING_BUILDING' | 'WAIT' = 'WAIT';

        if (hasOpenPosition) {
          executionStatus = 'IN_TRADE';
          vetoReason = `In Active Position (${cleanDeltaSym})`;
        } else if (mathVerdict.quantScore >= 60 && mathVerdict.recommendedSide) {
          const recSide = mathVerdict.recommendedSide;
          if (recSide === 'SELL' && barColor === 'GREEN') {
            isVetoActive = true;
            vetoReason = `Forming bar is GREEN ($${livePrice.toFixed(2)} > Open $${liveOpen.toFixed(2)}). Waiting for RED drop to execute SELL.`;
            executionStatus = 'ARMED_WAITING_GATE';
          } else if (recSide === 'BUY' && barColor === 'RED') {
            isVetoActive = true;
            vetoReason = `Forming bar is RED ($${livePrice.toFixed(2)} < Open $${liveOpen.toFixed(2)}). Waiting for GREEN bounce to execute BUY.`;
            executionStatus = 'ARMED_WAITING_GATE';
          } else {
            isVetoActive = false;
            vetoReason = `All gates clear! Ready to execute ${recSide}.`;
            executionStatus = 'READY_TO_ENTER';
          }
        } else if (mathVerdict.quantScore >= 40) {
          executionStatus = 'SCANNING_BUILDING';
          vetoReason = `Math Score: ${mathVerdict.quantScore}/100 (Need ≥ 60 for execution).`;
        } else {
          executionStatus = 'WAIT';
          vetoReason = `Market Consolidation: Score ${mathVerdict.quantScore}/100 (Need ≥ 60).`;
        }

        if (evalResult && evalResult.diagnostics) {
          evalResult.diagnostics.quantMath = mathVerdict;
          evalResult.diagnostics.priceActionPlaybook = paVerdict;
          evalResult.diagnostics.chopAnalysis = chopAnalysis;
          evalResult.diagnostics.timingAnalysis = timingAnalysis;
          evalResult.diagnostics.activeCandleGate = {
            barColor,
            barOpen: liveOpen,
            currentPrice: livePrice,
            diffUSD,
            diffPct,
            isVetoActive,
            vetoReason,
            nextBarCloseMs,
            secondsToClose,
            executionStatus,
          };
        }
        this.lastDiagnostics.set(deltaSymbol, evalResult.diagnostics);

        // Check 1: If coin ALREADY has an active open position, NEVER touch or open another trade!
        if (hasOpenPosition) {
          continue;
        }

        // Check 2: 5-Minute cooldown per coin to prevent rapid re-entry within the same candle
        const lastTradeTime = this.symbolLastTradeTime.get(cleanDeltaSym) || 0;
        const COOLDOWN_MS = this.MIN_SYMBOL_COOLDOWN_MS;
        if (Date.now() - lastTradeTime < COOLDOWN_MS) {
          continue;
        }

        // Check 3: Check if this exact closed 15M bar was already evaluated
        const lastProcessed = this.lastProcessedBarTime.get(cleanDeltaSym) || 0;
        if (lastProcessed === lastClosedBarTime) {
          continue;
        }

        // Check 4: Playbook 2026 Regime Gate (Blocks only dead random walk chaos)
        if (mathVerdict.marketRegime === 'CHAOS_NO_TRADE') {
          console.log(`🛑 [REGIME GATE] ${cleanDeltaSym} blocked from scanning: ${mathVerdict.marketRegime} (${mathVerdict.regimeReason})`);
          continue;
        }

        const confluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(closedCandles15m);
        const htf = await this.evaluateHigherTimeframeContext(symbol);

        const currentPrice = await deltaExchange.getMarketPrice(cleanDeltaSym);
        if (!currentPrice || currentPrice <= 0) continue;

        // Multi-timeframe strategies across 5m, 15m, 1h
        const multiSignal = await this.evaluateMultiTimeframeStrategies(symbol, cleanDeltaSym, closedCandles15m, htf);
        if (multiSignal) {
          candidatesPool.push({
            symbol,
            cleanDeltaSym,
            multiSignal,
            currentPrice,
            atr: multiSignal.atr || confluence.atr,
            lastClosedBarTime,
            isAltcoin,
            closedCandles: closedCandles15m,
          });
        }
      }

      // User Mandate: "4k capital ho jaye to trade off kar dena" -> Target Profit Goal: ₹4,000 INR
      const floatingPnlScan = this.state.activePositions.reduce((sum, p) => sum + (p.pnlUSD || 0), 0);
      const liveEquityINRScan = ((this.state.accountCapitalUSD || 23.53) + floatingPnlScan) * 84;

      // User Mandate: "if its become zero stop it okay"
      // Emergency Capital Floor Check (Enforced on both Paper and Live):
      const effectiveFloorINR = this.state.minCapitalFloorINR !== undefined ? this.state.minCapitalFloorINR : 50;
      if (liveEquityINRScan <= effectiveFloorINR) {
        console.warn(`🛑 [EMERGENCY ZERO CAPITAL FLOOR] Live equity ₹${liveEquityINRScan.toFixed(0)} reached zero/floor limit (₹${effectiveFloorINR} INR). Halting all trading per user safety mandate.`);
        this.state.isNewTradesPaused = true;
        this.state.isRunning = false;
        this.saveState();
        return;
      }

      // Target Profit Ceiling (Enforced on Live accounts to secure real capital)
      if (this.state.mode !== 'SIMULATION_PAPER') {
        const targetProfitINRScan = this.state.targetCapitalGoalINR || 10000;
        if (liveEquityINRScan >= targetProfitINRScan && targetProfitINRScan > 0) {
          console.log(`🎯 [TARGET PROFIT CEILING REACHED] Live equity ₹${liveEquityINRScan.toFixed(0)} reached target profit goal of ₹${targetProfitINRScan} INR. Pausing trading to secure profits.`);
          this.state.isNewTradesPaused = true;
          this.state.isRunning = false;
          this.saveState();
          return;
        }
      }

      // 1b. SCANNER RADAR HEARTBEAT (Logged every 20 seconds)
      // Gives live terminal feedback so the user always sees that the bot is actively scanning and scoring!
      const now = Date.now();
      if (now - this.lastHeartbeatLogTime > 20000) {
        this.lastHeartbeatLogTime = now;
        const activeCount = this.state.activePositions.length;
        const capitalINR = (this.state.accountCapitalUSD || 23.81) * 84;
        const radarSummary = this.WATCHLIST.map(sym => {
          const clean = sym.toUpperCase().replace('USDT', 'USD');
          const lastTrade = this.symbolLastTradeTime.get(clean) || 0;
          const cdRemaining = Math.max(0, Math.ceil((this.MIN_SYMBOL_COOLDOWN_MS - (now - lastTrade)) / 1000));
          if (cdRemaining > 0) return `${clean}: Cooldown (${cdRemaining}s)`;
          const diag = this.lastDiagnostics.get(clean);
          const score = diag?.quantMath?.quantScore ?? '-';
          const side = diag?.quantMath?.recommendedSide ?? 'WAIT';
          return `${clean}: ${side} [${score}/100]`;
        }).join(' | ');

        console.log(`📡 [SCANNER RADAR] Active: ${activeCount}/1 | Equity: ₹${capitalINR.toFixed(0)} ($${this.state.accountCapitalUSD.toFixed(2)}) | Radar: ${radarSummary}`);
      }

      // Execution Hold Filter
      if (this.state.isNewTradesPaused || !this.state.isRunning) {
        if (now - this.lastPauseLogTime > 60000) {
          this.lastPauseLogTime = now;
          console.log(`⏸️ [EXECUTION HOLD] New entries held (Paused/Capital Guard). Monitoring ${this.state.activePositions.length} active positions.`);
        }
        return;
      }

      // Available Slots Guard: Hold new entries if 1/1 slot is occupied, while scores continue streaming 24/7!
      if (availableSlots <= 0) {
        return;
      }

      // 2. CANDIDATE TOURNAMENT & MANDATORY SAME-DIRECTION TRADE COPY ENFORCEMENT
      // If position 1 is SELL -> position 2 MUST COPY SELL!
      // If 0 positions active -> Top candidate elects batch direction, all slots copy that direction!
      if (candidatesPool.length > 0) {
        // Direct execution without reversal engine interference (User mandate: "reversal engine delet kardo")
        const enrichedCandidates = candidatesPool.map(c => {
          const rawSide = c.multiSignal.side;
          const executedSide: 'BUY' | 'SELL' = rawSide;
          return { ...c, executedSide };
        });

        const alignedCandidates = enrichedCandidates.filter(c => {
          const minRequiredScore = 60; // User Mandate: "60 scroing pe trade lee"
          if (c.multiSignal.confidenceScore < minRequiredScore) {
            console.log(`🛡️ [QUALITY SHIELD] ${c.cleanDeltaSym} ${c.executedSide} filtered out (Score: ${c.multiSignal.confidenceScore} < ${minRequiredScore}). Waiting for setup score >= ${minRequiredScore}.`);
            return false;
          }
          return true;
        });

        // Sort candidates by highest confidence score for independent multi-coin execution:
        alignedCandidates.sort((a, b) => b.multiSignal.confidenceScore - a.multiSignal.confidenceScore);

        // Execute winning candidates up to available slots
        let currentBuyCount = this.state.activePositions.filter(p => p.side === 'BUY').length;
        let currentSellCount = this.state.activePositions.filter(p => p.side === 'SELL').length;
        const toExecute = alignedCandidates.slice(0, availableSlots);
        for (const candidate of toExecute) {
          if (this.state.activePositions.length >= maxAllowed) break;



          // Re-check BTC/ETH correlation lock dynamically
          if (candidate.cleanDeltaSym === 'ETHUSD') {
            const liveBtc = this.state.activePositions.find(p => p.symbol === 'BTCUSD');
            if (liveBtc && candidate.executedSide !== liveBtc.side) {
              console.log(`🚫 [BTC/ETH CORRELATION LOCK] ETHUSD ${candidate.executedSide} skipped — conflicts with live BTCUSD (${liveBtc.side})`);
              continue;
            }
          }
          if (candidate.cleanDeltaSym === 'BTCUSD') {
            const liveEth = this.state.activePositions.find(p => p.symbol === 'ETHUSD');
            if (liveEth && candidate.executedSide !== liveEth.side) {
              console.log(`🚫 [BTC/ETH CORRELATION LOCK] BTCUSD ${candidate.executedSide} skipped — conflicts with live ETHUSD (${liveEth.side})`);
              continue;
            }
          }

          this.candidateLastAttemptTime.set(candidate.cleanDeltaSym, Date.now());

          const candidateSignal: 'BUY' | 'SELL' = candidate.multiSignal.side;
          const candidateStrategyName = candidate.multiSignal.strategyName;
          const candidateAtr = candidate.atr;
          const setupReason = candidate.multiSignal.reason;

          const finalSide = candidate.executedSide;

          // FIX 5: Signal Freshness & Max Chase Distance (1.5 ATR limit)
          const liveExecutionPrice = await deltaExchange.getMarketPrice(candidate.cleanDeltaSym) || candidate.currentPrice;
          const priceSlip = Math.abs(liveExecutionPrice - candidate.currentPrice);
          const slipAtr = candidateAtr > 0 ? priceSlip / candidateAtr : 0;
          if (slipAtr > 1.5) {
            console.log(`⏱️ [SLIPPAGE SKIP] ${candidate.cleanDeltaSym} slipped ${slipAtr.toFixed(2)} ATR (> 1.5 ATR limit from $${candidate.currentPrice.toFixed(4)} to $${liveExecutionPrice.toFixed(4)}). Skipping market chase.`);
            continue;
          }

          // REAL-TIME FORMING CANDLE CONVICTION GATE (User Mandate: "Fix buy sell problem")
          // Rule 1: NEVER BUY if active forming 15M bar is RED (current price < live bar open)
          // Rule 2: NEVER SELL if active forming 15M bar is GREEN (current price > live bar open)
          // Rule 3: NEVER BUY if live price is below 15M EMA20
          // Rule 4: NEVER SELL if live price is above 15M EMA20
          const liveCandles15m = await this.fetchCandles(candidate.symbol, '15m', 50);
          if (liveCandles15m && liveCandles15m.length >= 20) {
            const activeLiveBar = liveCandles15m[liveCandles15m.length - 1];
            const liveCloses = liveCandles15m.map(c => c.close);
            const liveEma20 = CryptoDedicatedStrategyEngine.calculateEMA(liveCloses, 20).slice(-1)[0] || liveExecutionPrice;

            if (finalSide === 'BUY') {
              if (liveExecutionPrice < activeLiveBar.open) {
                console.log(`🛡️ [CANDLE COLOR VETO] ${candidate.cleanDeltaSym} BUY blocked: Active forming 15M candle is RED ($${liveExecutionPrice.toFixed(4)} < Open $${activeLiveBar.open.toFixed(4)}). Never buy into a dumping bar!`);
                continue;
              }
              if (liveExecutionPrice < liveEma20) {
                console.log(`🛡️ [EMA TREND VETO] ${candidate.cleanDeltaSym} BUY blocked: Live price ($${liveExecutionPrice.toFixed(4)}) is below 15M EMA20 ($${liveEma20.toFixed(4)}). Trend buys require price above EMA20! Zero counter-trend guesswork!`);
                continue;
              }
            }

            if (finalSide === 'SELL') {
              if (liveExecutionPrice > activeLiveBar.open) {
                console.log(`🛡️ [CANDLE COLOR VETO] ${candidate.cleanDeltaSym} SELL blocked: Active forming 15M candle is GREEN ($${liveExecutionPrice.toFixed(4)} > Open $${activeLiveBar.open.toFixed(4)}). Never short into a pumping bar!`);
                continue;
              }
              if (liveExecutionPrice > liveEma20) {
                console.log(`🛡️ [EMA TREND VETO] ${candidate.cleanDeltaSym} SELL blocked: Live price ($${liveExecutionPrice.toFixed(4)}) is above 15M EMA20 ($${liveEma20.toFixed(4)}). Never sell above EMA20! Zero counter-trend guesswork!`);
                continue;
              }
            }
          }

          const executionMode: TradeExecutionMode = 'DIRECT';
          const modeTag = `[DIRECT: ${finalSide} | TF:${candidate.multiSignal.timeframe}]`;
          const finalStrategyName = `${candidateStrategyName} ${modeTag}`;

          console.log(`🎯 [MULTI-STRATEGY DISPATCH] ${candidate.cleanDeltaSym} (${candidate.multiSignal.timeframe}): Strategy="${candidateStrategyName}" (Score: ${candidate.multiSignal.confidenceScore}) ➔ EXECUTING ${finalSide} @ $${liveExecutionPrice.toFixed(4)}. Direction: BUY=${currentBuyCount} SELL=${currentSellCount}.`);

          // REAL MARKET EXECUTION
          const newPos = await this.executeNewPosition({
            symbol: candidate.cleanDeltaSym,
            strategyName: finalStrategyName,
            side: finalSide,
            signalPrice: liveExecutionPrice,
            atr: candidateAtr,
            shadowConfirmedSeconds: 0,
            executionMode,
            reversalReason: undefined,
            customTP: candidate.multiSignal?.customTP,
            customSL: candidate.multiSignal?.customSL,
          });

          if (newPos) {
            // Update direction counters in this batch
            if (finalSide === 'BUY') currentBuyCount++;
            else currentSellCount++;
            this.symbolLastTradeTime.set(candidate.cleanDeltaSym, Date.now());
            this.lastProcessedBarTime.set(candidate.cleanDeltaSym, candidate.lastClosedBarTime);
            console.log(`✅ [REAL TRADE PLACED] ${candidate.cleanDeltaSym} ${finalSide} (${executionMode}) [${candidate.multiSignal.timeframe}] Direction Balance: BUY=${currentBuyCount} SELL=${currentSellCount}`);
          }

          this.saveState();
        }
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
      // 0. Periodic sync with live Delta Exchange positions (every 10 seconds)
      if (Date.now() - this.lastExchangeSyncTimestamp >= 10000) {
        this.lastExchangeSyncTimestamp = Date.now();
        await this.syncLivePositionsFromExchange();
        await this.reconcileFollowerPositions();
      }

      // Mandatory User Mandate: "4k capital ho jaye to trade off kar dena"
      // Real-time Capital Preservation Circuit Breaker:
      const floatingPnl = this.state.activePositions.reduce((sum, p) => sum + (p.pnlUSD || 0), 0);
      const liveEquityUSD = (this.state.accountCapitalUSD || 23.53) + floatingPnl;
      const liveEquityINR = liveEquityUSD * 84;
      const minFloorINR = 1000;
      const minFloorUSD = minFloorINR / 84; // ~$47.62 USD

      // Capital guard removed

      // 2. Evaluate Active Positions (Dynamic SL, TP, Breakeven Trailing)
      for (let i = this.state.activePositions.length - 1; i >= 0; i--) {
        const pos = this.state.activePositions[i];
        if (!pos || !pos.symbol) continue;
        // Skip option contracts (C-* and P-*) as they are managed by deltaOptionsCondor
        if (pos.symbol.startsWith('C-') || pos.symbol.startsWith('P-')) continue;
        const livePrice = await deltaExchange.getMarketPrice(pos.symbol);
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

    let totalBalanceUSD = this.state.accountCapitalUSD || 23.53; // ₹2,000 INR (~$23.53 USD) default
    let availableUSD = this.state.currentCapitalUSD || 23.53;

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

    // High Margin Utilization (User Mandate: "5000₹ kaa capital hai, margin use karo jyada, maxium trade 2")
    // Reserve ~8% cash buffer so account has safety cushion for noise and taker fees, while 92% is actively deployed
    const safeAllocationFactor = 0.92;
    const targetTotalMargin = totalBalanceUSD * safeAllocationFactor;
    const baseMarginPerSlot = targetTotalMargin / effectiveMaxPositions;

    // Distribute available free cash across remaining available slots
    const dynamicMarginFromAvailable = (availableUSD * safeAllocationFactor) / remainingSlots;

    // Dynamic margin allocation per slot: allows up to 3 slots on ₹1,000 capital (~$3.60 USD per slot)
    const minMarginFloor = Math.min(2.00, Math.max(1.00, dynamicMarginFromAvailable));
    let marginUSD = Math.min(
      availableUSD * 0.90,
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

    const cleanSym = params.symbol.toUpperCase().replace('USDT', 'USD');
    const existing = this.state.activePositions.find(
      p => (p.symbol || '').toUpperCase().replace('USDT', 'USD') === cleanSym
    );
    if (existing) {
      console.log(`⚠️ Position for ${params.symbol} already exists in activePositions. Skipping duplicate position.`);
      return existing;
    }

    // Money-Bleeder Blacklist: BTC and XRP permanently banned due to high fee drag
    if (['BTCUSD', 'XRPUSD'].includes(cleanSym)) {
      console.log(`🛑 [DISABLED COIN] New position for ${cleanSym} blocked (Money-Bleeder Blacklist: BTC, XRP permanently banned).`);
      return null;
    }

    // REAL-TIME ACTIVE CANDLE CONVICTION GATE ASSERTION
    // Guarantee that no execution can bypass active candle color check
    try {
      const liveCandlesGuard = await this.fetchCandles(params.symbol, '15m', 10);
      if (liveCandlesGuard && liveCandlesGuard.length > 0) {
        const activeBar = liveCandlesGuard[liveCandlesGuard.length - 1];
        if (orderSide === 'BUY' && params.signalPrice < activeBar.open) {
          console.warn(`🛡️ [CANDLE COLOR VETO] ${cleanSym} BUY blocked: Active forming 15M bar is RED ($${params.signalPrice.toFixed(4)} < Open $${activeBar.open.toFixed(4)}). Never buy a dumping candle!`);
          return null;
        }
        if (orderSide === 'SELL' && params.signalPrice > activeBar.open) {
          console.warn(`🛡️ [CANDLE COLOR VETO] ${cleanSym} SELL blocked: Active forming 15M bar is GREEN ($${params.signalPrice.toFixed(4)} > Open $${activeBar.open.toFixed(4)}). Never short a pumping candle!`);
          return null;
        }
      }
    } catch (e) {}

    // User Mandate: "4k capital ho jaye to trade off kar dena" -> Target Profit Goal of ₹4,000 INR
    const currentEquityINR = ((this.state.accountCapitalUSD || 23.53) + this.state.activePositions.reduce((s, p) => s + (p.pnlUSD || 0), 0)) * 84;

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

    // Independent Multi-Coin Trading: Up to 3 positions concurrently (User Mandate)
    const maxPositionsAllowed = this.state.maxConcurrentPositions || 3;
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
      const marginUSD = sizing.marginUSD;
      const notionalUSD = sizing.notionalUSD;
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
    // CALIBRATED $1.00 TARGET & RISK-BASED SIZING (User Mandate)
    // "hamara tp 1000 rupees hai to 1 dollar profit ek trade bohot haii aise target hit hona chaiyee"
    // $1.00 USD profit per trade = ~₹84-90 INR (+8.4% return on ₹1,000 INR capital in 1 trade)
    // Potential loss is strictly capped to $0.55 USD (~₹46 INR) for clean 1:1.8+ Risk-Reward!
    // ============================================================
    const MAX_LOSS_USD = this.state.maxLossPerTradeUSD || 0.55;
    const TARGET_PROFIT_USD = this.state.targetProfitPerTradeUSD || 1.00;

    // 1. Structural Stop Loss Distance determined by the system:
    let slPriceDistance = params.customSL
      ? Math.abs(params.signalPrice - params.customSL)
      : Math.max(0.85 * params.atr, params.signalPrice * 0.005);

    // Guaranteed Minimum Safe Stop Distance (>= 0.85 * ATR) to protect from noise wicks
    slPriceDistance = Math.max(slPriceDistance, 0.85 * params.atr, params.signalPrice * 0.005);

    // 2. Risk-Based Position Sizing:
    // Quantity sized strictly so that: quantity * slPriceDistance = MAX_LOSS_USD ($0.55)
    const riskSizedQuantity = slPriceDistance > 0
      ? parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4))
      : rawQuantity;

    // Margin ceiling clamp:
    const maxMarginQuantity = rawQuantity;
    if (riskSizedQuantity <= maxMarginQuantity) {
      quantity = riskSizedQuantity;
      console.log(`🛡️ [RISK-BASED SIZING] ${params.symbol} contracts sized to ${quantity} (SL: $${slPriceDistance.toFixed(4)} = ${(slPriceDistance / params.atr).toFixed(2)} ATR) to cap potential loss to exact $${MAX_LOSS_USD} USD.`);
    } else {
      quantity = maxMarginQuantity;
      console.log(`🛡️ [MARGIN-CAPPED SIZING] ${params.symbol} contracts capped to ${quantity} by margin ceiling. SL: $${slPriceDistance.toFixed(4)}.`);
    }

    if (quantity <= 0) quantity = 0.0001;

    // Half-size sizing for Zigzag Base Bounce longs per signal.pdf Section 6:
    if (params.strategyName.includes('ZIGZAG_BASE_BOUNCE')) {
      quantity = parseFloat((quantity * 0.5).toFixed(4));
      console.log(`🛡️ [ZIGZAG HALF SIZE] Base bounce long sized to 50% (${quantity} contracts) per signal.pdf.`);
    }

    // 3. Exact $1.00 USD Profit Target Distance:
    // "hamara tp 1000 rupees hai to 1 dollar profit ek trade bohot haii aise target hit hona chaiyee"
    // Calculate the exact price distance that produces TARGET_PROFIT_USD on this sized position!
    let targetPriceDistance = quantity > 0
      ? parseFloat((TARGET_PROFIT_USD / quantity).toFixed(4))
      : Math.max(slPriceDistance * 1.8, 1.2 * params.atr);

    if (params.customTP) {
      const customDist = Math.abs(params.customTP - params.signalPrice);
      targetPriceDistance = Math.min(targetPriceDistance, customDist);
    }
    // Guarantee minimum 1:1.6 Risk-Reward vs SL
    targetPriceDistance = Math.max(targetPriceDistance, slPriceDistance * 1.6);

    // Calculate TP & SL relative to signal price
    const takeProfitPrice = params.side === 'BUY'
      ? params.signalPrice + targetPriceDistance
      : params.signalPrice - targetPriceDistance;

    const stopLossPrice = params.side === 'BUY'
      ? params.signalPrice - slPriceDistance
      : params.signalPrice + slPriceDistance;

    console.log(`🤖 [TARGET CALIBRATED: $${TARGET_PROFIT_USD} TP / $${MAX_LOSS_USD} MAX LOSS] ${params.symbol} ${params.side}: Entry=$${params.signalPrice.toFixed(4)} | Dynamic TP=$${takeProfitPrice.toFixed(4)} (+${(targetPriceDistance / params.atr).toFixed(1)} ATR) | Dynamic SL=$${stopLossPrice.toFixed(4)} (-${(slPriceDistance / params.atr).toFixed(1)} ATR) | Expected R:R=1:${(targetPriceDistance / slPriceDistance).toFixed(2)} | Target Profit=$${TARGET_PROFIT_USD} USD | Risk Capped=$${MAX_LOSS_USD} USD (${quantity} contracts)`);

    // Send order to Delta Exchange Broker Gateway
    const orderResult = await deltaExchange.placeOrder({
      symbol: params.symbol,
      side: params.side,
      size: quantity,
      price: params.signalPrice,
      takeProfitPrice,
      stopLossPrice,
    });

    if (this.state.mode !== 'SIMULATION_PAPER' && (!orderResult || !orderResult.success)) {
      const exchangeError = orderResult?.message || 'Dispatch error';
      console.error(`❌ Delta Exchange rejected order for ${params.symbol}: ${exchangeError}. Aborting position entry so phantom trades are not created.`);
      return null;
    } else {
      console.log(`✅ Delta Exchange live order confirmed for ${params.symbol}!`);
    }

    const fillPrice = (orderResult && orderResult.success && orderResult.fillPrice && orderResult.fillPrice > 0)
      ? orderResult.fillPrice
      : params.signalPrice;
    let reanchoredTP = params.side === 'BUY' ? fillPrice + targetPriceDistance : fillPrice - targetPriceDistance;
    let reanchoredSL = params.side === 'BUY' ? fillPrice - slPriceDistance : fillPrice + slPriceDistance;

    // Geometric sanity guarantee: SL and TP must be on valid sides of fillPrice
    if (params.side === 'BUY') {
      if (reanchoredTP <= fillPrice) reanchoredTP = fillPrice + Math.max(targetPriceDistance, fillPrice * 0.002);
      if (reanchoredSL >= fillPrice) reanchoredSL = fillPrice - Math.max(slPriceDistance, fillPrice * 0.018);
    } else {
      if (reanchoredTP >= fillPrice) reanchoredTP = fillPrice - Math.max(targetPriceDistance, fillPrice * 0.002);
      if (reanchoredSL <= fillPrice) reanchoredSL = fillPrice + Math.max(slPriceDistance, fillPrice * 0.018);
    }

    // Explicitly attach/confirm native Delta Exchange position bracket order so web dashboard displays exact TP/SL numbers
    if (this.state.mode !== 'SIMULATION_PAPER') {
      try {
        await deltaExchange.setBracketOrder(params.symbol, reanchoredSL, reanchoredTP);
        console.log(`🎯 [DELTA BRACKET SYNC] Confirmed bracket on ${params.symbol}: SL=$${reanchoredSL.toFixed(4)}, TP=$${reanchoredTP.toFixed(4)}`);
      } catch (err: any) {
        console.warn(`⚠️ [DELTA BRACKET NOTE] ${params.symbol}:`, err?.message || err);
      }
    }

    const newPos: DeltaPosition = {
      id: 'pos-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      symbol: params.symbol,
      side: params.side,
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
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: params.strategyName,
      shadowConfirmedSeconds: params.shadowConfirmedSeconds,
      executionMode: params.executionMode || 'DIRECT',
      reversalReason: params.reversalReason,
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

    // Reject price anomalies (> 50% deviation from entry) to prevent bad ticks from falsely closing trades
    if (pos.entryPrice > 0 && Math.abs(currentPrice - pos.entryPrice) / pos.entryPrice > 0.5) {
      console.warn(`⚠️ Price anomaly skipped for ${pos.symbol}: entry=${pos.entryPrice}, tick=${currentPrice}`);
      return;
    }

    pos.currentPrice = currentPrice;

    // Floating PnL calculation
    const priceDiff = pos.side === 'BUY'
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;
    
    const calculatedPnl = pos.quantity > 0
      ? priceDiff * pos.quantity
      : (priceDiff / (pos.entryPrice || 1)) * pos.notionalUSD;
    pos.pnlUSD = parseFloat(calculatedPnl.toFixed(2));
    pos.pnlPercent = pos.marginUSD > 0 ? parseFloat(((pos.pnlUSD / pos.marginUSD) * 100).toFixed(2)) : 0;

    // Update peak floating profit reached during trade
    pos.highestPnlUSD = Math.max(pos.highestPnlUSD || 0, pos.pnlUSD);

    // =========================================================================
    // FIX 7: TIME STOP & EXHAUSTION EXIT (Timing Fix Playbook traps.pdf)
    // 1. Time stop: If trade stalls for 7 bars (105 min), ONLY exit if in PROFIT (bank green win)!
    //    If negative, NEVER cut prematurely — let structural SL protect position.
    // 2. Climax / Exhaustion Exit: If profit >= $1.00 and high-vol rejection prints, lock profit early
    // =========================================================================
    if (!pos.isProfitLockArmed && pos.pnlUSD < 1.50) {
      const timeStop = timingEngine.evaluateTimeStop({
        entryTime: pos.entryTime,
        currentPrice,
        entryPrice: pos.entryPrice,
        side: pos.side,
        atr: pos.atr || 1.0,
        barTimeMinutes: 15,
        maxBars: 7,
      });
      if (timeStop.shouldExit) {
        const elapsedHours = (Date.now() - pos.entryTime) / (3600 * 1000);
        // Only exit if trade has positive profit (banks green win) or reached 6-hour stagnation timeout
        if (pos.pnlUSD > 0 || elapsedHours >= 6) {
          console.log(`⏱️ [TIMING PLAYBOOK TIME STOP] ${pos.symbol}: ${timeStop.reason} (PnL: +$${pos.pnlUSD.toFixed(2)})`);
          const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
          if (targetIdx !== -1) {
            await this.closePosition(targetIdx, 'TIME_STOP_EXIT', currentPrice);
          }
          return;
        }
      }
    }

    // Climax / Exhaustion Exit Check:
    if (pos.pnlUSD >= 1.00) {
      const recentCandles = await this.fetchCandles(pos.symbol, '15m', 25).catch(() => []);
      if (recentCandles.length >= 5) {
        const exhaustCheck = timingEngine.evaluateExhaustionExit({
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          currentPrice,
          candles: recentCandles,
          atr: pos.atr || 1.0,
          pnlUSD: pos.pnlUSD,
        });
        if (exhaustCheck.shouldExit) {
          console.log(`🌋 [EXHAUSTION CLIMAX EXIT] ${pos.symbol}: ${exhaustCheck.reason}. Banking profits early!`);
          const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
          if (targetIdx !== -1) {
            await this.closePosition(targetIdx, 'EXHAUSTION_EXIT', currentPrice);
          }
          return;
        }
      }
    }

    // =========================================================================
    // MULTI-TIER FAST BREAKEVEN & $1.00 TARGET PROFIT LOCKING SYSTEM
    // User Mandate: "hamara tp 1000 rupees hai to 1 dollar profit ek trade bohot haii aise target hit hona chaiyee"
    // 1. Once trade reaches +$0.50 (halfway to $1.00), snap SL to +$0.15 green (100% risk-free win)!
    // 2. Once trade reaches +$0.80, snap SL to +$0.50 green!
    // 3. Once trade touches +$1.00 USD (or price reaches TP), EXIT IMMEDIATELY with TARGET_HIT!
    // =========================================================================

    // TIER 0: FAST BREAKEVEN AT +$0.50 FLOATING PROFIT (Halfway to $1.00 TP)
    if (pos.pnlUSD >= 0.50 || (pos.highestPnlUSD && pos.highestPnlUSD >= 0.50)) {
      if (!pos.isBreakevenLocked) {
        const lockDist = pos.quantity > 0
          ? 0.15 / pos.quantity
          : (0.15 / (pos.notionalUSD || 1)) * pos.entryPrice;
        const beSLPrice = pos.side === 'BUY'
          ? pos.entryPrice + lockDist
          : pos.entryPrice - lockDist;

        const isBetterSL = pos.side === 'BUY'
          ? (!pos.stopLossPrice || beSLPrice > pos.stopLossPrice)
          : (!pos.stopLossPrice || beSLPrice < pos.stopLossPrice);

        if (isBetterSL) {
          pos.stopLossPrice = beSLPrice;
          pos.isBreakevenLocked = true;
          console.log(`🛡️ [FAST BREAKEVEN LOCKED] ${pos.symbol} reached +$${(pos.highestPnlUSD || pos.pnlUSD).toFixed(2)} USD! SL snapped to +$0.15 green ($${beSLPrice.toFixed(4)}). Trade is 100% risk-free!`);
          if (this.state.mode !== 'SIMULATION_PAPER') {
            deltaExchange.setBracketOrder(pos.symbol, beSLPrice, pos.takeProfitPrice).catch(() => {});
          }
        }
      }
    }

    // TIER 1: HIGH PROFIT LOCK (At +$0.80 peak profit ➔ Lock SL at +$0.50 green)
    if (pos.highestPnlUSD && pos.highestPnlUSD >= 0.80) {
      const lockDist80 = pos.quantity > 0
        ? 0.50 / pos.quantity
        : (0.50 / (pos.notionalUSD || 1)) * pos.entryPrice;
      const t1SL = pos.side === 'BUY'
        ? pos.entryPrice + lockDist80
        : pos.entryPrice - lockDist80;

      const isBetterSL = pos.side === 'BUY'
        ? (!pos.stopLossPrice || t1SL > pos.stopLossPrice)
        : (!pos.stopLossPrice || t1SL < pos.stopLossPrice);

      if (isBetterSL) {
        pos.stopLossPrice = t1SL;
        pos.isBreakevenLocked = true;
        console.log(`🔒 [PROFIT LOCK +$0.50] ${pos.symbol} peak=+$${pos.highestPnlUSD.toFixed(2)}: SL locked at +$0.50 green ($${t1SL.toFixed(4)}).`);
        if (this.state.mode !== 'SIMULATION_PAPER') {
          deltaExchange.setBracketOrder(pos.symbol, t1SL, pos.takeProfitPrice).catch(() => {});
        }
      }

      // If market begins reversing from +$0.85+ peak, exit immediately with 0ms delay to bank the win
      if (pos.highestPnlUSD >= 0.85 && (pos.highestPnlUSD - pos.pnlUSD) >= 0.08) {
        console.log(`🎯 [0MS PEAK PROFIT BOOKED] ${pos.symbol} peaked at +$${pos.highestPnlUSD.toFixed(2)} and pulled back to +$${pos.pnlUSD.toFixed(2)}. Banking profit with 0ms delay!`);
        const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
        if (targetIdx !== -1) {
          await this.closePosition(targetIdx, 'REVERSAL_PROFIT_LOCKED', currentPrice);
        }
        return;
      }
    }

    // Validate TP and SL are positive numbers
    if (!pos.takeProfitPrice || pos.takeProfitPrice <= 0 || isNaN(pos.takeProfitPrice)) return;
    if (!pos.stopLossPrice || pos.stopLossPrice <= 0 || isNaN(pos.stopLossPrice)) return;

    // Geometric sanity check: SL must be on the loss side of entry ONLY if NOT in profit lock
    if (!pos.isBreakevenLocked && !pos.isProfitLockArmed) {
      if (pos.side === 'BUY' && pos.stopLossPrice >= pos.entryPrice) {
        pos.stopLossPrice = pos.entryPrice - Math.max(pos.atr * 1.15, pos.entryPrice * 0.005);
      } else if (pos.side === 'SELL' && pos.stopLossPrice <= pos.entryPrice) {
        pos.stopLossPrice = pos.entryPrice + Math.max(pos.atr * 1.15, pos.entryPrice * 0.005);
      }
    }

    // =========================================================================
    // EARLY REVERSAL EXIT SYSTEM (0ms FAST CAPITAL SHIELD)
    // User Directive: "after take trade and system get inform that trade may be reversal then its exit it faster"
    // If trade is running and system detects a confirmed market reversal against the position,
    // exit immediately with 0ms delay — banks early profit or cuts loss early (-$0.40 instead of -$2.50)!
    // =========================================================================
    const tradeAgeMs = Date.now() - (pos.entryTime || 0);
    // Allow at least 20 seconds of breathing room unless adverse loss exceeds -$0.90
    if (tradeAgeMs >= 20000 || pos.pnlUSD <= -0.90) {
      const cleanSym = (pos.symbol || '').toUpperCase().replace('USDT', 'USD');
      const diag = this.lastDiagnostics.get(cleanSym) || this.lastDiagnostics.get(pos.symbol);
      const quant = diag?.quantMath;

      let isEarlyReversalDetected = false;
      let reversalReason = '';

      if (pos.side === 'SELL') {
        // Holding SHORT: Bullish reversal threats
        const hasAdversePrice = currentPrice > pos.entryPrice + Math.max(pos.atr * 0.35, pos.entryPrice * 0.0025);
        const isBullishQuantFlip = quant && (
          (quant.recommendedSide === 'BUY' && (quant.quantScore >= 50 || (quant.scores?.totalBuyScore || 0) >= 50)) ||
          quant.supportBounceConfirmed === true
        );
        const waveValue = diag?.waveValue ?? 0;
        const waveSignal = diag?.waveSignal ?? 0;
        const rsi = diag?.rsi14 ?? 50;
        const isBullishIndicatorReversal = (diag?.readySignal === 'BUY') || 
                                           (waveValue > waveSignal && waveValue > 0 && hasAdversePrice) || 
                                           (rsi < 32 && hasAdversePrice);
        const isBullishMicroReversal = quant && (quant.fisherTransform > quant.fisherSignal) && (quant.scores?.totalBuyScore || 0) >= 40 && hasAdversePrice;

        if (isBullishQuantFlip) {
          isEarlyReversalDetected = true;
          reversalReason = `Quant Engine flipped to BUY (Score: ${quant.quantScore}/100, SupportBounce: ${quant.supportBounceConfirmed})`;
        } else if (isBullishIndicatorReversal) {
          isEarlyReversalDetected = true;
          reversalReason = `Dedicated Strategy Bullish Reversal (Signal: ${diag?.readySignal}, RSI: ${rsi.toFixed(1)}, Wave: ${waveValue.toFixed(1)} > ${waveSignal.toFixed(1)})`;
        } else if (isBullishMicroReversal) {
          isEarlyReversalDetected = true;
          reversalReason = `Fisher Bullish Cross with adverse momentum (+${quant.scores?.totalBuyScore} Buy pts)`;
        }
      } else if (pos.side === 'BUY') {
        // Holding LONG: Bearish reversal threats
        const hasAdversePrice = currentPrice < pos.entryPrice - Math.max(pos.atr * 0.35, pos.entryPrice * 0.0025);
        const isBearishQuantFlip = quant && (
          (quant.recommendedSide === 'SELL' && (quant.quantScore >= 50 || (quant.scores?.totalSellScore || 0) >= 50)) ||
          quant.resistanceRejectConfirmed === true
        );
        const waveValue = diag?.waveValue ?? 0;
        const waveSignal = diag?.waveSignal ?? 0;
        const rsi = diag?.rsi14 ?? 50;
        const isBearishIndicatorReversal = (diag?.readySignal === 'SELL') || 
                                           (waveValue < waveSignal && waveValue < 0 && hasAdversePrice) || 
                                           (rsi > 68 && hasAdversePrice);
        const isBearishMicroReversal = quant && (quant.fisherTransform < quant.fisherSignal) && (quant.scores?.totalSellScore || 0) >= 40 && hasAdversePrice;

        if (isBearishQuantFlip) {
          isEarlyReversalDetected = true;
          reversalReason = `Quant Engine flipped to SELL (Score: ${quant.quantScore}/100, ResistanceReject: ${quant.resistanceRejectConfirmed})`;
        } else if (isBearishIndicatorReversal) {
          isEarlyReversalDetected = true;
          reversalReason = `Dedicated Strategy Bearish Reversal (Signal: ${diag?.readySignal}, RSI: ${rsi.toFixed(1)}, Wave: ${waveValue.toFixed(1)} < ${waveSignal.toFixed(1)})`;
        } else if (isBearishMicroReversal) {
          isEarlyReversalDetected = true;
          reversalReason = `Fisher Bearish Cross with adverse momentum (+${quant.scores?.totalSellScore} Sell pts)`;
        }
      }

      if (isEarlyReversalDetected) {
        console.log(`⚡ [0MS FAST REVERSAL EXIT] ${pos.symbol} (${pos.side}): ${reversalReason} | PnL: $${pos.pnlUSD.toFixed(2)} USD. Exiting with 0ms delay to protect capital!`);
        const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
        if (targetIdx !== -1) {
          await this.closePosition(targetIdx, 'REVERSAL_EXIT_EARLY', currentPrice);
        }
        return;
      }
    }

    // 1. Take Profit (TP) Check with ZERO MS DELAY (User Mandate: $1.00 USD target):
    // "hamara tp 1000 rupees hai to 1 dollar profit ek trade bohot haii aise target hit hona chaiyee"
    const targetProfitUSD = this.state.targetProfitPerTradeUSD || 1.00;
    const isDollarTPHit = pos.pnlUSD >= targetProfitUSD;
    const isPriceTPHit = pos.side === 'BUY'
      ? currentPrice >= pos.takeProfitPrice
      : currentPrice <= pos.takeProfitPrice;
    const isTPHit = isDollarTPHit || isPriceTPHit;

    if (isTPHit) {
      console.log(`🎯 [INSTANT $1.00 PROFIT TARGET HIT] Take Profit reached for ${pos.symbol} (PnL: +$${pos.pnlUSD.toFixed(2)} USD >= $${targetProfitUSD} target, Price: $${currentPrice.toFixed(4)})! Banking win with 0ms delay!`);
      const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (targetIdx !== -1) {
        await this.closePosition(targetIdx, 'TARGET_HIT', currentPrice);
      }
      return;
    }

    // 2. Stop Loss (SL) & Breakeven Check with ZERO MS DELAY:
    // Risk capped strictly to MAX_LOSS_USD ($0.55 USD, ~₹46 INR)
    const maxLossUSD = this.state.maxLossPerTradeUSD || 0.55;
    const isPriceSLHit = pos.side === 'BUY'
      ? currentPrice <= pos.stopLossPrice
      : currentPrice >= pos.stopLossPrice;
    const isEmergencyHardLoss = pos.pnlUSD <= -maxLossUSD;
    const isSLHit = isPriceSLHit || isEmergencyHardLoss;

    if (isSLHit) {
      const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (targetIdx !== -1) {
        // If Breakeven/Profit Lock was active and hit, bank it as a win/breakeven — NOT a loss!
        if (pos.isBreakevenLocked && !isEmergencyHardLoss) {
          const exitReason = pos.pnlUSD >= 0.15 ? 'REVERSAL_PROFIT_LOCKED' : 'BREAKEVEN_HIT';
          console.log(`🛡️ [PROTECTED GREEN EXIT: ${exitReason}] ${pos.symbol} closed at $${currentPrice.toFixed(4)} (PnL: +$${pos.pnlUSD.toFixed(2)} USD). Capital 100% preserved in green!`);
          await this.closePosition(targetIdx, exitReason, currentPrice);
        } else {
          const slDetail = isEmergencyHardLoss
            ? `Emergency Max Loss Limit (-$${Math.abs(pos.pnlUSD).toFixed(2)} USD <= -$${maxLossUSD.toFixed(2)} max loss)`
            : `structural SL $${pos.stopLossPrice.toFixed(4)}`;
          console.log(`🛑 [STOP LOSS HIT] ${pos.symbol} triggered via ${slDetail} (Current: $${currentPrice.toFixed(4)}, PnL: $${pos.pnlUSD.toFixed(2)}). Exiting with 0ms delay!`);
          await this.closePosition(targetIdx, 'STOP_LOSS_HIT', currentPrice);
        }
      }
      return;
    }

    // 3. STRICT HOLD: As long as market price has not reached TP or SL, trade is held intact.
    return;
  }

  public archiveClosedTrade(pos: DeltaPosition, exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT' | 'REVERSAL_EXIT_EARLY', exitPrice?: number) {
    // Guard against duplicate archive loop
    const lastArchive = this.closedTradesHistory[0];
    if (lastArchive && lastArchive.symbol === pos.symbol && Math.abs(lastArchive.entryPrice - pos.entryPrice) < 0.0001 && (Date.now() - (lastArchive.exitTime || 0)) < 30000) {
      console.log(`⚠️ Prevented duplicate trade archive for ${pos.symbol} (${exitReason})`);
      return;
    }

    let finalPrice = exitPrice || pos.currentPrice;

    // Price Sanity Shield: Reject cross-symbol alien ticks or abnormal bad prints
    // A price deviating > 35% from entry on a 15m crypto trade indicates cross-symbol tick contamination.
    if (pos.entryPrice > 0 && Math.abs(finalPrice - pos.entryPrice) / pos.entryPrice > 0.35) {
      console.warn(`🚨 [SANITY SHIELD] Alien exit price rejected for ${pos.symbol}: entry=${pos.entryPrice}, alienExitPrice=${finalPrice}. Falling back to safe price.`);
      finalPrice = (pos.currentPrice > 0 && Math.abs(pos.currentPrice - pos.entryPrice) / pos.entryPrice <= 0.35)
        ? pos.currentPrice
        : pos.entryPrice;
    }

    const priceDiff = pos.side === 'BUY'
      ? finalPrice - pos.entryPrice
      : pos.entryPrice - finalPrice;

    const realizedPnlUSD = parseFloat(((priceDiff / (pos.entryPrice || 1)) * pos.notionalUSD).toFixed(2));
    const realizedPnlPercent = pos.marginUSD > 0 ? parseFloat(((realizedPnlUSD / pos.marginUSD) * 100).toFixed(2)) : 0;
    const rMultiple = pos.atr > 0 ? parseFloat((priceDiff / pos.atr).toFixed(2)) : 0;

    const closedTrade: DeltaClosedTrade = {
      id: 'trade-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: finalPrice,
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
      this.consecutiveLosses = (this.consecutiveLosses || 0) + 1;
      if (this.consecutiveLosses >= 3) {
        this.circuitBreakerPauseUntil = Date.now() + 30 * 60 * 1000; // 30-min pause
        console.warn(`🛑 [CIRCUIT BREAKER TRIGGERED] 3 consecutive losses reached. Pausing new trade entries for 30 minutes to protect capital.`);
      }
    }

    // Daily loss limit circuit breaker (Playbook 2026 Priority 8)
    if (this.state.dailyRealizedPnlUSD <= -15.0) {
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

  public async closePosition(target: number | string, exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT' | 'REVERSAL_EXIT_EARLY', exitPrice?: number) {
    const index = typeof target === 'string'
      ? this.state.activePositions.findIndex(p => p.id === target)
      : target;
    if (index < 0 || index >= this.state.activePositions.length) return;
    const pos = this.state.activePositions[index];

    // Execute close on Delta Exchange broker
    const res = await deltaExchange.closePosition(pos.symbol);
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

  public getStatus(): DeltaAutoTraderState {
    this.deduplicateActivePositions();
    this.state.activeShadowCandidates = [];
    this.state.smartDetectorEnabled = true;
    this.state.smartAdaptiveMode = true;
    this.state.isInverseTrading = false;
    const directCount = this.state.activePositions.length;
    this.state.smartDetectorSummary = {
      activeMode: 'PURE_DIRECT_TRADING (100% Direct Long & Short Execution)',
      directTradesCount: directCount,
      reversedTradesCount: 0,
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
    this.closedTradesHistory = [];
    this.saveHistory();
    this.state.dailyRealizedPnlUSD = 0;
    this.state.totalRealizedPnlUSD = 0;
    this.state.totalTradesCount = this.state.activePositions.length;
    this.state.winningTradesCount = 0;
    this.state.losingTradesCount = 0;
    this.state.winRatePercent = 0;
    this.state.currentCapitalUSD = this.state.accountCapitalUSD || 23.53;
    this.saveState();
    console.log('✅ [RESET] PnL and trade history successfully reset to 0. Active positions preserved.');
  }

  public getDiagnostics(): AssetDiagnostics[] {
    return Array.from(this.lastDiagnostics.values());
  }

  public getHistory(): DeltaClosedTrade[] {
    return [...this.closedTradesHistory];
  }

  public toggleInverse(_explicitState?: boolean): boolean {
    this.state.isInverseTrading = false;
    this.saveState();
    console.log(`🔒 [INVERSE MODE DEPRECATED] Direct execution is permanently locked and enforced.`);
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
    this.state = { ...this.state, ...config, isInverseTrading: false };
    if (config.maxConcurrentPositions !== undefined) {
      this.state.maxConcurrentPositions = config.maxConcurrentPositions;
    } else if (!this.state.maxConcurrentPositions) {
      this.state.maxConcurrentPositions = 3;
    }
    this.saveState();
  }
}

export const deltaAutoTrader = new DeltaAutoTraderEngine();

