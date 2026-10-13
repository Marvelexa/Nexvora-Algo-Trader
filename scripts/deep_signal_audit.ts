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

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');
const SYMBOLS = ['ADAUSD', 'DOGEUSD', 'SUIUSD', 'ETHUSD', 'SOLUSD'];

function loadCandles(symbol: string): CandleData[] {
  const f5k = path.join(CACHE_DIR, `${symbol}_15m_5000.json`);
  if (fs.existsSync(f5k)) return JSON.parse(fs.readFileSync(f5k, 'utf-8'));
  const f2k = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (fs.existsSync(f2k)) return JSON.parse(fs.readFileSync(f2k, 'utf-8'));
  return [];
}

async function auditSignals() {
  console.log(`========================================================================`);
  console.log(`🔬 DEEP HISTORICAL CANDLE SIGNAL AUDIT (5000 BARS PER COIN)`);
  console.log(`========================================================================\n`);

  for (const sym of SYMBOLS) {
    const bars = loadCandles(sym);
    if (bars.length < 200) {
      console.log(`Skipping ${sym}: insufficient data (${bars.length} bars)`);
      continue;
    }

    let mathBuyCount = 0;
    let mathBuyTrueMoves = 0; // price actually increased over next 4 bars (1h)
    let mathBuyFalseMoves = 0; // price dumped over next 4 bars

    let mathSellCount = 0;
    let mathSellTrueMoves = 0; // price actually dumped
    let mathSellFalseMoves = 0; // price pumped

    // Breakdown buckets
    const buySuccessConditions: any[] = [];
    const buyFailConditions: any[] = [];
    const sellSuccessConditions: any[] = [];
    const sellFailConditions: any[] = [];

    for (let i = 60; i < bars.length - 8; i++) {
      const window = bars.slice(i - 60, i + 1);
      const curr = window[window.length - 1];

      // Next 4 bars (1 hour forward)
      const nextBars = bars.slice(i + 1, i + 5);
      const maxForwardHigh = Math.max(...nextBars.map(b => b.high));
      const minForwardLow = Math.min(...nextBars.map(b => b.low));
      const forwardEndClose = nextBars[nextBars.length - 1].close;

      const math = QuantMathematicalEngine.evaluateMarketMath(sym, window);
      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window);
      const adx = CryptoDedicatedStrategyEngine.calculateADX(window, 14);

      const closes = window.map(c => c.close);
      const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
      const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
      const ema200 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 200 > closes.length ? closes.length - 1 : 200).slice(-1)[0];

      const atr = conf.atr > 0 ? conf.atr : curr.close * 0.008;

      const isGreen = curr.close > curr.open;
      const body = Math.abs(curr.close - curr.open);
      const upperWick = curr.high - Math.max(curr.open, curr.close);
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;

      // Condition object
      const cond = {
        time: new Date(curr.time).toISOString(),
        close: curr.close,
        mathScore: math.quantScore,
        mathSide: math.recommendedSide,
        confScore: conf.confluenceScore,
        rsi: conf.rsi14,
        adx,
        atr,
        isGreen,
        bodyToAtr: body / atr,
        upperWickToBody: body > 0 ? upperWick / body : 0,
        lowerWickToBody: body > 0 ? lowerWick / body : 0,
        aboveEma20: curr.close > ema20,
        aboveEma50: curr.close > ema50,
        ema20Above50: ema20 > ema50,
      };

      // Check Math BUY signals
      if (math.recommendedSide === 'BUY' && math.quantScore >= 50) {
        mathBuyCount++;
        // Check if forward max gain was >= 1.5 ATR before dropping 1.2 ATR
        const hitGainFirst = (maxForwardHigh - curr.close) >= 1.5 * atr && (curr.close - minForwardLow) < 1.2 * atr;
        const forwardChange = ((forwardEndClose - curr.close) / curr.close) * 100;

        if (forwardChange > 0.3 && hitGainFirst) {
          mathBuyTrueMoves++;
          buySuccessConditions.push(cond);
        } else if (forwardChange < -0.3) {
          mathBuyFalseMoves++;
          buyFailConditions.push(cond);
        }
      }

      // Check Math SELL signals
      if (math.recommendedSide === 'SELL' && math.quantScore >= 50) {
        mathSellCount++;
        const hitDropFirst = (curr.close - minForwardLow) >= 1.5 * atr && (maxForwardHigh - curr.close) < 1.2 * atr;
        const forwardChange = ((curr.close - forwardEndClose) / curr.close) * 100;

        if (forwardChange > 0.3 && hitDropFirst) {
          mathSellTrueMoves++;
          sellSuccessConditions.push(cond);
        } else if (forwardChange < -0.3) {
          mathSellFalseMoves++;
          sellFailConditions.push(cond);
        }
      }
    }

    console.log(`------------------------------------------------------------------------`);
    console.log(`📊 ${sym} (Evaluated ${bars.length} Bars):`);
    console.log(`  BUY Signals (Score >= 50): Total ${mathBuyCount}`);
    console.log(`    ✅ TRUE BUY (Pumped forward):  ${mathBuyTrueMoves} (${mathBuyCount > 0 ? ((mathBuyTrueMoves / mathBuyCount) * 100).toFixed(1) : 0}%)`);
    console.log(`    ❌ FALSE BUY (Dumped forward): ${mathBuyFalseMoves} (${mathBuyCount > 0 ? ((mathBuyFalseMoves / mathBuyCount) * 100).toFixed(1) : 0}%)`);

    console.log(`  SELL Signals (Score >= 50): Total ${mathSellCount}`);
    console.log(`    ✅ TRUE SELL (Dumped forward): ${mathSellTrueMoves} (${mathSellCount > 0 ? ((mathSellTrueMoves / mathSellCount) * 100).toFixed(1) : 0}%)`);
    console.log(`    ❌ FALSE SELL (Pumped forward): ${mathSellFalseMoves} (${mathSellCount > 0 ? ((mathSellFalseMoves / mathSellCount) * 100).toFixed(1) : 0}%)`);

    // Compare SUCCESS vs FAIL conditions for BUY
    if (buySuccessConditions.length > 0 && buyFailConditions.length > 0) {
      const avgSuccessADX = buySuccessConditions.reduce((s, c) => s + c.adx, 0) / buySuccessConditions.length;
      const avgFailADX = buyFailConditions.reduce((s, c) => s + c.adx, 0) / buyFailConditions.length;
      const avgSuccessRSI = buySuccessConditions.reduce((s, c) => s + c.rsi, 0) / buySuccessConditions.length;
      const avgFailRSI = buyFailConditions.reduce((s, c) => s + c.rsi, 0) / buyFailConditions.length;
      const successGreenPct = (buySuccessConditions.filter(c => c.isGreen).length / buySuccessConditions.length) * 100;
      const failGreenPct = (buyFailConditions.filter(c => c.isGreen).length / buyFailConditions.length) * 100;
      const successAboveEma20 = (buySuccessConditions.filter(c => c.aboveEma20).length / buySuccessConditions.length) * 100;
      const failAboveEma20 = (buyFailConditions.filter(c => c.aboveEma20).length / buyFailConditions.length) * 100;

      console.log(`\n  🔎 BUY Key Differences (SUCCESS vs FAIL):`);
      console.log(`     Average ADX:          SUCCESS = ${avgSuccessADX.toFixed(1)} vs FAIL = ${avgFailADX.toFixed(1)}`);
      console.log(`     Average RSI:          SUCCESS = ${avgSuccessRSI.toFixed(1)} vs FAIL = ${avgFailRSI.toFixed(1)}`);
      console.log(`     Was Green Bar:        SUCCESS = ${successGreenPct.toFixed(1)}% vs FAIL = ${failGreenPct.toFixed(1)}%`);
      console.log(`     Price > 20 EMA:       SUCCESS = ${successAboveEma20.toFixed(1)}% vs FAIL = ${failAboveEma20.toFixed(1)}%`);
    }

    // Compare SUCCESS vs FAIL conditions for SELL
    if (sellSuccessConditions.length > 0 && sellFailConditions.length > 0) {
      const avgSuccessADX = sellSuccessConditions.reduce((s, c) => s + c.adx, 0) / sellSuccessConditions.length;
      const avgFailADX = sellFailConditions.reduce((s, c) => s + c.adx, 0) / sellFailConditions.length;
      const avgSuccessRSI = sellSuccessConditions.reduce((s, c) => s + c.rsi, 0) / sellSuccessConditions.length;
      const avgFailRSI = sellFailConditions.reduce((s, c) => s + c.rsi, 0) / sellFailConditions.length;
      const successRedPct = (sellSuccessConditions.filter(c => !c.isGreen).length / sellSuccessConditions.length) * 100;
      const failRedPct = (sellFailConditions.filter(c => !c.isGreen).length / sellFailConditions.length) * 100;
      const successBelowEma20 = (sellSuccessConditions.filter(c => !c.aboveEma20).length / sellSuccessConditions.length) * 100;
      const failBelowEma20 = (sellFailConditions.filter(c => !c.aboveEma20).length / sellFailConditions.length) * 100;

      console.log(`\n  🔎 SELL Key Differences (SUCCESS vs FAIL):`);
      console.log(`     Average ADX:          SUCCESS = ${avgSuccessADX.toFixed(1)} vs FAIL = ${avgFailADX.toFixed(1)}`);
      console.log(`     Average RSI:          SUCCESS = ${avgSuccessRSI.toFixed(1)} vs FAIL = ${avgFailRSI.toFixed(1)}`);
      console.log(`     Was Red Bar:          SUCCESS = ${successRedPct.toFixed(1)}% vs FAIL = ${failRedPct.toFixed(1)}%`);
      console.log(`     Price < 20 EMA:       SUCCESS = ${successBelowEma20.toFixed(1)}% vs FAIL = ${failBelowEma20.toFixed(1)}%`);
    }
    console.log(``);
  }
}

auditSignals().catch(console.error);
