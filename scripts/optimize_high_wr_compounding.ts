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

function load15m(sym: string): CandleData[] {
  const f5k = path.join(CACHE_DIR, `${sym}_15m_5000.json`);
  if (fs.existsSync(f5k)) return JSON.parse(fs.readFileSync(f5k, 'utf-8'));
  const f2k = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (fs.existsSync(f2k)) return JSON.parse(fs.readFileSync(f2k, 'utf-8'));
  return [];
}

function load1h(sym: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${sym}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  return [];
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
  const b15 = load15m(sym);
  const b1h = load1h(sym);
  if (b15.length < 200) continue;

  const h1Closes = b1h.map(b => b.close);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  const list: PreBar[] = [];

  for (let i = 50; i < b15.length; i++) {
    const win = b15.slice(i - 50, i + 1);
    const c = win[win.length - 1];
    const prev = win[win.length - 2];

    const closes = win.map(x => x.close);
    const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
    const ema20 = ema20Arr.slice(-1)[0];
    const ema20Prev = ema20Arr.slice(-3)[0];
    const ema20Slope = ((ema20 - ema20Prev) / ema20Prev) * 100;
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;

    while (h1Idx < b1h.length - 1 && b1h[h1Idx + 1].time <= c.time) {
      h1Idx++;
    }

    list.push({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      ema20,
      ema50,
      ema20Slope,
      adx,
      rsi: conf.rsi14,
      atr,
      h1Close: b1h[h1Idx]?.close || c.close,
      h1Ema50: h1Ema50[h1Idx] || c.close,
      prevLow: prev.low,
      prevHigh: prev.high,
      isGreen: c.close > c.open,
      lowerWick: Math.min(c.open, c.close) - c.low,
      upperWick: c.high - Math.max(c.open, c.close),
      body: Math.abs(c.close - c.open),
    });
  }
  preBarsMap.set(sym, list);
}

console.log('⚡ Scanning 4,000+ configurations specifically for Max Win Rate (>=70-80%) + Compounding ₹2k -> ₹8k...');

interface Result {
  params: any;
  finalINR: number;
  finalUSD: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDD: number;
  reachedGoal: boolean;
}

const highWRResults: Result[] = [];

// Parameter grid
const rrList = [1.8, 2.0, 2.2, 2.4, 2.6];
const slAtrList = [0.10, 0.15, 0.20, 0.25];
const adxList = [20, 24, 28];
const riskList = [0.12, 0.15, 0.18];
const slopeList = [0.02, 0.03, 0.04];
const wickList = [0.4, 0.6, 0.8];
const symbolCombos = [['SUIUSD'], ['SOLUSD'], ['SUIUSD', 'SOLUSD']];

for (const syms of symbolCombos) {
  for (const rr of rrList) {
    for (const slAtr of slAtrList) {
      for (const adx of adxList) {
        for (const risk of riskList) {
          for (const slope of slopeList) {
            for (const wick of wickList) {
              const signals: any[] = [];

              for (const sym of syms) {
                const list = preBarsMap.get(sym);
                if (!list) continue;

                for (let j = 0; j < list.length; j++) {
                  const b = list[j];
                  if (b.adx < adx) continue;

                  // BUY
                  if (b.h1Close > b.h1Ema50 && b.ema20 > b.ema50 && b.ema20Slope > slope && b.close > b.ema20 && b.isGreen) {
                    if (b.low <= b.ema20 * 1.002 || b.prevLow <= b.ema20 * 1.002) {
                      if (b.lowerWick >= b.body * wick && b.rsi >= 46 && b.rsi <= 66) {
                        const swingLow = Math.min(b.low, b.prevLow);
                        const sl = swingLow - (slAtr * b.atr);
                        const r = b.close - sl;
                        if (r >= 0.4 * b.atr && r <= 2.5 * b.atr) {
                          signals.push({
                            time: b.time,
                            symbol: sym,
                            side: 'BUY',
                            entryPrice: b.close,
                            sl,
                            tp: b.close + (r * rr),
                            risk: r,
                            atr: b.atr,
                          });
                        }
                      }
                    }
                  }

                  // SELL
                  if (b.h1Close < b.h1Ema50 && b.ema20 < b.ema50 && b.ema20Slope < -slope && b.close < b.ema20 && !b.isGreen) {
                    if (b.high >= b.ema20 * 0.998 || b.prevHigh >= b.ema20 * 0.998) {
                      if (b.upperWick >= b.body * wick && b.rsi <= 54 && b.rsi >= 34) {
                        const swingHigh = Math.max(b.high, b.prevHigh);
                        const sl = swingHigh + (slAtr * b.atr);
                        const r = sl - b.close;
                        if (r >= 0.4 * b.atr && r <= 2.5 * b.atr) {
                          signals.push({
                            time: b.time,
                            symbol: sym,
                            side: 'SELL',
                            entryPrice: b.close,
                            sl,
                            tp: b.close - (r * rr),
                            risk: r,
                            atr: b.atr,
                          });
                        }
                      }
                    }
                  }
                }
              }

              if (signals.length < 8) continue;
              signals.sort((a, b) => a.time - b.time);

              // Simulate compounding
              let capUSD = 23.81;
              let peak = capUSD;
              let maxDD = 0;
              let wins = 0;
              let losses = 0;
              let grossWins = 0;
              let grossLosses = 0;
              let lastExit = 0;
              let reachedGoal = false;

              for (const sig of signals) {
                if (sig.time <= lastExit) continue;

                const bars = preBarsMap.get(sig.symbol)!;
                const idx = bars.findIndex(b => b.time === sig.time);
                if (idx === -1) continue;

                const riskUSD = capUSD * risk;
                let quantity = riskUSD / sig.risk;
                const maxNotional = capUSD * 25.0;
                if (quantity * sig.entryPrice > maxNotional) {
                  quantity = maxNotional / sig.entryPrice;
                }
                const notional = quantity * sig.entryPrice;
                const fees = notional * 0.0012;

                let won = false;
                let resolved = false;

                for (let f = 1; f <= 16; f++) {
                  if (idx + f >= bars.length) break;
                  const bar = bars[idx + f];

                  const isTP = sig.side === 'BUY' ? bar.high >= sig.tp : bar.low <= sig.tp;
                  const isSL = sig.side === 'BUY' ? bar.low <= sig.sl : bar.high >= sig.sl;

                  if (isTP && !isSL) {
                    won = true;
                    resolved = true;
                    lastExit = bar.time;
                    break;
                  } else if (isSL && !isTP) {
                    won = false;
                    resolved = true;
                    lastExit = bar.time;
                    break;
                  }
                }

                if (resolved) {
                  if (won) {
                    wins++;
                    const gross = (sig.risk * rr) * quantity;
                    const net = gross - fees;
                    capUSD += net;
                    grossWins += gross;
                  } else {
                    losses++;
                    const gross = sig.risk * quantity;
                    const net = -gross - fees;
                    capUSD += net;
                    grossLosses += gross + fees;
                  }

                  if (capUSD > peak) peak = capUSD;
                  const dd = ((peak - capUSD) / peak) * 100;
                  if (dd > maxDD) maxDD = dd;

                  if (capUSD * 84 >= 8000 && !reachedGoal) {
                    reachedGoal = true;
                  }
                }
              }

              const total = wins + losses;
              const wr = total > 0 ? (wins / total) * 100 : 0;
              const pf = grossLosses > 0 ? grossWins / grossLosses : 99;

              // Filter for high win rate (>= 70%) and reached goal
              if (reachedGoal && wr >= 70.0) {
                highWRResults.push({
                  params: { syms, rr, slAtr, adx, risk, slope, wick },
                  finalINR: Math.round(capUSD * 84),
                  finalUSD: parseFloat(capUSD.toFixed(2)),
                  trades: total,
                  winRate: parseFloat(wr.toFixed(1)),
                  profitFactor: parseFloat(pf.toFixed(2)),
                  maxDD: parseFloat(maxDD.toFixed(1)),
                  reachedGoal
                });
              }
            }
          }
        }
      }
    }
  }
}

console.log(`\nScan Finished! Found ${highWRResults.length} configurations with Win Rate >= 70% that COMPOUNDED ₹2,000 to ₹8,000+!`);

// Sort by highest win rate
highWRResults.sort((a, b) => b.winRate - a.winRate || b.profitFactor - a.profitFactor);

const top10 = highWRResults.slice(0, 10);
for (let i = 0; i < top10.length; i++) {
  const r = top10[i];
  console.log(`\n🏆 RANK #${i + 1}: ${r.winRate}% WIN RATE | Final: ₹${r.finalINR.toLocaleString()} ($${r.finalUSD}) | PF: ${r.profitFactor} | MaxDD: ${r.maxDD}%`);
  console.log(`   Trades: ${r.trades} | Coins: [${r.params.syms.join(', ')}] | R:R: ${r.params.rr}:1 | SL ATR Mult: ${r.params.slAtr} | ADX: ${r.params.adx} | Wick: ${r.params.wick}`);
}

fs.writeFileSync(
  path.join(process.cwd(), 'public', 'high_wr_compounding_to_8k.json'),
  JSON.stringify({ totalQualified: highWRResults.length, top10 }, null, 2)
);
console.log('\nResults saved to public/high_wr_compounding_to_8k.json');
