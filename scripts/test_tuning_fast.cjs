const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.cwd(), '.cache_candles_1m');
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'BNBUSDT', 'LINKUSDT',
  'NEARUSDT', 'ARBUSDT', 'OPUSDT', 'APTUSDT', 'INJUSDT'
];

function calcEMA(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcATR(candles, period = 14) {
  if (candles.length < 2) return 1.0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
}

function checkVolExpansion(candles) {
  if (candles.length < 55) return true;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atrs = [];
  let curAtr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  atrs.push(curAtr);
  for (let i = 14; i < trs.length; i++) {
    curAtr = ((curAtr * 13) + trs[i]) / 14;
    atrs.push(curAtr);
  }
  const curAtr14 = atrs[atrs.length - 1];
  const recentAtrs = atrs.slice(-50);
  const smaAtr50 = recentAtrs.reduce((a, b) => a + b, 0) / Math.max(1, recentAtrs.length);
  return curAtr14 > smaAtr50;
}

// 1. Port 3006: Trade with Pat (ORB)
function eval3006(sym, candles) {
  if (candles.length < 50 || !checkVolExpansion(candles)) return null;
  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const atr = calcATR(candles, 14);

  const asian = candles.slice(n - 38, n - 10);
  const aHigh = Math.max(...asian.map(c => c.high));
  const aLow = Math.min(...asian.map(c => c.low));
  if ((aHigh - aLow) < 1.4 * atr) return null;

  const london = candles.slice(n - 10, n - 2);
  const sweptLow = london.some(c => c.low < aLow);
  const sweptHigh = london.some(c => c.high > aHigh);
  const lHigh = Math.max(...london.map(c => c.high));
  const lLow = Math.min(...london.map(c => c.low));

  const curBody = Math.abs(cur.close - cur.open);
  const isStrongBull = cur.close > cur.open && cur.close > p1.high && curBody >= 0.75 * atr;
  const isStrongBear = cur.close < cur.open && cur.close < p1.low && curBody >= 0.75 * atr;

  if (sweptLow && (cur.close > lHigh || p1.close > lHigh) && isStrongBull) {
    const sl = Math.min(...london.map(c => c.low)) - (0.35 * atr);
    const risk = cur.close - sl;
    if (risk / cur.close >= 0.0050) return { side: 'BUY', entry: cur.close, sl, risk };
  }
  if (sweptHigh && (cur.close < lLow || p1.close < lLow) && isStrongBear) {
    const sl = Math.max(...london.map(c => c.high)) + (0.35 * atr);
    const risk = sl - cur.close;
    if (risk / cur.close >= 0.0050) return { side: 'SELL', entry: cur.close, sl, risk };
  }
  return null;
}

// 2. Port 3007: CRT SMC (Turtle Soup)
function eval3007(sym, candles) {
  if (candles.length < 50 || !checkVolExpansion(candles)) return null;
  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const atr = calcATR(candles, 14);

  const c1 = candles.slice(n - 8, n - 4);
  const c1High = Math.max(...c1.map(c => c.high));
  const c1Low = Math.min(...c1.map(c => c.low));
  const c1Range = c1High - c1Low;
  if (c1Range < 1.5 * atr) return null;

  const c2 = candles.slice(n - 4, n - 1);
  const c2Low = Math.min(...c2.map(c => c.low));
  const c2High = Math.max(...c2.map(c => c.high));

  // Genuine liquidity wick sweep: sweeps extreme, but closes inside
  const bullSweep = c2Low < c1Low && p1.close > c1Low;
  const bearSweep = c2High > c1High && p1.close < c1High;

  const curBody = Math.abs(cur.close - cur.open);
  const isDispBull = cur.close > cur.open && curBody >= 0.80 * atr && cur.close > p1.high;
  const isDispBear = cur.close < cur.open && curBody >= 0.80 * atr && cur.close < p1.low;

  if (bullSweep && isDispBull) {
    const sl = c2Low - (0.35 * atr);
    const risk = cur.close - sl;
    if (risk / cur.close >= 0.0050) return { side: 'BUY', entry: cur.close, sl, risk };
  }
  if (bearSweep && isDispBear) {
    const sl = c2High + (0.35 * atr);
    const risk = sl - cur.close;
    if (risk / cur.close >= 0.0050) return { side: 'SELL', entry: cur.close, sl, risk };
  }
  return null;
}

// 3. Port 3008: Sean Solano VWAP + 9 EMA
function eval3008(sym, candles) {
  if (candles.length < 60 || !checkVolExpansion(candles)) return null;
  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const atr = calcATR(candles, 14);

  let cumVol = 0, cumVolPrice = 0;
  const vwapSeries = [];
  for (let i = n - 48; i < n; i++) {
    const c = candles[i];
    const typ = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumVol += vol;
    cumVolPrice += typ * vol;
    vwapSeries.push(cumVol > 0 ? cumVolPrice / cumVol : typ);
  }
  const curVWAP = vwapSeries[vwapSeries.length - 1];
  const prevVWAP = vwapSeries[vwapSeries.length - 6];
  const vwapSlopePct = ((curVWAP - prevVWAP) / curVWAP) * 100;
  if (Math.abs(vwapSlopePct) < 0.08) return null;

  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema50 = calcEMA(closes, 50);
  const curEma9 = ema9[ema9.length - 1];
  const curEma50 = ema50[ema50.length - 1];

  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const curBody = Math.abs(cur.close - cur.open);

  if (cur.close > curEma50 && vwapSlopePct > 0.08 && curEma9 > curVWAP) {
    const tapped = Math.min(cur.low, p1.low) <= Math.max(curEma9, curVWAP) * 1.002 && cur.close >= Math.min(curEma9, curVWAP);
    const isHammer = lowerWick >= 1.5 * curBody && cur.close > cur.open;
    const isEngulf = cur.close > cur.open && cur.close > p1.high && curBody >= 0.85 * atr;
    if (tapped && (isHammer || isEngulf)) {
      const sl = Math.min(...candles.slice(-6).map(c => c.low)) - (0.35 * atr);
      const risk = cur.close - sl;
      if (risk / cur.close >= 0.0050) return { side: 'BUY', entry: cur.close, sl, risk };
    }
  }

  if (cur.close < curEma50 && vwapSlopePct < -0.08 && curEma9 < curVWAP) {
    const tapped = Math.max(cur.high, p1.high) >= Math.min(curEma9, curVWAP) * 0.998 && cur.close <= Math.max(curEma9, curVWAP);
    const isStar = upperWick >= 1.5 * curBody && cur.close < cur.open;
    const isBearEngulf = cur.close < cur.open && cur.close < p1.low && curBody >= 0.85 * atr;
    if (tapped && (isStar || isBearEngulf)) {
      const sl = Math.max(...candles.slice(-6).map(c => c.high)) + (0.35 * atr);
      const risk = sl - cur.close;
      if (risk / cur.close >= 0.0050) return { side: 'SELL', entry: cur.close, sl, risk };
    }
  }
  return null;
}

// 4. Port 3009: Secret Mindset MACD
function eval3009(sym, candles) {
  if (candles.length < 60 || !checkVolExpansion(candles)) return null;
  const n = candles.length;
  const cur = candles[n - 1];
  const p1 = candles[n - 2];
  const p2 = candles[n - 3];
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

  const minClearance = 0.10 * atr;
  const curBody = Math.abs(cur.close - cur.open);

  if (curMacd > minClearance && curSignal > 0 && cur.close > curEma50) {
    const isHistTurn = curHist > prevHist && (prevHist < 0 || prevHist < prev2Hist);
    const isStrongCandle = cur.close > cur.open && curBody >= 0.80 * atr && cur.close > p1.high;
    if (isHistTurn && isStrongCandle) {
      const sl = Math.min(...candles.slice(-8).map(c => c.low)) - (0.35 * atr);
      const risk = cur.close - sl;
      if (risk / cur.close >= 0.0050) return { side: 'BUY', entry: cur.close, sl, risk };
    }
  }

  if (curMacd < -minClearance && curSignal < 0 && cur.close < curEma50) {
    const isHistTurn = curHist < prevHist && (prevHist > 0 || prevHist > prev2Hist);
    const isStrongCandle = cur.close < cur.open && curBody >= 0.80 * atr && cur.close < p1.low;
    if (isHistTurn && isStrongCandle) {
      const sl = Math.max(...candles.slice(-8).map(c => c.high)) + (0.35 * atr);
      const risk = sl - cur.close;
      if (risk / cur.close >= 0.0050) return { side: 'SELL', entry: cur.close, sl, risk };
    }
  }
  return null;
}

const allCandlesMap = new Map();
for (const sym of SYMBOLS) {
  const p = path.join(CACHE_DIR, `${sym}_15m_1month.json`);
  if (fs.existsSync(p)) allCandlesMap.set(sym, JSON.parse(fs.readFileSync(p, 'utf8')));
}

const tests = [
  { id: 3006, name: 'Pat ORB (Filter Tuned)', fn: eval3006 },
  { id: 3007, name: 'CRT SMC (Filter Tuned)', fn: eval3007 },
  { id: 3008, name: 'Solano VWAP (Filter Tuned)', fn: eval3008 },
  { id: 3009, name: 'Secret MACD (Filter Tuned)', fn: eval3009 },
];

const summary = [];
for (const t of tests) {
  let active = [];
  const trades = [];
  const lastBar = new Map();

  for (let bar = 70; bar < 2880; bar++) {
    for (let i = active.length - 1; i >= 0; i--) {
      const pos = active[i];
      const cur = allCandlesMap.get(pos.sym)[bar];
      let done = false;
      let pnlR = 0;
      let outcome = 'LOSS';

      if (pos.side === 'BUY') {
        if (!pos.tp1Hit && cur.high >= pos.earlyBE) pos.sl = Math.max(pos.sl, pos.entry + (0.05 * pos.risk));
        if (!pos.tp1Hit && cur.high >= pos.tp1) { pos.tp1Hit = true; pos.sl = Math.max(pos.sl, pos.entry + (0.05 * pos.risk)); }

        if (pos.tp1Hit) {
          if (cur.high >= pos.tp2) { outcome = 'WIN_TP2'; pnlR = 1.25; done = true; }
          else if (cur.low <= pos.sl) { outcome = 'WIN_TP1_BE'; pnlR = 0.7625; done = true; }
        } else {
          if (cur.low <= pos.sl) {
            outcome = pos.sl > pos.entry ? 'WIN_BE' : 'LOSS';
            pnlR = pos.sl > pos.entry ? 0.05 : -1.0;
            done = true;
          }
        }
      } else {
        if (!pos.tp1Hit && cur.low <= pos.earlyBE) pos.sl = Math.min(pos.sl, pos.entry - (0.05 * pos.risk));
        if (!pos.tp1Hit && cur.low <= pos.tp1) { pos.tp1Hit = true; pos.sl = Math.min(pos.sl, pos.entry - (0.05 * pos.risk)); }

        if (pos.tp1Hit) {
          if (cur.low <= pos.tp2) { outcome = 'WIN_TP2'; pnlR = 1.25; done = true; }
          else if (cur.high >= pos.sl) { outcome = 'WIN_TP1_BE'; pnlR = 0.7625; done = true; }
        } else {
          if (cur.high >= pos.sl) {
            outcome = pos.sl < pos.entry ? 'WIN_BE' : 'LOSS';
            pnlR = pos.sl < pos.entry ? 0.05 : -1.0;
            done = true;
          }
        }
      }

      if (done) {
        trades.push({ side: pos.side, outcome, pnlR, pnlUSD: pnlR * 10 });
        active.splice(i, 1);
      }
    }

    if (active.length < 4) {
      for (const [sym, cList] of allCandlesMap.entries()) {
        if (active.length >= 4) break;
        if (active.some(p => p.sym === sym)) continue;
        const lb = lastBar.get(sym) || -999;
        if (bar - lb < 96) continue;

        const slice = cList.slice(0, bar + 1);
        const sig = t.fn(sym, slice);
        if (sig) {
          lastBar.set(sym, bar);
          active.push({
            sym,
            side: sig.side,
            entry: sig.entry,
            sl: sig.sl,
            risk: sig.risk,
            tp1: sig.side === 'BUY' ? sig.entry + sig.risk : sig.entry - sig.risk,
            tp2: sig.side === 'BUY' ? sig.entry + (sig.risk * 2) : sig.entry - (sig.risk * 2),
            earlyBE: sig.side === 'BUY' ? sig.entry + (sig.risk * 0.75) : sig.entry - (sig.risk * 0.75),
            tp1Hit: false
          });
        }
      }
    }
  }

  const buys = trades.filter(x => x.side === 'BUY');
  const sells = trades.filter(x => x.side === 'SELL');
  const buyWins = buys.filter(x => x.outcome !== 'LOSS').length;
  const sellWins = sells.filter(x => x.outcome !== 'LOSS').length;
  const totalWins = buyWins + sellWins;
  const wr = trades.length ? ((totalWins / trades.length) * 100).toFixed(1) : '0';

  const gp = trades.filter(x => x.pnlUSD > 0).reduce((s, x) => s + x.pnlUSD, 0);
  const gl = Math.abs(trades.filter(x => x.pnlUSD < 0).reduce((s, x) => s + x.pnlUSD, 0));
  const pf = gl > 0 ? (gp / gl).toFixed(2) : (gp > 0 ? '99.00' : '0.00');
  const net = (gp - gl).toFixed(2);

  summary.push({
    Port: t.id,
    Strategy: t.name,
    Trades: trades.length,
    Longs: `${buyWins}/${buys.length} (${buys.length ? ((buyWins/buys.length)*100).toFixed(1) : 0}%)`,
    Shorts: `${sellWins}/${sells.length} (${sells.length ? ((sellWins/sells.length)*100).toFixed(1) : 0}%)`,
    'WR%': `${wr}%`,
    PF: pf,
    'Net ($)': `+$${net}`,
    'Net (₹)': `+₹${Math.round(net * 84)}`
  });
}

console.table(summary);
