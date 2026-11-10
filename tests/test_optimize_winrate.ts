import 'dotenv/config';
import { strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { quantMath } from '../lib/quantMathematicalEngine';
import { marketTraps } from '../lib/marketTrapsAndChopEngine';
import { SmartReversalDetector } from '../lib/smartReversalDetector';
import { KlinePoint } from '../src/types';

async function fetchCandles(symbol: string, limit: number = 600): Promise<KlinePoint[]> {
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

async function runOptimizationExperiment(config: {
  name: string;
  minScore: number;
  trendOnly: boolean;
  macroTrendAlignedOnly: boolean;
  atrBreathingRoom: number;
  tpAtrMultiplier: number;
  trailingMode: 'FIXED_BE' | 'TRAILING_HALF_PROFIT' | 'NO_EARLY_BE';
}) {
  const symbols = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD', 'ADAUSD', 'LINKUSD', 'NEARUSD', 'APTUSD'];
  
  let totalWins = 0;
  let totalLosses = 0;
  let totalBEs = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (const sym of symbols) {
    const candles = await fetchCandles(sym, 500);
    if (!candles || candles.length < 100) continue;

    let activeTrade: any = null;
    let cooldownUntil = 0;

    for (let i = 50; i < candles.length - 1; i++) {
      const currentBar = candles[i];
      const nextBar = candles[i + 1];

      if (activeTrade) {
        const { side, entryPrice, quantity } = activeTrade;

        if (side === 'BUY') {
          const peak = (currentBar.high - entryPrice) * quantity;
          if (peak > activeTrade.highestPnl) activeTrade.highestPnl = peak;

          if (config.trailingMode === 'FIXED_BE') {
            if (activeTrade.highestPnl >= 0.55 && !activeTrade.isBreakeven) {
              activeTrade.isBreakeven = true;
              activeTrade.stopLossPrice = entryPrice + (0.08 / quantity);
            }
          } else if (config.trailingMode === 'TRAILING_HALF_PROFIT') {
            if (activeTrade.highestPnl >= 0.60) {
              activeTrade.isBreakeven = true;
              activeTrade.stopLossPrice = Math.max(activeTrade.stopLossPrice, entryPrice + (0.30 / quantity));
            }
          }

          if (currentBar.high >= activeTrade.takeProfitPrice) {
            totalWins++;
            grossProfit += 1.00;
            activeTrade = null;
            cooldownUntil = i + 2;
            continue;
          } else if (currentBar.low <= activeTrade.stopLossPrice) {
            if (activeTrade.isBreakeven) {
              totalBEs++;
              grossProfit += (activeTrade.stopLossPrice - entryPrice) * quantity;
            } else {
              totalLosses++;
              grossLoss += 0.55;
            }
            activeTrade = null;
            cooldownUntil = i + 3;
            continue;
          }
        } else {
          // SELL side
          const peak = (entryPrice - currentBar.low) * quantity;
          if (peak > activeTrade.highestPnl) activeTrade.highestPnl = peak;

          if (config.trailingMode === 'FIXED_BE') {
            if (activeTrade.highestPnl >= 0.55 && !activeTrade.isBreakeven) {
              activeTrade.isBreakeven = true;
              activeTrade.stopLossPrice = entryPrice - (0.08 / quantity);
            }
          } else if (config.trailingMode === 'TRAILING_HALF_PROFIT') {
            if (activeTrade.highestPnl >= 0.60) {
              activeTrade.isBreakeven = true;
              activeTrade.stopLossPrice = Math.min(activeTrade.stopLossPrice, entryPrice - (0.30 / quantity));
            }
          }

          if (currentBar.low <= activeTrade.takeProfitPrice) {
            totalWins++;
            grossProfit += 1.00;
            activeTrade = null;
            cooldownUntil = i + 2;
            continue;
          } else if (currentBar.high >= activeTrade.stopLossPrice) {
            if (activeTrade.isBreakeven) {
              totalBEs++;
              grossProfit += (entryPrice - activeTrade.stopLossPrice) * quantity;
            } else {
              totalLosses++;
              grossLoss += 0.55;
            }
            activeTrade = null;
            cooldownUntil = i + 3;
            continue;
          }
        }
      }

      if (!activeTrade && i >= cooldownUntil) {
        const historySlice = candles.slice(0, i + 1);
        const closedHistory = historySlice.slice(0, -1);
        const lastClosed = closedHistory[closedHistory.length - 1];

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

        if (config.trendOnly && mathVerdict.marketRegime !== 'TREND') continue;

        const side = mathVerdict.recommendedSide;
        const score = mathVerdict.quantScore;

        if (score < config.minScore) continue;

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

        // Smart Reversal
        const smart = SmartReversalDetector.evaluateTrade(
          sym,
          side,
          closedHistory,
          lastClosed.close,
          atr
        );

        if (smart.bias === 'REJECT') continue;

        const entryPrice = nextBar.open;
        const slPriceDistance = Math.max(config.atrBreathingRoom * atr, entryPrice * 0.012);
        const MAX_LOSS_USD = 0.55;
        const TARGET_PROFIT_USD = 1.00;

        const quantity = parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4));
        if (quantity <= 0) continue;

        const tpPriceDistance = Math.max(TARGET_PROFIT_USD / quantity, slPriceDistance * config.tpAtrMultiplier);

        const stopLossPrice = side === 'BUY' ? entryPrice - slPriceDistance : entryPrice + slPriceDistance;
        const takeProfitPrice = side === 'BUY' ? entryPrice + tpPriceDistance : entryPrice - tpPriceDistance;

        activeTrade = {
          side,
          entryPrice,
          stopLossPrice,
          takeProfitPrice,
          quantity,
          isBreakeven: false,
          highestPnl: 0,
        };
      }
    }
  }

  const grandTotal = totalWins + totalLosses + totalBEs;
  const winRate = grandTotal > 0 ? ((totalWins + totalBEs) / grandTotal) * 100 : 0;
  const pureWinRate = grandTotal > 0 ? (totalWins / grandTotal) * 100 : 0;
  const netPnl = grossProfit - grossLoss;
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

  console.log(`\n========================================================`);
  console.log(`Experiment: [${config.name}]`);
  console.log(`Total Trades: ${grandTotal} | Wins: ${totalWins} | BEs: ${totalBEs} | Losses: ${totalLosses}`);
  console.log(`Effective Win Rate: ${winRate.toFixed(1)}% | Pure Target Win Rate: ${pureWinRate.toFixed(1)}%`);
  console.log(`Gross Profit: +$${grossProfit.toFixed(2)} | Gross Loss: -$${grossLoss.toFixed(2)} | Net PnL: +$${netPnl.toFixed(2)} | PF: ${pf.toFixed(2)}`);
  console.log(`========================================================`);
}

async function testAll() {
  console.log('--- RUNNING WIN RATE OPTIMIZATION EXPERIMENTS ---');

  // Exp 1: Baseline (MinScore 65, Breathing Room 1.75 ATR, Fixed BE)
  await runOptimizationExperiment({
    name: '1. Baseline Score 65 (Breathing Room 1.75 ATR)',
    minScore: 65,
    trendOnly: false,
    macroTrendAlignedOnly: false,
    atrBreathingRoom: 1.75,
    tpAtrMultiplier: 1.6,
    trailingMode: 'FIXED_BE',
  });

  // Exp 2: Trend Regime Filter Only (Trade only in verified trend momentum)
  await runOptimizationExperiment({
    name: '2. Trend Regime Filter Only (Score 65)',
    minScore: 65,
    trendOnly: true,
    macroTrendAlignedOnly: false,
    atrBreathingRoom: 1.75,
    tpAtrMultiplier: 1.6,
    trailingMode: 'FIXED_BE',
  });

  // Exp 3: Wider Breathing Room (2.2 ATR) + Trailing Profit
  await runOptimizationExperiment({
    name: '3. Generous 2.2 ATR Breathing Room + Trailing Half Profit',
    minScore: 65,
    trendOnly: false,
    macroTrendAlignedOnly: false,
    atrBreathingRoom: 2.2,
    tpAtrMultiplier: 1.4,
    trailingMode: 'TRAILING_HALF_PROFIT',
  });

  // Exp 4: High Conviction (Score >= 70) + 2.0 ATR Breathing Room
  await runOptimizationExperiment({
    name: '4. High Conviction Score 70 + 2.0 ATR Breathing Room',
    minScore: 70,
    trendOnly: false,
    macroTrendAlignedOnly: false,
    atrBreathingRoom: 2.0,
    tpAtrMultiplier: 1.5,
    trailingMode: 'TRAILING_HALF_PROFIT',
  });

  // Exp 5: Strict Trend + Score >= 65 + 2.0 ATR Breathing Room
  await runOptimizationExperiment({
    name: '5. Trend Regime + Score 65 + 2.0 ATR Breathing Room',
    minScore: 65,
    trendOnly: true,
    macroTrendAlignedOnly: false,
    atrBreathingRoom: 2.0,
    tpAtrMultiplier: 1.5,
    trailingMode: 'TRAILING_HALF_PROFIT',
  });
}

testAll().catch(console.error);
