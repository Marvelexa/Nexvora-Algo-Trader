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

const data15m = new Map<string, CandleData[]>();
const data1h = new Map<string, CandleData[]>();
for (const s of SYMBOLS) {
  data15m.set(s, load15m(s));
  data1h.set(s, load1h(s));
}

interface PreBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  adx: number;
  h1Close: number;
  h1Ema50: number;
  rvol: number;
}

const preBars = new Map<string, PreBar[]>();

for (const sym of SYMBOLS) {
  const b15 = data15m.get(sym)!;
  const b1h = data1h.get(sym)!;
  if (b15.length < 200) continue;

  const h1Closes = b1h.map(b => b.close);
  const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
  let h1Idx = 0;

  const list: PreBar[] = [];

  for (let i = 50; i < b15.length; i++) {
    const win = b15.slice(i - 50, i + 1);
    const c = win[win.length - 1];

    while (h1Idx < b1h.length - 1 && b1h[h1Idx + 1].time <= c.time) {
      h1Idx++;
    }

    const closes = win.map(b => b.close);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const ema200 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

    const vols = win.slice(-21, -1).map(b => b.volume);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const rvol = c.volume / (avgVol > 0 ? avgVol : 1);

    list.push({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      atr: conf.atr > 0 ? conf.atr : c.close * 0.008,
      ema20,
      ema50,
      ema200,
      rsi: conf.rsi14,
      adx,
      h1Close: b1h[h1Idx]?.close || c.close,
      h1Ema50: h1Ema50[h1Idx] || c.close,
      rvol,
    });
  }
  preBars.set(sym, list);
}

console.log('⚡ Running Systematic Strategy Matrix for >= 75% Real Net Win Rate & Compounding Profit...');

interface StrategyDef {
  name: string;
  check: (bar: PreBar, prev: PreBar, window: PreBar[]) => {
    side: 'BUY' | 'SELL';
    tpAtr: number;
    slAtr: number;
    trailTriggerAtr?: number;
    trailLockAtr?: number;
  } | null;
}

const testStrategies: StrategyDef[] = [
  // Model 1: Institutional 1H + 15m Dual Trend Squeeze with 1.2R Target
  {
    name: '1. Dual-Timeframe Trend Squeeze (TP=1.5 ATR, SL=1.0 ATR, R:R=1.5)',
    check: (b, prev, win) => {
      if (b.adx < 22 || b.rvol < 1.0) return null;
      const isGreen = b.close > b.open;
      const body = Math.abs(b.close - b.open);
      const lowerWick = Math.min(b.open, b.close) - b.low;
      const upperWick = b.high - Math.max(b.open, b.close);

      // BUY: 1H bullish + 15m 20 EMA bounce + lower wick >= body * 0.7
      if (b.h1Close > b.h1Ema50 && b.ema20 > b.ema50 && b.close > b.ema20 && prev.low <= b.ema20 * 1.002) {
        if (isGreen && lowerWick >= body * 0.7 && b.rsi >= 48 && b.rsi <= 65) {
          return { side: 'BUY', tpAtr: 1.5, slAtr: 1.0, trailTriggerAtr: 1.0, trailLockAtr: 0.4 };
        }
      }

      // SELL: 1H bearish + 15m 20 EMA rejection + upper wick >= body * 0.7
      if (b.h1Close < b.h1Ema50 && b.ema20 < b.ema50 && b.close < b.ema20 && prev.high >= b.ema20 * 0.998) {
        if (!isGreen && upperWick >= body * 0.7 && b.rsi <= 52 && b.rsi >= 35) {
          return { side: 'SELL', tpAtr: 1.5, slAtr: 1.0, trailTriggerAtr: 1.0, trailLockAtr: 0.4 };
        }
      }
      return null;
    }
  },

  // Model 2: Triple Confluence Liquidity Absorption (Sweep of 20-bar extreme + RVOL >= 1.3)
  {
    name: '2. Liquidity Absorption Pin Bar (TP=1.4 ATR, SL=1.1 ATR)',
    check: (b, prev, win) => {
      if (win.length < 25) return null;
      const prev20 = win.slice(-21, -1);
      const swingLow = Math.min(...prev20.map(x => x.low));
      const swingHigh = Math.max(...prev20.map(x => x.high));

      const isGreen = b.close > b.open;
      const body = Math.abs(b.close - b.open);
      const lowerWick = Math.min(b.open, b.close) - b.low;
      const upperWick = b.high - Math.max(b.open, b.close);

      // Bullish absorption: sweep low + strong green close
      if (b.low < swingLow && b.close > swingLow && isGreen && lowerWick >= body * 1.0 && b.rvol >= 1.2 && b.rsi <= 45) {
        return { side: 'BUY', tpAtr: 1.4, slAtr: 1.1, trailTriggerAtr: 0.9, trailLockAtr: 0.35 };
      }

      // Bearish absorption: sweep high + strong red close
      if (b.high > swingHigh && b.close < swingHigh && !isGreen && upperWick >= body * 1.0 && b.rvol >= 1.2 && b.rsi >= 55) {
        return { side: 'SELL', tpAtr: 1.4, slAtr: 1.1, trailTriggerAtr: 0.9, trailLockAtr: 0.35 };
      }
      return null;
    }
  },

  // Model 3: Momentum Impulse Breakout (Donchian 20 High/Low with ADX expansion)
  {
    name: '3. Momentum Impulse Breakout (TP=1.8 ATR, SL=1.2 ATR)',
    check: (b, prev, win) => {
      if (b.adx < 25 || b.rvol < 1.3) return null;
      const prev20 = win.slice(-21, -1);
      const high20 = Math.max(...prev20.map(x => x.high));
      const low20 = Math.min(...prev20.map(x => x.low));

      const isGreen = b.close > b.open;
      const body = Math.abs(b.close - b.open);

      if (b.h1Close > b.h1Ema50 && b.close > high20 && isGreen && body > b.atr * 0.7 && b.rsi > 52 && b.rsi < 68) {
        return { side: 'BUY', tpAtr: 1.8, slAtr: 1.2, trailTriggerAtr: 1.1, trailLockAtr: 0.45 };
      }

      if (b.h1Close < b.h1Ema50 && b.close < low20 && !isGreen && body > b.atr * 0.7 && b.rsi < 48 && b.rsi > 32) {
        return { side: 'SELL', tpAtr: 1.8, slAtr: 1.2, trailTriggerAtr: 1.1, trailLockAtr: 0.45 };
      }
      return null;
    }
  },

  // Model 4: 20 EMA Pullback with Strict Structural Target (TP=2.0 ATR, SL=1.2 ATR)
  {
    name: '4. 20 EMA Trend Pullback with Wide Target (TP=2.0 ATR, SL=1.2 ATR)',
    check: (b, prev, win) => {
      if (b.adx < 20) return null;
      const isGreen = b.close > b.open;
      const body = Math.abs(b.close - b.open);
      const lowerWick = Math.min(b.open, b.close) - b.low;
      const upperWick = b.high - Math.max(b.open, b.close);

      if (b.h1Close > b.h1Ema50 && b.ema20 > b.ema50 && b.close > b.ema20 && (b.low <= b.ema20 * 1.002 || prev.low <= b.ema20 * 1.002)) {
        if (isGreen && lowerWick >= body * 0.5 && b.rsi >= 46 && b.rsi <= 66) {
          return { side: 'BUY', tpAtr: 2.0, slAtr: 1.2, trailTriggerAtr: 1.3, trailLockAtr: 0.5 };
        }
      }

      if (b.h1Close < b.h1Ema50 && b.ema20 < b.ema50 && b.close < b.ema20 && (b.high >= b.ema20 * 0.998 || prev.high >= b.ema20 * 0.998)) {
        if (!isGreen && upperWick >= body * 0.5 && b.rsi <= 54 && b.rsi >= 34) {
          return { side: 'SELL', tpAtr: 2.0, slAtr: 1.2, trailTriggerAtr: 1.3, trailLockAtr: 0.5 };
        }
      }
      return null;
    }
  }
];

// Run backtest for each strategy across all coins with realistic fee accounting
for (const strat of testStrategies) {
  console.log(`\n========================================================================`);
  console.log(`📊 STRATEGY: ${strat.name}`);
  console.log(`========================================================================`);

  let grandWins = 0;
  let grandLosses = 0;
  let grandNetUSD = 0;

  for (const sym of SYMBOLS) {
    const bars = preBars.get(sym);
    if (!bars || bars.length < 100) continue;

    let wins = 0;
    let losses = 0;
    let netPnL = 0;

    for (let i = 25; i < bars.length - 16; i++) {
      const b = bars[i];
      const prev = bars[i - 1];
      const win = bars.slice(i - 25, i + 1);

      const setup = strat.check(b, prev, win);
      if (!setup) continue;

      const entryPrice = b.close;
      const targetPrice = setup.side === 'BUY' ? entryPrice + (setup.tpAtr * b.atr) : entryPrice - (setup.tpAtr * b.atr);
      let stopLossPrice = setup.side === 'BUY' ? entryPrice - (setup.slAtr * b.atr) : entryPrice + (setup.slAtr * b.atr);
      let trailLocked = false;

      // Position size: $2.50 max loss risk
      const slDist = Math.abs(entryPrice - stopLossPrice);
      const riskUSD = 2.50;
      const qty = riskUSD / slDist;
      const notional = qty * entryPrice;
      const feeRoundtrip = notional * 0.0012; // 0.06% taker fee each way = 0.12%

      let outcome: 'WIN' | 'LOSS' = 'LOSS';
      let tradeNet = -riskUSD - feeRoundtrip;

      for (let f = 1; f <= 16; f++) {
        const bar = bars[i + f];
        if (!bar) break;

        // Trailing lock
        if (setup.trailTriggerAtr && !trailLocked) {
          const move = setup.side === 'BUY' ? bar.high - entryPrice : entryPrice - bar.low;
          if (move >= setup.trailTriggerAtr * b.atr) {
            trailLocked = true;
            stopLossPrice = setup.side === 'BUY'
              ? entryPrice + (setup.trailLockAtr! * b.atr)
              : entryPrice - (setup.trailLockAtr! * b.atr);
          }
        }

        const isTP = setup.side === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
        const isSL = setup.side === 'BUY' ? bar.low <= stopLossPrice : bar.high >= stopLossPrice;

        if (isTP && !isSL) {
          const grossProfit = (setup.tpAtr * b.atr) * qty;
          tradeNet = grossProfit - feeRoundtrip;
          outcome = 'WIN';
          i += f;
          break;
        } else if (isSL) {
          if (trailLocked) {
            const grossProfit = (setup.trailLockAtr! * b.atr) * qty;
            tradeNet = grossProfit - feeRoundtrip;
            outcome = tradeNet > 0 ? 'WIN' : 'LOSS';
          } else {
            tradeNet = -riskUSD - feeRoundtrip;
            outcome = 'LOSS';
          }
          i += f;
          break;
        }
      }

      if (outcome === 'WIN') {
        wins++;
      } else {
        losses++;
      }
      netPnL += tradeNet;
    }

    const t = wins + losses;
    const wr = t > 0 ? ((wins / t) * 100).toFixed(1) : '0';
    console.log(`  🪙 ${sym.padEnd(8)}: Trades: ${t.toString().padEnd(4)} | Wins: ${wins.toString().padEnd(3)} | Losses: ${losses.toString().padEnd(3)} | Win Rate: ${wr}% | Net Profit: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);

    grandWins += wins;
    grandLosses += losses;
    grandNetUSD += netPnL;
  }

  const grandT = grandWins + grandLosses;
  const grandWR = grandT > 0 ? ((grandWins / grandT) * 100).toFixed(1) : '0';
  console.log(`------------------------------------------------------------------------`);
  console.log(`🏆 OVERALL: ${grandT} Trades | ${grandWins} Wins | ${grandLosses} Losses | Win Rate: ${grandWR}% | Net PnL: ${grandNetUSD >= 0 ? '+' : ''}$${grandNetUSD.toFixed(2)}`);
}
