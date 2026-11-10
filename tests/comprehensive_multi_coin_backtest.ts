import 'dotenv/config';
import { strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { quantMath } from '../lib/quantMathematicalEngine';
import { marketTraps } from '../lib/marketTrapsAndChopEngine';
import { SmartReversalDetector } from '../lib/smartReversalDetector';
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

export async function runBacktest(symbols: string[], minScore: number = 65) {
  console.log(`\n================================================================`);
  console.log(`🧪 RUNNING HISTORICAL BACKTEST ACROSS ${symbols.length} COINS (Score >= ${minScore})`);
  console.log(`================================================================`);

  let totalWins = 0;
  let totalLosses = 0;
  let totalBreakevens = 0;
  let totalGrossProfit = 0;
  let totalGrossLoss = 0;

  const coinStats: Record<string, { wins: number; losses: number; bes: number; pnl: number }> = {};

  for (const sym of symbols) {
    coinStats[sym] = { wins: 0, losses: 0, bes: 0, pnl: 0 };
    
    // Fetch 500 historical 15m candles (~5.2 days of continuous trading)
    const candles = await fetchCandles(sym, 500);
    if (!candles || candles.length < 100) {
      console.warn(`⚠️ Not enough candles for ${sym}: got ${candles?.length || 0}`);
      continue;
    }

    let activeTrade: {
      side: 'BUY' | 'SELL';
      entryPrice: number;
      entryBar: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      quantity: number;
      slDist: number;
      tpDist: number;
      atr: number;
      strategy: string;
      score: number;
      isBreakeven: boolean;
      highestPnl: number;
    } | null = null;

    let cooldownUntilBar = 0;

    for (let i = 50; i < candles.length - 1; i++) {
      const currentBar = candles[i];
      const nextBar = candles[i + 1];

      // 1. If in a trade, evaluate price action of currentBar against TP/SL
      if (activeTrade) {
        const { side, entryPrice, stopLossPrice, takeProfitPrice, quantity } = activeTrade;

        let isTPHit = false;
        let isSLHit = false;

        if (side === 'BUY') {
          const maxProfitPrice = currentBar.high;
          const floatingPeak = (maxProfitPrice - entryPrice) * quantity;
          if (floatingPeak > activeTrade.highestPnl) activeTrade.highestPnl = floatingPeak;

          // Stage 1: Breakeven lock at 35% progress ($0.35)
          if (activeTrade.highestPnl >= 0.35 && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice + (0.05 / quantity);
          }
          // Stage 2: Profit lock at 65% progress ($0.65)
          if (activeTrade.highestPnl >= 0.65) {
            activeTrade.stopLossPrice = Math.max(activeTrade.stopLossPrice, entryPrice + (0.40 / quantity));
          }

          if (currentBar.high >= takeProfitPrice) {
            isTPHit = true;
          } else if (currentBar.low <= activeTrade.stopLossPrice) {
            isSLHit = true;
          }
        } else {
          // SELL side
          const minProfitPrice = currentBar.low;
          const floatingPeak = (entryPrice - minProfitPrice) * quantity;
          if (floatingPeak > activeTrade.highestPnl) activeTrade.highestPnl = floatingPeak;

          // Stage 1: Breakeven lock at 35% progress ($0.35)
          if (activeTrade.highestPnl >= 0.35 && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice - (0.05 / quantity);
          }
          // Stage 2: Profit lock at 65% progress ($0.65)
          if (activeTrade.highestPnl >= 0.65) {
            activeTrade.stopLossPrice = Math.min(activeTrade.stopLossPrice, entryPrice - (0.40 / quantity));
          }

          if (currentBar.low <= takeProfitPrice) {
            isTPHit = true;
          } else if (currentBar.high >= activeTrade.stopLossPrice) {
            isSLHit = true;
          }
        }

        if (isTPHit) {
          const pnl = 1.00;
          totalWins++;
          coinStats[sym].wins++;
          coinStats[sym].pnl += pnl;
          totalGrossProfit += pnl;
          activeTrade = null;
          cooldownUntilBar = i + 3; // 3-bar (45 min) cooldown
          continue;
        } else if (isSLHit) {
          if (activeTrade.isBreakeven) {
            const pnl = 0.08;
            totalBreakevens++;
            coinStats[sym].bes++;
            coinStats[sym].pnl += pnl;
            totalGrossProfit += pnl;
          } else {
            const pnl = -0.55;
            totalLosses++;
            coinStats[sym].losses++;
            coinStats[sym].pnl += pnl;
            totalGrossLoss += 0.55;
          }
          activeTrade = null;
          cooldownUntilBar = i + 4; // 4-bar cooldown on loss
          continue;
        }
      }

      // 2. Scan for new entry if no active trade and not in cooldown
      if (!activeTrade && i >= cooldownUntilBar) {
        const historySlice = candles.slice(0, i + 1);
        if (historySlice.length < 35) continue;

        const closedHistory = historySlice.slice(0, -1);
        const lastClosed = closedHistory[closedHistory.length - 1];

        // Evaluate Strategy & Confluence
        const evalResult = strategyEngine.evaluateSymbol(sym, closedHistory);
        const dedicatedSide = evalResult?.signal || (evalResult as any)?.readySignal || null;
        const dedicatedContext = dedicatedSide ? {
          side: dedicatedSide as 'BUY' | 'SELL',
          strategyName: evalResult?.strategyName || '',
          waveValue: evalResult?.diagnostics?.waveValue,
        } : null;

        const mathVerdict = quantMath.evaluateMarketMath(sym, closedHistory, null, dedicatedContext);

        if (mathVerdict.marketRegime === 'CHAOS_NO_TRADE') continue;
        if (!mathVerdict.recommendedSide) continue;

        const side = mathVerdict.recommendedSide;
        const score = mathVerdict.quantScore;

        if (score < minScore) continue;

        // ATR & Safe Distance with generous breathing room
        const atr = evalResult?.diagnostics?.atr || Math.max(lastClosed.close * 0.008, 0.001);
        
        // Trap Defense
        const trapCheck = marketTraps.evaluateMarketTraps({
          symbol: sym,
          side,
          setupType: evalResult?.strategyName,
          marketStructure: mathVerdict.marketRegime === 'TREND'
            ? (mathVerdict.superSmootherSlope > 0 ? 'UPTREND' : 'DOWNTREND')
            : 'RANGE',
          candles: closedHistory,
          targetLevelPrice: lastClosed.close,
          microstructure: null,
        });

        if (trapCheck.isBlockedByTrap) continue;

        // Smart Reversal & Climax Filter
        const smart = SmartReversalDetector.evaluateTrade(
          sym,
          side,
          closedHistory,
          lastClosed.close,
          atr
        );

        if (smart.bias === 'REJECT') continue;

        // Enter trade at nextBar open
        const entryPrice = nextBar.open;
        const slPriceDistance = Math.max(2.0 * atr, entryPrice * 0.012);
        const MAX_LOSS_USD = 0.55;
        const TARGET_PROFIT_USD = 1.00;

        const quantity = parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4));
        if (quantity <= 0) continue;

        const tpPriceDistance = slPriceDistance * 1.5;

        const stopLossPrice = side === 'BUY' ? entryPrice - slPriceDistance : entryPrice + slPriceDistance;
        const takeProfitPrice = side === 'BUY' ? entryPrice + tpPriceDistance : entryPrice - tpPriceDistance;

        activeTrade = {
          side,
          entryPrice,
          entryBar: i + 1,
          stopLossPrice,
          takeProfitPrice,
          quantity,
          slDist: slPriceDistance,
          tpDist: tpPriceDistance,
          atr,
          strategy: evalResult?.strategyName || 'Quant Confluence',
          score,
          isBreakeven: false,
          highestPnl: 0,
        };
      }
    }

    const cWins = coinStats[sym].wins;
    const cLosses = coinStats[sym].losses;
    const cBes = coinStats[sym].bes;
    const cTotal = cWins + cLosses + cBes;
    const cWinRate = cTotal > 0 ? ((cWins + cBes) / cTotal) * 100 : 0;
    console.log(`📊 ${sym.padEnd(10)} | Trades: ${cTotal.toString().padStart(3)} | Wins: ${cWins.toString().padStart(2)} | Breakeven: ${cBes.toString().padStart(2)} | Losses: ${cLosses.toString().padStart(2)} | WinRate: ${cWinRate.toFixed(1)}% | Net PnL: $${coinStats[sym].pnl.toFixed(2)} USD`);
  }

  const grandTotal = totalWins + totalLosses + totalBreakevens;
  const grandWinRate = grandTotal > 0 ? ((totalWins + totalBreakevens) / grandTotal) * 100 : 0;
  const pureWinRate = grandTotal > 0 ? (totalWins / grandTotal) * 100 : 0;
  const profitFactor = totalGrossLoss > 0 ? (totalGrossProfit / totalGrossLoss) : totalGrossProfit;
  const netPnl = totalGrossProfit - totalGrossLoss;

  console.log(`\n================================================================`);
  console.log(`🏆 OVERALL BACKTEST PERFORMANCE SUMMARY (Min Score >= ${minScore})`);
  console.log(`================================================================`);
  console.log(`Total Completed Trades : ${grandTotal}`);
  console.log(`Full Profit Wins ($1) : ${totalWins}`);
  console.log(`Breakeven Green Exits : ${totalBreakevens}`);
  console.log(`Losses (-$0.55)        : ${totalLosses}`);
  console.log(`Effective Win Rate     : ${grandWinRate.toFixed(1)}% (Wins + Protected BE)`);
  console.log(`Pure Target Win Rate   : ${pureWinRate.toFixed(1)}% (Target $1.00 Hits)`);
  console.log(`Profit Factor          : ${profitFactor.toFixed(2)}`);
  console.log(`Total Gross Profit     : +$${totalGrossProfit.toFixed(2)} USD`);
  console.log(`Total Gross Loss       : -$${totalGrossLoss.toFixed(2)} USD`);
  console.log(`Net Realized PnL       : +$${netPnl.toFixed(2)} USD`);
  console.log(`================================================================\n`);

  return { grandWinRate, pureWinRate, profitFactor, netPnl, grandTotal };
}

async function main() {
  const testCoins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD', 'ADAUSD', 'LINKUSD', 'NEARUSD', 'APTUSD'];
  
  console.log('Testing Entry Threshold: Score >= 60...');
  const res60 = await runBacktest(testCoins, 60);

  console.log('Testing Entry Threshold: Score >= 65...');
  const res65 = await runBacktest(testCoins, 65);

  console.log('Testing Entry Threshold: Score >= 70...');
  const res70 = await runBacktest(testCoins, 70);
}

main().catch(console.error);
