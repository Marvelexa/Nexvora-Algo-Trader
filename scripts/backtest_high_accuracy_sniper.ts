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
  const f2k = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (fs.existsSync(f2k)) return JSON.parse(fs.readFileSync(f2k, 'utf-8'));
  const f1k = path.join(CACHE_DIR, `${sym}_15m_1000.json`);
  if (fs.existsSync(f1k)) return JSON.parse(fs.readFileSync(f1k, 'utf-8'));
  return [];
}

function load1h(sym: string): CandleData[] {
  const f1500 = path.join(CACHE_DIR, `${sym}_1h_1500.json`);
  if (fs.existsSync(f1500)) return JSON.parse(fs.readFileSync(f1500, 'utf-8'));
  const f500 = path.join(CACHE_DIR, `${sym}_1h_500.json`);
  if (fs.existsSync(f500)) return JSON.parse(fs.readFileSync(f500, 'utf-8'));
  const f250 = path.join(CACHE_DIR, `${sym}_1h_250.json`);
  if (fs.existsSync(f250)) return JSON.parse(fs.readFileSync(f250, 'utf-8'));
  return [];
}

interface PreBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  adx: number;
  rsi: number;
  bbUpper: number;
  bbLower: number;
  bbMean: number;
  bbDev: number;
  ema20: number;
  ema50: number;
  h1Close: number;
  h1Ema50: number;
  isGreen: boolean;
  body: number;
  lowerWick: number;
  upperWick: number;
}

interface TradeResult {
  symbol: string;
  entryTime: number;
  exitTime: number;
  side: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  exitPrice: number;
  slPrice: number;
  tpPrice: number;
  pnlUSD: number;
  pnlPercent: number;
  capitalAfterUSD: number;
  exitReason: 'TARGET_HIT' | 'BREAKEVEN_EXIT' | 'SL_HIT';
}

function runBacktest() {
  console.log('========================================================================');
  console.log('🎯 RUNNING INSTITUTIONAL HIGH-ACCURACY SNIPER BACKTEST');
  console.log('========================================================================\n');

  const symbols = ['SOLUSD', 'AVAXUSD', 'ETHUSD'];
  const allCandles15m = new Map<string, PreBar[]>();

  for (const sym of symbols) {
    const b15 = load15m(sym);
    const b1h = load1h(sym);
    if (b15.length < 100) continue;

    const h1Closes = b1h.map(b => b.close);
    const h1Ema50 = CryptoDedicatedStrategyEngine.calculateEMA(h1Closes, 50);
    let h1Idx = 0;
    const bars: PreBar[] = [];

    for (let i = 50; i < b15.length; i++) {
      const win = b15.slice(i - 50, i + 1);
      const c = win[win.length - 1];
      const closes = win.map(b => b.close);

      while (h1Idx < b1h.length - 1 && b1h[h1Idx + 1].time <= c.time) {
        h1Idx++;
      }

      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
      const atr = conf.atr > 0 ? conf.atr : c.close * 0.008;
      const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];

      // Bollinger Bands (2.5 Standard Deviations)
      const recentCloses = closes.slice(-20);
      const mean = recentCloses.reduce((a, b) => a + b, 0) / 20;
      const variance = recentCloses.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
      const stdDev = Math.sqrt(variance);

      bars.push({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        atr,
        adx,
        rsi: conf.rsi14,
        bbUpper: mean + 2.5 * stdDev,
        bbLower: mean - 2.5 * stdDev,
        bbMean: mean,
        bbDev: stdDev,
        ema20,
        ema50,
        h1Close: b1h[h1Idx]?.close || c.close,
        h1Ema50: h1Ema50[h1Idx] || c.close,
        isGreen: c.close > c.open,
        body: Math.max(Math.abs(c.close - c.open), 0.000001),
        lowerWick: Math.min(c.open, c.close) - c.low,
        upperWick: c.high - Math.max(c.open, c.close),
      });
    }
    allCandles15m.set(sym, bars);
  }

  // Generate Sniper Setups across all coins
  interface SignalCandidate {
    time: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    strategy: string;
    entryPrice: number;
    tpPrice: number;
    slPrice: number;
    beTriggerPrice: number;
    beLockPrice: number;
    atr: number;
    barIdx: number;
  }

  const signals: SignalCandidate[] = [];

  for (const sym of symbols) {
    const bars = allCandles15m.get(sym);
    if (!bars) continue;

    for (let i = 1; i < bars.length - 20; i++) {
      const c = bars[i];
      const prev = bars[i - 1];

      // -------------------------------------------------------------
      // PURE SETUP: 2.5 SD Extreme Bollinger Mean Reversion (Statistical Climax)
      // -------------------------------------------------------------
      // Oversold Climax Reversal BUY:
      if (
        c.low <= c.bbLower &&
        c.close > c.bbLower &&
        c.isGreen &&
        c.lowerWick >= c.body * 0.70 &&
        c.rsi <= 32
      ) {
        const slDist = 1.8 * c.atr;
        const tpDist = 1.2 * c.atr;
        signals.push({
          time: c.time,
          symbol: sym,
          side: 'BUY',
          strategy: 'Extreme Bollinger 2.5 SD Climax Absorption',
          entryPrice: c.close,
          slPrice: c.close - slDist,
          tpPrice: c.close + tpDist,
          beTriggerPrice: c.close + 0.70 * c.atr,
          beLockPrice: c.close + 0.15 * c.atr,
          atr: c.atr,
          barIdx: i,
        });
      }

      // Overbought Climax Reversal SELL:
      if (
        c.high >= c.bbUpper &&
        c.close < c.bbUpper &&
        !c.isGreen &&
        c.upperWick >= c.body * 0.70 &&
        c.rsi >= 68
      ) {
        const slDist = 1.8 * c.atr;
        const tpDist = 1.2 * c.atr;
        signals.push({
          time: c.time,
          symbol: sym,
          side: 'SELL',
          strategy: 'Extreme Bollinger 2.5 SD Climax Absorption',
          entryPrice: c.close,
          slPrice: c.close + slDist,
          tpPrice: c.close - tpDist,
          beTriggerPrice: c.close - 0.70 * c.atr,
          beLockPrice: c.close - 0.15 * c.atr,
          atr: c.atr,
          barIdx: i,
        });
      }
    }
  }

  // Sort chronologically
  signals.sort((a, b) => a.time - b.time);
  console.log(`Generated ${signals.length} High-Probability Sniper Setups across ${symbols.join(', ')}.\n`);

  // Simulate Compounding Portfolio with Disciplined Sizing
  let capitalUSD = 23.81; // ₹2,000 INR
  const initialCapitalUSD = capitalUSD;
  let peakUSD = capitalUSD;
  let maxDrawdownPct = 0;
  let wins = 0;
  let breakevenExits = 0;
  let losses = 0;
  let lastExitTime = 0;
  const closedTrades: TradeResult[] = [];

  for (const sig of signals) {
    if (sig.time <= lastExitTime) continue;

    const bars = allCandles15m.get(sig.symbol)!;

    // Disciplined Risk Sizing:
    // Risk $0.55 on small capital, or 2.5% of equity as capital compounds
    const targetRiskUSD = Math.max(0.55, capitalUSD * 0.025);
    const slDist = Math.abs(sig.entryPrice - sig.slPrice);
    
    // Size contracts strictly so stop loss hit = targetRiskUSD
    let quantity = slDist > 0 ? targetRiskUSD / slDist : 0.01;

    // Sensible Leverage Ceiling (Max 5x - 8x notional to avoid eating capital in fees)
    const maxNotional = capitalUSD * 6.0;
    if (quantity * sig.entryPrice > maxNotional) {
      quantity = maxNotional / sig.entryPrice;
    }

    const notionalUSD = quantity * sig.entryPrice;
    const feeUSD = notionalUSD * 0.0010; // 0.10% round-trip exchange fee

    let beLocked = false;
    let effectiveSL = sig.slPrice;
    let exitPrice = 0;
    let exitReason: 'TARGET_HIT' | 'BREAKEVEN_EXIT' | 'SL_HIT' = 'SL_HIT';

    for (let f = 1; f <= 32; f++) {
      const idx = sig.barIdx + f;
      if (idx >= bars.length) break;
      const bar = bars[idx];

      // Breakeven check
      if (!beLocked) {
        const movedToBE = sig.side === 'BUY'
          ? bar.high >= sig.beTriggerPrice
          : bar.low <= sig.beTriggerPrice;
        if (movedToBE) {
          beLocked = true;
          effectiveSL = sig.beLockPrice;
        }
      }

      const isTPHit = sig.side === 'BUY' ? bar.high >= sig.tpPrice : bar.low <= sig.tpPrice;
      const isSLHit = sig.side === 'BUY' ? bar.low <= effectiveSL : bar.high >= effectiveSL;

      if (isTPHit && !isSLHit) {
        exitPrice = sig.tpPrice;
        exitReason = 'TARGET_HIT';
        lastExitTime = bar.time;
        break;
      } else if (isSLHit) {
        exitPrice = effectiveSL;
        exitReason = beLocked ? 'BREAKEVEN_EXIT' : 'SL_HIT';
        lastExitTime = bar.time;
        break;
      }
    }

    if (exitPrice > 0) {
      const priceDiff = sig.side === 'BUY' ? exitPrice - sig.entryPrice : sig.entryPrice - exitPrice;
      const grossPnlUSD = priceDiff * quantity;
      const netPnlUSD = parseFloat((grossPnlUSD - feeUSD).toFixed(2));

      capitalUSD += netPnlUSD;
      if (capitalUSD > peakUSD) peakUSD = capitalUSD;
      const dd = ((peakUSD - capitalUSD) / peakUSD) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;

      if (exitReason === 'TARGET_HIT') wins++;
      else if (exitReason === 'BREAKEVEN_EXIT') breakevenExits++;
      else losses++;

      closedTrades.push({
        symbol: sig.symbol,
        entryTime: sig.time,
        exitTime: lastExitTime,
        side: sig.side,
        strategy: sig.strategy,
        entryPrice: sig.entryPrice,
        exitPrice,
        slPrice: sig.slPrice,
        tpPrice: sig.tpPrice,
        pnlUSD: netPnlUSD,
        pnlPercent: parseFloat(((netPnlUSD / (notionalUSD / 25)) * 100).toFixed(2)),
        capitalAfterUSD: parseFloat(capitalUSD.toFixed(2)),
        exitReason,
      });
    }
  }

  const totalTrades = wins + breakevenExits + losses;
  const winRate = totalTrades > 0 ? (wins / (wins + losses)) * 100 : 0;
  const effectiveWinRate = totalTrades > 0 ? ((wins + breakevenExits) / totalTrades) * 100 : 0;
  const netReturnUSD = capitalUSD - initialCapitalUSD;
  const netReturnPct = (netReturnUSD / initialCapitalUSD) * 100;

  console.log('========================================================================');
  console.log('🏆 SNIPER BACKTEST PERFORMANCE REPORT');
  console.log('========================================================================');
  console.log(`Starting Capital : $${initialCapitalUSD.toFixed(2)} USD (₹${(initialCapitalUSD * 84).toFixed(0)} INR)`);
  console.log(`Ending Capital   : $${capitalUSD.toFixed(2)} USD (₹${(capitalUSD * 84).toFixed(0)} INR)`);
  console.log(`Net Profit       : +$${netReturnUSD.toFixed(2)} USD (+${netReturnPct.toFixed(1)}%)`);
  console.log(`Total Trades     : ${totalTrades}`);
  console.log(`Target Wins      : ${wins}`);
  console.log(`Breakeven Preserved: ${breakevenExits}`);
  console.log(`Losses           : ${losses}`);
  console.log(`Pure Target Win Rate: ${winRate.toFixed(1)}% (Wins vs Losses)`);
  console.log(`Capital-Protected Rate: ${effectiveWinRate.toFixed(1)}% (Profitable or 0 Loss)`);
  console.log(`Max Peak Drawdown: ${maxDrawdownPct.toFixed(1)}%`);

  // Breakdown by Symbol
  console.log('\n--- Breakdown by Symbol ---');
  for (const sym of symbols) {
    const coinTrades = closedTrades.filter(t => t.symbol === sym);
    const cWins = coinTrades.filter(t => t.exitReason === 'TARGET_HIT').length;
    const cLoss = coinTrades.filter(t => t.exitReason === 'SL_HIT').length;
    const cBE = coinTrades.filter(t => t.exitReason === 'BREAKEVEN_EXIT').length;
    const cPnl = coinTrades.reduce((s, t) => s + t.pnlUSD, 0);
    const cWR = (cWins + cLoss) > 0 ? (cWins / (cWins + cLoss)) * 100 : 0;
    console.log(`🪙 ${sym.padEnd(8)}: ${coinTrades.length} trades | ${cWins}W / ${cLoss}L / ${cBE}BE | WinRate: ${cWR.toFixed(1)}% | Net PnL: +$${cPnl.toFixed(2)} USD`);
  }

  // Save report
  fs.writeFileSync(
    path.join(process.cwd(), 'public', 'high_accuracy_sniper_backtest_report.json'),
    JSON.stringify({
      initialCapitalUSD,
      endingCapitalUSD: capitalUSD,
      netReturnUSD,
      netReturnPct,
      totalTrades,
      wins,
      breakevenExits,
      losses,
      pureWinRate: winRate,
      capitalProtectedRate: effectiveWinRate,
      maxDrawdownPct,
      closedTrades: closedTrades.slice(0, 50),
    }, null, 2)
  );
  console.log('\n✅ Report saved to public/high_accuracy_sniper_backtest_report.json');
}

runBacktest();
