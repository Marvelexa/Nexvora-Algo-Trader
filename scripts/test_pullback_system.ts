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
const SYMBOLS = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'ETHUSD', 'ADAUSD'];

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

console.log('Testing Enhanced EMA Pullback with Slope & Volume confirmation...');

for (const sym of SYMBOLS) {
  const bars15m = load15m(sym);
  const bars1h = load1h(sym);
  if (bars15m.length < 200) continue;

  const h1Closes = bars1h.map(b => b.close);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  let totalSigs = 0;
  let wins = 0;
  let losses = 0;
  let totalGain = 0;
  let totalLoss = 0;

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

    let sig: 'BUY' | 'SELL' | null = null;
    let sl = 0;
    let tp = 0;

    // BUY PULLBACK:
    // 1H uptrend, 15m 20 EMA > 50 EMA, 20 EMA Slope > 0.02%
    // Price dipped to EMA20 on prev or curr candle
    // Curr candle closes GREEN above EMA20
    if (h1C > h1E && ema20 > ema50 && ema20Slope > 0.02 && curr.close > ema20 && curr.close > curr.open) {
      if (curr.low <= ema20 * 1.002 || prev.low <= ema20 * 1.002) {
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        const body = Math.abs(curr.close - curr.open);
        if (lowerWick >= body * 0.4 && conf.rsi14 >= 46 && conf.rsi14 <= 66) {
          sig = 'BUY';
          const swingLow = Math.min(curr.low, prev.low);
          sl = swingLow - 0.25 * atr;
          const risk = curr.close - sl;
          if (risk >= 0.5 * atr && risk <= 2.2 * atr) {
            tp = curr.close + (risk * 2.2); // 2.2 : 1 RR
          } else {
            sig = null;
          }
        }
      }
    }

    // SELL PULLBACK:
    // 1H downtrend, 15m 20 EMA < 50 EMA, 20 EMA Slope < -0.02%
    // Price rallied to EMA20
    // Curr candle closes RED below EMA20
    if (h1C < h1E && ema20 < ema50 && ema20Slope < -0.02 && curr.close < ema20 && curr.close < curr.open) {
      if (curr.high >= ema20 * 0.998 || prev.high >= ema20 * 0.998) {
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const body = Math.abs(curr.close - curr.open);
        if (upperWick >= body * 0.4 && conf.rsi14 <= 54 && conf.rsi14 >= 34) {
          sig = 'SELL';
          const swingHigh = Math.max(curr.high, prev.high);
          sl = swingHigh + 0.25 * atr;
          const risk = sl - curr.close;
          if (risk >= 0.5 * atr && risk <= 2.2 * atr) {
            tp = curr.close - (risk * 2.2); // 2.2 : 1 RR
          } else {
            sig = null;
          }
        }
      }
    }

    if (!sig) continue;
    totalSigs++;

    let won = false;
    let lost = false;
    for (let f = 1; f <= 20; f++) {
      const fb = bars15m[i + f];
      if (!fb) break;

      const isTP = sig === 'BUY' ? fb.high >= tp : fb.low <= tp;
      const isSL = sig === 'BUY' ? fb.low <= sl : fb.high >= sl;

      if (isTP && !isSL) {
        won = true;
        break;
      }
      if (isSL && !isTP) {
        lost = true;
        break;
      }
      if (isTP && isSL) {
        lost = true;
        break;
      }
    }

    if (won) {
      wins++;
      totalGain += 2.2;
    } else if (lost) {
      losses++;
      totalLoss += 1.0;
    } else {
      const fb = bars15m[i + 20];
      if (fb) {
        const risk = Math.abs(curr.close - sl);
        const diff = sig === 'BUY' ? (fb.close - curr.close) / risk : (curr.close - fb.close) / risk;
        if (diff > 0) {
          wins++;
          totalGain += diff;
        } else {
          losses++;
          totalLoss += Math.abs(diff);
        }
      }
    }
  }

  const wr = totalSigs > 0 ? ((wins / totalSigs) * 100).toFixed(1) : '0';
  const pf = totalLoss > 0 ? (totalGain / totalLoss).toFixed(2) : '0';
  console.log(`${sym.padEnd(8)} | Sigs: ${totalSigs.toString().padStart(4)} | Win Rate: ${wr}% (${wins}W / ${losses}L) | PF: ${pf} | EV: +${((totalGain - totalLoss) / (totalSigs || 1)).toFixed(2)} R`);
}
