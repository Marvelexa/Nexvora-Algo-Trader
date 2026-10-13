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
const SYMBOLS = ['SUIUSD', 'SOLUSD'];

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

console.log('⚡ SUI + SOL Pure Swing Pullback Compounding Simulation...');

interface Signal {
  time: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  risk: number;
  atr: number;
}

const signals: Signal[] = [];

for (const sym of SYMBOLS) {
  const bars15m = load15m(sym);
  const bars1h = load1h(sym);
  if (bars15m.length < 200) continue;

  const h1Closes = bars1h.map(b => b.close);
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
    const h1E = h1Ema50[h1Idx] || curr.close;

    // BUY PULLBACK
    if (h1C > h1E && ema20 > ema50 && ema20Slope > 0.015 && curr.close > ema20 && curr.close > curr.open) {
      if (curr.low <= ema20 * 1.002 || prev.low <= ema20 * 1.002) {
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        const body = Math.abs(curr.close - curr.open);
        if (lowerWick >= body * 0.4 && conf.rsi14 >= 46 && conf.rsi14 <= 66) {
          const swingLow = Math.min(curr.low, prev.low);
          const sl = swingLow - 0.25 * atr;
          const risk = curr.close - sl;
          if (risk >= 0.5 * atr && risk <= 2.2 * atr) {
            signals.push({
              time: curr.time,
              symbol: sym,
              side: 'BUY',
              entryPrice: curr.close,
              stopLoss: sl,
              takeProfit: curr.close + (risk * 2.2),
              risk,
              atr,
            });
          }
        }
      }
    }

    // SELL PULLBACK
    if (h1C < h1E && ema20 < ema50 && ema20Slope < -0.015 && curr.close < ema20 && curr.close < curr.open) {
      if (curr.high >= ema20 * 0.998 || prev.high >= ema20 * 0.998) {
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const body = Math.abs(curr.close - curr.open);
        if (upperWick >= body * 0.4 && conf.rsi14 <= 54 && conf.rsi14 >= 34) {
          const swingHigh = Math.max(curr.high, prev.high);
          const sl = swingHigh + 0.25 * atr;
          const risk = sl - curr.close;
          if (risk >= 0.5 * atr && risk <= 2.2 * atr) {
            signals.push({
              time: curr.time,
              symbol: sym,
              side: 'SELL',
              entryPrice: curr.close,
              stopLoss: sl,
              takeProfit: curr.close - (risk * 2.2),
              risk,
              atr,
            });
          }
        }
      }
    }
  }
}

signals.sort((a, b) => a.time - b.time);
console.log(`Found ${signals.length} pure structural swing pullback signals.\n`);

const candleMap = new Map<string, CandleData[]>();
for (const s of SYMBOLS) candleMap.set(s, load15m(s));

const USD_INR = 84.0;
let capitalUSD = 23.81; // ₹2,000 INR
let peakUSD = capitalUSD;
let maxDDPct = 0;

const trades: any[] = [];
let busyUntil = 0;

for (const sig of signals) {
  if (sig.time < busyUntil) continue;
  if (capitalUSD >= 95.24) break;

  // Fixed Conservative Risk: 5% of account per trade
  const riskUSD = Math.max(1.00, parseFloat((capitalUSD * 0.05).toFixed(2)));
  const quantity = parseFloat((riskUSD / sig.risk).toFixed(4));
  const notionalUSD = parseFloat((quantity * sig.entryPrice).toFixed(2));

  // Cap effective leverage at 10x
  const maxNotional = capitalUSD * 10;
  if (notionalUSD > maxNotional) continue;
  if (quantity <= 0) continue;

  const bars = candleMap.get(sig.symbol)!;
  const startIdx = bars.findIndex(b => b.time === sig.time);
  if (startIdx === -1) continue;

  let exitPrice = sig.entryPrice;
  let exitReason = 'TIMEOUT';
  let exitTime = sig.time;

  for (let f = 1; f <= 20; f++) {
    const fb = bars[startIdx + f];
    if (!fb) break;

    const isTP = sig.side === 'BUY' ? fb.high >= sig.takeProfit : fb.low <= sig.takeProfit;
    const isSL = sig.side === 'BUY' ? fb.low <= sig.stopLoss : fb.high >= sig.stopLoss;

    if (isTP && !isSL) {
      exitPrice = sig.takeProfit;
      exitReason = 'TARGET_HIT';
      exitTime = fb.time;
      break;
    }
    if (isSL && !isTP) {
      exitPrice = sig.stopLoss;
      exitReason = 'SL_HIT';
      exitTime = fb.time;
      break;
    }
    if (isTP && isSL) {
      exitPrice = sig.stopLoss;
      exitReason = 'SL_HIT';
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
  const fees = (notionalUSD + (exitPrice * quantity)) * 0.0007;
  const net = parseFloat((gross - fees).toFixed(2));

  capitalUSD = parseFloat((capitalUSD + net).toFixed(2));
  if (capitalUSD > peakUSD) peakUSD = capitalUSD;
  const dd = peakUSD - capitalUSD;
  const ddPct = (dd / peakUSD) * 100;
  if (ddPct > maxDDPct) maxDDPct = ddPct;

  trades.push({
    tradeNum: trades.length + 1,
    time: new Date(sig.time).toISOString(),
    symbol: sig.symbol,
    side: sig.side,
    entryPrice: sig.entryPrice,
    exitPrice,
    exitReason,
    quantity,
    grossPnl: parseFloat(gross.toFixed(2)),
    fees: parseFloat(fees.toFixed(2)),
    netPnl: net,
    capitalAfterUSD: capitalUSD,
    capitalAfterINR: Math.round(capitalUSD * USD_INR),
  });

  busyUntil = exitTime;
}

const wins = trades.filter(t => t.netPnl > 0).length;
const losses = trades.filter(t => t.netPnl <= 0).length;
const total = trades.length;
const wr = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
const grossW = trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
const grossL = Math.abs(trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
const pf = grossL > 0 ? parseFloat((grossW / grossL).toFixed(2)) : 99;

console.log(`========================================================================`);
console.log(`🏆 SUI + SOL STRUCTURAL PULLBACK RESULTS`);
console.log(`========================================================================`);
console.log(`Starting Capital: ₹2,000 ($23.81)`);
console.log(`Final Capital:    ₹${Math.round(capitalUSD * USD_INR)} ($${capitalUSD})`);
console.log(`Total Trades:     ${total}`);
console.log(`Wins / Losses:    ${wins} Wins / ${losses} Losses`);
console.log(`Win Rate:         ${wr}%`);
console.log(`Profit Factor:    ${pf}`);
console.log(`Max Drawdown:     ${maxDDPct.toFixed(1)}%`);
console.log(`Goal Achieved:    ${capitalUSD >= 95.24 ? '🎯 YES (₹8,000+ REACHED!)' : 'Partial'}`);
console.log(`========================================================================\n`);

console.log(`Sample Trades Log:`);
trades.slice(0, 15).forEach(t => {
  const s = t.netPnl >= 0 ? '+' : '';
  console.log(`  [#${t.tradeNum.toString().padStart(2, '0')}] ${t.symbol.padEnd(7)} ${t.side.padEnd(4)} | In: $${t.entryPrice.toFixed(4)} Out: $${t.exitPrice.toFixed(4)} | PnL: ${s}$${t.netPnl.toFixed(2)} (${t.exitReason}) -> ₹${t.capitalAfterINR} ($${t.capitalAfterUSD.toFixed(2)})`);
});
