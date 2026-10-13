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
const SYMBOLS = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'ETHUSD', 'ADAUSD', 'AVAXUSD'];

function load15m(sym: string): CandleData[] {
  const f5k = path.join(CACHE_DIR, `${sym}_15m_5000.json`);
  if (fs.existsSync(f5k)) return JSON.parse(fs.readFileSync(f5k, 'utf-8'));
  const f2k = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (fs.existsSync(f2k)) return JSON.parse(fs.readFileSync(f2k, 'utf-8'));
  return [];
}

function load1h(sym: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${sym}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  const f500 = path.join(CACHE_DIR, `${sym}_1h_500.json`);
  if (fs.existsSync(f500)) return JSON.parse(fs.readFileSync(f500, 'utf-8'));
  return [];
}

interface StrategyTest {
  name: string;
  check: (
    c: CandleData,
    prev: CandleData,
    win: CandleData[],
    h1Close: number,
    h1Ema50: number,
    atr: number,
    rsi: number
  ) => { side: 'BUY' | 'SELL'; tpDist: number; slDist: number } | null;
}

const strategies: StrategyTest[] = [
  // Model 1: Oversold Support Bounce / Overbought Resistance Fade (Mean Reversion to 20 EMA)
  {
    name: '1. S/R Mean Reversion Fade (TP=1.0 ATR, SL=1.5 ATR)',
    check: (c, prev, win, h1C, h1E50, atr, rsi) => {
      if (win.length < 30) return null;
      const closes = win.map(b => b.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const prev25 = win.slice(-26, -1);
      const min25 = Math.min(...prev25.map(x => x.low));
      const max25 = Math.max(...prev25.map(x => x.high));

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      // BUY at Support Bounce with long lower wick and RSI <= 32
      if (c.low <= min25 && c.close > min25 && isGreen && lowerWick >= body * 0.9 && rsi <= 32) {
        const tp = Math.min(ema20 - c.close, 1.2 * atr);
        if (tp >= 0.8 * atr) {
          return { side: 'BUY', tpDist: tp, slDist: 1.5 * atr };
        }
      }

      // SELL at Resistance Rejection with long upper wick and RSI >= 68
      if (c.high >= max25 && c.close < max25 && !isGreen && upperWick >= body * 0.9 && rsi >= 68) {
        const tp = Math.min(c.close - ema20, 1.2 * atr);
        if (tp >= 0.8 * atr) {
          return { side: 'SELL', tpDist: tp, slDist: 1.5 * atr };
        }
      }

      return null;
    }
  },

  // Model 2: Ultra-Selective High-Conviction Confluence (4-Indicator Agreement)
  {
    name: '2. 4-Indicator Confluence Sniper (TP=1.4 ATR, SL=1.2 ATR)',
    check: (c, prev, win, h1C, h1E50, atr, rsi) => {
      if (win.length < 35) return null;
      const closes = win.map(b => b.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

      if (adx < 25) return null;

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      // BUY: 1H Uptrend + 15m EMA20 > EMA50 + Price Pullback touched EMA20 + Green Conviction Candle + RSI 48-62
      if (h1C > h1E50 && ema20 > ema50 && c.close > ema20 && prev.low <= ema20 * 1.001) {
        if (isGreen && lowerWick >= body * 0.8 && rsi >= 48 && rsi <= 62) {
          return { side: 'BUY', tpDist: 1.4 * atr, slDist: 1.2 * atr };
        }
      }

      // SELL: 1H Downtrend + 15m EMA20 < EMA50 + Price Pullback touched EMA20 + Red Conviction Candle + RSI 38-52
      if (h1C < h1E50 && ema20 < ema50 && c.close < ema20 && prev.high >= ema20 * 0.999) {
        if (!isGreen && upperWick >= body * 0.8 && rsi <= 52 && rsi >= 38) {
          return { side: 'SELL', tpDist: 1.4 * atr, slDist: 1.2 * atr };
        }
      }

      return null;
    }
  },

  // Model 3: Parabolic Exhaustion Reversal (3 Consecutive Extreme Expansion Bars + Volume Climax)
  {
    name: '3. Parabolic Exhaustion Climax (TP=1.2 ATR, SL=1.5 ATR)',
    check: (c, prev, win, h1C, h1E50, atr, rsi) => {
      if (win.length < 30) return null;
      const prev2 = win[win.length - 3];
      const prev1 = prev;

      const vols = win.slice(-21, -1).map(b => b.volume);
      const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
      if (c.volume < avgVol * 1.5) return null; // Climax volume

      // Dump exhaustion: 3 red bars falling fast, RSI < 25, current bar has huge lower wick (absorption)
      const isRed1 = prev2.close < prev2.open;
      const isRed2 = prev1.close < prev1.open;
      const isGreen = c.close > c.open;
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const body = Math.abs(c.close - c.open);

      if (isRed1 && isRed2 && lowerWick >= body * 1.2 && rsi <= 25) {
        return { side: 'BUY', tpDist: 1.2 * atr, slDist: 1.5 * atr };
      }

      // Pump exhaustion: 3 green bars rising fast, RSI > 75, current bar has huge upper wick
      const isGreen1 = prev2.close > prev2.open;
      const isGreen2 = prev1.close > prev1.open;
      const upperWick = c.high - Math.max(c.open, c.close);

      if (isGreen1 && isGreen2 && upperWick >= body * 1.2 && rsi >= 75) {
        return { side: 'SELL', tpDist: 1.2 * atr, slDist: 1.5 * atr };
      }

      return null;
    }
  }
];

console.log('⚡ Running TRUE Net Accounting Win-Rate Audit (Accounting for All Taker Fees)...');

for (const strat of strategies) {
  console.log(`\n========================================================================`);
  console.log(`🧪 TESTING: ${strat.name}`);
  console.log(`========================================================================`);

  let grandWins = 0;
  let grandLosses = 0;
  let grandNetUSD = 0;

  for (const sym of SYMBOLS) {
    const b15 = load15m(sym);
    const b1h = load1h(sym);
    if (b15.length < 200) continue;

    const h1Closes = b1h.map(b => b.close);
    const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    let h1Idx = 0;

    let wins = 0;
    let losses = 0;
    let netPnL = 0;

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

      const setup = strat.check(c, prev, win, h1C, h1E, atr, conf.rsi14);
      if (!setup) continue;

      const entryPrice = c.close;
      const tpPrice = setup.side === 'BUY' ? entryPrice + setup.tpDist : entryPrice - setup.tpDist;
      const slPrice = setup.side === 'BUY' ? entryPrice - setup.slDist : entryPrice + setup.slDist;

      // Position sizing: $2.50 risk
      const riskUSD = 2.50;
      const slDistance = Math.abs(entryPrice - slPrice);
      const qty = riskUSD / slDistance;
      const notional = qty * entryPrice;
      const fee = notional * 0.0012; // 0.12% roundtrip taker fee

      let won = false;
      let resolved = false;

      for (let f = 1; f <= 16; f++) {
        const bar = b15[i + f];
        if (!bar) break;

        const isTP = setup.side === 'BUY' ? bar.high >= tpPrice : bar.low <= tpPrice;
        const isSL = setup.side === 'BUY' ? bar.low <= slPrice : bar.high >= slPrice;

        if (isTP && !isSL) {
          won = true;
          resolved = true;
          i += f;
          break;
        } else if (isSL) {
          won = false;
          resolved = true;
          i += f;
          break;
        }
      }

      if (resolved) {
        if (won) {
          const grossProfit = setup.tpDist * qty;
          const netTrade = grossProfit - fee;
          if (netTrade > 0) {
            wins++;
          } else {
            losses++;
          }
          netPnL += netTrade;
        } else {
          losses++;
          netPnL += (-riskUSD - fee);
        }
      }
    }

    const totalTrades = wins + losses;
    const wr = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0';
    console.log(`  🪙 ${sym.padEnd(8)}: Trades: ${totalTrades.toString().padEnd(3)} | Wins: ${wins.toString().padEnd(3)} | Losses: ${losses.toString().padEnd(3)} | Real Win Rate: ${wr}% | Net Profit: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);

    grandWins += wins;
    grandLosses += losses;
    grandNetUSD += netPnL;
  }

  const grandTotal = grandWins + grandLosses;
  const grandWR = grandTotal > 0 ? ((grandWins / grandTotal) * 100).toFixed(1) : '0';
  console.log(`------------------------------------------------------------------------`);
  console.log(`🏆 OVERALL: ${grandTotal} Trades | ${grandWins} Wins | ${grandLosses} Losses | Real Win Rate: ${grandWR}% | Net PnL: ${grandNetUSD >= 0 ? '+' : ''}$${grandNetUSD.toFixed(2)}`);
}
