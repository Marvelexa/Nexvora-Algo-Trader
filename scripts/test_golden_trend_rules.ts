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

interface PreBar {
  index: number;
  time: number;
  close: number;
  atr: number;
  adx: number;
  rsi: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  isGreen: boolean;
  bullTrend: boolean;
  bearTrend: boolean;
  isHigh10: boolean;
  isLow10: boolean;
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

const symbolBars = new Map<string, CandleData[]>();
const symbolPreBars = new Map<string, PreBar[]>();

for (const sym of SYMBOLS) {
  const bars15m = load15m(sym);
  const bars1h = load1h(sym);
  if (bars15m.length < 200) continue;

  symbolBars.set(sym, bars15m);
  const preList: PreBar[] = [];

  const h1Closes = bars1h.map(b => b.close);
  const h1Ema50Series = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  for (let i = 50; i < bars15m.length; i++) {
    const win15m = bars15m.slice(i - 50, i + 1);
    const curr = win15m[win15m.length - 1];

    const closes = win15m.map(c => c.close);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win15m, 14);
    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win15m);
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

    const prior10 = win15m.slice(-11, -1);
    const high10 = Math.max(...prior10.map(c => c.high));
    const low10 = Math.min(...prior10.map(c => c.low));

    const bullTrend = h1Close > h1Ema50 && curr.close > ema20 && ema20 > ema50;
    const bearTrend = h1Close < h1Ema50 && curr.close < ema20 && ema20 < ema50;

    preList.push({
      index: i,
      time: curr.time,
      close: curr.close,
      atr,
      adx,
      rsi: conf.rsi14,
      body,
      upperWick,
      lowerWick,
      isGreen,
      bullTrend,
      bearTrend,
      isHigh10: curr.close > high10,
      isLow10: curr.close < low10,
    });
  }
  symbolPreBars.set(sym, preList);
}

interface TestParam {
  tpAtr: number;
  slAtr: number;
  adxMin: number;
  maxWickRatio: number;
  requireBreakout: boolean;
}

function runFastGoldenTest(p: TestParam) {
  let totalSigs = 0;
  let wins = 0;
  let losses = 0;
  let totalGain = 0;
  let totalLoss = 0;

  for (const sym of SYMBOLS) {
    const rawBars = symbolBars.get(sym);
    const preBars = symbolPreBars.get(sym);
    if (!rawBars || !preBars) continue;

    for (let j = 0; j < preBars.length - 20; j++) {
      const b = preBars[j];
      if (b.adx < p.adxMin) continue;

      let sig: 'BUY' | 'SELL' | null = null;

      if (
        b.bullTrend &&
        b.isGreen &&
        b.upperWick <= b.body * p.maxWickRatio &&
        b.body >= b.atr * 0.4 &&
        b.rsi >= 48 && b.rsi <= 68
      ) {
        if (!p.requireBreakout || b.isHigh10) sig = 'BUY';
      }

      if (
        b.bearTrend &&
        !b.isGreen &&
        b.lowerWick <= b.body * p.maxWickRatio &&
        b.body >= b.atr * 0.4 &&
        b.rsi <= 52 && b.rsi >= 32
      ) {
        if (!p.requireBreakout || b.isLow10) sig = 'SELL';
      }

      if (!sig) continue;
      totalSigs++;

      const entry = b.close;
      const tp = sig === 'BUY' ? entry + p.tpAtr * b.atr : entry - p.tpAtr * b.atr;
      const sl = sig === 'BUY' ? entry - p.slAtr * b.atr : entry + p.slAtr * b.atr;

      const rawStart = b.index;
      let won = false;
      let lost = false;

      for (let f = 1; f <= 16; f++) {
        const fb = rawBars[rawStart + f];
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
        totalGain += p.tpAtr;
      } else if (lost) {
        losses++;
        totalLoss += p.slAtr;
      } else {
        const fb = rawBars[rawStart + 16];
        if (fb) {
          const diff = sig === 'BUY' ? (fb.close - entry) / b.atr : (entry - fb.close) / b.atr;
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
  }

  const wr = totalSigs > 0 ? parseFloat(((wins / totalSigs) * 100).toFixed(1)) : 0;
  const pf = totalLoss > 0 ? parseFloat((totalGain / totalLoss).toFixed(2)) : 0;
  const ev = totalSigs > 0 ? parseFloat(((totalGain - totalLoss) / totalSigs).toFixed(3)) : 0;

  return {
    ...p,
    totalSigs,
    wins,
    losses,
    winRate: wr,
    profitFactor: pf,
    expectedValueR: ev,
  };
}

const paramList: TestParam[] = [];
for (const tpAtr of [1.6, 2.0, 2.4, 2.8, 3.2]) {
  for (const slAtr of [1.0, 1.2, 1.4, 1.6, 1.8]) {
    for (const adxMin of [22, 25, 28]) {
      for (const maxWickRatio of [0.4, 0.6]) {
        for (const requireBreakout of [true, false]) {
          paramList.push({ tpAtr, slAtr, adxMin, maxWickRatio, requireBreakout });
        }
      }
    }
  }
}

const allResults = paramList.map(runFastGoldenTest);

// Sort by Profit Factor descending
allResults.sort((a, b) => b.profitFactor - a.profitFactor);

console.log(`========================================================================`);
console.log(`TOP 20 BEST RESULTS OVERALL:`);
console.log(`========================================================================`);
allResults.slice(0, 20).forEach((r, idx) => {
  console.log(`[#${idx+1}] TP=${r.tpAtr}x SL=${r.slAtr}x | ADX>=${r.adxMin} | Wick<=${r.maxWickRatio} | Breakout=${r.requireBreakout}`);
  console.log(`     Sigs: ${r.totalSigs} | Win Rate: ${r.winRate}% (${r.wins}W / ${r.losses}L) | PF: ${r.profitFactor} | EV: ${r.expectedValueR > 0 ? '+' : ''}${r.expectedValueR} R/trade`);
});
