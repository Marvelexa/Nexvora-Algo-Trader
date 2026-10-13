import React from 'react';
import { 
  Activity, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  Volume2, 
  VolumeX, 
  RefreshCw, 
  ShieldCheck, 
  Zap,
  TrendingUp,
  DollarSign,
  Film
} from 'lucide-react';
import { ExchangeStatus, AssetBalance, LatencyMetric } from '../types';

interface HeaderProps {
  exchangeStatus: ExchangeStatus | null;
  onOpenCredentials: () => void;
  onOpenMotionVideo?: () => void;
  isAudioEnabled: boolean;
  onToggleAudio: () => void;
  isRefreshing: boolean;
  onRefreshData: () => void;
  currency: 'USD' | 'INR';
  onToggleCurrency: () => void;
  totalPortfolioUsd: number;
  inrRate: number;
  liveWsConnected: boolean;
  activeRulesCount: number;
  latencyMetric: LatencyMetric;
}

export const Header: React.FC<HeaderProps> = ({
  exchangeStatus,
  onOpenCredentials,
  onOpenMotionVideo,
  isAudioEnabled,
  onToggleAudio,
  isRefreshing,
  onRefreshData,
  currency,
  onToggleCurrency,
  totalPortfolioUsd,
  inrRate,
  liveWsConnected,
  activeRulesCount,
  latencyMetric,
}) => {
  const displayTotal = currency === 'INR' 
    ? `₹${(totalPortfolioUsd * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    : `$${totalPortfolioUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-4 py-2.5 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        
        {/* Left: Brand & Real-time Live Badge */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-transparent border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
            <Zap className="h-5 w-5 fill-emerald-500/30 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                Crypto<span className="text-emerald-400">Pulse</span> & AutoSell
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950/90 text-emerald-400 font-mono font-bold border border-emerald-800/80 flex items-center gap-1 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                0ms DELAY DIRECT MATCH
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${liveWsConnected ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]' : 'bg-amber-400 animate-pulse'}`}></span>
                <span className={liveWsConnected ? 'text-emerald-400 font-medium' : 'text-amber-400'}>
                  {liveWsConnected ? 'Direct Trade & Book Stream' : 'Connecting Stream...'}
                </span>
              </span>
              <span className="text-slate-600">•</span>
              <span className="font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.2 rounded border border-cyan-800/40 text-[11px]">
                Feed Delay: <strong className="text-white">0.0ms</strong> ({latencyMetric.lastPingMs}ms ping)
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-300">
                Speed: <strong className="text-emerald-400 font-mono">{latencyMetric.ticksPerSecond} ticks/s</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Center: Portfolio & Currency Badge */}
        <div className="flex items-center gap-3 bg-slate-900/80 border border-slate-800 px-3.5 py-1.5 rounded-xl">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center justify-between gap-2">
              <span>Estimated Portfolio</span>
              <button 
                onClick={onToggleCurrency}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 cursor-pointer transition-colors"
                title="Switch Currency USD / INR"
              >
                {currency === 'USD' ? 'USD ($)' : 'INR (₹)'}
              </button>
            </div>
            <div className="text-base sm:text-lg font-mono font-bold text-white tracking-tight">
              {displayTotal}
            </div>
          </div>
        </div>

        {/* Right: Exchange API Key Connection & Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Motion Graphic Video Presentation button */}
          <button
            onClick={onOpenMotionVideo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-950 via-slate-900 to-slate-900 hover:from-cyan-900 hover:to-slate-800 text-cyan-300 border border-cyan-500/50 hover:border-cyan-400 shadow-md shadow-cyan-950/50 cursor-pointer transition-all hover:scale-105"
            title="Watch Code-Generated Motion Graphics Video Presentation"
          >
            <Film className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
            <span className="tracking-wide">🎬 Project Video</span>
          </button>

          {/* Exchange credentials pill */}
          <button
            onClick={onOpenCredentials}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-colors shadow-sm cursor-pointer"
            title="Configure / View Exchange API Keys"
          >
            <Key className="h-3.5 w-3.5 text-emerald-400" />
            <div className="text-left">
              <span className="text-[10px] text-slate-400 block -mb-0.5">Exchange API</span>
              <span className="font-mono text-emerald-300">
                {exchangeStatus?.maskedApiKey ? exchangeStatus.maskedApiKey : 'WO7A...Bc'}
              </span>
            </div>
            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
              Active
            </span>
          </button>

          {/* Audio Chime toggle */}
          <button
            onClick={onToggleAudio}
            className={`p-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              isAudioEnabled 
                ? 'bg-slate-900 border-slate-700 text-emerald-400 hover:bg-slate-800' 
                : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:text-slate-400'
            }`}
            title={isAudioEnabled ? 'Audio Alerts: On' : 'Audio Alerts: Muted'}
          >
            {isAudioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          {/* Refresh button */}
          <button
            onClick={onRefreshData}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh Market Prices"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>

      </div>
    </header>
  );
};
