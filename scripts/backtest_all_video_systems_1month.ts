import fs from 'fs';
import path from 'path';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

// Cache directory for 1-month historical klines
const CACHE_DIR = path.join(process.cwd(), '.cache_candles_1m');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'SUIUSDT',
  'BNBUSDT',
  'LINKUSDT',
];

const SYSTEMS = [
  { port: 3025, name: 'System 3025 (Brad Goh Reversal Engine - PkAtVH6YVM8)' },
  { port: 3002, name: 'System 3002 (Whiteboard Crypto DeFi AMM Snapback)' },
  { port: 3003, name: 'System 3003 (HBA Market Structure Breakout - 7PPuMzuzMek)' },
  { port: 3004, name: 'System 3004 (HBA Candlesticks & Trendlines - d9Qe6m90z6Y)' },
  { port: 3005, name: 'System 3005 (HBA Fibonacci Golden Pocket - Kdf0v24npt8)' },
  { port: 3006, name: 'System 3006 (Craig Percoco Smart Money FVG - 9Lpnd8i-8iM)' },
  { port: 3007, name: 'System 3007 (Marwadi Trader Trap & Sidhant World Champion)' },
  { port: 3001, name: 'System 3001 (Zero-Lag Price Action Engine)' },
  { port: 3008, name: 'System 3008 (Charuka Wyckoff VSA Strategy)' },
  { port: 3010, name: 'System 3010 (Stock Burner Trap Engine)' },
  { port: 3012, name: 'System 3012 (IITian Trader Institutional Method)' },
  { port: 3013, name: 'System 3013 (Neeraj Joshi Crypto Strategy)' },
  { port: 3014, name: 'System 3014 (VirtualBacon 7-Year Crypto Strategy)' },
  { port: 3015, name: 'System 3015 (Thomas Kralow Institutional Strategy)' },
];

async function fetchOneMonthCandles(symbol: string): Promise<KlinePoint[]> {
  const cacheFile = path.join(CACHE_DIR, `${symbol}_15m_1month.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached) && cached.length >= 2500) {
        return cached;
      }
    } catch (e) {}
  }

  console.log(`📥 Fetching 1 month of 15m candles for ${symbol}...`);
  const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  let allCandles: KlinePoint[] = [];
  let startTime = oneMonthAgo;

  while (allCandles.length < 3000) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=15m&startTime=${startTime}&limit=1000`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      for (const k of data) {
        allCandles.push({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        });
      }
      startTime = data[data.length - 1][0] + (15 * 60 * 1000);
      if (data.length < 1000) break;
    } catch (e) {
      break;
    }
  }

  if (allCandles.length >= 500) {
    fs.writeFileSync(cacheFile, JSON.stringify(allCandles, null, 2));
    console.log(`✅ Cached ${allCandles.length} candles for ${symbol}`);
  }
  return allCandles;
}

interface TradeRecord {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  reversalLevel: number;
  rr: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnlUSD: number;
  strategyName: string;
}

interface SystemResult {
  port: number;
  name: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  profitFactor: number;
  avgRR: number;
  maxDrawdown: number;
  coinBreakdown: Record<string, { trades: number; wins: number; losses: number; winRate: number; netPnL: number }>;
}

async function backtestSystem(sys: { port: number; name: string }, symbolData: Record<string, KlinePoint[]>): Promise<SystemResult> {
  const trades: TradeRecord[] = [];
  const notionalPerTrade = 1000; // $1,000 USD notional per trade (standard 30x leverage with $33 margin)
  const coinBreakdown: Record<string, { trades: number; wins: number; losses: number; winRate: number; netPnL: number }> = {};

  for (const sym of SYMBOLS) {
    const candles = symbolData[sym];
    if (!candles || candles.length < 100) continue;

    coinBreakdown[sym] = { trades: 0, wins: 0, losses: 0, winRate: 0, netPnL: 0 };

    let activeTrade: {
      side: 'BUY' | 'SELL';
      entryPrice: number;
      entryTime: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      initialSL: number;
      reversalLevel: number;
      rr: number;
      strategyName: string;
      isBreakeven: boolean;
      barsHeld: number;
    } | null = null;

    let cooldownBars = 0;

    for (let i = 40; i < candles.length - 1; i++) {
      const windowCandles = candles.slice(i - 40, i + 1);
      const currentBar = candles[i];
      const nextBar = candles[i + 1];

      if (cooldownBars > 0) {
        cooldownBars--;
      }

      // Check active trade resolution on current bar
      if (activeTrade) {
        activeTrade.barsHeld++;
        const { side, entryPrice, stopLossPrice, takeProfitPrice, initialSL, reversalLevel, rr, strategyName } = activeTrade;
        const totalTargetDistance = Math.abs(takeProfitPrice - entryPrice);
        const slDistance = Math.abs(entryPrice - initialSL);

        let tradeClosed = false;
        let outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = 'LOSS';
        let exitPrice = currentBar.close;
        let pnlUSD = 0;

        if (side === 'BUY') {
          // Breakeven lock when price achieves 55% of the distance to the exact reversal TP
          const currentGain = currentBar.high - entryPrice;
          if (currentGain >= 0.55 * totalTargetDistance && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice + (0.05 * slDistance); // Lock small profit above breakeven
          }

          if (currentBar.high >= takeProfitPrice) {
            // Reversal Take Profit hit!
            tradeClosed = true;
            outcome = 'WIN';
            exitPrice = takeProfitPrice;
            pnlUSD = (totalTargetDistance / entryPrice) * notionalPerTrade;
          } else if (currentBar.low <= activeTrade.stopLossPrice) {
            tradeClosed = true;
            exitPrice = activeTrade.stopLossPrice;
            if (activeTrade.isBreakeven) {
              outcome = 'BREAKEVEN';
              pnlUSD = 0.50; // Nominal breakeven buffer
            } else {
              outcome = 'LOSS';
              pnlUSD = -((entryPrice - activeTrade.stopLossPrice) / entryPrice) * notionalPerTrade;
            }
          }
        } else {
          // SELL (SHORT)
          const currentGain = entryPrice - currentBar.low;
          if (currentGain >= 0.55 * totalTargetDistance && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice - (0.05 * slDistance);
          }

          if (currentBar.low <= takeProfitPrice) {
            // Reversal Take Profit hit!
            tradeClosed = true;
            outcome = 'WIN';
            exitPrice = takeProfitPrice;
            pnlUSD = (totalTargetDistance / entryPrice) * notionalPerTrade;
          } else if (currentBar.high >= activeTrade.stopLossPrice) {
            tradeClosed = true;
            exitPrice = activeTrade.stopLossPrice;
            if (activeTrade.isBreakeven) {
              outcome = 'BREAKEVEN';
              pnlUSD = 0.50;
            } else {
              outcome = 'LOSS';
              pnlUSD = -((activeTrade.stopLossPrice - entryPrice) / entryPrice) * notionalPerTrade;
            }
          }
        }

        // Time-based stall protection: If trade is stagnant for > 48 bars (12 hours) without hitting TP or SL, close at market
        if (!tradeClosed && activeTrade.barsHeld >= 48) {
          tradeClosed = true;
          exitPrice = currentBar.close;
          const diff = side === 'BUY' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
          pnlUSD = (diff / entryPrice) * notionalPerTrade;
          outcome = pnlUSD > 0 ? (pnlUSD >= 5 ? 'WIN' : 'BREAKEVEN') : 'LOSS';
        }

        if (tradeClosed) {
          trades.push({
            symbol: sym,
            side,
            entryTime: activeTrade.entryTime,
            entryPrice,
            exitTime: currentBar.time,
            exitPrice,
            stopLossPrice: activeTrade.stopLossPrice,
            takeProfitPrice,
            reversalLevel,
            rr,
            outcome,
            pnlUSD,
            strategyName,
          });

          coinBreakdown[sym].trades++;
          if (outcome === 'WIN') coinBreakdown[sym].wins++;
          else if (outcome === 'LOSS') coinBreakdown[sym].losses++;
          coinBreakdown[sym].netPnL += pnlUSD;

          activeTrade = null;
          cooldownBars = 2; // 30-min cooldown
        }
      }

      // Check for new entry signal if no active trade and not in cooldown
      if (!activeTrade && cooldownBars === 0) {
        const stratResult = evaluateStrategyForPort(sys.port, sym, windowCandles);
        if (stratResult && stratResult.signal && (stratResult.confidenceScore || 0) >= 70) {
          const side = stratResult.signal;
          const entryPrice = currentBar.close;
          let customSL = stratResult.customSL;
          let customTP = stratResult.customTP;

          // Compute ATR (14-period)
          let atrSum = 0;
          for (let k = windowCandles.length - 14; k < windowCandles.length; k++) {
            const b = windowCandles[k];
            const prevB = windowCandles[k - 1] || b;
            const tr = Math.max(b.high - b.low, Math.abs(b.high - prevB.close), Math.abs(b.low - prevB.close));
            atrSum += tr;
          }
          const atr = atrSum / 14;

          const isMajor = sym.includes('BTC') || sym.includes('ETH');
          const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
          const minBreathingDistance = entryPrice * minBreathingPercent;

          const prior30 = windowCandles.slice(-30);
          const swingHigh = Math.max(...prior30.map(c => c.high));
          const swingLow = Math.min(...prior30.map(c => c.low));

          let finalTP: number;
          let finalSL: number;
          let reversalLevel: number;

          if (side === 'BUY') {
            // Reversal TP is placed strictly at the opposing swing high (Supply Zone)
            reversalLevel = customTP && customTP > entryPrice ? customTP : swingHigh;
            const preReversalBuffer = Math.max(0.05 * atr, 0.00025 * entryPrice);
            finalTP = reversalLevel - preReversalBuffer;

            // Invalidation Stop Loss strictly below structural low + breathing room
            const sweepTrough = customSL && customSL < entryPrice ? customSL : swingLow;
            const slDist = Math.max(entryPrice - (sweepTrough - 0.25 * atr), minBreathingDistance);
            finalSL = entryPrice - slDist;

            const roomToReversal = finalTP - entryPrice;
            const risk = entryPrice - finalSL;
            const rr = risk > 0 ? roomToReversal / risk : 0;

            // Strict Zero-Overextension Rule (Brad Goh PkAtVH6YVM8):
            // If room to opposing reversal does not give >= 1:2.30 RR, REJECT THE TRADE!
            if (rr >= 2.25 && roomToReversal > 0) {
              activeTrade = {
                side: 'BUY',
                entryPrice,
                entryTime: currentBar.time,
                stopLossPrice: finalSL,
                takeProfitPrice: finalTP,
                initialSL: finalSL,
                reversalLevel,
                rr: parseFloat(rr.toFixed(2)),
                strategyName: stratResult.strategyName || sys.name,
                isBreakeven: false,
                barsHeld: 0,
              };
            }
          } else {
            // SELL
            // Reversal TP is placed strictly at the opposing swing low (Demand Zone)
            reversalLevel = customTP && customTP < entryPrice ? customTP : swingLow;
            const preReversalBuffer = Math.max(0.05 * atr, 0.00025 * entryPrice);
            finalTP = reversalLevel + preReversalBuffer;

            // Invalidation Stop Loss strictly above structural high + breathing room
            const sweepPeak = customSL && customSL > entryPrice ? customSL : swingHigh;
            const slDist = Math.max((sweepPeak + 0.25 * atr) - entryPrice, minBreathingDistance);
            finalSL = entryPrice + slDist;

            const roomToReversal = entryPrice - finalTP;
            const risk = finalSL - entryPrice;
            const rr = risk > 0 ? roomToReversal / risk : 0;

            // Strict Zero-Overextension Rule:
            if (rr >= 2.25 && roomToReversal > 0) {
              activeTrade = {
                side: 'SELL',
                entryPrice,
                entryTime: currentBar.time,
                stopLossPrice: finalSL,
                takeProfitPrice: finalTP,
                initialSL: finalSL,
                reversalLevel,
                rr: parseFloat(rr.toFixed(2)),
                strategyName: stratResult.strategyName || sys.name,
                isBreakeven: false,
                barsHeld: 0,
              };
            }
          }
        }
      }
    }

    if (coinBreakdown[sym].trades > 0) {
      coinBreakdown[sym].winRate = parseFloat(((coinBreakdown[sym].wins / coinBreakdown[sym].trades) * 100).toFixed(1));
      coinBreakdown[sym].netPnL = parseFloat(coinBreakdown[sym].netPnL.toFixed(2));
    }
  }

  const totalTrades = trades.length;
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  const breakevens = trades.filter(t => t.outcome === 'BREAKEVEN').length;
  const winRate = totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(1)) : 0;

  const grossProfit = parseFloat(trades.filter(t => t.pnlUSD > 0).reduce((acc, t) => acc + t.pnlUSD, 0).toFixed(2));
  const grossLoss = parseFloat(Math.abs(trades.filter(t => t.pnlUSD < 0).reduce((acc, t) => acc + t.pnlUSD, 0)).toFixed(2));
  const netPnL = parseFloat((grossProfit - grossLoss).toFixed(2));
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99.0 : 0);
  const avgRR = totalTrades > 0 ? parseFloat((trades.reduce((acc, t) => acc + t.rr, 0) / totalTrades).toFixed(2)) : 0;

  // Calculate Max Drawdown
  let peak = 0;
  let cumPnL = 0;
  let maxDD = 0;
  for (const t of trades) {
    cumPnL += t.pnlUSD;
    if (cumPnL > peak) peak = cumPnL;
    const dd = peak - cumPnL;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    port: sys.port,
    name: sys.name,
    totalTrades,
    wins,
    losses,
    breakevens,
    winRate,
    grossProfit,
    grossLoss,
    netPnL,
    profitFactor,
    avgRR,
    maxDrawdown: parseFloat(maxDD.toFixed(2)),
    coinBreakdown,
  };
}

async function main() {
  console.log(`========================================================================================`);
  console.log(`🔬 30-DAY COMPREHENSIVE BACKTEST ACROSS ALL VIDEO STRATEGIES & ALL MAJOR COINS`);
  console.log(`Timeframe: 15-Minute Klines (Last 30 Days: ~2,880 candles per coin)`);
  console.log(`Execution Model: Direct Trading (BUY ➔ BUY, SELL ➔ SELL)`);
  console.log(`TP/SL Rule: Strict Pre-Reversal Opposing Structure TP + Breathing Room SL (Zero-Overextension)`);
  console.log(`Coins Tested: ${SYMBOLS.join(', ')}`);
  console.log(`========================================================================================\n`);

  // 1. Fetch candles for all coins
  const symbolData: Record<string, KlinePoint[]> = {};
  for (const sym of SYMBOLS) {
    const candles = await fetchOneMonthCandles(sym);
    symbolData[sym] = candles;
  }

  console.log(`\n⏳ Running backtests across ${SYSTEMS.length} video systems... Please wait.\n`);

  const results: SystemResult[] = [];
  for (const sys of SYSTEMS) {
    process.stdout.write(`  Testing ${sys.name}... `);
    const startT = Date.now();
    const res = await backtestSystem(sys, symbolData);
    results.push(res);
    console.log(`Done (${res.totalTrades} trades, ${res.winRate}% WR, Net PnL: $${res.netPnL >= 0 ? '+' : ''}${res.netPnL}) in ${Date.now() - startT}ms`);
  }

  // Sort results by Net PnL descending
  results.sort((a, b) => b.netPnL - a.netPnL);

  console.log(`\n========================================================================================`);
  console.log(`📊 FINAL BACKTEST RANKING TABLE (LAST 30 DAYS - ALL 10 COINS - EXACT REVERSAL TP)`);
  console.log(`========================================================================================`);
  console.log(
    `Rank | System                                             | Trades | Win Rate | Gross Profit | Gross Loss  | Net PnL     | Profit Factor | Avg RR | Max DD`
  );
  console.log(`------------------------------------------------------------------------------------------------------------------------------------------------`);

  results.forEach((r, idx) => {
    const rankStr = (idx + 1).toString().padStart(4);
    const nameStr = r.name.padEnd(50).slice(0, 50);
    const tradesStr = r.totalTrades.toString().padStart(6);
    const wrStr = `${r.winRate}%`.padStart(8);
    const gpStr = `$${r.grossProfit.toFixed(2)}`.padStart(12);
    const glStr = `$${r.grossLoss.toFixed(2)}`.padStart(11);
    const netStr = `${r.netPnL >= 0 ? '+' : ''}$${r.netPnL.toFixed(2)}`.padStart(11);
    const pfStr = r.profitFactor.toString().padStart(13);
    const rrStr = `1:${r.avgRR}`.padStart(6);
    const ddStr = `$${r.maxDrawdown.toFixed(2)}`.padStart(8);

    console.log(`${rankStr} | ${nameStr} | ${tradesStr} | ${wrStr} | ${gpStr} | ${glStr} | ${netStr} | ${pfStr} | ${rrStr} | ${ddStr}`);
  });

  console.log(`========================================================================================\n`);

  // Save detailed JSON report
  const reportPath = path.join(process.cwd(), 'public', 'all_video_systems_1month_backtest_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📁 Detailed JSON report saved to ${reportPath}`);
}

main().catch(err => {
  console.error('Backtest error:', err);
});
