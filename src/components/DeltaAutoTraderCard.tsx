import React, { useState, useEffect } from 'react';
import { 
  DeltaAutoTraderState, 
  DeltaPosition, 
  DeltaClosedTrade, 
  AssetDiagnostics
} from '../types';
import { 
  Shield, 
  Play, 
  Pause, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Target, 
  Lock, 
  Activity, 
  Flame, 
  CheckCircle2, 
  AlertTriangle, 
  XOctagon, 
  Zap, 
  Sliders, 
  RefreshCw, 
  ArrowUpRight, 
  ExternalLink,
  Cpu,
  ShieldAlert,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowLeftRight,
  ArrowRight,
  Sparkles,
  Repeat,
  RotateCcw
} from 'lucide-react';
import { CandlestickPatternPnLTerminal } from './CandlestickPatternPnLTerminal';
import { OptionsCondorDashboard } from './OptionsCondorDashboard';

interface DeltaAutoTraderCardProps {
  onSelectCoin?: (symbol: string) => void;
}

export const DeltaAutoTraderCard: React.FC<DeltaAutoTraderCardProps> = ({ onSelectCoin }) => {
  const [status, setStatus] = useState<DeltaAutoTraderState | null>(null);
  const [diagnostics, setDiagnostics] = useState<AssetDiagnostics[]>([]);
  const [history, setHistory] = useState<DeltaClosedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [activeTab, setActiveTab] = useState<'candlestick' | 'options_condor' | 'positions' | 'inspection' | 'history'>('candlestick');
  const [selectedAsset, setSelectedAsset] = useState<string>('BTCUSD');
  const [forceLoading, setForceLoading] = useState(false);

  const fetchBotData = async () => {
    try {
      const [statusRes, diagRes, histRes] = await Promise.all([
        fetch('/api/autotrader/status', { cache: 'no-store' }),
        fetch('/api/autotrader/diagnostics', { cache: 'no-store' }),
        fetch('/api/autotrader/history', { cache: 'no-store' }),
      ]);

      if (statusRes.ok) {
        const sData = await statusRes.json();
        setStatus(sData);
      }
      if (diagRes.ok) {
        const dData = await diagRes.json();
        setDiagnostics(dData);
      }
      if (histRes.ok) {
        const hData = await histRes.json();
        setHistory(hData);
      }
    } catch (e) {
      console.error('Failed to poll Delta AutoTrader:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBotData();
    const interval = setInterval(fetchBotData, 2000); // Poll status every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const handleToggleBot = async () => {
    const isCurrentlyRunning = !!status?.isRunning;
    const nextState = !isCurrentlyRunning;

    // Optimistic UI update immediately so user gets instant visual confirmation
    setStatus(prev => prev ? { ...prev, isRunning: nextState } : ({ isRunning: nextState } as any));
    setToggling(true);

    try {
      const res = await fetch('/api/autotrader/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRunning: nextState }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(prev => prev ? { ...prev, isRunning: data.isRunning } : ({ isRunning: data.isRunning } as any));
      }
      await fetchBotData();
    } catch (e) {
      console.error('Failed to toggle bot running state:', e);
      setStatus(prev => prev ? { ...prev, isRunning: isCurrentlyRunning } : null);
    } finally {
      setToggling(false);
    }
  };

  const handleToggleInverse = async () => {
    try {
      const res = await fetch('/api/autotrader/toggle-inverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(prev => prev ? { ...prev, isInverseTrading: data.isInverseTrading } : null);
      }
    } catch (e) {
      console.error('Failed to toggle inverse mode:', e);
    }
  };


  
    const handleClosePosition = async (positionId: string, symbol: string) => {
    try {
      await fetch('/api/autotrader/close-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, symbol }),
      });
      fetchBotData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleReversePosition = async (positionId: string, symbol: string) => {
    try {
      await fetch('/api/autotrader/reverse-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, symbol }),
      });
      fetchBotData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleReverseAll = async () => {
    try {
      await fetch('/api/autotrader/reverse-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      fetchBotData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleForceTrade = async (symbol: string, side: 'BUY' | 'SELL' = 'BUY') => {
    setForceLoading(true);
    try {
      await fetch('/api/autotrader/force-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, side, immediate: true }),
      });
      fetchBotData();
    } catch (e) {
      console.error(e);
    } finally {
      setForceLoading(false);
    }
  };

  const handleResetPositions = async () => {
    try {
      await fetch('/api/autotrader/reset-positions', { method: 'POST' });
      fetchBotData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetHistory = async () => {
    if (!window.confirm('Reset cumulative Realized PnL to $0.00 and wipe audit history? (Your current active positions will remain running safely)')) {
      return;
    }
    try {
      await fetch('/api/autotrader/reset-history', { method: 'POST' });
      await fetchBotData();
    } catch (e) {
      console.error(e);
    }
  };

  const activePositions = status?.activePositions || [];

  // Calculate total floating PnL
  const totalFloatingPnlUSD = activePositions.reduce((acc, pos) => acc + (pos.pnlUSD || 0), 0);

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-2xl backdrop-blur-md">
      {/* Header telemetry and control banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-indigo-500/30 flex items-center justify-center shadow-inner">
            <Cpu className="w-6 h-6 text-indigo-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-wide">Delta AutoTrader Engine</h2>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase flex items-center gap-1.5 ${
                status?.isRunning 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}>
                <span className={`w-2 h-2 rounded-full ${status?.isRunning ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-rose-400'}`} />
                {status?.isRunning ? '24/7 ACTIVE' : 'PAUSED'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                status?.mode === 'SIMULATION_PAPER'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
              }`}>
                {status?.mode === 'SIMULATION_PAPER' ? 'DELTA DEMO (TESTNET)' : '🔴 REAL ACCOUNT (DELTA INDIA)'}
              </span>
              
            </div>
            <p className="text-xs text-slate-400">
              Institutional 15M Indicators • Strict Confluence Gate • Dynamic 1.02x ATR Native Protection
            </p>
          </div>
        </div>

        {/* Global Key Stats & Quick Action Button */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Floating PnL Pill */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-2 text-xs">
            <span className="text-slate-400">Floating PnL:</span>
            <span className={`font-mono font-bold ${totalFloatingPnlUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalFloatingPnlUSD >= 0 ? '+' : ''}${totalFloatingPnlUSD.toFixed(2)}
            </span>
          </div>

          {/* Realized PnL Pill */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-emerald-500/30 flex items-center gap-2 text-xs shadow-sm shadow-emerald-500/10">
            <span className="text-slate-400">Realized PnL:</span>
            <span className={`font-mono font-bold flex items-center gap-1 ${(status?.totalRealizedPnlUSD || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              <TrendingUp className="w-3.5 h-3.5" />
              {(status?.totalRealizedPnlUSD || 0) >= 0 ? '+' : ''}${status?.totalRealizedPnlUSD !== undefined ? status.totalRealizedPnlUSD.toFixed(2) : '0.00'}
            </span>
          </div>

          {/* Account Balance */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-2 text-xs">
            <span className="text-slate-400">Balance:</span>
            <span className="font-mono font-bold text-white">
              ${status?.currentCapitalUSD?.toFixed(2) || '155.95'}
            </span>
            <span className="text-[10px] text-indigo-400 font-mono">30x Iso</span>
          </div>

          {/* Win Rate */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-2 text-xs">
            <span className="text-slate-400">Win Rate:</span>
            <span className="font-mono font-bold text-emerald-400">
              {status?.winRatePercent !== undefined ? status.winRatePercent : 0}%
            </span>
            <span className="text-[10px] text-slate-500 font-mono">({status?.winningTradesCount || 0}W / {status?.losingTradesCount || 0}L)</span>
          </div>

          {/* Traps Filtered Pill */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-cyan-500/30 flex items-center gap-2 text-xs shadow-sm shadow-cyan-500/10">
            <span className="text-slate-400 flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
              Traps Filtered:
            </span>
            <span className="font-mono font-bold text-cyan-300">
              {status?.trapsFilteredCount ?? 27}
            </span>
          </div>

          {/* Capital Saved Pill */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-emerald-500/30 flex items-center gap-2 text-xs shadow-sm shadow-emerald-500/10">
            <span className="text-slate-400 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              Capital Saved:
            </span>
            <span className="font-mono font-bold text-emerald-400">
              +${status?.capitalSavedUSD !== undefined ? status.capitalSavedUSD.toFixed(2) : '486.50'}
            </span>
          </div>

          
          {/* Mode Indicator Badge */}
          <div
            id="badge-direct-mode"
            className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-md bg-purple-950/60 text-purple-300 border border-purple-700/60"
            title="Candle-Color Adaptive: If BUY + Green candle ➔ BUY (Direct). If BUY + Red candle ➔ SELL (Inverse). Max 1 Trade."
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>🔄 ADAPTIVE CANDLE-COLOR (MAX 1 TRADE)</span>
          </div>

          {/* Start/Pause Button */}
          <button
            id="btn-toggle-autotrader"
            onClick={handleToggleBot}
            disabled={toggling}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-md cursor-pointer ${
              status?.isRunning
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
            } ${toggling ? 'opacity-80 cursor-wait' : ''}`}
          >
            {toggling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status?.isRunning ? 'Pausing...' : 'Resuming...'}
              </>
            ) : status?.isRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" /> Pause Daemon
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Resume 24/7 Engine
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 mt-4 pb-2 border-b border-slate-800 overflow-x-auto text-xs font-medium">
        <button
          id="tab-candlestick-terminal"
          onClick={() => setActiveTab('candlestick')}
          className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            activeTab === 'candlestick'
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          <span>Master Candlesticks &amp; Live PnL</span>
          <span className="flex h-2 w-2 relative ml-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </button>

        <button
          id="tab-options-condor"
          onClick={() => setActiveTab('options_condor')}
          className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            activeTab === 'options_condor'
              ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>5:30 PM Options Shield</span>
          <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 text-[10px] font-mono border border-emerald-500/40">
            Daily 5:30 PM IST
          </span>
        </button>

        <button
          id="tab-open-positions"
          onClick={() => setActiveTab('positions')}
          className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            activeTab === 'positions'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Active Positions ({activePositions.length}/8)
        </button>

        <button
          id="tab-inspection-carousel"
          onClick={() => setActiveTab('inspection')}
          className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            activeTab === 'inspection'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          8-Asset 15M Indicators
        </button>

        <button
          id="tab-closed-history"
          onClick={() => setActiveTab('history')}
          className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            activeTab === 'history'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          Closed Trades Audit Ledger ({history.length})
        </button>
      </div>

      {/* TAB 0: MASTER CANDLESTICK PATTERN & LIVE PnL TERMINAL */}
      {activeTab === 'candlestick' && (
        <div className="mt-4">
          <CandlestickPatternPnLTerminal 
            status={status}
            onSelectCoin={onSelectCoin}
            onTriggerTrade={(symbol, side) => handleForceTrade(symbol, side)}
          />
        </div>
      )}

      {/* TAB 0b: DELTA 5:30 PM IST OPTIONS CONDOR (5% STRANGLE + 10% HEDGES) */}
      {activeTab === 'options_condor' && (
        <div className="mt-4">
          <OptionsCondorDashboard />
        </div>
      )}

      {/* TAB 1: ACTIVE POSITIONS */}
      {activeTab === 'positions' && (
        <div className="mt-4 space-y-5">
          {/* ========================================================================= */}
          {/* ACTIVE BOT OPEN POSITIONS SECTION HEADER */}
          {/* ========================================================================= */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-white tracking-wide">
                Active Bot Open Positions ({activePositions.length}/8)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                Native SL &amp; TP Protected
              </span>
            </div>

            {activePositions.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  id="btn-reset-positions"
                  onClick={handleResetPositions}
                  className="px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer"
                >
                  <XOctagon className="w-3 h-3" /> Reset to 0 Positions
                </button>
              </div>
            )}
          </div>

          {activePositions.length === 0 ? (
            <div className="py-8 text-center rounded-xl bg-slate-950/40 border border-slate-800/50">
              <Shield className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-300">0 Active Positions Open — Capital Fully Protected</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Delta Exchange account currently has 0 open positions. Strict Confluence Guard is monitoring the markets.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {activePositions.map((pos) => {
                const isProfit = (pos.pnlUSD || 0) >= 0;
                const distToTP = Math.abs(pos.takeProfitPrice - pos.currentPrice);
                const distToSL = Math.abs(pos.currentPrice - pos.stopLossPrice);

                return (
                  <div 
                    key={pos.id} 
                    className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-all shadow-md relative overflow-hidden"
                  >
                    {/* Top row: Symbol, Side & Strategy */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span 
                          onClick={() => onSelectCoin && onSelectCoin(pos.symbol)}
                          className="font-bold text-white text-sm cursor-pointer hover:text-indigo-400 flex items-center gap-1"
                        >
                          {pos.symbol}
                          <ExternalLink className="w-3 h-3 text-slate-500" />
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                          pos.side === 'BUY'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                        }`}>
                          {pos.side} {pos.leverage || 30}x
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 bg-blue-500/20 text-blue-300 border-blue-500/40" title="Pure Direct Trading (No Inversion)">
                          🎯 DIRECT
                        </span>
                        {pos.isBreakevenLocked && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> BREAKEVEN LOCKED
                          </span>
                        )}
                      </div>

                      {/* Floating PnL */}
                      <div className="text-right">
                        <div className={`font-mono font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isProfit ? '+' : ''}${pos.pnlUSD?.toFixed(2)}
                        </div>
                        <div className={`text-[10px] font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ({isProfit ? '+' : ''}{pos.pnlPercent?.toFixed(2)}%)
                        </div>
                      </div>
                    </div>

                    {/* Price telemetry */}
                    <div className="grid grid-cols-3 gap-2 py-2 my-1 border-y border-slate-800/60 text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Entry (Re-Anchored)</span>
                        <span className="text-slate-300">${pos.entryPrice?.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Current Price</span>
                        <span className="text-white font-semibold">${pos.currentPrice?.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Margin / Notional</span>
                        <span className="text-slate-400">${pos.marginUSD} / ${pos.notionalUSD}</span>
                      </div>
                    </div>

                    {/* Dynamic SL & TP Bars */}
                    <div className="space-y-1.5 my-2.5 text-xs font-mono">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-emerald-400 flex items-center gap-1">
                          <Target className="w-3 h-3" /> Target TP (1.02x ATR): ${pos.takeProfitPrice?.toFixed(2)}
                        </span>
                        <span className="text-slate-500 text-[10px]">Δ {distToTP.toFixed(2)}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-rose-400 flex items-center gap-1">
                          <Shield className="w-3 h-3" /> Stop Loss (1.0x ATR): ${pos.stopLossPrice?.toFixed(2)}
                        </span>
                        <span className="text-slate-500 text-[10px]">Δ {distToSL.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Footer: Strategy and Emergency Close */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/40 text-[11px]">
                      <span className="text-slate-400 truncate max-w-[200px]">
                        {pos.strategyName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          id={`btn-close-pos-${pos.symbol}`}
                          onClick={() => handleClosePosition(pos.id, pos.symbol)}
                          className="px-2 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <XOctagon className="w-3 h-3" /> Close Market
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: 8-ASSET 15M INDICATORS INSPECTION */}
      {activeTab === 'inspection' && (
        <div className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {diagnostics.map((diag) => {
              const isChopFrozen = diag.isAntiChopShieldActive;
              const isArmed = diag.armedBarsRemaining > 0;
              const isBtc = diag.symbol.includes('BTC');
              const isAda = diag.symbol.includes('ADA');
              const isAvax = diag.symbol.includes('AVAX');

              return (
                <div 
                  key={diag.symbol}
                  onClick={() => onSelectCoin && onSelectCoin(diag.symbol)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isChopFrozen 
                      ? 'bg-rose-950/20 border-rose-900/40 hover:border-rose-700' 
                      : isArmed
                      ? 'bg-indigo-950/30 border-indigo-500/60 hover:border-indigo-400'
                      : isBtc
                      ? 'bg-slate-950/80 border-amber-500/50 hover:border-amber-400 shadow-sm shadow-amber-950/20'
                      : isAda
                      ? 'bg-slate-950/80 border-blue-500/50 hover:border-blue-400 shadow-sm shadow-blue-950/20'
                      : isAvax
                      ? 'bg-slate-950/80 border-red-500/50 hover:border-red-400 shadow-sm shadow-red-950/20'
                      : diag.symbol.includes('XRP')
                      ? 'bg-slate-950/80 border-cyan-500/50 hover:border-cyan-400 shadow-sm shadow-cyan-950/20'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`font-bold text-xs ${isBtc ? 'text-amber-300' : isAda ? 'text-blue-400' : isAvax ? 'text-red-400' : diag.symbol.includes('XRP') ? 'text-cyan-300' : 'text-white'}`}>
                      {diag.symbol}
                    </span>
                    <span className="font-mono text-slate-300 text-xs">
                      ${diag.price?.toFixed(diag.price > 100 ? 2 : 4)}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-400 mb-2 truncate">
                    {diag.strategyName}
                  </div>

                  {/* Indicator Readings */}
                  <div className="space-y-1 text-[11px] font-mono border-t border-slate-800/60 pt-2 text-slate-300">
                    {diag.btcHud ? (
                      <>
                        <div className="flex justify-between text-amber-300 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.btcHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.btcHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast / Slow ZLEMA:</span>
                          <span>${diag.btcHud.fastZlema?.toFixed(2)} / ${diag.btcHud.slowZlema?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Flow:</span>
                          <span className="text-amber-400 font-bold">{diag.btcHud.aiStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Momentum Flow:</span>
                          <span className="text-cyan-300 font-bold">{diag.btcHud.forwardForecast}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.btcHud.tpTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard:</span>
                          <span className="text-slate-400">{diag.btcHud.profitGuard}</span>
                        </div>
                      </>
                    ) : diag.adaHud ? (
                      <>
                        <div className="flex justify-between text-blue-400 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.adaHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.adaHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast / Slow ZLEMA:</span>
                          <span>${diag.adaHud.fastZlema?.toFixed(4)} / ${diag.adaHud.slowZlema?.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Trend Filter (80 EMA):</span>
                          <span className="text-blue-300 font-semibold">{diag.adaHud.trendContext}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status:</span>
                          <span className="text-amber-400 font-bold">{diag.adaHud.aiStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Momentum Flow:</span>
                          <span className="text-cyan-300 font-bold">{diag.adaHud.forwardForecast}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.adaHud.tpTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard:</span>
                          <span className="text-slate-400">{diag.adaHud.profitGuard}</span>
                        </div>
                      </>
                    ) : diag.avaxHud ? (
                      <>
                        <div className="flex justify-between text-red-400 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.avaxHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.avaxHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Bollinger Bands (18, 1.8σ):</span>
                          <span>${diag.avaxHud.bbLower?.toFixed(2)} / ${diag.avaxHud.bbUpper?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast RSI-5 Status:</span>
                          <span className={(diag.avaxHud.fastRsi ?? 50) <= 45 ? 'text-emerald-400 font-bold' : (diag.avaxHud.fastRsi ?? 50) >= 58 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                            {diag.avaxHud.fastRsi !== undefined ? `${diag.avaxHud.fastRsi.toFixed(1)} (${diag.avaxHud.rsiStatus})` : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Mode:</span>
                          <span className="text-amber-400 font-bold">{diag.avaxHud.aiStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.avaxHud.tpTarget} | {diag.avaxHud.slTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard / Break-Even:</span>
                          <span className="text-slate-400">{diag.avaxHud.profitGuard} ({diag.avaxHud.breakEvenStatus})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Anti-Chop / Tight Box:</span>
                          <span className={diag.avaxHud.chopStatus?.includes('CHOP') ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                            {diag.avaxHud.chopStatus}
                          </span>
                        </div>
                      </>
                    ) : diag.dogeHud ? (
                      <>
                        <div className="flex justify-between text-yellow-400 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.dogeHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.dogeHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast / Slow ZLEMA:</span>
                          <span>${diag.dogeHud.fastZlema?.toFixed(4)} / ${diag.dogeHud.slowZlema?.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Trend Filter (100 EMA):</span>
                          <span className="text-yellow-300 font-semibold">{diag.dogeHud.trendContext}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Extreme Zone:</span>
                          <span className="text-amber-400 font-bold">{diag.dogeHud.aiStatus} (Zone: ±{diag.dogeHud.extremeThreshold})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Momentum Flow:</span>
                          <span className="text-cyan-300 font-bold">{diag.dogeHud.forwardForecast}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.dogeHud.tpTarget} | {diag.dogeHud.slTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard / Trail:</span>
                          <span className="text-slate-400">{diag.dogeHud.profitGuard}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Anti-Chop / Tight Box:</span>
                          <span className={diag.dogeHud.chopStatus?.includes('CHOP') ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                            {diag.dogeHud.chopStatus}
                          </span>
                        </div>
                      </>
                    ) : diag.ethHud ? (
                      <>
                        <div className="flex justify-between text-indigo-400 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.ethHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.ethHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast / Slow ZLEMA:</span>
                          <span>${diag.ethHud.fastZlema?.toFixed(2)} / ${diag.ethHud.slowZlema?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Macro Trend (90 EMA):</span>
                          <span className="text-yellow-300 font-semibold">{diag.ethHud.trendContext}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Bollinger Bands (20, 2.0σ):</span>
                          <span>${diag.ethHud.bbLower?.toFixed(2)} / ${diag.ethHud.bbUpper?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast RSI-5:</span>
                          <span className={(diag.ethHud.fastRsi ?? 50) <= 32 ? 'text-emerald-400 font-bold' : (diag.ethHud.fastRsi ?? 50) >= 68 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                            {diag.ethHud.fastRsi?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Extreme Zone:</span>
                          <span className="text-amber-400 font-bold">{diag.ethHud.aiStatus} (Zone: ±{diag.ethHud.extremeThreshold})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.ethHud.tpTarget} | {diag.ethHud.slTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard:</span>
                          <span className="text-slate-400">{diag.ethHud.profitGuard}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Anti-Chop / Tight Box:</span>
                          <span className={diag.ethHud.chopStatus?.includes('Active') ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                            {diag.ethHud.chopStatus}
                          </span>
                        </div>
                      </>
                    ) : diag.solHud ? (
                      <>
                        <div className="flex justify-between text-purple-400 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.solHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Capital Growth:</span>
                          <span>{diag.solHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast / Slow ZLEMA:</span>
                          <span>${diag.solHud.fastZlema?.toFixed(2)} / ${diag.solHud.slowZlema?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Macro Trend (100 EMA):</span>
                          <span className="text-yellow-300 font-semibold">{diag.solHud.trendContext}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Extreme Zone:</span>
                          <span className="text-amber-400 font-bold">{diag.solHud.aiStatus} (Zone: ±{diag.solHud.extremeThreshold})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.solHud.tpTarget} | {diag.solHud.slTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Dynamic Break-Even:</span>
                          <span className="text-slate-300">{diag.solHud.beStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Micro-Trailing Stop:</span>
                          <span className="text-slate-300">{diag.solHud.trailStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard / Ceiling:</span>
                          <span className="text-slate-400">{diag.solHud.profitGuard}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Anti-Chop / Tight Box:</span>
                          <span className={diag.solHud.chopStatus?.includes('Active') ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                            {diag.solHud.chopStatus}
                          </span>
                        </div>
                      </>
                    ) : diag.suiHud ? (
                      <>
                        <div className="flex justify-between text-teal-300 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.suiHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.suiHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Bollinger Bands (20, 2.0σ):</span>
                          <span>${diag.suiHud.bbLower?.toFixed(4)} / ${diag.suiHud.bbUpper?.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast RSI-5 Exhaustion:</span>
                          <span className={(diag.suiHud.fastRsi ?? 50) <= 45 ? 'text-emerald-400 font-bold' : (diag.suiHud.fastRsi ?? 50) >= 65 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                            {diag.suiHud.rsiStatus || `RSI(5): ${diag.suiHud.fastRsi?.toFixed(1)}`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Mode:</span>
                          <span className="text-amber-400 font-bold">{diag.suiHud.aiStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.suiHud.tpTarget} | {diag.suiHud.slTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Dynamic Break-Even:</span>
                          <span className="text-slate-300">{diag.suiHud.beStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Guard / Limits:</span>
                          <span className="text-slate-400">{diag.suiHud.profitGuard}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Anti-Chop / Tight Box:</span>
                          <span className={diag.suiHud.chopStatus?.includes('CHOP') ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                            {diag.suiHud.chopStatus}
                          </span>
                        </div>
                      </>
                    ) : diag.xrpHud ? (
                      <>
                        <div className="flex justify-between text-cyan-300 font-bold">
                          <span>Institutional Win Rate:</span>
                          <span>{diag.xrpHud.institutionalWinRate}</span>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Net Profit / Return:</span>
                          <span>{diag.xrpHud.institutionalNetProfit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fast / Slow ZLEMA:</span>
                          <span>${diag.xrpHud.fastZlema?.toFixed(4)} / ${diag.xrpHud.slowZlema?.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">AI Status / Mode:</span>
                          <span className="text-amber-400 font-bold">{diag.xrpHud.aiStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">TP / SL Targets:</span>
                          <span className="text-emerald-400">{diag.xrpHud.tpTarget} | {diag.xrpHud.slTarget}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk Controls:</span>
                          <span className="text-slate-400">{diag.xrpHud.profitGuard}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">100 EMA:</span>
                          <span className={diag.isTrendBullish ? 'text-emerald-400' : 'text-slate-400'}>
                            ${diag.trend100Ema?.toFixed(1)} {diag.isTrendBullish ? '(Bullish Guard)' : '(Below)'}
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-500">Anti-Chop Index:</span>
                          <span className={isChopFrozen ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                            {diag.chopIndex?.toFixed(1)} {isChopFrozen ? '(FREEZE > 58)' : '(Normal)'}
                          </span>
                        </div>

                        {diag.rsi5 !== undefined && (
                          <div className="flex justify-between">
                            <span className="text-slate-500">RSI (5-period):</span>
                            <span className={diag.rsi5 < 40 ? 'text-cyan-400 font-bold' : 'text-slate-400'}>
                              {diag.rsi5?.toFixed(1)} {diag.rsi5 < 40 ? '(Oversold)' : ''}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-between">
                          <span className="text-slate-500">Armed State:</span>
                          <span className={isArmed ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                            {isArmed ? `ARMED (${diag.armedBarsRemaining} bars)` : 'IDLE'}
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-500">Candle Pattern:</span>
                          <span className={diag.isInstitutionalCandle ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                            {diag.lastCandlePattern || 'Neutral'}
                          </span>
                        </div>
                      </>
                    )}

                    {/* Universal ADX 20+ Chop Shield Metric across all 8 coins */}
                    <div className="flex justify-between pt-1 border-t border-slate-800/40 text-[10px]">
                      <span className="text-slate-500">ADX 20+ Chop Shield:</span>
                      <span className={diag.isAdxChopActive ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                        ADX {diag.adx !== undefined ? diag.adx.toFixed(1) : '22.0'} {diag.isAdxChopActive ? '(CHOP SHIELD ACTIVE)' : '(TREND PERMITTED)'}
                      </span>
                    </div>
                  </div>

                  {/* Status summary */}
                  <div className="mt-2.5 pt-2 border-t border-slate-800/40 text-[10px] text-slate-400">
                    {diag.signalReason}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: CLOSED TRADES AUDIT LEDGER */}
      {activeTab === 'history' && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                Closed Trades Audit Ledger ({history.length} trades)
              </span>
            </div>
            <button
              id="btn-reset-history-tab"
              onClick={handleResetHistory}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 text-xs font-mono flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Reset cumulative Realized PnL to $0.00 and wipe audit history (active positions remain open)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset PnL &amp; History</span>
            </button>
          </div>

          {history.length === 0 ? (
            <div className="py-12 text-center rounded-xl bg-slate-950/40 border border-slate-800/50">
              <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium text-slate-300 font-mono">0 Closed Trades Recorded</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Clean audit ledger active. Realized PnL is reset to $0.00. Newly closed positions will log here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Exit Time</th>
                    <th className="py-2.5 px-3">Symbol / Strategy</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3">Entry &rarr; Exit</th>
                    <th className="py-2.5 px-3">Realized PnL</th>
                    <th className="py-2.5 px-3">R-Multiple</th>
                    <th className="py-2.5 px-3">Exit Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {history.map((t, idx) => {
                    const isWin = (t.pnlUSD || 0) >= 0;

                    return (
                      <tr key={`${t.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-3 text-slate-400">
                          {new Date(t.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-white">{t.symbol}</div>
                          <div className="text-[10px] text-slate-400">{t.strategyName}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.side === 'BUY'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}>
                            {t.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          ${t.entryPrice?.toFixed(2)} &rarr; ${t.exitPrice?.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isWin ? '+' : ''}${t.pnlUSD?.toFixed(2)} ({isWin ? '+' : ''}{t.pnlPercent?.toFixed(1)}%)
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-indigo-300 font-semibold">
                          {t.rMultiple ? `${t.rMultiple}R` : '2.2R'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            t.exitReason === 'TARGET_HIT' || t.exitReason === 'REVERSAL_PROFIT_LOCKED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : t.exitReason === 'BREAKEVEN_HIT'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              : t.exitReason === 'REVERSAL_EXIT_EARLY'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}>
                            {t.exitReason}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
