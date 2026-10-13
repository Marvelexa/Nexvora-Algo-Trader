import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

const SYMBOLS = ['ADAUSD', 'SOLUSD', 'DOGEUSD', 'XRPUSD', 'AVAXUSD', 'SUIUSD', 'ETHUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): any[] {
  const file = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function load1hCandles(symbol: string): any[] {
  const file = path.join(CACHE_DIR, `${symbol}_1h_500.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

interface SetupCondition {
  name: string;
  check: (sym: string, window15m: any[], currentH1: any[]) => 'BUY' | 'SELL' | null;
}

const setups: SetupCondition[] = [
  // Setup 1: Institutional Trend Breakout (High Volume + Strong Body + 1H Alignment)
  {
    name: 'Institutional Trend Breakout (RVOL > 1.5x + ADX > 25 + 1H EMA50)',
    check: (sym, window15m, currentH1) => {
      const last = window15m[window15m.length - 1];
      const closes = window15m.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);
      if (adx < 25) return null;

      const avgVol20 = window15m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
      const rvol = avgVol20 > 0 ? last.volume / avgVol20 : 1.0;
      if (rvol < 1.4) return null;

      const range = last.high - last.low;
      const body = Math.abs(last.close - last.open);
      if (range <= 0 || body / range < 0.55) return null; // Must be strong body

      // 1H trend
      if (currentH1.length >= 20) {
        const h1Closes = currentH1.map(c => c.close);
        const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50).slice(-1)[0];
        if (last.close > ema20 && ema20 > ema50 && last.close > last.open && last.close > h1Ema50) return 'BUY';
        if (last.close < ema20 && ema20 < ema50 && last.close < last.open && last.close < h1Ema50) return 'SELL';
      }
      return null;
    }
  },

  // Setup 2: Pullback Bounce / Rejection off 20 EMA in Strong Trend (Trend Continuation)
  {
    name: '20 EMA Trend Pullback Rejection (Trending Market Bounce)',
    check: (sym, window15m, currentH1) => {
      const last = window15m[window15m.length - 1];
      const prev = window15m[window15m.length - 2];
      const closes = window15m.map(c => c.close);
      const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
      const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
      const ema20 = ema20Arr.slice(-1)[0];
      const ema50 = ema50Arr.slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);
      if (adx < 22) return null;

      const rsiArr = CryptoDedicatedStrategyEngine.calculateRSI(closes, 14);
      const rsi = rsiArr.slice(-1)[0];

      // Bullish pullback: Trend is Bullish (EMA20 > EMA50), low of candle dipped near EMA20, closed GREEN above EMA20
      if (ema20 > ema50 && last.low <= ema20 * 1.002 && last.close > last.open && last.close > ema20 && rsi >= 45 && rsi <= 65) {
        const lowerWick = Math.min(last.open, last.close) - last.low;
        const body = Math.abs(last.close - last.open);
        if (lowerWick >= body * 0.8) return 'BUY'; // Hammer / rejection wick at EMA20
      }

      // Bearish pullback: Trend is Bearish (EMA20 < EMA50), high of candle tested EMA20, closed RED below EMA20
      if (ema20 < ema50 && last.high >= ema20 * 0.998 && last.close < last.open && last.close < ema20 && rsi <= 55 && rsi >= 35) {
        const upperWick = last.high - Math.max(last.open, last.close);
        const body = Math.abs(last.close - last.open);
        if (upperWick >= body * 0.8) return 'SELL'; // Shooting star / rejection wick at EMA20
      }

      return null;
    }
  },

  // Setup 3: Multi-Bar Donchian Breakout + SuperTrend Momentum
  {
    name: '20-Period High/Low Donchian Breakout with ADX Momentum',
    check: (sym, window15m, currentH1) => {
      const last = window15m[window15m.length - 1];
      const prior20 = window15m.slice(-21, -1);
      if (prior20.length < 20) return null;

      const high20 = Math.max(...prior20.map(c => c.high));
      const low20 = Math.min(...prior20.map(c => c.low));

      const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);
      if (adx < 22) return null;

      if (last.close > high20 && last.close > last.open) return 'BUY';
      if (last.close < low20 && last.close < last.open) return 'SELL';

      return null;
    }
  },

  // Setup 4: RSI Momentum Divergence Reversal (Counter-Trend Sniping at Extreme Exhaustion)
  {
    name: 'RSI Reversal Divergence (Exhaustion Sniping)',
    check: (sym, window15m, currentH1) => {
      const closes = window15m.map(c => c.close);
      const rsiArr = CryptoDedicatedStrategyEngine.calculateRSI(closes, 14);
      const div = CryptoDedicatedStrategyEngine.detectRsiDivergence(window15m, closes, rsiArr);
      const last = window15m[window15m.length - 1];

      if (div === 'BULLISH_DIV' && last.close > last.open) return 'BUY';
      if (div === 'BEARISH_DIV' && last.close < last.open) return 'SELL';

      return null;
    }
  }
];

async function runSetupComparison() {
  console.log(`========================================================================`);
  console.log(`🏆 SEARCHING FOR HIGH WIN-RATE STRATEGY SETUPS ON 2,500 CANDLES`);
  console.log(`========================================================================\n`);

  for (const setup of setups) {
    let totalSignals = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalGrossGain = 0;
    let totalGrossLoss = 0;

    for (const sym of SYMBOLS) {
      const bars = loadCandles(sym);
      const h1Bars = load1hCandles(sym);
      if (bars.length < 100) continue;

      for (let i = 50; i < bars.length - 12; i++) {
        const window15m = bars.slice(i - 50, i + 1);
        const current = window15m[window15m.length - 1];
        const currentH1 = h1Bars.filter((b: any) => b.time <= current.time).slice(-50);

        const sig = setup.check(sym, window15m, currentH1);
        if (!sig) continue;

        totalSignals++;

        // Outcome over next 12 bars (SL = 0.9x ATR, TP = 2.0x ATR)
        const atr = CryptoDedicatedStrategyEngine.calculateATR(window15m, 14) || current.close * 0.01;
        const slDist = atr * 0.9;
        const tpDist = atr * 2.0;

        const forward = bars.slice(i + 1, i + 13);
        let resolved = false;

        for (const fb of forward) {
          const isTP = sig === 'BUY' ? fb.high >= current.close + tpDist : fb.low <= current.close - tpDist;
          const isSL = sig === 'BUY' ? fb.low <= current.close - slDist : fb.high >= current.close + slDist;

          if (isTP && !isSL) {
            totalWins++;
            totalGrossGain += 2.0;
            resolved = true;
            break;
          }
          if (isSL && !isTP) {
            totalLosses++;
            totalGrossLoss += 0.9;
            resolved = true;
            break;
          }
          if (isTP && isSL) {
            totalLosses++;
            totalGrossLoss += 0.9;
            resolved = true;
            break;
          }
        }

        if (!resolved) {
          // If neither hit in 3 hours, evaluate close
          const lastFb = forward[forward.length - 1];
          const diff = sig === 'BUY' ? (lastFb.close - current.close) : (current.close - lastFb.close);
          if (diff > 0) {
            totalWins++;
            totalGrossGain += (diff / atr);
          } else {
            totalLosses++;
            totalGrossLoss += Math.abs(diff / atr);
          }
        }
      }
    }

    const wr = totalSignals > 0 ? ((totalWins / totalSignals) * 100).toFixed(1) : '0';
    const profitFactor = totalGrossLoss > 0 ? (totalGrossGain / totalGrossLoss).toFixed(2) : '99.0';

    console.log(`------------------------------------------------------------------------`);
    console.log(`📌 SETUP: ${setup.name}`);
    console.log(`   Signals: ${totalSignals} | Win Rate: ${wr}% (${totalWins}W / ${totalLosses}L) | Profit Factor: ${profitFactor}`);
    console.log(`   Expected Value: +$${((totalGrossGain - totalGrossLoss) / (totalSignals || 1)).toFixed(2)} R per trade`);
  }
}

runSetupComparison().catch(console.error);
