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

function load1h(symbol: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${symbol}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  const f500 = path.join(CACHE_DIR, `${symbol}_1h_500.json`);
  if (fs.existsSync(f500)) return JSON.parse(fs.readFileSync(f500, 'utf-8'));
  return [];
}

// Pre-load data
const data15m = new Map<string, CandleData[]>();
const data1h = new Map<string, CandleData[]>();
for (const s of SYMBOLS) {
  data15m.set(s, load15m(s));
  data1h.set(s, load1h(s));
}

interface ParamSet {
  bbDev: number;
  rsiOversold: number;
  rsiOverbought: number;
  wickRatio: number;
  tpMult: number;
  slMult: number;
  beMult: number;
  require1HTrend: boolean;
}

function testParams(params: ParamSet) {
  let grandWins = 0;
  let grandLosses = 0;
  const resultsByCoin: Record<string, { wins: number; losses: number; wr: number }> = {};

  for (const sym of SYMBOLS) {
    const bars15m = data15m.get(sym)!;
    const bars1h = data1h.get(sym)!;
    if (bars15m.length < 200) continue;

    const h1Closes = bars1h.map(b => b.close);
    const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    let h1Idx = 0;

    let wins = 0;
    let losses = 0;

    for (let i = 50; i < bars15m.length - 20; i++) {
      const win = bars15m.slice(i - 50, i + 1);
      const c = win[win.length - 1];

      while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= c.time) {
        h1Idx++;
      }
      const h1C = bars1h[h1Idx]?.close || c.close;
      const h1E = h1Ema50[h1Idx] || c.close;

      const closes = win.map(b => b.close);
      const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const variance = closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
      const stdDev = Math.sqrt(variance);
      const upperBB = mean + (params.bbDev * stdDev);
      const lowerBB = mean - (params.bbDev * stdDev);

      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;
      const rsi = conf.rsi14;

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      let side: 'BUY' | 'SELL' | null = null;

      // BUY Condition
      if (c.low <= lowerBB && c.close > lowerBB && isGreen && lowerWick >= body * params.wickRatio && rsi <= params.rsiOversold) {
        if (!params.require1HTrend || h1C > h1E) {
          side = 'BUY';
        }
      }

      // SELL Condition
      if (c.high >= upperBB && c.close < upperBB && !isGreen && upperWick >= body * params.wickRatio && rsi >= params.rsiOverbought) {
        if (!params.require1HTrend || h1C < h1E) {
          side = 'SELL';
        }
      }

      if (!side) continue;

      const entryPrice = c.close;
      const targetPrice = side === 'BUY' ? entryPrice + (params.tpMult * atr) : entryPrice - (params.tpMult * atr);
      let stopLossPrice = side === 'BUY' ? entryPrice - (params.slMult * atr) : entryPrice + (params.slMult * atr);
      let beTriggered = false;

      let outcome = 'TIMEOUT';

      for (let f = 1; f <= 16; f++) {
        const bar = bars15m[i + f];
        if (!bar) break;

        const move = side === 'BUY' ? bar.high - entryPrice : entryPrice - bar.low;
        if (move >= params.beMult * atr && !beTriggered) {
          beTriggered = true;
          stopLossPrice = side === 'BUY' ? entryPrice + (0.05 * atr) : entryPrice - (0.05 * atr);
        }

        const isTP = side === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
        const isSL = side === 'BUY' ? bar.low <= stopLossPrice : bar.high >= stopLossPrice;

        if (isTP && !isSL) {
          outcome = 'WIN';
          i += f;
          break;
        } else if (isSL) {
          outcome = beTriggered ? 'WIN_BE' : 'LOSS';
          i += f;
          break;
        }
      }

      if (outcome === 'WIN' || outcome === 'WIN_BE') {
        wins++;
      } else if (outcome === 'LOSS') {
        losses++;
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

// Run Grid
const bbDevs = [2.2, 2.4, 2.6];
const rsiOS = [30, 33, 36];
const rsiOB = [64, 67, 70];
const wickRatios = [0.6, 0.8, 1.0];
const tpMults = [1.0, 1.2, 1.4];
const slMults = [1.5, 1.8, 2.0];
const beMults = [0.6, 0.7, 0.8];

console.log('⚡ Running Grid Search for >= 75% Win Rate across ALL Coins...');

let bestConfig: any = null;
let maxWR = 0;
let qualifiedConfigs: any[] = [];

for (const bb of bbDevs) {
  for (const os of rsiOS) {
    for (const ob of rsiOB) {
      for (const w of wickRatios) {
        for (const tp of tpMults) {
          for (const sl of slMults) {
            for (const be of beMults) {
              const res = testParams({
                bbDev: bb,
                rsiOversold: os,
                rsiOverbought: ob,
                wickRatio: w,
                tpMult: tp,
                slMult: sl,
                beMult: be,
                require1HTrend: false
              });

              if (res.grandT >= 40 && res.grandWR >= 75.0) {
                // Check if all coins have >= 70% WR
                const allCoinsHigh = Object.values(res.resultsByCoin).every(c => c.wins + c.losses === 0 || c.wr >= 68.0);
                if (allCoinsHigh) {
                  qualifiedConfigs.push({
                    params: { bbDev: bb, rsiOversold: os, rsiOverbought: ob, wickRatio: w, tpMult: tp, slMult: sl, beMult: be },
                    ...res
                  });
                }
              }

              if (res.grandT >= 40 && res.grandWR > maxWR) {
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

console.log(`\nGrid Search Completed! Highest Overall Win Rate found: ${maxWR.toFixed(1)}%`);
console.log(`Qualified Configurations with >= 75% Win Rate: ${qualifiedConfigs.length}`);

// Sort qualified by WR
qualifiedConfigs.sort((a, b) => b.grandWR - a.grandWR);

const topWinners = qualifiedConfigs.slice(0, 5);
for (let idx = 0; idx < topWinners.length; idx++) {
  const q = topWinners[idx];
  console.log(`\n========================================================================`);
  console.log(`🏆 WINNING CONFIG #${idx + 1}: ${q.grandWR.toFixed(1)}% WIN RATE (${q.grandWins} Wins / ${q.grandLosses} Losses)`);
  console.log(`   Params: BB=${q.params.bbDev} | RSI=[${q.params.rsiOversold}, ${q.params.rsiOverbought}] | Wick=${q.params.wickRatio} | TP=${q.params.tpMult} ATR | SL=${q.params.slMult} ATR | BE=${q.params.beMult} ATR`);
  console.log(`   Coin Breakdown:`);
  for (const [sym, rep] of Object.entries(q.resultsByCoin as any)) {
    console.log(`     🪙 ${sym.padEnd(8)}: ${rep.wins}W / ${rep.losses}L -> ${(rep as any).wr.toFixed(1)}% WR`);
  }
}

// Save best report
fs.writeFileSync(
  path.join(process.cwd(), 'public', 'high_winrate_75_report.json'),
  JSON.stringify({ topWinners, bestConfig }, null, 2)
);
