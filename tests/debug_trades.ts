import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

async function fetchCandles(symbol: string, limit: number = 200): Promise<KlinePoint[]> {
  const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
  const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${base}USDT&interval=15m&limit=${limit}`);
  const data = await res.json();
  return data.map((k: any) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function debugTrades() {
  const candles = await fetchCandles('BTCUSD', 250);
  console.log(`Fetched ${candles.length} candles for BTCUSD`);

  let count = 0;
  for (let i = 40; i < candles.length - 1; i++) {
    const history = candles.slice(0, i + 1);
    const stratRes = evaluateStrategyForPort(3025, 'BTCUSD', history);

    if (stratRes && stratRes.signal && stratRes.customTP && stratRes.customSL) {
      const entryPrice = candles[i + 1].open;
      const profitDist = stratRes.signal === 'BUY' ? stratRes.customTP - entryPrice : entryPrice - stratRes.customTP;
      const lossDist = stratRes.signal === 'BUY' ? entryPrice - stratRes.customSL : stratRes.customSL - entryPrice;
      const rr = profitDist / lossDist;

      count++;
      console.log(`\n--- Trade #${count} at Bar ${i} (${new Date(candles[i].time).toISOString()}) ---`);
      console.log(`Strategy: ${stratRes.strategyName}`);
      console.log(`Side: ${stratRes.signal} | Entry: $${entryPrice.toFixed(2)} | TP: $${stratRes.customTP.toFixed(2)} | SL: $${stratRes.customSL.toFixed(2)} | RR: 1:${rr.toFixed(2)}`);

      // Track subsequent bars to see how it played out
      let maxMove = 0;
      let outcome = 'OPEN';
      for (let j = i + 1; j < Math.min(candles.length, i + 20); j++) {
        const bar = candles[j];
        if (stratRes.signal === 'BUY') {
          if (bar.high - entryPrice > maxMove) maxMove = bar.high - entryPrice;
          if (bar.high >= stratRes.customTP) { outcome = `TP HIT at bar +${j - i}`; break; }
          if (bar.low <= stratRes.customSL) { outcome = `SL HIT at bar +${j - i}`; break; }
        } else {
          if (entryPrice - bar.low > maxMove) maxMove = entryPrice - bar.low;
          if (bar.low <= stratRes.customTP) { outcome = `TP HIT at bar +${j - i}`; break; }
          if (bar.high >= stratRes.customSL) { outcome = `SL HIT at bar +${j - i}`; break; }
        }
      }
      console.log(`Outcome within 20 bars: ${outcome} (Max favorable move: $${maxMove.toFixed(2)}, Needed TP: $${profitDist.toFixed(2)}, SL Dist: $${lossDist.toFixed(2)})`);
      if (count >= 8) break;
    }
  }
}

debugTrades().catch(console.error);
