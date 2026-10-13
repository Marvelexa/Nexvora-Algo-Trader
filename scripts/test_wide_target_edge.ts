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
const SYMBOLS = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'ADAUSD', 'ETHUSD'];

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

console.log('Testing Minimum Move Friction Barrier Elimination (> 2.0% target)...');

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
  let netPnL = 0;

  for (let i = 50; i < bars15m.length - 30; i++) {
    const win = bars15m.slice(i - 50, i + 1);
    const curr = win[win.length - 1];

    const closes = win.map(c => c.close);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
    if (adx < 24) continue;

    while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
      h1Idx++;
    }
    const h1C = bars1h[h1Idx]?.close || curr.close;
    const h1E = h1Ema50[h1Idx] || curr.close;

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    let sig: 'BUY' | 'SELL' | null = null;

    // BUY: 1H Bullish, 15m Bullish, Strong Green Expansion bar
    if (h1C > h1E && curr.close > ema20 && ema20 > ema50 && isGreen && upperWick <= body * 0.4) {
      sig = 'BUY';
    }

    // SELL: 1H Bearish, 15m Bearish, Strong Red Expansion bar
    if (h1C < h1E && curr.close < ema20 && ema20 < ema50 && !isGreen && lowerWick <= body * 0.4) {
      sig = 'SELL';
    }

    if (!sig) continue;
    totalSigs++;

    // Large Target: Target = +2.5% move, Stop Loss = -1.0% move (2.5:1 RR)
    const tpPrice = sig === 'BUY' ? curr.close * 1.025 : curr.close * 0.975;
    const slPrice = sig === 'BUY' ? curr.close * 0.990 : curr.close * 1.010;

    let won = false;
    let lost = false;

    for (let f = 1; f <= 28; f++) { // up to 7 hours
      const fb = bars15m[i + f];
      if (!fb) break;

      const isTP = sig === 'BUY' ? fb.high >= tpPrice : fb.low <= tpPrice;
      const isSL = sig === 'BUY' ? fb.low <= slPrice : fb.high >= slPrice;

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
      // Gross 2.5% - Fee 0.14% = +2.36% net on notional
      netPnL += 2.36;
    } else if (lost) {
      losses++;
      // Gross -1.0% - Fee 0.14% = -1.14% net on notional
      netPnL -= 1.14;
    } else {
      const fb = bars15m[i + 28];
      if (fb) {
        const move = sig === 'BUY' ? (fb.close - curr.close) / curr.close : (curr.close - fb.close) / curr.close;
        const netMove = (move * 100) - 0.14;
        if (netMove > 0) {
          wins++;
          netPnL += netMove;
        } else {
          losses++;
          netPnL += netMove;
        }
      }
    }
  }

  const wr = totalSigs > 0 ? ((wins / totalSigs) * 100).toFixed(1) : '0';
  console.log(`${sym.padEnd(8)} | Sigs: ${totalSigs.toString().padStart(4)} | Win Rate: ${wr}% (${wins}W / ${losses}L) | Total Net %: ${netPnL.toFixed(1)}% | Avg Net/Trade: ${(netPnL / (totalSigs || 1)).toFixed(2)}%`);
}
