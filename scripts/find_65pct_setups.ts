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
const SYMBOLS = ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'SOLUSD', 'ETHUSD'];

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

console.log('🔍 Searching 6,000 candles for 60%+ win rate setups...');

interface SetupRule {
  name: string;
  check: (
    curr: CandleData,
    prev: CandleData,
    prev2: CandleData,
    win: CandleData[],
    h1Close: number,
    h1Ema50: number,
    atr: number,
    adx: number,
    ema20: number,
    ema50: number,
    rsi: number
  ) => { side: 'BUY' | 'SELL'; slDist: number; tpDist: number } | null;
}

const rules: SetupRule[] = [
  // 1. High-Volume Institutional Engulfing with 1H Trend
  {
    name: '1. High-Volume Bullish/Bearish Engulfing with 1H Trend',
    check: (curr, prev, prev2, win, h1C, h1E50, atr, adx, e20, e50, rsi) => {
      if (adx < 22) return null;
      const avgVol = win.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
      if (curr.volume < avgVol * 1.3) return null;

      // Bullish Engulfing in Uptrend
      if (h1C > h1E50 && e20 > e50 && curr.close > e20 && !prev.close > prev.open) {
        if (curr.close > curr.open && curr.open <= prev.close && curr.close >= prev.open) {
          const body = curr.close - curr.open;
          if (body >= atr * 0.5 && rsi >= 48 && rsi <= 68) {
            const sl = Math.min(curr.low, prev.low) - 0.2 * atr;
            const risk = curr.close - sl;
            if (risk >= 0.5 * atr && risk <= 2.0 * atr) {
              return { side: 'BUY', slDist: risk, tpDist: risk * 1.8 };
            }
          }
        }
      }

      // Bearish Engulfing in Downtrend
      if (h1C < h1E50 && e20 < e50 && curr.close < e20 && prev.close > prev.open) {
        if (curr.close < curr.open && curr.open >= prev.close && curr.close <= prev.open) {
          const body = curr.open - curr.close;
          if (body >= atr * 0.5 && rsi <= 52 && rsi >= 32) {
            const sl = Math.max(curr.high, prev.high) + 0.2 * atr;
            const risk = sl - curr.close;
            if (risk >= 0.5 * atr && risk <= 2.0 * atr) {
              return { side: 'SELL', slDist: risk, tpDist: risk * 1.8 };
            }
          }
        }
      }
      return null;
    }
  },

  // 2. Three Bar Continuation Expansion (Section 4.3 in Playbook)
  {
    name: '2. Three Bar Momentum Expansion (3 Consecutive Conviction Bars)',
    check: (curr, prev, prev2, win, h1C, h1E50, atr, adx, e20, e50, rsi) => {
      if (adx < 25) return null;

      // Bullish 3 Bars
      if (h1C > h1E50 && e20 > e50 && curr.close > e20) {
        const c1Green = prev2.close > prev2.open;
        const c2Green = prev.close > prev.open;
        const c3Green = curr.close > curr.open;
        if (c1Green && c2Green && c3Green && curr.close > prev.close && prev.close > prev2.close) {
          if (rsi >= 52 && rsi <= 66) {
            const sl = prev.low - 0.2 * atr;
            const risk = curr.close - sl;
            if (risk >= 0.6 * atr && risk <= 2.2 * atr) {
              return { side: 'BUY', slDist: risk, tpDist: risk * 1.6 };
            }
          }
        }
      }

      // Bearish 3 Bars
      if (h1C < h1E50 && e20 < e50 && curr.close < e20) {
        const c1Red = prev2.close < prev2.open;
        const c2Red = prev.close < prev.open;
        const c3Red = curr.close < curr.open;
        if (c1Red && c2Red && c3Red && curr.close < prev.close && prev.close < prev2.close) {
          if (rsi <= 48 && rsi >= 34) {
            const sl = prev.high + 0.2 * atr;
            const risk = sl - curr.close;
            if (risk >= 0.6 * atr && risk <= 2.2 * atr) {
              return { side: 'SELL', slDist: risk, tpDist: risk * 1.6 };
            }
          }
        }
      }
      return null;
    }
  },

  // 3. Pin Bar Hammer / Shooting Star off 20 EMA
  {
    name: '3. Institutional Pin Bar Rejection at 20 EMA',
    check: (curr, prev, prev2, win, h1C, h1E50, atr, adx, e20, e50, rsi) => {
      if (adx < 22) return null;
      const range = curr.high - curr.low;
      if (range < atr * 0.6) return null;

      // Bullish Hammer at EMA20
      if (h1C > h1E50 && e20 > e50 && curr.close > e20) {
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        const body = Math.abs(curr.close - curr.open);
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        if (lowerWick >= range * 0.60 && upperWick <= range * 0.15 && curr.low <= e20 * 1.002) {
          const sl = curr.low - 0.2 * atr;
          const risk = curr.close - sl;
          if (risk >= 0.5 * atr && risk <= 2.0 * atr) {
            return { side: 'BUY', slDist: risk, tpDist: risk * 1.8 };
          }
        }
      }

      // Bearish Shooting Star at EMA20
      if (h1C < h1E50 && e20 < e50 && curr.close < e20) {
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const body = Math.abs(curr.close - curr.open);
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        if (upperWick >= range * 0.60 && lowerWick <= range * 0.15 && curr.high >= e20 * 0.998) {
          const sl = curr.high + 0.2 * atr;
          const risk = sl - curr.close;
          if (risk >= 0.5 * atr && risk <= 2.0 * atr) {
            return { side: 'SELL', slDist: risk, tpDist: risk * 1.8 };
          }
        }
      }
      return null;
    }
  },

  // 4. Quant Math High Conviction (SuperSmoother + Fisher + Trend alignment)
  {
    name: '4. Quant Math High Conviction (SuperSmoother + Fisher Extreme)',
    check: (curr, prev, prev2, win, h1C, h1E50, atr, adx, e20, e50, rsi) => {
      const closes = win.map(c => c.close);
      const smooth = QuantMathematicalEngine.calculateSuperSmoother(closes, 10);
      const slope = ((smooth[smooth.length - 1] - smooth[smooth.length - 3]) / smooth[smooth.length - 3]) * 100;
      const { fisher, signal } = QuantMathematicalEngine.calculateFisherTransform(win, 10);
      const fVal = fisher[fisher.length - 1];
      const sVal = signal[signal.length - 1];

      // Bullish
      if (h1C > h1E50 && curr.close > e20 && e20 > e50 && slope > 0.04 && fVal > sVal && fVal >= -0.5 && fVal <= 1.5) {
        if (curr.close > curr.open && adx >= 24) {
          const sl = curr.close - 1.4 * atr;
          return { side: 'BUY', slDist: 1.4 * atr, tpDist: 2.5 * atr };
        }
      }

      // Bearish
      if (h1C < h1E50 && curr.close < e20 && e20 < e50 && slope < -0.04 && fVal < sVal && fVal <= 0.5 && fVal >= -1.5) {
        if (curr.close < curr.open && adx >= 24) {
          const sl = curr.close + 1.4 * atr;
          return { side: 'SELL', slDist: 1.4 * atr, tpDist: 2.5 * atr };
        }
      }
      return null;
    }
  }
];

for (const rule of rules) {
  let totalSigs = 0;
  let wins = 0;
  let losses = 0;
  let totalWinR = 0;
  let totalLossR = 0;

  for (const sym of SYMBOLS) {
    const bars15m = load15m(sym);
    const bars1h = load1h(sym);
    if (bars15m.length < 200) continue;

    const h1Closes = bars1h.map(b => b.close);
    const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    let h1Idx = 0;

    for (let i = 50; i < bars15m.length - 20; i++) {
      const win = bars15m.slice(i - 50, i + 1);
      const curr = win[win.length - 1];
      const prev = win[win.length - 2];
      const prev2 = win[win.length - 3];

      const closes = win.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

      while (h1Idx < bars1h.length - 1 && bars1h[h1Idx + 1].time <= curr.time) {
        h1Idx++;
      }
      const h1C = bars1h[h1Idx]?.close || curr.close;
      const h1E = h1Ema50[h1Idx] || curr.close;

      const res = rule.check(curr, prev, prev2, win, h1C, h1E, atr, adx, ema20, ema50, conf.rsi14);
      if (!res) continue;

      totalSigs++;
      const tp = res.side === 'BUY' ? curr.close + res.tpDist : curr.close - res.tpDist;
      const sl = res.side === 'BUY' ? curr.close - res.slDist : curr.close + res.slDist;

      let won = false;
      let lost = false;

      for (let f = 1; f <= 16; f++) {
        const fb = bars15m[i + f];
        if (!fb) break;

        const isTP = res.side === 'BUY' ? fb.high >= tp : fb.low <= tp;
        const isSL = res.side === 'BUY' ? fb.low <= sl : fb.high >= sl;

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

      const rMultiple = res.tpDist / res.slDist;
      if (won) {
        wins++;
        totalWinR += rMultiple;
      } else if (lost) {
        losses++;
        totalLossR += 1.0;
      } else {
        const fb = bars15m[i + 16];
        if (fb) {
          const diff = res.side === 'BUY' ? (fb.close - curr.close) / res.slDist : (curr.close - fb.close) / res.slDist;
          if (diff > 0) {
            wins++;
            totalWinR += diff;
          } else {
            losses++;
            totalLossR += Math.abs(diff);
          }
        }
      }
    }
  }

  const wr = totalSigs > 0 ? ((wins / totalSigs) * 100).toFixed(1) : '0';
  const pf = totalLossR > 0 ? (totalWinR / totalLossR).toFixed(2) : '0';
  console.log(`------------------------------------------------------------------------`);
  console.log(`📌 ${rule.name}`);
  console.log(`   Signals: ${totalSigs} | Win Rate: ${wr}% (${wins}W / ${losses}L) | PF: ${pf} | EV: +${((totalWinR - totalLossR) / (totalSigs || 1)).toFixed(2)} R`);
}
