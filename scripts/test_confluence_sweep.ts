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
  console.log(`📊 SIMULATION ON ${sym} (Realistic Multi-Layer Strict Confluence)`);
  console.log(`================================================================`);

  for (const mathTh of [45, 50, 55]) {
    for (const strictTh of [60, 65, 70]) {
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
        if (!math.recommendedSide || math.quantScore < mathTh) continue;

        const closes = win.map(c => c.close);
        const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
        const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
        const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
        const atr = conf.atr || curr.close * 0.015;

        const isBuy = math.recommendedSide === 'BUY';

        // Check indicator/trend alignment
        const isTrendAligned = isBuy ? curr.close >= ema20 : curr.close <= ema20;
        if (!isTrendAligned) continue;

        let strictScore = math.quantScore + 15; // indicator aligned
        if (strictScore < strictTh) continue;

        // REAL-TIME CANDLE GATE: Active bar MUST confirm direction
        if (isBuy && next1.close < next1.open) continue; // No buying red bar
        if (!isBuy && next1.close > next1.open) continue; // No selling green bar

        const entryPrice = next1.open;
        // Target: $6 target, $2.50 loss => 2.4:1 RR
        const targetPrice = isBuy ? entryPrice + 1.8 * atr : entryPrice - 1.8 * atr;
        const stopPrice = isBuy ? entryPrice - 0.75 * atr : entryPrice + 0.75 * atr;

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
      const netPnl = wins * 6.0 - losses * 2.5;
      console.log(`MathTh >= ${mathTh} | StrictTh >= ${strictTh} -> Trades: ${trades} | Wins: ${wins} | Loss: ${losses} | WinRate: ${wr}% | Net PnL: +$${netPnl.toFixed(1)}`);
    }
  }
}
