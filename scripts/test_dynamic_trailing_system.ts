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

const SYMBOLS = ['ADAUSD', 'SOLUSD', 'DOGEUSD', 'XRPUSD', 'AVAXUSD', 'SUIUSD', 'ETHUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): CandleData[] {
  const file = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function load1hCandles(symbol: string): CandleData[] {
  const file = path.join(CACHE_DIR, `${symbol}_1h_500.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

interface TradeRecord {
  tradeNum: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notionalUSD: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  exitReason: string;
  capitalAfterUSD: number;
  capitalAfterINR: number;
}

export function testDynamicStrategy() {
  console.log(`========================================================================`);
  console.log(`🚀 QUANT ENGINE HEALING & REFINEMENT TEST (2,000 INR -> 8,000 INR GOAL)`);
  console.log(`========================================================================\n`);

  const candles15mMap = new Map<string, CandleData[]>();
  const candles1hMap = new Map<string, CandleData[]>();

  for (const sym of SYMBOLS) {
    candles15mMap.set(sym, loadCandles(sym));
    candles1hMap.set(sym, load1hCandles(sym));
  }

  // Pre-index candles by timestamp
  const allTimestamps = new Set<number>();
  for (const sym of SYMBOLS) {
    const list = candles15mMap.get(sym) || [];
    list.forEach(c => allTimestamps.add(c.time));
  }
  const sortedTimes = Array.from(allTimestamps).sort((a, b) => a - b);

  const symbolIdxMap = new Map<string, Map<number, number>>();
  for (const sym of SYMBOLS) {
    const list = candles15mMap.get(sym) || [];
    const m = new Map<number, number>();
    list.forEach((c, i) => m.set(c.time, i));
    symbolIdxMap.set(sym, m);
  }

  const USD_INR = 84.0;
  let capitalUSD = 23.81; // ₹2,000 INR
  let peakCapitalUSD = capitalUSD;
  let maxDrawdownUSD = 0;
  let maxDrawdownPct = 0;

  const trades: TradeRecord[] = [];

  let pos: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    entryTime: number;
    quantity: number;
    notionalUSD: number;
    atr: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    initialStopLossPrice: number;
    highestPrice: number;
    lowestPrice: number;
    isTrailingActive: boolean;
  } | null = null;

  for (let tIdx = 60; tIdx < sortedTimes.length; tIdx++) {
    const currentTime = sortedTimes[tIdx];

    // 1. Manage Active Position
    if (pos) {
      const idxMap = symbolIdxMap.get(pos.symbol);
      const bIdx = idxMap?.get(currentTime);

      if (bIdx !== undefined) {
        const bar = candles15mMap.get(pos.symbol)![bIdx];
        const { side, entryPrice, quantity, notionalUSD, atr } = pos;

        // Update high-watermark extremes
        if (bar.high > pos.highestPrice) pos.highestPrice = bar.high;
        if (bar.low < pos.lowestPrice) pos.lowestPrice = bar.low;

        const favorableDistance = side === 'BUY'
          ? (pos.highestPrice - entryPrice)
          : (entryPrice - pos.lowestPrice);

        // Dynamic High-Watermark Trailing Stop:
        // When price moves >= 1.4x ATR in our favor, activate trailing stop
        // The trailing stop follows 1.0x ATR behind the peak price!
        if (favorableDistance >= 1.4 * atr) {
          pos.isTrailingActive = true;
          const dynamicTrailSL = side === 'BUY'
            ? pos.highestPrice - (1.0 * atr)
            : pos.lowestPrice + (1.0 * atr);

          // Only move SL in profitable direction, never widen
          if (side === 'BUY' && dynamicTrailSL > pos.stopLossPrice) {
            pos.stopLossPrice = dynamicTrailSL;
          } else if (side === 'SELL' && dynamicTrailSL < pos.stopLossPrice) {
            pos.stopLossPrice = dynamicTrailSL;
          }
        }

        // Check TP and SL
        const isTP = side === 'BUY' ? bar.high >= pos.takeProfitPrice : bar.low <= pos.takeProfitPrice;
        const isSL = side === 'BUY' ? bar.low <= pos.stopLossPrice : bar.high >= pos.stopLossPrice;

        if (isTP || isSL) {
          let exitPrice = isTP ? pos.takeProfitPrice : pos.stopLossPrice;
          let exitReason = isTP ? 'TARGET_HIT' : (pos.isTrailingActive ? 'TRAILING_STOP_HIT' : 'STOP_LOSS_HIT');

          const grossPnl = side === 'BUY'
            ? (exitPrice - entryPrice) * quantity
            : (entryPrice - exitPrice) * quantity;

          const exitNotional = exitPrice * quantity;
          const fees = (notionalUSD + exitNotional) * 0.0007; // 0.05% taker + 0.02% slippage
          const netPnl = parseFloat((grossPnl - fees).toFixed(2));

          capitalUSD = parseFloat((capitalUSD + netPnl).toFixed(2));
          if (capitalUSD > peakCapitalUSD) peakCapitalUSD = capitalUSD;
          const dd = peakCapitalUSD - capitalUSD;
          const ddPct = (dd / peakCapitalUSD) * 100;
          if (dd > maxDrawdownUSD) maxDrawdownUSD = dd;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

          trades.push({
            tradeNum: trades.length + 1,
            symbol: pos.symbol,
            side,
            entryTime: new Date(pos.entryTime).toISOString(),
            exitTime: new Date(bar.time).toISOString(),
            entryPrice,
            exitPrice,
            quantity,
            notionalUSD,
            grossPnl: parseFloat(grossPnl.toFixed(2)),
            fees: parseFloat(fees.toFixed(2)),
            netPnl,
            exitReason,
            capitalAfterUSD: capitalUSD,
            capitalAfterINR: Math.round(capitalUSD * USD_INR),
          });

          pos = null;

          if (capitalUSD >= 95.24) { // ₹8,000 INR
            console.log(`🎯 TARGET CAPITAL ACHIEVED: $${capitalUSD} (₹${Math.round(capitalUSD * USD_INR)})!`);
            break;
          }
          if (capitalUSD <= 5.0) break;
        }
      }
    }

    // 2. Scan for Opportunity
    if (!pos && capitalUSD > 5.0 && capitalUSD < 95.24) {
      const candidates: {
        symbol: string;
        side: 'BUY' | 'SELL';
        score: number;
        atr: number;
        price: number;
      }[] = [];

      for (const sym of SYMBOLS) {
        const idxMap = symbolIdxMap.get(sym);
        const bIdx = idxMap?.get(currentTime);
        if (bIdx === undefined || bIdx < 50) continue;

        const allBars = candles15mMap.get(sym)!;
        const window15m = allBars.slice(bIdx - 50, bIdx + 1);
        const lastBar = window15m[window15m.length - 1];
        const prevBar = window15m[window15m.length - 2];

        // 1. Math verdict
        const mathVerdict = QuantMathematicalEngine.evaluateMarketMath(sym, window15m);
        if (!mathVerdict.recommendedSide || mathVerdict.quantScore < 45) continue;

        // 2. Confluence verdict
        const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window15m);
        const side = mathVerdict.recommendedSide;
        if (side === 'BUY' && !conf.allowsLong) continue;
        if (side === 'SELL' && !conf.allowsShort) continue;

        // 3. Technical Indicator Confirmation: EMA 20 Slope & Alignment
        const closes = window15m.map(b => b.close);
        const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
        const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
        const currEma20 = ema20Arr[ema20Arr.length - 1];
        const prevEma20 = ema20Arr[ema20Arr.length - 2];
        const currEma50 = ema50Arr[ema50Arr.length - 1];

        // EMA 20 Slope must confirm direction (no counter-slope trading)
        if (side === 'BUY' && currEma20 <= prevEma20) continue;
        if (side === 'SELL' && currEma20 >= prevEma20) continue;

        // 4. Trigger Candle Pattern & Conviction Check
        const isGreen = lastBar.close > lastBar.open;
        const body = Math.abs(lastBar.close - lastBar.open);
        const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
        const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;

        if (side === 'BUY') {
          if (!isGreen) continue;
          if (upperWick > body * 1.2) continue; // No long upper rejection wick
          if (lastBar.close < currEma20) continue;
          if (conf.rsi14 > 66) continue; // Don't buy overbought
        } else {
          if (isGreen) continue;
          if (lowerWick > body * 1.2) continue; // No long lower rejection wick
          if (lastBar.close > currEma20) continue;
          if (conf.rsi14 < 34) continue; // Don't short oversold
        }

        // 5. ADX Trend Strength Filter
        const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);
        if (adx < 22) continue;

        // 6. 1H Macro Trend Guard
        const h1Bars = candles1hMap.get(sym) || [];
        const currentH1 = h1Bars.filter(b => b.time <= currentTime).slice(-50);
        if (currentH1.length >= 20) {
          const h1Closes = currentH1.map(c => c.close);
          const ema50_1h = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
          const lastH1Ema50 = ema50_1h[ema50_1h.length - 1];
          if (side === 'BUY' && lastBar.close < lastH1Ema50) continue;
          if (side === 'SELL' && lastBar.close > lastH1Ema50) continue;
        }

        const atr = conf.atr > 0 ? conf.atr : lastBar.close * 0.008;
        const score = mathVerdict.quantScore + conf.confluenceScore;
        candidates.push({ symbol: sym, side, score, atr, price: lastBar.close });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        // Compounding Risk Management:
        // Risk strictly 8.5% of current equity per trade
        const riskUSD = Math.max(1.50, parseFloat((capitalUSD * 0.085).toFixed(2)));
        const slDistance = best.atr * 0.95; // 0.95x ATR SL
        const tpDistance = best.atr * 2.4;  // 2.4x ATR TP (2.5:1 Risk Reward!)

        let quantity = parseFloat((riskUSD / slDistance).toFixed(4));
        let notionalUSD = parseFloat((quantity * best.price).toFixed(2));
        let marginUSD = parseFloat((notionalUSD / 30).toFixed(2));

        // Max margin: 75% of capital
        const maxMargin = parseFloat((capitalUSD * 0.75).toFixed(2));
        if (marginUSD > maxMargin) {
          marginUSD = maxMargin;
          notionalUSD = parseFloat((marginUSD * 30).toFixed(2));
          quantity = parseFloat((notionalUSD / best.price).toFixed(4));
        }
        if (quantity <= 0) quantity = 1;

        const stopLossPrice = best.side === 'BUY'
          ? best.price - slDistance
          : best.price + slDistance;

        const takeProfitPrice = best.side === 'BUY'
          ? best.price + tpDistance
          : best.price - tpDistance;

        pos = {
          symbol: best.symbol,
          side: best.side,
          entryPrice: best.price,
          entryTime: currentTime,
          quantity,
          notionalUSD,
          atr: best.atr,
          takeProfitPrice,
          stopLossPrice,
          initialStopLossPrice: stopLossPrice,
          highestPrice: best.price,
          lowestPrice: best.price,
          isTrailingActive: false,
        };
      }
    }
  }

  const wins = trades.filter(t => t.netPnl > 0).length;
  const losses = trades.filter(t => t.netPnl <= 0).length;
  const total = trades.length;
  const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0';

  const grossWins = trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const grossLosses = Math.abs(trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  const pf = grossLosses > 0 ? (grossWins / grossLosses).toFixed(2) : '99.0';

  console.log(`========================================================================`);
  console.log(`📊 SIMULATION REPORT`);
  console.log(`========================================================================`);
  console.log(`Initial Capital: ₹2,000 ($23.81)`);
  console.log(`Final Capital:   ₹${Math.round(capitalUSD * USD_INR)} ($${capitalUSD.toFixed(2)})`);
  console.log(`Net Profit:      ₹${Math.round((capitalUSD - 23.81) * USD_INR)} (+$${(capitalUSD - 23.81).toFixed(2)})`);
  console.log(`Total Trades:    ${total}`);
  console.log(`Win Rate:        ${wr}% (${wins} Wins / ${losses} Losses)`);
  console.log(`Profit Factor:   ${pf}`);
  console.log(`Max Drawdown:    ${maxDrawdownPct.toFixed(1)}% ($${maxDrawdownUSD.toFixed(2)})`);
  console.log(`Goal Achieved:   ${capitalUSD >= 95.24 ? '✅ YES! (₹8,000+ Reached)' : '❌ NO'}`);
  console.log(`========================================================================\n`);

  console.log(`📋 Trade Log Sample:`);
  trades.forEach(t => {
    const sign = t.netPnl >= 0 ? '+' : '';
    console.log(`  [#${t.tradeNum.toString().padStart(2, '0')}] ${t.symbol.padEnd(7)} ${t.side.padEnd(4)} | In: $${t.entryPrice.toFixed(4)} Out: $${t.exitPrice.toFixed(4)} | PnL: ${sign}$${t.netPnl.toFixed(2)} (${t.exitReason}) -> Capital: ₹${t.capitalAfterINR} ($${t.capitalAfterUSD.toFixed(2)})`);
  });
}

testDynamicStrategy();
