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
 * Pure Zero-Lag & Price Action Evaluation (No 50/100/200 Lagging EMAs, No Lagging RSI)
 */
function evaluateZeroLagPriceAction(candles: KlinePoint[]) {
  const closes = candles.map(c => c.close);
  const n = closes.length;
  if (n < 30) return null;

  const lastBar = candles[n - 1];
  const prevBar = candles[n - 2];
  const currentPrice = lastBar.close;

  // 1. Zero-Lag 2-Pole SuperSmoother (DSP noise reduction with zero lag)
  const smooth = quantMath.calculateSuperSmoother(closes, 10);
  const curSmooth = smooth[smooth.length - 1] || currentPrice;
  const prevSmooth = smooth[smooth.length - 2] || curSmooth;
  const smoothSlope = ((curSmooth - prevSmooth) / (prevSmooth || 1)) * 100;

  // 2. Adaptive Kalman Optimal State Estimator (Zero-lag recursive tracking)
  const kalman = quantMath.calculateKalmanFilter(closes);
  const kalmanPrice = kalman[kalman.length - 1] || currentPrice;
  const kalmanDev = ((currentPrice - kalmanPrice) / (kalmanPrice || 1)) * 100;

  // 3. Pure Price Action Swing Pivots (Market Structure: Break of Structure & Liquidity)
  const sr = quantMath.calculateSupportResistance(candles);

  // 4. Real-time Candlestick Wick Absorption / Exhaustion Delta
  const barRange = Math.max(lastBar.high - lastBar.low, 0.0001);
  const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
  const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
  const lowerWickRatio = lowerWick / barRange;
  const upperWickRatio = upperWick / barRange;

  // 5. Zero-Lag Nexvora Future Momentum & Predictive Wave
  const nexPredict = CryptoDedicatedStrategyEngine.evaluateNexvoraQuantumFuturePredictor(candles);

  // 6. Zero-Lag Fisher Transform
  const fisherArr = quantMath.calculateFisherTransform(candles, 10);
  const fisher = fisherArr.fisher[fisherArr.fisher.length - 1] || 0;
  const fishSig = fisherArr.signal[fisherArr.signal.length - 1] || 0;

  // Voting without ANY lagging moving averages or slow RSI:
  let buyScore = 0;
  let sellScore = 0;

  // Metric 1: Zero-Lag Momentum Velocity (SuperSmoother + Kalman)
  if (smoothSlope > 0.02 && currentPrice >= kalmanPrice) {
    buyScore += 25;
  } else if (smoothSlope < -0.02 && currentPrice <= kalmanPrice) {
    sellScore += 25;
  }

  // Metric 2: Nexvora Predictive Acceleration (d²P/dt²)
  if (nexPredict.scaledHist > 0 && nexPredict.scaledWave > nexPredict.scaledSignal) {
    buyScore += 25;
  } else if (nexPredict.scaledHist < 0 && nexPredict.scaledWave < nexPredict.scaledSignal) {
    sellScore += 25;
  }

  // Metric 3: Real-Time Price Action Structure (Support Bounce vs Resistance Rejection)
  if (sr.supportBounceConfirmed || (sr.isAtSupport && lowerWickRatio >= 0.20)) {
    buyScore += 25;
  } else if (sr.supportBreakConfirmed) {
    sellScore += 25; // Breakdown momentum
  }

  if (sr.resistanceRejectConfirmed || (sr.isAtResistance && upperWickRatio >= 0.20)) {
    sellScore += 25;
  } else if (sr.resistanceBreakConfirmed) {
    buyScore += 25; // Breakout momentum
  }

  // Metric 4: Real-Time Volume Absorption & Fisher Inflection
  if (lowerWickRatio >= 0.30 && lastBar.volume >= prevBar.volume * 0.85) {
    buyScore += 25; // Buyers absorbed sellers at lows
  } else if (fisher > fishSig && fisher <= -0.5) {
    buyScore += 15;
  }

  if (upperWickRatio >= 0.30 && lastBar.volume >= prevBar.volume * 0.85) {
    sellScore += 25; // Sellers absorbed buyers at highs
  } else if (fisher < fishSig && fisher >= 0.5) {
    sellScore += 15;
  }

  // Universal Macro Trend Steering
  if (sr.macroTrend === 'BEARISH') {
    buyScore = Math.min(buyScore, 40);
  } else if (sr.macroTrend === 'BULLISH') {
    sellScore = Math.min(sellScore, 40);
  }

  const score = Math.max(buyScore, sellScore);
  const side: 'BUY' | 'SELL' | null = (buyScore >= 60 && buyScore > sellScore) ? 'BUY' : (sellScore >= 60 && sellScore > buyScore) ? 'SELL' : null;

  return { side, score, atr: sr.atr };
}

async function runZeroLagBacktest() {
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

        const verdict = evaluateZeroLagPriceAction(closedHistory);
        if (!verdict || !verdict.side || verdict.score < 60) continue;

        const atr = verdict.atr || Math.max(lastClosed.close * 0.008, 0.001);

        const trapCheck = marketTraps.evaluateMarketTraps({
          symbol: sym,
          side: verdict.side,
          setupType: 'ZERO_LAG_PRICE_ACTION',
          marketStructure: 'UPTREND',
          candles: closedHistory,
          targetLevelPrice: lastClosed.close,
          microstructure: null,
        });

        if (trapCheck.isBlockedByTrap) continue;

        const entryPrice = nextBar.open;
        // Enlarged 2.5 ATR Breathing room
        const slPriceDistance = Math.max(2.5 * atr, entryPrice * 0.020);
        const MAX_LOSS_USD = 0.55;
        const TARGET_PROFIT_USD = 1.00;

        const quantity = parseFloat((MAX_LOSS_USD / slPriceDistance).toFixed(4));
        if (quantity <= 0) continue;

        const tpPriceDistance = Math.max(TARGET_PROFIT_USD / quantity, slPriceDistance * 1.6);
        const stopLossPrice = verdict.side === 'BUY' ? entryPrice - slPriceDistance : entryPrice + slPriceDistance;
        const takeProfitPrice = verdict.side === 'BUY' ? entryPrice + tpPriceDistance : entryPrice - tpPriceDistance;

        activeTrade = {
          side: verdict.side,
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
  console.log(`⚡ ZERO-LAG & PURE PRICE ACTION MODEL RESULTS`);
  console.log(`========================================================`);
  console.log(`Total Trades: ${grandTotal} | Wins: ${totalWins} | BE: ${totalBEs} | Loss: ${totalLosses}`);
  console.log(`Effective Win Rate: ${winRate.toFixed(1)}% | Pure Target Win Rate: ${pureWinRate.toFixed(1)}%`);
  console.log(`Profit Factor: ${pf.toFixed(2)} | Net PnL: $${netPnl.toFixed(2)} USD`);
  console.log(`========================================================\n`);
}

runZeroLagBacktest().catch(console.error);
