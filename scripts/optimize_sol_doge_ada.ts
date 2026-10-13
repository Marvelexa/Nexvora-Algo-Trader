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

function load15m(sym: string): CandleData[] {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_15m_5000.json`), 'utf-8'));
}

function load1h(sym: string): CandleData[] {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_1h_1500.json`), 'utf-8'));
}

const TARGET_COINS = ['SOLUSD', 'DOGEUSD', 'ADAUSD'];

for (const sym of TARGET_COINS) {
  const b15 = load15m(sym);
  const b1h = load1h(sym);
  const h1Closes = b1h.map(b => b.close);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  console.log(`\n🔍 Optimizing ${sym} for >= 75% Win Rate...`);

  let best: any = null;

  // Test across combinations
  for (const setupType of ['TREND_PULLBACK', 'DONCHIAN_EXPANSION', 'BB_MEAN_REVERT', 'LIQUIDITY_SWEEP']) {
    for (const tpMult of [1.1, 1.3, 1.5, 1.8]) {
      for (const slMult of [1.0, 1.2, 1.5, 1.8]) {
        for (const beTrigger of [0.5, 0.7, 0.9, null]) {
          let wins = 0;
          let losses = 0;
          let netProfitUSD = 0;
          let grossWinUSD = 0;
          let grossLossUSD = 0;

          for (let i = 50; i < b15.length - 16; i++) {
            const win = b15.slice(i - 50, i + 1);
            const c = win[win.length - 1];
            const prev = win[win.length - 2];

            while (h1Idx < b1h.length - 1 && b1h[h1Idx + 1].time <= c.time) {
              h1Idx++;
            }
            const h1C = b1h[h1Idx]?.close || c.close;
            const h1E = h1Ema50[h1Idx] || c.close;

            const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
            const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;
            const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

            const closes = win.map(b => b.close);
            const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
            const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];

            const isGreen = c.close > c.open;
            const body = Math.abs(c.close - c.open);
            const lowerWick = Math.min(c.open, c.close) - c.low;
            const upperWick = c.high - Math.max(c.open, c.close);

            let side: 'BUY' | 'SELL' | null = null;

            if (setupType === 'TREND_PULLBACK') {
              if (adx >= 22 && h1C > h1E && ema20 > ema50 && c.close > ema20 && prev.low <= ema20 * 1.002) {
                if (isGreen && lowerWick >= body * 0.8 && conf.rsi14 >= 46 && conf.rsi14 <= 66) side = 'BUY';
              }
              if (adx >= 22 && h1C < h1E && ema20 < ema50 && c.close < ema20 && prev.high >= ema20 * 0.998) {
                if (!isGreen && upperWick >= body * 0.8 && conf.rsi14 <= 54 && conf.rsi14 >= 34) side = 'SELL';
              }
            } else if (setupType === 'DONCHIAN_EXPANSION') {
              const prev20 = win.slice(-21, -1);
              const high20 = Math.max(...prev20.map(x => x.high));
              const low20 = Math.min(...prev20.map(x => x.low));
              if (adx >= 24 && h1C > h1E && c.close > high20 && isGreen && body > atr * 0.6) side = 'BUY';
              if (adx >= 24 && h1C < h1E && c.close < low20 && !isGreen && body > atr * 0.6) side = 'SELL';
            } else if (setupType === 'BB_MEAN_REVERT') {
              const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
              const variance = closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
              const stdDev = Math.sqrt(variance);
              if (c.low <= mean - (2.3 * stdDev) && c.close > mean - (2.3 * stdDev) && isGreen && lowerWick >= body * 0.8 && conf.rsi14 <= 32) side = 'BUY';
              if (c.high >= mean + (2.3 * stdDev) && c.close < mean + (2.3 * stdDev) && !isGreen && upperWick >= body * 0.8 && conf.rsi14 >= 68) side = 'SELL';
            } else if (setupType === 'LIQUIDITY_SWEEP') {
              const prev30 = win.slice(-30, -1);
              const low30 = Math.min(...prev30.map(x => x.low));
              const high30 = Math.max(...prev30.map(x => x.high));
              if (c.low < low30 && c.close > low30 + (0.1 * atr) && isGreen && lowerWick >= body * 1.0) side = 'BUY';
              if (c.high > high30 && c.close < high30 - (0.1 * atr) && !isGreen && upperWick >= body * 1.0) side = 'SELL';
            }

            if (!side) continue;

            const entryPrice = c.close;
            const tp = side === 'BUY' ? entryPrice + (tpMult * atr) : entryPrice - (tpMult * atr);
            let sl = side === 'BUY' ? entryPrice - (slMult * atr) : entryPrice + (slMult * atr);
            let beLocked = false;

            const riskUSD = 2.50;
            const slDist = Math.abs(entryPrice - sl);
            const qty = riskUSD / slDist;
            const fee = (qty * entryPrice) * 0.0012;

            let tradeWon = false;
            let tradeResolved = false;

            for (let f = 1; f <= 16; f++) {
              const forward = b15[i + f];
              if (!forward) break;

              // Breakeven check
              if (beTrigger !== null && !beLocked) {
                const move = side === 'BUY' ? forward.high - entryPrice : entryPrice - forward.low;
                if (move >= beTrigger * atr) {
                  beLocked = true;
                  sl = side === 'BUY' ? entryPrice + (0.15 * atr) : entryPrice - (0.15 * atr); // Locked in positive green after fees!
                }
              }

              const isTP = side === 'BUY' ? forward.high >= tp : forward.low <= tp;
              const isSL = side === 'BUY' ? forward.low <= sl : forward.high >= sl;

              if (isTP && !isSL) {
                tradeWon = true;
                tradeResolved = true;
                i += f;
                break;
              } else if (isSL) {
                tradeWon = beLocked; // If breakeven locked at +0.15 ATR, it's a net green win!
                tradeResolved = true;
                i += f;
                break;
              }
            }

            if (tradeResolved) {
              if (tradeWon) {
                wins++;
                const gain = ((beLocked && !tradeWon ? 0.15 : tpMult) * atr * qty) - fee;
                grossWinUSD += gain;
                netProfitUSD += gain;
              } else {
                losses++;
                const loss = riskUSD + fee;
                grossLossUSD += loss;
                netProfitUSD -= loss;
              }
            }
          }

          const total = wins + losses;
          const wr = total > 0 ? (wins / total) * 100 : 0;
          const pf = grossLossUSD > 0 ? grossWinUSD / grossLossUSD : 99;

          if (total >= 10 && wr >= 75.0 && netProfitUSD > 0) {
            if (!best || wr > best.wr || (wr === best.wr && netProfitUSD > best.netProfitUSD)) {
              best = {
                setupType,
                tpMult,
                slMult,
                beTrigger,
                total,
                wins,
                losses,
                wr: parseFloat(wr.toFixed(1)),
                netProfitUSD: parseFloat(netProfitUSD.toFixed(2)),
                profitFactor: parseFloat(pf.toFixed(2))
              };
            }
          }
        }
      }
    }
  }

  if (best) {
    console.log(`🎯 ${sym} FOUND >= 75% SETUP:`);
    console.log(`   Setup: ${best.setupType} | TP: ${best.tpMult}x | SL: ${best.slMult}x | BE Trigger: ${best.beTrigger}x`);
    console.log(`   Result: ${best.wr}% WIN RATE (${best.wins}W / ${best.losses}L out of ${best.total} trades) | Net: +$${best.netProfitUSD} | PF: ${best.profitFactor}`);
  } else {
    console.log(`⚠️ ${sym}: No setup crossed 75% under tested grid.`);
  }
}
