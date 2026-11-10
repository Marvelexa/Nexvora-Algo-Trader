import fs from 'fs';
import path from 'path';
import { KlinePoint } from '../src/types';
import { HTFBilateralBiasGatekeeper } from '../lib/risk/htfBilateralBiasGatekeeper';
import { bradGohMindMathMoney3002Engine } from '../lib/strategies/bradGohMindMathMoney3002Engine';

const CACHE_DIR = path.join(process.cwd(), '.cache_candles_1m');
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'BNBUSDT', 'LINKUSDT',
  'NEARUSDT', 'ARBUSDT', 'OPUSDT', 'APTUSDT', 'INJUSDT'
];

function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcATR(candles: KlinePoint[], period: number = 14): number {
  if (candles.length < 2) return 1.0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
}

// 1. PORT 3006: YT_PAT_ORB_ENGINE (Enhanced)
function evalPatOrbEnhanced(sym: string, candles: KlinePoint[]) {
  if (candles.length < 50) return { recommendedSide: null };
  const vol = HTFBilateralBiasGatekeeper.checkVolatilityExpansion(candles);
  if (!vol.isExpanded && candles.length >= 55) return { recommendedSide: null };

  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const curPrice = cur.close;
  const atr = calcATR(candles, 14);

  const asianSlice = candles.slice(n - 38, n - 10);
  const aHigh = Math.max(...asianSlice.map(c => c.high));
  const aLow = Math.min(...asianSlice.map(c => c.low));
  const aRange = aHigh - aLow;
  if (aRange < 1.4 * atr) return { recommendedSide: null };

  const londonSlice = candles.slice(n - 10, n - 2);
  const sweptLow = londonSlice.some(c => c.low < aLow);
  const sweptHigh = londonSlice.some(c => c.high > aHigh);
  const lHigh = Math.max(...londonSlice.map(c => c.high));
  const lLow = Math.min(...londonSlice.map(c => c.low));

  const curBody = Math.abs(cur.close - cur.open);
  const isStrongBull = cur.close > cur.open && cur.close > p1.high && curBody >= 0.70 * atr;
  const isStrongBear = cur.close < cur.open && cur.close < p1.low && curBody >= 0.70 * atr;

  if (sweptLow && (curPrice > lHigh || p1.close > lHigh) && isStrongBull) {
    const gate = HTFBilateralBiasGatekeeper.evaluateGate('BUY', candles);
    if (!gate.allowed) return { recommendedSide: null };

    const sweepLow = Math.min(...londonSlice.map(c => c.low));
    const sl = Math.min(sweepLow, cur.low) - (0.35 * atr);
    const risk = curPrice - sl;
    if (risk / curPrice < 0.0050) return { recommendedSide: null };

    return {
      recommendedSide: 'BUY' as const,
      entryPrice: curPrice,
      customSL: sl,
      tp1Price: curPrice + (risk * 1.0),
      tp2Price: curPrice + (risk * 2.0),
      earlyBreakevenPrice: curPrice + (risk * 0.75),
      reason: `Pat ORB BUY: Asian Low swept + NY Breakout`
    };
  }

  if (sweptHigh && (curPrice < lLow || p1.close < lLow) && isStrongBear) {
    const gate = HTFBilateralBiasGatekeeper.evaluateGate('SELL', candles);
    if (!gate.allowed) return { recommendedSide: null };

    const sweepHigh = Math.max(...londonSlice.map(c => c.high));
    const sl = Math.max(sweepHigh, cur.high) + (0.35 * atr);
    const risk = sl - curPrice;
    if (risk / curPrice < 0.0050) return { recommendedSide: null };

    return {
      recommendedSide: 'SELL' as const,
      entryPrice: curPrice,
      customSL: sl,
      tp1Price: curPrice - (risk * 1.0),
      tp2Price: curPrice - (risk * 2.0),
      earlyBreakevenPrice: curPrice - (risk * 0.75),
      reason: `Pat ORB SELL: Asian High swept + NY Breakdown`
    };
  }

  return { recommendedSide: null };
}

// 2. PORT 3007: YT_CRT_SMC_ENGINE (Enhanced)
function evalCrtSmcEnhanced(sym: string, candles: KlinePoint[]) {
  if (candles.length < 50) return { recommendedSide: null };
  const vol = HTFBilateralBiasGatekeeper.checkVolatilityExpansion(candles);
  if (!vol.isExpanded && candles.length >= 55) return { recommendedSide: null };

  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const curPrice = cur.close;
  const atr = calcATR(candles, 14);

  const c1 = candles.slice(n - 8, n - 4);
  const c1High = Math.max(...c1.map(c => c.high));
  const c1Low = Math.min(...c1.map(c => c.low));
  const c1Range = c1High - c1Low;
  if (c1Range < 1.4 * atr) return { recommendedSide: null };
  const c1Mid = c1Low + (c1Range * 0.5);

  const c2 = candles.slice(n - 4, n - 1);
  const c2MinLow = Math.min(...c2.map(c => c.low));
  const c2MaxHigh = Math.max(...c2.map(c => c.high));

  const bullSweep = c2MinLow < c1Low && p1.close > c1Low;
  const bearSweep = c2MaxHigh > c1High && p1.close < c1High;

  const curBody = Math.abs(cur.close - cur.open);
  const isDispBull = cur.close > cur.open && curBody >= 0.75 * atr && cur.close > p1.high;
  const isDispBear = cur.close < cur.open && curBody >= 0.75 * atr && cur.close < p1.low;

  if (bullSweep && isDispBull) {
    const gate = HTFBilateralBiasGatekeeper.evaluateGate('BUY', candles);
    if (!gate.allowed) return { recommendedSide: null };

    const sl = c2MinLow - (0.35 * atr);
    const risk = curPrice - sl;
    if (risk / curPrice < 0.0050) return { recommendedSide: null };

    const tp1 = Math.max(c1Mid, curPrice + (risk * 1.0));
    const tp2 = Math.max(c1High, curPrice + (risk * 1.8));

    return {
      recommendedSide: 'BUY' as const,
      entryPrice: curPrice,
      customSL: sl,
      tp1Price: tp1,
      tp2Price: tp2,
      earlyBreakevenPrice: curPrice + (risk * 0.75),
      reason: `1H CRT Turtle Soup BUY: Swept C1 Low + Strong Displacement`
    };
  }

  if (bearSweep && isDispBear) {
    const gate = HTFBilateralBiasGatekeeper.evaluateGate('SELL', candles);
    if (!gate.allowed) return { recommendedSide: null };

    const sl = c2MaxHigh + (0.35 * atr);
    const risk = sl - curPrice;
    if (risk / curPrice < 0.0050) return { recommendedSide: null };

    const tp1 = Math.min(c1Mid, curPrice - (risk * 1.0));
    const tp2 = Math.min(c1Low, curPrice - (risk * 1.8));

    return {
      recommendedSide: 'SELL' as const,
      entryPrice: curPrice,
      customSL: sl,
      tp1Price: tp1,
      tp2Price: tp2,
      earlyBreakevenPrice: curPrice - (risk * 0.75),
      reason: `1H CRT Turtle Soup SELL: Swept C1 High + Strong Displacement`
    };
  }

  return { recommendedSide: null };
}

// 3. PORT 3008: YT_SOLANO_VWAP_ENGINE (Enhanced)
function evalSolanoVwapEnhanced(sym: string, candles: KlinePoint[]) {
  if (candles.length < 60) return { recommendedSide: null };
  const vol = HTFBilateralBiasGatekeeper.checkVolatilityExpansion(candles);
  if (!vol.isExpanded && candles.length >= 55) return { recommendedSide: null };

  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const curPrice = cur.close;
  const atr = calcATR(candles, 14);

  let cumVol = 0;
  let cumVolPrice = 0;
  const vwapSeries: number[] = [];
  for (let i = n - 48; i < n; i++) {
    const c = candles[i];
    const typ = (c.high + c.low + c.close) / 3;
    const v = c.volume || 1;
    cumVol += v;
    cumVolPrice += typ * v;
    vwapSeries.push(cumVol > 0 ? cumVolPrice / cumVol : typ);
  }
  const curVWAP = vwapSeries[vwapSeries.length - 1];
  const prevVWAP = vwapSeries[vwapSeries.length - 6];
  const vwapSlopePct = ((curVWAP - prevVWAP) / curVWAP) * 100;
  if (Math.abs(vwapSlopePct) < 0.07) return { recommendedSide: null };

  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema50 = calcEMA(closes, 50);
  const curEma9 = ema9[ema9.length - 1];
  const curEma50 = ema50[ema50.length - 1];

  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const curBody = Math.abs(cur.close - cur.open);

  if (curPrice > curEma50 && vwapSlopePct > 0.07 && curEma9 >= curVWAP) {
    const tappedPocket = Math.min(cur.low, p1.low) <= Math.max(curEma9, curVWAP) * 1.002 && curPrice >= Math.min(curEma9, curVWAP);
    const isHammer = lowerWick >= 1.3 * curBody && cur.close > cur.open;
    const isEngulf = cur.close > cur.open && cur.close > p1.high && curBody >= 0.75 * atr;

    if (tappedPocket && (isHammer || isEngulf)) {
      const gate = HTFBilateralBiasGatekeeper.evaluateGate('BUY', candles);
      if (!gate.allowed) return { recommendedSide: null };

      const sl = Math.min(...candles.slice(-6).map(c => c.low)) - (0.35 * atr);
      const risk = curPrice - sl;
      if (risk / curPrice < 0.0050) return { recommendedSide: null };

      return {
        recommendedSide: 'BUY' as const,
        entryPrice: curPrice,
        customSL: sl,
        tp1Price: curPrice + (risk * 1.0),
        tp2Price: curPrice + (risk * 2.0),
        earlyBreakevenPrice: curPrice + (risk * 0.75),
        reason: `Solano VWAP BUY: Trending VWAP + Dynamic Pocket Bounce`
      };
    }
  }

  if (curPrice < curEma50 && vwapSlopePct < -0.07 && curEma9 <= curVWAP) {
    const tappedPocket = Math.max(cur.high, p1.high) >= Math.min(curEma9, curVWAP) * 0.998 && curPrice <= Math.max(curEma9, curVWAP);
    const isStar = upperWick >= 1.3 * curBody && cur.close < cur.open;
    const isBearEngulf = cur.close < cur.open && cur.close < p1.low && curBody >= 0.75 * atr;

    if (tappedPocket && (isStar || isBearEngulf)) {
      const gate = HTFBilateralBiasGatekeeper.evaluateGate('SELL', candles);
      if (!gate.allowed) return { recommendedSide: null };

      const sl = Math.max(...candles.slice(-6).map(c => c.high)) + (0.35 * atr);
      const risk = sl - curPrice;
      if (risk / curPrice < 0.0050) return { recommendedSide: null };

      return {
        recommendedSide: 'SELL' as const,
        entryPrice: curPrice,
        customSL: sl,
        tp1Price: curPrice - (risk * 1.0),
        tp2Price: curPrice - (risk * 2.0),
        earlyBreakevenPrice: curPrice - (risk * 0.75),
        reason: `Solano VWAP SELL: Trending VWAP + Dynamic Pocket Breakdown`
      };
    }
  }

  return { recommendedSide: null };
}

// 4. PORT 3009: YT_SECRET_MACD_ENGINE (Enhanced)
function evalSecretMacdEnhanced(sym: string, candles: KlinePoint[]) {
  if (candles.length < 60) return { recommendedSide: null };
  const vol = HTFBilateralBiasGatekeeper.checkVolatilityExpansion(candles);
  if (!vol.isExpanded && candles.length >= 55) return { recommendedSide: null };

  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const p2 = candles[n - 3];
  const curPrice = cur.close;
  const atr = calcATR(candles, 14);

  const closes = candles.map(c => c.close);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);
  const hist = macdLine.map((v, i) => v - signalLine[i]);

  const curMacd = macdLine[macdLine.length - 1];
  const curSignal = signalLine[signalLine.length - 1];
  const curHist = hist[hist.length - 1];
  const prevHist = hist[hist.length - 2];
  const prev2Hist = hist[hist.length - 3];

  const ema50 = calcEMA(closes, 50);
  const curEma50 = ema50[ema50.length - 1];

  const minClearance = 0.08 * atr;
  const curBody = Math.abs(cur.close - cur.open);

  if (curMacd > minClearance && curSignal > 0 && curPrice > curEma50) {
    const isHistTurn = curHist > prevHist && (prevHist < 0 || prevHist < prev2Hist);
    const isStrongCandle = cur.close > cur.open && curBody >= 0.75 * atr && cur.close > p1.high;

    if (isHistTurn && isStrongCandle) {
      const gate = HTFBilateralBiasGatekeeper.evaluateGate('BUY', candles);
      if (!gate.allowed) return { recommendedSide: null };

      const sl = Math.min(...candles.slice(-8).map(c => c.low)) - (0.35 * atr);
      const risk = curPrice - sl;
      if (risk / curPrice < 0.0050) return { recommendedSide: null };

      return {
        recommendedSide: 'BUY' as const,
        entryPrice: curPrice,
        customSL: sl,
        tp1Price: curPrice + (risk * 1.0),
        tp2Price: curPrice + (risk * 2.0),
        earlyBreakevenPrice: curPrice + (risk * 0.75),
        reason: `Secret MACD BUY: Zero-Line Bullish + 50 EMA + Rising Histogram`
      };
    }
  }

  if (curMacd < -minClearance && curSignal < 0 && curPrice < curEma50) {
    const isHistTurn = curHist < prevHist && (prevHist > 0 || prevHist > prev2Hist);
    const isStrongCandle = cur.close < cur.open && curBody >= 0.75 * atr && cur.close < p1.low;

    if (isHistTurn && isStrongCandle) {
      const gate = HTFBilateralBiasGatekeeper.evaluateGate('SELL', candles);
      if (!gate.allowed) return { recommendedSide: null };

      const sl = Math.max(...candles.slice(-8).map(c => c.high)) + (0.35 * atr);
      const risk = sl - curPrice;
      if (risk / curPrice < 0.0050) return { recommendedSide: null };

      return {
        recommendedSide: 'SELL' as const,
        entryPrice: curPrice,
        customSL: sl,
        tp1Price: curPrice - (risk * 1.0),
        tp2Price: curPrice - (risk * 2.0),
        earlyBreakevenPrice: curPrice - (risk * 0.75),
        reason: `Secret MACD SELL: Zero-Line Bearish + 50 EMA + Falling Histogram`
      };
    }
  }

  return { recommendedSide: null };
}

// Backtest execution
async function runTest() {
  const allCandlesMap = new Map<string, KlinePoint[]>();
  for (const sym of SYMBOLS) {
    const p = path.join(CACHE_DIR, `${sym}_15m_1month.json`);
    if (fs.existsSync(p)) allCandlesMap.set(sym, JSON.parse(fs.readFileSync(p, 'utf-8')));
  }

  const ENGINES = [
    { id: 3006, name: 'YT_PAT_ORB_ENGINE (Enhanced)', eval: evalPatOrbEnhanced },
    { id: 3007, name: 'YT_CRT_SMC_ENGINE (Enhanced)', eval: evalCrtSmcEnhanced },
    { id: 3008, name: 'YT_SOLANO_VWAP_ENGINE (Enhanced)', eval: evalSolanoVwapEnhanced },
    { id: 3009, name: 'YT_SECRET_MACD_ENGINE (Enhanced)', eval: evalSecretMacdEnhanced },
    { id: 3002, name: 'Brad Goh 5-Step Reversal (Core)', eval: (sym: string, c: KlinePoint[]) => bradGohMindMathMoney3002Engine.evaluateSetup(sym, c, 1000, 'MODE_B') },
  ];

  console.log('Running Institutional Backtest across 15 perpetual pairs (1 month)...');
  const results = [];

  for (const eng of ENGINES) {
    let activePositions: any[] = [];
    const completedTrades: any[] = [];
    const lastTradeBarPerSymbol = new Map<string, number>();

    const minBars = 70;
    const maxBars = 2880;

    for (let barIdx = minBars; barIdx < maxBars; barIdx++) {
      // 1. Check exits
      for (let pIdx = activePositions.length - 1; pIdx >= 0; pIdx--) {
        const pos = activePositions[pIdx];
        const symCandles = allCandlesMap.get(pos.symbol);
        if (!symCandles) continue;
        const curBar = symCandles[barIdx];

        let resolved = false;
        let pnlR = 0;
        let outcome = 'LOSS';

        if (pos.side === 'BUY') {
          if (!pos.tp1Hit && curBar.high >= pos.earlyBE) pos.activeSL = Math.max(pos.activeSL, pos.entryPrice + (0.05 * pos.riskDist));
          if (!pos.tp1Hit && curBar.high >= pos.tp1) { pos.tp1Hit = true; pos.activeSL = Math.max(pos.activeSL, pos.entryPrice + (0.05 * pos.riskDist)); }

          if (pos.tp1Hit) {
            if (curBar.high >= pos.tp2) {
              outcome = 'WIN_TP2';
              pnlR = (0.75 * 1.0) + (0.25 * 2.0); // +1.25R
              resolved = true;
            } else if (curBar.low <= pos.activeSL) {
              outcome = 'WIN_TP1_BE';
              pnlR = (0.75 * 1.0) + (0.25 * 0.05); // +0.7625R
              resolved = true;
            }
          } else {
            if (curBar.low <= pos.activeSL) {
              outcome = pos.activeSL > pos.entryPrice ? 'WIN_BE' : 'LOSS';
              pnlR = pos.activeSL > pos.entryPrice ? 0.05 : -1.0;
              resolved = true;
            }
          }
        } else {
          // SHORT
          if (!pos.tp1Hit && curBar.low <= pos.earlyBE) pos.activeSL = Math.min(pos.activeSL, pos.entryPrice - (0.05 * pos.riskDist));
          if (!pos.tp1Hit && curBar.low <= pos.tp1) { pos.tp1Hit = true; pos.activeSL = Math.min(pos.activeSL, pos.entryPrice - (0.05 * pos.riskDist)); }

          if (pos.tp1Hit) {
            if (curBar.low <= pos.tp2) {
              outcome = 'WIN_TP2';
              pnlR = (0.75 * 1.0) + (0.25 * 2.0);
              resolved = true;
            } else if (curBar.high >= pos.activeSL) {
              outcome = 'WIN_TP1_BE';
              pnlR = (0.75 * 1.0) + (0.25 * 0.05);
              resolved = true;
            }
          } else {
            if (curBar.high >= pos.activeSL) {
              outcome = pos.activeSL < pos.entryPrice ? 'WIN_BE' : 'LOSS';
              pnlR = pos.activeSL < pos.entryPrice ? 0.05 : -1.0;
              resolved = true;
            }
          }
        }

        if (resolved) {
          completedTrades.push({ side: pos.side, outcome, pnlR, pnlUSD: pnlR * 10 });
          activePositions.splice(pIdx, 1);
        }
      }

      // 2. Scan for entries
      if (activePositions.length < 4) {
        for (const [sym, cList] of allCandlesMap.entries()) {
          if (activePositions.length >= 4) break;
          if (activePositions.some(p => p.symbol === sym)) continue;

          const lastBar = lastTradeBarPerSymbol.get(sym) || -999;
          if (barIdx - lastBar < 96) continue; // Max 1 trade per coin per day

          const slice = cList.slice(0, barIdx + 1);
          const sig = eng.eval(sym, slice);
          if (sig.recommendedSide && sig.customSL) {
            const entryPrice = slice[slice.length - 1].close;
            const stopLoss = sig.customSL;
            const riskDist = Math.abs(entryPrice - stopLoss);
            if (riskDist / entryPrice < 0.0050) continue; // Spread & fee filter

            lastTradeBarPerSymbol.set(sym, barIdx);
            activePositions.push({
              symbol: sym,
              side: sig.recommendedSide,
              entryPrice,
              stopLoss,
              activeSL: stopLoss,
              tp1: sig.tp1Price || (sig.recommendedSide === 'BUY' ? entryPrice + riskDist : entryPrice - riskDist),
              tp2: sig.tp2Price || (sig.recommendedSide === 'BUY' ? entryPrice + (riskDist * 2) : entryPrice - (riskDist * 2)),
              earlyBE: sig.earlyBreakevenPrice || (sig.recommendedSide === 'BUY' ? entryPrice + (riskDist * 0.75) : entryPrice - (riskDist * 0.75)),
              riskDist,
              tp1Hit: false,
            });
          }
        }
      }
    }

    const totalTrades = completedTrades.length;
    const buys = completedTrades.filter(t => t.side === 'BUY');
    const sells = completedTrades.filter(t => t.side === 'SELL');
    const buyWins = buys.filter(t => t.outcome !== 'LOSS').length;
    const sellWins = sells.filter(t => t.outcome !== 'LOSS').length;
    const totalWins = buyWins + sellWins;
    const winRatePct = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    const grossProfit = completedTrades.filter(t => t.pnlUSD > 0).reduce((s, t) => s + t.pnlUSD, 0);
    const grossLoss = Math.abs(completedTrades.filter(t => t.pnlUSD < 0).reduce((s, t) => s + t.pnlUSD, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.0 : 0);
    const netPnlUSD = grossProfit - grossLoss;

    let peak = 1000;
    let equity = 1000;
    let maxDD = 0;
    for (const t of completedTrades) {
      equity += t.pnlUSD;
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    results.push({
      Port: eng.id,
      Strategy: eng.name,
      'Total Trades': totalTrades,
      'LONG (Buy)': `${buyWins}/${buys.length} (${buys.length ? ((buyWins/buys.length)*100).toFixed(1) : 0}%)`,
      'SHORT (Sell)': `${sellWins}/${sells.length} (${sells.length ? ((sellWins/sells.length)*100).toFixed(1) : 0}%)`,
      'Win Rate %': `${winRatePct.toFixed(1)}%`,
      'Profit Factor': Number(profitFactor.toFixed(2)),
      'Max DD %': `${maxDD.toFixed(2)}%`,
      'Net PnL ($)': `+$${netPnlUSD.toFixed(2)}`,
      'Net PnL (₹)': `+₹${Math.round(netPnlUSD * 84)}`,
    });
  }

  console.table(results);
}

runTest();
