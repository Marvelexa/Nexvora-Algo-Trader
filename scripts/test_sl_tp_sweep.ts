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
const SYMBOLS = ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'ETHUSD', 'SOLUSD'];

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

console.log('Testing SL and TP parameter space on Institutional Trend setups...');

// Let's test a clean Trend Continuation setup:
// 1H Trend aligned + 15m Trend aligned + ADX >= 22 + Green expansion candle (no upper rejection)
const results: any[] = [];

for (const slAtr of [1.0, 1.2, 1.5, 1.8, 2.0, 2.2]) {
  for (const tpAtr of [1.2, 1.5, 1.8, 2.0, 2.5, 3.0]) {
    let totalSignals = 0;
    let wins = 0;
    let losses = 0;
    let totalPnl = 0;

    for (const sym of SYMBOLS) {
      const bars15m = load15m(sym);
      const bars1h = load1h(sym);
      if (bars15m.length < 200) continue;

      for (let i = 50; i < bars15m.length - 24; i++) {
        const win = bars15m.slice(i - 50, i + 1);
        const curr = win[win.length - 1];
        const closes = win.map(c => c.close);
        const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
        const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
        const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
        if (adx < 24) continue;

        const atr = CryptoDedicatedStrategyEngine.calculateATR(win, 14) || curr.close * 0.01;

        // 1H filter
        const currentH1 = bars1h.filter((b: any) => b.time <= curr.time).slice(-50);
        if (currentH1.length < 20) continue;
        const h1Closes = currentH1.map((b: any) => b.close);
        const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50).slice(-1)[0];

        const isGreen = curr.close > curr.open;
        const body = Math.abs(curr.close - curr.open);
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;

        let sig: 'BUY' | 'SELL' | null = null;
        if (curr.close > h1Ema50 && curr.close > ema20 && ema20 > ema50 && isGreen && upperWick < body * 0.6) {
          sig = 'BUY';
        } else if (curr.close < h1Ema50 && curr.close < ema20 && ema20 < ema50 && !isGreen && lowerWick < body * 0.6) {
          sig = 'SELL';
        }

        if (!sig) continue;
        totalSignals++;

        const entry = curr.close;
        const tp = sig === 'BUY' ? entry + tpAtr * atr : entry - tpAtr * atr;
        const sl = sig === 'BUY' ? entry - slAtr * atr : entry + slAtr * atr;

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
          totalPnl += tpAtr;
        } else if (lost) {
          losses++;
          totalPnl -= slAtr;
        } else {
          // expired
          const fb = bars15m[i + 20];
          const diff = sig === 'BUY' ? (fb.close - entry) / atr : (entry - fb.close) / atr;
          if (diff > 0) {
            wins++;
            totalPnl += diff;
          } else {
            losses++;
            totalPnl += diff; // negative
          }
        }
      }
    }

    const wr = totalSignals > 0 ? parseFloat(((wins / totalSignals) * 100).toFixed(1)) : 0;
    const ev = totalSignals > 0 ? parseFloat((totalPnl / totalSignals).toFixed(3)) : 0;
    results.push({ slAtr, tpAtr, totalSignals, wins, losses, winRate: wr, expectedValueR: ev });
  }
}

// Sort by expected value descending
results.sort((a, b) => b.expectedValueR - a.expectedValueR);

console.log('TOP 15 PARAMETER COMBINATIONS BY EXPECTED VALUE:');
results.slice(0, 15).forEach((r, idx) => {
  console.log(`[#${idx+1}] SL = ${r.slAtr}x ATR | TP = ${r.tpAtr}x ATR | Win Rate: ${r.winRate}% (${r.wins}W / ${r.losses}L) | EV: +${r.expectedValueR} R/trade (Total Sigs: ${r.totalSignals})`);
});
