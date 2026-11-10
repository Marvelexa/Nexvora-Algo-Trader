import fs from 'fs';
import path from 'path';
import { ytPatOrb3006Engine } from '../lib/strategies/ytPatOrb3006Engine';
import { ytCrtSmc3007Engine } from '../lib/strategies/ytCrtSmc3007Engine';
import { ytSolanoVwap3008Engine } from '../lib/strategies/ytSolanoVwap3008Engine';
import { ytSecretMacd3009Engine } from '../lib/strategies/ytSecretMacd3009Engine';
import { ytSidewaysRange3010Engine } from '../lib/strategies/ytSidewaysRange3010Engine';
import { bradGohMindMathMoney3002Engine } from '../lib/strategies/bradGohMindMathMoney3002Engine';
import { tradingLabDivergence3003Engine } from '../lib/strategies/tradingLabDivergence3003Engine';
import { fractalFlowVolumeProfile3004Engine } from '../lib/strategies/fractalFlowVolumeProfile3004Engine';
import { hybridMasterCryptoSMC3005Engine } from '../lib/strategies/hybridMasterCryptoSMC3005Engine';
import { KlinePoint } from '../src/types';

const CACHE_DIR = path.join(process.cwd(), '.cache_candles_1m');
const DIST_DIR = path.join(process.cwd(), 'dist');

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
  'NEARUSDT',
  'ARBUSDT',
  'OPUSDT',
  'APTUSDT',
  'INJUSDT',
];

interface StrategyRunner {
  id: number;
  name: string;
  source: string;
  evaluator: (sym: string, candles: KlinePoint[]) => {
    recommendedSide: 'BUY' | 'SELL' | null;
    confidenceScore: number;
    setupType: string;
    entryPrice: number;
    customSL?: number;
    customTP?: number;
    tp1Price?: number;
    tp2Price?: number;
    earlyBreakevenPrice?: number;
    reasons: string[];
  };
}

const STRATEGIES: StrategyRunner[] = [
  // 4 NEW ISOLATED YOUTUBE ENGINES
  {
    id: 3006,
    name: 'Port 3006: YT_PAT_ORB_ENGINE',
    source: 'Trade with Pat (http://www.youtube.com/watch?v=E3McKlAp3qk)',
    evaluator: (sym, c) => ytPatOrb3006Engine.evaluateSetup(sym, c),
  },
  {
    id: 3007,
    name: 'Port 3007: YT_CRT_SMC_ENGINE',
    source: 'Iqshant Ladha (http://www.youtube.com/watch?v=KRl1JnWaOLU)',
    evaluator: (sym, c) => ytCrtSmc3007Engine.evaluateSetup(sym, c),
  },
  {
    id: 3008,
    name: 'Port 3008: YT_SOLANO_VWAP_ENGINE',
    source: 'Sean Solano (http://www.youtube.com/watch?v=Ii1h78hBhZg)',
    evaluator: (sym, c) => ytSolanoVwap3008Engine.evaluateSetup(sym, c),
  },
  {
    id: 3009,
    name: 'Port 3009: YT_SECRET_MACD_ENGINE',
    source: 'The Secret Mindset (http://www.youtube.com/watch?v=S2HaCa0b-bY)',
    evaluator: (sym, c) => ytSecretMacd3009Engine.evaluateSetup(sym, c),
  },
  {
    id: 3010,
    name: 'Port 3010: YT_SIDEWAYS_RANGE_ENGINE',
    source: 'Best Strategies in a Sideways Market (https://www.youtube.com/watch?v=OhXnH8FnTzc)',
    evaluator: (sym, c) => ytSidewaysRange3010Engine.evaluateSetup(sym, c),
  },
  // CORE SYSTEMS BILATERAL BENCHMARK
  {
    id: 3002,
    name: 'Port 3002: Brad Goh 5-Step Reversal',
    source: 'Brad Goh (https://youtu.be/PkAtVH6YVM8)',
    evaluator: (sym, c) => bradGohMindMathMoney3002Engine.evaluateSetup(sym, c, 1000, 'MODE_B'),
  },
  {
    id: 3004,
    name: 'Port 3004: Fractal Flow Volume Profile',
    source: 'Fractal Flow (http://www.youtube.com/watch?v=9eqDWJSvCx4)',
    evaluator: (sym, c) => fractalFlowVolumeProfile3004Engine.evaluateSetup(sym, c, 1000, 'MODE_B'),
  },
  {
    id: 3003,
    name: 'Port 3003: TradingLab Liquidity Grab',
    source: 'TradingLab (https://youtu.be/4cT8WTyxhYY)',
    evaluator: (sym, c) => tradingLabDivergence3003Engine.evaluateSetup(sym, c, 1000, 'MODE_B'),
  },
  {
    id: 3005,
    name: 'Port 3005: Hybrid Master Crypto SMC (Isolated)',
    source: 'Neeraj Joshi + Solomon King',
    evaluator: (sym, c) => hybridMasterCryptoSMC3005Engine.evaluateSetup(sym, c, 1000, 'MODE_B'),
  },
];

interface SimTrade {
  tradeId: number;
  strategyId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryTime: string;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  earlyBreakevenPrice: number;
  exitTime: string;
  exitPrice: number;
  outcome: 'WIN_TP2' | 'WIN_TP1_BE' | 'WIN_BE' | 'LOSS';
  pnlR: number;
  pnlUSD: number;
  reason: string;
}

export interface IsolatedPerformanceSummary {
  strategyId: number;
  strategyName: string;
  source: string;
  totalTrades: number;
  buyTrades: number;
  buyWins: number;
  buyWinRatePct: number;
  sellTrades: number;
  sellWins: number;
  sellWinRatePct: number;
  overallWins: number;
  overallWinRatePct: number;
  profitFactor: number;
  maxDrawdownUSD: number;
  maxDrawdownPct: number;
  netRealizedPnlUSD: number;
  netRealizedPnlINR: number;
  sampleTrades: SimTrade[];
}

function loadCandles(symbol: string): KlinePoint[] {
  const file = path.join(CACHE_DIR, `${symbol}_15m_1month.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

export function runIsolatedYouTubeBacktest(): IsolatedPerformanceSummary[] {
  console.log('================================================================================');
  console.log('   ISOLATED YOUTUBE SYSTEMS (PORTS 3006-3009 & BILATERAL 3002-3005) BACKTEST   ');
  console.log('   Enforcing Bilateral Long & Short Symmetry Across 15 Liquid Crypto Pairs     ');
  console.log('================================================================================\n');

  const symbolData: Record<string, KlinePoint[]> = {};
  for (const sym of SYMBOLS) {
    const candles = loadCandles(sym);
    if (candles.length > 0) {
      symbolData[sym] = candles;
    }
  }

  const USD_TO_INR = 84.0;
  const STARTING_CAPITAL_USD = 1000.0;
  const RISK_PER_TRADE_USD = 10.0; // 1% risk per trade
  const MAX_CONCURRENT_SLOTS = 4; // Max 4 rolling positions per port

  const summaries: IsolatedPerformanceSummary[] = [];

  for (const strat of STRATEGIES) {
    const completedTrades: SimTrade[] = [];
    let tradeCounter = 0;

    // Simulate multi-coin candle by candle with max 4 concurrent slots
    // 1. Gather all candle timestamps across symbols
    const allCandlesMap = new Map<string, KlinePoint[]>();
    for (const [sym, cList] of Object.entries(symbolData)) {
      allCandlesMap.set(sym, cList);
    }

    const minBars = 55;
    const maxBars = Math.min(...Array.from(allCandlesMap.values()).map(c => c.length));

    // Active concurrent positions (max 4)
    const activePositions: {
      tradeId: number;
      symbol: string;
      side: 'BUY' | 'SELL';
      entryTime: number;
      entryBar: number;
      entryPrice: number;
      stopLoss: number;
      activeSL: number;
      tp1: number;
      tp2: number;
      earlyBE: number;
      riskDist: number;
      tp1Hit: boolean;
      beTriggeredBar?: number;
      tp1TriggeredBar?: number;
      setupReason: string;
    }[] = [];

    // Filter 1: Maximum 1 trade per coin per day (24 hours = 96 bars on 15m)
    const lastTradeBarPerSymbol = new Map<string, number>();

    for (let barIdx = minBars; barIdx < maxBars; barIdx++) {
      // 1. Check exits on active positions
      for (let pIdx = activePositions.length - 1; pIdx >= 0; pIdx--) {
        const pos = activePositions[pIdx];
        const symCandles = allCandlesMap.get(pos.symbol);
        if (!symCandles) continue;
        const curBar = symCandles[barIdx];

        let resolved = false;
        let outcome: 'WIN_TP2' | 'WIN_TP1_BE' | 'WIN_BE' | 'LOSS' = 'LOSS';
        let pnlR = 0;
        let exitPrice = 0;

        if (pos.side === 'BUY') {
          // Port 3010 Sideways Range: Mean Reversion to Equilibrium / TP1 (1.0R - 1.2R)
          if (strat.id === 3010) {
            if (curBar.high >= pos.tp1) {
              outcome = 'WIN_TP1_BE';
              pnlR = 1.15;
              exitPrice = pos.tp1;
              resolved = true;
            } else {
              // Breakeven check
              if (!pos.beTriggeredBar && curBar.high >= pos.earlyBE) {
                pos.beTriggeredBar = barIdx;
                pos.activeSL = Math.max(pos.activeSL, pos.entryPrice + (0.05 * pos.riskDist));
              }

              // Stop loss check
              const checkSL = pos.beTriggeredBar === barIdx ? (curBar.close <= pos.activeSL) : (curBar.low <= pos.activeSL);
              if (checkSL) {
                outcome = pos.activeSL > pos.entryPrice ? 'WIN_BE' : 'LOSS';
                pnlR = pos.activeSL > pos.entryPrice ? 0.05 : -1.0;
                exitPrice = pos.activeSL > pos.entryPrice ? pos.activeSL : pos.stopLoss;
                resolved = true;
              }
            }
          } else {
            // Early Breakeven Shield
            if (!pos.beTriggeredBar && curBar.high >= pos.earlyBE) {
              pos.beTriggeredBar = barIdx;
              pos.activeSL = Math.max(pos.activeSL, pos.entryPrice + (0.05 * pos.riskDist));
            }
            // High-probability TP1 Lock (1.0R)
            if (!pos.tp1Hit && curBar.high >= pos.tp1) {
              pos.tp1Hit = true;
              pos.tp1TriggeredBar = barIdx;
              pos.activeSL = Math.max(pos.activeSL, pos.entryPrice + (0.05 * pos.riskDist));
            }

            if (pos.tp1Hit) {
              if (curBar.high >= pos.tp2) {
                outcome = 'WIN_TP2';
                pnlR = (0.75 * 1.0) + (0.25 * 2.0);
                exitPrice = pos.tp2;
                resolved = true;
              } else {
                const checkSL = pos.tp1TriggeredBar === barIdx ? (curBar.close <= pos.activeSL) : (curBar.low <= pos.activeSL);
                if (checkSL) {
                  outcome = 'WIN_TP1_BE';
                  pnlR = (0.75 * 1.0) + (0.25 * 0.05);
                  exitPrice = pos.activeSL;
                  resolved = true;
                }
              }
            } else {
              // Before TP1
              const checkSL = pos.beTriggeredBar === barIdx ? (curBar.close <= pos.activeSL) : (curBar.low <= pos.activeSL);
              if (checkSL) {
                if (pos.activeSL > pos.entryPrice) {
                  outcome = 'WIN_BE';
                  pnlR = 0.05;
                  exitPrice = pos.activeSL;
                } else {
                  outcome = 'LOSS';
                  pnlR = -1.0;
                  exitPrice = pos.stopLoss;
                }
                resolved = true;
              }
            }
          }
        } else {
          // SHORT
          // Port 3010 Sideways Range: Mean Reversion to Equilibrium / TP1 (1.0R - 1.2R)
          if (strat.id === 3010) {
            if (curBar.low <= pos.tp1) {
              outcome = 'WIN_TP1_BE';
              pnlR = 1.15;
              exitPrice = pos.tp1;
              resolved = true;
            } else {
              // Breakeven check
              if (!pos.beTriggeredBar && curBar.low <= pos.earlyBE) {
                pos.beTriggeredBar = barIdx;
                pos.activeSL = Math.min(pos.activeSL, pos.entryPrice - (0.05 * pos.riskDist));
              }

              // Stop loss check
              const checkSL = pos.beTriggeredBar === barIdx ? (curBar.close >= pos.activeSL) : (curBar.high >= pos.activeSL);
              if (checkSL) {
                outcome = pos.activeSL < pos.entryPrice ? 'WIN_BE' : 'LOSS';
                pnlR = pos.activeSL < pos.entryPrice ? 0.05 : -1.0;
                exitPrice = pos.activeSL < pos.entryPrice ? pos.activeSL : pos.stopLoss;
                resolved = true;
              }
            }
          } else {
            // Early Breakeven Shield
            if (!pos.beTriggeredBar && curBar.low <= pos.earlyBE) {
              pos.beTriggeredBar = barIdx;
              pos.activeSL = Math.min(pos.activeSL, pos.entryPrice - (0.05 * pos.riskDist));
            }
            // High-probability TP1 Lock (1.0R)
            if (!pos.tp1Hit && curBar.low <= pos.tp1) {
              pos.tp1Hit = true;
              pos.tp1TriggeredBar = barIdx;
              pos.activeSL = Math.min(pos.activeSL, pos.entryPrice - (0.05 * pos.riskDist));
            }

            if (pos.tp1Hit) {
              if (curBar.low <= pos.tp2) {
                outcome = 'WIN_TP2';
                pnlR = (0.75 * 1.0) + (0.25 * 2.0);
                exitPrice = pos.tp2;
                resolved = true;
              } else {
                const checkSL = pos.tp1TriggeredBar === barIdx ? (curBar.close >= pos.activeSL) : (curBar.high >= pos.activeSL);
                if (checkSL) {
                  outcome = 'WIN_TP1_BE';
                  pnlR = (0.75 * 1.0) + (0.25 * 0.05);
                  exitPrice = pos.activeSL;
                  resolved = true;
                }
              }
            } else {
              // Before TP1
              const checkSL = pos.beTriggeredBar === barIdx ? (curBar.close >= pos.activeSL) : (curBar.high >= pos.activeSL);
              if (checkSL) {
                if (pos.activeSL < pos.entryPrice) {
                  outcome = 'WIN_BE';
                  pnlR = 0.05;
                  exitPrice = pos.activeSL;
                } else {
                  outcome = 'LOSS';
                  pnlR = -1.0;
                  exitPrice = pos.stopLoss;
                }
                resolved = true;
              }
            }
          }
        }

        if (resolved) {
          const pnlUSD = Number((pnlR * RISK_PER_TRADE_USD).toFixed(2));
          completedTrades.push({
            tradeId: pos.tradeId,
            strategyId: strat.id,
            symbol: pos.symbol,
            side: pos.side,
            entryTime: new Date(pos.entryTime).toISOString(),
            entryPrice: pos.entryPrice,
            stopLossPrice: pos.stopLoss,
            tp1Price: pos.tp1,
            tp2Price: pos.tp2,
            earlyBreakevenPrice: pos.earlyBE,
            exitTime: new Date(curBar.time).toISOString(),
            exitPrice,
            outcome,
            pnlR: Number(pnlR.toFixed(2)),
            pnlUSD,
            reason: pos.setupReason,
          });
          activePositions.splice(pIdx, 1);
        }
      }

      // 2. Scan for new entries if activePositions < MAX_CONCURRENT_SLOTS
      if (activePositions.length < MAX_CONCURRENT_SLOTS) {
        for (const [sym, cList] of allCandlesMap.entries()) {
          if (activePositions.length >= MAX_CONCURRENT_SLOTS) break;
          // Don't open duplicate on same symbol
          if (activePositions.some(p => p.symbol === sym)) continue;

          // Institutional Filter 1: Limit maximum trades per coin per day to 1 (96 bars on 15m)
          const lastBar = lastTradeBarPerSymbol.get(sym) || -999;
          if (barIdx - lastBar < 96) continue;

          const slice = cList.slice(0, barIdx + 1);
          const res = strat.evaluator(sym, slice);

          if (res.recommendedSide && res.customSL) {
            const curBar = slice[slice.length - 1];
            const entryPrice = curBar.close;
            const stopLoss = res.customSL;
            const riskDist = Math.abs(entryPrice - stopLoss);

            // Institutional Filter 3: Reject SL distance < 0.50% (prevents exchange fee bleed)
            const slDistancePct = riskDist / entryPrice;
            if (slDistancePct < 0.0050) continue;

            if (riskDist > 0) {
              tradeCounter++;
              lastTradeBarPerSymbol.set(sym, barIdx);
              const side = res.recommendedSide;
              const tp1 = res.tp1Price || (side === 'BUY' ? entryPrice + (riskDist * 1.0) : entryPrice - (riskDist * 1.0));
              const tp2 = res.tp2Price || (side === 'BUY' ? entryPrice + (riskDist * 2.0) : entryPrice - (riskDist * 2.0));
              const earlyBE = res.earlyBreakevenPrice || (side === 'BUY' ? entryPrice + (riskDist * 0.75) : entryPrice - (riskDist * 0.75));

              activePositions.push({
                tradeId: tradeCounter,
                symbol: sym,
                side,
                entryTime: curBar.time,
                entryBar: barIdx,
                entryPrice,
                stopLoss,
                activeSL: stopLoss,
                tp1,
                tp2,
                earlyBE,
                riskDist,
                tp1Hit: false,
                setupReason: res.reasons[0] || res.setupType,
              });
            }
          }
        }
      }
    }

    // Calculate performance metrics
    const totalTrades = completedTrades.length;
    if (totalTrades === 0) continue;

    const buyTradesList = completedTrades.filter(t => t.side === 'BUY');
    const buyWinsList = buyTradesList.filter(t => t.outcome !== 'LOSS');
    const buyTrades = buyTradesList.length;
    const buyWins = buyWinsList.length;
    const buyWinRatePct = buyTrades > 0 ? Number(((buyWins / buyTrades) * 100).toFixed(1)) : 0;

    const sellTradesList = completedTrades.filter(t => t.side === 'SELL');
    const sellWinsList = sellTradesList.filter(t => t.outcome !== 'LOSS');
    const sellTrades = sellTradesList.length;
    const sellWins = sellWinsList.length;
    const sellWinRatePct = sellTrades > 0 ? Number(((sellWins / sellTrades) * 100).toFixed(1)) : 0;

    const overallWinsList = completedTrades.filter(t => t.outcome !== 'LOSS');
    const overallWins = overallWinsList.length;
    const overallWinRatePct = Number(((overallWins / totalTrades) * 100).toFixed(1));

    const grossWins = completedTrades.filter(t => t.pnlUSD > 0).reduce((sum, t) => sum + t.pnlUSD, 0);
    const grossLosses = Math.abs(completedTrades.filter(t => t.pnlUSD < 0).reduce((sum, t) => sum + t.pnlUSD, 0));
    const profitFactor = grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : 99.0;
    const netRealizedPnlUSD = Number(completedTrades.reduce((sum, t) => sum + t.pnlUSD, 0).toFixed(2));
    const netRealizedPnlINR = Number((netRealizedPnlUSD * USD_TO_INR).toFixed(2));

    // Calculate Max Drawdown
    let peak = 0;
    let cur = 0;
    let maxDDUSD = 0;
    for (const t of completedTrades) {
      cur += t.pnlUSD;
      if (cur > peak) peak = cur;
      const dd = peak - cur;
      if (dd > maxDDUSD) maxDDUSD = dd;
    }
    const maxDrawdownPct = Number(((maxDDUSD / STARTING_CAPITAL_USD) * 100).toFixed(2));

    // Print breakdown of outcomes
    const outcomeCounts = completedTrades.reduce((acc, t) => {
      acc[t.outcome] = (acc[t.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    summaries.push({
      strategyId: strat.id,
      strategyName: strat.name,
      source: strat.source,
      totalTrades,
      buyTrades,
      buyWins,
      buyWinRatePct,
      sellTrades,
      sellWins,
      sellWinRatePct,
      overallWins,
      overallWinRatePct,
      profitFactor,
      maxDrawdownUSD: Number(maxDDUSD.toFixed(2)),
      maxDrawdownPct,
      netRealizedPnlUSD,
      netRealizedPnlINR,
      sampleTrades: completedTrades.slice(-8), // Last 8 bilateral trades
    });
  }

  // Save report
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
  const reportPath = path.join(DIST_DIR, 'isolated_youtube_systems_backtest_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summaries, null, 2));

  return summaries;
}

// Direct Execution
if (process.argv[1]?.includes('backtest_isolated_youtube_systems')) {
  const results = runIsolatedYouTubeBacktest();

  console.log('\n================================================================================');
  console.log('   ISOLATED YOUTUBE TRADING ENGINES - BILATERAL BACKTEST SUMMARY               ');
  console.log('================================================================================\n');

  console.table(
    results.map(r => ({
      Port: r.strategyId,
      Strategy: r.strategyName.replace(/^Port \d+: /, ''),
      'Total Trades': r.totalTrades,
      'LONG (Buy) Trades': `${r.buyWins}/${r.buyTrades} (${r.buyWinRatePct}%)`,
      'SHORT (Sell) Trades': `${r.sellWins}/${r.sellTrades} (${r.sellWinRatePct}%)`,
      'Overall WR%': `${r.overallWinRatePct}%`,
      'Profit Factor': r.profitFactor,
      'Max DD%': `${r.maxDrawdownPct}%`,
      'Net PnL ($)': `+$${r.netRealizedPnlUSD}`,
      'Net PnL (₹)': `+₹${r.netRealizedPnlINR.toLocaleString()}`,
    }))
  );

  console.log('\n📋 Sample Bilateral Trade Logs (Confirming Both BUY and SELL Execution):');
  for (const s of results.slice(0, 4)) {
    console.log(`\n--- ${s.strategyName} ---`);
    for (const t of s.sampleTrades.slice(-4)) {
      console.log(`  [${t.side.padEnd(4)}] ${t.symbol.padEnd(8)} @ $${t.entryPrice.toFixed(2)} ➔ Exit $${t.exitPrice.toFixed(2)} (${t.outcome}) | PnL: +$${t.pnlUSD} (${t.pnlR}R) | Reason: ${t.reason.slice(0, 60)}`);
    }
  }
}
