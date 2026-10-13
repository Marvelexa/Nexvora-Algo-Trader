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
const SYMBOLS = ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'SOLUSD', 'ETHUSD'];

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

console.log('Testing Strict Macro Trend Alignment across all coins...');

for (const sym of SYMBOLS) {
  const bars15m = load15m(sym);
  const bars1h = load1h(sym);
  if (bars15m.length < 200) continue;

  const h1Closes = bars1h.map(b => b.close);
  const h1Ema20 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 20);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  let totalSigs = 0;
  let wins = 0;
  let losses = 0;
  let totalWinR = 0;
  let totalLossR = 0;

  for (let i = 50; i < bars15m.length - 20; i++) {
    const win15m = bars15m.slice(i - 50, i + 1);
    const curr = win15m[win15m.length - 1];

    const closes = win15m.map(c => c.close);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win15m, 14);
    if (adx < 24) continue;

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win15m);
    const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

    while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
      h1Idx++;
    }
    const h1C = bars1h[h1Idx]?.close || curr.close;
    const h1E20 = h1Ema20[h1Idx] || curr.close;
    const h1E50 = h1Ema50[h1Idx] || curr.close;

    // Macro Bear: 1H close < 20 EMA AND 20 EMA < 50 EMA
    const macroBear = h1C < h1E20 && h1E20 < h1E50;
    // Macro Bull: 1H close > 20 EMA AND 20 EMA > 50 EMA
    const macroBull = h1C > h1E20 && h1E20 > h1E50;

    let sig: 'BUY' | 'SELL' | null = null;
    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    // ONLY LONG if Macro Bull + 15m Bull + Strong Green Expansion Bar
    if (macroBull && curr.close > ema20 && ema20 > ema50 && isGreen && upperWick <= body * 0.5 && body >= atr * 0.5) {
      if (conf.rsi14 >= 50 && conf.rsi14 <= 68) {
        sig = 'BUY';
      }
    }

    // ONLY SHORT if Macro Bear + 15m Bear + Strong Red Expansion Bar
    if (macroBear && curr.close < ema20 && ema20 < ema50 && !isGreen && lowerWick <= body * 0.5 && body >= atr * 0.5) {
      if (conf.rsi14 <= 50 && conf.rsi14 >= 32) {
        sig = 'SELL';
      }
    }

    if (!sig) continue;
    totalSigs++;

    const tpDist = 2.4 * atr;
    const slDist = 1.2 * atr;
    const tp = sig === 'BUY' ? curr.close + tpDist : curr.close - tpDist;
    const sl = sig === 'BUY' ? curr.close - slDist : curr.close + slDist;

    let won = false;
    let lost = false;

    for (let f = 1; f <= 16; f++) {
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
      totalWinR += 2.4;
    } else if (lost) {
      losses++;
      totalLossR += 1.2;
    } else {
      const fb = bars15m[i + 16];
      if (fb) {
        const diff = sig === 'BUY' ? (fb.close - curr.close) / atr : (curr.close - fb.close) / atr;
        if (diff > 0) {
          wins++;
          totalWinR += diff;
        } else {
          losses++;
          totalLossR += Math.abs(diff);
        }
      }
    }
  }

  const wr = totalSigs > 0 ? ((wins / totalSigs) * 100).toFixed(1) : '0';
  const pf = totalLossR > 0 ? (totalWinR / totalLossR).toFixed(2) : '0';
  console.log(`${sym.padEnd(8)} | Sigs: ${totalSigs.toString().padStart(4)} | Win Rate: ${wr}% (${wins}W / ${losses}L) | PF: ${pf} | EV: +${((totalWinR - totalLossR) / (totalSigs || 1)).toFixed(2)} R`);
}
