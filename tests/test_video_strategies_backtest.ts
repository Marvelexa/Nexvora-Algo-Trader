import 'dotenv/config';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

async function fetchCandles(symbol: string, limit: number = 500): Promise<KlinePoint[]> {
  const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
  const binanceSym = `${base}USDT`;
  try {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${binanceSym}&interval=15m&limit=${limit}`);
    if (res.ok) {
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
  } catch (e) {}
  return [];
}

export async function runVideoStrategiesBacktest(symbols: string[]) {
  console.log(`\n================================================================`);
  console.log(`🎬 RUNNING 7-VIDEO STRATEGY ACCURACY BACKTEST ON PORT 3025`);
  console.log(`Coins: ${symbols.join(', ')}`);
  console.log(`================================================================\n`);

  let totalWins = 0;
  let totalLosses = 0;
  let totalBreakevens = 0;
  let totalGrossProfit = 0;
  let totalGrossLoss = 0;

  for (const sym of symbols) {
    const candles = await fetchCandles(sym, 500);
    if (!candles || candles.length < 50) continue;

    let activeTrade: {
      side: 'BUY' | 'SELL';
      entryPrice: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      initialSL: number;
      strategy: string;
      confidence: number;
      rr: number;
      isBreakeven: boolean;
      isTrailed: boolean;
    } | null = null;

    let cWins = 0;
    let cLosses = 0;
    let cBes = 0;
    let cPnl = 0;
    let cooldownUntil = 0;

    for (let i = 35; i < candles.length - 1; i++) {
      const currentBar = candles[i];
      const nextBar = candles[i + 1];

      if (activeTrade) {
        const { side, entryPrice, takeProfitPrice, stopLossPrice, initialSL } = activeTrade;
        const totalDistance = Math.abs(takeProfitPrice - entryPrice);
        let closed = false;

        if (side === 'BUY') {
          const moveFromEntry = currentBar.high - entryPrice;
          // Breakeven lock at 50% to target
          if (moveFromEntry >= 0.50 * totalDistance && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice + (0.05 * (takeProfitPrice - entryPrice));
          }
          // Profit trail at 75% to target
          if (moveFromEntry >= 0.75 * totalDistance && !activeTrade.isTrailed) {
            activeTrade.isTrailed = true;
            activeTrade.stopLossPrice = entryPrice + (0.50 * (takeProfitPrice - entryPrice));
          }

          if (currentBar.high >= takeProfitPrice) {
            cWins++;
            totalWins++;
            const pnl = 10.0; // Standard $10 USD capped win
            cPnl += pnl;
            totalGrossProfit += pnl;
            closed = true;
          } else if (currentBar.low <= activeTrade.stopLossPrice) {
            if (activeTrade.isBreakeven || activeTrade.isTrailed) {
              cBes++;
              totalBreakevens++;
              const pnl = activeTrade.isTrailed ? 5.0 : 0.5;
              cPnl += pnl;
              totalGrossProfit += pnl;
            } else {
              cLosses++;
              totalLosses++;
              const pnl = -(10.0 / Math.max(2.3, activeTrade.rr));
              cPnl += pnl;
              totalGrossLoss += Math.abs(pnl);
            }
            closed = true;
          }
        } else {
          // SELL side
          const moveFromEntry = entryPrice - currentBar.low;
          // Breakeven lock at 50% to target
          if (moveFromEntry >= 0.50 * totalDistance && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice - (0.05 * (entryPrice - takeProfitPrice));
          }
          // Profit trail at 75% to target
          if (moveFromEntry >= 0.75 * totalDistance && !activeTrade.isTrailed) {
            activeTrade.isTrailed = true;
            activeTrade.stopLossPrice = entryPrice - (0.50 * (entryPrice - takeProfitPrice));
          }

          if (currentBar.low <= takeProfitPrice) {
            cWins++;
            totalWins++;
            const pnl = 10.0;
            cPnl += pnl;
            totalGrossProfit += pnl;
            closed = true;
          } else if (currentBar.high >= activeTrade.stopLossPrice) {
            if (activeTrade.isBreakeven || activeTrade.isTrailed) {
              cBes++;
              totalBreakevens++;
              const pnl = activeTrade.isTrailed ? 5.0 : 0.5;
              cPnl += pnl;
              totalGrossProfit += pnl;
            } else {
              cLosses++;
              totalLosses++;
              const pnl = -(10.0 / Math.max(2.3, activeTrade.rr));
              cPnl += pnl;
              totalGrossLoss += Math.abs(pnl);
            }
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

      // Evaluate Port 3025 Video Strategies
      const history = candles.slice(0, i + 1);
      const stratRes = evaluateStrategyForPort(3025, sym, history);

      if (stratRes && stratRes.signal && stratRes.confidenceScore >= 65 && stratRes.customTP && stratRes.customSL) {
        const entryPrice = nextBar.open;
        const side = stratRes.signal;
        const profitDist = side === 'BUY' ? stratRes.customTP - entryPrice : entryPrice - stratRes.customTP;
        const lossDist = side === 'BUY' ? entryPrice - stratRes.customSL : stratRes.customSL - entryPrice;

        if (profitDist > 0 && lossDist > 0) {
          const rr = profitDist / lossDist;
          if (rr >= 2.0) {
            activeTrade = {
              side,
              entryPrice,
              takeProfitPrice: stratRes.customTP,
              stopLossPrice: stratRes.customSL,
              initialSL: stratRes.customSL,
              strategy: stratRes.strategyName,
              confidence: stratRes.confidenceScore,
              rr,
              isBreakeven: false,
              isTrailed: false,
            };
          }
        }
      }
    }

    const cTotal = cWins + cLosses + cBes;
    const cWinRate = cTotal > 0 ? ((cWins + cBes) / cTotal) * 100 : 0;
    console.log(`📊 ${sym.padEnd(8)} | Trades: ${cTotal.toString().padStart(2)} | Wins: ${cWins.toString().padStart(2)} | BE: ${cBes.toString().padStart(2)} | Losses: ${cLosses.toString().padStart(2)} | Win Rate: ${cWinRate.toFixed(1).padStart(5)}% | PnL: +$${cPnl.toFixed(2)} USD`);
  }

  const grandTotal = totalWins + totalLosses + totalBreakevens;
  const grandWinRate = grandTotal > 0 ? ((totalWins + totalBreakevens) / grandTotal) * 100 : 0;
  const pureWinRate = grandTotal > 0 ? (totalWins / grandTotal) * 100 : 0;
  const netPnl = totalGrossProfit - totalGrossLoss;

  console.log(`\n================================================================`);
  console.log(`🏆 7-VIDEO STRATEGY AUDIT RESULTS (PORT 3025 LIVE ENGINE)`);
  console.log(`================================================================`);
  console.log(`Total Trades Executed : ${grandTotal}`);
  console.log(`Full Target Wins ($10) : ${totalWins}`);
  console.log(`Breakeven / Trailed   : ${totalBreakevens}`);
  console.log(`Stop Loss Hits        : ${totalLosses}`);
  console.log(`Effective Accuracy    : ${grandWinRate.toFixed(1)}% (Wins + Risk-Free Breakeven)`);
  console.log(`Pure Target Win Rate  : ${pureWinRate.toFixed(1)}%`);
  console.log(`Total Gross Profit    : +$${totalGrossProfit.toFixed(2)} USD`);
  console.log(`Total Gross Loss      : -$${totalGrossLoss.toFixed(2)} USD`);
  console.log(`Net Realized PnL      : +$${netPnl.toFixed(2)} USD`);
  console.log(`================================================================\n`);
}

async function main() {
  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD', 'XRPUSD'];
  await runVideoStrategiesBacktest(coins);
}

main().catch(console.error);
