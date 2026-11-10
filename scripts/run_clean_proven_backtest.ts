import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function load15m(sym: string): CandleData[] {
  const f5k = path.join(CACHE_DIR, `${sym}_15m_5000.json`);
  if (fs.existsSync(f5k)) return JSON.parse(fs.readFileSync(f5k, 'utf-8'));
  const f25k = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (fs.existsSync(f25k)) return JSON.parse(fs.readFileSync(f25k, 'utf-8'));
  return [];
}

function load1h(sym: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${sym}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  const f500 = path.join(CACHE_DIR, `${sym}_1h_500.json`);
  if (fs.existsSync(f500)) return JSON.parse(fs.readFileSync(f500, 'utf-8'));
  return [];
}

function runCleanProvenBacktest() {
  console.log('========================================================================');
  console.log('🏆 INSTITUTIONAL CLEAN PROVEN STRATEGY BACKTEST (SOL & AVAX)');
  console.log('========================================================================\n');

  const symbols = ['SOLUSD', 'AVAXUSD'];
  let globalStartingCapital = 23.81;
  let capitalUSD = globalStartingCapital;
  let peakUSD = capitalUSD;
  let maxDD = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalBE = 0;

  for (const sym of symbols) {
    const b15 = load15m(sym);
    const b1h = load1h(sym);
    const h1Closes = b1h.map(b => b.close);
    const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    const h1Ema200 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 200);
    let h1Idx = 0;

    let symWins = 0;
    let symLosses = 0;
    let symBE = 0;
    let symPnl = 0;
    let lastExitTime = 0;

    for (let i = 50; i < b15.length - 24; i++) {
      const win = b15.slice(i - 50, i + 1);
      const c = win[win.length - 1];
      const prev = win[win.length - 2];
      const closes = win.map(b => b.close);

      if (c.time <= lastExitTime) continue;

      while (h1Idx < b1h.length - 1 && b1h[h1Idx + 1].time <= c.time) {
        h1Idx++;
      }

      const h1C = b1h[h1Idx]?.close || c.close;
      const h1E50 = h1Ema50[h1Idx] || c.close;
      const h1E200 = h1Ema200[h1Idx] || c.close;
      const h1Trend = (h1C > h1E50 && h1E50 >= h1E200) ? 'BULLISH' : ((h1C < h1E50 && h1E50 <= h1E200) ? 'BEARISH' : 'NEUTRAL');

      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];

      const isGreen = c.close > c.open;
      const body = Math.max(Math.abs(c.close - c.open), 0.0001);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      let side: 'BUY' | 'SELL' | null = null;
      let reason = '';

      // High-Conviction Trend Pullback (Aligned with 1H Trend)
      if (h1Trend === 'BULLISH' && adx >= 20 && ema20 > ema50 && c.close > ema20 && prev.low <= ema20 * 1.002) {
        if (isGreen && lowerWick >= body * 0.70 && conf.rsi14 >= 46 && conf.rsi14 <= 64) {
          side = 'BUY';
          reason = '1H Bullish Trend Pullback Pin Bar';
        }
      } else if (h1Trend === 'BEARISH' && adx >= 20 && ema20 < ema50 && c.close < ema20 && prev.high >= ema20 * 0.998) {
        if (!isGreen && upperWick >= body * 0.70 && conf.rsi14 <= 54 && conf.rsi14 >= 36) {
          side = 'SELL';
          reason = '1H Bearish Trend Pullback Pin Bar';
        }
      }

      if (!side) continue;

      const entryPrice = c.close;
      const slDist = 1.0 * atr;
      const tpDist = 0.85 * atr;
      const slPrice = side === 'BUY' ? entryPrice - slDist : entryPrice + slDist;
      const tpPrice = side === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist;
      const beTrigger = side === 'BUY' ? entryPrice + 0.50 * atr : entryPrice - 0.50 * atr;
      const beLockPrice = side === 'BUY' ? entryPrice + 0.15 * atr : entryPrice - 0.15 * atr;

      // Position Sizing: Risk exactly $0.55 or 2.5% of capital
      const riskUSD = Math.max(0.55, capitalUSD * 0.025);
      let quantity = riskUSD / slDist;
      const maxNotional = capitalUSD * 6.0; // max 6x leverage
      if (quantity * entryPrice > maxNotional) {
        quantity = maxNotional / entryPrice;
      }
      const notional = quantity * entryPrice;
      const fee = notional * 0.0010;

      let beLocked = false;
      let effectiveSL = slPrice;
      let exitPrice = 0;
      let exitType: 'WIN' | 'BE' | 'LOSS' = 'LOSS';

      for (let f = 1; f <= 24; f++) {
        const nextBar = b15[i + f];
        if (!nextBar) break;

        // Breakeven check
        if (!beLocked) {
          const reachedBE = side === 'BUY' ? nextBar.high >= beTrigger : nextBar.low <= beTrigger;
          if (reachedBE) {
            beLocked = true;
            effectiveSL = beLockPrice;
          }
        }

        const isTP = side === 'BUY' ? nextBar.high >= tpPrice : nextBar.low <= tpPrice;
        const isSL = side === 'BUY' ? nextBar.low <= effectiveSL : nextBar.high >= effectiveSL;

        if (isTP && !isSL) {
          exitPrice = tpPrice;
          exitType = 'WIN';
          lastExitTime = nextBar.time;
          break;
        } else if (isSL) {
          exitPrice = effectiveSL;
          exitType = beLocked ? 'BE' : 'LOSS';
          lastExitTime = nextBar.time;
          break;
        }
      }

      if (exitPrice > 0) {
        const grossPnl = side === 'BUY' ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
        const netPnl = grossPnl - fee;

        capitalUSD += netPnl;
        symPnl += netPnl;
        if (capitalUSD > peakUSD) peakUSD = capitalUSD;
        const dd = ((peakUSD - capitalUSD) / peakUSD) * 100;
        if (dd > maxDD) maxDD = dd;

        if (exitType === 'WIN') {
          symWins++;
          totalWins++;
        } else if (exitType === 'BE') {
          symBE++;
          totalBE++;
        } else {
          symLosses++;
          totalLosses++;
        }
      }
    }

    const symTotal = symWins + symLosses + symBE;
    const symPureWR = (symWins + symLosses) > 0 ? (symWins / (symWins + symLosses)) * 100 : 0;
    console.log(`🪙 ${sym}: ${symTotal} trades | ${symWins} Wins / ${symLosses} Losses / ${symBE} Breakeven | Win Rate: ${symPureWR.toFixed(1)}% | Net PnL: +$${symPnl.toFixed(2)} USD`);
  }

  const grandTotal = totalWins + totalLosses + totalBE;
  const pureWR = (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
  const netGain = capitalUSD - globalStartingCapital;

  console.log('\n========================================================================');
  console.log('🏆 GRAND TOTAL PORTFOLIO PERFORMANCE');
  console.log('========================================================================');
  console.log(`Initial Capital : $${globalStartingCapital.toFixed(2)} USD (₹${(globalStartingCapital * 84).toFixed(0)} INR)`);
  console.log(`Ending Capital  : $${capitalUSD.toFixed(2)} USD (₹${(capitalUSD * 84).toFixed(0)} INR)`);
  console.log(`Net Return      : +$${netGain.toFixed(2)} USD (+${((netGain / globalStartingCapital) * 100).toFixed(1)}%)`);
  console.log(`Total Trades    : ${grandTotal}`);
  console.log(`Pure Target Wins: ${totalWins}`);
  console.log(`Full Losses     : ${totalLosses}`);
  console.log(`Breakeven Preserved: ${totalBE}`);
  console.log(`Pure Win Rate   : ${pureWR.toFixed(1)}% (Wins vs Full Losses)`);
  console.log(`Max Drawdown    : ${maxDD.toFixed(1)}%`);
}

runCleanProvenBacktest();
