import React, { useState, useEffect } from 'react';
import { 
  AssetDiagnostics, 
  DeltaAutoTraderState 
} from '../types';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  Target, 
  Zap, 
  Flame, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  BarChart2, 
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Cpu,
  Lock,
  Layers,
  ArrowRight
} from 'lucide-react';

interface LiveTradeScoresSidebarProps {
  onSelectCoin?: (symbol: string) => void;
}

export const LiveTradeScoresSidebar: React.FC<LiveTradeScoresSidebarProps> = React.memo(({ onSelectCoin }) => {
  const [diagnostics, setDiagnostics] = useState<AssetDiagnostics[]>([]);
  const [status, setStatus] = useState<DeltaAutoTraderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  // Active coins traded by the engine
  const WATCHLIST = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD'];

  const fetchScores = async () => {
    try {
      const [diagRes, statusRes] = await Promise.all([
        fetch('/api/autotrader/diagnostics', { cache: 'no-store' }),
        fetch('/api/autotrader/status', { cache: 'no-store' }),
      ]);

      if (diagRes.ok) {
        const dData = await diagRes.json();
        if (Array.isArray(dData)) {
          setDiagnostics(dData);
        }
      }

      if (statusRes.ok) {
        const sData = await statusRes.json();
        if (sData) {
          setStatus(sData);
        }
      }
      setLastUpdated(Date.now());
    } catch (e) {
      console.warn('Live scores fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScores();
    const interval = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) fetchScores(); }, 3000); // 2-second live refresh
    return () => clearInterval(interval);
  }, []);

  // Filter diagnostics for the active 4 coins (or show all available)
  const activeCoinsData = WATCHLIST.map(sym => {
    const cleanSym = sym.toUpperCase().replace('USDT', 'USD');
    const diag = diagnostics.find(d => {
      const dSym = (d.symbol || '').toUpperCase().replace('USDT', 'USD');
      return dSym === cleanSym;
    });
    return {
      symbol: cleanSym,
      diag,
    };
  });

  const liveCapitalUSD = status?.accountCapitalUSD || status?.currentCapitalUSD || 19.24;
  const liveCapitalINR = liveCapitalUSD * 84;
  const activePositionCount = status?.activePositions?.length || 0;
  const maxPositions = status?.maxConcurrentPositions || 1;
  const isRunning = status?.isRunning !== false;
  const mode = status?.mode || 'LIVE_DELTA_INDIA';
  const isReal = mode === 'LIVE_DELTA_INDIA';

  return (
    <div className="w-full space-y-4">
      {/* ========================================================================= */}
      {/* 1. MASTER RADAR HEADER (LIVE SCORES COMMAND PANEL) */}
      {/* ========================================================================= */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40 border border-indigo-500/40 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-indigo-500/40 flex items-center justify-center shadow-inner">
              <Activity className="w-5 h-5 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Live Trade Scores
                </h3>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                {isReal ? '🟢 Real Delta India Live' : '🟡 Simulation Mode'} • 24/7 Radar
              </p>
            </div>
          </div>

          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            Target: ≥50
          </span>
        </div>

        {/* Live Account & Slots Telemetry */}
        <div className="grid grid-cols-2 gap-2 mt-3 pt-1 text-xs font-mono">
          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 block uppercase">Real Balance</span>
            <span className="text-sm font-bold text-emerald-400">
              ₹{liveCapitalINR.toFixed(0)}
            </span>
            <span className="text-[10px] text-slate-400 block">
              (${liveCapitalUSD.toFixed(2)} USD)
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 block uppercase">Active Trades</span>
            <span className="text-sm font-bold text-white">
              {activePositionCount} / {maxPositions} Slot
            </span>
            <span className={`text-[10px] block ${activePositionCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
              {activePositionCount > 0 ? 'In Trade' : 'Scanning 4 Coins'}
            </span>
          </div>
        </div>

        {/* Sniper Rule Notice */}
        <div className="mt-2.5 p-2 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-[10px] font-mono text-indigo-200 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Strict Accuracy: Math ≥ 50 | Confluence ≥ 65</span>
          </span>
          <span className="font-bold text-emerald-400">TP: +$6 | SL: -$2.5</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. REAL-TIME COIN-BY-COIN LIVE SCORE CARDS */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        {activeCoinsData.map(({ symbol, diag }) => {
          const quant = diag?.quantMath;
          const score = quant?.quantScore ?? 0;
          const side = quant?.recommendedSide || 'WAIT';
          const regime = quant?.marketRegime || 'SCANNING';
          const isBuy = side === 'BUY';
          const isSell = side === 'SELL';
          const EXECUTION_GATE = 60;
          const isTriggerArmed = score >= EXECUTION_GATE;
          const isBuilding = score >= 40 && score < EXECUTION_GATE;
          const isExpanded = expandedCoin === symbol;
          const price = diag?.price || 0;
          const superSmootherSlope = quant?.superSmootherSlope ?? 0;
          const fisher = quant?.fisherTransform ?? 0;
          const reasons = quant?.reasons || [];
          const scoresBreakdown = quant?.scores;
          const gate = diag?.activeCandleGate;

          // Check if coin has an active position
          const hasOpenPos = status?.activePositions?.find(p => {
            const ps = (p.symbol || '').toUpperCase().replace('USDT', 'USD');
            return ps === symbol;
          });

          return (
            <div
              key={symbol}
              className={`p-3.5 rounded-2xl border transition-all shadow-md relative overflow-hidden backdrop-blur-sm ${
                hasOpenPos
                  ? 'bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-950 border-indigo-500 shadow-indigo-500/20'
                  : isTriggerArmed
                  ? (isBuy 
                      ? 'bg-gradient-to-br from-emerald-950/80 to-slate-950 border-emerald-500 shadow-emerald-500/20 animate-pulse'
                      : 'bg-gradient-to-br from-rose-950/80 to-slate-950 border-rose-500 shadow-rose-500/20 animate-pulse')
                  : isBuilding
                  ? 'bg-gradient-to-br from-slate-900/90 to-slate-950 border-cyan-500/40'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Header: Coin Symbol, Price, and Signal Badge */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span 
                    onClick={() => onSelectCoin && onSelectCoin(symbol)}
                    className="font-bold text-white text-sm cursor-pointer hover:text-indigo-400 flex items-center gap-1 transition-colors"
                    title="Click to view full chart"
                  >
                    {symbol}
                    <ExternalLink className="w-3 h-3 text-slate-500" />
                  </span>
                  {price > 0 && (
                    <span className="text-xs font-mono text-slate-300">
                      ${price >= 1 ? price.toFixed(2) : price.toFixed(4)}
                    </span>
                  )}
                </div>

                {/* Stance Pill */}
                <div className="flex items-center gap-1.5">
                  {hasOpenPos ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-indigo-400 fill-current" />
                      IN TRADE ({hasOpenPos.side})
                    </span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border flex items-center gap-1 ${
                      isBuy
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : isSell
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {isBuy ? <TrendingUp className="w-3 h-3" /> : isSell ? <TrendingDown className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {side}
                    </span>
                  )}
                </div>
              </div>

              {/* LIVE SCORE GAUGE & BAR */}
              <div className="mt-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 flex items-center gap-1">
                    <span>Math Confluence Score:</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-base font-bold ${
                      isTriggerArmed
                        ? 'text-emerald-400'
                        : isBuilding
                        ? 'text-cyan-300'
                        : 'text-slate-300'
                    }`}>
                      {score}
                    </span>
                    <span className="text-[11px] text-slate-500">/ 100</span>
                  </div>
                </div>

                {/* Progress bar towards 70 execution gate */}
                <div className="relative w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  {/* Target 60 marker line */}
                  <div 
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10" 
                    style={{ left: '60%' }}
                    title="Target Execution Gate (Score ≥ 60)"
                  />
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      isTriggerArmed
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        : isBuilding
                        ? 'bg-gradient-to-r from-indigo-500 to-cyan-400'
                        : 'bg-gradient-to-r from-slate-600 to-indigo-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(5, score))}%` }}
                  />
                </div>

                {/* Status caption below score bar */}
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className={`${
                    isTriggerArmed
                      ? 'text-emerald-400 font-bold'
                      : isBuilding
                      ? 'text-cyan-400'
                      : 'text-slate-400'
                  }`}>
                    {isTriggerArmed
                      ? '🎯 Target Reached! Armed for 15M Entry'
                      : isBuilding
                      ? `⚡ Building Confluence (Need +${60 - score} pts)`
                      : `⏳ Consolidation Chop (Need +${60 - score} pts)`}
                  </span>
                  <span className="text-slate-400">
                    Gate: <strong>60</strong>
                  </span>
                </div>
              </div>

              {/* LIVE FORMING 15M CANDLE & EXECUTION GATE HUD */}
              {gate && (
                <div className="mt-2.5 space-y-1.5 font-mono">
                  {/* 1. 15M Forming Bar Telemetry */}
                  <div className="p-2 rounded-xl bg-slate-950/90 border border-slate-800/90 flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 text-[9px]">15M Bar:</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                        gate.barColor === 'GREEN'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                          : gate.barColor === 'RED'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                          : 'bg-slate-900 text-slate-300 border-slate-700'
                      }`}>
                        {gate.barColor === 'GREEN' ? '🟢 GREEN' : gate.barColor === 'RED' ? '🔴 RED' : '⚪ FLAT'} ({gate.diffPct >= 0 ? '+' : ''}{gate.diffPct.toFixed(2)}%)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                      <span>Open: ${gate.barOpen >= 1 ? gate.barOpen.toFixed(2) : gate.barOpen.toFixed(4)}</span>
                      <span>•</span>
                      <span className="text-indigo-300 font-bold flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 text-indigo-400" />
                        {Math.floor(gate.secondsToClose / 60)}m {gate.secondsToClose % 60}s
                      </span>
                    </div>
                  </div>

                  {/* 2. Execution Gate Status Banner */}
                  {hasOpenPos ? (
                    <div className="p-2 rounded-xl bg-indigo-950/70 border border-indigo-500/40 flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1.5 text-indigo-300 font-bold">
                        <Zap className="w-3 h-3 text-indigo-400 fill-current" />
                        <span>IN TRADE ({hasOpenPos.side})</span>
                      </span>
                      <span className="text-emerald-400 font-bold">
                        PnL: {hasOpenPos.pnlUSD !== undefined ? (hasOpenPos.pnlUSD >= 0 ? `+$${hasOpenPos.pnlUSD.toFixed(2)}` : `-$${Math.abs(hasOpenPos.pnlUSD).toFixed(2)}`) : '$0.00'}
                      </span>
                    </div>
                  ) : gate.executionStatus === 'ARMED_WAITING_GATE' ? (
                    <div className="p-2 rounded-xl bg-amber-950/60 border border-amber-500/50 text-[10px]">
                      <div className="flex items-center justify-between font-bold text-amber-300">
                        <span className="flex items-center gap-1">
                          <Shield className="w-3 h-3 text-amber-400 shrink-0" />
                          <span>ARMED FOR {side} ({score}/100)</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-600/40 text-[9px] font-bold">
                          CANDLE GATE ACTIVE
                        </span>
                      </div>
                      <div className="mt-1 text-amber-200/90 text-[9px] leading-tight flex items-start gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>{gate.vetoReason}</span>
                      </div>
                    </div>
                  ) : gate.executionStatus === 'READY_TO_ENTER' ? (
                    <div className="p-2 rounded-xl bg-emerald-950/70 border border-emerald-500/60 text-[10px]">
                      <div className="flex items-center justify-between font-bold text-emerald-300">
                        <span className="flex items-center gap-1">
                          <Flame className="w-3 h-3 text-emerald-400 fill-current" />
                          <span>READY TO EXECUTE {side}!</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-600/40 text-[9px] font-bold">
                          ALL GATES CLEAR ✅
                        </span>
                      </div>
                      <div className="mt-1 text-emerald-200/90 text-[9px]">
                        {gate.vetoReason}
                      </div>
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[9px] text-slate-400 flex items-center justify-between">
                      <span className="flex items-center gap-1 truncate">
                        <Activity className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                        <span className="truncate">{gate.vetoReason || 'Scanning & Building Confluence'}</span>
                      </span>
                      <span className="text-slate-500 shrink-0 ml-1">Need Score ≥ 50</span>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-Indicators Badges (DSP, Fisher, Regime) */}
              <div className="grid grid-cols-3 gap-1.5 mt-2.5 text-[10px] font-mono">
                <div className="p-1.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px]">SuperSmoother</span>
                  <span className={`font-bold ${superSmootherSlope > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {superSmootherSlope > 0 ? '+' : ''}{superSmootherSlope.toFixed(2)}%
                  </span>
                </div>

                <div className="p-1.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px]">Fisher Trans</span>
                  <span className={`font-bold ${fisher > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {fisher.toFixed(2)}
                  </span>
                </div>

                <div className="p-1.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px]">Regime</span>
                  <span className="font-bold text-indigo-300 truncate block">
                    {regime === 'TREND' ? 'MOMENTUM' : regime === 'RANGE' ? 'RANGE CHOP' : regime}
                  </span>
                </div>
              </div>

              {/* Expandable Mathematical Component Breakdown Button */}
              <button
                onClick={() => setExpandedCoin(isExpanded ? null : symbol)}
                className="w-full mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <span>{isExpanded ? 'Hide Confluence Math' : 'Show 6-Group Confluence Math'}</span>
                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {/* Expanded Mathematical Component Breakdown */}
              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-slate-800/80 space-y-2 text-[10px] font-mono animate-in fade-in duration-200">
                  {scoresBreakdown && (
                    <div className="grid grid-cols-2 gap-1 bg-slate-950/60 p-2 rounded-lg border border-slate-800 text-[10px]">
                      <div className="flex justify-between text-slate-300">
                        <span>A. Trend:</span>
                        <strong className="text-indigo-300">+{scoresBreakdown.groupA_trend ?? 0}/20</strong>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>B. Mean-Revert:</span>
                        <strong className="text-indigo-300">+{scoresBreakdown.groupB_meanRevert ?? 0}/20</strong>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>C. Volatility:</span>
                        <strong className="text-indigo-300">+{scoresBreakdown.groupC_volatility ?? 0}/10</strong>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>D. Structure:</span>
                        <strong className="text-indigo-300">+{scoresBreakdown.groupD_structure ?? 0}/20</strong>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>E. Order Flow:</span>
                        <strong className="text-indigo-300">+{scoresBreakdown.groupE_orderFlow ?? 0}/20</strong>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>F. Derivatives:</span>
                        <strong className="text-indigo-300">+{scoresBreakdown.groupF_derivatives ?? 0}/10</strong>
                      </div>
                    </div>
                  )}

                  {/* Active Reasons Feed */}
                  {reasons.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-slate-400 block text-[9px] uppercase">Active Market Reasons:</span>
                      {reasons.slice(0, 3).map((r, idx) => (
                        <div key={idx} className="p-1 rounded bg-slate-950/80 border border-slate-800/60 text-[9px] text-slate-300 flex items-start gap-1">
                          <span className="text-indigo-400">•</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* 3. STRICT RISK & PROTOCOL BADGE FOOTER */}
      {/* ========================================================================= */}
      <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] font-mono text-slate-400 space-y-1.5">
        <div className="flex items-center justify-between text-slate-300 font-semibold">
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            Active Capital Shields
          </span>
          <span className="text-emerald-400">0ms Armed</span>
        </div>
        <div className="text-[10px] space-y-1 text-slate-400">
          <div className="flex justify-between">
            <span>• Active Forming Candle Gate:</span>
            <strong className="text-slate-300">Green=BUY, Red=SELL</strong>
          </div>
          <div className="flex justify-between">
            <span>• 0ms Reversal Profit Lock:</span>
            <strong className="text-emerald-400">+$2.50 ➔ locks +$2.30</strong>
          </div>
          <div className="flex justify-between">
            <span>• Early Reversal Fast Exit:</span>
            <strong className="text-amber-400">0ms cut on opposing quant/bounce</strong>
          </div>
          <div className="flex justify-between">
            <span>• Green Bounce Detection:</span>
            <strong className="text-emerald-400">Z-Score + Fisher + S/R Hold</strong>
          </div>
          <div className="flex justify-between">
            <span>• Risk-Reward Asymmetry:</span>
            <strong className="text-indigo-300">2.4:1 (+$6 TP / -$2.5 SL)</strong>
          </div>
        </div>
      </div>
    </div>
  );
});
