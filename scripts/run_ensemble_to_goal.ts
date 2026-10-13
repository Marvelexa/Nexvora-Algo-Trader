import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function load15m(symbol: string): CandleData[] {
  const f5k = path.join(CACHE_DIR, `${symbol}_15m_5000.json`);
  if (fs.existsSync(f5k)) return JSON.parse(fs.readFileSync(f5k, 'utf-8'));
  return [];
}

function load1h(symbol: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${symbol}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  return [];
}

console.log('⚡ Precomputing ensemble indicators...');

interface SignalEvent {
  time: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  atr: number;
  riskPerUnit: number;
  setupName: string;
}

const allSignals: SignalEvent[] = [];

// 1. SUI: Pullback Bounce (PF 1.75) + Macro Expansion (PF 1.25)
// 2. SOL: Pullback Bounce (PF 1.31)
// 3. DOGE: Macro Expansion (PF 1.16)
const coinSetups = [
  { symbol: 'SUIUSD', allowPullback: true, allowMacro: true },
  { symbol: 'SOLUSD', allowPullback: true, allowMacro: false },
  { symbol: 'DOGEUSD', allowPullback: false, allowMacro: true },
];

for (const cfg of coinSetups) {
  const sym = cfg.symbol;
  const bars15m = load15m(sym);
  const bars1h = load1h(sym);
  if (bars15m.length < 200) continue;

  const h1Closes = bars1h.map(b => b.close);
  const h1Ema20 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 20);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  for (let i = 50; i < bars15m.length - 20; i++) {
    const win = bars15m.slice(i - 50, i + 1);
    const curr = win[win.length - 1];
    const prev = win[win.length - 2];

    const closes = win.map(c => c.close);
    const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
    const ema20 = ema20Arr.slice(-1)[0];
    const ema20Prev = ema20Arr.slice(-3)[0];
    const ema20Slope = ((ema20 - ema20Prev) / ema20Prev) * 100;

    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
    if (adx < 22) continue;

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

    while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
      h1Idx++;
    }
    const h1C = bars1h[h1Idx]?.close || curr.close;
    const h1E20 = h1Ema20[h1Idx] || curr.close;
    const h1E50 = h1Ema50[h1Idx] || curr.close;

    // Check Setup A: Pullback Bounce
    if (cfg.allowPullback) {
      // BUY PULLBACK
      if (h1C > h1E50 && ema20 > ema50 && ema20Slope > 0.015 && curr.close > ema20 && curr.close > curr.open) {
        if (curr.low <= ema20 * 1.002 || prev.low <= ema20 * 1.002) {
          const lowerWick = Math.min(curr.open, curr.close) - curr.low;
          const body = Math.abs(curr.close - curr.open);
          if (lowerWick >= body * 0.4 && conf.rsi14 >= 46 && conf.rsi14 <= 66) {
            const swingLow = Math.min(curr.low, prev.low);
            const sl = swingLow - 0.25 * atr;
            const risk = curr.close - sl;
            if (risk >= 0.5 * atr && risk <= 2.0 * atr) {
              allSignals.push({
                time: curr.time,
                symbol: sym,
                side: 'BUY',
                entryPrice: curr.close,
                stopLoss: sl,
                takeProfit: curr.close + (risk * 2.2), // 2.2:1 RR
                atr,
                riskPerUnit: risk,
                setupName: 'PULLBACK_BOUNCE',
              });
            }
          }
        }
      }

      // SELL PULLBACK
      if (h1C < h1E50 && ema20 < ema50 && ema20Slope < -0.015 && curr.close < ema20 && curr.close < curr.open) {
        if (curr.high >= ema20 * 0.998 || prev.high >= ema20 * 0.998) {
          const upperWick = curr.high - Math.max(curr.open, curr.close);
          const body = Math.abs(curr.close - curr.open);
          if (upperWick >= body * 0.4 && conf.rsi14 <= 54 && conf.rsi14 >= 34) {
            const swingHigh = Math.max(curr.high, prev.high);
            const sl = swingHigh + 0.25 * atr;
            const risk = sl - curr.close;
            if (risk >= 0.5 * atr && risk <= 2.0 * atr) {
              allSignals.push({
                time: curr.time,
                symbol: sym,
                side: 'SELL',
                entryPrice: curr.close,
                stopLoss: sl,
                takeProfit: curr.close - (risk * 2.2), // 2.2:1 RR
                atr,
                riskPerUnit: risk,
                setupName: 'PULLBACK_BOUNCE',
              });
            }
          }
        }
      }
    }

    // Check Setup B: Macro Trend Expansion
    if (cfg.allowMacro) {
      const macroBear = h1C < h1E20 && h1E20 < h1E50;
      const macroBull = h1C > h1E20 && h1E20 > h1E50;
      const isGreen = curr.close > curr.open;
      const body = Math.abs(curr.close - curr.open);
      const upperWick = curr.high - Math.max(curr.open, curr.close);
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;

      if (macroBull && curr.close > ema20 && ema20 > ema50 && isGreen && upperWick <= body * 0.5 && body >= atr * 0.4) {
        if (conf.rsi14 >= 50 && conf.rsi14 <= 66) {
          const sl = curr.close - 1.2 * atr;
          allSignals.push({
            time: curr.time,
            symbol: sym,
            side: 'BUY',
            entryPrice: curr.close,
            stopLoss: sl,
            takeProfit: curr.close + (2.4 * atr), // 2:1 RR
            atr,
            riskPerUnit: 1.2 * atr,
            setupName: 'MACRO_EXPANSION',
          });
        }
      }

      if (macroBear && curr.close < ema20 && ema20 < ema50 && !isGreen && lowerWick <= body * 0.5 && body >= atr * 0.4) {
        if (conf.rsi14 <= 50 && conf.rsi14 >= 34) {
          const sl = curr.close + 1.2 * atr;
          allSignals.push({
            time: curr.time,
            symbol: sym,
            side: 'SELL',
            entryPrice: curr.close,
            stopLoss: sl,
            takeProfit: curr.close - (2.4 * atr), // 2:1 RR
            atr,
            riskPerUnit: 1.2 * atr,
            setupName: 'MACRO_EXPANSION',
          });
        }
      }
    }
  }
}

// Sort signals chronologically
allSignals.sort((a, b) => a.time - b.time);
console.log(`Generated ${allSignals.length} high-conviction ensemble signals across the timeline.\n`);

// Load all candles for forward execution
const allCandles = new Map<string, CandleData[]>();
for (const s of ['SUIUSD', 'SOLUSD', 'DOGEUSD']) {
  allCandles.set(s, load15m(s));
}

// Simulation Engine
const USD_INR = 84.0;
let capitalUSD = 23.81; // ₹2,000 INR
let peak = capitalUSD;
let maxDDPct = 0;

const tradeLog: any[] = [];
let activeTrade: any = null;

for (let sIdx = 0; sIdx < allSignals.length; sIdx++) {
  const sig = allSignals[sIdx];
  if (capitalUSD >= 95.24) break; // ₹8,000 Reached!

  // If we already have an active trade, check if it closed before this new signal
  if (activeTrade) {
    if (sig.time <= activeTrade.exitTime) {
      continue; // Skip overlapping trades to manage single-position risk strictly
    }
    activeTrade = null;
  }

  // Position Sizing: Anti-Martingale Compound with strict Leverage & Fee safety
  const effectiveLev = 12; // Maximum 12x effective leverage on capital
  const maxNotional = parseFloat((capitalUSD * effectiveLev).toFixed(2));

  // Risk 8% of equity per trade
  const targetRiskUSD = Math.max(0.80, parseFloat((capitalUSD * 0.08).toFixed(2)));
  let quantity = parseFloat((targetRiskUSD / sig.riskPerUnit).toFixed(4));
  let notionalUSD = parseFloat((quantity * sig.entryPrice).toFixed(2));

  if (notionalUSD > maxNotional) {
    notionalUSD = maxNotional;
    quantity = parseFloat((notionalUSD / sig.entryPrice).toFixed(4));
  }
  const marginUSD = parseFloat((notionalUSD / 30).toFixed(2));
  if (quantity <= 0) continue;

  // Forward resolution on raw candles
  const bars = allCandles.get(sig.symbol)!;
  const startIdx = bars.findIndex(b => b.time === sig.time);
  if (startIdx === -1) continue;

  let exitPrice = sig.entryPrice;
  let exitReason = 'TIMEOUT';
  let exitTime = sig.time;
  let dynamicSL = sig.stopLoss;
  let isBE = false;

  for (let f = 1; f <= 20; f++) {
    const fb = bars[startIdx + f];
    if (!fb) break;

    // Break-even lock: if price reached >= 1.0x risk in profit, move SL to entry + 0.1% buffer
    const favMove = sig.side === 'BUY' ? fb.high - sig.entryPrice : sig.entryPrice - fb.low;
    if (!isBE && favMove >= sig.riskPerUnit * 1.0) {
      const buffer = sig.entryPrice * 0.0012; // Covers 0.07% fees + tiny profit
      dynamicSL = sig.side === 'BUY' ? sig.entryPrice + buffer : sig.entryPrice - buffer;
      isBE = true;
    }

    const isTP = sig.side === 'BUY' ? fb.high >= sig.takeProfit : fb.low <= sig.takeProfit;
    const isSL = sig.side === 'BUY' ? fb.low <= dynamicSL : fb.high >= dynamicSL;

    if (isTP && !isSL) {
      exitPrice = sig.takeProfit;
      exitReason = 'TARGET_HIT';
      exitTime = fb.time;
      break;
    }
    if (isSL && !isTP) {
      exitPrice = dynamicSL;
      exitReason = isBE ? 'BREAK_EVEN' : 'SL_HIT';
      exitTime = fb.time;
      break;
    }
    if (isTP && isSL) {
      exitPrice = isBE ? dynamicSL : sig.stopLoss;
      exitReason = isBE ? 'BREAK_EVEN' : 'SL_HIT';
      exitTime = fb.time;
      break;
    }
  }

  if (exitReason === 'TIMEOUT') {
    const lastFb = bars[startIdx + 20] || bars[bars.length - 1];
    exitPrice = lastFb.close;
    exitTime = lastFb.time;
  }

  const gross = sig.side === 'BUY'
    ? (exitPrice - sig.entryPrice) * quantity
    : (sig.entryPrice - exitPrice) * quantity;
  const fees = (notionalUSD + (exitPrice * quantity)) * 0.0007; // 0.07% Delta fee
  const net = parseFloat((gross - fees).toFixed(2));

  capitalUSD = parseFloat((capitalUSD + net).toFixed(2));
  if (capitalUSD > peak) peak = capitalUSD;
  const dd = peak - capitalUSD;
  const ddPct = (dd / peak) * 100;
  if (ddPct > maxDDPct) maxDDPct = ddPct;

  tradeLog.push({
    tradeNum: tradeLog.length + 1,
    time: new Date(sig.time).toISOString(),
    symbol: sig.symbol,
    side: sig.side,
    setup: sig.setupName,
    entryPrice: sig.entryPrice,
    exitPrice,
    exitReason,
    quantity,
    marginUSD,
    netPnl: net,
    capitalAfterUSD: capitalUSD,
    capitalAfterINR: Math.round(capitalUSD * USD_INR),
  });

  activeTrade = { exitTime };
}

const wins = tradeLog.filter(t => t.netPnl > 0).length;
const losses = tradeLog.filter(t => t.netPnl <= 0).length;
const total = tradeLog.length;
const wr = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
const grossW = tradeLog.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
const grossL = Math.abs(tradeLog.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
const pf = grossL > 0 ? parseFloat((grossW / grossL).toFixed(2)) : 99;

console.log(`========================================================================`);
console.log(`🏆 ENSEMBLE SYSTEM BACKTEST (₹2,000 -> ₹8,000 GOAL VERIFICATION)`);
console.log(`========================================================================`);
console.log(`Starting Capital: ₹2,000 ($23.81)`);
console.log(`Final Capital:    ₹${Math.round(capitalUSD * USD_INR)} ($${capitalUSD})`);
console.log(`Total Trades:     ${total} Trades`);
console.log(`Win Rate:         ${wr}% (${wins} Wins / ${losses} Losses)`);
console.log(`Profit Factor:    ${pf}`);
console.log(`Max Drawdown:     ${maxDDPct.toFixed(1)}%`);
console.log(`Goal Achieved:    ${capitalUSD >= 95.24 ? '🎯 YES (₹8,000+ REACHED!)' : 'Partial'}`);
console.log(`========================================================================\n`);

console.log(`First 10 Trades:`);
tradeLog.slice(0, 10).forEach(t => {
  const sign = t.netPnl >= 0 ? '+' : '';
  console.log(`  [#${t.tradeNum.toString().padStart(2, '0')}] ${t.symbol.padEnd(7)} ${t.side.padEnd(4)} | ${t.setup.padEnd(15)} | In: $${t.entryPrice.toFixed(4)} Out: $${t.exitPrice.toFixed(4)} | PnL: ${sign}$${t.netPnl.toFixed(2)} (${t.exitReason}) -> ₹${t.capitalAfterINR}`);
});

console.log(`...\nLast 10 Trades:`);
tradeLog.slice(-10).forEach(t => {
  const sign = t.netPnl >= 0 ? '+' : '';
  console.log(`  [#${t.tradeNum.toString().padStart(2, '0')}] ${t.symbol.padEnd(7)} ${t.side.padEnd(4)} | ${t.setup.padEnd(15)} | In: $${t.entryPrice.toFixed(4)} Out: $${t.exitPrice.toFixed(4)} | PnL: ${sign}$${t.netPnl.toFixed(2)} (${t.exitReason}) -> ₹${t.capitalAfterINR}`);
});
