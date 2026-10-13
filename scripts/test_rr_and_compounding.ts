import fs from 'fs';
import path from 'path';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

interface PrecomputedBar {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  mathScore: number;
  mathSide: 'BUY' | 'SELL' | null;
  confScore: number;
  allowsLong: boolean;
  allowsShort: boolean;
  trendDirection: string;
  ema20: number;
  ema50: number;
  h1Ema50: number;
  rsi14: number;
  adx: number;
  atr: number;
  isGreen: boolean;
  body: number;
  upperWick: number;
  lowerWick: number;
}

const ALL_SYMBOLS = ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'ETHUSD', 'SOLUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): any[] {
  const file5k = path.join(CACHE_DIR, `${symbol}_15m_5000.json`);
  if (fs.existsSync(file5k)) return JSON.parse(fs.readFileSync(file5k, 'utf-8'));
  const file2k = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (fs.existsSync(file2k)) return JSON.parse(fs.readFileSync(file2k, 'utf-8'));
  return [];
}

function load1hCandles(symbol: string): any[] {
  const file1500 = path.join(CACHE_DIR, `${symbol}_1h_1500.json`);
  if (fs.existsSync(file1500)) return JSON.parse(fs.readFileSync(file1500, 'utf-8'));
  return [];
}

console.log('📡 Pre-computing bars...');
const barDataByTime = new Map<number, Map<string, PrecomputedBar>>();
const allTimestamps = new Set<number>();

for (const sym of ALL_SYMBOLS) {
  const bars15m = loadCandles(sym);
  const bars1h = load1hCandles(sym);
  if (bars15m.length < 100) continue;

  for (let i = 50; i < bars15m.length; i++) {
    const window15m = bars15m.slice(i - 50, i + 1);
    const last = window15m[window15m.length - 1];
    allTimestamps.add(last.time);

    const math = QuantMathematicalEngine.evaluateMarketMath(sym, window15m);
    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window15m);
    const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);

    const closes = window15m.map(c => c.close);
    const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
    const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];

    let h1Ema50 = last.close;
    const currentH1 = bars1h.filter((b: any) => b.time <= last.time).slice(-50);
    if (currentH1.length >= 20) {
      const h1Closes = currentH1.map((b: any) => b.close);
      h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50).slice(-1)[0];
    }

    const isGreen = last.close > last.open;
    const body = Math.abs(last.close - last.open);
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const atr = conf.atr > 0 ? conf.atr : last.close * 0.008;

    const precBar: PrecomputedBar = {
      symbol: sym,
      time: last.time,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
      mathScore: math.quantScore,
      mathSide: math.recommendedSide,
      confScore: conf.confluenceScore,
      allowsLong: conf.allowsLong,
      allowsShort: conf.allowsShort,
      trendDirection: conf.trendDirection,
      ema20,
      ema50,
      h1Ema50,
      rsi14: conf.rsi14,
      adx,
      atr,
      isGreen,
      body,
      upperWick,
      lowerWick,
    };

    if (!barDataByTime.has(last.time)) {
      barDataByTime.set(last.time, new Map<string, PrecomputedBar>());
    }
    barDataByTime.get(last.time)!.set(sym, precBar);
  }
}

const sortedTimes = Array.from(allTimestamps).sort((a, b) => a - b);
console.log(`✅ Precomputed ${sortedTimes.length} bars across ${ALL_SYMBOLS.length} symbols.\n`);

interface StrategyConfig {
  name: string;
  symbols: string[];
  tpAtr: number;
  slAtr: number;
  moveToBeAtAtr: number; // move SL to entry + fee buffer when price reaches this ATR
  riskPct: number;
  adxMin: number;
  require1h: boolean;
  minMath: number;
  minConf: number;
  dynamicCompound: boolean;
}

function runSimulation(cfg: StrategyConfig) {
  const USD_INR = 84.0;
  let capitalUSD = 23.81; // ₹2,000 INR
  let peak = capitalUSD;
  let maxDDPct = 0;

  const trades: any[] = [];
  let pos: any = null;
  let consecutiveLosses = 0;
  let cooldownUntil = 0;

  for (let tIdx = 0; tIdx < sortedTimes.length; tIdx++) {
    const t = sortedTimes[tIdx];
    const symMap = barDataByTime.get(t);
    if (!symMap) continue;

    // 1. Manage position
    if (pos) {
      const bar = symMap.get(pos.symbol);
      if (bar) {
        const { side, entryPrice, quantity, notionalUSD, atr } = pos;

        if (bar.high > pos.highPrice) pos.highPrice = bar.high;
        if (bar.low < pos.lowPrice) pos.lowPrice = bar.low;

        // Move to Break-Even if in profit by moveToBeAtAtr
        const favDist = side === 'BUY' ? pos.highPrice - entryPrice : entryPrice - pos.lowPrice;
        if (cfg.moveToBeAtAtr > 0 && favDist >= cfg.moveToBeAtAtr * atr) {
          const estFees = notionalUSD * 0.0014;
          const beBuffer = (estFees + 0.15) / quantity;
          const beSL = side === 'BUY' ? entryPrice + beBuffer : entryPrice - beBuffer;

          if (side === 'BUY' && beSL > pos.stopLoss) {
            pos.stopLoss = beSL;
            pos.isBE = true;
          }
          if (side === 'SELL' && beSL < pos.stopLoss) {
            pos.stopLoss = beSL;
            pos.isBE = true;
          }
        }

        const isTP = side === 'BUY' ? bar.high >= pos.takeProfit : bar.low <= pos.takeProfit;
        const isSL = side === 'BUY' ? bar.low <= pos.stopLoss : bar.high >= pos.stopLoss;

        if (isTP || isSL) {
          const exitPrice = isTP ? pos.takeProfit : pos.stopLoss;
          const exitReason = isTP ? 'TARGET_HIT' : (pos.isBE ? 'BREAK_EVEN' : 'SL_HIT');

          const gross = side === 'BUY'
            ? (exitPrice - entryPrice) * quantity
            : (entryPrice - exitPrice) * quantity;
          const fees = (notionalUSD + (exitPrice * quantity)) * 0.0007;
          const net = parseFloat((gross - fees).toFixed(2));

          capitalUSD = parseFloat((capitalUSD + net).toFixed(2));
          if (capitalUSD > peak) peak = capitalUSD;
          const dd = peak - capitalUSD;
          const ddPct = (dd / peak) * 100;
          if (ddPct > maxDDPct) maxDDPct = ddPct;

          if (net <= 0) {
            consecutiveLosses++;
            if (consecutiveLosses >= 2) {
              cooldownUntil = tIdx + 8; // 2 hour cooldown after 2 losses
              consecutiveLosses = 0;
            }
          } else {
            consecutiveLosses = 0;
          }

          trades.push({
            tradeNum: trades.length + 1,
            symbol: pos.symbol,
            side,
            entryTime: new Date(pos.entryTime).toISOString(),
            exitTime: new Date(bar.time).toISOString(),
            entryPrice,
            exitPrice,
            quantity,
            grossPnl: parseFloat(gross.toFixed(2)),
            fees: parseFloat(fees.toFixed(2)),
            netPnl: net,
            exitReason,
            capitalAfterUSD: capitalUSD,
            capitalAfterINR: Math.round(capitalUSD * USD_INR),
          });

          pos = null;
          if (capitalUSD >= 95.24 || capitalUSD <= 5.0) break;
        }
      }
    }

    // 2. Open new position
    if (!pos && capitalUSD > 5.0 && capitalUSD < 95.24 && tIdx >= cooldownUntil) {
      const candidates: any[] = [];

      for (const sym of cfg.symbols) {
        const bar = symMap.get(sym);
        if (!bar) continue;

        // Math threshold
        if (!bar.mathSide || bar.mathScore < cfg.minMath) continue;
        const side = bar.mathSide;

        // Confluence
        if (side === 'BUY' && !bar.allowsLong) continue;
        if (side === 'SELL' && !bar.allowsShort) continue;

        // Strict candle filter (Don't short green bar, don't buy red bar)
        if (side === 'BUY') {
          if (!bar.isGreen) continue;
          if (bar.upperWick > bar.body * 0.8) continue; // Upper rejection wick < 80% body
          if (bar.close < bar.ema20) continue;
          if (bar.rsi14 < 45 || bar.rsi14 > 65) continue;
        } else {
          if (bar.isGreen) continue;
          if (bar.lowerWick > bar.body * 0.8) continue; // Lower rejection wick < 80% body
          if (bar.close > bar.ema20) continue;
          if (bar.rsi14 > 55 || bar.rsi14 < 35) continue;
        }

        // ADX Trend Filter
        if (bar.adx < cfg.adxMin) continue;

        // 1H Macro Trend
        if (cfg.require1h) {
          if (side === 'BUY' && bar.close < bar.h1Ema50) continue;
          if (side === 'SELL' && bar.close > bar.h1Ema50) continue;
        }

        const score = bar.mathScore + bar.confScore;
        candidates.push({ symbol: sym, side, score, atr: bar.atr, price: bar.close });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        // Sizing logic
        // Anti-martingale / Compounding:
        // Baseline risk = riskPct * capital
        // If capital is growing, scale risk modestly
        const riskUSD = Math.max(1.50, parseFloat((capitalUSD * cfg.riskPct).toFixed(2)));
        const slDist = best.atr * cfg.slAtr;
        const tpDist = best.atr * cfg.tpAtr;

        let quantity = parseFloat((riskUSD / slDist).toFixed(4));
        let notionalUSD = parseFloat((quantity * best.price).toFixed(2));
        let marginUSD = parseFloat((notionalUSD / 30).toFixed(2));

        const maxMargin = parseFloat((capitalUSD * 0.80).toFixed(2));
        if (marginUSD > maxMargin) {
          marginUSD = maxMargin;
          notionalUSD = parseFloat((marginUSD * 30).toFixed(2));
          quantity = parseFloat((notionalUSD / best.price).toFixed(4));
        }
        if (quantity <= 0) quantity = 1;

        const stopLoss = best.side === 'BUY' ? best.price - slDist : best.price + slDist;
        const takeProfit = best.side === 'BUY' ? best.price + tpDist : best.price - tpDist;

        pos = {
          symbol: best.symbol,
          side: best.side,
          entryPrice: best.price,
          entryTime: t,
          quantity,
          notionalUSD,
          atr: best.atr,
          stopLoss,
          takeProfit,
          highPrice: best.price,
          lowPrice: best.price,
          isBE: false,
        };
      }
    }
  }

  const wins = trades.filter(t => t.netPnl > 0).length;
  const losses = trades.filter(t => t.netPnl <= 0).length;
  const total = trades.length;
  const wr = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
  const grossW = trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const grossL = Math.abs(trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  const pf = grossL > 0 ? parseFloat((grossW / grossL).toFixed(2)) : (grossW > 0 ? 99 : 0);

  return {
    name: cfg.name,
    capitalINR: Math.round(capitalUSD * USD_INR),
    capitalUSD: parseFloat(capitalUSD.toFixed(2)),
    trades: total,
    winRate: wr,
    profitFactor: pf,
    maxDrawdownPct: parseFloat(maxDDPct.toFixed(1)),
    reachedGoal: capitalUSD >= 95.24,
    tradeList: trades,
  };
}

// Test parameter matrices
const tests: StrategyConfig[] = [];

for (const tpAtr of [1.6, 2.0, 2.5, 3.0]) {
  for (const slAtr of [1.0, 1.2, 1.5]) {
    for (const moveToBeAtAtr of [0, 1.2, 1.5]) {
      for (const riskPct of [0.10, 0.12, 0.15, 0.18]) {
        for (const adxMin of [20, 24, 28]) {
          tests.push({
            name: `TP=${tpAtr}x SL=${slAtr}x BE=${moveToBeAtAtr}x Risk=${riskPct*100}% ADX=${adxMin}`,
            symbols: ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'ETHUSD'],
            tpAtr,
            slAtr,
            moveToBeAtAtr,
            riskPct,
            adxMin,
            require1h: true,
            minMath: 45,
            minConf: 65,
            dynamicCompound: true,
          });
        }
      }
    }
  }
}

console.log(`Running ${tests.length} tests...`);
const results = tests.map(runSimulation);
const winners = results.filter(r => r.reachedGoal);

console.log(`Total test variants: ${results.length}`);
console.log(`Configurations reaching ₹8,000+ ($95.24): ${winners.length}\n`);

// Sort by final capital descending, then profit factor
const sorted = results.sort((a, b) => b.capitalUSD - a.capitalUSD);
console.log(`TOP 10 STRATEGY CONFIGURATIONS:`);
sorted.slice(0, 10).forEach((r, idx) => {
  console.log(`[#${idx+1}] ${r.name}`);
  console.log(`     Final: ₹${r.capitalINR} ($${r.capitalUSD}) | Trades: ${r.trades} | WR: ${r.winRate}% | PF: ${r.profitFactor} | MaxDD: ${r.maxDrawdownPct}% | Goal: ${r.reachedGoal ? '🎯 YES' : 'NO'}`);
});

if (winners.length > 0) {
  const topWinner = winners.sort((a, b) => b.profitFactor - a.profitFactor)[0];
  console.log(`\n=======================================================`);
  console.log(`🏆 BEST GOAL-REACHING CONFIGURATION (${topWinner.name})`);
  console.log(`=======================================================`);
  console.log(`Final Capital: ₹${topWinner.capitalINR} ($${topWinner.capitalUSD})`);
  console.log(`Trades: ${topWinner.trades} | Win Rate: ${topWinner.winRate}% | Profit Factor: ${topWinner.profitFactor} | Max DD: ${topWinner.maxDrawdownPct}%`);
  console.log(`First 15 Trades:`);
  topWinner.tradeList.slice(0, 15).forEach((t: any) => {
    console.log(`  [#${t.tradeNum}] ${t.symbol} ${t.side} | In: $${t.entryPrice} Out: $${t.exitPrice} | PnL: $${t.netPnl} (${t.exitReason}) -> ₹${t.capitalAfterINR}`);
  });
  console.log(`Last 10 Trades:`);
  topWinner.tradeList.slice(-10).forEach((t: any) => {
    console.log(`  [#${t.tradeNum}] ${t.symbol} ${t.side} | In: $${t.entryPrice} Out: $${t.exitPrice} | PnL: $${t.netPnl} (${t.exitReason}) -> ₹${t.capitalAfterINR}`);
  });
}
