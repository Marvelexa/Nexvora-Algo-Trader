import fs from 'fs';
import path from 'path';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

const testCoins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD', 'ADAUSD', 'XRPUSD'];
const cacheDir = path.join(process.cwd(), 'data', 'cache_candles');

let grandTrades = 0, grandWins = 0, grandBes = 0, grandLosses = 0;

for (const sym of testCoins) {
  let filePath = path.join(cacheDir, `${sym}_15m_1000.json`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(cacheDir, `${sym}_15m_2500.json`);
  }
  if (!fs.existsSync(filePath)) continue;

  const allCandles: KlinePoint[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let trades = 0, wins = 0, bes = 0, losses = 0;
  let activeTrade: any = null;
  let cooldownUntil = 0;

  for (let i = 35; i < allCandles.length - 1; i++) {
    const currentBar = allCandles[i];
    const nextBar = allCandles[i + 1];

    if (activeTrade) {
      const targetDist = Math.abs(activeTrade.takeProfitPrice - activeTrade.entryPrice);
      if (activeTrade.side === 'BUY') {
        if (currentBar.high > activeTrade.highest) activeTrade.highest = currentBar.high;
        const progress = (activeTrade.highest - activeTrade.entryPrice) / targetDist;
        if (progress >= 0.35) activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice * 1.0012);
        if (progress >= 0.65) activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice + targetDist * 0.45);
        if (progress >= 0.85) activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice + targetDist * 0.70);

        if (currentBar.high >= activeTrade.takeProfitPrice) {
          wins++;
          activeTrade = null;
          cooldownUntil = i + 2;
          continue;
        } else if (currentBar.low <= activeTrade.sl) {
          if (activeTrade.sl >= activeTrade.entryPrice) bes++;
          else losses++;
          activeTrade = null;
          cooldownUntil = i + 3;
          continue;
        }
      } else {
        if (currentBar.low < activeTrade.lowest) activeTrade.lowest = currentBar.low;
        const progress = (activeTrade.entryPrice - activeTrade.lowest) / targetDist;
        if (progress >= 0.35) activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice * 0.9988);
        if (progress >= 0.65) activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice - targetDist * 0.45);
        if (progress >= 0.85) activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice - targetDist * 0.70);

        if (currentBar.low <= activeTrade.takeProfitPrice) {
          wins++;
          activeTrade = null;
          cooldownUntil = i + 2;
          continue;
        } else if (currentBar.high >= activeTrade.sl) {
          if (activeTrade.sl <= activeTrade.entryPrice) bes++;
          else losses++;
          activeTrade = null;
          cooldownUntil = i + 3;
          continue;
        }
      }
    }

    if (!activeTrade && i >= cooldownUntil) {
      const historySlice = allCandles.slice(0, i + 1);
      const closedHistory = historySlice.slice(0, -1);

      // Evaluate Port 3025 Live Video Strategy
      const stratRes = evaluateStrategyForPort(3025, sym, closedHistory);
      if (!stratRes || !stratRes.signal || (stratRes.confidenceScore || 0) < 60) continue;

      const side = stratRes.signal;
      const entryPrice = nextBar.open;
      const customSL = stratRes.customSL;
      const customTP = stratRes.customTP;

      if (!customSL || !customTP) continue;
      const lossDist = Math.abs(entryPrice - customSL);
      const profitDist = Math.abs(customTP - entryPrice);
      const rr = profitDist / (lossDist || 1);
      if (rr < 2.25) continue; // Enforce minimum 1:2.3 RR

      activeTrade = {
        side,
        entryPrice,
        takeProfitPrice: customTP,
        sl: customSL,
        highest: entryPrice,
        lowest: entryPrice,
      };
      trades++;
    }
  }

  const total = wins + bes + losses;
  const wr = total > 0 ? ((wins + bes) / total) * 100 : 0;
  grandTrades += total;
  grandWins += wins;
  grandBes += bes;
  grandLosses += losses;
  console.log(`${sym.padEnd(8)}: Trades: ${total.toString().padEnd(3)} | Wins: ${wins.toString().padEnd(2)} | BE: ${bes.toString().padEnd(2)} | Losses: ${losses.toString().padEnd(2)} | Accuracy: ${wr.toFixed(1)}%`);
}

const grandAccuracy = grandTrades > 0 ? ((grandWins + grandBes) / grandTrades) * 100 : 0;
console.log(`\nGRAND TOTAL: Trades: ${grandTrades} | Wins: ${grandWins} | Protected BE: ${grandBes} | Losses: ${grandLosses} | Accuracy: ${grandAccuracy.toFixed(1)}%`);
