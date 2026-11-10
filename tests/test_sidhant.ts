import { sidhantEngine } from '../lib/strategies/sidhantWorldChampionEngine';
import { KlinePoint } from '../src/types';

async function fetchCandles(symbol: string, limit: number = 500): Promise<KlinePoint[]> {
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

async function testSidhant() {
  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD', 'XRPUSD'];
  console.log(`=== TESTING SIDHANT 3-STEP WORLD CHAMPION (Video System) ===\n`);

  let totalWins = 0;
  let totalLosses = 0;
  let totalBE = 0;

  for (const sym of coins) {
    const candles = await fetchCandles(sym, 500);
    let wins = 0, losses = 0, bes = 0;

    let activeTrade: any = null;
    let cooldownUntil = 0;

    for (let i = 25; i < candles.length - 1; i++) {
      const currentBar = candles[i];
      const nextBar = candles[i + 1];

      if (activeTrade) {
        const { side, entryPrice, customTP, customSL } = activeTrade;
        const totalDist = Math.abs(customTP - entryPrice);
        let closed = false;

        if (side === 'BUY') {
          // Breakeven lock at 50%
          if (currentBar.high - entryPrice >= 0.50 * totalDist && !activeTrade.isBE) {
            activeTrade.isBE = true;
            activeTrade.sl = entryPrice + 0.05 * totalDist;
          }
          if (currentBar.high >= customTP) {
            wins++;
            totalWins++;
            closed = true;
          } else if (currentBar.low <= activeTrade.sl) {
            if (activeTrade.isBE) { bes++; totalBE++; }
            else { losses++; totalLosses++; }
            closed = true;
          }
        } else {
          // SELL
          if (entryPrice - currentBar.low >= 0.50 * totalDist && !activeTrade.isBE) {
            activeTrade.isBE = true;
            activeTrade.sl = entryPrice - 0.05 * totalDist;
          }
          if (currentBar.low <= customTP) {
            wins++;
            totalWins++;
            closed = true;
          } else if (currentBar.high >= activeTrade.sl) {
            if (activeTrade.isBE) { bes++; totalBE++; }
            else { losses++; totalLosses++; }
            closed = true;
          }
        }

        if (closed) {
          activeTrade = null;
          cooldownUntil = i + 2;
          continue;
        }
      }

      if (i < cooldownUntil) continue;

      const history = candles.slice(0, i + 1);
      const res = sidhantEngine.evaluateSetup(sym, history);

      if (res.recommendedSide && res.customTP && res.customSL) {
        const entryPrice = nextBar.open;
        activeTrade = {
          side: res.recommendedSide,
          entryPrice,
          customTP: res.customTP,
          customSL: res.customSL,
          sl: res.customSL,
          isBE: false,
        };
      }
    }

    const total = wins + losses + bes;
    const wr = total > 0 ? ((wins + bes) / total) * 100 : 0;
    console.log(`${sym.padEnd(8)} | Trades: ${total.toString().padStart(2)} | Wins: ${wins} | BE: ${bes} | Loss: ${losses} | Win Rate: ${wr.toFixed(1)}%`);
  }

  const grandTotal = totalWins + totalLosses + totalBE;
  const effectiveWR = grandTotal > 0 ? ((totalWins + totalBE) / grandTotal) * 100 : 0;
  console.log(`\nOVERALL: ${grandTotal} Trades | Wins: ${totalWins} | BE: ${totalBE} | Losses: ${totalLosses} | Effective Win Rate: ${effectiveWR.toFixed(1)}%`);
}

testSidhant().catch(console.error);
