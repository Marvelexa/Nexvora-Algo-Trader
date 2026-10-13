import fs from 'fs';
import path from 'path';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');
const symbols = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD'];

for (const sym of symbols) {
  const filePath = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (!fs.existsSync(filePath)) continue;
  const bars: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`\n================================================================`);
  console.log(`🔍 THRESHOLD SWEEP ON ${sym} (with Real-Time Candle & Trend Gate)`);
  console.log(`================================================================`);

  for (const th of [50, 55, 60, 65, 70]) {
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let inTradeUntil = 0;

    for (let i = 60; i < bars.length - 12; i++) {
      if (i < inTradeUntil) continue;
      const win = bars.slice(i - 60, i + 1);
      const curr = win[win.length - 1];
      const next1 = bars[i + 1];

      const math = QuantMathematicalEngine.evaluateMarketMath(sym, win);
      if (!math.recommendedSide || math.quantScore < th) continue;

      const closes = win.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr || curr.close * 0.015;

      const isBuy = math.recommendedSide === 'BUY';

      // REAL-TIME CONVICTION GATE
      // On next1 (the live execution bar):
      // If BUY: next1 must not be red (next1.close >= next1.open), and curr must be >= ema20
      // If SELL: next1 must not be green (next1.close <= next1.open), and curr must be <= ema20
      if (isBuy && (next1.close < next1.open || curr.close < ema20)) continue;
      if (!isBuy && (next1.close > next1.open || curr.close > ema20)) continue;

      // Trade executed at next1.open
      const entryPrice = next1.open;
      const targetPrice = isBuy ? entryPrice + 1.8 * atr : entryPrice - 1.8 * atr;
      const stopPrice = isBuy ? entryPrice - 0.8 * atr : entryPrice + 0.8 * atr;

      let outcome: 'WIN' | 'LOSS' | 'TIMEOUT' = 'TIMEOUT';
      let exitIdx = i + 10;

      for (let f = 1; f <= 10; f++) {
        const fb = bars[i + 1 + f];
        if (!fb) break;

        if (isBuy) {
          if (fb.low <= stopPrice) { outcome = 'LOSS'; exitIdx = i + 1 + f; break; }
          if (fb.high >= targetPrice) { outcome = 'WIN'; exitIdx = i + 1 + f; break; }
        } else {
          if (fb.high >= stopPrice) { outcome = 'LOSS'; exitIdx = i + 1 + f; break; }
          if (fb.low <= targetPrice) { outcome = 'WIN'; exitIdx = i + 1 + f; break; }
        }
      }

      if (outcome === 'WIN') {
        wins++;
        trades++;
        inTradeUntil = exitIdx + 1;
      } else if (outcome === 'LOSS') {
        losses++;
        trades++;
        inTradeUntil = exitIdx + 1;
      }
    }

    const wr = trades > 0 ? ((wins / trades) * 100).toFixed(1) : '0';
    console.log(`Threshold >= ${th}: Trades = ${trades} | Wins = ${wins} | Losses = ${losses} | WinRate = ${wr}% (2.25:1 RR)`);
  }
}
