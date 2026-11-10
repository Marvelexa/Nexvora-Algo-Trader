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

async function debugTradesForCoin(sym: string) {
  console.log(`\n================ DEBUG TRADES FOR ${sym} (Score >= 70) ================`);
  const candles = await fetchCandles(sym, 500);
  if (!candles || candles.length < 100) return;

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
        if (activeTrade.highestPnl >= 0.55 && !activeTrade.isBreakeven) {
          activeTrade.isBreakeven = true;
          activeTrade.stopLossPrice = entryPrice + (0.08 / quantity);
        }
        if (currentBar.high >= takeProfitPrice) isTPHit = true;
        else if (currentBar.low <= activeTrade.stopLossPrice) isSLHit = true;
      } else {
        const floatingPeak = (entryPrice - currentBar.low) * quantity;
        if (floatingPeak > activeTrade.highestPnl) activeTrade.highestPnl = floatingPeak;
        if (activeTrade.highestPnl >= 0.55 && !activeTrade.isBreakeven) {
          activeTrade.isBreakeven = true;
          activeTrade.stopLossPrice = entryPrice - (0.08 / quantity);
        }
        if (currentBar.low <= takeProfitPrice) isTPHit = true;
        else if (currentBar.high >= activeTrade.stopLossPrice) isSLHit = true;
      }

      if (isTPHit) {
        console.log(`✅ [Bar ${i}] WIN: ${side} Entry=$${entryPrice.toFixed(2)} -> TP Hit ($1.00)`);
        activeTrade = null;
        cooldownUntil = i + 3;
        continue;
      } else if (isSLHit) {
        if (activeTrade.isBreakeven) {
          console.log(`🛡️ [Bar ${i}] BREAKEVEN: ${side} Entry=$${entryPrice.toFixed(2)} -> BE Hit (+$0.08)`);
        } else {
          console.log(`❌ [Bar ${i}] LOSS: ${side} Entry=$${entryPrice.toFixed(2)} -> SL Hit (-$0.55) | Reason: ${activeTrade.reasons.slice(0, 2).join(' | ')}`);
        }
        activeTrade = null;
        cooldownUntil = i + 4;
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

      if (score < 70) continue;

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
      const slPriceDistance = Math.max(1.75 * atr, entryPrice * 0.012);
      const MAX_LOSS_USD = 0.55;
      const TARGET_PROFIT_USD = 1.00;

      const quantity = parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4));
      if (quantity <= 0) continue;

      const tpPriceDistance = Math.max(TARGET_PROFIT_USD / quantity, slPriceDistance * 1.6);
      const stopLossPrice = side === 'BUY' ? entryPrice - slPriceDistance : entryPrice + slPriceDistance;
      const takeProfitPrice = side === 'BUY' ? entryPrice + tpPriceDistance : entryPrice - tpPriceDistance;

      console.log(`🚀 [Bar ${i}] ENTER ${side} Score=${score} Price=$${entryPrice.toFixed(2)} SL=$${stopLossPrice.toFixed(2)} TP=$${takeProfitPrice.toFixed(2)}`);
      activeTrade = {
        side,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        quantity,
        isBreakeven: false,
        highestPnl: 0,
        reasons: mathVerdict.reasons,
      };
    }
  }
}

async function main() {
  await debugTradesForCoin('SOLUSD');
  await debugTradesForCoin('SUIUSD');
  await debugTradesForCoin('APTUSD');
}

main().catch(console.error);
