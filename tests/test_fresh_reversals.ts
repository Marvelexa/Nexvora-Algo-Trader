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

function calculateATR(candles: KlinePoint[], period: number = 14): number {
  if (candles.length < 2) return 1.0;
  let sum = 0;
  const len = Math.min(period, candles.length - 1);
  for (let i = candles.length - len; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    sum += Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
  }
  return sum / len;
}

function calculateEMA(prices: number[], period: number): number {
  if (!prices || prices.length === 0) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function evaluateVideoReversal(symbol: string, candles: KlinePoint[]): any {
  if (candles.length < 35) return null;
  const n = candles.length;
  const currentBar = candles[n - 1];
  const prevBar = candles[n - 2];
  const currentPrice = currentBar.close;
  const atr = calculateATR(candles, 14);
  const closes = candles.map(c => c.close);
  const ema50 = calculateEMA(closes, 50);

  // Fractal pivots
  const highs: { index: number; price: number }[] = [];
  const lows: { index: number; price: number }[] = [];

  for (let i = 2; i < n - 2; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    if (h > candles[i - 1].high && h > candles[i - 2].high && h > candles[i + 1].high && h > candles[i + 2].high) {
      highs.push({ index: i, price: h });
    }
    if (l < candles[i - 1].low && l < candles[i - 2].low && l < candles[i + 1].low && l < candles[i + 2].low) {
      lows.push({ index: i, price: l });
    }
  }

  // 1. BULLISH GOLDEN POCKET REVERSAL
  const recentHighs = highs.filter(h => (n - 1) - h.index <= 28 && (n - 1) - h.index >= 3);
  if (recentHighs.length > 0) {
    const bestHigh = recentHighs.reduce((p, c) => c.price > p.price ? c : p);
    let baseLowPrice = Infinity, baseLowIdx = -1;
    for (let i = Math.max(0, bestHigh.index - 28); i < bestHigh.index; i++) {
      if (candles[i].low < baseLowPrice) {
        baseLowPrice = candles[i].low;
        baseLowIdx = i;
      }
    }

    if (baseLowIdx >= 0) {
      const impulse = bestHigh.price - baseLowPrice;
      if (impulse >= 1.4 * atr) {
        const fib618 = bestHigh.price - (0.618 * impulse);
        const fib786 = bestHigh.price - (0.786 * impulse);
        const fib886 = bestHigh.price - (0.886 * impulse);

        // Find the EXACT bar where price first entered the golden pocket
        let pocketTouchIdx = -1;
        for (let i = bestHigh.index + 1; i < n; i++) {
          if (candles[i].low <= fib618 && candles[i].low >= fib886) {
            pocketTouchIdx = i;
          }
        }

        // FRESHNESS RULE: Must be within 3 bars of the golden pocket test!
        if (pocketTouchIdx >= 0 && (n - 1) - pocketTouchIdx <= 3) {
          const lowestSinceHigh = Math.min(...candles.slice(bestHigh.index).map(c => c.low));
          const cRange = currentBar.high - currentBar.low;
          const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
          const isGreen = currentBar.close > currentBar.open;
          const isEngulfing = isGreen && currentBar.close > prevBar.high;
          const isPinbarBounce = lowerWick >= 0.35 * cRange;

          const ema100 = calculateEMA(closes, 100);
          if (currentPrice < ema100 - (1.2 * atr)) return null;
          if (currentBar.close >= fib786 && (isPinbarBounce || isEngulfing || (isGreen && lowerWick >= 0.20 * cRange))) {
            const slPrice = Math.min(lowestSinceHigh, fib886) - (0.35 * atr);
            const lossDist = currentPrice - slPrice;

            if (lossDist >= 0.35 * atr && lossDist <= 2.5 * atr) {
              const tpTarget = currentPrice + (lossDist * 2.30);
              if (tpTarget <= bestHigh.price + 0.05 * atr) {
                return {
                  side: 'BUY',
                  entryPrice: currentPrice,
                  customTP: parseFloat(tpTarget.toFixed(6)),
                  customSL: parseFloat(slPrice.toFixed(6)),
                  strategyName: 'Sidhant Golden Pocket Bullish Reversal [FRESH_BOUNCE]',
                  confidenceScore: 96,
                  rr: 2.30,
                };
              }
            }
          }
        }
      }
    }
  }

  // 2. BEARISH GOLDEN POCKET REVERSAL
  const recentLows = lows.filter(l => (n - 1) - l.index <= 28 && (n - 1) - l.index >= 3);
  if (recentLows.length > 0) {
    const bestLow = recentLows.reduce((p, c) => c.price < p.price ? c : p);
    let baseHighPrice = -Infinity, baseHighIdx = -1;
    for (let i = Math.max(0, bestLow.index - 28); i < bestLow.index; i++) {
      if (candles[i].high > baseHighPrice) {
        baseHighPrice = candles[i].high;
        baseHighIdx = i;
      }
    }

    if (baseHighIdx >= 0) {
      const impulse = baseHighPrice - bestLow.price;
      if (impulse >= 1.4 * atr) {
        const fib618 = bestLow.price + (0.618 * impulse);
        const fib786 = bestLow.price + (0.786 * impulse);
        const fib886 = bestLow.price + (0.886 * impulse);

        let pocketTouchIdx = -1;
        for (let i = bestLow.index + 1; i < n; i++) {
          if (candles[i].high >= fib618 && candles[i].high <= fib886) {
            pocketTouchIdx = i;
          }
        }

        // FRESHNESS RULE: Must be within 3 bars of the golden pocket test!
        if (pocketTouchIdx >= 0 && (n - 1) - pocketTouchIdx <= 3) {
          const highestSinceLow = Math.max(...candles.slice(bestLow.index).map(c => c.high));
          const cRange = currentBar.high - currentBar.low;
          const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
          const isRed = currentBar.close < currentBar.open;
          const isBearEngulfing = isRed && currentBar.close < prevBar.low;
          const isShootingStar = upperWick >= 0.35 * cRange;

          const ema100 = calculateEMA(closes, 100);
          if (currentPrice > ema100 + (1.2 * atr)) return null;
          if (currentBar.close <= fib786 && (isShootingStar || isBearEngulfing || (isRed && upperWick >= 0.20 * cRange))) {
            const slPrice = Math.max(highestSinceLow, fib886) + (0.35 * atr);
            const lossDist = slPrice - currentPrice;

            if (lossDist >= 0.35 * atr && lossDist <= 2.5 * atr) {
              const tpTarget = currentPrice - (lossDist * 2.30);
              if (tpTarget >= bestLow.price - 0.05 * atr) {
                return {
                  side: 'SELL',
                  entryPrice: currentPrice,
                  customTP: parseFloat(tpTarget.toFixed(6)),
                  customSL: parseFloat(slPrice.toFixed(6)),
                  strategyName: 'Sidhant Golden Pocket Bearish Reversal [FRESH_REJECTION]',
                  confidenceScore: 96,
                  rr: 2.30,
                };
              }
            }
          }
        }
      }
    }
  }

  return null;
}

async function runFreshTest() {
  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD', 'XRPUSD'];
  console.log(`=== TESTING FRESH REVERSAL ENGINE (1:2.30 RR, Fresh Bounce <= 3 Bars) ===\n`);

  let totalWins = 0;
  let totalLosses = 0;
  let totalBE = 0;
  let totalGrossWinUSD = 0;
  let totalGrossLossUSD = 0;

  for (const sym of coins) {
    const candles = await fetchCandles(sym, 500);
    let wins = 0, losses = 0, bes = 0;

    let activeTrade: any = null;
    let cooldownUntil = 0;

    for (let i = 35; i < candles.length - 1; i++) {
      const currentBar = candles[i];
      const nextBar = candles[i + 1];

      if (activeTrade) {
        const { side, entryPrice, customTP, customSL } = activeTrade;
        const totalDist = Math.abs(customTP - entryPrice);
        let closed = false;

        if (side === 'BUY') {
          // Breakeven lock at 35% towards target
          if (currentBar.high - entryPrice >= 0.50 * totalDist && !activeTrade.isBE) {
            activeTrade.isBE = true;
            activeTrade.sl = entryPrice + 0.05 * totalDist;
          }
          // Profit trail lock at 65% towards target
          if (currentBar.high - entryPrice >= 0.75 * totalDist && !activeTrade.isTrailed) {
            activeTrade.isTrailed = true;
            activeTrade.sl = entryPrice + 0.45 * totalDist;
          }

          if (currentBar.high >= customTP) {
            wins++;
            totalWins++;
            totalGrossWinUSD += 10.0;
            closed = true;
          } else if (currentBar.low <= activeTrade.sl) {
            if (activeTrade.isBE || activeTrade.isTrailed) {
              bes++;
              totalBE++;
              totalGrossWinUSD += activeTrade.isTrailed ? 4.5 : 0.5;
            } else {
              losses++;
              totalLosses++;
              totalGrossLossUSD += 4.35;
            }
            closed = true;
          }
        } else {
          // SELL
          if (entryPrice - currentBar.low >= 0.50 * totalDist && !activeTrade.isBE) {
            activeTrade.isBE = true;
            activeTrade.sl = entryPrice - 0.05 * totalDist;
          }
          if (entryPrice - currentBar.low >= 0.75 * totalDist && !activeTrade.isTrailed) {
            activeTrade.isTrailed = true;
            activeTrade.sl = entryPrice - 0.45 * totalDist;
          }

          if (currentBar.low <= customTP) {
            wins++;
            totalWins++;
            totalGrossWinUSD += 10.0;
            closed = true;
          } else if (currentBar.high >= activeTrade.sl) {
            if (activeTrade.isBE || activeTrade.isTrailed) {
              bes++;
              totalBE++;
              totalGrossWinUSD += activeTrade.isTrailed ? 4.5 : 0.5;
            } else {
              losses++;
              totalLosses++;
              totalGrossLossUSD += 4.35;
            }
            closed = true;
          }
        }

        if (closed) {
          activeTrade = null;
          cooldownUntil = i + 4; // 1-hour cooldown
          continue;
        }
      }

      if (i < cooldownUntil) continue;

      const history = candles.slice(0, i + 1);
      const res = evaluateVideoReversal(sym, history);

      if (res) {
        activeTrade = {
          side: res.side,
          entryPrice: nextBar.open,
          customTP: res.customTP,
          customSL: res.customSL,
          sl: res.customSL,
          isBE: false,
          isTrailed: false,
        };
      }
    }

    const total = wins + losses + bes;
    const wr = total > 0 ? ((wins + bes) / total) * 100 : 0;
    console.log(`${sym.padEnd(8)} | Trades: ${total.toString().padStart(2)} | Wins: ${wins} | BE: ${bes} | Loss: ${losses} | Accuracy: ${wr.toFixed(1).padStart(5)}%`);
  }

  const grandTotal = totalWins + totalLosses + totalBE;
  const effectiveWR = grandTotal > 0 ? ((totalWins + totalBE) / grandTotal) * 100 : 0;
  const pureWR = grandTotal > 0 ? (totalWins / grandTotal) * 100 : 0;
  const netUSD = totalGrossWinUSD - totalGrossLossUSD;
  console.log(`\n=============================================================`);
  console.log(`TOTAL TRADES: ${grandTotal}`);
  console.log(`Wins: ${totalWins} | Breakeven/Trailed: ${totalBE} | Losses: ${totalLosses}`);
  console.log(`ACCURACY (Wins + Protected BE): ${effectiveWR.toFixed(1)}%`);
  console.log(`Pure Target Win Rate: ${pureWR.toFixed(1)}%`);
  console.log(`Total Gross Win: +$${totalGrossWinUSD.toFixed(2)} USD`);
  console.log(`Total Gross Loss: -$${totalGrossLossUSD.toFixed(2)} USD`);
  console.log(`Net Realized PnL: +$${netUSD.toFixed(2)} USD`);
  console.log(`Profit Factor: ${(totalGrossWinUSD / Math.max(1, totalGrossLossUSD)).toFixed(2)}`);
  console.log(`=============================================================`);
}

runFreshTest().catch(console.error);
