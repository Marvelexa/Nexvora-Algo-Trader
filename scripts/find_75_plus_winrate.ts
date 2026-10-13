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

interface TestSetup {
  name: string;
  evaluate: (
    c: CandleData,
    prev: CandleData,
    win: CandleData[],
    h1Close: number,
    h1Ema20: number,
    h1Ema50: number,
    atr: number,
    adx: number,
    rsi: number
  ) => { side: 'BUY' | 'SELL'; tpDist: number; slDist: number; beDist?: number } | null;
}

const setups: TestSetup[] = [
  // Setup A: Asymmetric High-Probability Mean Reversion (Bollinger 2.5 SD + RSI Extreme Rejection)
  {
    name: 'A. Bollinger Band 2.5 SD Extreme Reversal (TP=1.2 ATR, SL=1.8 ATR)',
    evaluate: (c, prev, win, h1C, h1E20, h1E50, atr, adx, rsi) => {
      if (win.length < 25) return null;
      const closes = win.map(b => b.close);
      const mean = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const variance = closes.slice(-20).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
      const stdDev = Math.sqrt(variance);
      const upperBB = mean + (2.5 * stdDev);
      const lowerBB = mean - (2.5 * stdDev);

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      // Oversold Bounce
      if (c.low <= lowerBB && c.close > lowerBB && isGreen && lowerWick >= body * 0.7 && rsi <= 32) {
        return { side: 'BUY', tpDist: atr * 1.2, slDist: atr * 1.8, beDist: atr * 0.7 };
      }

      // Overbought Rejection
      if (c.high >= upperBB && c.close < upperBB && !isGreen && upperWick >= body * 0.7 && rsi >= 68) {
        return { side: 'SELL', tpDist: atr * 1.2, slDist: atr * 1.8, beDist: atr * 0.7 };
      }

      return null;
    }
  },

  // Setup B: Strict 3-Screen Institutional Trend Pullback with Structural Invalidation
  {
    name: 'B. 3-Screen Trend Pullback Sniper (TP=1.3 ATR, SL=1.5 ATR)',
    evaluate: (c, prev, win, h1C, h1E20, h1E50, atr, adx, rsi) => {
      if (win.length < 35 || adx < 24) return null;
      const closes = win.map(b => b.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      // BUY: 1H in strong uptrend (Close > EMA20 > EMA50), 15m EMA20 > EMA50, dipped to EMA20 and strongly rejected
      if (h1C > h1E20 && h1E20 > h1E50 && ema20 > ema50 && c.close > ema20 && (c.low <= ema20 * 1.001 || prev.low <= ema20 * 1.001)) {
        if (isGreen && lowerWick >= body * 0.8 && rsi >= 48 && rsi <= 62) {
          return { side: 'BUY', tpDist: atr * 1.3, slDist: atr * 1.5, beDist: atr * 0.8 };
        }
      }

      // SELL: 1H in strong downtrend (Close < EMA20 < EMA50), 15m EMA20 < EMA50, bounced to EMA20 and strongly rejected
      if (h1C < h1E20 && h1E20 < h1E50 && ema20 < ema50 && c.close < ema20 && (c.high >= ema20 * 0.999 || prev.high >= ema20 * 0.999)) {
        if (!isGreen && upperWick >= body * 0.8 && rsi <= 52 && rsi >= 38) {
          return { side: 'SELL', tpDist: atr * 1.3, slDist: atr * 1.5, beDist: atr * 0.8 };
        }
      }

      return null;
    }
  },

  // Setup C: Institutional Liquidity Sweep & Stop Hunt Reversal (Turtle Soup)
  {
    name: 'C. Institutional Liquidity Sweep Turtle Soup (TP=1.1 ATR, SL=1.4 ATR)',
    evaluate: (c, prev, win, h1C, h1E20, h1E50, atr, adx, rsi) => {
      if (win.length < 35) return null;
      const prev30 = win.slice(-30, -1);
      const lowest30 = Math.min(...prev30.map(b => b.low));
      const highest30 = Math.max(...prev30.map(b => b.high));

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      // Bullish Stop Hunt: swept lowest 30, but closed green well above it with huge lower wick
      if (c.low < lowest30 && c.close > lowest30 + (0.15 * atr) && isGreen && lowerWick >= body * 1.0 && rsi < 45) {
        return { side: 'BUY', tpDist: atr * 1.1, slDist: atr * 1.4, beDist: atr * 0.7 };
      }

      // Bearish Stop Hunt: swept highest 30, but closed red well below it with huge upper wick
      if (c.high > highest30 && c.close < highest30 - (0.15 * atr) && !isGreen && upperWick >= body * 1.0 && rsi > 55) {
        return { side: 'SELL', tpDist: atr * 1.1, slDist: atr * 1.4, beDist: atr * 0.7 };
      }

      return null;
    }
  },

  // Setup D: Volume Climax Reversal at Support/Resistance (Absorption Pin Bar)
  {
    name: 'D. Volume Climax S/R Absorption Pin Bar (TP=1.2 ATR, SL=1.5 ATR)',
    evaluate: (c, prev, win, h1C, h1E20, h1E50, atr, adx, rsi) => {
      if (win.length < 30) return null;
      const volumes = win.slice(-21, -1).map(b => b.volume);
      const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const rvol = c.volume / avgVol;

      if (rvol < 1.4) return null; // High volume climax only

      const isGreen = c.close > c.open;
      const body = Math.abs(c.close - c.open);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      // High volume absorption at swing low
      if (isGreen && lowerWick >= body * 1.2 && rsi <= 40) {
        return { side: 'BUY', tpDist: atr * 1.2, slDist: atr * 1.5, beDist: atr * 0.75 };
      }

      // High volume absorption at swing high
      if (!isGreen && upperWick >= body * 1.2 && rsi >= 60) {
        return { side: 'SELL', tpDist: atr * 1.2, slDist: atr * 1.5, beDist: atr * 0.75 };
      }

      return null;
    }
  }
];

// Run evaluation on all setups across all 6 coins
console.log('🏁 COMMENCING 75%+ WINRATE QUANTITATIVE AUDIT...\n');

for (const setup of setups) {
  console.log(`========================================================================`);
  console.log(`🧪 EVALUATING: ${setup.name}`);
  console.log(`========================================================================`);

  let totalWins = 0;
  let totalLosses = 0;
  let coinReports: any[] = [];

  for (const sym of SYMBOLS) {
    const bars15m = load15m(sym);
    const bars1h = load1h(sym);
    if (bars15m.length < 200) continue;

    const h1Closes = bars1h.map(b => b.close);
    const h1Ema20 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 20);
    const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    let h1Idx = 0;

    let wins = 0;
    let losses = 0;
    let netGrossPnL = 0;

    for (let i = 50; i < bars15m.length - 20; i++) {
      const win = bars15m.slice(i - 50, i + 1);
      const curr = win[win.length - 1];
      const prev = win[win.length - 2];

      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

      while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
        h1Idx++;
      }
      const h1C = bars1h[h1Idx]?.close || curr.close;
      const h1E20 = h1Ema20[h1Idx] || curr.close;
      const h1E50 = h1Ema50[h1Idx] || curr.close;

      const order = setup.evaluate(curr, prev, win, h1C, h1E20, h1E50, atr, adx, conf.rsi14);
      if (!order) continue;

      let entryPrice = curr.close;
      let targetPrice = order.side === 'BUY' ? entryPrice + order.tpDist : entryPrice - order.tpDist;
      let stopLossPrice = order.side === 'BUY' ? entryPrice - order.slDist : entryPrice + order.slDist;
      let beTriggered = false;

      let tradeResult = 'TIMEOUT';

      for (let f = 1; f <= 16; f++) {
        const bar = bars15m[i + f];
        if (!bar) break;

        // Check breakeven trigger
        if (order.beDist && !beTriggered) {
          const move = order.side === 'BUY' ? bar.high - entryPrice : entryPrice - bar.low;
          if (move >= order.beDist) {
            beTriggered = true;
            // Lock SL to breakeven + tiny profit (0.05 ATR)
            stopLossPrice = order.side === 'BUY' ? entryPrice + (0.05 * atr) : entryPrice - (0.05 * atr);
          }
        }

        const hitTP = order.side === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
        const hitSL = order.side === 'BUY' ? bar.low <= stopLossPrice : bar.high >= stopLossPrice;

        if (hitTP && !hitSL) {
          tradeResult = 'WIN';
          i += f;
          break;
        } else if (hitSL) {
          tradeResult = beTriggered ? 'WIN_BE' : 'LOSS';
          i += f;
          break;
        }
      }

      if (tradeResult === 'WIN' || tradeResult === 'WIN_BE') {
        wins++;
        netGrossPnL += order.tpDist / atr;
      } else if (tradeResult === 'LOSS') {
        losses++;
        netGrossPnL -= order.slDist / atr;
      }
    }

    const trades = wins + losses;
    const wr = trades > 0 ? ((wins / trades) * 100).toFixed(1) : '0';
    coinReports.push({ sym, trades, wins, losses, wr: parseFloat(wr) });
    totalWins += wins;
    totalLosses += losses;
  }

  for (const rep of coinReports) {
    const star = rep.wr >= 75.0 ? '🎯' : (rep.wr >= 65.0 ? '✅' : '❌');
    console.log(`  ${star} ${rep.sym.padEnd(8)}: Trades: ${rep.trades.toString().padEnd(3)} | Wins: ${rep.wins.toString().padEnd(3)} | Losses: ${rep.losses.toString().padEnd(3)} | Win Rate: ${rep.wr}%`);
  }

  const grandTotal = totalWins + totalLosses;
  const grandWR = grandTotal > 0 ? ((totalWins / grandTotal) * 100).toFixed(1) : '0';
  console.log(`------------------------------------------------------------------------`);
  console.log(`🏆 OVERALL: ${grandTotal} Trades | ${totalWins} Wins | ${totalLosses} Losses | Win Rate: ${grandWR}%\n`);
}
