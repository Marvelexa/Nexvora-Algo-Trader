import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');
const symbols = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD'];

interface SetupRule {
  name: string;
  evaluate: (bars: any[], i: number) => { signal: 'BUY' | 'SELL' | null; reason: string } | null;
}

const rules: SetupRule[] = [
  {
    name: 'Donchian Momentum Expansion + 20/50 EMA Trend',
    evaluate: (bars, i) => {
      const win = bars.slice(Math.max(0, i - 60), i + 1);
      if (win.length < 50) return null;
      const curr = win[win.length - 1];
      const prev = win[win.length - 2];
      const closes = win.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const rsi = CryptoDedicatedStrategyEngine.calculateRSI(closes, 14).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

      // Donchian 20 channel of previous 20 bars (excluding current)
      const prev20 = win.slice(-21, -1);
      const donchianHigh = Math.max(...prev20.map(c => c.high));
      const donchianLow = Math.min(...prev20.map(c => c.low));

      const range = curr.high - curr.low;
      const body = Math.abs(curr.close - curr.open);
      const upperWick = curr.high - Math.max(curr.open, curr.close);
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;

      // BUY: Break above 20 High, Green bar, Price > EMA20 > EMA50, ADX >= 22, RSI 50-72
      if (
        curr.close > donchianHigh &&
        curr.close > curr.open &&
        body >= range * 0.4 &&
        upperWick < body &&
        curr.close > ema20 &&
        ema20 >= ema50 &&
        adx >= 22 &&
        rsi >= 50 && rsi <= 72
      ) {
        return { signal: 'BUY', reason: `Donchian Breakout High (${curr.close} > ${donchianHigh}) + Green Bar` };
      }

      // SELL: Break below 20 Low, Red bar, Price < EMA20 < EMA50, ADX >= 22, RSI 28-50
      if (
        curr.close < donchianLow &&
        curr.close < curr.open &&
        body >= range * 0.4 &&
        lowerWick < body &&
        curr.close < ema20 &&
        ema20 <= ema50 &&
        adx >= 22 &&
        rsi >= 28 && rsi <= 50
      ) {
        return { signal: 'SELL', reason: `Donchian Breakdown Low (${curr.close} < ${donchianLow}) + Red Bar` };
      }

      return null;
    }
  },
  {
    name: '20 EMA Pullback Continuation (Trend Retest)',
    evaluate: (bars, i) => {
      const win = bars.slice(Math.max(0, i - 60), i + 1);
      if (win.length < 50) return null;
      const curr = win[win.length - 1];
      const prev = win[win.length - 2];
      const closes = win.map(c => c.close);
      const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
      const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
      const ema20 = ema20Arr.slice(-1)[0];
      const ema50 = ema50Arr.slice(-1)[0];
      const prevEma20 = ema20Arr.slice(-2)[0];
      const rsi = CryptoDedicatedStrategyEngine.calculateRSI(closes, 14).slice(-1)[0];
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

      const range = Math.max(curr.high - curr.low, 0.0001);
      const body = Math.abs(curr.close - curr.open);
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;
      const upperWick = curr.high - Math.max(curr.open, curr.close);

      // BUY: Strong Uptrend (EMA20 > EMA50, EMA20 slope > 0), curr tested near EMA20 (low <= EMA20 * 1.003)
      // and closed GREEN above EMA20 with lower rejection wick
      if (
        ema20 > ema50 &&
        ema20 >= prevEma20 &&
        curr.low <= ema20 * 1.004 &&
        curr.close > ema20 &&
        curr.close > curr.open &&
        (lowerWick >= range * 0.25 || body >= range * 0.4) &&
        adx >= 20 &&
        rsi >= 45 && rsi <= 68
      ) {
        return { signal: 'BUY', reason: `EMA20 Pullback Bounce + Green Reversal Bar` };
      }

      // SELL: Strong Downtrend (EMA20 < EMA50, EMA20 slope < 0), curr tested near EMA20 (high >= EMA20 * 0.997)
      // and closed RED below EMA20 with upper rejection wick
      if (
        ema20 < ema50 &&
        ema20 <= prevEma20 &&
        curr.high >= ema20 * 0.996 &&
        curr.close < ema20 &&
        curr.close < curr.open &&
        (upperWick >= range * 0.25 || body >= range * 0.4) &&
        adx >= 20 &&
        rsi >= 32 && rsi <= 55
      ) {
        return { signal: 'SELL', reason: `EMA20 Pullback Rejection + Red Reversal Bar` };
      }

      return null;
    }
  }
];

for (const sym of symbols) {
  const filePath = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (!fs.existsSync(filePath)) continue;
  const bars: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`\n================================================================`);
  console.log(`📈 TESTING ADVANCED RULES ON ${sym} (${bars.length} bars)`);
  console.log(`================================================================`);

  for (const rule of rules) {
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let nextBarFollowThrough = 0;
    let netPnL = 0;

    let inTradeUntil = 0;

    for (let i = 60; i < bars.length - 12; i++) {
      if (i < inTradeUntil) continue; // No overlapping trades on same coin

      const res = rule.evaluate(bars, i);
      if (!res || !res.signal) continue;

      const curr = bars[i];
      const next1 = bars[i + 1];
      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(bars.slice(i - 40, i + 1));
      const atr = conf.atr || (curr.close * 0.015);

      const isNextGreen = next1.close > next1.open;
      if (res.signal === 'BUY' && isNextGreen) nextBarFollowThrough++;
      else if (res.signal === 'SELL' && !isNextGreen) nextBarFollowThrough++;

      const isBuy = res.signal === 'BUY';
      // TP: 2.2 ATR, SL: 0.9 ATR (2.44 : 1 Reward-to-Risk)
      const targetDist = 2.2 * atr;
      const stopDist = 0.9 * atr;
      const targetPrice = isBuy ? curr.close + targetDist : curr.close - targetDist;
      const stopPrice = isBuy ? curr.close - stopDist : curr.close + stopDist;

      let outcome: 'WIN' | 'LOSS' | 'TIMEOUT' = 'TIMEOUT';
      let exitIdx = i + 10;

      for (let f = 1; f <= 10; f++) {
        const fb = bars[i + f];
        if (!fb) break;

        if (isBuy) {
          if (fb.low <= stopPrice) { outcome = 'LOSS'; exitIdx = i + f; break; }
          if (fb.high >= targetPrice) { outcome = 'WIN'; exitIdx = i + f; break; }
        } else {
          if (fb.high >= stopPrice) { outcome = 'LOSS'; exitIdx = i + f; break; }
          if (fb.low <= targetPrice) { outcome = 'WIN'; exitIdx = i + f; break; }
        }
      }

      if (outcome === 'WIN') {
        wins++;
        trades++;
        netPnL += 2.44; // normalized R
        inTradeUntil = exitIdx + 1;
      } else if (outcome === 'LOSS') {
        losses++;
        trades++;
        netPnL -= 1.0;
        inTradeUntil = exitIdx + 1;
      }
    }

    const wr = trades > 0 ? ((wins / trades) * 100).toFixed(1) : '0';
    const followRate = trades > 0 ? ((nextBarFollowThrough / trades) * 100).toFixed(1) : '0';
    console.log(`[${rule.name}]`);
    console.log(`  Trades: ${trades} | Wins: ${wins} | Losses: ${losses} | WinRate: ${wr}%`);
    console.log(`  Next Bar Follow-Through (No Inversion): ${followRate}%`);
    console.log(`  Total Net R-Multiple: ${netPnL.toFixed(2)} R`);
  }
}
