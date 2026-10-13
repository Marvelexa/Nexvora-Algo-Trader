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
const SYMBOLS = ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'ETHUSD', 'SOLUSD'];

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
  return [];
}

interface SetupResult {
  name: string;
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgBarsHeld: number;
  profitFactor: number;
}

function testSetup(
  name: string,
  symbolList: string[],
  tpAtrMult: number,
  slAtrMult: number,
  conditionFn: (
    curr: CandleData,
    prev: CandleData,
    window15m: CandleData[],
    h1Close: number,
    h1Ema50: number,
    atr: number,
    adx: number,
    ema20: number,
    ema50: number,
    ema200: number,
    rsi14: number
  ) => 'BUY' | 'SELL' | null
): SetupResult {
  let totalSigs = 0;
  let wins = 0;
  let losses = 0;
  let totalWinPnL = 0;
  let totalLossPnL = 0;
  let totalBarsHeld = 0;

  for (const sym of symbolList) {
    const bars15m = load15m(sym);
    const bars1h = load1h(sym);
    if (bars15m.length < 200) continue;

    for (let i = 50; i < bars15m.length - 20; i++) {
      const window15m = bars15m.slice(i - 50, i + 1);
      const curr = window15m[window15m.length - 1];
      const prev = window15m[window15m.length - 2];

      const closes = window15m.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const ema200 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);
      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window15m);
      const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

      let h1Close = curr.close;
      let h1Ema50 = curr.close;
      const currentH1 = bars1h.filter((b: any) => b.time <= curr.time).slice(-50);
      if (currentH1.length >= 20) {
        h1Close = currentH1[currentH1.length - 1].close;
        const h1Closes = currentH1.map((b: any) => b.close);
        h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50).slice(-1)[0];
      }

      const signal = conditionFn(
        curr,
        prev,
        window15m,
        h1Close,
        h1Ema50,
        atr,
        adx,
        ema20,
        ema50,
        ema200,
        conf.rsi14
      );

      if (!signal) continue;

      totalSigs++;
      const entryPrice = curr.close;
      const tp = signal === 'BUY' ? entryPrice + tpAtrMult * atr : entryPrice - tpAtrMult * atr;
      const sl = signal === 'BUY' ? entryPrice - slAtrMult * atr : entryPrice + slAtrMult * atr;

      // Check forward candles
      let tradeResolved = false;
      for (let f = 1; f <= 16; f++) { // Look forward up to 16 bars (4 hours)
        const forwardBar = bars15m[i + f];
        if (!forwardBar) break;

        const isTP = signal === 'BUY' ? forwardBar.high >= tp : forwardBar.low <= tp;
        const isSL = signal === 'BUY' ? forwardBar.low <= sl : forwardBar.high >= sl;

        if (isTP && !isSL) {
          wins++;
          totalWinPnL += tpAtrMult;
          totalBarsHeld += f;
          tradeResolved = true;
          break;
        } else if (isSL && !isTP) {
          losses++;
          totalLossPnL += slAtrMult;
          totalBarsHeld += f;
          tradeResolved = true;
          break;
        } else if (isTP && isSL) {
          // If both hit on same bar, assume loss for conservative stress testing
          losses++;
          totalLossPnL += slAtrMult;
          totalBarsHeld += f;
          tradeResolved = true;
          break;
        }
      }

      if (!tradeResolved) {
        // Time expired at bar 16, exit at close
        const exitBar = bars15m[i + 16] || bars15m[bars15m.length - 1];
        const pnlMult = signal === 'BUY'
          ? (exitBar.close - entryPrice) / atr
          : (entryPrice - exitBar.close) / atr;
        if (pnlMult > 0) {
          wins++;
          totalWinPnL += pnlMult;
        } else {
          losses++;
          totalLossPnL += Math.abs(pnlMult);
        }
        totalBarsHeld += 16;
      }
    }
  }

  const winRate = totalSigs > 0 ? parseFloat(((wins / totalSigs) * 100).toFixed(1)) : 0;
  const pf = totalLossPnL > 0 ? parseFloat((totalWinPnL / totalLossPnL).toFixed(2)) : 99;
  const avgBars = totalSigs > 0 ? parseFloat((totalBarsHeld / totalSigs).toFixed(1)) : 0;

  return {
    name,
    totalSignals: totalSigs,
    wins,
    losses,
    winRate,
    avgBarsHeld: avgBars,
    profitFactor: pf,
  };
}

// RUN COMPARATIVE EXPERIMENTS
console.log(`========================================================================`);
console.log(`🧪 TESTING CANDLE & INDICATOR SETUPS ON 6,000 REAL DELTA CANDLES`);
console.log(`========================================================================\n`);

const setups: SetupResult[] = [];

// Setup 1: Baseline High Math Score (quantScore >= 70)
setups.push(
  testSetup('1. Quant Score >= 70 (TP=2.0x, SL=1.2x)', SYMBOLS, 2.0, 1.2, (curr, prev, win, h1C, h1E50, atr, adx, e20, e50) => {
    const math = QuantMathematicalEngine.evaluateMarketMath('SYM', win);
    if (math.quantScore >= 70) return math.recommendedSide;
    return null;
  })
);

// Setup 2: Quant Score >= 60 + 1H Trend Alignment + ADX >= 22
setups.push(
  testSetup('2. Quant Score >= 60 + 1H Trend + ADX >= 22', SYMBOLS, 2.0, 1.2, (curr, prev, win, h1C, h1E50, atr, adx, e20, e50) => {
    if (adx < 22) return null;
    const math = QuantMathematicalEngine.evaluateMarketMath('SYM', win);
    if (math.quantScore < 60) return null;
    if (math.recommendedSide === 'BUY' && h1C > h1E50 && curr.close > e20) return 'BUY';
    if (math.recommendedSide === 'SELL' && h1C < h1E50 && curr.close < e20) return 'SELL';
    return null;
  })
);

// Setup 3: EMA Pullback + Price Action Rejection Wick
setups.push(
  testSetup('3. EMA Pullback Rejection (TP=2.2x, SL=1.2x)', SYMBOLS, 2.2, 1.2, (curr, prev, win, h1C, h1E50, atr, adx, e20, e50, e200, rsi) => {
    if (adx < 20) return null;
    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    // BUY: Uptrend, previous bar dipped to EMA20, current bar closes green above EMA20 with lower wick
    if (h1C > h1E50 && e20 > e50 && curr.close > e20) {
      if (prev.low <= e20 && isGreen && curr.close > prev.close && lowerWick > body * 0.4 && rsi > 45 && rsi < 65) {
        return 'BUY';
      }
    }

    // SELL: Downtrend, previous bar rose to EMA20, current bar closes red below EMA20 with upper wick
    if (h1C < h1E50 && e20 < e50 && curr.close < e20) {
      if (prev.high >= e20 && !isGreen && curr.close < prev.close && upperWick > body * 0.4 && rsi < 55 && rsi > 35) {
        return 'SELL';
      }
    }
    return null;
  })
);

// Setup 4: Donchian 20-period Breakout + Momentum Expansion
setups.push(
  testSetup('4. Donchian 20 Breakout (TP=2.5x, SL=1.2x)', SYMBOLS, 2.5, 1.2, (curr, prev, win, h1C, h1E50, atr, adx, e20, e50, e200, rsi) => {
    if (adx < 24) return null;
    const prev20 = win.slice(-21, -1);
    const highest20 = Math.max(...prev20.map(c => c.high));
    const lowest20 = Math.min(...prev20.map(c => c.low));

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);

    // Breakout High
    if (h1C > h1E50 && curr.close > highest20 && isGreen && body > atr * 0.6 && rsi > 52 && rsi < 70) {
      return 'BUY';
    }

    // Breakdown Low
    if (h1C < h1E50 && curr.close < lowest20 && !isGreen && body > atr * 0.6 && rsi < 48 && rsi > 30) {
      return 'SELL';
    }
    return null;
  })
);

// Setup 5: Multi-Confluence Power Trend (1H Trend + 15m Alignment + SuperSmoother Slope + Candle Conviction)
setups.push(
  testSetup('5. Multi-Confluence Power Trend (TP=2.2x, SL=1.4x)', SYMBOLS, 2.2, 1.4, (curr, prev, win, h1C, h1E50, atr, adx, e20, e50, e200, rsi) => {
    if (adx < 22) return null;
    const closes = win.map(c => c.close);
    const smooth = QuantMathematicalEngine.calculateSuperSmoother(closes, 10);
    const slope = ((smooth[smooth.length - 1] - smooth[smooth.length - 3]) / smooth[smooth.length - 3]) * 100;

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    // BUY: 1H bullish + 15m bullish + slope > 0.05% + Green expansion candle
    if (h1C > h1E50 && curr.close > e20 && e20 > e50 && slope > 0.03 && isGreen) {
      if (upperWick < body * 0.7 && rsi >= 48 && rsi <= 66) {
        return 'BUY';
      }
    }

    // SELL: 1H bearish + 15m bearish + slope < -0.05% + Red expansion candle
    if (h1C < h1E50 && curr.close < e20 && e20 < e50 && slope < -0.03 && !isGreen) {
      if (lowerWick < body * 0.7 && rsi <= 52 && rsi >= 34) {
        return 'SELL';
      }
    }

    return null;
  })
);

// Setup 6: Multi-Confluence Power Trend with TP=3.0x, SL=1.5x (2:1 RR)
setups.push(
  testSetup('6. Multi-Confluence Power Trend (TP=3.0x, SL=1.5x) [2:1 RR]', SYMBOLS, 3.0, 1.5, (curr, prev, win, h1C, h1E50, atr, adx, e20, e50, e200, rsi) => {
    if (adx < 24) return null;
    const closes = win.map(c => c.close);
    const smooth = QuantMathematicalEngine.calculateSuperSmoother(closes, 10);
    const slope = ((smooth[smooth.length - 1] - smooth[smooth.length - 3]) / smooth[smooth.length - 3]) * 100;

    const isGreen = curr.close > curr.open;
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;

    if (h1C > h1E50 && curr.close > e20 && e20 > e50 && slope > 0.03 && isGreen) {
      if (upperWick < body * 0.6 && rsi >= 50 && rsi <= 68) {
        return 'BUY';
      }
    }

    if (h1C < h1E50 && curr.close < e20 && e20 < e50 && slope < -0.03 && !isGreen) {
      if (lowerWick < body * 0.6 && rsi <= 50 && rsi >= 32) {
        return 'SELL';
      }
    }

    return null;
  })
);

// Display comparison table
console.log('RESULTS ACROSS ALL 6,000 CANDLES:');
setups.forEach(s => {
  console.log(`------------------------------------------------------------------------`);
  console.log(`📌 ${s.name}`);
  console.log(`   Signals: ${s.totalSignals} | Wins: ${s.wins} | Losses: ${s.losses}`);
  console.log(`   Win Rate: ${s.winRate}% | Profit Factor: ${s.profitFactor} | Avg Bars Held: ${s.avgBarsHeld}`);
});
