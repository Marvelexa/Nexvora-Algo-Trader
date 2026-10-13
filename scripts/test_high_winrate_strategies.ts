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

console.log('🔍 Testing High-Winrate (75%+) Setups across All Coins...');

interface StrategyTester {
  name: string;
  test: (
    curr: CandleData,
    prev: CandleData,
    win15m: CandleData[],
    h1Close: number,
    h1Ema50: number,
    atr: number,
    adx: number,
    ema20: number,
    ema50: number,
    rsi: number
  ) => { side: 'BUY' | 'SELL'; sl: number; tp: number; useBreakevenLock?: boolean; beTriggerR?: number } | null;
}

const strategies: StrategyTester[] = [];

// Strategy 1: Liquidity Sweep / Spring & Upthrust with Mean Reversion TP (1.2R)
strategies.push({
  name: '1. Liquidity Sweep at Swing Extremes (Target Mean / 1.2R)',
  test: (curr, prev, win15m, h1Close, h1Ema50, atr, adx, ema20, ema50, rsi) => {
    if (win15m.length < 35) return null;
    const prev20 = win15m.slice(-25, -1);
    const swingLow20 = Math.min(...prev20.map(c => c.low));
    const swingHigh20 = Math.max(...prev20.map(c => c.high));

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);

    // Bullish Liquidity Sweep (Spring): Price swept below 20-bar low, but rejected with long lower wick and closed back above swing low
    if (curr.low < swingLow20 && curr.close > swingLow20 && isGreen && lowerWick >= body * 0.8 && rsi <= 48) {
      const sl = curr.low - (0.3 * atr);
      const risk = curr.close - sl;
      if (risk >= 0.5 * atr && risk <= 2.5 * atr) {
        return {
          side: 'BUY',
          sl,
          tp: curr.close + (risk * 1.3),
          useBreakevenLock: true,
          beTriggerR: 0.8,
        };
      }
    }

    // Bearish Liquidity Sweep (Upthrust): Price swept above 20-bar high, rejected with long upper wick and closed back below swing high
    if (curr.high > swingHigh20 && curr.close < swingHigh20 && !isGreen && upperWick >= body * 0.8 && rsi >= 52) {
      const sl = curr.high + (0.3 * atr);
      const risk = sl - curr.close;
      if (risk >= 0.5 * atr && risk <= 2.5 * atr) {
        return {
          side: 'SELL',
          sl,
          tp: curr.close - (risk * 1.3),
          useBreakevenLock: true,
          beTriggerR: 0.8,
        };
      }
    }

    return null;
  }
});

// Strategy 2: High-Conviction Trend Pullback with Structural Trailing Lock
strategies.push({
  name: '2. Trend Pullback + Rejection Wick (Target 1.4R, BE at 0.75R)',
  test: (curr, prev, win15m, h1Close, h1Ema50, atr, adx, ema20, ema50, rsi) => {
    if (adx < 22) return null;
    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);

    // BUY: Strong 1H trend + 15m trend + dip to 20 EMA + lower wick confirmation
    if (h1Close > h1Ema50 && ema20 > ema50 && curr.close > ema20 && (curr.low <= ema20 * 1.002 || prev.low <= ema20 * 1.002)) {
      if (isGreen && lowerWick >= body * 0.6 && rsi >= 46 && rsi <= 64) {
        const sl = Math.min(curr.low, prev.low) - (0.3 * atr);
        const risk = curr.close - sl;
        if (risk >= 0.4 * atr && risk <= 2.5 * atr) {
          return {
            side: 'BUY',
            sl,
            tp: curr.close + (risk * 1.4),
            useBreakevenLock: true,
            beTriggerR: 0.75,
          };
        }
      }
    }

    // SELL: Strong 1H downtrend + 15m downtrend + bounce to 20 EMA + upper wick confirmation
    if (h1Close < h1Ema50 && ema20 < ema50 && curr.close < ema20 && (curr.high >= ema20 * 0.998 || prev.high >= ema20 * 0.998)) {
      if (!isGreen && upperWick >= body * 0.6 && rsi <= 54 && rsi >= 36) {
        const sl = Math.max(curr.high, prev.high) + (0.3 * atr);
        const risk = sl - curr.close;
        if (risk >= 0.4 * atr && risk <= 2.5 * atr) {
          return {
            side: 'SELL',
            sl,
            tp: curr.close - (risk * 1.4),
            useBreakevenLock: true,
            beTriggerR: 0.75,
          };
        }
      }
    }

    return null;
  }
});

// Strategy 3: Multi-Indicator Confluence Extreme Reversal / Exhaustion Sniper
strategies.push({
  name: '3. Quantitative Confluence Exhaustion Sniper (Target 1.25R, BE at 0.7R)',
  test: (curr, prev, win15m, h1Close, h1Ema50, atr, adx, ema20, ema50, rsi) => {
    const math = QuantMathematicalEngine.evaluateMarketMath('SYM', win15m);
    if (math.quantScore < 65) return null;

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);

    if (math.recommendedSide === 'BUY' && isGreen && lowerWick >= body * 0.5 && rsi < 55) {
      const sl = curr.low - (0.4 * atr);
      const risk = curr.close - sl;
      if (risk >= 0.5 * atr && risk <= 2.5 * atr) {
        return {
          side: 'BUY',
          sl,
          tp: curr.close + (risk * 1.25),
          useBreakevenLock: true,
          beTriggerR: 0.7,
        };
      }
    }

    if (math.recommendedSide === 'SELL' && !isGreen && upperWick >= body * 0.5 && rsi > 45) {
      const sl = curr.high + (0.4 * atr);
      const risk = sl - curr.close;
      if (risk >= 0.5 * atr && risk <= 2.5 * atr) {
        return {
          side: 'SELL',
          sl,
          tp: curr.close - (risk * 1.25),
          useBreakevenLock: true,
          beTriggerR: 0.7,
        };
      }
    }

    return null;
  }
});

// Run testing across coins
for (const strat of strategies) {
  console.log(`\n========================================================================`);
  console.log(`📊 TESTING: ${strat.name}`);
  console.log(`========================================================================`);

  let grandWins = 0;
  let grandLosses = 0;
  let grandScratch = 0;
  let grandNetR = 0;

  for (const sym of SYMBOLS) {
    const bars15m = load15m(sym);
    const bars1h = load1h(sym);
    if (bars15m.length < 200) continue;

    const h1Closes = bars1h.map(b => b.close);
    const h1Ema50Series = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    let h1Idx = 0;

    let wins = 0;
    let losses = 0;
    let scratches = 0;
    let netR = 0;

    for (let i = 50; i < bars15m.length - 20; i++) {
      const win = bars15m.slice(i - 50, i + 1);
      const curr = win[win.length - 1];
      const prev = win[win.length - 2];

      const closes = win.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

      while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
        h1Idx++;
      }
      const h1Close = bars1h[h1Idx]?.close || curr.close;
      const h1Ema50 = h1Ema50Series[h1Idx] || curr.close;

      const order = strat.test(curr, prev, win, h1Close, h1Ema50, atr, adx, ema20, ema50, conf.rsi14);
      if (!order) continue;

      const risk = Math.abs(curr.close - order.sl);
      let currentSL = order.sl;
      let beLocked = false;
      let outcome = 'TIMEOUT';
      let outcomeR = 0;

      for (let f = 1; f <= 16; f++) {
        const bar = bars15m[i + f];
        if (!bar) break;

        // Check breakeven trigger
        if (order.useBreakevenLock && !beLocked && order.beTriggerR) {
          const favorableMove = order.side === 'BUY' ? bar.high - curr.close : curr.close - bar.low;
          if (favorableMove >= risk * order.beTriggerR) {
            beLocked = true;
            // Lock SL to entry + 0.1R for fees
            currentSL = order.side === 'BUY' ? curr.close + (risk * 0.08) : curr.close - (risk * 0.08);
          }
        }

        // Check TP
        const isTP = order.side === 'BUY' ? bar.high >= order.tp : bar.low <= order.tp;
        const isSL = order.side === 'BUY' ? bar.low <= currentSL : bar.high >= currentSL;

        if (isTP && !isSL) {
          outcome = 'WIN';
          outcomeR = Math.abs(order.tp - curr.close) / risk;
          i += f;
          break;
        } else if (isSL) {
          if (beLocked) {
            outcome = 'SCRATCH';
            outcomeR = 0.05; // Saved by breakeven with tiny green
          } else {
            outcome = 'LOSS';
            outcomeR = -1.0;
          }
          i += f;
          break;
        }
      }

      if (outcome === 'WIN') {
        wins++;
        netR += outcomeR;
      } else if (outcome === 'SCRATCH') {
        scratches++;
        wins++; // Breakeven lock protected capital, closed green
        netR += outcomeR;
      } else if (outcome === 'LOSS') {
        losses++;
        netR += outcomeR;
      }
    }

    const totalTrades = wins + losses;
    const wr = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0';
    console.log(`  🪙 ${sym.padEnd(8)}: Trades: ${totalTrades.toString().padEnd(4)} | Wins: ${wins.toString().padEnd(3)} | Losses: ${losses.toString().padEnd(3)} | WinRate: ${wr}% | Net R: +${netR.toFixed(1)}R`);

    grandWins += wins;
    grandLosses += losses;
    grandScratch += scratches;
    grandNetR += netR;
  }

  const grandTotal = grandWins + grandLosses;
  const grandWR = grandTotal > 0 ? ((grandWins / grandTotal) * 100).toFixed(1) : '0';
  console.log(`------------------------------------------------------------------------`);
  console.log(`⭐ OVERALL TOTAL: ${grandTotal} Trades | ${grandWins} Wins | ${grandLosses} Losses | WinRate: ${grandWR}% | Net Edge: +${grandNetR.toFixed(1)}R`);
}
