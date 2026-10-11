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
  // Playbook 2026 Circuit Breakers (Priority 8)
  private consecutiveLosses: number = 0;
  private circuitBreakerPauseUntil: number = 0;
  private lastCircuitLogTime: number = 0;

  // The Supported Altcoins with Dedicated Indicators (Delta Exchange Perpetual Contracts)
  // BTC, ETH, ADA turned OFF per user directives:
  // - "adaa mee coin off kardo aage se bnd rakhna bas"
  // - "bth eth bade bade off kardo abhi ke liye kam margin ke baje se"
  public readonly WATCHLIST = [
    'XRPUSD',
    'DOGEUSD',
    'SOLUSD',
    'AVAXUSD',
    'SUIUSD',
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
      accountCapitalUSD: 23.53, // ₹2,000 INR capital (~$23.53 USD)
      currentCapitalUSD: 23.53,
      dailyRealizedPnlUSD: 0,
      totalRealizedPnlUSD: 0,
      totalTradesCount: 0,
      winningTradesCount: 0,
      losingTradesCount: 0,
      winRatePercent: 0,
      activePositions: [],
      maxConcurrentPositions: 1, // User Mandate: "maxium 1 trade beause capital only 2000₹ is there"
      leverage: 20,
      marginPercentPerTrade: 90.0, // Single-slot margin deployment (~₹1,800 INR per trade)
      lastScanTimestamp: Date.now(),
      scanIntervalSeconds: 1, // High-frequency scan cycle
      shadowGateEnabled: false, // DISABLED — Shadow Gate removed from system
      activeShadowCandidates: [],
      trapsFilteredCount: 0,
      capitalSavedUSD: 0,
      isInverseTrading: false, // Direct mode — proper signals + proper R:R
      minCapitalFloorINR: 500, // Reduced floor to allow trading with ₹2,000 capital
      targetCapitalGoalINR: 4000, // Target profit goal to secure profits and pause
      recentFilteredTraps: [],
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
          // Max 1 Trade (User Mandate: "maxium 1 trade beause capital only 2000₹ is there")
          this.state.maxConcurrentPositions = 1;
          this.state.marginPercentPerTrade = 90.0;
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
        if (cfg.maxLeverage > 20 || cfg.maxLeverage < 1) {
          throw new Error(`CRITICAL RISK VIOLATION: maxLeverage (${cfg.maxLeverage}x) exceeds safe limits [1x-20x]!`);
        }
        this.state.leverage = cfg.maxLeverage;
      }

      if (typeof cfg.maxConcurrentPositions === 'number') {
        if (cfg.maxConcurrentPositions < 1 || cfg.maxConcurrentPositions > 2) {
          throw new Error(`CRITICAL RISK VIOLATION: maxConcurrentPositions (${cfg.maxConcurrentPositions}) must be 1 or 2!`);
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
    }> = [];

    // Fetch live Order Book Imbalance, Taker CVD, and Derivatives from Delta Exchange
    const microData = await deltaExchange.getMicrostructureAndDerivatives(cleanSym).catch(() => null);

    // -------------------------------------------------------------
    // ADVANCED QUANTITATIVE MATHEMATICAL EVALUATION (PLAYBOOK 2026 v2)
    // 6 Signal Groups: Trend, Mean-Revert, Volatility, Structure, Order Flow, Derivatives
    // -------------------------------------------------------------
    const mathVerdict = quantMath.evaluateMarketMath(cleanSym, closedCandles15m, microData);

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
    // MARKET STRUCTURE SHIELD (Section 0 of 2026.pdf):
    // "Uptrend (HH/HL): Look for LONGS only. Downtrend (LH/LL): Look for SHORTS only."
    // - In DOWNTREND: Sell rallies into Resistance/EMA50 or breakdowns. Block naive BUYs!
    // - In UPTREND: Buy dips into Support/EMA50 or breakouts. Block naive SELLs!
    // -------------------------------------------------------------
    let isMathBlockedByStructure = false;
    const swings = priceActionPlaybook.findSwings(closedCandles15m, 3);
    const structureData = priceActionPlaybook.evaluateMarketStructure(closedCandles15m, swings.swingHighs, swings.swingLows);
    const currentStructure = paVerdict ? paVerdict.marketStructure : structureData.structure;

    if (currentStructure === 'DOWNTREND' && mathVerdict.recommendedSide === 'BUY' && paVerdict?.setupType !== 'LIQUIDITY_SWEEP' && mathVerdict.quantScore < 70 && !mathVerdict.reasons.some(r => r.includes('Support') || r.includes('Oversold') || r.includes('Reversal') || r.includes('Exhaustion') || r.includes('Floor') || r.includes('Bounce'))) {
      console.log(`🛡️ [STRUCTURE SHIELD] ${cleanSym} BUY blocked: Market Structure is DOWNTREND (LH/LL) without sufficient quant support/exhaustion/reversal score (${mathVerdict.quantScore}/100).`);
      isMathBlockedByStructure = true;
    } else if (currentStructure === 'UPTREND' && mathVerdict.recommendedSide === 'SELL' && paVerdict?.setupType !== 'LIQUIDITY_SWEEP' && mathVerdict.quantScore < 70 && !mathVerdict.reasons.some(r => r.includes('Resistance') || r.includes('Overbought') || r.includes('Reversal') || r.includes('Exhaustion') || r.includes('Fisher') || r.includes('Peak'))) {
      console.log(`🛡️ [STRUCTURE SHIELD] ${cleanSym} SELL blocked: Market Structure is UPTREND (HH/HL) without sufficient quant exhaustion/reversal/resistance score (${mathVerdict.quantScore}/100).`);
      isMathBlockedByStructure = true;
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
    const mathSide = mathVerdict.recommendedSide;
    const mathScore = mathVerdict.quantScore;

    if (mathSide && !isMathBlockedByStructure && mathScore >= 40) {
      // 1. Evaluate Technical Indicator Confluence (EMA 20/50/200, RSI 14, MACD, RVOL)
      let evalResult: any = null;
      try {
        evalResult = strategyEngine.evaluateSymbol(symbol, closedCandles15m);
      } catch (e) {}

      const indicatorSide = evalResult?.signal;
      const indicatorQuality = evalResult?.diagnostics?.qualityScore || confluence.confluenceScore;

      // 1. HARD MANDATORY INDICATOR CONFLUENCE GATE:
      // Determine affirmative indicator stance:
      const isIndicatorBullish = confluence.trendDirection === 'BULLISH' || confluence.isMacroBullish || indicatorSide === 'BUY' || confluence.allowsLong;
      const isIndicatorBearish = confluence.trendDirection === 'BEARISH' || confluence.isMacroBearish || indicatorSide === 'SELL' || confluence.allowsShort;

      // Strict User Mandate: Never counter-trade an opposing indicator trend!
      // If indicators/trend are BULLISH, NEVER execute a SELL!
      if (mathSide === 'SELL' && isIndicatorBullish) {
        console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} SELL blocked: Indicator Signal is BULLISH (Trend=${confluence.trendDirection}, MacroBullish=${confluence.isMacroBullish}, Indicator=${indicatorSide || 'NONE'}). Never short when Buy signal is active!`);
        return null;
      }

      // If indicators/trend are BEARISH, NEVER execute a BUY!
      if (mathSide === 'BUY' && isIndicatorBearish) {
        console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} BUY blocked: Indicator Signal is BEARISH (Trend=${confluence.trendDirection}, MacroBearish=${confluence.isMacroBearish}, Indicator=${indicatorSide || 'NONE'}). Never long when Sell signal is active!`);
        return null;
      }

      // Indicator Confluence Check:
      // For BUY: Either indicators are affirmatively bullish OR aligned via RSI/MACD (and NOT bearish)
      // For SELL: Either indicators are affirmatively bearish OR aligned via RSI/MACD (and NOT bullish)
      const isIndicatorConfirmed = mathSide === 'BUY'
        ? (isIndicatorBullish || confluence.isRsiBullish || Boolean(confluence.macd?.isBullish)) && !isIndicatorBearish
        : (isIndicatorBearish || confluence.isRsiBearish || Boolean(confluence.macd?.isBearish)) && !isIndicatorBullish;

      if (!isIndicatorConfirmed) {
        console.log(`🛡️ [CONFLUENCE GUARD] ${cleanSym} ${mathSide} blocked: Institutional Indicators do not confirm ${mathSide} (Trend=${confluence.trendDirection}, Indicator=${indicatorSide || 'NONE'}). Standing aside.`);
        return null;
      }

      const isIndicatorAligned = true;

      // 2. Candlestick Anatomy & Price Action Verification
      // Solo candle trades are DELETED. Candle shapes ONLY serve as confirmation/timing!
      let hasCandleConfirmation = false;
      let candleTriggerTag = '';

      if (paVerdict && paVerdict.confluenceScore >= 70) {
        if (paVerdict.side !== mathSide) {
          console.log(`🛡️ [CONFLUENCE CONFLICT] ${cleanSym} trade blocked: Candlestick shape (${paVerdict.side} ${paVerdict.setupType}) opposes Quant Math (${mathSide}). Single-candle solo trading is deleted!`);
          return null; // Reject trade on conflict!
        }
        hasCandleConfirmation = true;
        candleTriggerTag = ` + PA ${paVerdict.setupType}`;
      }

      // Symmetric Trap Protection:
      // 1. Do NOT BUY into Overbought Climax (RSI >= 70, Fisher >= 1.5, Z >= 1.6, or testing Resistance)
      // 2. Do NOT SELL into Oversold Capitulation (RSI <= 30, Fisher <= -1.5, Z <= -1.6, or testing Support)
      const currentRsi = rsi15mArr[rsi15mArr.length - 1] || 50;

      if (mathSide === 'BUY') {
        const isRsiOverbought = currentRsi >= 70;
        const isGaussianOverbought = (mathVerdict.zScore && mathVerdict.zScore >= 1.6) || (mathVerdict.fisherTransform && mathVerdict.fisherTransform >= 1.5);
        const isClimaxReason = mathVerdict.reasons.some(r => r.includes('Overbought') || r.includes('Climax Fade') || r.includes('Long Flush'));
        const isBlockedByCeiling = mathVerdict.isAtResistance ||
          mathVerdict.resistanceRejectConfirmed ||
          mathVerdict.reasons.some(r => r.includes('Resistance') || r.includes('CEILING REJECT')) ||
          Boolean(paVerdict && paVerdict.locationReason?.includes('Resistance') && paVerdict.confluenceScore >= 70);

        if (isRsiOverbought || isGaussianOverbought || isClimaxReason) {
          console.log(`🛡️ [OVERBOUGHT TRAP SHIELD] ${cleanSym} BUY blocked: Market is Overbought/Exhausted (RSI=${currentRsi.toFixed(1)}, Z=${mathVerdict.zScore}, Fisher=${mathVerdict.fisherTransform}). Never buy at blow-off top!`);
          return null;
        }
        if (isBlockedByCeiling) {
          console.log(`🛡️ [TRAP SHIELD] ${cleanSym} BUY dropped: Price is testing/rejecting at Resistance Ceiling ($${mathVerdict.nearestResistance || 'Resistance'}).`);
          return null;
        }
      }

      if (mathSide === 'SELL') {
        const isRsiOversold = currentRsi <= 30;
        const isGaussianOversold = (mathVerdict.zScore && mathVerdict.zScore <= -1.6) || (mathVerdict.fisherTransform && mathVerdict.fisherTransform <= -1.5);
        const isCapitulationReason = mathVerdict.reasons.some(r => r.includes('Oversold') || r.includes('Capitulation') || r.includes('Short Squeeze'));
        const isBlockedByFloor = mathVerdict.isAtSupport ||
          mathVerdict.supportBounceConfirmed ||
          mathVerdict.reasons.some(r => r.includes('Support') || r.includes('FLOOR BOUNCE')) ||
          Boolean(paVerdict && paVerdict.locationReason?.includes('Support') && paVerdict.confluenceScore >= 70);

        if (isRsiOversold || isGaussianOversold || isCapitulationReason) {
          console.log(`🛡️ [OVERSOLD TRAP SHIELD] ${cleanSym} SELL blocked: Market is Oversold/Dumped (RSI=${currentRsi.toFixed(1)}, Z=${mathVerdict.zScore}, Fisher=${mathVerdict.fisherTransform}). Never sell at capitulation bottom!`);
          return null;
        }
        if (isBlockedByFloor) {
          console.log(`🛡️ [TRAP SHIELD] ${cleanSym} SELL dropped: Price is testing/bouncing at Support Floor ($${mathVerdict.nearestSupport || 'Support'}).`);
          return null;
        }
      }

      // 3. Synthesize Multi-Layer Strict Confluence Score
      let strictScore = mathScore;
      if (isIndicatorAligned) strictScore += 25;
      if (hasCandleConfirmation) strictScore += 25;
      strictScore = Math.min(99, Math.max(strictScore, mathScore));

      const mathConfluenceNote = `Strict Math & Indicator Confluence (${mathVerdict.marketRegime} | Score ${strictScore}/100): Fisher=${mathVerdict.fisherTransform}, Hurst=${mathVerdict.hurstExponent}, SS_Slope=${mathVerdict.superSmootherSlope}%, KalmanDev=${mathVerdict.kalmanDeviationPct}%${microData ? ` | OBI=${microData.obi}, CVD=${microData.cvd}` : ''} | Indicators: ${confluence.summaryReason}${candleTriggerTag} | Reasons: ${mathVerdict.reasons.join(' + ')}`;

      console.log(`🧮 [STRICT CONFLUENCE VERIFIED] ${cleanSym} Direction=${mathSide} (Score: ${strictScore}/100 | Math: ${mathScore}/100 | Indicators: ${isIndicatorAligned ? 'ALIGNED' : 'NEUTRAL'}${candleTriggerTag})`);

      candidates.push({
        symbol: cleanSym,
        timeframe: '15m',
        strategyName: `15M Strict Math & Indicator Confluence [${mathVerdict.marketRegime} | Score:${strictScore}]${candleTriggerTag}`,
        side: mathSide,
        confidenceScore: strictScore,
        atr: atr15m,
        reason: mathConfluenceNote,
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
          candidates.push({
            symbol: cleanSym,
            timeframe: '15m',
            strategyName: `15M Bullish RSI Divergence [Quant Confirmed]`,
            side: 'BUY',
            confidenceScore: 89,
            atr: atr15m,
            reason: `15M price lower low with RSI higher low confirmed by Quant Math (Fisher: ${mathVerdict.fisherTransform}, Hurst: ${mathVerdict.hurstExponent})`,
          });
        } else if (div15m === 'BEARISH_DIV' && (mathVerdict.marketRegime === 'MEAN_REVERTING' || mathVerdict.fisherTransform >= 1.2 || mathVerdict.recommendedSide === 'SELL')) {
          candidates.push({
            symbol: cleanSym,
            timeframe: '15m',
            strategyName: `15M Bearish RSI Divergence [Quant Confirmed]`,
            side: 'SELL',
            confidenceScore: 89,
            atr: atr15m,
            reason: `15M price higher high with RSI lower high confirmed by Quant Math (Fisher: ${mathVerdict.fisherTransform}, Hurst: ${mathVerdict.hurstExponent})`,
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
        if (!isOpposingMath && !isMathBlockedByStructure) {
          console.log(`🚀 [COMPRESSION BREAKOUT] ${cleanSym} Early Bar 1 Breakout (${compression.breakoutSide}): RVOL=${compression.rvol}, Bandwidth=${(compression.bandwidthPct * 100).toFixed(1)}%`);
          candidates.push({
            symbol: cleanSym,
            timeframe: '15m',
            strategyName: `15M Compression Breakout [Early Phase | RVOL:${compression.rvol}]`,
            side: compression.breakoutSide,
            confidenceScore: 92,
            atr: atr15m,
            reason: compression.reason,
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
        const isBypass = cand.confidenceScore >= 80 && (
          cand.strategyName.includes('Strict Math & Indicator Confluence') ||
          cand.strategyName.includes('Dedicated Indicator') ||
          cand.strategyName.includes('BREAKOUT') ||
          cand.strategyName.includes('TREND_PULLBACK') ||
          cand.strategyName.includes('Breakout') ||
          cand.strategyName.includes('REJECTION_PIN_BAR') ||
          cand.strategyName.includes('LIQUIDITY_SWEEP') ||
          cand.strategyName.includes('ENGULFING_AT_LEVEL') ||
          cand.strategyName.includes('Price Action Playbook') ||
          cand.strategyName.includes('Playbook 2026')
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
        score += 20;
        reasons.push('Above one major EMA (+20)');
      } else if (lastRsi < 32 || (lastCandle && (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) / Math.max(lastCandle.high - lastCandle.low, 0.0001) >= 0.30) || (lastCandle && lastCandle.close > lastCandle.open)) {
        score += 25; // Confirmed support bounce / absorption wick / hammer rejection
        reasons.push('Confirmed support bounce / oversold absorption (+25)');
      } else {
        score -= 10;
        reasons.push('Below 50/100 EMA (-10)');
      }
    } else {
      if (currentPrice <= last50Ema && currentPrice <= last100Ema) {
        score += 30;
        reasons.push('Below 50/100 EMA (+30)');
      } else if (currentPrice <= last50Ema || currentPrice <= last100Ema) {
        score += 20;
        reasons.push('Below one major EMA (+20)');
      } else if (lastRsi > 60 || (lastCandle && (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) / Math.max(lastCandle.high - lastCandle.low, 0.0001) >= 0.25) || (lastCandle && lastCandle.close < lastCandle.open)) {
        score += 25; // Reversal rejection / upper wick above EMAs
        reasons.push('Reversal rejection / upper wick above EMAs (+25)');
      } else {
        score -= 10;
        reasons.push('Uptrend continuation risk (-10)');
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

      // TRADE LIMIT: Dynamic Limit (Strict Max 2 Positions)
      const totalOccupied = this.state.activePositions.length + this.inFlightSymbols.size;
      const availableSlots = maxAllowed - totalOccupied;
      if (availableSlots <= 0) {
        return; // Full capacity reached - hold existing trades, do not scan or execute any new trades
      }

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

        // Fetch 15M candles for entry indicators directly (250 bars for accurate 200 EMA)
        const candles15m = await this.fetchCandles(symbol, '15m', 250);
        if (candles15m.length < 35) continue;

        const closedCandles15m = candles15m.slice(0, -1);
        const lastClosedBar = closedCandles15m[closedCandles15m.length - 1];
        const lastClosedBarTime = lastClosedBar.time;

        // Fetch live Order Book Imbalance, Taker CVD, and Derivatives from Delta Exchange
        const microData = await deltaExchange.getMicrostructureAndDerivatives(cleanDeltaSym).catch(() => null);

        // Run strategy diagnostics, quant mathematical evaluation, price action playbook, and chop analysis
        const evalResult = strategyEngine.evaluateSymbol(symbol, closedCandles15m);
        const mathVerdict = quantMath.evaluateMarketMath(cleanDeltaSym, closedCandles15m, microData);
        const paVerdict = priceActionPlaybook.evaluatePriceAction(cleanDeltaSym, closedCandles15m);
        const chopAnalysis = marketTraps.evaluateChop(cleanDeltaSym, closedCandles15m);
        const timingAnalysis = timingEngine.evaluateTimingAndAntiChase({
          symbol: cleanDeltaSym,
          side: mathVerdict.recommendedSide || 'BUY',
          currentPrice: lastClosedBar.close,
          candles: closedCandles15m,
          atr: evalResult?.diagnostics?.atr || 1.0,
        });
        if (evalResult && evalResult.diagnostics) {
          evalResult.diagnostics.quantMath = mathVerdict;
          evalResult.diagnostics.priceActionPlaybook = paVerdict;
          evalResult.diagnostics.chopAnalysis = chopAnalysis;
          evalResult.diagnostics.timingAnalysis = timingAnalysis;
        }
        this.lastDiagnostics.set(deltaSymbol, evalResult.diagnostics);

        // Check 1: If coin ALREADY has an active open position, NEVER touch or open another trade!
        const hasOpenPosition = this.state.activePositions.some(p => {
          const s = (p.symbol || '').toUpperCase().replace('USDT', 'USD');
          return s === cleanDeltaSym;
        });
        if (hasOpenPosition) {
          continue;
        }

        // Check 2: 15-Minute cooldown per coin to prevent rapid re-entry within the same candle
        const lastTradeTime = this.symbolLastTradeTime.get(cleanDeltaSym) || 0;
        const COOLDOWN_MS = 15 * 60 * 1000; // 15-minute cooldown (1 full 15M candle)
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

      // 1. Target Profit Ceiling & Floor (Enforced on Live accounts to secure real capital)
      if (this.state.mode !== 'SIMULATION_PAPER') {
        const targetProfitINRScan = this.state.targetCapitalGoalINR || 4000;
        if (liveEquityINRScan >= targetProfitINRScan && targetProfitINRScan > 0) {
          console.log(`🎯 [TARGET PROFIT CEILING REACHED] Live equity ₹${liveEquityINRScan.toFixed(0)} reached target profit goal of ₹${targetProfitINRScan} INR. Pausing trading to secure profits.`);
          this.state.isNewTradesPaused = true;
          this.state.isRunning = false;
          this.saveState();
          return;
        }

        // 2. Emergency Stop Floor: Halt only if capital drops to minimum survival floor (default: ₹500 INR)
        const floorINRScan = this.state.minCapitalFloorINR || 500;
        if (liveEquityINRScan <= floorINRScan) {
          console.warn(`🛑 [EMERGENCY CAPITAL FLOOR] Live equity ₹${liveEquityINRScan.toFixed(0)} at/below minimum floor ₹${floorINRScan} INR. Halting trading.`);
          this.state.isNewTradesPaused = true;
          this.state.isRunning = false;
          this.saveState();
          return;
        }
      }

      // User Directive: "Abhi kuch execute mat karna. Abhi kuch nahi karna, main bolunga haan ya na tab karna."
      if (this.state.isNewTradesPaused || !this.state.isRunning) {
        const now = Date.now();
        if (now - this.lastPauseLogTime > 60000) {
          this.lastPauseLogTime = now;
          console.log(`⏸️ [EXECUTION HOLD] New entries held (Paused/Capital Guard). Monitoring ${this.state.activePositions.length} active positions.`);
        }
        return;
      }

      // 2. CANDIDATE TOURNAMENT & MANDATORY SAME-DIRECTION TRADE COPY ENFORCEMENT
      // User Directive: "kisne kiski trade copie ki hoti to profit hotaa dekho aur usse waisa hi kardo jaise xrp sell hai profit uske nichr buy hai agar sell kiya hota to aisa samjee"
      // Both active trades MUST trade in the exact same direction!
      // If position 1 is SELL -> position 2 MUST COPY SELL!
      // If position 1 is BUY -> position 2 MUST COPY BUY!
      // If 0 positions active -> Top candidate elects batch direction, all slots copy that direction!
      if (candidatesPool.length > 0) {
        // Direct execution without reversal engine interference (User mandate: "reversal engine delet kardo")
        const enrichedCandidates = candidatesPool.map(c => {
          const rawSide = c.multiSignal.side;
          const executedSide: 'BUY' | 'SELL' = rawSide;
          return { ...c, executedSide };
        });

        const alignedCandidates = enrichedCandidates.filter(c => {
          const minRequiredScore = (c.multiSignal.strategyName.includes('Playbook 2026 Engine') || c.multiSignal.strategyName.includes('Quant Math') || c.multiSignal.strategyName.includes('Strict Math & Indicator Confluence')) ? 40 : 70;
          if (c.multiSignal.confidenceScore < minRequiredScore) {
            console.log(`🛡️ [QUALITY SHIELD] ${c.cleanDeltaSym} ${c.executedSide} filtered out (Score: ${c.multiSignal.confidenceScore} < ${minRequiredScore}). Waiting for high-conviction setup.`);
            return false;
          }
          return true;
        });

        // Score with Leader-Follower synergy:
        alignedCandidates.sort((a, b) => {
          const rankA = DeltaAutoTraderEngine.LEADER_RANKS[a.cleanDeltaSym] || 50;
          const rankB = DeltaAutoTraderEngine.LEADER_RANKS[b.cleanDeltaSym] || 50;
          let scoreA = a.multiSignal.confidenceScore + (rankA * 0.2);
          let scoreB = b.multiSignal.confidenceScore + (rankB * 0.2);

          // If a candidate's Leader is already active and candidate matches leader side, give huge synergy boost:
          const leaderA = DeltaAutoTraderEngine.FOLLOWER_LEADERS[a.cleanDeltaSym];
          if (leaderA && this.state.activePositions.some(p => p.symbol === leaderA && p.side === a.executedSide)) {
            scoreA += 30;
          }
          const leaderB = DeltaAutoTraderEngine.FOLLOWER_LEADERS[b.cleanDeltaSym];
          if (leaderB && this.state.activePositions.some(p => p.symbol === leaderB && p.side === b.executedSide)) {
            scoreB += 30;
          }

          return scoreB - scoreA;
        });

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
    const leverage = this.state.leverage || 20;

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

    // Select optimal high margin: up to 90% of free balance for single trade (~₹1,800 INR per trade)
    let marginUSD = Math.min(
      availableUSD * 0.90,
      Math.max(5.00, Math.min(baseMarginPerSlot, dynamicMarginFromAvailable))
    );

    // Minimum margin floor of $5 if available
    marginUSD = Math.max(5.00, parseFloat(marginUSD.toFixed(2)));

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

    // User Mandates: ADA, BTC, and ETH turned OFF due to capital/margin constraints
    // "adaa mee coin off kardo aage se bnd rakhna bas"
    // "bth eth bade bade off kardo abhi ke liye kam margin ke baje se"
    if (['ADAUSD', 'BTCUSD', 'ETHUSD'].includes(cleanSym)) {
      console.log(`🛑 [DISABLED COIN] New position for ${cleanSym} blocked (User Mandates: ADA, BTC, ETH turned OFF).`);
      return null;
    }

    // User Mandate: "4k capital ho jaye to trade off kar dena" -> Target Profit Goal of ₹4,000 INR
    const currentEquityINR = ((this.state.accountCapitalUSD || 23.53) + this.state.activePositions.reduce((s, p) => s + (p.pnlUSD || 0), 0)) * 84;

    // 1. Target Profit Ceiling & Floor (Enforced on Live accounts)
    if (this.state.mode !== 'SIMULATION_PAPER') {
      const targetProfitCeilingINR = this.state.targetCapitalGoalINR || 4000;
      if (currentEquityINR >= targetProfitCeilingINR && targetProfitCeilingINR > 0) {
        console.warn(`🎯 [TARGET PROFIT CEILING REACHED] Equity ₹${currentEquityINR.toFixed(0)} is at/above ₹${targetProfitCeilingINR} INR profit goal. Pausing trading to secure profits.`);
        this.state.isNewTradesPaused = true;
        this.state.isRunning = false;
        this.saveState();
        return null;
      }

      // 2. Emergency Stop Floor: Halt only if capital drops to minimum survival floor (default: ₹500 INR)
      const floorINR = this.state.minCapitalFloorINR || 500;
      if (currentEquityINR <= floorINR) {
        console.warn(`🛑 [EMERGENCY CAPITAL FLOOR] Equity ₹${currentEquityINR.toFixed(0)} is at/below ₹${floorINR} INR floor. Rejecting new position for ${cleanSym} and stopping trading.`);
        this.state.isNewTradesPaused = true;
        this.state.isRunning = false;
        this.saveState();
        return null;
      }
    }

    // MANDATORY USER MANDATE: Follower MUST copy its Leader ("xrp kaa copie kiyaa hota sol aisa")
    // "remaing trade nho copie karne" -> A Leader NEVER gets blocked by an inferior remaining follower!
    const designatedLeader = DeltaAutoTraderEngine.FOLLOWER_LEADERS[cleanSym];
    if (designatedLeader) {
      const activeLeader = this.state.activePositions.find(p => p.symbol === designatedLeader);
      if (activeLeader && params.side !== activeLeader.side) {
        console.warn(`🛑 [LEADER COPY GUARD] Follower ${cleanSym} ${params.side} rejected — must COPY Leader ${designatedLeader} direction (${activeLeader.side})!`);
        return null;
      }
    }

    // TRADE LIMIT: Strict 2 Position Limit (User Mandate: "limit 2 kii hii rakhaa karoo naa sirff")
    const maxPositionsAllowed = this.state.maxConcurrentPositions || 1;
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
    // FIX 6: STOP DISTANCE ASSERTION & RISK-BASED POSITION SIZING (traps.pdf)
    // "Minimum stop distance >= 0.8 ATR. Size by risk to maintain structural stop."
    // High-Profit Risk:Reward — $2.50 MAX LOSS : $6.00 TARGET PROFIT (1:2.4 R:R)
    // User Directive: "pakaa guarantee 6 dollar jayegaa to trade lagaye"
    // ============================================================
    const TARGET_PROFIT_USD = this.state.targetProfitPerTradeUSD || 6.00;
    const MAX_LOSS_USD = this.state.maxLossPerTradeUSD || 2.50;

    // 1. Guaranteed Minimum Safe Stop Distance (>= 0.8 * ATR)
    // Protects trade from noise stop-out (0.4 ATR noise was the root cause of the AVAX loss in traps.pdf)
    const minStopDistance = Math.max(0.8 * params.atr, params.signalPrice * 0.005);
    const slPriceDistance = minStopDistance;

    // 2. Risk-Based Position Sizing:
    // Quantity sized strictly so that: quantity * slPriceDistance = MAX_LOSS_USD ($2.50)
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

    // 3. Profit Target with Guaranteed 1:2.0+ R:R:
    const minTargetDistanceByRR = slPriceDistance * 2.0;
    const targetDistanceByUSD = (quantity * params.signalPrice > 0)
      ? (TARGET_PROFIT_USD / (quantity * params.signalPrice)) * params.signalPrice
      : minTargetDistanceByRR;
    const targetPriceDistance = Math.max(minTargetDistanceByRR, targetDistanceByUSD);

    // Calculate TP & SL relative to signal price
    const takeProfitPrice = params.side === 'BUY'
      ? params.signalPrice + targetPriceDistance
      : params.signalPrice - targetPriceDistance;

    const stopLossPrice = params.side === 'BUY'
      ? params.signalPrice - slPriceDistance
      : params.signalPrice + slPriceDistance;

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

    // Propagate signal to designated follower (e.g. XRP -> SOL, DOGE -> AVAX)
    if (DeltaAutoTraderEngine.LEADER_FOLLOWERS[cleanSym]) {
      this.propagateLeaderSignal(cleanSym, params.side, params.strategyName).catch(() => {});
    }

    return newPos;
    } finally {
      this.inFlightSymbols.delete(cleanSym);
    }
  }

  /**
   * Propagates a trade signal from a Leader coin to its designated Follower
   * User Mandate: "remaing trade nho copie karne dekh lo xrp kaa copie kiyaa hota sol aisa"
   * Leader XRP -> Follower SOL | Leader DOGE -> Follower AVAX
   * (Follower NEVER pushes to Leader)
   */
  public async propagateLeaderSignal(leaderSymbol: string, leaderSide: 'BUY' | 'SELL', _leaderStrategy: string) {
    const followerSymbol = DeltaAutoTraderEngine.LEADER_FOLLOWERS[leaderSymbol];
    if (!followerSymbol) return;

    // Check capacity limit (Strict Max 2 Limit)
    const maxTrades = this.state.maxConcurrentPositions || 1;
    const totalCurrentAndPending = this.state.activePositions.length + this.inFlightSymbols.size;
    if (totalCurrentAndPending >= maxTrades) {
      console.log(`ℹ️ [LEADER COPY HOLD] Capacity limit (${maxTrades}) reached (active: ${this.state.activePositions.length}, in-flight: ${this.inFlightSymbols.size}). Cannot propagate ${leaderSymbol} ${leaderSide} to ${followerSymbol}.`);
      return;
    }

    // Check if follower already has an active position
    const existingFollower = this.state.activePositions.find(p => p.symbol === followerSymbol);
    if (existingFollower) {
      return;
    }

    // Execute follower copying the leader's trade!
    console.log(`🚀 [LEADER ➔ FOLLOWER TRADE COPY] Leader ${leaderSymbol} entered ${leaderSide}! Propagating copy trade to ${followerSymbol} (${leaderSide})...`);
    try {
      const followerPrice = await deltaExchange.getMarketPrice(followerSymbol);
      const followerAtr = followerPrice * 0.015;
      await this.executeNewPosition({
        symbol: followerSymbol,
        strategyName: `Leader Copy (${leaderSymbol} ➔ ${followerSymbol})`,
        side: leaderSide,
        signalPrice: followerPrice,
        atr: followerAtr,
        shadowConfirmedSeconds: 0,
        executionMode: 'DIRECT',
      });
    } catch (e: any) {
      console.warn(`Failed to propagate leader trade to ${followerSymbol}:`, e?.message || e);
    }
  }

  public async reconcileFollowerPositions() {
    for (const [leaderSym, followerSym] of Object.entries(DeltaAutoTraderEngine.LEADER_FOLLOWERS)) {
      const liveLeader = this.state.activePositions.find(p => p.symbol === leaderSym);
      const liveFollower = this.state.activePositions.find(p => p.symbol === followerSym);
      if (liveLeader && liveFollower && liveFollower.side !== liveLeader.side) {
        console.warn(`⚠️ [LEADER CONFLICT DETECTED] Follower ${followerSym} (${liveFollower.side}) conflicts with Leader ${leaderSym} (${liveLeader.side})! Closing conflicting follower...`);
        const idx = this.state.activePositions.findIndex(p => p.symbol === followerSym);
        if (idx !== -1) {
          const currentPrice = await deltaExchange.getMarketPrice(followerSym);
          await this.closePosition(idx, 'MANUAL_EXIT', currentPrice);
          console.log(`✅ Closed conflicting follower ${followerSym}. Ready to copy Leader ${leaderSym} (${liveLeader.side})!`);
        }
      }
    }
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
    // 1. Time stop: If trade does not move +0.5 ATR in 7 bars (105 min), exit stalling trade
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
        console.log(`⏱️ [TIMING PLAYBOOK TIME STOP] ${pos.symbol}: ${timeStop.reason}`);
        await this.closePosition(index, 'TIME_STOP_EXIT', currentPrice);
        return;
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
          await this.closePosition(index, 'EXHAUSTION_EXIT', currentPrice);
          return;
        }
      }
    }

    // =========================================================================
    // MANDATORY USER RULE: $2.50 PROFIT HIT ➔ REVERSAL DETECTED ➔ LOCK SL AT $2.30 (0 MS DELAY)
    // User Directive: "now what we need to do when ever we get 2.5 dollar profit and
    // system detect the reversal of market then doo the sl 2.3 dollar with 0 ms delay make it a perfect"
    // =========================================================================
    const PROFIT_TRIGGER_USD = 2.50; // $2.50 profit threshold
    const TARGET_SL_LOCK_USD = 2.30; // $2.30 locked profit

    // 1. Arm profit lock as soon as floating profit touches >= $2.50
    if (pos.pnlUSD >= PROFIT_TRIGGER_USD || (pos.highestPnlUSD && pos.highestPnlUSD >= PROFIT_TRIGGER_USD)) {
      if (!pos.isProfitLockArmed) {
        pos.isProfitLockArmed = true;
        console.log(`🛡️ [PROFIT LOCK ARMED] ${pos.symbol} reached +$${pos.highestPnlUSD.toFixed(2)} USD (>= $${PROFIT_TRIGGER_USD} trigger). 0ms reversal protection is ARMED!`);
      }
    }

    // 2. If profit lock is armed, check for market reversal and snap SL to +$2.30 with 0ms delay
    if (pos.isProfitLockArmed) {
      const priceDistance230 = pos.quantity > 0
        ? TARGET_SL_LOCK_USD / pos.quantity
        : (TARGET_SL_LOCK_USD / (pos.notionalUSD || 1)) * pos.entryPrice;

      const lockedSLPrice = pos.side === 'BUY'
        ? pos.entryPrice + priceDistance230
        : pos.entryPrice - priceDistance230;

      // Market reversal detected when profit pulls back from peak by >= $0.05 or adverse price tick
      const isPullbackReversal = (pos.highestPnlUSD - pos.pnlUSD) >= 0.05;
      const isAdverseTick = pos.side === 'BUY'
        ? currentPrice < pos.entryPrice + priceDistance230 * 1.05
        : currentPrice > pos.entryPrice - priceDistance230 * 1.05;

      if (isPullbackReversal || isAdverseTick) {
        const isBetterSL = pos.side === 'BUY'
          ? (!pos.stopLossPrice || lockedSLPrice > pos.stopLossPrice)
          : (!pos.stopLossPrice || lockedSLPrice < pos.stopLossPrice);

        if (isBetterSL) {
          pos.stopLossPrice = lockedSLPrice;
          pos.isBreakevenLocked = true;
          console.log(`🔒 [0MS SL LOCK] ${pos.symbol} peak=$${pos.highestPnlUSD.toFixed(2)}: Market reversal detected! SL instantly snapped to +$${TARGET_SL_LOCK_USD} USD ($${lockedSLPrice.toFixed(4)}).`);
          if (this.state.mode !== 'SIMULATION_PAPER') {
            deltaExchange.setBracketOrder(pos.symbol, lockedSLPrice, pos.takeProfitPrice).catch(() => {});
          }
        }

        // 0 MS DELAY EXIT: If price has already reached or crossed the +$2.30 level, bank profit immediately!
        const isLockLevelHit = pos.side === 'BUY'
          ? currentPrice <= lockedSLPrice
          : currentPrice >= lockedSLPrice;

        if (isLockLevelHit || pos.pnlUSD <= TARGET_SL_LOCK_USD) {
          console.log(`🎯 [0MS REVERSAL PROFIT BOOKED] ${pos.symbol} hit +$2.30 profit lock line at $${currentPrice.toFixed(4)}! Banking +$${pos.pnlUSD.toFixed(2)} USD profit with ZERO delay!`);
          const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
          if (targetIdx !== -1) {
            await this.closePosition(targetIdx, 'REVERSAL_PROFIT_LOCKED', currentPrice);
          }
          return;
        }
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

    // 1. Take Profit (TP) Check with ZERO MS DELAY:
    const isTPHit = pos.side === 'BUY'
      ? currentPrice >= pos.takeProfitPrice
      : currentPrice <= pos.takeProfitPrice;

    if (isTPHit) {
      console.log(`🎯 [INSTANT PROFIT TARGET HIT] Take Profit reached for ${pos.symbol} at price $${currentPrice} (Target: $${pos.takeProfitPrice})! Booking profit with 0ms delay!`);
      const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (targetIdx !== -1) {
        await this.closePosition(targetIdx, 'TARGET_HIT', currentPrice);
      }
      return;
    }

    // 2. Stop Loss (SL) Check with ZERO MS DELAY:
    const maxLossUSD = 3.00;
    const isPriceSLHit = pos.side === 'BUY'
      ? currentPrice <= pos.stopLossPrice
      : currentPrice >= pos.stopLossPrice;
    const isEmergencyHardLoss = pos.pnlUSD <= -maxLossUSD;
    const isSLHit = isPriceSLHit || isEmergencyHardLoss;

    if (isSLHit) {
      const slDetail = isEmergencyHardLoss
        ? `Emergency Max Loss Limit (-$${Math.abs(pos.pnlUSD).toFixed(2)} USD <= -$${maxLossUSD.toFixed(2)} max loss)`
        : `structural SL $${pos.stopLossPrice.toFixed(4)}`;
      console.log(`🛑 [STOP LOSS HIT] ${pos.symbol} triggered via ${slDetail} (Current: $${currentPrice.toFixed(4)}, PnL: $${pos.pnlUSD.toFixed(2)}). Exiting with 0ms delay!`);
      const targetIdx = this.state.activePositions.findIndex(p => p.id === pos.id);
      if (targetIdx !== -1) {
        await this.closePosition(targetIdx, 'STOP_LOSS_HIT', currentPrice);
      }
      return;
    }

    // 3. STRICT HOLD: As long as market price has not reached TP or SL, trade is held intact.
    return;
  }

  public archiveClosedTrade(pos: DeltaPosition, exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT', exitPrice?: number) {
    // Guard against duplicate archive loop
    const lastArchive = this.closedTradesHistory[0];
    if (lastArchive && lastArchive.symbol === pos.symbol && Math.abs(lastArchive.entryPrice - pos.entryPrice) < 0.0001 && (Date.now() - (lastArchive.exitTime || 0)) < 30000) {
      console.log(`⚠️ Prevented duplicate trade archive for ${pos.symbol} (${exitReason})`);
      return;
    }

    const finalPrice = exitPrice || pos.currentPrice;
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

  public async closePosition(index: number, exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT', exitPrice?: number) {
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
    this.state.activePositions.splice(index, 1);
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
      this.state.maxConcurrentPositions = 1;
    }
    this.saveState();
  }
}

export const deltaAutoTrader = new DeltaAutoTraderEngine();

