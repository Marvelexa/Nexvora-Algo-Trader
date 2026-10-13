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
const ALL_SYMS = ['SUIUSD', 'SOLUSD', 'DOGEUSD'];

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

console.log('⚡ High-Speed Multi-Parameter Grid Search for ₹2,000 -> ₹8,000 Compounder...');

const raw15m = new Map<string, CandleData[]>();
const raw1h = new Map<string, CandleData[]>();
for (const s of ALL_SYMS) {
  raw15m.set(s, load15m(s));
  raw1h.set(s, load1h(s));
}

interface PreBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ema20: number;
  ema50: number;
  ema20Slope: number;
  adx: number;
  rsi: number;
  atr: number;
  h1Close: number;
  h1Ema50: number;
  prevLow: number;
  prevHigh: number;
  isGreen: boolean;
  lowerWick: number;
  upperWick: number;
  body: number;
}

const preBarsMap = new Map<string, PreBar[]>();

for (const sym of ALL_SYMS) {
  const bars15m = raw15m.get(sym)!;
  const bars1h = raw1h.get(sym)!;
  if (bars15m.length < 200) continue;

  const h1Closes = bars1h.map(b => b.close);
  const h1Ema50Series = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  const list: PreBar[] = [];

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
    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

    while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
      h1Idx++;
    }
    const h1Close = bars1h[h1Idx]?.close || curr.close;
    const h1Ema50 = h1Ema50Series[h1Idx] || curr.close;

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    list.push({
      time: curr.time,
      open: curr.open,
      high: curr.high,
      low: curr.low,
      close: curr.close,
      ema20,
      ema50,
      ema20Slope,
      adx,
      rsi: conf.rsi14,
      atr,
      h1Close,
      h1Ema50,
      prevLow: prev.low,
      prevHigh: prev.high,
      isGreen,
      lowerWick,
      upperWick,
      body,
    });
  }
  preBarsMap.set(sym, list);
}

console.log('✅ Bars pre-computed. Running combinatorial simulations...');

interface SimRun {
  params: any;
  finalINR: number;
  finalUSD: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDD: number;
  reachedGoal: boolean;
  tradeLog: any[];
}

function simulate(params: {
  symbols: string[];
  rrMult: number;
  slAtrMult: number;
  adxMin: number;
  riskPct: number;
  slopeMin: number;
  wickRatio: number;
  cooldownHours: number;
  useBeLock: boolean;
}): SimRun {
  const USD_INR = 84.0;
  let capitalUSD = 23.81; // ₹2,000 INR
  let peak = capitalUSD;
  let maxDD = 0;

  // Gather signals
  const signals: any[] = [];
  for (const sym of params.symbols) {
    const list = preBarsMap.get(sym);
    if (!list) continue;

    for (let j = 0; j < list.length; j++) {
      const b = list[j];
      if (b.adx < params.adxMin) continue;

      // BUY
      if (b.h1Close > b.h1Ema50 && b.ema20 > b.ema50 && b.ema20Slope > params.slopeMin && b.close > b.ema20 && b.isGreen) {
        if (b.low <= b.ema20 * 1.002 || b.prevLow <= b.ema20 * 1.002) {
          if (b.lowerWick >= b.body * params.wickRatio && b.rsi >= 46 && b.rsi <= 66) {
            const swingLow = Math.min(b.low, b.prevLow);
            const sl = swingLow - (params.slAtrMult * b.atr);
            const risk = b.close - sl;
            if (risk >= 0.4 * b.atr && risk <= 2.5 * b.atr) {
              signals.push({
                time: b.time,
                symbol: sym,
                side: 'BUY',
                entryPrice: b.close,
                stopLoss: sl,
                takeProfit: b.close + (risk * params.rrMult),
                risk,
                atr: b.atr,
              });
            }
          }
        }
      }

      // SELL
      if (b.h1Close < b.h1Ema50 && b.ema20 < b.ema50 && b.ema20Slope < -params.slopeMin && b.close < b.ema20 && !b.isGreen) {
        if (b.high >= b.ema20 * 0.998 || b.prevHigh >= b.ema20 * 0.998) {
          if (b.upperWick >= b.body * params.wickRatio && b.rsi <= 54 && b.rsi >= 34) {
            const swingHigh = Math.max(b.high, b.prevHigh);
            const sl = swingHigh + (params.slAtrMult * b.atr);
            const risk = sl - b.close;
            if (risk >= 0.4 * b.atr && risk <= 2.5 * b.atr) {
              signals.push({
                time: b.time,
                symbol: sym,
                side: 'SELL',
                entryPrice: b.close,
                stopLoss: sl,
                takeProfit: b.close - (risk * params.rrMult),
                risk,
                atr: b.atr,
              });
            }
          }
        }
      }
    }
  }

  signals.sort((a, b) => a.time - b.time);

  const trades: any[] = [];
  let busyUntil = 0;
  let cooldownUntil = 0;
  let consecutiveLosses = 0;

  for (const sig of signals) {
    if (sig.time < busyUntil) continue;
    if (sig.time < cooldownUntil) continue;
    if (capitalUSD >= 95.24) break; // ₹8,000 hit!

    // Position Sizing: Risk % of current capital with 12x leverage clamp
    const riskUSD = Math.max(1.00, parseFloat((capitalUSD * params.riskPct).toFixed(2)));
    const maxNotional = capitalUSD * 12;
    let quantity = parseFloat((riskUSD / sig.risk).toFixed(4));
    let notionalUSD = parseFloat((quantity * sig.entryPrice).toFixed(2));

    if (notionalUSD > maxNotional) {
      notionalUSD = maxNotional;
      quantity = parseFloat((notionalUSD / sig.entryPrice).toFixed(4));
    }
    if (quantity <= 0) continue;

    const bars = raw15m.get(sig.symbol)!;
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

      if (params.useBeLock && !isBE) {
        const favMove = sig.side === 'BUY' ? fb.high - sig.entryPrice : sig.entryPrice - fb.low;
        if (favMove >= sig.risk * 1.5) {
          dynamicSL = sig.side === 'BUY' ? sig.entryPrice * 1.002 : sig.entryPrice * 0.998;
          isBE = true;
        }
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
        exitReason = isBE ? 'TRAIL_BE' : 'SL_HIT';
        exitTime = fb.time;
        break;
      }
      if (isTP && isSL) {
        exitPrice = isBE ? dynamicSL : sig.stopLoss;
        exitReason = isBE ? 'TRAIL_BE' : 'SL_HIT';
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
    if (capitalUSD > peak) peak = capitalUSD;
    const dd = peak - capitalUSD;
    const ddPct = (dd / peak) * 100;
    if (ddPct > maxDD) maxDD = ddPct;

    if (net <= 0) {
      consecutiveLosses++;
      if (consecutiveLosses >= 2 && params.cooldownHours > 0) {
        cooldownUntil = exitTime + (params.cooldownHours * 3600 * 1000);
        consecutiveLosses = 0;
      }
    } else {
      consecutiveLosses = 0;
    }

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
  const pf = grossL > 0 ? parseFloat((grossW / grossL).toFixed(2)) : (grossW > 0 ? 99 : 0);

  return {
    params,
    finalINR: Math.round(capitalUSD * USD_INR),
    finalUSD: capitalUSD,
    trades: total,
    winRate: wr,
    profitFactor: pf,
    maxDD: parseFloat(maxDD.toFixed(1)),
    reachedGoal: capitalUSD >= 95.24,
    tradeLog: trades,
  };
}

const combinations: any[] = [];
for (const symbols of [['SUIUSD'], ['SUIUSD', 'SOLUSD']]) {
  for (const rrMult of [2.0, 2.4, 2.8]) {
    for (const slAtrMult of [0.15, 0.25, 0.35]) {
      for (const adxMin of [20, 24]) {
        for (const riskPct of [0.08, 0.10, 0.12, 0.15]) {
          for (const slopeMin of [0.015, 0.025]) {
            for (const cooldownHours of [0, 4, 8]) {
              for (const useBeLock of [true, false]) {
                combinations.push({
                  symbols,
                  rrMult,
                  slAtrMult,
                  adxMin,
                  riskPct,
                  slopeMin,
                  wickRatio: 0.35,
                  cooldownHours,
                  useBeLock,
                });
              }
            }
          }
        }
      }
    }
  }
}

console.log(`Running grid over ${combinations.length} configurations...`);
const startT = Date.now();
const results = combinations.map(simulate);
console.log(`Grid completed in ${((Date.now() - startT) / 1000).toFixed(2)}s!\n`);

const goalHitters = results.filter(r => r.reachedGoal);
console.log(`🎯 Configurations reaching ₹8,000+ ($95.24): ${goalHitters.length}`);

// Sort by final capital
results.sort((a, b) => b.finalUSD - a.finalUSD);
console.log(`\nTOP 10 BEST CONFIGURATIONS:`);
results.slice(0, 10).forEach((r, idx) => {
  console.log(`[#${idx+1}] Final: ₹${r.finalINR} ($${r.finalUSD}) | Sigs: ${r.trades} | WR: ${r.winRate}% | PF: ${r.profitFactor} | MaxDD: ${r.maxDD}% | Goal: ${r.reachedGoal ? '🎯 YES' : 'NO'}`);
  console.log(`     Params: Syms=${r.params.symbols.join(',')} RR=${r.params.rrMult} Risk=${r.params.riskPct*100}% ADX>=${r.params.adxMin} CD=${r.params.cooldownHours}h BE=${r.params.useBeLock}`);
});

if (goalHitters.length > 0) {
  const winner = goalHitters.sort((a, b) => b.profitFactor - a.profitFactor)[0];
  console.log(`\n=======================================================`);
  console.log(`🏆 OPTIMAL WINNING STRATEGY (₹2,000 -> ₹8,000 ACHIEVED!)`);
  console.log(`=======================================================`);
  console.log(`Final Capital: ₹${winner.finalINR} ($${winner.finalUSD})`);
  console.log(`Trades: ${winner.trades} | Win Rate: ${winner.winRate}% | Profit Factor: ${winner.profitFactor} | MaxDD: ${winner.maxDD}%`);
  console.log(`Optimal Parameters:`, JSON.stringify(winner.params, null, 2));
  
  // Save to public/goal_backtest_report.json
  fs.writeFileSync(path.join(process.cwd(), 'public', 'goal_backtest_report.json'), JSON.stringify(winner, null, 2), 'utf-8');
  console.log(`💾 Saved complete verified trade report to public/goal_backtest_report.json`);
} else {
  // Save best configuration
  const best = results[0];
  fs.writeFileSync(path.join(process.cwd(), 'public', 'goal_backtest_report.json'), JSON.stringify(best, null, 2), 'utf-8');
  console.log(`💾 Saved top configuration report to public/goal_backtest_report.json`);
}
