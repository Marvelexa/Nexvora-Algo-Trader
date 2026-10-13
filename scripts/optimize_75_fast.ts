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
const SYMBOLS = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD', 'ADAUSD', 'ETHUSD'];

function load15m(symbol: string): CandleData[] {
  const f5k = path.join(CACHE_DIR, `${symbol}_15m_5000.json`);
  if (fs.existsSync(f5k)) return JSON.parse(fs.readFileSync(f5k, 'utf-8'));
  const f2k = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (fs.existsSync(f2k)) return JSON.parse(fs.readFileSync(f2k, 'utf-8'));
  return [];
}

interface PrecomputedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isGreen: boolean;
  body: number;
  lowerWick: number;
  upperWick: number;
  atr: number;
  rsi: number;
  bbMean: number;
  bbStd: number;
}

const precomputedMap = new Map<string, PrecomputedBar[]>();

for (const sym of SYMBOLS) {
  const raw = load15m(sym);
  if (raw.length < 100) continue;
  const list: PrecomputedBar[] = [];

  for (let i = 25; i < raw.length; i++) {
    const win = raw.slice(i - 25, i + 1);
    const c = win[win.length - 1];
    const closes = win.map(b => b.close);

    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const variance = closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
    const bbStd = Math.sqrt(variance);

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;

    const isGreen = c.close > c.open;
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    list.push({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      isGreen,
      body,
      lowerWick,
      upperWick,
      atr,
      rsi: conf.rsi14,
      bbMean: mean,
      bbStd
    });
  }
  precomputedMap.set(sym, list);
}

console.log('⚡ Pre-computation finished across all 6 coins. Running high-speed grid...');

interface ParamSet {
  bbDev: number;
  rsiOversold: number;
  rsiOverbought: number;
  wickRatio: number;
  tpMult: number;
  slMult: number;
  beMult: number;
}

function testParamsFast(p: ParamSet) {
  let grandWins = 0;
  let grandLosses = 0;
  const resultsByCoin: Record<string, { wins: number; losses: number; wr: number }> = {};

  for (const sym of SYMBOLS) {
    const bars = precomputedMap.get(sym);
    if (!bars || bars.length < 100) continue;

    let wins = 0;
    let losses = 0;

    for (let i = 0; i < bars.length - 16; i++) {
      const c = bars[i];
      const lowerBB = c.bbMean - (p.bbDev * c.bbStd);
      const upperBB = c.bbMean + (p.bbDev * c.bbStd);

      let side: 'BUY' | 'SELL' | null = null;
      if (c.low <= lowerBB && c.close > lowerBB && c.isGreen && c.lowerWick >= c.body * p.wickRatio && c.rsi <= p.rsiOversold) {
        side = 'BUY';
      } else if (c.high >= upperBB && c.close < upperBB && !c.isGreen && c.upperWick >= c.body * p.wickRatio && c.rsi >= p.rsiOverbought) {
        side = 'SELL';
      }

      if (!side) continue;

      const entryPrice = c.close;
      const targetPrice = side === 'BUY' ? entryPrice + (p.tpMult * c.atr) : entryPrice - (p.tpMult * c.atr);
      let stopLossPrice = side === 'BUY' ? entryPrice - (p.slMult * c.atr) : entryPrice + (p.slMult * c.atr);
      let beTriggered = false;

      for (let f = 1; f <= 16; f++) {
        const bar = bars[i + f];
        if (!bar) break;

        const move = side === 'BUY' ? bar.high - entryPrice : entryPrice - bar.low;
        if (move >= p.beMult * c.atr && !beTriggered) {
          beTriggered = true;
          stopLossPrice = side === 'BUY' ? entryPrice + (0.05 * c.atr) : entryPrice - (0.05 * c.atr);
        }

        const isTP = side === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
        const isSL = side === 'BUY' ? bar.low <= stopLossPrice : bar.high >= stopLossPrice;

        if (isTP && !isSL) {
          wins++;
          i += f;
          break;
        } else if (isSL) {
          if (beTriggered) {
            wins++; // Saved by breakeven in green
          } else {
            losses++;
          }
          i += f;
          break;
        }
      }
    }

    const t = wins + losses;
    const wr = t > 0 ? (wins / t) * 100 : 0;
    resultsByCoin[sym] = { wins, losses, wr };
    grandWins += wins;
    grandLosses += losses;
  }

  const grandT = grandWins + grandLosses;
  const grandWR = grandT > 0 ? (grandWins / grandT) * 100 : 0;
  return { grandWins, grandLosses, grandT, grandWR, resultsByCoin };
}

// Optimized Grid
const bbDevs = [2.2, 2.4, 2.6];
const rsiOS = [30, 34, 38];
const rsiOB = [62, 66, 70];
const wickRatios = [0.5, 0.7, 0.9];
const tpMults = [1.1, 1.3, 1.5];
const slMults = [1.5, 1.8, 2.0];
const beMults = [0.6, 0.75, 0.9];

let bestConfig: any = null;
let maxWR = 0;
const qualified: any[] = [];

for (const bb of bbDevs) {
  for (const os of rsiOS) {
    for (const ob of rsiOB) {
      for (const w of wickRatios) {
        for (const tp of tpMults) {
          for (const sl of slMults) {
            for (const be of beMults) {
              const res = testParamsFast({ bbDev: bb, rsiOversold: os, rsiOverbought: ob, wickRatio: w, tpMult: tp, slMult: sl, beMult: be });
              if (res.grandT >= 50 && res.grandWR >= 75.0) {
                qualified.push({
                  params: { bbDev: bb, rsiOversold: os, rsiOverbought: ob, wickRatio: w, tpMult: tp, slMult: sl, beMult: be },
                  ...res
                });
              }
              if (res.grandT >= 50 && res.grandWR > maxWR) {
                maxWR = res.grandWR;
                bestConfig = {
                  params: { bbDev: bb, rsiOversold: os, rsiOverbought: ob, wickRatio: w, tpMult: tp, slMult: sl, beMult: be },
                  ...res
                };
              }
            }
          }
        }
      }
    }
  }
}

console.log(`\nGrid Completed! Qualified configs (>=75% WR): ${qualified.length}`);
console.log(`Highest overall win rate across all coins: ${maxWR.toFixed(1)}%`);

qualified.sort((a, b) => b.grandWR - a.grandWR);
const top5 = qualified.slice(0, 5);

for (let i = 0; i < top5.length; i++) {
  const q = top5[i];
  console.log(`\n========================================================================`);
  console.log(`🏆 RANK #${i + 1}: ${q.grandWR.toFixed(1)}% WIN RATE (${q.grandWins} Wins / ${q.grandLosses} Losses across ${q.grandT} trades)`);
  console.log(`   Config: BB=${q.params.bbDev} | RSI=[${q.params.rsiOversold}, ${q.params.rsiOverbought}] | Wick=${q.params.wickRatio} | TP=${q.params.tpMult} ATR | SL=${q.params.slMult} ATR | BE=${q.params.beMult} ATR`);
  console.log(`   Coin Breakdown:`);
  for (const [sym, rep] of Object.entries(q.resultsByCoin as any)) {
    console.log(`     🪙 ${sym.padEnd(8)}: ${rep.wins}W / ${rep.losses}L -> ${(rep as any).wr.toFixed(1)}% WR`);
  }
}

// Save detailed report
fs.writeFileSync(
  path.join(process.cwd(), 'public', 'ultra_high_winrate_report.json'),
  JSON.stringify({ bestConfig, top5 }, null, 2)
);
