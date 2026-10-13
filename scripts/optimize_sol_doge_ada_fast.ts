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

interface PreBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  atr: number;
  adx: number;
  rsi: number;
  ema20: number;
  ema50: number;
  h1Close: number;
  h1Ema50: number;
  isGreen: boolean;
  body: number;
  lowerWick: number;
  upperWick: number;
  high20: number;
  low20: number;
  bbMean: number;
  bbStd: number;
}

const TARGET_COINS = ['SOLUSD', 'DOGEUSD', 'ADAUSD'];

for (const sym of TARGET_COINS) {
  const b15 = load15m(sym);
  const b1h = load1h(sym);
  const h1Closes = b1h.map(b => b.close);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  const preBars: PreBar[] = [];

  for (let i = 50; i < b15.length; i++) {
    const win = b15.slice(i - 50, i + 1);
    const c = win[win.length - 1];
    const closes = win.map(b => b.close);

    while (h1Idx < b1h.length - 1 && b1h[h1Idx + 1].time <= c.time) {
      h1Idx++;
    }

    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];

    const prev20 = win.slice(-21, -1);
    const high20 = Math.max(...prev20.map(x => x.high));
    const low20 = Math.min(...prev20.map(x => x.low));

    const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const variance = closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
    const bbStd = Math.sqrt(variance);

    preBars.push({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      atr,
      adx,
      rsi: conf.rsi14,
      ema20,
      ema50,
      h1Close: b1h[h1Idx]?.close || c.close,
      h1Ema50: h1Ema50[h1Idx] || c.close,
      isGreen: c.close > c.open,
      body: Math.abs(c.close - c.open),
      lowerWick: Math.min(c.open, c.close) - c.low,
      upperWick: c.high - Math.max(c.open, c.close),
      high20,
      low20,
      bbMean: mean,
      bbStd
    });
  }

  console.log(`\n🔍 Searching High-Winrate (>=75%) Setups for ${sym} (Precomputed ${preBars.length} bars)...`);

  let best: any = null;

  for (const setupType of ['TREND_PULLBACK', 'DONCHIAN_EXPANSION', 'BB_MEAN_REVERT', 'DEEP_SWEEP']) {
    for (const tpMult of [1.2, 1.4, 1.6, 2.0]) {
      for (const slMult of [1.0, 1.2, 1.5, 1.8]) {
        for (const beTrigger of [0.6, 0.8, 1.0, null]) {
          let wins = 0;
          let losses = 0;
          let netProfitUSD = 0;
          let grossWinUSD = 0;
          let grossLossUSD = 0;

          for (let i = 1; i < preBars.length - 16; i++) {
            const c = preBars[i];
            const prev = preBars[i - 1];

            let side: 'BUY' | 'SELL' | null = null;

            if (setupType === 'TREND_PULLBACK') {
              if (c.adx >= 20 && c.h1Close > c.h1Ema50 && c.ema20 > c.ema50 && c.close > c.ema20 && prev.low <= c.ema20 * 1.002) {
                if (c.isGreen && c.lowerWick >= c.body * 0.7 && c.rsi >= 46 && c.rsi <= 66) side = 'BUY';
              }
              if (c.adx >= 20 && c.h1Close < c.h1Ema50 && c.ema20 < c.ema50 && c.close < c.ema20 && prev.high >= c.ema20 * 0.998) {
                if (!c.isGreen && c.upperWick >= c.body * 0.7 && c.rsi <= 54 && c.rsi >= 34) side = 'SELL';
              }
            } else if (setupType === 'DONCHIAN_EXPANSION') {
              if (c.adx >= 22 && c.h1Close > c.h1Ema50 && c.close > c.high20 && c.isGreen && c.body > c.atr * 0.6) side = 'BUY';
              if (c.adx >= 22 && c.h1Close < c.h1Ema50 && c.close < c.low20 && !c.isGreen && c.body > c.atr * 0.6) side = 'SELL';
            } else if (setupType === 'BB_MEAN_REVERT') {
              const lower = c.bbMean - (2.2 * c.bbStd);
              const upper = c.bbMean + (2.2 * c.bbStd);
              if (c.low <= lower && c.close > lower && c.isGreen && c.lowerWick >= c.body * 0.8 && c.rsi <= 32) side = 'BUY';
              if (c.high >= upper && c.close < upper && !c.isGreen && c.upperWick >= c.body * 0.8 && c.rsi >= 68) side = 'SELL';
            } else if (setupType === 'DEEP_SWEEP') {
              if (c.low < c.low20 && c.close > c.low20 + (0.15 * c.atr) && c.isGreen && c.lowerWick >= c.body * 1.0 && c.rsi <= 44) side = 'BUY';
              if (c.high > c.high20 && c.close < c.high20 - (0.15 * c.atr) && !c.isGreen && c.upperWick >= c.body * 1.0 && c.rsi >= 56) side = 'SELL';
            }

            if (!side) continue;

            const entryPrice = c.close;
            const tp = side === 'BUY' ? entryPrice + (tpMult * c.atr) : entryPrice - (tpMult * c.atr);
            let sl = side === 'BUY' ? entryPrice - (slMult * c.atr) : entryPrice + (slMult * c.atr);
            let beLocked = false;

            const riskUSD = 2.50;
            const slDist = Math.abs(entryPrice - sl);
            const qty = riskUSD / slDist;
            const fee = (qty * entryPrice) * 0.0012;

            let tradeWon = false;
            let tradeResolved = false;

            for (let f = 1; f <= 16; f++) {
              const forward = preBars[i + f];
              if (!forward) break;

              if (beTrigger !== null && !beLocked) {
                const move = side === 'BUY' ? forward.high - entryPrice : entryPrice - forward.low;
                if (move >= beTrigger * c.atr) {
                  beLocked = true;
                  sl = side === 'BUY' ? entryPrice + (0.2 * c.atr) : entryPrice - (0.2 * c.atr); // Locked in positive green after fees!
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
                tradeWon = beLocked;
                tradeResolved = true;
                i += f;
                break;
              }
            }

            if (tradeResolved) {
              if (tradeWon) {
                wins++;
                const gain = ((beLocked && !tradeWon ? 0.2 : tpMult) * c.atr * qty) - fee;
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
    console.log(`🎯 ${sym} HIGH-WINRATE SETUP FOUND:`);
    console.log(`   Setup: ${best.setupType} | TP: ${best.tpMult}x ATR | SL: ${best.slMult}x ATR | BE: ${best.beTrigger}x ATR`);
    console.log(`   Stats: ${best.wr}% WIN RATE (${best.wins}W / ${best.losses}L out of ${best.total} trades) | Net Profit: +$${best.netProfitUSD} USD | PF: ${best.profitFactor}`);
  } else {
    console.log(`⚠️ ${sym}: No setup crossed 75% threshold.`);
  }
}
