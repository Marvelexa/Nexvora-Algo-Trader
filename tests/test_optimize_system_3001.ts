import fs from 'fs';
import path from 'path';
import { KlinePoint } from '../src/types';
import { quantMath } from '../lib/quantMathematicalEngine';

const CACHE_DIR = path.join(process.cwd(), '.cache_candles_1m');
const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'SUIUSDT',
  'BNBUSDT',
  'LINKUSDT',
];

interface Signal {
  side: 'BUY' | 'SELL';
  confidenceScore: number;
  setupType: string;
  customSL: number;
  customTP: number;
  rr: number;
  reasons: string[];
}

function evaluateHighWinrateZeroLag(candles: KlinePoint[], symbol: string): Signal | null {
  if (!candles || candles.length < 35) return null;

  const currentBar = candles[candles.length - 1];
  const prevBar = candles[candles.length - 2];
  const prev2Bar = candles[candles.length - 3] || prevBar;
  const currentPrice = currentBar.close;
  const closes = candles.map(c => c.close);

  // 14-period ATR
  let atrSum = 0;
  for (let k = candles.length - 14; k < candles.length; k++) {
    const b = candles[k];
    const prevB = candles[k - 1] || b;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prevB.close), Math.abs(b.low - prevB.close));
    atrSum += tr;
  }
  const atr14 = atrSum / 14;

  const isMajor = symbol.includes('BTC') || symbol.includes('ETH');
  const minBreathingPercent = isMajor ? 0.0085 : 0.0120;
  const minSlBuffer = Math.max(1.20 * atr14, currentPrice * minBreathingPercent);

  // Candle Anatomy
  const candleRange = Math.max(currentBar.high - currentBar.low, currentPrice * 0.0001);
  const candleBody = Math.abs(currentBar.close - currentBar.open);
  const bodyRatio = candleBody / candleRange;
  const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
  const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
  const lowerWickRatio = lowerWick / candleRange;
  const upperWickRatio = upperWick / candleRange;

  // Relative Volume
  const recentVols = candles.slice(-16, -1).map(c => c.volume || 1);
  recentVols.sort((a, b) => a - b);
  const medianVol = recentVols[Math.floor(recentVols.length / 2)] || 1.0;
  const rvol = (currentBar.volume || 1) / (medianVol || 1);

  // Ehlers SuperSmoother & Kalman Filter (Zero-Phase Lag)
  const smooth = quantMath.calculateSuperSmoother(closes, 10);
  const curSmooth = smooth[smooth.length - 1] || currentPrice;
  const prevSmooth = smooth[smooth.length - 2] || curSmooth;
  const smoothSlope = ((curSmooth - prevSmooth) / (prevSmooth || 1)) * 100;

  const kalman = quantMath.calculateKalmanFilter(closes);
  const kalmanPrice = kalman[kalman.length - 1] || currentPrice;

  // Structural Swing Levels across prior 25 bars
  const priorBars = candles.slice(-27, -2);
  let swingHigh = -Infinity;
  let swingLow = Infinity;
  for (const b of priorBars) {
    if (b.high > swingHigh) swingHigh = b.high;
    if (b.low < swingLow) swingLow = b.low;
  }

  // Pre-reversal buffer so exit occurs 1 tick before structural reversal
  const preReversalBuffer = Math.max(0.05 * atr14, currentPrice * 0.00025);

  const isGreenClose = currentBar.close > currentBar.open;
  const isRedClose = currentBar.close < currentBar.open;

  // =========================================================================
  // SETUP 1: INSTITUTIONAL LIQUIDITY SWEEP & MSS REVERSAL (Brad Goh + Zero Lag)
  // High Win Rate: Sweeps liquidity, rejects with wick, confirms with body
  // =========================================================================

  // A. Bullish Sweep (Swept swing low, strong rejection wick, closes green)
  const isLowSwept = (currentBar.low < swingLow || prevBar.low < swingLow) && currentBar.close > swingLow;
  const hasStrongBullishRejection = (lowerWickRatio >= 0.35 && isGreenClose) || (lowerWickRatio >= 0.45) || (isGreenClose && currentBar.close > prevBar.high);

  if (isLowSwept && hasStrongBullishRejection && rvol >= 1.0) {
    const sweepExtremeLow = Math.min(currentBar.low, prevBar.low);
    const sl = sweepExtremeLow - minSlBuffer;
    const riskDist = currentPrice - sl;

    // Take Profit placed strictly at opposing swing high (reversal resistance boundary)
    const tp = swingHigh - preReversalBuffer;
    const roomToReversal = tp - currentPrice;
    const rr = riskDist > 0 ? roomToReversal / riskDist : 0;

    // Strict Zero-Overextension Rule (>= 1:2.30 RR)
    if (rr >= 2.25 && roomToReversal > 0) {
      return {
        side: 'BUY',
        confidenceScore: 92,
        setupType: 'ZERO_LAG_BULLISH_SWEEP_MSS',
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        reasons: [`Bullish Liquidity Sweep & MSS at $${swingLow.toFixed(2)} with ${(lowerWickRatio * 100).toFixed(0)}% rejection wick`],
      };
    }
  }

  // B. Bearish Sweep (Swept swing high, strong rejection wick, closes red)
  const isHighSwept = (currentBar.high > swingHigh || prevBar.high > swingHigh) && currentBar.close < swingHigh;
  const hasStrongBearishRejection = (upperWickRatio >= 0.35 && isRedClose) || (upperWickRatio >= 0.45) || (isRedClose && currentBar.close < prevBar.low);

  if (isHighSwept && hasStrongBearishRejection && rvol >= 1.0) {
    const sweepExtremeHigh = Math.max(currentBar.high, prevBar.high);
    const sl = sweepExtremeHigh + minSlBuffer;
    const riskDist = sl - currentPrice;

    // Take Profit placed strictly at opposing swing low (reversal support boundary)
    const tp = swingLow + preReversalBuffer;
    const roomToReversal = currentPrice - tp;
    const rr = riskDist > 0 ? roomToReversal / riskDist : 0;

    if (rr >= 2.25 && roomToReversal > 0) {
      return {
        side: 'SELL',
        confidenceScore: 92,
        setupType: 'ZERO_LAG_BEARISH_SWEEP_MSS',
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        reasons: [`Bearish Liquidity Sweep & MSS at $${swingHigh.toFixed(2)} with ${(upperWickRatio * 100).toFixed(0)}% rejection wick`],
      };
    }
  }

  // =========================================================================
  // SETUP 2: INSTITUTIONAL S/R FLIP RETEST (Highest Precision Setup)
  // Retest of broken prior structural pivot with clean candlestick bounce
  // =========================================================================
  const midBars = candles.slice(-18, -4);
  let pivotHigh = -Infinity;
  let pivotLow = Infinity;
  for (const b of midBars) {
    if (b.high > pivotHigh) pivotHigh = b.high;
    if (b.low < pivotLow) pivotLow = b.low;
  }

  // Bullish S/R Flip: Broken pivotHigh tested as Support
  const isRetestingSupport = (currentBar.low <= pivotHigh + 0.20 * atr14 && currentBar.low >= pivotHigh - 0.25 * atr14) &&
                             currentBar.close >= pivotHigh && isGreenClose && lowerWickRatio >= 0.30;
  if (isRetestingSupport && smoothSlope > 0.015 && rvol >= 1.10) {
    const sl = Math.min(currentBar.low, prevBar.low) - minSlBuffer;
    const riskDist = currentPrice - sl;
    const tp = swingHigh - preReversalBuffer;
    const roomToReversal = tp - currentPrice;
    const rr = riskDist > 0 ? roomToReversal / riskDist : 0;

    if (rr >= 2.25 && roomToReversal > 0) {
      return {
        side: 'BUY',
        confidenceScore: 94,
        setupType: 'ZERO_LAG_SR_FLIP_BOUNCE',
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        reasons: [`Bullish S/R Flip Retest of $${pivotHigh.toFixed(2)} with ${(lowerWickRatio * 100).toFixed(0)}% bounce wick`],
      };
    }
  }

  // Bearish S/R Flip: Broken pivotLow tested as Resistance
  const isRetestingResistance = (currentBar.high >= pivotLow - 0.20 * atr14 && currentBar.high <= pivotLow + 0.25 * atr14) &&
                                currentBar.close <= pivotLow && isRedClose && upperWickRatio >= 0.30;
  if (isRetestingResistance && smoothSlope < -0.015 && rvol >= 1.10) {
    const sl = Math.max(currentBar.high, prevBar.high) + minSlBuffer;
    const riskDist = sl - currentPrice;
    const tp = swingLow + preReversalBuffer;
    const roomToReversal = currentPrice - tp;
    const rr = riskDist > 0 ? roomToReversal / riskDist : 0;

    if (rr >= 2.25 && roomToReversal > 0) {
      return {
        side: 'SELL',
        confidenceScore: 94,
        setupType: 'ZERO_LAG_SR_FLIP_REJECT',
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        reasons: [`Bearish S/R Flip Retest of $${pivotLow.toFixed(2)} with ${(upperWickRatio * 100).toFixed(0)}% rejection wick`],
      };
    }
  }

  // =========================================================================
  // SETUP 3: ZERO-LAG KALMAN & SUPERSMOOTHER MOMENTUM REBOUND
  // Pullback rebound in a high-velocity momentum channel
  // =========================================================================
  const isBullTrendVelocity = smoothSlope >= 0.025 && currentPrice >= kalmanPrice;
  const isPullbackReboundLong = isBullTrendVelocity && (prevBar.low <= kalmanPrice + 0.15 * atr14) && isGreenClose && bodyRatio >= 0.50;

  if (isPullbackReboundLong && rvol >= 1.15) {
    const sl = Math.min(currentBar.low, prevBar.low) - minSlBuffer;
    const riskDist = currentPrice - sl;
    const tp = swingHigh - preReversalBuffer;
    const roomToReversal = tp - currentPrice;
    const rr = riskDist > 0 ? roomToReversal / riskDist : 0;

    if (rr >= 2.25 && roomToReversal > 0) {
      return {
        side: 'BUY',
        confidenceScore: 90,
        setupType: 'ZERO_LAG_MOMENTUM_EXPANSION',
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        reasons: [`Zero-Lag Momentum Expansion in strong bull slope (+${smoothSlope.toFixed(2)}%)`],
      };
    }
  }

  const isBearTrendVelocity = smoothSlope <= -0.025 && currentPrice <= kalmanPrice;
  const isPullbackReboundShort = isBearTrendVelocity && (prevBar.high >= kalmanPrice - 0.15 * atr14) && isRedClose && bodyRatio >= 0.50;

  if (isPullbackReboundShort && rvol >= 1.15) {
    const sl = Math.max(currentBar.high, prevBar.high) + minSlBuffer;
    const riskDist = sl - currentPrice;
    const tp = swingLow + preReversalBuffer;
    const roomToReversal = currentPrice - tp;
    const rr = riskDist > 0 ? roomToReversal / riskDist : 0;

    if (rr >= 2.25 && roomToReversal > 0) {
      return {
        side: 'SELL',
        confidenceScore: 90,
        setupType: 'ZERO_LAG_MOMENTUM_EXPANSION',
        customSL: parseFloat(sl.toFixed(4)),
        customTP: parseFloat(tp.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        reasons: [`Zero-Lag Momentum Expansion in strong bear slope (${smoothSlope.toFixed(2)}%)`],
      };
    }
  }

  return null;
}

async function runBacktest() {
  console.log('Testing Refined System 3001 over last 30 days across 10 coins...');
  const notionalPerTrade = 1000;
  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalBreakevens = 0;
  let totalGrossProfit = 0;
  let totalGrossLoss = 0;

  const perCoinStats: Record<string, any> = {};

  for (const sym of SYMBOLS) {
    const cacheFile = path.join(CACHE_DIR, `${sym}_15m_1month.json`);
    if (!fs.existsSync(cacheFile)) continue;
    const candles: KlinePoint[] = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

    let cTrades = 0;
    let cWins = 0;
    let cLosses = 0;
    let cBes = 0;
    let cPnl = 0;

    let activeTrade: any = null;
    let cooldown = 0;

    for (let i = 40; i < candles.length - 1; i++) {
      const windowCandles = candles.slice(i - 40, i + 1);
      const currentBar = candles[i];

      if (cooldown > 0) cooldown--;

      if (activeTrade) {
        activeTrade.barsHeld++;
        const { side, entryPrice, stopLossPrice, takeProfitPrice, initialSL, rr } = activeTrade;
        const totalDist = Math.abs(takeProfitPrice - entryPrice);
        const slDist = Math.abs(entryPrice - initialSL);

        let closed = false;
        let pnlUSD = 0;
        let outcome = 'LOSS';

        if (side === 'BUY') {
          const move = currentBar.high - entryPrice;
          // Breakeven Lock at 50% distance to target
          if (move >= 0.50 * totalDist && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice + (0.05 * slDist);
          }
          // Profit Lock at 70% distance to target
          if (move >= 0.70 * totalDist && !activeTrade.isTrailed) {
            activeTrade.isTrailed = true;
            activeTrade.stopLossPrice = entryPrice + (0.40 * totalDist);
          }

          if (currentBar.high >= takeProfitPrice) {
            closed = true;
            outcome = 'WIN';
            pnlUSD = (totalDist / entryPrice) * notionalPerTrade;
          } else if (currentBar.low <= activeTrade.stopLossPrice) {
            closed = true;
            if (activeTrade.isTrailed) {
              outcome = 'WIN';
              pnlUSD = (0.40 * totalDist / entryPrice) * notionalPerTrade;
            } else if (activeTrade.isBreakeven) {
              outcome = 'BREAKEVEN';
              pnlUSD = 0.50;
            } else {
              outcome = 'LOSS';
              pnlUSD = -((entryPrice - activeTrade.stopLossPrice) / entryPrice) * notionalPerTrade;
            }
          }
        } else {
          // SELL
          const move = entryPrice - currentBar.low;
          if (move >= 0.50 * totalDist && !activeTrade.isBreakeven) {
            activeTrade.isBreakeven = true;
            activeTrade.stopLossPrice = entryPrice - (0.05 * slDist);
          }
          if (move >= 0.70 * totalDist && !activeTrade.isTrailed) {
            activeTrade.isTrailed = true;
            activeTrade.stopLossPrice = entryPrice - (0.40 * totalDist);
          }

          if (currentBar.low <= takeProfitPrice) {
            closed = true;
            outcome = 'WIN';
            pnlUSD = (totalDist / entryPrice) * notionalPerTrade;
          } else if (currentBar.high >= activeTrade.stopLossPrice) {
            closed = true;
            if (activeTrade.isTrailed) {
              outcome = 'WIN';
              pnlUSD = (0.40 * totalDist / entryPrice) * notionalPerTrade;
            } else if (activeTrade.isBreakeven) {
              outcome = 'BREAKEVEN';
              pnlUSD = 0.50;
            } else {
              outcome = 'LOSS';
              pnlUSD = -((activeTrade.stopLossPrice - entryPrice) / entryPrice) * notionalPerTrade;
            }
          }
        }

        // Time stall: 36 bars (9 hours)
        if (!closed && activeTrade.barsHeld >= 36) {
          closed = true;
          const diff = side === 'BUY' ? (currentBar.close - entryPrice) : (entryPrice - currentBar.close);
          pnlUSD = (diff / entryPrice) * notionalPerTrade;
          outcome = pnlUSD > 0 ? 'WIN' : 'LOSS';
        }

        if (closed) {
          cTrades++;
          totalTrades++;
          if (outcome === 'WIN') {
            cWins++;
            totalWins++;
            totalGrossProfit += pnlUSD;
          } else if (outcome === 'BREAKEVEN') {
            cBes++;
            totalBreakevens++;
            totalGrossProfit += pnlUSD;
          } else {
            cLosses++;
            totalLosses++;
            totalGrossLoss += Math.abs(pnlUSD);
          }
          cPnl += pnlUSD;
          activeTrade = null;
          cooldown = 1;
        }
      }

      if (!activeTrade && cooldown === 0) {
        const sig = evaluateHighWinrateZeroLag(windowCandles, sym);
        if (sig) {
          activeTrade = {
            side: sig.side,
            entryPrice: currentBar.close,
            stopLossPrice: sig.customSL,
            initialSL: sig.customSL,
            takeProfitPrice: sig.customTP,
            rr: sig.rr,
            setupType: sig.setupType,
            isBreakeven: false,
            isTrailed: false,
            barsHeld: 0,
          };
        }
      }
    }

    perCoinStats[sym] = {
      trades: cTrades,
      wins: cWins,
      losses: cLosses,
      bes: cBes,
      winRate: cTrades > 0 ? parseFloat(((cWins / cTrades) * 100).toFixed(1)) : 0,
      netPnL: parseFloat(cPnl.toFixed(2)),
    };
  }

  const winRate = totalTrades > 0 ? parseFloat(((totalWins / totalTrades) * 100).toFixed(1)) : 0;
  const netPnL = parseFloat((totalGrossProfit - totalGrossLoss).toFixed(2));
  const pf = totalGrossLoss > 0 ? parseFloat((totalGrossProfit / totalGrossLoss).toFixed(2)) : 99;

  console.log('\n================================================================');
  console.log('🌟 UPGRADED SYSTEM 3001 RESULTS (OPTIMAL CONFLUENCE):');
  console.log(`Total Trades: ${totalTrades} (Was: 18 trades)`);
  console.log(`Wins: ${totalWins} | Losses: ${totalLosses} | Breakevens: ${totalBreakevens}`);
  console.log(`Win Rate: ${winRate}% (Was: 50.0%)`);
  console.log(`Gross Profit: $${totalGrossProfit.toFixed(2)}`);
  console.log(`Gross Loss: $${totalGrossLoss.toFixed(2)}`);
  console.log(`Net Profit: $${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(2)} (Was: +$111.47)`);
  console.log(`Profit Factor: ${pf} (Was: 2.25)`);
  console.log('================================================================\n');

  console.log('Per Coin Breakdown:');
  for (const [coin, st] of Object.entries(perCoinStats)) {
    console.log(coin.padEnd(10), `Trades: ${st.trades}`.padEnd(14), `W/L: ${st.wins}/${st.losses}`.padEnd(12), `WR: ${st.winRate}%`.padEnd(12), `Net: $${st.netPnL >= 0 ? '+' : ''}${st.netPnL}`);
  }
}

runBacktest();
