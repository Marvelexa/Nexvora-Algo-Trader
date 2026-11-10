import 'dotenv/config';
import { strategyEngine, CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
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

/**
 * Pure Price Action Structural Trend (Dow Theory HH/HL vs LH/LL):
 * 100% Indicator-Free. Analyzes actual swing highs and swing lows!
 */
function getPurePriceActionMacroTrend(candles: KlinePoint[]): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' {
  const n = candles.length;
  if (n < 40) return 'SIDEWAYS';
  
  const window = candles.slice(-50);
  const swingHighs: { price: number; idx: number }[] = [];
  const swingLows: { price: number; idx: number }[] = [];

  for (let i = 2; i < window.length - 2; i++) {
    const c = window[i];
    if (c.high >= window[i - 1].high && c.high >= window[i - 2].high && c.high >= window[i + 1].high && c.high >= window[i + 2].high) {
      swingHighs.push({ price: c.high, idx: i });
    }
    if (c.low <= window[i - 1].low && c.low <= window[i - 2].low && c.low <= window[i + 1].low && c.low <= window[i + 2].low) {
      swingLows.push({ price: c.low, idx: i });
    }
  }

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastHigh = swingHighs[swingHighs.length - 1].price;
    const prevHigh = swingHighs[swingHighs.length - 2].price;
    const lastLow = swingLows[swingLows.length - 1].price;
    const prevLow = swingLows[swingLows.length - 2].price;

    if (lastHigh < prevHigh && lastLow < prevLow) {
      return 'BEARISH'; // Lower Highs + Lower Lows
    } else if (lastHigh > prevHigh && lastLow > prevLow) {
      return 'BULLISH'; // Higher Highs + Higher Lows
    }
  }

  // Fallback to 40-bar SuperSmoother slope (DSP zero-lag)
  const closes = window.map(c => c.close);
  const smooth40 = quantMath.calculateSuperSmoother(closes, 30);
  const lastS = smooth40[smooth40.length - 1] || closes[closes.length - 1];
  const prevS = smooth40[smooth40.length - 3] || lastS;
  const slope = ((lastS - prevS) / (prevS || 1)) * 100;

  if (slope > 0.05) return 'BULLISH';
  if (slope < -0.05) return 'BEARISH';
  return 'SIDEWAYS';
}

async function runTest() {
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
          const peak = (currentBar.high - entryPrice) * quantity;
          if (peak > activeTrade.highestPnl) activeTrade.highestPnl = peak;

          if (activeTrade.highestPnl >= 0.55 && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice + (0.08 / quantity);
          }

          if (currentBar.high >= takeProfitPrice) isTPHit = true;
          else if (currentBar.low <= activeTrade.stopLossPrice) isSLHit = true;
        } else {
          const peak = (entryPrice - currentBar.low) * quantity;
          if (peak > activeTrade.highestPnl) activeTrade.highestPnl = peak;

          if (activeTrade.highestPnl >= 0.55 && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice - (0.08 / quantity);
          }

          if (currentBar.low <= takeProfitPrice) isTPHit = true;
          else if (currentBar.high >= activeTrade.stopLossPrice) isSLHit = true;
        }

        if (isTPHit) {
          totalWins++;
          grossProfit += 1.00;
          activeTrade = null;
          cooldownUntil = i + 2;
          continue;
        } else if (isSLHit) {
          if (activeTrade.isBreakeven) {
            totalBEs++;
            grossProfit += 0.08;
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

        const paMacroTrend = getPurePriceActionMacroTrend(closedHistory);

        // Evaluate Strategy & Confluence without lagging indicators
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

        let side = mathVerdict.recommendedSide;
        let score = mathVerdict.quantScore;

        // Apply Pure Price Action Macro Trend Steering
        if (paMacroTrend === 'BEARISH' && side === 'BUY') {
          continue; // Block counter-trend knife catching in structural downtrend
        } else if (paMacroTrend === 'BULLISH' && side === 'SELL') {
          continue; // Block counter-trend shorting in structural uptrend
        }

        if (score < 65) continue;

        const atr = evalResult?.diagnostics?.atr || Math.max(lastClosed.close * 0.008, 0.001);

        const trapCheck = marketTraps.evaluateMarketTraps({
          symbol: sym,
          side,
          setupType: evalResult?.strategyName,
          marketStructure: paMacroTrend === 'BEARISH' ? 'DOWNTREND' : paMacroTrend === 'BULLISH' ? 'UPTREND' : 'RANGE',
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
        const slPriceDistance = Math.max(2.5 * atr, entryPrice * 0.020);
        const MAX_LOSS_USD = 0.55;
        const TARGET_PROFIT_USD = 1.00;

        const quantity = parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4));
        if (quantity <= 0) continue;

        const tpPriceDistance = Math.max(TARGET_PROFIT_USD / quantity, slPriceDistance * 1.6);
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
  const pf = grossLoss > 0 ? (grossProfit / grossLoss) : grossProfit;
  const netPnl = grossProfit - grossLoss;

  console.log(`\n========================================================`);
  console.log(`⚡ PURE PRICE ACTION & ZERO-LAG MODEL RESULTS`);
  console.log(`========================================================`);
  console.log(`Total Trades: ${grandTotal} | Wins: ${totalWins} | BE: ${totalBEs} | Loss: ${totalLosses}`);
  console.log(`Effective Win Rate: ${winRate.toFixed(1)}% | Pure Target Win Rate: ${pureWinRate.toFixed(1)}%`);
  console.log(`Profit Factor: ${pf.toFixed(2)} | Net PnL: $${netPnl.toFixed(2)} USD`);
  console.log(`========================================================\n`);
}

runTest().catch(console.error);
