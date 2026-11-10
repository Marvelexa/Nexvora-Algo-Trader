export interface LiveTrade {
  id: number;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
  latencyMs: number;
}

export interface LatencyMetric {
  lastPingMs: number;
  lastTickTime: number;
  engineDelayMs: number;
  ticksPerSecond: number;
  streamMode: '0MS_DIRECT_AGG_TRADE' | 'REST_FALLBACK';
}

export interface CryptoTicker {
  symbol: string;
  price: number;
  changePercent24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  askPrice: number;
  bidPrice: number;
  count?: number;
  lastTickDirection?: 'UP' | 'DOWN' | 'EQUAL';
}

export type RuleType = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'RANGE_OCO';

export interface AutoSellRule {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  ruleType: RuleType;
  triggerPrice: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  trailingPercent?: number;
  trailingPeakPrice?: number;
  amount: number;
  amountPercent: number;
  entryPrice: number;
  orderType: 'MARKET' | 'LIMIT';
  status: 'ACTIVE' | 'PAUSED' | 'TRIGGERED' | 'EXECUTED' | 'CANCELLED';
  createdAt: number;
  triggeredAt?: number;
  executedPrice?: number;
  pnlPercent?: number;
  executionNote?: string;
}

export interface ExecutedOrder {
  id: string;
  ruleId?: string;
  symbol: string;
  side: 'SELL' | 'BUY';
  type: 'MARKET' | 'LIMIT';
  price: number;
  quantity: number;
  totalUsdt: number;
  timestamp: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'FILLED' | 'SIMULATED_FILLED' | 'FAILED';
  triggerReason: string;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

export interface KlinePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AccountCredentialStatus {
  hasApiKey: boolean;
  hasApiSecret: boolean;
  maskedApiKey: string;
  endpoint: string;
  exchangeName: string;
  region?: 'INDIA' | 'GLOBAL';
}

export interface ExchangeStatus {
  hasApiKey: boolean;
  hasApiSecret: boolean;
  maskedApiKey: string;
  exchange: string;
  isSimulation: boolean;
  isTestnet?: boolean;
  tradingMode?: 'DELTA_TESTNET' | 'LIVE_DELTA_INDIA' | 'LIVE_DELTA_GLOBAL' | 'SIMULATION_PAPER';
  activeMode?: 'DELTA_TESTNET' | 'LIVE_DELTA_INDIA' | 'LIVE_DELTA_GLOBAL' | 'SIMULATION_PAPER';
  endpoint?: string;
  connected?: boolean;
  error?: string;
  updatedAt?: number;
  demo?: AccountCredentialStatus;
  live?: AccountCredentialStatus;
}

export interface AssetBalance {
  asset: string;
  free: string;
  locked: string;
}

// ----------------------------------------------------
// DELTA AUTOTRADER ARCHITECTURE BLUEPRINT TYPES
// ----------------------------------------------------

export interface DeltaPosition {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  marginUSD: number;
  notionalUSD: number;
  leverage: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  initialStopLossPrice: number;
  atr: number;
  isBreakevenLocked: boolean;
  pnlUSD: number;
  pnlPercent: number;
  exchangePnl?: number;
  entryTime: number;
  strategyName: string;
  shadowConfirmedSeconds: number;
  executionMode?: TradeExecutionMode;
  reversalReason?: string;
  highestPnlUSD?: number;
  isProfitLockArmed?: boolean;
  instrumentType?: string;
  optionType?: 'CALL' | 'PUT';
  strike?: number;
  expiry?: string;
  tp1Price?: number;
  tp2Price?: number;
  tp1Ratio?: number;
  tp2Ratio?: number;
  tp1Hit?: boolean;
  earlyBreakevenPrice?: number;
  riskDistance?: number;
  isRiskRecycled?: boolean;
  peakPriceReached?: number;
  peakRReached?: number;
  ratchetStage?: number;
  opposingZonePrice?: number;
  roomToRunDistance?: number;
  isFastScalp?: boolean;
  slotType?: 'FAST_SCALP' | 'SNIPER_RUNNER';
  tier?: 'STRONG_23PCT_RUNNER' | 'NORMAL_5_TO_8_USD_SCALP';
  seatBucket?: 'CHOP_15PCT_SEAT' | 'NORMAL_23_TO_40PCT_SEAT' | 'OPTION_UNCAPPED_SEAT' | 'BIG_SIGNAL_SEAT' | 'OPTION_SEAT' | 'CHOP_NORMAL_SEAT';
  expectedRoePct?: number;
  grossRoePct?: number;
  netRoeAfterFeesPct?: number;
  breakevenPlusFeeTriggerPrice?: number;
  breakevenPlusFeeLockPrice?: number;
  runner23PctTriggerPrice?: number;
  runner18PctLockPrice?: number;
  optionTrailingPeakPrice?: number;
  optionTickSize?: number;
  spotSlPrice?: number;
  spotTpPrice?: number;
  spotEntryPrice?: number;
  underlyingAsset?: 'BTC' | 'ETH';
  trailTriggerPrice?: number;
  trailActivationPrice?: number;
  trailLockPrice?: number;
  customSL?: number;
  targetProfitUSD?: number;
}

export interface DeltaClosedTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  quantity: number;
  marginUSD: number;
  notionalUSD: number;
  pnlUSD: number;
  pnlPercent: number;
  rMultiple: number;
  exitReason: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'BREAKEVEN_HIT' | 'MANUAL_EXIT' | 'EXCHANGE_CLOSED' | 'REVERSAL_PROFIT_LOCKED' | 'TIME_STOP_EXIT' | 'EXHAUSTION_EXIT' | 'REVERSAL_EXIT_EARLY' | 'WALL_REVERSAL_EXIT' | 'REVERSAL_WALL_HIT';
  entryTime: number;
  exitTime: number;
  durationMs: number;
  strategyName: string;
}

export interface DeltaFilteredTrap {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  strategyName: string;
  signalPrice: number;
  exitPrice: number;
  reason: string;
  branch: 'BRANCH_A_FAKEOUT' | 'BRANCH_B_TIMEOUT';
  capitalSavedUSD: number;
  timestamp: number;
  cancelledOrderId?: string;
}

export interface DeltaShadowCandidate {
  symbol: string;
  strategyName: string;
  side: 'BUY' | 'SELL';
  signalPrice: number;
  currentPrice: number;
  atr: number;
  firstSeenTime: number;
  qualifyingSeconds: number;
  virtualPnlUSD: number;
  status: 'OBSERVING' | 'QUALIFIED' | 'DISCARDED' | 'EXECUTED';
  invalidationPrice: number;
  virtualTP?: number;
  virtualSL?: number;
  virtualBEPrice?: number;
  isVirtualBELocked?: boolean;
  trailingSLPrice?: number;
  targetMult?: number;
  slMult?: number;
  isVirtualTradeActive?: boolean;
  tradeOutcome?: string;
  branch?: 'BRANCH_A_FAKEOUT' | 'BRANCH_B_TIMEOUT' | 'BRANCH_C_CONFIRMED' | 'MONITORING';
  timeRemainingSeconds?: number;
  atrDistance?: number;
  favorableTargetPrice?: number;
  adverseThresholdPrice?: number;
  timeoutMs?: number;
  pendingDeltaOrderId?: string;
  pendingOrderPrice?: number;
  pendingOrderStatus?: 'PENDING_BREAKOUT' | 'FILLED' | 'CANCELLED';
  pendingContracts?: number;
  targetProfitUSD?: number;
  firstProfitTime?: number;
  firstLossTime?: number;
  sustainedProfitSeconds?: number;
  sustainedLossSeconds?: number;
}

export interface AssetDiagnostics {
  symbol: string;
  price: number;
  strategyName: string;
  trend100Ema: number;
  isTrendBullish: boolean;
  counterTrendBlocked: boolean;
  chopIndex: number;
  isAntiChopShieldActive: boolean;
  adx?: number;
  isAdxChopActive?: boolean;
  rsi5?: number;
  rsi14?: number;
  bbUpper?: number;
  bbLower?: number;
  bbMiddle?: number;
  waveValue?: number;
  waveSignal?: number;
  nexPredict?: any;
  emaRibbon?: { ema20: number; ema50: number; ema100: number };
  atr: number;
  armedBarsRemaining: number;
  lastCandlePattern?: string;
  isInstitutionalCandle: boolean;
  qualityScore?: number;
  readySignal?: 'BUY' | 'SELL' | null;
  signalReason?: string;
  smartDetector?: SmartAdaptiveReversalResult;
  executionMode?: TradeExecutionMode;
  reversalReason?: string;
  higherTfAnalysis?: {
    timeframe: '1h' | '4h';
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    ema50: number;
    candlePattern: string;
    confluence: boolean;
  };
  quantMath?: {
    quantScore: number;
    recommendedSide: 'BUY' | 'SELL' | null;
    marketRegime: 'TRENDING_PERSISTENT' | 'MEAN_REVERTING' | 'RANDOM_WALK_CHOP' | 'TREND' | 'RANGE' | 'CHAOS_NO_TRADE' | 'VOL_EXTREME_DANGER';
    hurstExponent: number;
    fisherTransform: number;
    fisherSignal: number;
    superSmootherPrice: number;
    superSmootherSlope: number;
    kalmanEstimate: number;
    kalmanDeviationPct: number;
    efficiencyRatio: number;
    zScore: number;
    reasons: string[];
  };
  priceActionPlaybook?: any;
  chopAnalysis?: any;
  trapAnalysis?: any;
  timingAnalysis?: any;
  activeCandleGate?: {
    barColor: 'GREEN' | 'RED' | 'DOJI';
    barOpen: number;
    currentPrice: number;
    diffUSD: number;
    diffPct: number;
    isVetoActive: boolean;
    vetoReason: string;
    nextBarCloseMs: number;
    secondsToClose: number;
    executionStatus: 'IN_TRADE' | 'ARMED_WAITING_GATE' | 'READY_TO_ENTER' | 'SCANNING_BUILDING' | 'WAIT';
  };
  xrpHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    scaledWave?: number;
    scaledSignal?: number;
    scaledHist?: number;
    fastZlema?: number;
    slowZlema?: number;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
  };
  btcHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    scaledWave?: number;
    scaledSignal?: number;
    scaledHist?: number;
    fastZlema?: number;
    slowZlema?: number;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    forwardForecast?: string;
    entryPrice?: number;
    chopStatus?: string;
    trendContext?: string;
  };
  adaHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    scaledWave?: number;
    scaledSignal?: number;
    scaledHist?: number;
    fastZlema?: number;
    slowZlema?: number;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    forwardForecast?: string;
    entryPrice?: number;
    chopStatus?: string;
    trendContext?: string;
    trendEma80?: number;
  };
  avaxHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    bbUpper?: number;
    bbLower?: number;
    bbBasis?: number;
    fastRsi?: number;
    rsiStatus?: string;
    tpTarget?: string;
    slTarget?: string;
    breakEvenStatus?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    entryPrice?: number;
    chopStatus?: string;
  };
  dogeHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    fastZlema?: number;
    slowZlema?: number;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    forwardForecast?: string;
    entryPrice?: number;
    chopStatus?: string;
    trendContext?: string;
    trendEma100?: number;
    extremeThreshold?: number;
  };
  ethHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    fastZlema?: number;
    slowZlema?: number;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    entryPrice?: number;
    chopStatus?: string;
    trendContext?: string;
    trendEma90?: number;
    bbUpper?: number;
    bbLower?: number;
    fastRsi?: number;
    extremeThreshold?: number;
  };
  solHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    fastZlema?: number;
    slowZlema?: number;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    entryPrice?: number;
    chopStatus?: string;
    trendContext?: string;
    trendEma100?: number;
    extremeThreshold?: number;
    beStatus?: string;
    trailStatus?: string;
  };
  suiHud?: {
    winRate: string;
    netProfit: string;
    aiStatus: string;
    tpDistance: string;
    slDistance: string;
    profitGuard: string;
    tpTarget?: string;
    slTarget?: string;
    institutionalWinRate?: string;
    institutionalNetProfit?: string;
    entryPrice?: number;
    chopStatus?: string;
    bbUpper?: number;
    bbLower?: number;
    bbBasis?: number;
    fastRsi?: number;
    rsiStatus?: string;
    beStatus?: string;
  };
}

export interface DeltaAutoTraderState {
  activeSystem?: string;
  isRunning: boolean;
  mode: 'LIVE_DELTA_INDIA' | 'DELTA_TESTNET' | 'SIMULATION_PAPER';
  accountCapitalUSD: number;
  currentCapitalUSD: number;
  dailyRealizedPnlUSD: number;
  totalRealizedPnlUSD: number;
  totalTradesCount: number;
  winningTradesCount: number;
  losingTradesCount: number;
  winRatePercent: number;
  activePositions: DeltaPosition[];
  maxConcurrentPositions: number;
  leverage: number;
  marginPercentPerTrade: number;
  lastScanTimestamp: number;
  scanIntervalSeconds: number;
  shadowGateEnabled: boolean;
  activeShadowCandidates: DeltaShadowCandidate[];
  trapsFilteredCount: number;
  capitalSavedUSD: number;
  isInverseTrading?: boolean;
  isNewTradesPaused?: boolean; // When true: monitor existing trades for TP/SL, hold new entries until user approval
  smartDetectorEnabled?: boolean;
  smartAdaptiveMode?: boolean;
  smartDetectorSummary?: {
    activeMode: 'SMART_ADAPTIVE' | string;
    directTradesCount: number;
    reversedTradesCount: number;
    filteredChopCount: number;
  };
  minCapitalFloorINR?: number; // Minimum capital floor in INR before halting (e.g. 500)
  targetCapitalGoalINR?: number; // Target profit ceiling in INR (e.g. 4000) to secure profits and pause
  maxLossPerTradeUSD?: number; // Max loss per trade in USD (e.g. 2.50)
  targetProfitPerTradeUSD?: number; // Target profit per trade in USD (e.g. 6.00)
  recentFilteredTraps?: DeltaFilteredTrap[];
  lastError?: string;
}

export type MarketRegime = 'STRONG_TREND_MOMENTUM' | 'EXHAUSTION_CLIMAX' | 'CHOP_SIDEWAYS';
export type TradeExecutionMode = 'DIRECT' | 'SMART_REVERSED' | 'FILTERED_CHOP' | 'INVERSE_RAW';

export interface SmartAdaptiveReversalResult {
  regime: MarketRegime;
  executionMode: TradeExecutionMode;
  effectiveSide: 'BUY' | 'SELL' | null;
  originalSide: 'BUY' | 'SELL' | null;
  confidence: number;
  reason: string;
  directReason?: string;
  reversalReason?: string;
  indicators: {
    rsi14: number;
    adx: number;
    atr: number;
    distanceFromEma20Atr: number;
    bbUpper: number;
    bbLower: number;
    bbBasis: number;
    isBbPierced: boolean;
    volumeRatio: number;
    isVolumeDeclining: boolean;
    isEmaStackedBullish: boolean;
    isEmaStackedBearish: boolean;
    exhaustionPattern?: string;
  };
}

export interface DetectedCandlePattern {
  name: string;
  category: 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'MULTI_BAR' | 'CONTINUATION';
  signal: 'BUY' | 'SELL';
  confidence: number;
  description: string;
  candleIndex: number;
  triggerPrice: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  patternBars: number;
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

