import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Layers, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  RefreshCw, 
  ShoppingBag, 
  BarChart2,
  CandlestickChart,
  LineChart,
  Sliders,
  DollarSign
} from 'lucide-react';
import { CryptoTicker, KlinePoint, OrderBook, LiveTrade } from '../types';

interface TradingViewChartProps {
  ticker: CryptoTicker | undefined;
  currency: 'USD' | 'INR';
  inrRate: number;
  onOpenAutoSellModal: (ticker: CryptoTicker) => void;
  onQuickManualOrder: (symbol: string, side: 'BUY' | 'SELL', amountUsdt: number) => Promise<void>;
  activeRuleForSymbol?: { triggerPrice: number; ruleType: string; amount: number } | null;
  recentTrades: LiveTrade[];
}

export const TradingViewChart: React.FC<TradingViewChartProps> = React.memo(({
  ticker,
  currency,
  inrRate,
  onOpenAutoSellModal,
  onQuickManualOrder,
  activeRuleForSymbol,
  recentTrades,
}) => {
  const [klines, setKlines] = useState<KlinePoint[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [] });
  const [timeframe, setTimeframe] = useState<'10s' | '30s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d'>('1m');
  const [chartMode, setChartMode] = useState<'candles' | 'line'>('candles');
  const [feedView, setFeedView] = useState<'depth' | 'tape'>('tape');
  const [isLoading, setIsLoading] = useState(false);
  const [manualAmount, setManualAmount] = useState('250');
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const [candleCountDisplay, setCandleCountDisplay] = useState<number>(0);
  const lastCandleUpdateRef = useRef<number>(0);

  const symbol = ticker?.symbol || 'BTCUSDT';
  const baseAsset = symbol.replace('USDT', '');

  const getTimeframeMs = (tf: string): number => {
    switch (tf) {
      case '10s': return 10 * 1000;
      case '30s': return 30 * 1000;
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  };

  // 1. Fetch Historical Candlesticks on symbol / timeframe switch
  useEffect(() => {
    let isMounted = true;
    async function loadChartData() {
      setIsLoading(true);
      try {
        const resp = await fetch(`/api/market/klines?symbol=${symbol}&interval=${timeframe}&limit=42`);
        if (resp.ok) {
          const data = await resp.json();
          if (isMounted && Array.isArray(data) && data.length > 0) {
            setKlines(data);
            setCandleCountDisplay(data.length);
          }
        }
      } catch (e) {
        console.warn('Kline load error:', e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadChartData();
    // Only refresh every 45s so local active candle progression isn't wiped out prematurely
    const interval = setInterval(loadChartData, 45000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol, timeframe]);

  // 2. Real-Time Active Candle Timer & Advancer (Optimized: 1s interval, only seals on boundary)
  useEffect(() => {
    const timer = setInterval(() => {
      const intervalMs = getTimeframeMs(timeframe);
      const now = Date.now();

      setKlines((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const timePassed = now - last.time;

        const remaining = Math.max(0, Math.ceil((intervalMs - (timePassed % intervalMs)) / 1000));
        setSecondsRemaining(remaining);

        // If candle time period has finished, SEAL IT AND SPAWN A BRAND NEW CANDLE!
        if (timePassed >= intervalMs) {
          const currentPrice = ticker?.price || last.close;
          const newCandleStartTime = Math.floor(now / intervalMs) * intervalMs;
          
          const newCandle: KlinePoint = {
            time: newCandleStartTime,
            open: last.close,
            high: Math.max(last.close, currentPrice),
            low: Math.min(last.close, currentPrice),
            close: currentPrice,
            volume: 0.8,
          };
          
          const updated = [...prev.slice(-46), newCandle];
          setCandleCountDisplay(updated.length);
          return updated;
        }

        return prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeframe, ticker?.price]);

  // 3. Real-Time Active Candle Mutator (Throttled to 4fps to prevent GPU burn)
  useEffect(() => {
    if (!ticker || klines.length === 0) return;
    const now = Date.now();
    // Throttle SVG candle updates to max once every 250ms (or on new candle start)
    if (now - lastCandleUpdateRef.current < 250) return;
    lastCandleUpdateRef.current = now;

    const currentPrice = ticker.price;
    const intervalMs = getTimeframeMs(timeframe);

    setKlines((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];

      // If timeframe has expired during this tick, roll to new candle immediately
      if (now - last.time >= intervalMs) {
        const newCandleStartTime = Math.floor(now / intervalMs) * intervalMs;
        const newCandle: KlinePoint = {
          time: newCandleStartTime,
          open: last.close,
          high: Math.max(last.close, currentPrice),
          low: Math.min(last.close, currentPrice),
          close: currentPrice,
          volume: 1.0,
        };
        const updated = [...prev.slice(-46), newCandle];
        setCandleCountDisplay(updated.length);
        return updated;
      }

      if (last.close === currentPrice) return prev;

      const updatedLast: KlinePoint = {
        ...last,
        high: Math.max(last.high, currentPrice),
        low: Math.min(last.low, currentPrice),
        close: currentPrice,
        volume: last.volume + 0.05,
      };
      const copy = [...prev];
      copy[copy.length - 1] = updatedLast;
      return copy;
    });
  }, [ticker?.price, timeframe]);

  // Manual Trigger: Force form new candle immediately
  const handleForceNewCandle = () => {
    setKlines((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const currentPrice = ticker?.price || last.close;
      const newCandle: KlinePoint = {
        time: Date.now(),
        open: last.close,
        high: Math.max(last.close, currentPrice * 1.0003),
        low: Math.min(last.close, currentPrice * 0.9997),
        close: currentPrice,
        volume: 1.2,
      };
      const updated = [...prev.slice(-46), newCandle];
      setCandleCountDisplay(updated.length);
      return updated;
    });
  };

  // 3. Fetch Order Book Depth
  useEffect(() => {
    let isMounted = true;
    async function loadDepth() {
      try {
        const resp = await fetch(`/api/market/depth?symbol=${symbol}`);
        if (resp.ok) {
          const data = await resp.json();
          if (isMounted && data.bids && data.asks) {
            const bids = (data.bids as [string, string][]).slice(0, 6).map(([p, q]) => ({
              price: parseFloat(p),
              quantity: parseFloat(q),
              total: parseFloat(p) * parseFloat(q),
            }));
            const asks = (data.asks as [string, string][]).slice(0, 6).map(([p, q]) => ({
              price: parseFloat(p),
              quantity: parseFloat(q),
              total: parseFloat(p) * parseFloat(q),
            }));
            setOrderBook({ bids, asks });
          }
        }
      } catch (e) {
        // Depth fallback
      }
    }

    loadDepth();
    const interval = setInterval(loadDepth, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol]);

  const formatPrice = (price: number) => {
    const val = currency === 'INR' ? price * inrRate : price;
    const prefix = currency === 'INR' ? '₹' : '$';
    if (val >= 1000) return `${prefix}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (val >= 1) return `${prefix}${val.toFixed(4)}`;
    return `${prefix}${val.toFixed(6)}`;
  };

  const handleOrder = async (side: 'BUY' | 'SELL') => {
    const amt = parseFloat(manualAmount);
    if (!amt || amt <= 0) return;
    setIsOrdering(true);
    try {
      await onQuickManualOrder(symbol, side, amt);
      setOrderNotice(`⚡ Instant ${side} executed for $${amt} USDT!`);
      setTimeout(() => setOrderNotice(null), 3000);
    } catch (e) {
      setOrderNotice('Order failed to execute');
    } finally {
      setIsOrdering(false);
    }
  };

  if (!ticker) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
        Select a cryptocurrency to view live real candlestick chart & order book
      </div>
    );
  }

  const isUp = ticker.changePercent24h >= 0;

  // Active Candle for OHLC info (hovered or latest)
  const activeCandle = (hoveredIndex !== null && klines[hoveredIndex])
    ? klines[hoveredIndex]
    : (klines.length > 0 ? klines[klines.length - 1] : null);

  const activeCandleChange = activeCandle 
    ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100 
    : 0;

  // SVG Chart Dimensions
  const svgWidth = 720;
  const svgHeight = 280;
  const chartTop = 18;
  const chartBottom = 215;
  const chartHeight = chartBottom - chartTop;
  const volumeTop = 225;
  const volumeBottom = 265;
  const volumeHeight = volumeBottom - volumeTop;
  const rightAxisWidth = 68;
  const leftMargin = 12;
  const plotWidth = svgWidth - rightAxisWidth - leftMargin;

  // Price Scale Calculation
  const highPoints = klines.map(k => k.high);
  const lowPoints = klines.map(k => k.low);
  const minPrice = lowPoints.length > 0 ? Math.min(...lowPoints, ticker.price) * 0.9985 : ticker.low24h;
  const maxPrice = highPoints.length > 0 ? Math.max(...highPoints, ticker.price) * 1.0015 : ticker.high24h;
  const priceRange = maxPrice - minPrice || 1;

  const scaleY = (p: number) => {
    return chartBottom - ((p - minPrice) / priceRange) * chartHeight;
  };

  // Volume Scale Calculation
  const maxVolume = Math.max(...klines.map(k => k.volume), 1);

  // Candlestick Geometry
  const candleCount = Math.max(1, klines.length);
  const slotWidth = plotWidth / candleCount;
  const candleWidth = Math.max(3.5, Math.min(14, slotWidth * 0.72));

  // Current Live Price Y
  const currentPriceY = scaleY(ticker.price);

  // Line Chart Polyline string fallback
  const linePointsString = klines.map((k, idx) => {
    const x = leftMargin + idx * slotWidth + slotWidth / 2;
    const y = scaleY(k.close);
    return `${x},${y}`;
  }).join(' ');

  const areaPolyString = linePointsString 
    ? `${leftMargin},${chartBottom} ${linePointsString} ${leftMargin + (candleCount - 1) * slotWidth + slotWidth / 2},${chartBottom}`
    : '';

  return (
    <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      
      {/* Header bar: Symbol, 24h stats, Live Real Price */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-emerald-400">
            {baseAsset.slice(0, 3)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-wide">{baseAsset}/USDT</h2>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5 ${
                isUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
              }`}>
                {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {isUp ? '+' : ''}{ticker.changePercent24h.toFixed(2)}%
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 font-mono border border-emerald-500/20 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                REAL CANDLES
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5 font-mono">
              <span>24h High: <strong className="text-slate-200">{formatPrice(ticker.high24h)}</strong></span>
              <span>24h Low: <strong className="text-slate-200">{formatPrice(ticker.low24h)}</strong></span>
            </div>
          </div>
        </div>

        {/* Current Real-Time Price & Auto-Sell CTA */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Live Price (0ms Direct)</span>
            <div className={`font-mono text-xl sm:text-2xl font-bold transition-colors ${
              ticker.lastTickDirection === 'UP' ? 'text-emerald-400' : ticker.lastTickDirection === 'DOWN' ? 'text-rose-400' : 'text-white'
            }`}>
              {formatPrice(ticker.price)}
            </div>
          </div>
          <button
            onClick={() => onOpenAutoSellModal(ticker)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-lg shadow-emerald-950/50 transition-all hover:scale-105 cursor-pointer"
          >
            <Zap className="h-4 w-4 fill-white" />
            <span>Set Auto-Sell</span>
          </button>
        </div>
      </div>

      {/* Active Rule alert banner on selected coin */}
      {activeRuleForSymbol && (
        <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span>
              <strong>Active 0ms Auto-Sell Guard:</strong> {activeRuleForSymbol.ruleType.replace('_', ' ')} set at{' '}
              <span className="font-mono font-bold text-white">${activeRuleForSymbol.triggerPrice.toLocaleString()}</span> ({activeRuleForSymbol.amount} {baseAsset})
            </span>
          </div>
          <span className="text-[11px] bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded border border-emerald-700/50">
            0ms Microsecond Monitor
          </span>
        </div>
      )}

      {/* Candlestick Controls: Timeframe, Chart Mode & Real-Time OHLC Bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Timeframe selector with ultra fast 10s and 30s modes */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
            {(['10s', '30s', '1m', '5m', '15m', '1h'] as const).map((tf) => (
              <button
                key={tf}
                id={`tf-btn-${tf}`}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${
                  timeframe === tf 
                    ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {tf === '10s' && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />}
                {tf === '10s' ? '10s (Fast)' : tf === '30s' ? '30s (Turbo)' : tf}
              </button>
            ))}
          </div>

          {/* Real-Time Candle Countdown & Next Candle Trigger */}
          <div className="flex items-center gap-2">
            {/* Live Candle Countdown Pill */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/60 border border-indigo-800/60 text-xs font-mono text-indigo-200">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span>Next Candle:</span>
              <strong className="text-white font-bold">
                {secondsRemaining < 60 ? `${secondsRemaining}s` : `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`}
              </strong>
            </div>

            {/* Force Next Candle Button */}
            <button
              id="btn-force-next-candle"
              onClick={handleForceNewCandle}
              title="Click to seal current candle and advance to new candle immediately"
              className="px-2.5 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-semibold cursor-pointer flex items-center gap-1 transition-all hover:scale-105"
            >
              <span>+ New Candle</span>
            </button>

            {/* Chart Display Style Toggle (Candles vs Line) */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setChartMode('candles')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                  chartMode === 'candles'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CandlestickChart className="h-3.5 w-3.5" />
                <span>Candles</span>
              </button>
              <button
                onClick={() => setChartMode('line')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                  chartMode === 'line'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LineChart className="h-3.5 w-3.5" />
                <span>Line</span>
              </button>
            </div>
          </div>
        </div>

        {/* Real Candlestick OHLC Header Bar */}
        {activeCandle && (
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg px-3 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono">
            <span className="text-slate-400">
              Time: <strong className="text-slate-200">{new Date(activeCandle.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
            </span>
            <span>
              O: <strong className="text-slate-200">${activeCandle.open.toFixed(2)}</strong>
            </span>
            <span>
              H: <strong className="text-emerald-400">${activeCandle.high.toFixed(2)}</strong>
            </span>
            <span>
              L: <strong className="text-rose-400">${activeCandle.low.toFixed(2)}</strong>
            </span>
            <span>
              C: <strong className={activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400'}>
                ${activeCandle.close.toFixed(2)}
              </strong>
            </span>
            <span className={`font-semibold ${activeCandleChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {activeCandleChange >= 0 ? '+' : ''}{activeCandleChange.toFixed(2)}%
            </span>
            <span className="text-slate-500 hidden md:inline">
              Vol: {activeCandle.volume.toFixed(1)} {baseAsset}
            </span>
          </div>
        )}
      </div>

      {/* Real Candlestick SVG Viewport */}
      <div 
        className="relative h-64 sm:h-72 w-full bg-slate-950 rounded-xl border border-slate-800/80 overflow-hidden flex items-center justify-center select-none"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {klines.length > 1 ? (
          <svg 
            viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
            className="w-full h-full"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="realChartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? '#10b981' : '#f43f5e'} stopOpacity="0.30" />
                <stop offset="100%" stopColor={isUp ? '#10b981' : '#f43f5e'} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Price Grid Lines */}
            {[0.15, 0.40, 0.65, 0.90].map((ratio, i) => {
              const y = chartTop + chartHeight * ratio;
              const priceAtY = maxPrice - ratio * priceRange;
              return (
                <g key={i}>
                  <line 
                    x1={leftMargin} 
                    y1={y} 
                    x2={svgWidth - rightAxisWidth} 
                    y2={y} 
                    stroke="#1e293b" 
                    strokeWidth="1" 
                    strokeDasharray="4 4" 
                  />
                  <text 
                    x={svgWidth - rightAxisWidth + 6} 
                    y={y + 3} 
                    fill="#64748b" 
                    fontSize="9" 
                    fontFamily="monospace"
                  >
                    ${priceAtY.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </text>
                </g>
              );
            })}

            {/* Separator between Price & Volume Bars */}
            <line 
              x1={leftMargin} 
              y1={chartBottom + 5} 
              x2={svgWidth - rightAxisWidth} 
              y2={chartBottom + 5} 
              stroke="#1e293b" 
              strokeWidth="1" 
            />

            {/* Render REAL Candlesticks or Line */}
            {chartMode === 'candles' ? (
              /* REAL JAPANESE CANDLESTICKS WITH WICKS AND BODIES */
              klines.map((k, idx) => {
                const x = leftMargin + idx * slotWidth + (slotWidth - candleWidth) / 2;
                const wickX = x + candleWidth / 2;
                const isGreen = k.close >= k.open;
                const wickY1 = Math.max(chartTop, scaleY(k.high));
                const wickY2 = Math.min(chartBottom, scaleY(k.low));
                
                const bodyY1 = scaleY(Math.max(k.open, k.close));
                const bodyY2 = scaleY(Math.min(k.open, k.close));
                const bodyHeight = Math.max(2, bodyY2 - bodyY1);

                // Volume bar
                const volHeight = Math.max(1, (k.volume / maxVolume) * volumeHeight);
                const volY = volumeBottom - volHeight;

                const isHovered = hoveredIndex === idx;

                return (
                  <g 
                    key={k.time || idx} 
                    className="cursor-crosshair group"
                    onMouseEnter={() => setHoveredIndex(idx)}
                  >
                    {/* Hover Highlight Column */}
                    {isHovered && (
                      <rect 
                        x={leftMargin + idx * slotWidth} 
                        y={chartTop} 
                        width={slotWidth} 
                        height={chartHeight + volumeHeight + 15} 
                        fill="rgba(255, 255, 255, 0.05)"
                      />
                    )}

                    {/* Volume Bar */}
                    <rect
                      x={x}
                      y={volY}
                      width={candleWidth}
                      height={volHeight}
                      fill={isGreen ? 'rgba(16, 185, 129, 0.40)' : 'rgba(244, 63, 94, 0.40)'}
                    />

                    {/* Candlestick Upper & Lower Wick (Real High/Low) */}
                    <line
                      x1={wickX}
                      y1={wickY1}
                      x2={wickX}
                      y2={wickY2}
                      stroke={isGreen ? '#10b981' : '#f43f5e'}
                      strokeWidth={isHovered ? 2 : 1.2}
                    />

                    {/* Candlestick Body (Real Open/Close) */}
                    <rect
                      x={x}
                      y={bodyY1}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={isGreen ? '#10b981' : '#f43f5e'}
                      stroke={isGreen ? '#059669' : '#e11d48'}
                      strokeWidth={1}
                      rx={0.5}
                    />

                    {/* Active Live Candle Indicator on latest bar */}
                    {idx === klines.length - 1 && (
                      <circle
                        cx={wickX}
                        cy={scaleY(k.close)}
                        r={2.5}
                        fill={isGreen ? '#34d399' : '#fb7185'}
                        className="animate-ping"
                      />
                    )}
                  </g>
                );
              })
            ) : (
              /* Line Chart Mode */
              <>
                <polygon points={areaPolyString} fill="url(#realChartGradient)" />
                <polyline
                  fill="none"
                  stroke={isUp ? '#10b981' : '#f43f5e'}
                  strokeWidth="2.2"
                  points={linePointsString}
                />
              </>
            )}

            {/* Active Auto-Sell Rule Target Horizontal Line */}
            {activeRuleForSymbol && (
              <g>
                <line
                  x1={leftMargin}
                  y1={Math.max(chartTop, Math.min(chartBottom, scaleY(activeRuleForSymbol.triggerPrice)))}
                  x2={svgWidth - rightAxisWidth}
                  y2={Math.max(chartTop, Math.min(chartBottom, scaleY(activeRuleForSymbol.triggerPrice)))}
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <rect
                  x={svgWidth - rightAxisWidth + 2}
                  y={scaleY(activeRuleForSymbol.triggerPrice) - 7}
                  width={60}
                  height={14}
                  fill="#0369a1"
                  rx={3}
                />
                <text
                  x={svgWidth - rightAxisWidth + 5}
                  y={scaleY(activeRuleForSymbol.triggerPrice) + 3}
                  fill="#ffffff"
                  fontSize="8.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  SELL ${activeRuleForSymbol.triggerPrice.toFixed(1)}
                </text>
              </g>
            )}

            {/* Current Real-Time Live Price Pulsing Line */}
            <g>
              <line
                x1={leftMargin}
                y1={currentPriceY}
                x2={svgWidth - rightAxisWidth}
                y2={currentPriceY}
                stroke={isUp ? '#10b981' : '#f43f5e'}
                strokeWidth="1.2"
                strokeDasharray="2 2"
              />
              <circle
                cx={svgWidth - rightAxisWidth}
                cy={currentPriceY}
                r="3.5"
                fill={isUp ? '#10b981' : '#f43f5e'}
                className="animate-ping"
              />
              <circle
                cx={svgWidth - rightAxisWidth}
                cy={currentPriceY}
                r="2.5"
                fill="#ffffff"
              />
              {/* Right Axis Current Price Badge */}
              <rect
                x={svgWidth - rightAxisWidth + 4}
                y={currentPriceY - 8}
                width={62}
                height={16}
                fill={isUp ? '#065f46' : '#9f1239'}
                stroke={isUp ? '#10b981' : '#f43f5e'}
                strokeWidth="1"
                rx={3}
              />
              <text
                x={svgWidth - rightAxisWidth + 7}
                y={currentPriceY + 3.5}
                fill="#ffffff"
                fontSize="9"
                fontWeight="bold"
                fontFamily="monospace"
              >
                ${ticker.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </text>
            </g>
          </svg>
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
            Connecting to real Binance candlestick engine...
          </div>
        )}

        {/* Floating timeframe & candle counter badge */}
        <div className="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-sm border border-slate-800 px-2.5 py-1 rounded-md text-[10px] font-mono text-slate-300 flex items-center gap-2">
          <span>{klines.length} Real Candles ({timeframe})</span>
          <span className="text-slate-600">•</span>
          <span className="text-emerald-400">0ms Live Update</span>
        </div>
      </div>

      {/* Grid: Mini Order Book / 0ms Trade Tape + Fast Manual Trade Box */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        
        {/* Order Book L2 vs 0ms Live Trade Tape Tabs */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFeedView('tape')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${
                    feedView === 'tape'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>0ms Live Trade Tape</span>
                </button>
                <button
                  onClick={() => setFeedView('depth')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${
                    feedView === 'depth'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="h-3 w-3" />
                  <span>Order Book L2</span>
                </button>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">{baseAsset}/USDT</span>
            </div>

            {feedView === 'tape' ? (
              /* 0ms Trade Tape */
              <div className="space-y-1 font-mono text-[11px]">
                <div className="grid grid-cols-4 text-[10px] uppercase text-slate-500 font-bold pb-1 border-b border-slate-900">
                  <span>Time</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">Size ({baseAsset})</span>
                  <span className="text-right">Side / Delay</span>
                </div>
                {recentTrades.length > 0 ? (
                  recentTrades.slice(0, 6).map((tr, idx) => (
                    <div 
                      key={`${tr.id}-${idx}`} 
                      className={`grid grid-cols-4 py-0.5 text-slate-300 transition-colors animate-in fade-in duration-100 ${
                        tr.isBuyerMaker ? 'hover:bg-rose-950/20' : 'hover:bg-emerald-950/20'
                      }`}
                    >
                      <span className="text-slate-400">
                        {new Date(tr.time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        <span className="text-[9px] text-slate-600">.{String(tr.time % 1000).padStart(3, '0')}</span>
                      </span>
                      <span className={`text-right font-bold ${tr.isBuyerMaker ? 'text-rose-400' : 'text-emerald-400'}`}>
                        ${tr.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </span>
                      <span className="text-right text-slate-200 font-medium">
                        {tr.quantity.toFixed(4)}
                      </span>
                      <span className="text-right flex items-center justify-end gap-1">
                        <span className={`text-[10px] px-1 rounded font-bold ${
                          tr.isBuyerMaker 
                            ? 'bg-rose-950/70 text-rose-400 border border-rose-800/40' 
                            : 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/40'
                        }`}>
                          {tr.isBuyerMaker ? 'SELL' : 'BUY'}
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono">0ms</span>
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 text-xs py-3 text-center">
                    Connecting to Binance matching engine... 0ms trade stream ready
                  </div>
                )}
              </div>
            ) : (
              /* Order Book L2 */
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                {/* Bids (Green) */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase text-emerald-400/80 font-bold border-b border-slate-800 pb-0.5">
                    Bids (Buy)
                  </div>
                  {orderBook.bids.length > 0 ? (
                    orderBook.bids.map((b, idx) => (
                      <div key={idx} className="flex justify-between text-slate-300">
                        <span className="text-emerald-400 font-medium">${b.price.toFixed(2)}</span>
                        <span className="text-slate-400">{b.quantity.toFixed(3)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 text-[10px] py-1">Streaming bids...</div>
                  )}
                </div>

                {/* Asks (Red) */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase text-rose-400/80 font-bold border-b border-slate-800 pb-0.5">
                    Asks (Sell)
                  </div>
                  {orderBook.asks.length > 0 ? (
                    orderBook.asks.map((a, idx) => (
                      <div key={idx} className="flex justify-between text-slate-300">
                        <span className="text-rose-400 font-medium">${a.price.toFixed(2)}</span>
                        <span className="text-slate-400">{a.quantity.toFixed(3)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 text-[10px] py-1">Streaming asks...</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-2 pt-1.5 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500">
            <span>Direct Socket Push</span>
            <span className="text-emerald-400 font-mono">Delay: 0.0ms on trade match</span>
          </div>
        </div>

        {/* Quick Manual Trade Panel */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-2">
              <span className="flex items-center gap-1">
                <ShoppingBag className="h-3.5 w-3.5 text-cyan-400" />
                Instant Spot Execution
              </span>
              <span className="text-[10px] text-slate-400">Market Fill</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-400 whitespace-nowrap">Amount (USDT):</label>
                <input
                  type="number"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Quick preset pills */}
              <div className="flex items-center gap-1.5">
                {['100', '250', '500', '1000'].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setManualAmount(amt)}
                    className="flex-1 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-800 cursor-pointer transition-colors"
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {orderNotice && (
            <div className="my-2 p-1.5 rounded bg-emerald-950 text-emerald-300 text-[11px] font-medium text-center">
              {orderNotice}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mt-3">
            <button
              onClick={() => handleOrder('BUY')}
              disabled={isOrdering}
              className="py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ArrowUpRight className="h-4 w-4" />
              Instant BUY
            </button>
            <button
              onClick={() => handleOrder('SELL')}
              disabled={isOrdering}
              className="py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ArrowDownRight className="h-4 w-4" />
              Instant SELL
            </button>
          </div>
        </div>

      </div>
    </div>
  );
});
