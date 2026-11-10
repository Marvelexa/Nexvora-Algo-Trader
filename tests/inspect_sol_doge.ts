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

async function inspectSolAndDoge() {
  for (const sym of ['SOLUSD', 'DOGEUSD']) {
    const candles = await fetchCandles(sym, 500);
    console.log(`\n=== INSPECTING ${sym} TRADES ===`);
    const n = candles.length;
    for (let i = 35; i < n - 1; i++) {
      const window = candles.slice(0, i + 1);
      const currentBar = window[window.length - 1];
      const prevBar = window[window.length - 2];
      const currentPrice = currentBar.close;
      const atr = calculateATR(window, 14);
      const closes = window.map(c => c.close);
      const ema50 = calculateEMA(closes, 50);

      // Check Sidhant setups
      const highs: { index: number; price: number }[] = [];
      const lows: { index: number; price: number }[] = [];
      for (let j = 2; j < window.length - 2; j++) {
        const h = window[j].high;
        const l = window[j].low;
        if (h > window[j - 1].high && h > window[j - 2].high && h > window[j + 1].high && h > window[j + 2].high) {
          highs.push({ index: j, price: h });
        }
        if (l < window[j - 1].low && l < window[j - 2].low && l < window[j + 1].low && l < window[j + 2].low) {
          lows.push({ index: j, price: l });
        }
      }

      // Check Bearish
      const recentLows = lows.filter(l => (window.length - 1) - l.index <= 28 && (window.length - 1) - l.index >= 3);
      if (recentLows.length > 0) {
        const bestLow = recentLows.reduce((p, c) => c.price < p.price ? c : p);
        let baseHighPrice = -Infinity, baseHighIdx = -1;
        for (let j = Math.max(0, bestLow.index - 28); j < bestLow.index; j++) {
          if (window[j].high > baseHighPrice) {
            baseHighPrice = window[j].high;
            baseHighIdx = j;
          }
        }
        if (baseHighIdx >= 0) {
          const impulse = baseHighPrice - bestLow.price;
          if (impulse >= 1.4 * atr) {
            const fib618 = bestLow.price + (0.618 * impulse);
            const fib786 = bestLow.price + (0.786 * impulse);
            const fib886 = bestLow.price + (0.886 * impulse);
            const highestSinceLow = Math.max(...window.slice(bestLow.index).map(c => c.high));

            if (highestSinceLow >= fib618 && highestSinceLow <= fib886) {
              const cRange = currentBar.high - currentBar.low;
              const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
              const isRed = currentBar.close < currentBar.open;
              const isBearEngulfing = isRed && currentBar.close < prevBar.low;
              const isShootingStar = upperWick >= 0.35 * cRange;

              if (currentBar.close <= fib786 && (isShootingStar || isBearEngulfing || (isRed && upperWick >= 0.20 * cRange))) {
                const slPrice = Math.max(highestSinceLow, fib886) + (0.35 * atr);
                const lossDist = slPrice - currentPrice;
                const tpTarget = currentPrice - (lossDist * 2.30);

                // Track forward
                let outcome = 'OPEN';
                let maxFav = 0;
                for (let k = i + 1; k < Math.min(n, i + 30); k++) {
                  const b = candles[k];
                  const fav = currentPrice - b.low;
                  if (fav > maxFav) maxFav = fav;
                  if (b.low <= tpTarget) { outcome = `WIN (TP hit at +${k - i})`; break; }
                  if (b.high >= slPrice) { outcome = `LOSS (SL hit at +${k - i})`; break; }
                }
                console.log(`Bar ${i} (${new Date(currentBar.time).toISOString()}): SELL @ $${currentPrice} | TP: $${tpTarget.toFixed(2)} | SL: $${slPrice.toFixed(2)} | Outcome: ${outcome} (Max Fav: $${maxFav.toFixed(2)}, Needed: $${(currentPrice - tpTarget).toFixed(2)})`);
              }
            }
          }
        }
      }
    }
  }
}

inspectSolAndDoge().catch(console.error);
