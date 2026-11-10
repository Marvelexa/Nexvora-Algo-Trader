import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  ShieldAlert, 
  Target, 
  TrendingDown, 
  TrendingUp, 
  Play, 
  Pause, 
  Trash2, 
  Plus, 
  Percent, 
  DollarSign, 
  AlertCircle, 
  Sliders, 
  Flame, 
  ArrowRight,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { AutoSellRule, CryptoTicker, RuleType } from '../types';

interface AutoSellManagerProps {
  rules: AutoSellRule[];
  tickers: CryptoTicker[];
  selectedTicker?: CryptoTicker;
  onCreateRule: (ruleData: Partial<AutoSellRule>) => Promise<void>;
  onToggleRuleStatus: (ruleId: string, currentStatus: string) => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
  onForceExecuteRule: (rule: AutoSellRule) => Promise<void>;
  onCancelAllRules: () => Promise<void>;
}

export const AutoSellManager: React.FC<AutoSellManagerProps> = React.memo(({
  rules,
  tickers,
  selectedTicker,
  onCreateRule,
  onToggleRuleStatus,
  onDeleteRule,
  onForceExecuteRule,
  onCancelAllRules,
}) => {
  const [activeTab, setActiveTab] = useState<'ACTIVE_RULES' | 'CREATE_RULE'>('ACTIVE_RULES');
  
  // Rule Creation form state
  const [symbol, setSymbol] = useState(selectedTicker?.symbol || 'BTCUSDT');
  const [ruleType, setRuleType] = useState<RuleType>('TAKE_PROFIT');
  const [targetOffsetPercent, setTargetOffsetPercent] = useState<number>(5);
  const [customPrice, setCustomPrice] = useState<string>('');
  const [customStopPrice, setCustomStopPrice] = useState<string>('');
  const [trailingPercent, setTrailingPercent] = useState<number>(3);
  const [amountPercent, setAmountPercent] = useState<number>(100);
  const [quantity, setQuantity] = useState<string>('0.1');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formFeedback, setFormFeedback] = useState<string | null>(null);

  // Sync selected ticker
  useEffect(() => {
    if (selectedTicker) {
      setSymbol(selectedTicker.symbol);
      const current = selectedTicker.price;
      if (ruleType === 'TAKE_PROFIT') {
        setCustomPrice((current * 1.05).toFixed(2));
      } else if (ruleType === 'STOP_LOSS') {
        setCustomPrice((current * 0.97).toFixed(2));
      } else if (ruleType === 'RANGE_OCO') {
        setCustomPrice((current * 1.08).toFixed(2));
        setCustomStopPrice((current * 0.95).toFixed(2));
      }
    }
  }, [selectedTicker, ruleType]);

  const currentTicker = tickers.find(t => t.symbol === symbol) || selectedTicker;
  const currentPrice = currentTicker?.price || 65000;
  const baseAsset = symbol.replace('USDT', '');

  // Calculate projected trigger price based on offset %
  const calculatePriceFromPercent = (pct: number, isTakeProfit: boolean) => {
    const mult = isTakeProfit ? (1 + pct / 100) : (1 - pct / 100);
    return (currentPrice * mult).toFixed(2);
  };

  const applyPreset = (preset: 'SCALP' | 'SWING' | 'TRAILING' | 'CRASH_SHIELD') => {
    if (preset === 'SCALP') {
      setRuleType('TAKE_PROFIT');
      setTargetOffsetPercent(3);
      setCustomPrice(calculatePriceFromPercent(3, true));
    } else if (preset === 'SWING') {
      setRuleType('TAKE_PROFIT');
      setTargetOffsetPercent(10);
      setCustomPrice(calculatePriceFromPercent(10, true));
    } else if (preset === 'TRAILING') {
      setRuleType('TRAILING_STOP');
      setTrailingPercent(2.5);
      setCustomPrice(calculatePriceFromPercent(2.5, false));
    } else if (preset === 'CRASH_SHIELD') {
      setRuleType('STOP_LOSS');
      setTargetOffsetPercent(4);
      setCustomPrice(calculatePriceFromPercent(4, false));
    }
  };

  const handleCreateRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalPrice = parseFloat(customPrice);
    const finalQty = parseFloat(quantity);

    if (!finalPrice || finalPrice <= 0 || !finalQty || finalQty <= 0) {
      setFormFeedback('Please enter valid trigger price and quantity');
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    try {
      await onCreateRule({
        symbol,
        baseAsset,
        quoteAsset: 'USDT',
        ruleType,
        triggerPrice: finalPrice,
        takeProfitPrice: ruleType === 'RANGE_OCO' ? finalPrice : undefined,
        stopPrice: ruleType === 'RANGE_OCO' && customStopPrice ? parseFloat(customStopPrice) : undefined,
        trailingPercent: ruleType === 'TRAILING_STOP' ? trailingPercent : undefined,
        trailingPeakPrice: currentPrice,
        amount: finalQty,
        amountPercent,
        entryPrice: currentPrice,
        orderType,
        status: 'ACTIVE',
      });

      setFormFeedback('Auto-Sell rule created and armed!');
      setTimeout(() => {
        setFormFeedback(null);
        setActiveTab('ACTIVE_RULES');
      }, 1200);
    } catch (err: any) {
      setFormFeedback(err.message || 'Failed to create rule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeRules = rules.filter(r => r.status === 'ACTIVE');

  return (
    <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl overflow-hidden shadow-xl">
      {/* Header & Tabs */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Auto-Sell Execution Engine</h3>
            <p className="text-[11px] text-slate-400">High-speed condition triggers on live exchange tick</p>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('ACTIVE_RULES')}
            className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              activeTab === 'ACTIVE_RULES'
                ? 'bg-slate-800 text-emerald-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Active Rules ({activeRules.length})
          </button>
          <button
            onClick={() => setActiveTab('CREATE_RULE')}
            className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 ${
              activeTab === 'CREATE_RULE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            <Plus className="h-3 w-3" />
            New Rule
          </button>
        </div>
      </div>

      {/* Tab 1: Active Rules */}
      {activeTab === 'ACTIVE_RULES' && (
        <div className="p-4 space-y-3">
          {rules.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="h-12 w-12 mx-auto rounded-full bg-slate-800/60 border border-slate-700 flex items-center justify-center text-slate-500">
                <Target className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-300">No Auto-Sell Rules Configured</p>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto mt-1">
                  Set Take-Profit or Stop-Loss rules to automate selling when live prices hit your threshold.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('CREATE_RULE')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Configure First Auto-Sell Rule
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
                <span>Active Triggers ({activeRules.length} monitoring)</span>
                {rules.length > 0 && (
                  <button
                    onClick={onCancelAllRules}
                    className="text-rose-400 hover:text-rose-300 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    Cancel All Rules
                  </button>
                )}
              </div>

              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {rules.map((rule, idx) => {
                  const ruleTicker = tickers.find(t => t.symbol === rule.symbol);
                  const tickPrice = ruleTicker?.price || rule.entryPrice;
                  const isTakeProfit = rule.ruleType === 'TAKE_PROFIT';
                  const isStopLoss = rule.ruleType === 'STOP_LOSS';
                  const isTrailing = rule.ruleType === 'TRAILING_STOP';

                  // Distance calculation
                  const priceDiff = rule.triggerPrice - tickPrice;
                  const distancePct = Math.abs((priceDiff / tickPrice) * 100);
                  const pnlIfTriggered = ((rule.triggerPrice - rule.entryPrice) / rule.entryPrice) * 100;

                  return (
                    <div
                      key={`${rule.id}-${idx}`}
                      className={`p-3.5 rounded-xl border transition-all ${
                        rule.status === 'ACTIVE'
                          ? 'bg-slate-950/90 border-slate-800 hover:border-slate-700'
                          : rule.status === 'EXECUTED'
                          ? 'bg-emerald-950/20 border-emerald-800/40 opacity-75'
                          : 'bg-slate-950/40 border-slate-800/50 opacity-60'
                      }`}
                    >
                      {/* Top row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-xs tracking-wide">
                            {rule.symbol}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            isTakeProfit
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : isStopLoss
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                          }`}>
                            {rule.ruleType.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {rule.orderType}
                          </span>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-1.5">
                          {rule.status === 'ACTIVE' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                              Active Guard
                            </span>
                          ) : rule.status === 'EXECUTED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
                              <CheckCircle2 className="h-3 w-3" />
                              Executed
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                              {rule.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Middle row: Price details */}
                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800/80 mb-2.5">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Trigger Price</span>
                          <span className="font-bold text-white">${rule.triggerPrice.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">Live Price</span>
                          <span className="font-bold text-emerald-400">${tickPrice.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">Estimated PnL</span>
                          <span className={`font-bold ${pnlIfTriggered >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pnlIfTriggered >= 0 ? '+' : ''}{pnlIfTriggered.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Distance Progress Bar */}
                      {rule.status === 'ACTIVE' && (
                        <div className="space-y-1 mb-2.5">
                          <div className="flex justify-between text-[10px] font-mono text-slate-400">
                            <span>Proximity: {distancePct.toFixed(2)}% away</span>
                            <span>Sell Qty: {rule.amount} {rule.baseAsset}</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-500 ${
                                isTakeProfit ? 'bg-emerald-500' : isStopLoss ? 'bg-rose-500' : 'bg-cyan-500'
                              }`}
                              style={{ width: `${Math.max(5, Math.min(100, 100 - distancePct * 5))}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Note or Execution Details if executed */}
                      {rule.executionNote && (
                        <div className="text-[11px] text-slate-400 bg-slate-900/90 p-2 rounded border border-slate-800 mb-2">
                          {rule.executionNote}
                        </div>
                      )}

                      {/* Bottom action controls */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                        <span className="text-[10px] text-slate-500">
                          Created {new Date(rule.createdAt).toLocaleTimeString()}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {rule.status === 'ACTIVE' && (
                            <>
                              <button
                                onClick={() => onForceExecuteRule(rule)}
                                className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                                title="Instantly trigger and execute this auto-sell now"
                              >
                                ⚡ Execute Now
                              </button>
                              <button
                                onClick={() => onToggleRuleStatus(rule.id, rule.status)}
                                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Pause Rule"
                              >
                                <Pause className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {rule.status === 'PAUSED' && (
                            <button
                              onClick={() => onToggleRuleStatus(rule.id, rule.status)}
                              className="px-2 py-1 rounded text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer flex items-center gap-1"
                              title="Resume Rule"
                            >
                              <Play className="h-3 w-3 fill-current" /> Resume
                            </button>
                          )}
                          <button
                            onClick={() => onDeleteRule(rule.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Delete Rule"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Create Auto-Sell Rule Form */}
      {activeTab === 'CREATE_RULE' && (
        <form onSubmit={handleCreateRuleSubmit} className="p-4 space-y-4">
          
          {/* Preset Strategy Buttons */}
          <div>
            <span className="text-xs font-semibold text-slate-400 block mb-1.5">Quick Strategy Presets</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset('SCALP')}
                className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors cursor-pointer"
              >
                <span className="text-[11px] font-bold text-emerald-400 block">🚀 Quick Scalp</span>
                <span className="text-[10px] text-slate-400">+3% Take Profit</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('SWING')}
                className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors cursor-pointer"
              >
                <span className="text-[11px] font-bold text-cyan-400 block">💰 Swing Target</span>
                <span className="text-[10px] text-slate-400">+10% Take Profit</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('CRASH_SHIELD')}
                className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors cursor-pointer"
              >
                <span className="text-[11px] font-bold text-rose-400 block">🛡️ Stop Loss</span>
                <span className="text-[10px] text-slate-400">-4% Protection</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('TRAILING')}
                className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors cursor-pointer"
              >
                <span className="text-[11px] font-bold text-amber-400 block">🌊 Trailing Stop</span>
                <span className="text-[10px] text-slate-400">2.5% Peak Lock</span>
              </button>
            </div>
          </div>

          {/* Symbol & Live Price Header */}
          <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1">Target Crypto Coin</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                {tickers.map(t => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol} (${t.price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="text-[11px] font-semibold text-slate-400 block mb-1">Current Live Price</span>
              <div className="font-mono text-sm font-bold text-emerald-400 pt-1">
                ${currentPrice.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Rule Type Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Auto-Sell Strategy Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(['TAKE_PROFIT', 'STOP_LOSS', 'TRAILING_STOP', 'RANGE_OCO'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRuleType(t)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer text-center ${
                    ruleType === t
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50 ring-1 ring-emerald-400'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {t === 'TAKE_PROFIT' && '🎯 Take Profit'}
                  {t === 'STOP_LOSS' && '🛡️ Stop Loss'}
                  {t === 'TRAILING_STOP' && '📈 Trailing Stop'}
                  {t === 'RANGE_OCO' && '⚖️ Range (OCO)'}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger Price Inputs */}
          <div className="space-y-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">
                  {ruleType === 'TAKE_PROFIT' && 'Target Sell Price ($)'}
                  {ruleType === 'STOP_LOSS' && 'Stop Loss Price Limit ($)'}
                  {ruleType === 'TRAILING_STOP' && 'Initial Stop Floor Price ($)'}
                  {ruleType === 'RANGE_OCO' && 'Take Profit Target ($)'}
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  {currentPrice > 0 && customPrice
                    ? `${(((parseFloat(customPrice) - currentPrice) / currentPrice) * 100).toFixed(2)}% from live`
                    : ''}
                </span>
              </div>
              <input
                type="number"
                step="any"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                placeholder="e.g. 68000"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* If OCO: Stop Price */}
            {ruleType === 'RANGE_OCO' && (
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Stop Loss Guard Price ($)
                </label>
                <input
                  type="number"
                  step="any"
                  value={customStopPrice}
                  onChange={(e) => setCustomStopPrice(e.target.value)}
                  placeholder="e.g. 62000"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            {/* If Trailing: Trailing Distance % */}
            {ruleType === 'TRAILING_STOP' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Trailing Distance: {trailingPercent}%
                  </label>
                  <span className="text-[10px] text-slate-500">Trails behind highest peak</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="15"
                  step="0.5"
                  value={trailingPercent}
                  onChange={(e) => setTrailingPercent(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Amount to Sell & Quantity */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Quantity to Sell ({baseAsset})</label>
              {/* Quick % chips */}
              <div className="flex items-center gap-1">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      setAmountPercent(pct);
                      // Set simulated quantity
                      setQuantity((0.1 * (pct / 100)).toFixed(4));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors ${
                      amountPercent === pct
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            <input
              type="number"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 0.05"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Order Execution Type */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">Execution Order Type</span>
              <span className="text-[11px] text-slate-400">
                {orderType === 'MARKET' ? 'Instant Market Fill on Trigger' : 'Post Limit Order at Trigger'}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setOrderType('MARKET')}
                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                  orderType === 'MARKET' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                }`}
              >
                Market
              </button>
              <button
                type="button"
                onClick={() => setOrderType('LIMIT')}
                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                  orderType === 'LIMIT' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                }`}
              >
                Limit
              </button>
            </div>
          </div>

          {/* Feedback / Alert */}
          {formFeedback && (
            <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-medium text-center">
              {formFeedback}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/60 transition-all hover:scale-[1.01] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Zap className="h-4 w-4 fill-white" />
            {isSubmitting ? 'Arming Auto-Sell Guard...' : 'Arm & Activate Auto-Sell Rule'}
          </button>
        </form>
      )}
    </div>
  );
});
