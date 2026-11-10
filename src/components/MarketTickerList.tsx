import React, { useState, useMemo } from 'react';
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  BarChart2, 
  SlidersHorizontal,
  Flame,
  ArrowUpDown
} from 'lucide-react';
import { CryptoTicker } from '../types';

interface MarketTickerListProps {
  tickers: CryptoTicker[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onQuickAutoSell: (ticker: CryptoTicker) => void;
  currency: 'USD' | 'INR';
  inrRate: number;
}

export const MarketTickerList: React.FC<MarketTickerListProps> = React.memo(({
  tickers,
  selectedSymbol,
  onSelectSymbol,
  onQuickAutoSell,
  currency,
  inrRate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState<'ALL' | 'MAJOR' | 'LAYER1' | 'MEME' | 'DEFI'>('ALL');
  const [sortBy, setSortBy] = useState<'volume' | 'price' | 'change' | 'symbol'>('volume');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const formatPrice = (price: number) => {
    const val = currency === 'INR' ? price * inrRate : price;
    const prefix = currency === 'INR' ? '₹' : '$';

    if (val >= 1000) {
      return `${prefix}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (val >= 1) {
      return `${prefix}${val.toFixed(4)}`;
    } else {
      return `${prefix}${val.toFixed(6)}`;
    }
  };

  const formatVolume = (vol: number) => {
    const val = currency === 'INR' ? vol * inrRate : vol;
    const prefix = currency === 'INR' ? '₹' : '$';
    if (val >= 1e9) return `${prefix}${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e6) return `${prefix}${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `${prefix}${(val / 1e3).toFixed(2)}K`;
    return `${prefix}${val.toFixed(0)}`;
  };

  // Filter and sort tickers
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => {
        const symbol = t.symbol.toUpperCase();
        const matchesSearch = symbol.includes(searchTerm.toUpperCase());
        if (!matchesSearch) return false;

        if (category === 'MAJOR') {
          return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'].includes(symbol);
        }
        if (category === 'LAYER1') {
          return ['SOLUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'DOTUSDT'].includes(symbol);
        }
        if (category === 'MEME') {
          return ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', '1000SHIBUSDT', '1000PEPEUSDT', '1000FLOKIUSDT', '1000BONKUSDT'].includes(symbol);
        }
        if (category === 'DEFI') {
          return ['LINKUSDT', 'UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'INJUSDT'].includes(symbol);
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === 'volume') diff = b.quoteVolume24h - a.quoteVolume24h;
        else if (sortBy === 'price') diff = b.price - a.price;
        else if (sortBy === 'change') diff = b.changePercent24h - a.changePercent24h;
        else if (sortBy === 'symbol') diff = a.symbol.localeCompare(b.symbol);

        return sortOrder === 'asc' ? -diff : diff;
      });
  }, [tickers, searchTerm, category, sortBy, sortOrder]);

  const toggleSort = (field: 'volume' | 'price' | 'change' | 'symbol') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  // Quick ticker favorites
  const topPicks = tickers.filter(t => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].includes(t.symbol));

  return (
    <div className="space-y-4">
      {/* Top Banner Quick Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {topPicks.map((t) => {
          const isUp = t.changePercent24h >= 0;
          const isSelected = t.symbol === selectedSymbol;
          return (
            <button
              key={t.symbol}
              onClick={() => onSelectSymbol(t.symbol)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                isSelected 
                  ? 'bg-slate-900 border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
                  : 'bg-slate-900/60 hover:bg-slate-900/90 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white tracking-wide">
                  {t.symbol.replace('USDT', '')}
                  <span className="text-[10px] text-slate-500 font-normal ml-1">/USDT</span>
                </span>
                <span className={`text-[11px] font-semibold flex items-center gap-0.5 ${
                  isUp ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {isUp ? '+' : ''}{t.changePercent24h.toFixed(2)}%
                </span>
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-slate-100">
                {formatPrice(t.price)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Table Container */}
      <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl overflow-hidden shadow-xl">
        
        {/* Controls Bar: Search, Categories, Count */}
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search coin (BTC, SOL, DOGE...)"
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
            {(['ALL', 'MAJOR', 'LAYER1', 'DEFI', 'MEME'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  category === cat
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {cat === 'ALL' ? 'All Pairs' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Real-time Crypto Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-950/40">
                <th 
                  className="py-3 px-4 cursor-pointer hover:text-slate-200 transition-colors"
                  onClick={() => toggleSort('symbol')}
                >
                  <div className="flex items-center gap-1">
                    <span>Market Pair</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th 
                  className="py-3 px-4 cursor-pointer hover:text-slate-200 transition-colors"
                  onClick={() => toggleSort('price')}
                >
                  <div className="flex items-center gap-1">
                    <span>Live Price</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th 
                  className="py-3 px-4 cursor-pointer hover:text-slate-200 transition-colors"
                  onClick={() => toggleSort('change')}
                >
                  <div className="flex items-center gap-1">
                    <span>24h Change</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th 
                  className="py-3 px-4 hidden md:table-cell cursor-pointer hover:text-slate-200 transition-colors"
                  onClick={() => toggleSort('volume')}
                >
                  <div className="flex items-center gap-1">
                    <span>24h Volume</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th className="py-3 px-4 hidden lg:table-cell">
                  24h High / Low
                </th>
                <th className="py-3 px-4 text-right">
                  Auto-Sell Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredTickers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No cryptocurrency pairs found matching "{searchTerm}"
                  </td>
                </tr>
              ) : (
                filteredTickers.map((t) => {
                  const isUp = t.changePercent24h >= 0;
                  const isSelected = t.symbol === selectedSymbol;
                  const baseSymbol = t.symbol.replace('USDT', '');

                  return (
                    <tr
                      key={t.symbol}
                      className={`hover:bg-slate-800/40 transition-colors cursor-pointer ${
                        isSelected ? 'bg-emerald-950/20' : ''
                      }`}
                      onClick={() => onSelectSymbol(t.symbol)}
                    >
                      {/* Pair */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-[11px] text-emerald-400">
                            {baseSymbol.slice(0, 3)}
                          </div>
                          <div>
                            <div className="font-bold text-white flex items-center gap-1">
                              {baseSymbol}
                              <span className="text-[10px] text-slate-400 font-normal">/USDT</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                              Binance Spot
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Live Price with Tick Flashes */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-100">
                        <span className={`inline-block px-1.5 py-0.5 rounded transition-all duration-300 ${
                          t.lastTickDirection === 'UP'
                            ? 'bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-400/50'
                            : t.lastTickDirection === 'DOWN'
                            ? 'bg-rose-500/30 text-rose-300 ring-1 ring-rose-400/50'
                            : 'text-slate-100'
                        }`}>
                          {formatPrice(t.price)}
                        </span>
                      </td>

                      {/* 24h Change */}
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-xs ${
                          isUp 
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' 
                            : 'bg-rose-950/60 text-rose-400 border border-rose-800/50'
                        }`}>
                          {isUp ? '+' : ''}{t.changePercent24h.toFixed(2)}%
                        </span>
                      </td>

                      {/* Volume */}
                      <td className="py-3 px-4 font-mono text-slate-300 hidden md:table-cell">
                        {formatVolume(t.quoteVolume24h)}
                      </td>

                      {/* High / Low Bar */}
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <div className="w-32 space-y-1">
                          <div className="flex justify-between text-[10px] font-mono text-slate-400">
                            <span>{formatPrice(t.low24h)}</span>
                            <span>{formatPrice(t.high24h)}</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                            {t.high24h > t.low24h && (
                              <div 
                                className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full"
                                style={{
                                  width: `${Math.min(100, Math.max(5, ((t.price - t.low24h) / (t.high24h - t.low24h)) * 100))}%`
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickAutoSell(t);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-sm transition-all hover:scale-105 cursor-pointer"
                          title={`Set Auto-Sell rule for ${baseSymbol}`}
                        >
                          <Zap className="h-3 w-3 fill-white" />
                          <span>Auto-Sell</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
});
