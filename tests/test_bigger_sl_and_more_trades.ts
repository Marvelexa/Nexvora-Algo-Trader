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

interface TestConfig {
  name: string;
  minScore: number;
  slAtrMult: number;
  slMinPct: number;
  tpUsd: number;
  beTriggerUsd: number;
}

async function testConfiguration(config: TestConfig) {
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
        const { side, entryPrice, stopLossPrice, takeProfitPrice, quantity } = activeTrade;
        let isTPHit = false;
        let isSLHit = false;

        if (side === 'BUY') {
          const floatingPeak = (currentBar.high - entryPrice) * quantity;
          if (floatingPeak > activeTrade.highestPnl) activeTrade.highestPnl = floatingPeak;

          // Breakeven check
          if (activeTrade.highestPnl >= config.beTriggerUsd && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice + (0.05 / quantity);
          }

          if (currentBar.high >= takeProfitPrice) isTPHit = true;
          else if (currentBar.low <= activeTrade.stopLossPrice) isSLHit = true;
        } else {
          const floatingPeak = (entryPrice - currentBar.low) * quantity;
          if (floatingPeak > activeTrade.highestPnl) activeTrade.highestPnl = floatingPeak;

          if (activeTrade.highestPnl >= config.beTriggerUsd && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice - (0.05 / quantity);
          }

          if (currentBar.low <= takeProfitPrice) isTPHit = true;
          else if (currentBar.high >= activeTrade.stopLossPrice) isSLHit = true;
        }

        if (isTPHit) {
          totalWins++;
          grossProfit += config.tpUsd;
          activeTrade = null;
          cooldownUntil = i + 1; // Faster turnover for small opportunities
          continue;
        } else if (isSLHit) {
          if (activeTrade.isBreakeven) {
            totalBEs++;
            grossProfit += 0.05;
          } else {
            totalLosses++;
            grossLoss += 0.55;
          }
          activeTrade = null;
          cooldownUntil = i + 3;
          continue;
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

        const side = mathVerdict.recommendedSide;
        const score = mathVerdict.quantScore;

        if (score < config.minScore) continue;

        const atr = evalResult?.diagnostics?.atr || Math.max(lastClosed.close * 0.008, 0.001);

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

        const smart = SmartReversalDetector.evaluateReversalOrDirect(
          sym,
          side,
          closedHistory,
          lastClosed.close,
          atr
        );

        if (smart.bias === 'REJECT') continue;

        const entryPrice = nextBar.open;
        // BIGGER BREATHING ROOM FOR SL
        const slPriceDistance = Math.max(config.slAtrMult * atr, entryPrice * config.slMinPct);
        const MAX_LOSS_USD = 0.55;

        // Position sizing guarantees MAX_LOSS_USD
        const quantity = parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4));
        if (quantity <= 0) continue;

        const tpPriceDistance = parseFloat((config.tpUsd / quantity).toFixed(4));
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
  const pf = grossLoss > 0 ? (grossProfit / grossLoss) : grossProfit;

  console.log(`\n========================================================`);
  console.log(`📌 CONFIG: ${config.name}`);
  console.log(`Trades: ${grandTotal} | Wins: ${totalWins} | BE: ${totalBEs} | Loss: ${totalLosses}`);
  console.log(`Effective Win Rate: ${winRate.toFixed(1)}% | Pure Target Win Rate: ${pureWinRate.toFixed(1)}%`);
  console.log(`Profit Factor: ${pf.toFixed(2)} | Net PnL: $${netPnl.toFixed(2)} USD`);
  console.log(`========================================================`);
}

async function main() {
  // Test 1: Bigger SL (2.5 ATR, min 1.5%), Score >= 60, Target $0.75
  await testConfiguration({
    name: 'SL 2.5 ATR | Score >= 60 | Target $0.75',
    minScore: 60,
    slAtrMult: 2.5,
    slMinPct: 0.015,
    tpUsd: 0.75,
    beTriggerUsd: 0.45,
  });

  // Test 2: Bigger SL (2.5 ATR, min 1.5%), Score >= 60, Target $1.00
  await testConfiguration({
    name: 'SL 2.5 ATR | Score >= 60 | Target $1.00',
    minScore: 60,
    slAtrMult: 2.5,
    slMinPct: 0.015,
    tpUsd: 1.00,
    beTriggerUsd: 0.55,
  });

  // Test 3: Maximum Breathing Room (3.0 ATR, min 2.0%), Score >= 55, Target $0.75
  await testConfiguration({
    name: 'SL 3.0 ATR | Score >= 55 | Target $0.75',
    minScore: 55,
    slAtrMult: 3.0,
    slMinPct: 0.020,
    tpUsd: 0.75,
    beTriggerUsd: 0.45,
  });

  // Test 4: Maximum Breathing Room (3.0 ATR, min 2.0%), Score >= 60, Target $0.80
  await testConfiguration({
    name: 'SL 3.0 ATR | Score >= 60 | Target $0.80',
    minScore: 60,
    slAtrMult: 3.0,
    slMinPct: 0.020,
    tpUsd: 0.80,
    beTriggerUsd: 0.50,
  });
}

main().catch(console.error);
