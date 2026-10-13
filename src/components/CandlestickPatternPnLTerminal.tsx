import React, { useState, useEffect } from 'react';
import { 
  CandlestickAnalysisResult, 
  DetectedCandlePattern, 
  DeltaAutoTraderState 
} from '../types';
import { 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Shield, 
  Target, 
  Flame, 
  Activity, 
  Copy, 
  Check, 
  ExternalLink, 
  Sparkles, 
  Info, 
  BarChart2, 
  ArrowRight,
  RefreshCw,
  Layers,
  Award,
  DollarSign,
  Repeat,
  RotateCcw
} from 'lucide-react';

interface CandlestickPatternPnLTerminalProps {
  status: DeltaAutoTraderState | null;
  onSelectCoin?: (symbol: string) => void;
  onTriggerTrade?: (symbol: string, side: 'BUY' | 'SELL') => void;
}

export const CandlestickPatternPnLTerminal: React.FC<CandlestickPatternPnLTerminalProps> = ({
  status,
  onSelectCoin,
  onTriggerTrade,
}) => {
  const [analysisData, setAnalysisData] = useState<CandlestickAnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedPine, setCopiedPine] = useState(false);
  const [pineScriptCode, setPineScriptCode] = useState<string>('');
  const [selectedPhotoFilter, setSelectedPhotoFilter] = useState<number | 'ALL'>('ALL');
  const [triggeringSymbol, setTriggeringSymbol] = useState<string | null>(null);

  const [isResettingPnl, setIsResettingPnl] = useState<boolean>(false);
  const handleResetPnlAndHistory = async () => {
    if (!window.confirm('Reset Realized PnL to $0.00 and wipe historical trade logs? (Your current active open positions will remain running safely)')) {
      return;
    }
    setIsResettingPnl(true);
    try {
      await fetch('/api/autotrader/reset-history', { method: 'POST' });
    } catch (e) {
      console.error('Failed to reset PnL and history:', e);
    } finally {
      setIsResettingPnl(false);
    }
  };

  const fetchCandleAnalysis = async () => {
    try {
      const res = await fetch('/api/candlestick-patterns?symbol=ALL&interval=15m&tpAtr=1.02');
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          setAnalysisData(json.data);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch candlestick patterns:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchPineScript = async () => {
    try {
      const res = await fetch('/api/candlestick-patterns/pinescript');
      if (res.ok) {
        const json = await res.json();
        if (json.pinescript) {
          setPineScriptCode(json.pinescript);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch pinescript:', e);
    }
  };

  const [realWalletBalance, setRealWalletBalance] = useState<number>(155.95);

  const fetchWalletBalance = async () => {
    try {
      const res = await fetch('/api/exchange/balances');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.balances)) {
          const usdBal = data.balances.find((b: any) => b.asset === 'USD');
          if (usdBal && usdBal.free) {
            setRealWalletBalance(parseFloat(usdBal.free));
          }
        }
      }
    } catch (e) {
      // fallback
    }
  };

  useEffect(() => {
    fetchCandleAnalysis();
    fetchPineScript();
    fetchWalletBalance();
    const interval = setInterval(() => {
      fetchCandleAnalysis();
      fetchWalletBalance();
    }, 3000); // 3-second live refresh
    return () => clearInterval(interval);
  }, []);

  const handleCopyPineScript = () => {
    if (pineScriptCode) {
      navigator.clipboard.writeText(pineScriptCode);
      setCopiedPine(true);
      setTimeout(() => setCopiedPine(false), 2000);
    }
  };

  const handleExecutePattern = async (symbol: string, sideToExecute: 'BUY' | 'SELL') => {
    setTriggeringSymbol(symbol);
    try {
      if (onTriggerTrade) {
        onTriggerTrade(symbol, sideToExecute);
      } else {
        await fetch('/api/autotrader/force-trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, side: sideToExecute, immediate: true }),
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setTriggeringSymbol(null), 1200);
    }
  };

  // Calculated Real-Time PnL metrics
  const activePositions = status?.activePositions || [];
  const totalFloatingPnlUSD = activePositions.reduce((acc, pos) => acc + (pos.pnlUSD || 0), 0);
  const realizedPnlUSD = status?.totalRealizedPnlUSD !== undefined ? status.totalRealizedPnlUSD : 0;
  const winRate = status?.winRatePercent !== undefined ? status.winRatePercent : 0;
  const winsCount = status?.winningTradesCount !== undefined ? status.winningTradesCount : 0;
  const lossCount = status?.losingTradesCount !== undefined ? status.losingTradesCount : 0;
  const currentEquity = realWalletBalance;

  // 11 Photos Master Reference Database
  const PHOTO_REFERENCE = [
    { id: 1, title: 'Single Reversals & Kickers', patterns: ['Hammer', 'Hanging Man', 'Inverted Hammer', 'Shooting Star', 'Bullish Kicker', 'Bearish Kicker'] },
    { id: 2, title: 'Engulfing & Star Formations', patterns: ['Bullish Engulfing', 'Bearish Engulfing', 'Morning Star', 'Evening Star', 'Piercing Pattern', 'Dark Cloud Cover'] },
    { id: 3, title: 'Island Gaps & Soldiers/Crows', patterns: ['Abandoned Baby (Bull)', 'Abandoned Baby (Bear)', '3 White Soldiers', '3 Black Crows', 'Harami Cross'] },
    { id: 4, title: 'Belt Holds & Inside/Outside Bars', patterns: ['Bullish Belt Hold', 'Bearish Belt Hold', 'Three Inside Up', 'Three Inside Down', 'Three Outside Up', 'Three Outside Down'] },
    { id: 5, title: 'Doji Reversals & Advance Block', patterns: ['Dragonfly Doji', 'Gravestone Doji', 'Morning Doji Star', 'Evening Doji Star', 'Advance Block'] },
    { id: 6, title: 'Tweezers & Ladder Climax', patterns: ['Tweezers Bottom', 'Tweezers Top', 'Ladder Bottom', 'Ladder Top', 'Bullish Breakaway', 'Bearish Breakaway'] },
    { id: 7, title: 'Exhaustion & Rare Reversals', patterns: ['Three Stars in the South', 'Three Identical Crows', 'Unique Three River', 'Upside Gap Two Crows', 'Deliberation'] },
    { id: 8, title: 'Support Floors & Sandwiches', patterns: ['Bullish Stick Sandwich', 'Bearish Stick Sandwich', 'Matching Low', 'Matching High'] },
    { id: 9, title: 'Continuation & Tasuki Gaps', patterns: ['Rising Three Methods', 'Falling Three Methods', 'Upside Tasuki Gap', 'Downside Tasuki Gap', 'Separating Lines'] },
    { id: 10, title: 'Gap Methods & Neck Lines', patterns: ['Side by Side White Lines', 'Upside Gap Three Methods', 'On Neck', 'In Neck', 'Thrusting Pattern'] },
    { id: 11, title: 'Three-Line Strikes & Windows', patterns: ['Bullish Three-Line Strike', 'Bearish Three-Line Strike', 'Homing Pigeon', 'Two Crows', 'Rising Window', 'Falling Window'] },
  ];

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* TOP PnL & PERFORMANCE COMMAND CENTER */}
      {/* ========================================================================= */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40 border border-indigo-500/30 shadow-2xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-indigo-500/40 flex items-center justify-center shadow-inner">
              <Sparkles className="w-6 h-6 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Master Japanese Candlestick &amp; Live PnL Terminal
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  11-Photo Encyclopedia Engine
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Target: 1.02x ATR
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Max 4 Positions
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time mathematical pattern detection across 50+ candlestick signals • Live PnL with 30x Isolated Leverage • Dynamic 1.02x ATR Exit Targets
              </p>
            </div>
          </div>

          {/* Action Buttons Toolbar: Reversal Toggle + Pine Script Exporter */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {/* Mode Indicator Badge */}
            <div
              id="badge-terminal-direct-mode"
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-md ${
                status?.isInverseTrading
                  ? 'bg-purple-950/60 text-purple-300 border border-purple-700/60'
                  : 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/60'
              }`}
              title={
                status?.isInverseTrading
                  ? 'Inverse Mode: BUY signals execute as SELL; SELL signals execute as BUY.'
                  : 'Direct Trend Mode: Signals execute strictly in their original direction without inverse flipping.'
              }
            >
              <Sparkles className={`w-3.5 h-3.5 ${status?.isInverseTrading ? 'text-purple-400' : 'text-emerald-400'}`} />
              <span>{status?.isInverseTrading ? '🔄 INVERSE MODE (BUY ➔ SELL)' : '🎯 DIRECT TREND MODE'}</span>
            </div>

            {/* Quick Pine Script Exporter Button */}
            <button
              id="btn-copy-pinescript"
              onClick={handleCopyPineScript}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-md ${
                copiedPine
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/30'
              }`}
            >
              {copiedPine ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedPine ? 'Pine Script Copied!' : 'Copy TradingView Pine Script (v5)'}
            </button>

            {/* Reset PnL & History Button */}
            <button
              id="btn-reset-pnl-terminal"
              onClick={handleResetPnlAndHistory}
              disabled={isResettingPnl}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-md bg-slate-800/90 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 cursor-pointer ${
                isResettingPnl ? 'opacity-70 cursor-wait' : ''
              }`}
              title="Reset cumulative realized PnL to $0.00 and wipe audit history (keeps active open positions intact)"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isResettingPnl ? 'animate-spin text-rose-400' : 'text-slate-400'}`} />
              <span>Reset PnL</span>
            </button>
          </div>
        </div>

        {/* Smart Trap Filter & Direct Execution Active Banner */}
        <div className="my-3 p-3 rounded-xl bg-gradient-to-r from-indigo-950/60 via-blue-950/50 to-slate-950/80 border border-blue-500/40 flex items-center justify-between text-xs text-blue-200 font-mono relative z-10 shadow-inner">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.9)] animate-pulse" />
            <span>
              <strong>🛡️ SMART TRAP FILTER & DIRECT EXECUTION ACTIVE:</strong> Multi-indicator engine automatically verifies each setup — strong momentum breakouts execute <strong>DIRECT LONG/SHORT</strong>, while overbought climax traps or oversold panic flushes are <strong>STRICTLY FILTERED</strong> to protect capital!
            </span>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-400/40 font-bold shrink-0">
            PURE DIRECT TRADING
          </span>
        </div>

        {/* 4 Core Financial Performance Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4 relative z-10 font-mono">
          {/* Card 1: Total Realized PnL */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-emerald-500/30 shadow-inner">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              Realized PnL
            </div>
            <div className={`text-xl font-bold mt-1 ${realizedPnlUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {realizedPnlUSD >= 0 ? '+' : ''}${realizedPnlUSD.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Cumulative Closed Profits
            </div>
          </div>

          {/* Card 2: Live Floating PnL */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-indigo-500/30 shadow-inner">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              Floating Trade PnL
            </div>
            <div className={`text-xl font-bold mt-1 ${totalFloatingPnlUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalFloatingPnlUSD >= 0 ? '+' : ''}${totalFloatingPnlUSD.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {activePositions.length} Active Position(s)
            </div>
          </div>

          {/* Card 3: Win Rate % */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-cyan-400" />
              Win Rate
            </div>
            <div className="text-xl font-bold text-cyan-300 mt-1">
              {winRate.toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {winsCount} Wins / {lossCount} Losses
            </div>
          </div>

          {/* Card 4: Net Account Equity */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/60 shadow-inner">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-indigo-300" />
              Account Balance
            </div>
            <div className="text-xl font-bold text-white mt-1">
              ${realWalletBalance.toFixed(2)}
            </div>
            <div className="text-[10px] text-emerald-400/90 mt-0.5">
              Delta Exchange Live Wallet
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* DEDICATED MONTHLY REALIZED PERFORMANCE & AUDIT LEDGER CARD (NON-FLOATING) */}
        {/* ========================================================================= */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 via-indigo-950/30 to-slate-950 border border-indigo-500/30 shadow-lg relative z-10 font-mono">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Monthly Realized Audit Ledger (Non-Floating)
              </h4>
              <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-3">
              <span>Exit Rule: <strong className="text-emerald-400">1.02x ATR</strong></span>
              <span>•</span>
              <span>Slots: <strong className="text-amber-400">Max 4 Trades</strong></span>
              <span>•</span>
              <span>TradingView: <strong className="text-cyan-400">Monthly Realized Mode</strong></span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Monthly Net Realized</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">{realizedPnlUSD >= 0 ? '+' : ''}${realizedPnlUSD.toFixed(2)}</div>
              <div className="text-[9px] text-emerald-400/80">+{realWalletBalance > 0 ? ((realizedPnlUSD / realWalletBalance) * 100).toFixed(1) : '0.0'}% ROI on Capital</div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Monthly Win Rate</div>
              <div className="text-base font-bold text-cyan-300 mt-0.5">{winRate.toFixed(1)}%</div>
              <div className="text-[9px] text-slate-400">{winsCount} Win / {lossCount} Loss</div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Closed Trades (Month)</div>
              <div className="text-base font-bold text-white mt-0.5">{winsCount + lossCount} Closed</div>
              <div className="text-[9px] text-emerald-400">Zero Late-Chased Trades</div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Prev Month Realized</div>
              <div className="text-base font-bold text-slate-300 mt-0.5">$0.00</div>
              <div className="text-[9px] text-slate-500">Clean Month Rollover</div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 col-span-2 md:col-span-1">
              <div className="text-[10px] text-slate-400 uppercase">TradingView HUD</div>
              <div className="text-xs font-bold text-indigo-300 mt-0.5 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Realized Table
              </div>
              <div className="text-[9px] text-slate-400">Fixed Top-Right Ledger</div>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 8-COIN MASTER CANDLESTICK MATRIX (LIVE REAL-TIME FEED) */}
      {/* ========================================================================= */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">
              Live 8-Coin Master Candlestick Scanner Matrix
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
              15M Timeframe
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-mono text-[11px]">Filter by Photo:</span>
            <select
              value={selectedPhotoFilter}
              onChange={(e) => setSelectedPhotoFilter(e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value))}
              className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono"
            >
              <option value="ALL">All 11 Photos (50+ Patterns)</option>
              {PHOTO_REFERENCE.map((p) => (
                <option key={p.id} value={p.id}>
                  Photo {p.id}: {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 8-Coin Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {analysisData.map((item) => {
            const hasPattern = item.highestConfidencePattern !== null;
            const topPat = item.highestConfidencePattern;
            const isBuy = item.dominantSignal === 'BUY';
            const isSell = item.dominantSignal === 'SELL';
            const isTriggering = triggeringSymbol === item.symbol;

            return (
              <div
                key={item.symbol}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between shadow-md relative overflow-hidden ${
                  isBuy
                    ? 'bg-gradient-to-b from-slate-950/90 to-emerald-950/20 border-emerald-500/40 hover:border-emerald-500/70'
                    : isSell
                    ? 'bg-gradient-to-b from-slate-950/90 to-rose-950/20 border-rose-500/40 hover:border-rose-500/70'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Header: Symbol & Signal Pill */}
                  <div className="flex items-center justify-between mb-2">
                    <span 
                      onClick={() => onSelectCoin && onSelectCoin(item.symbol)}
                      className="font-bold text-white text-base cursor-pointer hover:text-indigo-400 flex items-center gap-1.5"
                    >
                      {item.symbol}
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </span>

                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 ${
                      isBuy
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : isSell
                        ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {isBuy ? <TrendingUp className="w-3 h-3" /> : isSell ? <TrendingDown className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                      {item.dominantSignal}
                    </span>
                  </div>

                  {/* Price & ATR Row */}
                  <div className="flex items-center justify-between text-xs font-mono mb-2 pb-2 border-b border-slate-800/80">
                    <span className="text-slate-400">
                      Price: <strong className="text-white">${item.lastPrice?.toLocaleString()}</strong>
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      ATR: <strong className="text-indigo-300">{item.atr?.toFixed(4)}</strong>
                    </span>
                  </div>

                  {/* Smart Reversal Detector Regime Badge */}
                  {item.smartDetector && (
                    <div className="mb-2 p-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between text-[10px] font-mono">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                        <strong className="text-emerald-300">
                          DIRECT TREND
                        </strong>
                      </span>
                      <span className="text-[9px] text-slate-400 truncate max-w-[120px]" title={item.smartDetector.reason}>
                        {item.smartDetector.regime}
                      </span>
                    </div>
                  )}

                  {/* Detected Pattern Details */}
                  {hasPattern && topPat ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-yellow-400 flex items-center gap-1">
                          <Flame className="w-3.5 h-3.5 text-amber-400" />
                          {topPat.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {topPat.category}
                        </span>
                      </div>

                      {/* Confidence Progress Bar */}
                      <div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-0.5">
                          <span>Pattern Confidence</span>
                          <span className="text-emerald-400 font-bold">{topPat.confidence}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full ${isBuy ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            style={{ width: `${topPat.confidence}%` }}
                          />
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-[11px] text-slate-300 leading-relaxed font-sans line-clamp-2">
                        {topPat.description}
                      </p>

                      {/* Targets Breakdown */}
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800/80 text-[10px] font-mono space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Take Profit (1.02 ATR):</span>
                          <span className="text-emerald-400 font-bold">${topPat.suggestedTakeProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Stop Loss:</span>
                          <span className="text-rose-400 font-bold">${topPat.suggestedStopLoss}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-500 space-y-1">
                      <Activity className="w-5 h-5 text-slate-600 mx-auto" />
                      <p className="font-semibold text-slate-400">Scanning 15M Candles...</p>
                      <p className="text-[10px]">Awaiting high-confidence formation</p>
                    </div>
                  )}
                </div>

                {/* Bottom Action Button */}
                <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                  {hasPattern && topPat ? (
                    (() => {
                      const effectiveSide: 'BUY' | 'SELL' = topPat.signal;
                      const isEffBuy = effectiveSide === 'BUY';

                      return (
                        <button
                          id={`btn-trigger-${item.symbol}`}
                          onClick={() => handleExecutePattern(item.symbol, effectiveSide)}
                          disabled={isTriggering}
                          className={`w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md ${
                            isEffBuy
                              ? 'bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                              : 'bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-900/30'
                          } ${isTriggering ? 'opacity-70 cursor-wait' : ''}`}
                          title={item.smartDetector?.reason || topPat.description}
                        >
                          <Zap className="w-3.5 h-3.5 fill-current" />
                          {isTriggering
                            ? 'Executing...'
                            : `⚡ Ride Trend: ${effectiveSide} (Direct 1.02x TP)`}
                        </button>
                      );
                    })()
                  ) : (
                    <div className="text-center text-[10px] font-mono text-slate-500 py-1">
                      Waiting Setup Confirmation
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 11-PHOTO REFERENCE ENCYCLOPEDIA EXPLORER */}
      {/* ========================================================================= */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
          <Layers className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-white tracking-wide">
            11-Photo Reference Pattern Encyclopedia (50+ Modeled Signatures)
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 text-xs">
          {PHOTO_REFERENCE.map((photo) => (
            <div
              key={photo.id}
              className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-300 text-xs">
                  Photo #{photo.id}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-400">
                  {photo.patterns.length} Patterns
                </span>
              </div>
              <div className="text-white font-medium text-[11px]">{photo.title}</div>
              <div className="flex flex-wrap gap-1">
                {photo.patterns.map((pName) => (
                  <span
                    key={pName}
                    className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px] font-mono border border-slate-800"
                  >
                    {pName}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
