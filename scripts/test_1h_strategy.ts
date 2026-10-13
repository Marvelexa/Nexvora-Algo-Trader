import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';

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

function load1h(symbol: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${symbol}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  const f500 = path.join(CACHE_DIR, `${symbol}_1h_500.json`);
  if (fs.existsSync(f500)) return JSON.parse(fs.readFileSync(f500, 'utf-8'));
  return [];
}

console.log('Testing 1H Candlestick Institutional Strategy on 1,500 1H candles (~2 months)...');

for (const sym of SYMBOLS) {
  const bars = load1h(sym);
  if (bars.length < 100) continue;

  let totalSigs = 0;
  let wins = 0;
  let losses = 0;
  let totalWinR = 0;
  let totalLossR = 0;

  for (let i = 50; i < bars.length - 12; i++) {
    const win = bars.slice(i - 50, i + 1);
    const curr = win[win.length - 1];

    const closes = win.map(c => c.close);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
    if (adx < 22) continue;

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr > 0 ? conf.atr : curr.close * 0.015;

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    let sig: 'BUY' | 'SELL' | null = null;

    // BUY: 1H 20 EMA > 50 EMA, Price > 20 EMA, Green expansion candle
    if (curr.close > ema20 && ema20 > ema50 && isGreen && upperWick <= body * 0.6 && body >= atr * 0.5) {
      if (conf.rsi14 >= 48 && conf.rsi14 <= 68) {
        sig = 'BUY';
      }
    }

    // SELL: 1H 20 EMA < 50 EMA, Price < 20 EMA, Red expansion candle
    if (curr.close < ema20 && ema20 < ema50 && !isGreen && lowerWick <= body * 0.6 && body >= atr * 0.5) {
      if (conf.rsi14 <= 52 && conf.rsi14 >= 32) {
        sig = 'SELL';
      }
    }

    if (!sig) continue;
    totalSigs++;

    const tpDist = 2.0 * atr;
    const slDist = 1.2 * atr;
    const tp = sig === 'BUY' ? curr.close + tpDist : curr.close - tpDist;
    const sl = sig === 'BUY' ? curr.close - slDist : curr.close + slDist;

    let won = false;
    let lost = false;

    for (let f = 1; f <= 12; f++) {
      const fb = bars[i + f];
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
      totalWinR += 2.0;
    } else if (lost) {
      losses++;
      totalLossR += 1.2;
    } else {
      const fb = bars[i + 12];
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
