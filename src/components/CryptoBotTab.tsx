import React, { useState } from 'react';
import { DeltaAutoTraderCard } from './DeltaAutoTraderCard';
import { LiveTradeScoresSidebar } from './LiveTradeScoresSidebar';
import { 
  Shield, 
  Settings, 
  Layers, 
  HelpCircle, 
  Info, 
  Check, 
  Zap, 
  FileCode,
  DollarSign,
  Percent
} from 'lucide-react';

interface CryptoBotTabProps {
  onSelectCoin?: (symbol: string) => void;
}

export const CryptoBotTab: React.FC<CryptoBotTabProps> = ({ onSelectCoin }) => {
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [capital, setCapital] = useState(180);
  const [leverage, setLeverage] = useState(25);
  const [marginPct, setMarginPct] = useState(12.5);
  const [shadowGate, setShadowGate] = useState(true);
  const [isSaved, setIsSaved] = useState(false);

  const fetchStatus = () => {
    fetch('/api/autotrader/status')
      .then(r => r.json())
      .then(d => {
        if (d) {
          if (d.accountCapitalUSD) setCapital(d.accountCapitalUSD);
          if (d.leverage) setLeverage(d.leverage);
          if (d.marginPercentPerTrade) setMarginPct(d.marginPercentPerTrade);
          if (d.shadowGateEnabled !== undefined) setShadowGate(d.shadowGateEnabled);
        }
      })
      .catch(() => {});
  };

  React.useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    if (showConfigModal) {
      fetchStatus();
    }
  }, [showConfigModal]);

  const handleSaveConfig = async () => {
    try {
      await fetch('/api/autotrader/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountCapitalUSD: capital,
          leverage,
          marginPercentPerTrade: marginPct,
          shadowGateEnabled: shadowGate,
        }),
      });
      setIsSaved(true);
      setTimeout(() => {
        setIsSaved(false);
        setShowConfigModal(false);
      }, 1200);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner with Quick Architecture Specs & Config Modal trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-white">Delta Exchange India Protocol:</span>
          <span className="text-slate-400">14 Coins Active • 25x Isolated • Pure 15M Indicators • High-Frequency Execution</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-bot-config"
            onClick={() => setShowConfigModal(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs flex items-center gap-1.5 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" /> Risk Settings
          </button>
        </div>
      </div>

      {/* 2-COLUMN RESPONSIVE LAYOUT: LEFT SIDE LIVE SCORES SECTION + RIGHT SIDE AUTOTRADER CARDS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: LIVE TRADE SCORES SECTION */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-4">
          <LiveTradeScoresSidebar onSelectCoin={onSelectCoin} />
        </div>

        {/* RIGHT COLUMN: MAIN AUTOTRADER WORKSPACE */}
        <div className="lg:col-span-8 xl:col-span-8 space-y-4">
          <DeltaAutoTraderCard onSelectCoin={onSelectCoin} />
        </div>
      </div>

      {/* Institutional Strategy Reference Guide */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-slate-200">
          <Layers className="w-4 h-4 text-indigo-400" />
          Dedicated 15M Institutional Strategy Framework
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-slate-950/70 border border-amber-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-300 mb-1">BTC (NEX-V33)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">71.2% WR</span>
            </div>
            <div className="text-amber-400 text-[11px] font-medium">Quantum Momentum Sniper [V33]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              Zero-Lag EMA with 3-bar institutional candle confirmation (Engulfing/Hammer/Power Bar), RVOL &gt; 0.85, 100 EMA trend filter &amp; 1.40x ATR TP.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-indigo-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-400 mb-1">ETH (NEX-ETH-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold">64.18% WR</span>
            </div>
            <div className="text-indigo-300 text-[11px] font-medium">Quantum Band Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              Zero-Lag Velocity Reversal with 6-Bar Extreme Zone Memory (±30), 20-period 2.0σ BB Pierce &amp; RSI-5 Reclaim, 90 EMA trend filter, 1.60x ATR TP &amp; 1.50x ATR SL (+48.11% net profit).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-purple-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-purple-400 mb-1">SOL (NEX-SOL-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold">77.78% WR</span>
            </div>
            <div className="text-purple-300 text-[11px] font-medium">Quantum Momentum Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              Instant Zero-Lag ZLEMA Cross on 15M Solana dynamics, 6-Bar Extreme Memory (±38), 100 EMA anchor, 0.80x ATR BE &amp; Micro-Trailing Stop, 1.30x ATR TP &amp; 2.40x ATR SL (+102.93% net profit, capital doubled to $357.15).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-teal-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-teal-300 mb-1">SUI (NEX-SUI-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300 font-bold">80.73% WR</span>
            </div>
            <div className="text-teal-400 text-[11px] font-medium">Quantum Band Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              15M Volatility Mean-Reversion: 20-period 2.0σ BB Pierce + RSI-5 exhaustion (&le;45 Buy, &ge;65 Sell), 0.90x ATR TP, 2.40x ATR SL, 0.80x ATR Break-Even lock, Dreiss Choppiness &amp; 5-Bar Tight Box Blocker (+200%+ profit).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-blue-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-400 mb-1">ADA (NEX-ADA-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300">71.19% WR</span>
            </div>
            <div className="text-blue-400 text-[11px] font-medium">Quantum Momentum Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              Cardano 80 EMA trend anchor, 38 extreme threshold, 4-bar candlestick confluence, 1.40x ATR TP &amp; 2.60x ATR SL (+61.51% net profit).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-red-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-red-400 mb-1">AVAX (NEX-AVAX-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-red-500/20 text-red-300">77.65% WR</span>
            </div>
            <div className="text-red-300 text-[11px] font-medium">Quantum Band Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              18-period 1.8σ Bollinger Bands, 5-period RSI mean reversion (Buy ≤45, Sell ≥58), 1.10x ATR TP &amp; 2.40x ATR SL (+520% net profit).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-yellow-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-yellow-300 mb-1">DOGE (NEX-DOGE-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-yellow-500/20 text-yellow-300 font-bold">81.93% WR</span>
            </div>
            <div className="text-yellow-400 text-[11px] font-medium">Quantum Momentum Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              4-bar armed window, ±36 extreme threshold, triple candle confluence, 1.60x ATR TP, 0.80x BE lock &amp; 0.85x micro-trail (+105% net profit).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/70 border border-cyan-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-300 mb-1">XRP (NEX-XRP-PRO)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300">74.05% WR</span>
            </div>
            <div className="text-cyan-400 text-[11px] font-medium">Quantum Momentum Sniper [PRO]</div>
            <p className="text-[11px] text-slate-400 mt-1">
              Zero-Lag EMA with dynamic 4-bar institutional confirmation. Mandatory Virtual Trade First execution with 0.80x BE &amp; 0.85x micro-trailing.
            </p>
          </div>
        </div>
      </div>

      {/* Risk Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">AutoTrader Risk Management</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Account Capital */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Account Capital (USD)
                </label>
                <input
                  type="number"
                  value={capital}
                  onChange={(e) => setCapital(parseFloat(e.target.value) || 180)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">Default initial bankroll: $180.00 USD</span>
              </div>

              {/* Leverage */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Leverage (Isolated)
                </label>
                <select
                  value={leverage}
                  onChange={(e) => setLeverage(parseInt(e.target.value) || 25)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                >
                  <option value={10}>10x Isolated</option>
                  <option value={20}>20x Isolated</option>
                  <option value={25}>25x Isolated (Institutional Baseline)</option>
                  <option value={50}>50x Isolated</option>
                </select>
              </div>

              {/* Margin Per Trade */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1">
                  <Percent className="w-3.5 h-3.5 text-indigo-400" /> Margin Per Trade (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={marginPct}
                  onChange={(e) => setMarginPct(parseFloat(e.target.value) || 12.5)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  12.5% of ${capital} = ${(capital * (marginPct / 100)).toFixed(2)} margin (~${((capital * (marginPct / 100)) * leverage).toFixed(2)} notional)
                </span>
              </div>

              {/* Shadow Gate toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <div>
                  <div className="font-semibold text-white">Virtual Shadow Confirmation Gate</div>
                  <div className="text-[11px] text-slate-400">Must hold +$0.50 virtual profit for 8 seconds</div>
                </div>
                <input
                  type="checkbox"
                  checked={shadowGate}
                  onChange={(e) => setShadowGate(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-slate-800 border-slate-700 cursor-pointer"
                />
              </div>

            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                id="btn-save-risk-config"
                onClick={handleSaveConfig}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-indigo-900/30"
              >
                {isSaved ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Saved!
                  </>
                ) : (
                  'Apply Parameters'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
