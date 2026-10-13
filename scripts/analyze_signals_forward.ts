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

const SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string, res: string): CandleData[] {
  const file = path.join(CACHE_DIR, `${symbol}_${res}_${res === '15m' ? 1000 : 250}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

interface ForwardSignalEvaluation {
  symbol: string;
  barIndex: number;
  time: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  quantScore: number;
  confluenceScore: number;
  adx: number;
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  volumeRatio: number;
  // Forward outcomes over next 4, 8, 12 bars (1 hour, 2 hours, 3 hours)
  forwardReturn1hPct: number;
  forwardReturn2hPct: number;
  forwardReturn3hPct: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  isSuccess: boolean;
  failureReason?: string;
}

async function runForwardAnalysis() {
  console.log(`========================================================================`);
  console.log(`🔬 FORWARD CANDLE SIGNAL VALIDATION & FALSE-SIGNAL ROOT CAUSE ANALYSIS`);
  console.log(`========================================================================\n`);

  const allEvaluations: ForwardSignalEvaluation[] = [];

  for (const sym of SYMBOLS) {
    const bars = loadCandles(sym, '15m');
    if (bars.length < 100) continue;

    console.log(`Analyzing ${sym} (${bars.length} candles)...`);

    for (let i = 50; i < bars.length - 12; i++) {
      const window15m = bars.slice(i - 50, i + 1);
      const currentBar = window15m[window15m.length - 1];

      // 1. Math evaluation
      const mathVerdict = QuantMathematicalEngine.evaluateMarketMath(sym, window15m);
      if (!mathVerdict.recommendedSide || mathVerdict.quantScore < 55) continue;

      // 2. Confluence evaluation
      const confluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window15m);
      const indSide: 'BUY' | 'SELL' | null = confluence.allowsLong && confluence.trendDirection === 'BULLISH'
        ? 'BUY'
        : (confluence.allowsShort && confluence.trendDirection === 'BEARISH' ? 'SELL' : null);

      if (indSide !== mathVerdict.recommendedSide) continue;

      const side = mathVerdict.recommendedSide;
      const entryPrice = currentBar.close;

      // 3. Technical Indicators
      const closes = window15m.map(b => b.close);
      const ema9Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 9);
      const ema21Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 21);
      const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
      const ema200Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, Math.min(200, closes.length));
      const ema9 = ema9Arr[ema9Arr.length - 1];
      const ema21 = ema21Arr[ema21Arr.length - 1];
      const ema50 = ema50Arr[ema50Arr.length - 1];
      const ema200 = ema200Arr[ema200Arr.length - 1];

      const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);
      const chopIndex = CryptoDedicatedStrategyEngine.calculateChoppinessIndex(window15m, 14);

      // Trigger Candle Price Action Check
      const isGreenTrigger = currentBar.close > currentBar.open;
      const isRedTrigger = currentBar.close < currentBar.open;
      const candleRange = currentBar.high - currentBar.low;
      const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
      const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
      const body = Math.abs(currentBar.close - currentBar.open);

      // Check next 12 bars forward (3 hours)
      const forwardBars = bars.slice(i + 1, i + 13);
      let highestHigh = -Infinity;
      let lowestLow = Infinity;
      for (const fb of forwardBars) {
        if (fb.high > highestHigh) highestHigh = fb.high;
        if (fb.low < lowestLow) lowestLow = fb.low;
      }

      const close1h = forwardBars[Math.min(3, forwardBars.length - 1)].close;
      const close2h = forwardBars[Math.min(7, forwardBars.length - 1)].close;
      const close3h = forwardBars[forwardBars.length - 1].close;

      const return1hPct = side === 'BUY'
        ? ((close1h - entryPrice) / entryPrice) * 100
        : ((entryPrice - close1h) / entryPrice) * 100;

      const return2hPct = side === 'BUY'
        ? ((close2h - entryPrice) / entryPrice) * 100
        : ((entryPrice - close2h) / entryPrice) * 100;

      const return3hPct = side === 'BUY'
        ? ((close3h - entryPrice) / entryPrice) * 100
        : ((entryPrice - close3h) / entryPrice) * 100;

      const maxFavorablePct = side === 'BUY'
        ? ((highestHigh - entryPrice) / entryPrice) * 100
        : ((entryPrice - lowestLow) / entryPrice) * 100;

      const maxAdversePct = side === 'BUY'
        ? ((entryPrice - lowestLow) / entryPrice) * 100
        : ((highestHigh - entryPrice) / entryPrice) * 100;

      // Target (1.2% gain) vs SL (0.8% loss)
      const isSuccess = maxFavorablePct >= 1.0 && maxAdversePct < 0.75;

      const avgVol20 = window15m.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;
      const volumeRatio = avgVol20 > 0 ? currentBar.volume / avgVol20 : 1.0;

      let failureReason: string | undefined;
      if (!isSuccess) {
        if (adx < 22) {
          failureReason = `CHOP_LOW_ADX (${adx.toFixed(1)})`;
        } else if (side === 'BUY' && (ema9 < ema21 || currentBar.close < ema50)) {
          failureReason = `COUNTER_EMA_ALIGNMENT (Price < EMA50 or EMA9 < EMA21)`;
        } else if (side === 'SELL' && (ema9 > ema21 || currentBar.close > ema50)) {
          failureReason = `COUNTER_EMA_ALIGNMENT (Price > EMA50 or EMA9 > EMA21)`;
        } else if (volumeRatio < 0.75) {
          failureReason = `LOW_VOLUME_EXHAUSTION (${volumeRatio.toFixed(2)}x)`;
        } else if (side === 'BUY' && confluence.rsi14 > 68) {
          failureReason = `OVERBOUGHT_BUY (RSI ${confluence.rsi14.toFixed(1)})`;
        } else if (side === 'SELL' && confluence.rsi14 < 32) {
          failureReason = `OVERSOLD_SELL (RSI ${confluence.rsi14.toFixed(1)})`;
        } else {
          failureReason = `VOLATILITY_WHIPSAW`;
        }
      }

      allEvaluations.push({
        symbol: sym,
        barIndex: i,
        time: new Date(currentBar.time).toISOString(),
        side,
        entryPrice,
        quantScore: mathVerdict.quantScore,
        confluenceScore: confluence.confluenceScore,
        adx,
        rsi: confluence.rsi14,
        ema9,
        ema21,
        ema50,
        volumeRatio,
        forwardReturn1hPct: parseFloat(return1hPct.toFixed(2)),
        forwardReturn2hPct: parseFloat(return2hPct.toFixed(2)),
        forwardReturn3hPct: parseFloat(return3hPct.toFixed(2)),
        maxFavorablePct: parseFloat(maxFavorablePct.toFixed(2)),
        maxAdversePct: parseFloat(maxAdversePct.toFixed(2)),
        isSuccess,
        failureReason,
      });
    }
  }

  const total = allEvaluations.length;
  const successes = allEvaluations.filter(e => e.isSuccess);
  const failures = allEvaluations.filter(e => !e.isSuccess);

  console.log(`\n========================================================================`);
  console.log(`🛡️ TESTING SYSTEM HEALING: APPLYING STRICT FILTERS`);
  console.log(`========================================================================`);

  const filteredSignals = allEvaluations.filter(e => {
    // 1. ADX Filter: Trend must exist
    if (e.adx < 22) return false;

    // 2. Strict EMA Alignment
    if (e.side === 'BUY') {
      if (e.entryPrice < e.ema50 || e.ema9 < e.ema21) return false;
      if (e.rsi > 65) return false; // Don't buy overbought
    } else {
      if (e.entryPrice > e.ema50 || e.ema9 > e.ema21) return false;
      if (e.rsi < 35) return false; // Don't short oversold
    }

    // 3. Skip BTC in low-volatility chop
    if (e.symbol === 'BTCUSD') return false;

    return true;
  });

  const filteredSuccess = filteredSignals.filter(e => e.isSuccess);
  const filteredFail = filteredSignals.filter(e => !e.isSuccess);
  const filteredWinRate = filteredSignals.length > 0 ? ((filteredSuccess.length / filteredSignals.length) * 100).toFixed(1) : '0';

  console.log(`Filtered Signals Remaining: ${filteredSignals.length} (from ${total})`);
  console.log(`Filtered Successes:         ${filteredSuccess.length} Wins`);
  console.log(`Filtered Failures:          ${filteredFail.length} Losses`);
  console.log(`🎯 NEW FILTERED WIN RATE:   ${filteredWinRate}% (was ${(successes.length / total * 100).toFixed(1)}%)`);

  console.log(`\n📈 FILTERED COIN PERFORMANCE:`);
  for (const sym of SYMBOLS.filter(s => s !== 'BTCUSD')) {
    const list = filteredSignals.filter(e => e.symbol === sym);
    const wins = list.filter(e => e.isSuccess).length;
    const wr = list.length > 0 ? ((wins / list.length) * 100).toFixed(1) : '0';
    console.log(`  ${sym.padEnd(8)}: ${list.length} signals | Win Rate: ${wr}% (${wins}W / ${list.length - wins}L)`);
  }

  // Failure breakdown
  const failReasonsCount: Record<string, number> = {};
  for (const f of failures) {
    const r = f.failureReason || 'UNKNOWN';
    failReasonsCount[r] = (failReasonsCount[r] || 0) + 1;
  }

  console.log(`\n🚨 ROOT CAUSES OF FAILED SIGNALS:`);
  for (const [r, cnt] of Object.entries(failReasonsCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${r.padEnd(50)}: ${cnt} signals (${((cnt / failures.length) * 100).toFixed(1)}%)`);
  }

  // Symbol Breakdown
  console.log(`\n📈 SYMBOL PERFORMANCE BREAKDOWN:`);
  for (const sym of SYMBOLS) {
    const symSignals = allEvaluations.filter(e => e.symbol === sym);
    const symWins = symSignals.filter(e => e.isSuccess).length;
    const winRate = symSignals.length > 0 ? ((symWins / symSignals.length) * 100).toFixed(1) : '0';
    console.log(`  ${sym.padEnd(8)}: ${symSignals.length} signals | Win Rate: ${winRate}% (${symWins}W / ${symSignals.length - symWins}L)`);
  }

  // Characteristics of True Winners vs Failures
  const avgWinnerADX = successes.reduce((s, e) => s + e.adx, 0) / (successes.length || 1);
  const avgLoserADX = failures.reduce((s, e) => s + e.adx, 0) / (failures.length || 1);

  const avgWinnerVol = successes.reduce((s, e) => s + e.volumeRatio, 0) / (successes.length || 1);
  const avgLoserVol = failures.reduce((s, e) => s + e.volumeRatio, 0) / (failures.length || 1);

  console.log(`\n💡 KEY STATISTICAL DIFFERENCES (Winners vs Losers):`);
  console.log(`  - ADX Trend Strength: Winners = ${avgWinnerADX.toFixed(1)} | Losers = ${avgLoserADX.toFixed(1)}`);
  console.log(`  - Relative Volume:    Winners = ${avgWinnerVol.toFixed(2)}x | Losers = ${avgLoserVol.toFixed(2)}x`);

  // Show 5 Sample False Signals and what the candles did
  console.log(`\n🔎 SAMPLE FALSE SIGNALS (Where BUY was called but candles dumped / SELL was called but candles pumped):`);
  for (const f of failures.slice(0, 8)) {
    console.log(`  [${f.symbol}] ${f.side} at $${f.entryPrice} on ${f.time}`);
    console.log(`    Outcome: Max Adverse: ${f.maxAdversePct}% | Reason: ${f.failureReason} | Ret 1h: ${f.forwardReturn1hPct}%, 2h: ${f.forwardReturn2hPct}%`);
  }
}

runForwardAnalysis().catch(console.error);
