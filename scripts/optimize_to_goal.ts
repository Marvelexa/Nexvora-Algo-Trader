import fs from 'fs';
import path from 'path';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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

const ALL_SYMBOLS = ['ADAUSD', 'SOLUSD', 'DOGEUSD', 'ETHUSD', 'SUIUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): CandleData[] {
  const file5k = path.join(CACHE_DIR, `${symbol}_15m_5000.json`);
  if (fs.existsSync(file5k)) return JSON.parse(fs.readFileSync(file5k, 'utf-8'));
  const file2k = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (fs.existsSync(file2k)) return JSON.parse(fs.readFileSync(file2k, 'utf-8'));
  return [];
}

function load1hCandles(symbol: string): CandleData[] {
  const file1500 = path.join(CACHE_DIR, `${symbol}_1h_1500.json`);
  if (fs.existsSync(file1500)) return JSON.parse(fs.readFileSync(file1500, 'utf-8'));
  const file500 = path.join(CACHE_DIR, `${symbol}_1h_500.json`);
  if (fs.existsSync(file500)) return JSON.parse(fs.readFileSync(file500, 'utf-8'));
  return [];
}

interface SimResult {
  finalCapitalUSD: number;
  finalCapitalINR: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  reachedGoal: boolean;
  params: any;
  trades: any[];
}

function runFastSim(
  barDataByTime: Map<number, Map<string, PrecomputedBar>>,
  sortedTimes: number[],
  symbols: string[],
  p: {
    minMath: number;
    minConf: number;
    tpAtr: number;
    slAtr: number;
    trailTriggerAtr: number;
    trailLockAtr: number;
    riskPct: number;
    leverage: number;
    adxMin: number;
    require1h: boolean;
    useCooldown: boolean;
  }
): SimResult {
  const USD_INR = 84.0;
  let capitalUSD = 23.81; // ₹2,000 INR
  let peak = capitalUSD;
  let maxDDPct = 0;

  const trades: any[] = [];
  let pos: any = null;
  let consecutiveLosses = 0;
  let cooldownUntil = 0;

  const symbolLastLossTime = new Map<string, number>();

  for (let tIdx = 0; tIdx < sortedTimes.length; tIdx++) {
    const t = sortedTimes[tIdx];
    const symMap = barDataByTime.get(t);
    if (!symMap) continue;

    // 1. Position Management
    if (pos) {
      const bar = symMap.get(pos.symbol);
      if (bar) {
        const { side, entryPrice, quantity, notionalUSD, atr } = pos;

        if (bar.high > pos.highPrice) pos.highPrice = bar.high;
        if (bar.low < pos.lowPrice) pos.lowPrice = bar.low;

        // Dynamic Two-Tier High-Watermark Trailing
        const favDist = side === 'BUY' ? pos.highPrice - entryPrice : entryPrice - pos.lowPrice;
        if (favDist >= p.trailTriggerAtr * atr) {
          pos.isTrailing = true;
          // Tier 1: lock 0.6x ATR
          // Tier 2: if favDist >= 2.0x ATR, lock 1.3x ATR
          const lockMult = favDist >= 2.0 * atr ? 1.3 : p.trailLockAtr;
          const trailSL = side === 'BUY'
            ? pos.highPrice - (lockMult * atr)
            : pos.lowPrice + (lockMult * atr);

          // Enforce minimum guaranteed profit floor on trailing SL
          const estFees = notionalUSD * 0.0014;
          const minLockDist = (estFees + 0.50) / quantity;
          const floorSL = side === 'BUY' ? entryPrice + minLockDist : entryPrice - minLockDist;

          const effectiveTrailSL = side === 'BUY'
            ? Math.max(trailSL, floorSL)
            : Math.min(trailSL, floorSL);

          if (side === 'BUY' && effectiveTrailSL > pos.stopLoss) pos.stopLoss = effectiveTrailSL;
          if (side === 'SELL' && effectiveTrailSL < pos.stopLoss) pos.stopLoss = effectiveTrailSL;
        }

        const isTP = side === 'BUY' ? bar.high >= pos.takeProfit : bar.low <= pos.takeProfit;
        const isSL = side === 'BUY' ? bar.low <= pos.stopLoss : bar.high >= pos.stopLoss;

        if (isTP || isSL) {
          const exitPrice = isTP ? pos.takeProfit : pos.stopLoss;
          const exitReason = isTP ? 'TARGET_HIT' : (pos.isTrailing ? 'TRAIL_HIT' : 'SL_HIT');

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
            symbolLastLossTime.set(pos.symbol, tIdx);
            if (p.useCooldown && consecutiveLosses >= 2) {
              cooldownUntil = tIdx + 12; // 3 hours market cooldown
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

    // 2. Opportunity Scan
    if (!pos && capitalUSD > 5.0 && capitalUSD < 95.24 && tIdx >= cooldownUntil) {
      const candidates: any[] = [];

      for (const sym of symbols) {
        // Per-symbol cooldown: don't trade same symbol within 10 bars of a loss
        const lastLoss = symbolLastLossTime.get(sym);
        if (lastLoss !== undefined && tIdx - lastLoss < 10) continue;

        const bar = symMap.get(sym);
        if (!bar) continue;

        // Math threshold
        if (!bar.mathSide || bar.mathScore < p.minMath) continue;
        const side = bar.mathSide;

        // Confluence
        if (side === 'BUY' && !bar.allowsLong) continue;
        if (side === 'SELL' && !bar.allowsShort) continue;

        // Price action candle filter + Exhaustion Band
        if (side === 'BUY') {
          if (!bar.isGreen) continue;
          if (bar.upperWick > bar.body * 1.0) continue;
          if (bar.close < bar.ema20) continue;
          if (bar.rsi14 < 44 || bar.rsi14 > 64) continue; // Healthy sweet spot (44-64)
        } else {
          if (bar.isGreen) continue;
          if (bar.lowerWick > bar.body * 1.0) continue;
          if (bar.close > bar.ema20) continue;
          if (bar.rsi14 > 56 || bar.rsi14 < 36) continue; // Healthy sweet spot (36-56)
        }

        // ADX
        if (bar.adx < p.adxMin) continue;

        // 1H Trend
        if (p.require1h) {
          if (side === 'BUY' && bar.close < bar.h1Ema50) continue;
          if (side === 'SELL' && bar.close > bar.h1Ema50) continue;
        }

        const score = bar.mathScore + bar.confScore;
        candidates.push({ symbol: sym, side, score, atr: bar.atr, price: bar.close });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        // Sizing
        const riskUSD = Math.max(1.30, parseFloat((capitalUSD * p.riskPct).toFixed(2)));
        const slDist = best.atr * p.slAtr;
        const tpDist = best.atr * p.tpAtr;

        let quantity = parseFloat((riskUSD / slDist).toFixed(4));
        let notionalUSD = parseFloat((quantity * best.price).toFixed(2));
        let marginUSD = parseFloat((notionalUSD / p.leverage).toFixed(2));

        const maxMargin = parseFloat((capitalUSD * 0.75).toFixed(2));
        if (marginUSD > maxMargin) {
          marginUSD = maxMargin;
          notionalUSD = parseFloat((marginUSD * p.leverage).toFixed(2));
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
          isTrailing: false,
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
    finalCapitalUSD: capitalUSD,
    finalCapitalINR: Math.round(capitalUSD * USD_INR),
    totalTrades: total,
    winningTrades: wins,
    losingTrades: losses,
    winRate: wr,
    profitFactor: pf,
    maxDrawdownPct: parseFloat(maxDDPct.toFixed(1)),
    reachedGoal: capitalUSD >= 95.24,
    params: p,
    trades,
  };
}

async function main() {
  console.log(`========================================================================`);
  console.log(`⚡ HIGH-SPEED PRE-COMPUTED GRID OPTIMIZER (2K -> 8K TARGET)`);
  console.log(`========================================================================\n`);

  console.log(`📡 Pre-computing technical indicators across all 2,500 bars for all coins...`);
  const startPre = Date.now();

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
  console.log(`✅ Pre-computed ${sortedTimes.length} unique time slices in ${((Date.now() - startPre) / 1000).toFixed(1)}s!\n`);

  console.log(`🔍 Executing Rapid Grid Search across parameter combinations...`);
  const startSim = Date.now();

  const coinConfigs = [
    { name: 'Profitable Basket (ADA, SUI, DOGE, ETH)', syms: ['ADAUSD', 'SUIUSD', 'DOGEUSD', 'ETHUSD'] },
    { name: 'ADA & DOGE & SUI', syms: ['ADAUSD', 'DOGEUSD', 'SUIUSD'] },
    { name: 'Top 5 (ADA, SOL, DOGE, ETH, SUI)', syms: ['ADAUSD', 'SOLUSD', 'DOGEUSD', 'ETHUSD', 'SUIUSD'] },
    { name: 'ADA & SUI Only', syms: ['ADAUSD', 'SUIUSD'] },
    { name: 'ADA Only', syms: ['ADAUSD'] },
  ];

  let best: SimResult | null = null;
  const goalWinners: SimResult[] = [];

  for (const coinCfg of coinConfigs) {
    for (const minMath of [45, 50, 55]) {
      for (const tpAtr of [2.0, 2.4, 2.8, 3.2]) {
        for (const slAtr of [0.85, 1.0, 1.2]) {
          for (const riskPct of [0.08, 0.10, 0.12, 0.15]) {
            for (const trailTriggerAtr of [1.4, 1.6]) {
              for (const adxMin of [20, 24]) {
                for (const useCooldown of [true, false]) {
                  const res = runFastSim(barDataByTime, sortedTimes, coinCfg.syms, {
                    minMath,
                    minConf: 70,
                    tpAtr,
                    slAtr,
                    trailTriggerAtr,
                    trailLockAtr: 0.6,
                    riskPct,
                    leverage: 30,
                    adxMin,
                    require1h: true,
                    useCooldown,
                  });

                  if (res.reachedGoal) {
                    goalWinners.push(res);
                  }

                  if (!best || res.finalCapitalUSD > best.finalCapitalUSD) {
                    best = res;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`✅ Grid search completed in ${((Date.now() - startSim) / 1000).toFixed(1)}s!`);
  console.log(`🎯 Found ${goalWinners.length} parameter configurations that hit ₹8,000+ GOAL!\n`);

  // Pick best winner: highest final capital or best profit factor
  const targetWinner = goalWinners.length > 0
    ? goalWinners.sort((a, b) => b.finalCapitalUSD - a.finalCapitalUSD)[0]
    : best!;

  console.log(`========================================================================`);
  console.log(`🏆 OPTIMAL WINNING STRATEGY RESULTS (GOAL: 2,000 INR -> 8,000 INR)`);
  console.log(`========================================================================`);
  console.log(`Starting Capital: ₹2,000 ($23.81)`);
  console.log(`Final Capital:    ₹${targetWinner.finalCapitalINR} ($${targetWinner.finalCapitalUSD})`);
  console.log(`Net Profit:       ₹${Math.round((targetWinner.finalCapitalUSD - 23.81) * 84)} (+$${(targetWinner.finalCapitalUSD - 23.81).toFixed(2)})`);
  console.log(`Return on Capital: +${(((targetWinner.finalCapitalUSD - 23.81) / 23.81) * 100).toFixed(1)}%`);
  console.log(`Total Trades:     ${targetWinner.totalTrades}`);
  console.log(`Wins / Losses:    ${targetWinner.winningTrades} Wins / ${targetWinner.losingTrades} Losses`);
  console.log(`Win Rate:         ${targetWinner.winRate}%`);
  console.log(`Profit Factor:    ${targetWinner.profitFactor}`);
  console.log(`Max Drawdown:     ${targetWinner.maxDrawdownPct}%`);
  console.log(`Target Achieved:  ${targetWinner.reachedGoal ? '🎯 YES (₹8,000+ REACHED!)' : 'High Growth Achieved'}`);
  console.log(`Optimal Parameters:`, JSON.stringify(targetWinner.params, null, 2));
  console.log(`========================================================================\n`);

  console.log(`📋 Trade-by-Trade Performance Log:`);
  targetWinner.trades.forEach(t => {
    const sign = t.netPnl >= 0 ? '+' : '';
    console.log(`  [#${t.tradeNum.toString().padStart(2, '0')}] ${t.symbol.padEnd(7)} ${t.side.padEnd(4)} | In: $${t.entryPrice.toFixed(4)} Out: $${t.exitPrice.toFixed(4)} | PnL: ${sign}$${t.netPnl.toFixed(2)} (${t.exitReason}) -> Capital: ₹${t.capitalAfterINR} ($${t.capitalAfterUSD.toFixed(2)})`);
  });

  // Save report
  fs.writeFileSync(path.join(process.cwd(), 'public', 'goal_backtest_report.json'), JSON.stringify(targetWinner, null, 2), 'utf-8');
  console.log(`\n💾 Saved detailed audit report to public/goal_backtest_report.json`);
}

main().catch(console.error);
